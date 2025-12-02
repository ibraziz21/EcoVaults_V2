'use client'
import { FC } from 'react'
import { RefreshCw } from 'lucide-react'
import { formatUnits } from 'viem'

export const SuppliedCard: FC<{
  poolOp: bigint | null
  poolBa: bigint | null
  poolDecimals: number
  tokenSymbol: string
}> = ({ poolOp, poolBa, poolDecimals, tokenSymbol }) => {
  const sum = (poolOp ?? 0n) + (poolBa ?? 0n)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <RefreshCw className="h-4 w-4" /> Current supplied
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Optimism</div>
          <div className="text-base font-semibold">{poolOp != null ? formatUnits(poolOp, poolDecimals) : '…'} {tokenSymbol}</div>
        </div>
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Base</div>
          <div className="text-base font-semibold">{poolBa != null ? formatUnits(poolBa, poolDecimals) : '…'} {tokenSymbol}</div>
        </div>
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Total</div>
          <div className="text-base font-semibold">{poolOp == null && poolBa == null ? '…' : `${formatUnits(sum, poolDecimals)} ${tokenSymbol}`}</div>
        </div>
      </div>
    </div>
  )
}