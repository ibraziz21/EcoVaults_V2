// src/components/TopYields.tsx
'use client'

import { FC, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'
import { Loader2, TriangleAlert } from 'lucide-react'
import { useYields } from '@/hooks/useYields'

type Props = {
  /** Max markets to show */
  limit?: number
}

/** Pretty % with 2 dp, safe on nullish */
function pct(n?: number | null) {
  const v = typeof n === 'number' ? n : 0
  return `${v.toFixed(2)}%`
}

/** Format USD compactly (e.g., 12.3M) */
function usd(n?: number | null) {
  const v = typeof n === 'number' ? n : 0
  return v.toLocaleString(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

/** Tailwind classes for APY “heat” */
function apyClasses(apy?: number | null) {
  const v = typeof apy === 'number' ? apy : 0
  if (v >= 10) return 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300'
  if (v >= 5)  return 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
  if (v >= 2)  return 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300'
  return 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300'
}

/** Subtle colored chip per chain */
function chainChipStyles(chain: string) {
  switch (chain) {
    case 'optimism':
    case 'Optimism':
      return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
    case 'base':
    case 'Base':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    case 'lisk':
    case 'Lisk':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300'
  }
}

/** Protocol chip styles */
function protocolChipStyles(protocol: string) {
  if (/aave/i.test(protocol))     return 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
  if (/compound/i.test(protocol)) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  if (/morpho/i.test(protocol))   return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'
  return 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300'
}

/** Compact, high-polish markets preview for the Dashboard */
export const TopYields: FC<Props> = ({ limit = 6 }) => {
  const { yields, isLoading, error } = useYields()

  const rows = useMemo(() => {
    if (!yields) return []
    return yields
      .slice()
      .sort((a, b) => (b.apy ?? 0) - (a.apy ?? 0))
      .slice(0, limit)
  }, [yields, limit])

  const maxTVL = useMemo(() => {
    if (!rows.length) return 0
    return Math.max(...rows.map((r) => r.tvlUSD ?? 0))
  }, [rows])

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Loading skeletons */}
      {isLoading &&
        Array.from({ length: limit }).map((_, i) => (
          <Card
            key={`sk-${i}`}
            className="overflow-hidden rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none ring-1 ring-black/5 backdrop-blur-md dark:bg-white/5 dark:ring-white/10"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="h-5 w-24 rounded bg-muted animate-pulse" />
                <div className="h-6 w-16 rounded-full bg-muted animate-pulse" />
              </div>
              <div className="mt-2 h-4 w-20 rounded bg-muted animate-pulse" />
              <div className="mt-4 h-3 w-full rounded bg-muted animate-pulse" />
              <div className="mt-5 flex items-center justify-between">
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                <div className="h-9 w-28 rounded-lg bg-muted animate-pulse" />
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Error state */}
      {!isLoading && error && (
        <div className="col-span-full">
          <Card className="rounded-2xl">
            <CardContent className="flex items-center gap-3 p-5 text-red-600">
              <TriangleAlert className="h-5 w-5" />
              Failed to load markets. Please try again.
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && rows.length === 0 && (
        <div className="col-span-full">
          <Card className="rounded-2xl">
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No markets found.
            </CardContent>
          </Card>
        </div>
      )}

      {/* Data cards */}
      {!isLoading &&
        !error &&
        rows.map((snap) => {
          const apy = snap.apy ?? 0
          const tvl = snap.tvlUSD ?? 0
          const tvlPct = maxTVL > 0 ? Math.max(0.04, tvl / maxTVL) : 0 // ensure visible
          const href = `/positions?chain=${encodeURIComponent(
            snap.chain,
          )}&protocol=${encodeURIComponent(snap.protocol)}&token=${encodeURIComponent(
            snap.token,
          )}`

          return (
            <Card
              key={snap.id}
              className="group overflow-hidden rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none transition hover:-translate-y-0.5 "
            >
              <CardContent className="p-5">
                {/* Top row: token + chips + APY pill */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-base font-semibold">
                        {snap.token}
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chainChipStyles(
                          snap.chain,
                        )}`}
                      >
                        {snap.chain}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${protocolChipStyles(
                          snap.protocol,
                        )}`}
                      >
                        {snap.protocol}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Pool: {snap.poolAddress.slice(0, 6)}…{snap.poolAddress.slice(-4)}
                    </div>
                  </div>

                  <div
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${apyClasses(
                      apy,
                    )}`}
                    title={`${apy.toFixed(4)}% APY`}
                  >
                    {pct(apy)}
                  </div>
                </div>

                {/* TVL bar */}
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>TVL</span>
                    <span className="font-medium text-foreground">${usd(tvl)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted/60">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-teal-500 to-cyan-500 transition-[width]"
                      style={{ width: `${Math.min(100, tvlPct * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Footer actions */}
                <div className="mt-5 flex items-center justify-between">
                  <div className="text-[11px] text-muted-foreground">
                    Updated {new Date(snap.updatedAt).toLocaleTimeString()}
                  </div>
                  <Link
                    href={href}
                    className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-0"
                  >
                    Open market
                  </Link>
                </div>
              </CardContent>

              {/* Accent gradient on hover */}
              <div className="pointer-events-none absolute inset-x-0 -bottom-10 h-20 translate-y-1/3 bg-gradient-to-r from-teal-500/0 via-teal-500/10 to-cyan-500/0 opacity-0 blur-2xl transition group-hover:opacity-100" />
            </Card>
          )
        })}
    </div>
  )
}
