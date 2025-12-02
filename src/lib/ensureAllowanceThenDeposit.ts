// src/lib/ensureAllowanceThenDeposit.ts
import { erc20Abi, type PublicClient, type Address, encodeFunctionData,decodeEventLog } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import type { Chain } from 'viem'
import { sendSimulated } from './tx'
// src/lib/ensureAllowanceThenDeposit.ts

const ERC20_Transfer = [{
  type: 'event',
  name: 'Transfer',
  inputs: [
    { indexed: true,  name: 'from',  type: 'address' },
    { indexed: true,  name: 'to',    type: 'address' },
    { indexed: false, name: 'value', type: 'uint256' },
  ],
}] as const

const ERC4626_Deposit = [{
  type: 'event',
  name: 'Deposit',
  inputs: [
    { indexed: true,  name: 'sender', type: 'address' },
    { indexed: true,  name: 'owner',  type: 'address' },
    { indexed: false, name: 'assets', type: 'uint256' },
    { indexed: false, name: 'shares', type: 'uint256' },
  ],
}] as const
export async function ensureAllowanceThenDeposit(params: {
  pub: PublicClient
  account: PrivateKeyAccount          // from privateKeyToAccount(RELAYER_PRIVATE_KEY)
  chain: Chain                        // lisk
  token: Address                      // USDT0 on Lisk
  vaultAddr: Address                  // Morpho ERC4626 vault (also the spender/puller)
  receiver: Address                   // SAFE
  amount: bigint                      // 6d
  morphoAbi: any                      // must include deposit(uint256,address)
  log?: (msg: string, extra?: any) => void
}) {
  const {
    pub, account, chain,
    token, vaultAddr, receiver, amount, morphoAbi,
    log = () => {},
  } = params
  const holder = account.address

  // 0) balance & allowance
  const [bal, allowance] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [holder] }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [holder, vaultAddr] }) as Promise<bigint>,
  ])
  log('[ensureAllowanceThenDeposit] pre', { holder, bal: bal.toString(), allowance: allowance.toString(), need: amount.toString() })
  if (bal < amount) throw new Error(`Relayer balance ${bal} < amount ${amount}`)

  // 1) USDT-style approve(0) then approve(N) if needed
  if (allowance < amount) {
    if (allowance > 0n) {
       await pub.simulateContract({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [vaultAddr, 0n],
        account: holder,
      })
      const tx0 = await sendSimulated(pub, account, chain, {
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vaultAddr, 0n] }),
      })
      log('[ensureAllowanceThenDeposit] approve(0)', { tx0 })
      await pub.waitForTransactionReceipt({ hash: tx0 })
    }

    await pub.simulateContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [vaultAddr, amount],
      account: holder,
    })
    const tx1 = await sendSimulated(pub, account, chain, {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vaultAddr, amount] }),
    })
    log('[ensureAllowanceThenDeposit] approve(N)', { tx1, amount: amount.toString() })

    // ✅ wait for receipt first
    await pub.waitForTransactionReceipt({ hash: tx1 })

    // ✅ NEW: wait for allowance to reflect (RPC lag fix)
    let post = 0n
    for (let i = 0; i < 5; i++) {
      post = (await pub.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [holder, vaultAddr],
      })) as bigint

      if (post >= amount) break
      log(`[ensureAllowanceThenDeposit] waiting allowance update… (${i + 1}/5)`, { allowance: post.toString() })
      await new Promise((r) => setTimeout(r, 2000))
    }

    if (post < amount) {
      log(`[ensureAllowanceThenDeposit] warning: allowance ${post} < ${amount} after approve (likely RPC lag)`)
      // Don’t throw — continue to deposit safely
    }
  }

  // 2) deposit(uint256 assets, address receiver)
 await pub.simulateContract({
    address: vaultAddr,
    abi: morphoAbi,
    functionName: 'deposit',
    args: [amount, receiver],
    account: holder,
  })
  const depositTx = await sendSimulated(pub, account, chain, {
    to: vaultAddr,
    data: encodeFunctionData({ abi: morphoAbi, functionName: 'deposit', args: [amount, receiver] }),
  })
  log('[ensureAllowanceThenDeposit] deposit()', { depositTx })

  // sendSimulated waits already; just fetch for logs
  const depRcpt = await pub.getTransactionReceipt({ hash: depositTx })

  // ---- Validate: ERC20 Transfer -> vault ----
  let transferred: bigint | null
  let transferMatches = false
  for (const lg of depRcpt.logs) {
    if (lg.address.toLowerCase() !== token.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: ERC20_Transfer, ...lg })
      if (ev.eventName === 'Transfer') {
        const from = (ev.args as any).from as Address
        const to   = (ev.args as any).to as Address
        const val  = (ev.args as any).value as bigint
        if (from.toLowerCase() === holder.toLowerCase()
         && to.toLowerCase()   === vaultAddr.toLowerCase()) {
          transferred = val
          transferMatches = true
          break
        }
      }
    } catch {}
  }

  // ---- Optional: Validate ERC4626 Deposit(owner=receiver, assets=amount) ----
  let erc4626Ok = false
  for (const lg of depRcpt.logs) {
    if (lg.address.toLowerCase() !== vaultAddr.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: ERC4626_Deposit, ...lg })
      if (ev.eventName === 'Deposit') {
        const owner  = (ev.args as any).owner as Address
        const assets = (ev.args as any).assets as bigint
        if (owner.toLowerCase() === receiver.toLowerCase() && assets === amount) {
          erc4626Ok = true
          break
        }
      }
    } catch {}
  }

  if (!transferMatches) {
    log('[ensureAllowanceThenDeposit] warning: no matching ERC20 Transfer to vault found in logs')
  }
  if (!erc4626Ok) {
    log('[ensureAllowanceThenDeposit] note: ERC4626 Deposit event not found or non-matching (vault may not emit standard event)')
  }

  return {
    depositTx,
    verified: {
      sender: holder,
      token,
      vault: vaultAddr,
      receiver,
      amount,
      transferOk: transferMatches,
      erc4626Ok,
    },
  }
}