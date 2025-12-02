// src/lib/tvl.ts
//
// Robust TVL helpers for Morpho Blue (Lisk) only.
// Morpho (Lisk):
//   TVL = ERC-4626 totalAssets (WETH uses Coingecko price; price memoized).

import {  formatUnits } from 'viem'
import { publicLisk } from '@/lib/clients'
import { memo } from './memo'

/* ─────────────────────────────────────────────────────────────────────────── */
/* Morpho vaults (Lisk)                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

export const MORPHO_VAULTS: Record<'USDCe' | 'USDT0' | 'WETH', `0x${string}`> = {
  USDCe: '0xd92f564a29992251297980187a6b74faa3d50699',
  USDT0: '0x50cb55be8cf05480a844642cb979820c847782ae',
  WETH:  '0x7cbaa98bd5e171a658fdf761ed1db33806a0d346',
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ABIs                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

const erc4626Abi = [
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

/* ─────────────────────────────────────────────────────────────────────────── */
/* Memoized helpers                                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

/** ETH/USD price (Coingecko) – memoized 60s to avoid rate limits. */
async function getEthUsdPrice(): Promise<number> {
  return memo('price:eth-usd', 60_000, async () => {
    try {
      const res = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
        { cache: 'no-store' },
      )
      const j = await res.json()
      return typeof j?.ethereum?.usd === 'number' ? j.ethereum.usd : 0
    } catch {
      return 0
    }
  })
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* TVL calculators                                                             */
/* ─────────────────────────────────────────────────────────────────────────── */

async function morphoTvlUsd(token: 'USDCe' | 'USDT0' | 'WETH'): Promise<number> {
  try {
    const v = MORPHO_VAULTS[token]
    const totalAssets = await publicLisk.readContract({
      address: v,
      abi: erc4626Abi,
      functionName: 'totalAssets',
    }) as bigint

    if (token === 'WETH') {
      const price = await getEthUsdPrice()
      return Number(formatUnits(totalAssets, 18)) * price
    }
    return Number(formatUnits(totalAssets, 6))
  } catch {
    return 0
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Public API                                                                  */
/* ─────────────────────────────────────────────────────────────────────────── */

export async function getTvlUsd(p: {
  protocol: 'Morpho Blue'
  chain: 'lisk'
  token: 'USDCe' | 'USDT0' | 'WETH'
}): Promise<number> {
  try {
    return await morphoTvlUsd(p.token)
  } catch {
    return 0
  }
}
