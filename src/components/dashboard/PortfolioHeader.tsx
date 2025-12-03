// src/components/PortfolioHeader.tsx
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
} from '@/components/ui/tooltip'
import { DUST_SHARES, type Position as BasePosition } from '@/lib/positions'
import { useQuery } from '@tanstack/react-query'
import { publicLisk } from '@/lib/clients'
import { SAFEVAULT, MORPHO_POOLS } from '@/lib/constants'
import { erc20Abi } from 'viem'

type PositionLike =
  | BasePosition
  | {
      protocol: string
      chain: string
      token: string
      amount: bigint
    }

// decimals for display of the underlying token amounts
const TOKEN_DECIMALS: Record<string, number> = {
  USDCe: 6,
  USDT0: 6,
  WETH: 18,
}

/* ──────────────────────────────────────────────────────────── */
/* SafeVault TVL (Morpho vault tokens held by SAFEVAULT)       */
/* ──────────────────────────────────────────────────────────── */

async function fetchSafeVaultTVL(): Promise<number> {
  // SAFE holds Morpho vault receipt tokens:
  // - MORPHO_POOLS['usdce-supply']
  // - MORPHO_POOLS['usdt0-supply']
  //
  // For now we treat 1 share ≈ 1 underlying stable (USDCe / USDT0),
  // so we display shares with 6 decimals to approximate USD value.
  const entries: { vault?: string; symbol: 'USDCe' | 'USDT0' }[] = [
    { vault: MORPHO_POOLS['usdce-supply'], symbol: 'USDCe' },
    { vault: MORPHO_POOLS['usdt0-supply'], symbol: 'USDT0' },
  ]

  let total = 0

  for (const { vault, symbol } of entries) {
    if (!vault) continue

    const bal = (await publicLisk.readContract({
      address: vault as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [SAFEVAULT as `0x${string}`],
    })) as bigint

    const decimals = 18
    const humanStr = formatAmountBigint(bal, decimals).replace(/,/g, '')
    const human = Number(humanStr) || 0
    total += human
  }

  return total
}

function useEcoVaultsTVL() {
  return useQuery<number>({
    queryKey: ['eco-vaults-tvl'],
    queryFn: fetchSafeVaultTVL,
    refetchInterval: 60_000, // refresh every 60s
  })
}

/* ──────────────────────────────────────────────────────────── */
/* Component                                                    */
/* ──────────────────────────────────────────────────────────── */

export const PortfolioHeader: FC = () => {
  const { data: positionsRaw } = usePositions()
  const { apy, loading, totalUsd } = usePortfolioApy()
  const { data: ecoTvlUsd, isLoading: tvlLoading } = useEcoVaultsTVL()

  const positions = useMemo(
    () => (positionsRaw ?? []) as unknown as PositionLike[],
    [positionsRaw],
  )

  // Active positions = same semantics as MyPositions (Morpho Blue on Lisk, > dust)
  const activePositions = useMemo(
    () =>
      positions.filter((p) => {
        if (p.protocol !== 'Morpho Blue') return false
        if (p.chain !== 'lisk') return false
        const amt = (p as any).amount as bigint | undefined
        if (typeof amt !== 'bigint') return false
        return amt > DUST_SHARES
      }),
    [positions],
  )

  // 🔢 Derive "My Deposits" directly from active positions (USDCe/USDT0 sVault-style).
  // For now, we treat 1 USDCe/USDT0 ≈ 1 USD and ignore WETH here.
  const myDepositsUsd = useMemo(() => {
    return activePositions.reduce((sum, p) => {
      const amt = (p as any).amount as bigint | undefined
      if (typeof amt !== 'bigint') return sum

      const symbol = String((p as any).token)
      if (symbol === 'WETH') {
        // No price feed wired here → skip WETH from "My Deposits" for now
        return sum
      }

      const decimals = TOKEN_DECIMALS[symbol] ?? 6
      const humanStr = formatAmountBigint(amt, decimals).replace(/,/g, '')
      const human = Number(humanStr) || 0

      return sum + human
    }, 0)
  }, [activePositions])

  // totalUsd comes as a USD value scaled to 18 decimals (bigint or decimal string).
  // Still used for APY + yield projections.
  const totalNum = useMemo<number>(() => {
    try {
      if (typeof totalUsd === 'bigint') {
        const human = formatAmountBigint(totalUsd, 18)
        return Number(human)
      }
      if (typeof totalUsd === 'string') {
        const human = formatAmountBigint(BigInt(totalUsd), 18)
        return Number(human)
      }
      if (typeof totalUsd === 'number') {
        return totalUsd
      }
    } catch {}
    return 0
  }, [totalUsd])

  const kpis = useMemo(() => {
    const total = totalNum
    const daily = loading ? null : rewardForecast(total, apy).daily
    const weekly = loading ? null : rewardForecast(total, apy).weekly
    const yearly = loading ? null : rewardForecast(total, apy).yearly
    const count = activePositions.length
    return { total, daily, yearly, apy, count, weekly }
  }, [totalNum, apy, loading, activePositions])

  return (
    <TooltipProvider>
      <div className="bg-white my-4 rounded-xl max-w-6xl mx-auto min-h-[216px] p-5 flex flex-col justify-around">
        <h3 className="font-semibold text-base md:text-lg">Overview</h3>
        <div className="mx-auto grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* My Deposits → derived from user’s sVault-style positions */}
          <Kpi
            title="My Deposits"
            value={`$${myDepositsUsd.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}`}
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
                : `$${kpis.weekly.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}`
            }
            sub="at current APY"
          />
          {/* Eco Vaults TVL → Morpho vault token balances in SafeVault */}
          <Kpi
            title="Eco Vaults TVL"
            value={
              tvlLoading || ecoTvlUsd == null
                ? '—'
                : `$${ecoTvlUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}`
            }
            sub=''
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

const Kpi = ({
  title,
  value,
  sub,
}: {
  title: string
  value: string
  sub?: string
}) => (
  <Card className="rounded-2xl border-[1.5px] border-[#E5E7EB] bg-white shadow-none">
    <CardContent className="space-y-1 p-4 md:p-5 flex flex-col justify-around max-h-[132px]">
      <p className="text-[14px] font-normal text-[#4B5563] flex items-center">
        {title}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-2">
              <InfoIcon weight="bold" size={16} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">
              {title === 'My Deposits' &&
                'Total value of your assets currently deposited across all active vaults (based on your sVault receipts). Updated in real time.'}
              {title === 'Average APY' &&
                'Weighted average Annual Percentage Yield across all your deposited vaults. Based on current market rates.'}
              {title === 'Est. Weekly Yield' &&
                'Estimated earnings for the next 7 days at current APY. Actual returns may vary.'}
              {title === 'Eco Vaults TVL' &&
                'Total Value Locked in all Eco Vaults held in the SuperYLDR Safe on Lisk (Morpho vault shares). Reflects overall adoption and trust in the strategy.'}
            </p>
          </TooltipContent>
        </Tooltip>
      </p>
      <p className="text-2xl font-medium break-words">{value}</p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-1 whitespace-nowrap">
          {sub}
        </p>
      )}
    </CardContent>
  </Card>
)
