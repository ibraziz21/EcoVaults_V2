'use client'
import { usePositions }    from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast }  from '@/lib/rewardForecast'
import { Loader2 }         from 'lucide-react'

import { StatCard }        from '@/components/PositionsDashboard'

export const PositionsGrid = () => {
  /* ----- data hooks ----- */
  const { data: positions, isLoading } = usePositions()
  const {
    apy: portfolioApy,
    loading: apyLoading,
    totalUsd,
  } = usePortfolioApy()

  const forecast = !apyLoading ? rewardForecast(totalUsd!, portfolioApy) : null

  /* ----- loading / empty states ----- */
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-6 py-10">
        <Loader2 className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Fetching on-chain balances…
        </p>
      </div>
    )
  }

  if (!positions || positions.length === 0) {
    return (
      <p className="text-center text-sm opacity-60">No active positions.</p>
    )
  }

  /* ----- UI ----- */
  return (
    <div className="space-y-12 mx-auto w-full max-w-6xl">
      {/* headline stats */}
      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Total Supplied"
          value={`$${totalUsd!.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}`}
        />

        <StatCard
          title="Total APY"
          value={apyLoading ? '—' : `${portfolioApy.toFixed(2)} %`}
          sub={apyLoading ? 'fetching…' : undefined}
        />

        <StatCard
          title="Forecast (yr)"
          value={
            apyLoading
              ? '—'
              : `≈ $${forecast!.yearly.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}`
          }
          sub="at current APY"
        />
      </div>

      {/* ---- your existing position cards go here ---- */}
      {/* e.g. <PositionsDashboardCards positions={positions} /> */}
    </div>
  )
}
