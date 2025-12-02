// app/api/mintVaultUsdt0/route.ts
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk, optimism } from 'viem/chains'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import morphoAbi from '@/lib/abi/morphoLisk.json'
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'
import * as dotenv from 'dotenv'
dotenv.config()

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || ''
if (!PRIVATE_KEY) throw new Error('RELAYER_PRIVATE_KEY missing')
const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)

// Lisk clients (bridged USDT0 sits in relayer EOA here)
const liskClient = createWalletClient({ account, chain: lisk, transport: http() })
const liskPublic = createPublicClient({ chain: lisk, transport: http() })

// Optimism clients (receipt bookkeeping lives on OP)
const opPublic = createPublicClient({ chain: optimism, transport: http() })
const opClient = createWalletClient({ account, chain: optimism, transport: http() })

// Addresses
const USDT0         = TokenAddresses.USDT0.lisk as `0x${string}`
const MORPHO_POOL   = MORPHO_POOLS['usdt0-supply'] as `0x${string}` // ERC4626-like vault with deposit(uint256,address)
const REWARDS_VAULT = '0x1aDBe89F2887a79C64725128fd1D53b10FD6b441' as `0x${string}`

// ABIs
const ERC20_APPROVE_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])

/* ── helpers ───────────────────────────────────────────────────── */
async function readRelayerBal(): Promise<bigint> {
  return (await liskPublic.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint
}

async function readAllowance(spender: `0x${string}`): Promise<bigint> {
  return (await liskPublic.readContract({
    address: USDT0,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, spender],
  })) as bigint
}

// Robust waiter to avoid Lisk RPC's "block is out of range" during waits
async function waitReceipt(
  which: 'lisk' | 'op',
  hash: `0x${string}`,
  { timeoutMs = 15 * 60_000, pollMs = 5_000 }: { timeoutMs?: number; pollMs?: number } = {},
) {
  const pub = which === 'lisk' ? liskPublic : opPublic
  const end = Date.now() + timeoutMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const r = await pub.getTransactionReceipt({ hash })
      if (r) return r
    } catch {
      // swallow "not found" / -32019 and keep polling
    }
    if (Date.now() > end) throw new Error('Timeout waiting for tx receipt')
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

/* ── route ─────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  const { userAddress, tokenAmt, expectedMin, timeoutMs, pollMs } = (await req.json().catch(() => ({}))) as {
    userAddress?: `0x${string}`
    tokenAmt?: string            // exact bridged amount (skip waiting if provided)
    expectedMin?: string         // optional: min arrival amount to wait for (dec string)
    timeoutMs?: number           // optional: default 15m
    pollMs?: number              // optional: default 10s
  }

  if (!userAddress) {
    return Response.json({ success: false, message: 'userAddress required' }, { status: 400 })
  }

  try {
    /* 1) Determine amount to deposit */
    let amount: bigint
    if (tokenAmt) {
      amount = BigInt(tokenAmt)
    } else {
      const start = await readRelayerBal()
      const want  = expectedMin ? BigInt(expectedMin) : 0n
      const endAt = Date.now() + (timeoutMs ?? 15 * 60 * 1000)
      const every = pollMs ?? 10_000

      let curr = await readRelayerBal()
      // wait for bridged funds (delta≥want if provided, else any positive delta)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const delta = curr - start
        if (expectedMin ? (delta >= want || curr >= want) : (delta > 0n)) break
        if (Date.now() > endAt) throw new Error('Timeout waiting for bridged funds')
        await new Promise((r) => setTimeout(r, every))
        curr = await readRelayerBal()
      }
      const delta = curr - start
      amount = delta > 0n ? delta : curr
    }

    if (amount <= 0n) throw new Error('No tokens available to deposit')

    /* 2) USDT-style approvals (only if needed), and wait between txs */
    const allowance = await readAllowance(MORPHO_POOL)
    if (allowance < amount) {
      if (allowance > 0n) {
        const { request } = await liskPublic.simulateContract({
          address: USDT0,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [MORPHO_POOL, 0n],
          account,
        })
        const tx = await liskClient.writeContract(request)
        await waitReceipt('lisk', tx, { timeoutMs, pollMs })
      }
      {
        const { request } = await liskPublic.simulateContract({
          address: USDT0,
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [MORPHO_POOL, amount],
          account,
        })
        const tx = await liskClient.writeContract(request)
        await waitReceipt('lisk', tx, { timeoutMs, pollMs })
      }
    }

    /* 3) Vault deposit: deposit(amount, receiver=SAFEVAULT) */
    const { request: supplyReq } = await liskPublic.simulateContract({
      address: MORPHO_POOL,
      abi: morphoAbi,
      functionName: 'deposit',
      args: [amount, SAFEVAULT as `0x${string}`],
      account,
    })
    const depositTx = await liskClient.writeContract(supplyReq)
    await waitReceipt('lisk', depositTx, { timeoutMs, pollMs })

    /* 4) Record/mint receipts on OP */
    const { request: recordReq } = await opPublic.simulateContract({
      address: REWARDS_VAULT,
      abi: rewardsAbi,
      functionName: 'recordDeposit',
      args: [userAddress, amount],
      account,
    })
    const mintTx = await opClient.writeContract(recordReq)
    await waitReceipt('op', mintTx, { timeoutMs, pollMs })

    return Response.json({ success: true, depositTx, mintTx, amount: amount.toString() })
  } catch (err: any) {
    console.error('mintVaultUsdt0 failed', err)
    return Response.json({ success: false, message: err?.message ?? 'Failed' }, { status: 500 })
  }
}
