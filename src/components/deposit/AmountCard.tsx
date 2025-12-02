// src/components/AmountCard.tsx
'use client'
import { FC } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { ChainPill } from './ui'
import type { EvmChain } from './types'


type DestToken =
  | 'USDC'
  | 'USDT'
  | 'USDCe'
  | 'USDT0'
  | 'WETH'



interface Props {
  amount: string
  setAmount: (v: string) => void
  tokenDecimals: number
  snap: YieldSnapshot
  isLiskTarget: boolean
  destTokenLabel: DestToken // <- widen type to include USDCe/USDT0
  isUsdtFamily: boolean
  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT: bigint | null
  liBalUSDT0: bigint | null
  sourceAsset?: 'USDC' | 'USDT'
  opUsdcBal?: bigint | null
  baUsdcBal?: bigint | null
  opUsdtBal?: bigint | null
  baUsdtBal?: bigint | null
}

export const AmountCard: FC<Props> = ({
  amount, setAmount, tokenDecimals, snap, isLiskTarget, destTokenLabel, isUsdtFamily,
  opBal, baBal, liBal, liBalUSDT, liBalUSDT0,
  sourceAsset,
  opUsdcBal, baUsdcBal, opUsdtBal, baUsdtBal,
}) => {
  const max = () => {
    const dec = tokenDecimals

    // If bridging to Lisk:USDT0, MAX should reflect the chosen source asset (USDC/USDT) on OP/Base,
    // but still consider existing balances on Lisk (USDT/USDT0) if they’re larger.
    if (isLiskTarget && destTokenLabel === 'USDT0') {
      // Lisk-side possible max (USDT or USDT0 if present)
      const liskSideMax = (() => {
        if (isUsdtFamily) {
          const a = liBalUSDT ?? 0n
          const b = liBalUSDT0 ?? 0n
          return a > b ? a : b
        }
        return liBal ?? 0n
      })()

      // OP/Base-side possible max for the chosen source asset
      const opBaseSide = (() => {
        if (sourceAsset === 'USDC') {
          const a = opUsdcBal ?? 0n
          const b = baUsdcBal ?? 0n
          return a > b ? a : b
        } else {
          const a = opUsdtBal ?? 0n
          const b = baUsdtBal ?? 0n
          return a > b ? a : b
        }
      })()

      const best = opBaseSide > liskSideMax ? opBaseSide : liskSideMax
      return formatUnits(best, dec)
    }

    // Non-USDT0 on Lisk
    if (isLiskTarget && destTokenLabel !== 'USDT0') {
      return formatUnits(liBal ?? 0n, dec)
    }

    // OP/Base single-asset case (keep original behavior)
    const a = opBal ?? 0n
    const b = baBal ?? 0n
    return formatUnits(a > b ? a : b, dec)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">Amount</div>
          <div className="flex items-center gap-2">
            <ChainPill label={(snap.chain as string).toUpperCase()} subtle />
            <span className="text-[11px] text-gray-500">Destination token: {destTokenLabel}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <Input
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[.,]?[0-9]*"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
            className="h-12 text-2xl font-bold border-0 bg-gray-50 focus-visible:ring-0"
            autoFocus
          />
          <span className="text-gray-600 font-semibold">{snap.token}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAmount('')} title={'Clear'}>Clear</Button>
          <Button variant="outline" size="sm" onClick={() => setAmount(max() === '0' ? '' : max())} title={'Max'}>MAX</Button>
        </div>
      </div>
    </div>
  )
}
