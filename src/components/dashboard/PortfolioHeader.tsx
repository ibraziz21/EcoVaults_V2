'use client'

import { FC, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { usePositions } from '@/hooks/usePositions'
import { usePortfolioApy } from '@/hooks/usePortfolioApy'
import { useYields } from '@/hooks/useYields'
import { rewardForecast } from '@/lib/rewardForecast'
import InfoIcon from "../../../public/info-icon.svg"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import Image from 'next/image'
import { formatUnits } from 'viem'

type ReceiptPosition = {
  protocol?: string
  chain?: string
  token?: 'USDC' | 'USDT'
  amount?: bigint
}

export const PortfolioHeader: FC = () => {
  const { data: positions } = usePositions()
  const { apy, loading } = usePortfolioApy()
  const { yields } = useYields()

  /* ────────────────────────────────────────────────
     My Deposits (OP receipt shares, 6 decimals)
  ──────────────────────────────────────────────── */
  const totalDepositsUsd = useMemo<number>(() => {
    try {
      const rows = (positions ?? []) as ReceiptPosition[]

      const totalShares6 = rows.reduce((acc, p) => {
        if (p?.protocol !== 'sVault Receipt') return acc
        if (String(p?.chain).toLowerCase() !== 'optimism') return acc
        if (typeof p?.amount !== 'bigint') return acc
        return acc + p.amount
      }, 0n)

      return Number(formatUnits(totalShares6, 6)) || 0
    } catch {
      return 0
    }
  }, [positions])

  /* ────────────────────────────────────────────────
     Weighted APY fallback from receipt balances
  ──────────────────────────────────────────────── */
  const weightedApyFromReceipts = useMemo<number>(() => {
    if (!yields || !positions) return 0

    let usdcWeight = 0
    let usdtWeight = 0

    for (const p of positions as ReceiptPosition[]) {
      if (
        p?.protocol !== 'sVault Receipt' ||
        String(p?.chain).toLowerCase() !== 'optimism' ||
        typeof p?.amount !== 'bigint'
      ) continue

      const usd = Number(formatUnits(p.amount, 6))
      if (!Number.isFinite(usd) || usd <= 0) continue

      if (p.token === 'USDC') usdcWeight += usd
      if (p.token === 'USDT') usdtWeight += usd
    }

    const total = usdcWeight + usdtWeight
    if (total === 0) return 0

    const usdcApy =
      yields.find(
        (y) =>
          y.protocolKey === 'morpho-blue' &&
          y.chain === 'lisk' &&
          y.token === 'USDC',
      )?.apy ?? 0

    const usdtApy =
      yields.find(
        (y) =>
          y.protocolKey === 'morpho-blue' &&
          y.chain === 'lisk' &&
          y.token === 'USDT',
      )?.apy ?? 0

    return (usdcWeight * usdcApy + usdtWeight * usdtApy) / total
  }, [positions, yields])

  /* ────────────────────────────────────────────────
     Final KPI wiring
  ──────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const effectiveApy =
      !loading && Number.isFinite(apy) && apy > 0
        ? apy
        : weightedApyFromReceipts

    const total = totalDepositsUsd
    const daily = loading ? null : rewardForecast(total, effectiveApy).daily
    const weekly = loading ? null : rewardForecast(total, effectiveApy).weekly
    const yearly = loading ? null : rewardForecast(total, effectiveApy).yearly
    const count = positions?.length ?? 0

    return {
      total,
      daily,
      weekly,
      yearly,
      apy: effectiveApy,
      count,
    }
  }, [totalDepositsUsd, apy, weightedApyFromReceipts, loading, positions])

  return (
    <TooltipProvider>
      <div className="bg-white my-4 rounded-xl max-w-[1392px] mx-auto min-h-[216px] p-5 flex flex-col justify-around">
        <h3 className='font-semibold text-base md:text-lg'>Overview</h3>
        <div className="mx-auto grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            title="My Deposits"
            value={
              kpis.total
                ? `$${kpis.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                : '—'
            }
          />
          <Kpi
            title="Average APY"
            value={loading ? '—' : `${kpis.apy.toFixed(2)}%`}
          />
          <Kpi
            title="Est. Weekly Yield"
            value={
              loading || kpis.weekly == null
                ? '—'
                : `$${kpis.weekly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            }
            sub="at current APY"
          />
          <Kpi
            title="Est. Annual Yield"
            value={
              loading || kpis.yearly == null
                ? '—'
                : `$${kpis.yearly.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
            }
            sub={`${kpis.count} position${kpis.count === 1 ? '' : 's'}`}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

const Kpi = ({ title, value, sub }: { title: string; value: string; sub?: string }) => (
  <Card className="rounded-2xl border-[1.5px] border-[#E5E7EB] bg-white shadow-none">
    <CardContent className="space-y-1 p-4 md:p-5 flex flex-col justify-around max-h-[132px]">
      <p className="text-[14px] font-normal text-[#4B5563] flex items-center mb-[40px]">
        {title}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-2">
              <Image src={InfoIcon} alt="" />
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
