// src/lib/withdrawer.ts
import type { WalletClient } from 'viem'
import { encodeAbiParameters, keccak256, stringToBytes } from 'viem'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import { ROUTERS } from './constants'
import { ensureAllowanceForRouterOnLisk } from './depositor'
import { publicLisk } from './clients'
import { CHAINS } from './wallet'

type TokenLisk = 'USDCe' | 'USDT0'

function keyForMorphoLisk(token: TokenLisk): `0x${string}` {
  // keccak256("morpho-blue:lisk:USDCe" | "morpho-blue:lisk:USDT0")
  const label = `morpho-blue:lisk:${token}`
  return keccak256(stringToBytes(label)) as `0x${string}`
}

async function waitReceiptLisk(hash: `0x${string}`) {
  await publicLisk.waitForTransactionReceipt({ hash })
}

/**
 * Withdraw from Morpho on Lisk via Router:
 * - Approves SHARES (vault token) to Router if needed
 * - Calls router.withdraw(key, shareToken, shares, to, abi.encode(underlying))
 */
export async function withdrawMorphoOnLisk(opts: {
  token: TokenLisk
  shares: bigint
  shareToken: `0x${string}`        // vault (ERC-4626) address — THIS is the "asset" for withdraw()
  underlying: `0x${string}`        // Lisk underlying token to receive
  to: `0x${string}`
  wallet: WalletClient
}) {
  const { token, shares, shareToken, underlying, to, wallet } = opts
  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const router = ROUTERS.lisk as `0x${string}`
  if (!router) throw new Error('Router missing for lisk')

  // 1) Approve SHARES (vault token) -> Router
  await ensureAllowanceForRouterOnLisk(shareToken, router, shares, wallet)

  // 2) Encode data = abi.encode(address underlying)
  const data = encodeAbiParameters([{ type: 'address' }], [underlying])

  // 3) Call router.withdraw
  const key = keyForMorphoLisk(token)

  const { request } = await publicLisk.simulateContract({
    address: router,
    abi: aggregatorRouterAbi,
    functionName: 'withdraw',
    args: [key, shareToken, shares, to, data],
    account: owner,
    chain: CHAINS.lisk,     // 🔥 FORCE SIMULATION ON LISK
  })
  
  // 🔥 IMPORTANT — force write on Lisk!
  const tx = await wallet.writeContract({
    ...request,
    chain: CHAINS.lisk,     // <<<< THIS FIXES EVERYTHING
  })
  
  const withdrawTx = await publicLisk.waitForTransactionReceipt({ hash: tx })
  
  const minedAt = BigInt(withdrawTx.blockNumber ?? 0)
  const target = minedAt + 2n
  while ((await publicLisk.getBlockNumber()) < target) {
    await new Promise((r) => setTimeout(r, 1200)) // ~1.2s poll; tweak if needed

  return { tx }
}
}
