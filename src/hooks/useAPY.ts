// src/hooks/useApy.ts
// Morpho-only APY hook that returns the Merkl APR for a single token (USDC/USDT/WETH) on Lisk.

import { useQuery, UseQueryResult } from '@tanstack/react-query'
import { MORPHO_VAULTS } from '@/lib/tvl'

async function fetchMerklAprForToken(token: 'USDC' | 'USDT' | 'WETH'): Promise<number> {
  const vaultAddr = (
    token === 'USDC' ? MORPHO_VAULTS.USDCe
    : token === 'USDT' ? MORPHO_VAULTS.USDT0
    : MORPHO_VAULTS.WETH
  ).toLowerCase()

  try {
    const res = await fetch('https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK', { cache: 'no-store' })
    const raw = await res.json()
    if (!Array.isArray(raw)) return 0

    let apr = 0
    for (const c of raw) {
      const sym = String(c?.rewardToken?.symbol ?? c?.rewardTokens?.[0]?.symbol ?? '').toUpperCase()
      if (sym !== 'LSK') continue

      const aprCandidates = [
        c?.apr,
        c?.globalApr,
        c?.estimatedApr,
        c?.rewardTokens?.[0]?.apr,
        c?.rewards?.[0]?.apr,
      ]
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)

      const thisApr = aprCandidates[0] ?? 0
      if (thisApr <= 0) continue

      const blob = JSON.stringify(c)
      const matches = blob.match(/0x[0-9a-fA-F]{40}/g) ?? []
      const hasVault = matches.some((m) => m.toLowerCase() === vaultAddr)
      if (hasVault) apr += thisApr
    }
    return apr
  } catch {
    return 0
  }
}

/** Morpho Lisk APY by display token (USDC/USDT/WETH). */
export function useApy(token: 'USDC' | 'USDT' | 'WETH'): UseQueryResult<number, Error> {
  return useQuery<number, Error>({
    queryKey: ['apy', 'morpho', 'lisk', token],
    queryFn: () => fetchMerklAprForToken(token),
    staleTime: 60_000,
  })
}
