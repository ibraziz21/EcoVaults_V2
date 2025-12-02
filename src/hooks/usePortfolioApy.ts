/* src/hooks/usePortfolioApy.ts
   Morpho-only portfolio APY, weighted by stablecoin USD amounts (USDCe/USDT0).
*/

import { useMemo } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useYields } from '@/hooks/useYields'
import type { Position } from '@/lib/positions'

/** Decimals for Morpho Blue on Lisk (assets): WETH=18, stables=6 */
function decimalsFor(p: Position): number {
  return 18
}

/** Treat these as $1 for naive portfolio USD weighting */
function isStableOnAnyChain(t: Position['token']) {
  return t === 'USDCe' || t === 'USDT0'
}

/** Build a lookup from Morpho Blue (Lisk) snapshots: token -> apy
 *   snapshots expose tokens as 'USDC' | 'USDT' | 'WETH'
 *   positions expose tokens as 'USDCe' | 'USDT0' | 'WETH'
 */
function morphoLookupFromYields(yields: ReturnType<typeof useYields>['yields']) {
  const map = new Map<string, number>()
  if (!yields) return map
  for (const y of yields) {
    if (y.protocolKey !== 'morpho-blue' || y.chain !== 'lisk') continue
    map.set(y.token, y.apy ?? 0) // y.token is USDC/USDT/WETH
  }
  return map
}

export function usePortfolioApy() {
  const { data: positions } = usePositions()
  const { yields } = useYields() // contains Morpho Blue APRs on Lisk
  const morphoApyLookup = useMemo(() => morphoLookupFromYields(yields), [yields])

  return useMemo(() => {
    if (!positions) return { loading: true, apy: 0, totalUsd: 0 }

    // Map position token -> snapshot token
    const apyForPos = (p: Position): number | undefined => {
      const key = p.token === 'USDCe' ? 'USDC' : p.token === 'USDT0' ? 'USDT' : 'WETH'
      return morphoApyLookup.get(key)
    }

    let totalUsd = 0
    let weighted = 0

    positions.forEach((pos) => {
      const apy = apyForPos(pos)
      if (apy == null) return
      const dec = decimalsFor(pos)

      // For portfolio USD weighting, count stablecoins (1:1)
      if (isStableOnAnyChain(pos.token)) {
        const usd = Number(pos.amount) / 10 ** dec
        totalUsd += usd
        weighted += usd * apy
      }
    })

    return {
      loading: false,
      apy: totalUsd ? weighted / totalUsd : 0,
      totalUsd,
    }
  }, [positions, morphoApyLookup])
}
