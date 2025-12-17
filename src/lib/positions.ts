// src/lib/positions.ts
// Positions are defined as **shares**:
// - For USDCe / USDT0: sVault receipt shares on Optimism
// - For WETH: Morpho Blue vault shares on Lisk

import { publicOptimism, publicLisk } from './clients'
import { MORPHO_POOLS, TokenAddresses, type TokenSymbol } from './constants'
import { erc20Abi } from 'viem'

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== 'false'

const err = (...args: any[]) => console.error('[positions]', ...args)

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export type EvmChain = 'lisk'

export interface Position {
  protocol: 'Morpho Blue'
  chain: EvmChain
  token: Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>
  /**
   * Amount is in **shares**:
   * - sVault shares on Optimism for USDCe / USDT0
   * - Morpho vault shares on Lisk for WETH
   */
  amount: bigint
}

/** Anything below this is treated as dust and ignored as a "position". */
export const DUST_SHARES = 10n ** 2n

/* ──────────────────────────────────────────────────────────────── */
/* Morpho Blue vault shares on Lisk (used for WETH only)           */
/* ──────────────────────────────────────────────────────────────── */

const MORPHO_VAULT_BY_TOKEN: Record<
  Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  `0x${string}`
> = {
  USDCe: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
  USDT0: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
  WETH: MORPHO_POOLS['weth-supply'] as `0x${string}`,
}

/** Read the user's **share** balance directly from the vault (ERC20 balanceOf). */
async function morphoSharesLisk(
  token: Extract<TokenSymbol, 'USDCe' | 'USDT0' | 'WETH'>,
  user: `0x${string}`,
): Promise<bigint> {
  const vault = MORPHO_VAULT_BY_TOKEN[token]

  try {
    const shares = (await publicLisk.readContract({
      address: vault,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint

    return shares ?? 0n
  } catch (e) {
    err('morphoSharesLisk.error', e)
    return 0n
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Optimism receipt tokens (sVault) — canonical **positions**      */
/* ──────────────────────────────────────────────────────────────── */

async function fetchReceiptBalance(
  user: `0x${string}`,
  which: 'USDC' | 'USDT',
): Promise<bigint> {
  const addr =
    which === 'USDC'
      ? (TokenAddresses.sVault.optimismUSDC as `0x${string}`)
      : (TokenAddresses.sVault.optimismUSDT as `0x${string}`)

  if (!addr || addr === '0x0000000000000000000000000000000000000000') return 0n

  try {
    const bal = (await publicOptimism.readContract({
      address: addr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint
    return bal ?? 0n
  } catch (e) {
    err('fetchReceiptBalance.error', { which, e })
    return 0n
  }
}

/**
 * For USDCe positions: use the user's sVault USDC receipt shares on Optimism.
 * We still *label* this as the USDCe (Lisk) vault for UI consistency.
 */
async function morphoUSDCeSharesFromReceipt(
  user: `0x${string}`,
): Promise<bigint> {
  return fetchReceiptBalance(user, 'USDC')
}

/**
 * For USDT0 positions: use the user's sVault USDT receipt shares on Optimism.
 */
async function morphoUSDT0SharesFromReceipt(
  user: `0x${string}`,
): Promise<bigint> {
  return fetchReceiptBalance(user, 'USDT')
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions (shares)                        */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const tasks: Promise<Position>[] = []

  // USDCe → sVault USDC shares on OP, but tagged as Lisk/Morpho Blue USDCe vault
  tasks.push(
    morphoUSDCeSharesFromReceipt(user).then((amt) => ({
      protocol: 'Morpho Blue' as const,
      chain: 'lisk' as const,
      token: 'USDCe' as const,
      amount: amt,
    })),
  )

  // USDT0 → sVault USDT shares on OP, but tagged as Lisk/Morpho Blue USDT0 vault
  tasks.push(
    morphoUSDT0SharesFromReceipt(user).then((amt) => ({
      protocol: 'Morpho Blue' as const,
      chain: 'lisk' as const,
      token: 'USDT0' as const,
      amount: amt,
    })),
  )

  // WETH remains a direct Morpho Lisk position
  tasks.push(
    morphoSharesLisk('WETH', user)
      .then((amt) => ({
        protocol: 'Morpho Blue' as const,
        chain: 'lisk' as const,
        token: 'WETH' as const,
        amount: amt,
      }))
      .catch(() => ({
        protocol: 'Morpho Blue' as const,
        chain: 'lisk' as const,
        token: 'WETH' as const,
        amount: 0n,
      })),
  )

  const raw = await Promise.all(tasks)

  // ✅ Only keep positions above dust – this is “how many pools the user is in”
  const nonDust = raw.filter((p) => p.amount > DUST_SHARES)

  if (DEBUG) {
    console.debug('[positions] raw:', raw)
    console.debug('[positions] nonDust:', nonDust)
  }

  return nonDust
}