// src/lib/depositor.ts
// Lisk + Morpho only: call these AFTER bridging finishes (user already received token on Lisk).

import type { WalletClient, Address } from 'viem'
import { erc20Abi } from 'viem'
import { lisk as liskChain } from 'viem/chains'
import { ROUTERS, TokenAddresses } from './constants'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import { publicLisk } from './clients'
import type { YieldSnapshot } from '@/hooks/useYields'
import { adapterKeyForSnapshot } from './adapters'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const

/* ────────────────────────────────────────────────────────────
   Helpers (Lisk-only)
   ──────────────────────────────────────────────────────────── */

function toLower(x?: string | null) { return (x ?? '').toLowerCase() }

function isUSDTLikeOnLisk(addr: Address) {
  const usdt0 = (TokenAddresses as any)?.USDT0?.lisk as Address | undefined
  const usdt  = (TokenAddresses as any)?.USDT?.lisk  as Address | undefined
  const a = toLower(addr)
  return (usdt0 && toLower(usdt0) === a) || (usdt && toLower(usdt) === a)
}

async function waitReceiptLisk(hash: `0x${string}`) {
  await publicLisk.waitForTransactionReceipt({ hash })
}

async function readAllowanceLisk(token: Address, owner: Address, spender: Address): Promise<bigint> {
  return (await publicLisk.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })) as bigint
}

async function readBalanceLisk(token: Address, owner: Address): Promise<bigint> {
  return (await publicLisk.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint
}

/** Map UI token to actual Lisk asset used by Morpho: USDC→USDCe, USDT→USDT0, WETH→WETH */
export function resolveMorphoAssetOnLisk(snap: YieldSnapshot): Address {
  if (snap.protocolKey !== 'morpho-blue') {
    throw new Error('resolveMorphoAssetOnLisk: unsupported protocol (morpho-only)')
  }
  const morphoToken =
    snap.token === 'USDC' ? 'USDCe' :
    snap.token === 'USDT' ? 'USDT0' :
    snap.token
  const addr = (TokenAddresses as any)?.[morphoToken]?.lisk as Address | undefined
  if (!addr) throw new Error(`Token address not configured on Lisk for ${morphoToken}`)
  return addr
}

/** Ensure allowance to the Lisk Router (USDT0 requires approve(0) then approve(MAX)) */
export async function ensureAllowanceForRouterOnLisk(
  token: Address,
  router: Address,
  amount: bigint,
  wallet: WalletClient,
) {
  const owner = wallet.account?.address as Address | undefined
  if (!owner) throw new Error('Wallet not connected')

  const current = await readAllowanceLisk(token, owner, router)
  if (current >= amount) return

  // USDT-like quirk (covers USDT0 on Lisk): set to 0 first if non-zero
  if (current > 0n && isUSDTLikeOnLisk(token)) {
    const resetHash = await wallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [router, 0n],
      chain: liskChain,
      account: owner,
    })
    await waitReceiptLisk(resetHash)
  }

  const approveHash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [router, amount],
    chain: liskChain,
    account: owner,
  })
  const approveRcpt=await publicLisk.waitForTransactionReceipt({ hash: approveHash })

   // Wait 2 confirmations after the approval is mined
  const minedAt = BigInt(approveRcpt.blockNumber ?? 0)
  const target = minedAt + 2n
  while ((await publicLisk.getBlockNumber()) < target) {
    await new Promise((r) => setTimeout(r, 1200)) // ~1.2s poll; tweak if needed
  }
}

/* ────────────────────────────────────────────────────────────
   Public entrypoint: deposit to Morpho via Router (user wallet)
   Call after bridge success. Will clamp to user balance.
   ──────────────────────────────────────────────────────────── */

/**
 * depositMorphoOnLiskAfterBridge
 *
 * Bridges are complete and the user holds the Lisk-side asset.
 * This function:
 *  1) Resolves the Lisk token for Morpho (USDC→USDCe, USDT→USDT0, WETH),
 *  2) Reads the user’s balance and clamps to min(minExpectedOut, balance),
 *  3) Ensures allowance to the Lisk Router,
 *  4) Calls Router.deposit(adapterKey, asset, amount, onBehalfOf=user, data=0x) from the user wallet.
 *
 * @param snap            Morpho snapshot for the selected vault (must be morpho-blue on Lisk)
 * @param minExpectedOut  Conservative min-out from Li.Fi route (BigInt)
 * @param wallet          Connected WalletClient (must be able to sign on Lisk)
 * @returns { tx: 0x…, amount: bigint }
 */
export async function depositMorphoOnLiskAfterBridge(
  snap: YieldSnapshot,
  minExpectedOut: bigint,
  wallet: WalletClient,
): Promise<{ tx: `0x${string}`; amount: bigint }> {
  const owner = wallet.account?.address as Address | undefined
  if (!owner) throw new Error('Wallet not connected')

  if (snap.protocolKey !== 'morpho-blue') {
    throw new Error('Only Morpho (Lisk) is supported in this depositor')
  }

  // (Optional) Safety: ensure wallet is on Lisk; caller may have already switched
  // If your wallet client doesn’t auto-switch, do it outside before calling.
  if ((wallet as any)?.chain?.id !== liskChain.id) {
    throw new Error('Switch wallet to Lisk, then retry deposit')
  }

  const router = ROUTERS?.lisk as Address | undefined
  if (!router || toLower(router) === toLower(ZERO_ADDR)) {
    throw new Error('Lisk Router address not configured')
  }

  const adapterKey = adapterKeyForSnapshot(snap)
  const asset = resolveMorphoAssetOnLisk(snap)

  // Clamp deposit to what the user actually received on Lisk
  const balance = await readBalanceLisk(asset, owner)
  const amount = balance >= minExpectedOut ? minExpectedOut : balance
  if (amount <= 0n) throw new Error('No Lisk balance available to deposit')

  // Approve (if needed)
  await ensureAllowanceForRouterOnLisk(asset, router, amount, wallet)

  // Simulate then write
  const { request } = await publicLisk.simulateContract({
    address: router,
    abi: aggregatorRouterAbi as any,
    functionName: 'deposit',
    args: [adapterKey, asset, amount, owner, '0x'],
    account: owner,
  })

  const tx = await wallet.writeContract(request)
  await waitReceiptLisk(tx)

  return { tx, amount }
}
