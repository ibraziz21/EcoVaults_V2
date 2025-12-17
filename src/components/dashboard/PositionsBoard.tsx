// src/components/dashboard/PositionsBoard.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { usePositions } from '@/hooks/usePositions'
import { useYields } from '@/hooks/useYields'
import { formatUnits } from 'viem'

type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'

export const PositionsBoard: FC<{
  onDeposit?: (p: any) => void
  onWithdraw?: (p: any) => void
}> = ({ onDeposit, onWithdraw }) => {
  const { data } = usePositions()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  // Only Morpho Blue positions (Lisk)
  const morphoItems = useMemo(
    () => (data ?? []).filter((p) => p.protocol === 'Morpho Blue'),
    [data],
  )

  if (morphoItems.length === 0) return null

  const id = 'sec-morpho'
  const isOpen = open[id] ?? true

  return (
    <div className="mx-auto w-full max-w-[1392px] space-y-6">
      <section className="space-y-3">
        <header className="flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h3 className="text-lg font-semibold tracking-tight">Morpho Blue</h3>
            <span className="text-sm text-muted-foreground">
              {morphoItems.length} {morphoItems.length === 1 ? 'position' : 'positions'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen((o) => ({ ...o, [id]: !isOpen }))}
              title=""
            >
              {isOpen ? 'Collapse' : 'Expand'}
            </Button>
          </div>
        </header>

        {isOpen && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {morphoItems.map((p: any, i: number) => (
              <PositionCard
                key={i}
                p={p}
                onDeposit={onDeposit}
                onWithdraw={onWithdraw}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

const PositionCard: FC<{
  p: { protocol: 'Morpho Blue'; chain: 'lisk'; token: MorphoToken; amount: bigint }
  onDeposit?: (p: any) => void
  onWithdraw?: (p: any) => void
}> = ({ p, onDeposit, onWithdraw }) => {
  const { yields } = useYields()

  const decimals = p.token === 'WETH' ? 18 : 6
  const amount = formatUnits(p.amount, decimals)

  // APY from snapshots: Morpho Blue on Lisk maps USDCe→USDC, USDT0→USDT
  const apyToken = p.token === 'USDCe' ? 'USDC' : p.token === 'USDT0' ? 'USDT' : 'WETH'
  const apy = useMemo(
    () =>
      yields?.find(
        (y) =>
          y.protocolKey === 'morpho-blue' &&
          y.chain === 'lisk' &&
          y.token === (apyToken as any),
      )?.apy,
    [yields, apyToken],
  )

  return (
    <Card className="rounded-2xl border bg-secondary/10 p-4">
      <CardContent className="space-y-2 p-0">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold">{amount}</span>
            <span className="font-semibold">{p.token}</span>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[11px] uppercase">{p.chain}</span>
        </div>

        <div className="text-xs text-muted-foreground">Morpho Blue</div>

        <div className="text-xs">
          {typeof apy === 'number' ? (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-700">
              {apy.toFixed(2)}% APY
            </span>
          ) : (
            <span className="text-muted-foreground">APY —</span>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500"
            onClick={() => onDeposit?.(p)}
            title="Deposit"
          >
            Deposit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onWithdraw?.(p)}
            title="Withdraw"
          >
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
