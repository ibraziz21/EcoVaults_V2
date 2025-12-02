// src/components/PositionsDashboard.tsx
'use client'

import { FC, useMemo } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { rewardForecast } from '@/lib/rewardForecast'

import { Card, CardContent } from '@/components/ui/Card'
import { Loader2 } from 'lucide-react'

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

import type { Position } from '@/lib/positions'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import { useYields } from '@/hooks/useYields'

/* ──────────────────────────────────────────────────────────────── */
/* Helpers (Morpho Lisk only)                                       */
/* ──────────────────────────────────────────────────────────────── */

const PIE_COLORS = ['#16a34a', '#7c3aed', '#f97316', '#38bdf8', '#ef4444']

/** Morpho Blue on Lisk:
 *  - WETH: 18 decimals
 *  - USDCe / USDT0: 6 decimals
 */
function decimalsFor(p: Position): number {
  return p.token === 'WETH' ? 18 : 6
}

/** bigint -> number using decimals */
const bnToNum = (bn: bigint, decimals: number) => Number(bn) / 10 ** decimals

/* ──────────────────────────────────────────────────────────────── */
/* Main Dashboard (Morpho Lisk only)                                */
/* ──────────────────────────────────────────────────────────────── */

export const PositionsDashboard: FC = () => {
  const { data, isLoading } = usePositions()

  // Filter to Morpho Blue on Lisk only
  const morphoLisk = useMemo(
    () => (data ?? []).filter((p) => p.protocol === 'Morpho Blue' && p.chain === 'lisk'),
    [data],
  )

  // Aggregate totals & pie data (Morpho only)
  const { totalSupplied, protocolTotals, pieData } = useMemo(() => {
    if (!morphoLisk.length) {
      return {
        totalSupplied: 0,
        protocolTotals: {} as Record<string, number>,
        pieData: [] as { name: string; value: number }[],
      }
    }
    const totals: Record<string, number> = {}
    let sum = 0
    for (const p of morphoLisk) {
      const dec = decimalsFor(p)
      const num = bnToNum(p.amount, dec)
      totals[p.protocol] = (totals[p.protocol] ?? 0) + num
      sum += num
    }
    return {
      totalSupplied: sum,
      protocolTotals: totals,
      pieData: Object.entries(totals).map(([name, value]) => ({ name, value })),
    }
  }, [morphoLisk])

  /* Loading / empty */
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-6 py-10">
        <Loader2 className="animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Fetching on-chain balances…</p>
      </div>
    )
  }

  if (morphoLisk.length === 0) {
    return <p className="text-center text-sm opacity-60">No Morpho positions on Lisk.</p>
  }

  /* UI */
  return (
    <div className="space-y-12">
      {/* headline stats (Morpho Lisk only) */}
      <div className="grid gap-6 sm:grid-cols-3">
        <StatCard
          title="Total Supplied"
          value={`$${totalSupplied.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}`}
          sub="Morpho Blue · Lisk"
        />
        <StatCard
          title="Total APY"
          value="—"
          sub="Shown per asset"
        />
        <StatCard
          title="Forecast (yr)"
          value="—"
          sub="at current APY"
        />
      </div>

      {/* protocol allocation pie (will be one slice for Morpho Blue) */}
      <Card className="p-6">
        <CardContent className="flex flex-col items-center">
          <h3 className="mb-4 text-sm font-medium text-muted-foreground">
            Protocol allocation (Morpho · Lisk)
          </h3>
          <div className="h-64 w-full max-w-md">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={100}
                  paddingAngle={4}
                  strokeWidth={0}
                >
                  {pieData.map((_, idx) => (
                    <Cell key={`cell-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) =>
                    `$${v.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}`
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* per-protocol breakdown (Morpho Blue / Lisk) */}
      <div className="space-y-8">
        {Object.entries(protocolTotals).map(([protocol]) => (
          <div key={protocol} className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">{protocol}</h3>
            <p className="text-sm text-muted-foreground">
              $
              {protocolTotals[protocol].toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}{' '}
              supplied
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {morphoLisk
                .filter((p) => p.protocol === protocol)
                .map((p, idx) => (
                  <AssetCard key={idx} p={p} onSupply={() => {}} onWithdraw={() => {}} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────── */
/* Sub-components                                                   */
/* ──────────────────────────────────────────────────────────────── */

interface StatProps {
  title: string
  value: string
  sub?: string
}
export const StatCard: FC<StatProps> = ({ title, value, sub }) => (
  <Card className="rounded-2xl bg-card p-6">
    <CardContent className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="text-3xl font-extrabold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </CardContent>
  </Card>
)

interface AssetCardProps {
  p: Position
  onSupply?: (p: Position) => void
  onWithdraw?: (p: Position) => void
}

const AssetCard: FC<AssetCardProps> = ({ p, onSupply, onWithdraw }) => {
  const { yields } = useYields()
  const decimals = decimalsFor(p)
  const amt = formatUnits(p.amount, decimals)

  // Morpho–Lisk APY from yields (token must match: USDCe | USDT0 | WETH)
  const apy =
    yields?.find(
      (y) =>
        y.protocolKey === 'morpho-blue' &&
        y.chain === 'lisk' &&
        y.token === p.token
    )?.apy ?? null

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-secondary/10 p-5 backdrop-blur-sm">
      <span className="pointer-events-none absolute inset-0 rounded-2xl border border-primary/20" />
      <CardContent className="z-10 flex flex-col gap-1">
        <span className="text-xs uppercase text-muted-foreground">{p.chain}</span>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tracking-tight">{amt}</span>
          <span className="font-semibold">{p.token}</span>
        </div>
        {typeof apy === 'number' ? (
          <span className="text-xs text-primary/80">{apy.toFixed(2)}% APY</span>
        ) : (
          <span className="text-xs text-muted-foreground">APY —</span>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500"
            onClick={() => onSupply?.(p)}
            disabled={!onSupply}
            title={onSupply ? 'Supply' : 'Supply (unavailable)'}
          >
            Supply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onWithdraw?.(p)}
            disabled={!onWithdraw}
            title={onWithdraw ? 'Withdraw' : 'Withdraw (unavailable)'}
          >
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
