// src/components/positions/YieldTable.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/input'
import { useYields, type Chain, type ProtocolKey as Proto, type YieldSnapshot } from '@/hooks/useYields'
import { YieldRow } from './YieldRow'

const CHAIN_LABEL: Record<Chain, string> = {
  lisk: 'Lisk',
}

const PROTO_LABEL: Record<Proto, string> = {
  'morpho-blue': 'Morpho Blue',
}

const PROTO_ORDER: Proto[] = ['morpho-blue']

// Normalize token symbols for display (optional; YieldRow can also do this)
const DISPLAY_TOKEN: Record<string, string> = {
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
}

/** Hard filter: only show Lisk + Morpho Blue + (USDC/USDT) */
const HARD_FILTER = (y: Pick<YieldSnapshot, 'chain' | 'protocolKey' | 'token'>) =>
  y.chain === 'lisk' &&
  y.protocolKey === 'morpho-blue' &&
  (y.token === 'USDC' || y.token === 'USDT')

export const YieldTable: FC = () => {
  const { yields, isLoading, error } = useYields()

  // UI: search / sort (filters are hard-coded to Lisk + Morpho Blue + USDC/USDT)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'apy_desc' | 'apy_asc' | 'tvl_desc' | 'tvl_asc'>('apy_desc')

  const rows = useMemo(() => {
    if (!yields) return []
    const q = query.trim().toLowerCase()

    // 1) Enforce Lisk + Morpho Blue + USDC/USDT
    const onlyLiskMorpho = yields.filter((y) => HARD_FILTER(y))

    // 2) Optional text filter
    const filtered = onlyLiskMorpho.filter((y) => {
      if (!q) return true
      const hay = `${DISPLAY_TOKEN[y.token] ?? y.token} ${y.protocol} ${y.chain}`.toLowerCase()
      return hay.includes(q)
    })

    // 3) Sort
    const sortedPrimary = filtered.slice().sort((a, b) => {
      const apyA = a.apy ?? 0
      const apyB = b.apy ?? 0
      const tvlA = a.tvlUSD ?? 0
      const tvlB = b.tvlUSD ?? 0
      switch (sort) {
        case 'apy_desc': return apyB - apyA
        case 'apy_asc':  return apyA - apyB
        case 'tvl_desc': return tvlB - tvlA
        case 'tvl_asc':  return tvlA - tvlB
      }
    })

    // 4) Keep protocol grouping stable (single protocol here but harmless)
    return sortedPrimary.sort((a, b) => {
      const ia = PROTO_ORDER.indexOf(a.protocolKey)
      const ib = PROTO_ORDER.indexOf(b.protocolKey)
      return ia - ib
    })
  }, [yields, query, sort])

  return (
    <Card className="mx-auto w-full max-w-6xl overflow-hidden rounded-xl md:rounded-2xl">
      {/* Top bar (sticky on mobile) */}
      <div className="sticky top-0 z-30 flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-white to-white/60 p-3 backdrop-blur md:static md:flex-row md:items-center md:justify-between md:p-4 dark:from-white/5 dark:to-white/10">
        <div className="flex items-center gap-2 md:gap-3">
          <h2 className="text-base font-semibold md:text-lg">Markets</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground md:text-xs">
            {rows.length} {rows.length === 1 ? 'pool' : 'pools'}
          </span>
          <span className="hidden rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 md:inline-block">
            Showing {CHAIN_LABEL.lisk} • {PROTO_LABEL['morpho-blue']} • USDCe &amp; USDT0
          </span>
        </div>

        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:flex-wrap md:items-center md:justify-end">
          {/* search */}
          <div className="w-full md:w-64">
            <Input
              placeholder="Search token…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search markets"
              className="h-9 text-sm"
            />
          </div>

          {/* sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            aria-label="Sort markets"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            title="Sort"
          >
            <option value="apy_desc">APY: High → Low</option>
            <option value="apy_asc">APY: Low → High</option>
            <option value="tvl_desc">TVL: High → Low</option>
            <option value="tvl_asc">TVL: Low → High</option>
          </select>
        </div>
      </div>

      <CardContent className="p-0">
        <div className="w-full overflow-x-auto">
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="min-w-[720px] text-xs sm:min-w-full sm:text-sm">
              <thead className="sticky top-0 z-10 bg-secondary/10 uppercase tracking-wide backdrop-blur dark:bg-white/5">
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Token</th>
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Chain</th>
                  <th className="px-3 py-2 text-left font-semibold md:px-4 md:py-3">Protocol</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">APY</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">TVL&nbsp;(USD)</th>
                  <th className="px-3 py-2 text-right font-semibold md:px-4 md:py-3">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-secondary/30">
                {/* loading */}
                {isLoading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="animate-pulse">
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-20 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-24 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 md:px-4 md:py-4"><div className="h-3 w-28 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-3 w-14 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-3 w-24 rounded bg-muted md:h-4" /></td>
                        <td className="px-3 py-3 text-right md:px-4 md:py-4"><div className="ml-auto h-7 w-20 rounded bg-muted md:h-8" /></td>
                      </tr>
                    ))}
                  </>
                )}

                {/* error */}
                {error && !isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-red-500 md:px-4">Failed to load yields</td>
                  </tr>
                )}

                {/* empty */}
                {!isLoading && !error && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground md:px-4">
                      No USDCe/USDT0 pool found on Lisk • Morpho Blue.
                    </td>
                  </tr>
                )}

                {/* data */}
                {!isLoading && !error && rows.map((snap) => (
                  <YieldRow key={snap.id} snap={snap} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!isLoading && !error && (
          <div className="flex items-center justify-between border-t px-3 py-3 text-[11px] text-muted-foreground md:px-4 md:text-xs">
            <span>Showing <strong>{rows.length}</strong> pool{rows.length === 1 ? '' : 's'}</span>
            <span className="hidden md:block">Lisk • Morpho Blue • USDCe &amp; USDT0.</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
