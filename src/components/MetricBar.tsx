/* components/dashboard/MetricBar.tsx */
'use client'

import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'
import { DollarSign, LineChart, Coins } from 'lucide-react'
import { ReactNode } from 'react'

export function MetricBar() {
  const { totalUsd, apy, loading } = usePortfolioApy()
  if (totalUsd == undefined) return
  const forecast = !loading ? rewardForecast(totalUsd, apy) : null

  

  const metrics = [
    {
      icon: <DollarSign size={16} />,
      label: 'Supplied',
      value: loading ? '—' : `$${totalUsd.toLocaleString()}`,
    },
    {
      icon: <LineChart size={16} />,
      label: 'APY',
      value: loading ? '—' : `${apy.toFixed(2)} %`,
    },
    forecast && {
      icon: <Coins size={16} />,
      label: 'Forecast /yr',
      value: `≈ $${forecast.yearly.toFixed(2)}`,
      tooltip: `≈ $${forecast.daily.toFixed(2)} per day`,
    },
  ].filter(Boolean) as {
    icon: ReactNode
    label: string
    value: string
    tooltip?: string
  }[]

  return (
    <div className="flex flex-wrap gap-4 mx-auto w-full max-w-[1392px]">
    {metrics.map((m, i) => (
      <div
        key={i}
        className="flex min-w-[160px] flex-1 items-center gap-3 rounded-xl bg-white/75
                   px-4 py-3 shadow-sm ring-1 ring-black/5 backdrop-blur-md
                   dark:bg-white/5 dark:ring-white/10"
      >
        <span className="text-teal-600 dark:text-teal-300">{m.icon}</span>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {m.label}
          </span>
          <span className="text-base font-semibold">{m.value}</span>
        </div>
      </div>
    ))}
  </div>
  
  )
}
