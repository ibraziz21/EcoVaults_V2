// src/hooks/useUsdPrices.ts
// (Unchanged in spirit; generic helper that also covers LSK/ETH for reward math.)

import { useQuery } from '@tanstack/react-query'

/** Very small price map focused on what you’ll actually see in Merkl rewards. */
const COINGECKO_IDS = {
  ETH: 'ethereum',
  OP: 'optimism',
  LSK: 'lisk',
  USDC: 'usd-coin',
  USDT: 'tether',
} as const

type Sym = keyof typeof COINGECKO_IDS | 'USD'

export function useUsdPrices() {
  const q = useQuery<Record<Sym, number>>({
    queryKey: ['usd-prices', 'eth,op,lsk,usdc,usdt'],
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const ids = Object.values(COINGECKO_IDS).join(',')
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error('Price fetch failed')
      const data = (await res.json()) as Record<string, { usd: number }>

      const map: Record<Sym, number> = {
        ETH: data[COINGECKO_IDS.ETH]?.usd ?? 0,
        OP:  data[COINGECKO_IDS.OP]?.usd ?? 0,
        LSK: data[COINGECKO_IDS.LSK]?.usd ?? 0,
        USDC: data[COINGECKO_IDS.USDC]?.usd ?? 1,
        USDT: data[COINGECKO_IDS.USDT]?.usd ?? 1,
        USD: 1,
      }
      return map
    },
  })

  /** Normalize common reward symbols to our small map. */
  function symbolToKey(symRaw: string): Sym {
    const s = symRaw.trim().toUpperCase()
    if (s === 'WETH') return 'ETH'
    if (s.startsWith('USDC')) return 'USDC'   // USDC, USDC.e, USDCe
    if (s.startsWith('USDT')) return 'USDT'   // USDT, USDT0
    if (s === 'OP')    return 'OP'
    if (s === 'LSK')   return 'LSK'
    return 'USD' // safest fallback (treat unknown as $1)
  }

  function priceUsdForSymbol(sym: string): number {
    const key = symbolToKey(sym)
    const p = q.data?.[key] ?? (key === 'USD' ? 1 : 0)
    return p
  }

  return {
    prices: q.data ?? { ETH: 0, OP: 0, LSK: 0, USDC: 1, USDT: 1, USD: 1 },
    isLoading: q.isLoading,
    error: q.error,
    priceUsdForSymbol,
  }
}
