'use client'

import { FC, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { usePositions } from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { rewardForecast } from '@/lib/rewardForecast'
import { formatAmountBigint } from '@/components/tables/MyPositionsTable/MyPositions'
import { InfoIcon } from '@phosphor-icons/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export const PortfolioHeader: FC = () => {
  const { data: positions } = usePositions()
  const { apy, loading, totalUsd } = usePortfolioApy()

  // totalUsd comes as 18-decimals (bigint or decimal string). Convert ONCE to a number.
  const totalNum = useMemo<number>(() => {
    try {
      if (typeof totalUsd === 'bigint') {
        return Number(formatAmountBigint(totalUsd, 18) ?? 0)
      }
      if (typeof totalUsd === 'string') {
        return Number(formatAmountBigint(BigInt(totalUsd), 18) ?? 0)
      }
      if (typeof totalUsd === 'number') {
        return totalUsd
      }
    } catch {}
    return 0
  }, [totalUsd])

  const kpis = useMemo(() => {
    const total = totalUsd ?? 0
    const daily = loading ? null : rewardForecast(total, apy).daily
    const weekly = loading ? null : rewardForecast(total, apy).weekly
    const yearly = loading ? null : rewardForecast(total, apy).yearly
    const count = positions?.length ?? 0
    return { total, daily, yearly, apy, count, weekly }
  }, [totalUsd, apy, loading, positions])

  return (
    <TooltipProvider>
      <div className="bg-white my-4 rounded-xl max-w-6xl mx-auto min-h-[216px] p-5 flex flex-col justify-around">
        <h3 className='font-semibold text-base md:text-lg'>Overview</h3>
        <div className="mx-auto grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi title="My Deposits" value={
            kpis.total ? `$${kpis.total.toLocaleString(undefined,{maximumFractionDigits:2})}` : '—'
          } />
          <Kpi title="Average APY" value={loading ? '—' : `${kpis.apy.toFixed(2)}%`} />
          <Kpi title="Est. Weekly Yield" value={
            loading || kpis.weekly == null ? '—' : `$${kpis.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          } sub="at current APY" />
          <Kpi title="Est. Annual Yield" value={
            loading || kpis.yearly == null ? '—' : `$${kpis.yearly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          } sub={`${kpis.count} position${kpis.count===1?'':'s'}`} />
        </div>
      </div>
    </TooltipProvider>
  )
}

const Kpi = ({ title, value, sub }: { title: string; value: string; sub?: string }) => (
  <Card className="rounded-2xl border-[1.5px] border-[#E5E7EB] bg-white shadow-none">
    <CardContent className="space-y-1 p-4 md:p-5 flex flex-col justify-around max-h-[132px]">
      <p className="text-[14px] font-normal text-[#4B5563] flex items-center">
        {title}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-2">
              <InfoIcon weight='bold' size={16} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">
              {title === "My Deposits" && "Total value of your assets currently deposited across all active vaults. Updated in real time."}
              {title === "Average APY" && "Weighted average Annual Percentage Yield across all your deposited vaults. Based on current market rates."}
              {title === "Est. Weekly Yield" && "Estimated earnings for the next 7 days at current APY. Actual returns may vary."}
              {title === "Est. Annual Yield" && "Projected earnings over a year at current APY. Compounding not included. Subject to market fluctuations."}
            </p>
          </TooltipContent>
        </Tooltip>
      </p>
      <p className="text-2xl font-medium break-words">{value}</p>
    </CardContent>
  </Card>
)