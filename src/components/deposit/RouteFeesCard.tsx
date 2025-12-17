// src/components/RouteFeesCard.tsx
'use client'
import { FC } from 'react'
import { ShieldCheck, ArrowRight, AlertTriangle } from 'lucide-react'
import { ChainPill, StatRow } from './ui'
import { formatUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'

export const RouteFeesCard: FC<{
  route: string | null
  fee: bigint
  received: bigint
  tokenDecimals: number
  tokenSymbol: string
  quoteError: string | null
  destChainLabel: string
  destTokenLabel: YieldSnapshot['token']
  /** NEW: show the *selected* source asset (USDC/USDT) for clarity */
  sourceAsset?: 'USDC' | 'USDT'
}> = ({ route, fee, received, tokenDecimals, tokenSymbol, quoteError, destChainLabel, destTokenLabel, sourceAsset }) => {
  // derive source chain badge from route if present
  const sourceChainLabel = (route?.split('→')?.[0] ?? '').trim().toUpperCase() || 'OP'

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4" />
          Routing via LI.FI bridge
        </div>
        {route && route !== 'On-chain' ? (
          <span className="inline-flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded-md bg-gray-100 px-2 py-1">Bridging via LI.FI</span>
          </span>
        ) : (
          <span className="text-xs text-gray-500">On-chain</span>
        )}
      </div>

      {/* Pretty route line */}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <ChainPill label={sourceChainLabel} subtle />
        <ArrowRight className="h-4 w-4 text-gray-400" />
        <ChainPill label={destChainLabel} subtle />
        <span className="ml-auto text-xs text-gray-500">
          {sourceAsset ? `${sourceAsset} → ${destTokenLabel}` : `${tokenSymbol} → ${destTokenLabel}`}
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        {fee > 0n && (
          <StatRow
            label="Bridge fee"
            value={`${formatUnits(fee, tokenDecimals)} ${sourceAsset ?? tokenSymbol}`}
          />
        )}
        <StatRow
          label="Will deposit"
          value={`${formatUnits(received, tokenDecimals)} ${destTokenLabel}`}
          emphasize
        />
        {quoteError && (
          <div className="text-xs text-red-600 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {quoteError}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-gray-500">
        Funds arrive as <span className="font-medium">{destTokenLabel}</span> on {destChainLabel}.
      </div>
    </div>
  )
}
