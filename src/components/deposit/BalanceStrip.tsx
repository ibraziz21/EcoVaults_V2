// src/components/BalanceStrip.tsx
'use client'

import { FC } from 'react'
import { formatUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { ChainPill } from './ui'

/** tiny formatter: tabular, up to 6 decimals, graceful for nulls */
function fmt(bn: bigint | null | undefined, decimals = 6) {
  if (bn == null) return '…'
  const asNum = Number(formatUnits(bn, decimals))
  if (!Number.isFinite(asNum)) return '0'
  return asNum.toLocaleString(undefined, {
    maximumFractionDigits: Math.min(6, decimals),
  })
}

export const BalanceStrip: FC<{
  tokenDecimals: number
  snap: YieldSnapshot
  isLiskTarget: boolean
  isUsdtFamily: boolean
  symbolForWalletDisplay: (
    s: YieldSnapshot['token'],
    c: 'optimism' | 'base' | 'lisk'
  ) => YieldSnapshot['token']
  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT: bigint | null
  liBalUSDT0: bigint | null
  /** OPTIONAL: extra source-asset balances for nicer UX when Lisk:USDT0 */
  opUsdcBal?: bigint | null
  baUsdcBal?: bigint | null
  opUsdtBal?: bigint | null
  baUsdtBal?: bigint | null
}> = ({
  tokenDecimals,
  snap,
  isLiskTarget,
  isUsdtFamily,
  symbolForWalletDisplay,
  opBal,
  baBal,
  liBal,
  liBalUSDT,
  liBalUSDT0,
  opUsdcBal,
  baUsdcBal,
  opUsdtBal,
  baUsdtBal,
}) => {
  const showDualForSource =
    isLiskTarget &&
    isUsdtFamily &&
    (opUsdcBal != null ||
      baUsdcBal != null ||
      opUsdtBal != null ||
      baUsdtBal != null)

  const Card: FC<{
    title: 'OP' | 'BASE' | 'LISK'
    tokenLabel: string
    children: React.ReactNode
  }> = ({ title, tokenLabel, children }) => (
    <div className="rounded-xl border bg-white p-3 sm:p-4">
      <div className="flex items-center justify-between">
        <ChainPill label={title} />
        <span className="text-[11px] text-muted-foreground">{tokenLabel}</span>
      </div>
      <div className="mt-2 tabular-nums">{children}</div>
    </div>
  )

  return (
    <div className="border-t bg-gray-50 p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* OP */}
        <Card
          title="OP"
          tokenLabel={symbolForWalletDisplay(snap.token, 'optimism')}
        >
          {showDualForSource ? (
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDC</dt>
                <dd className="font-semibold">{fmt(opUsdcBal, tokenDecimals)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDT</dt>
                <dd className="font-semibold">{fmt(opUsdtBal, tokenDecimals)}</dd>
              </div>
            </dl>
          ) : (
            <div className="text-lg font-semibold">
              {fmt(opBal, tokenDecimals)}
            </div>
          )}
        </Card>

        {/* Base */}
        <Card
          title="BASE"
          tokenLabel={symbolForWalletDisplay(snap.token, 'base')}
        >
          {showDualForSource ? (
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDC</dt>
                <dd className="font-semibold">{fmt(baUsdcBal, tokenDecimals)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDT</dt>
                <dd className="font-semibold">{fmt(baUsdtBal, tokenDecimals)}</dd>
              </div>
            </dl>
          ) : (
            <div className="text-lg font-semibold">
              {fmt(baBal, tokenDecimals)}
            </div>
          )}
        </Card>

        {/* Lisk */}
        <Card
          title="LISK"
          tokenLabel={symbolForWalletDisplay(snap.token, 'lisk')}
        >
          {isLiskTarget && isUsdtFamily ? (
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDT</dt>
                <dd className="font-semibold">{fmt(liBalUSDT, tokenDecimals)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">USDT0</dt>
                <dd className="font-semibold">{fmt(liBalUSDT0, tokenDecimals)}</dd>
              </div>
            </dl>
          ) : (
            <div className="text-lg font-semibold">
              {fmt(liBal, tokenDecimals)}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
