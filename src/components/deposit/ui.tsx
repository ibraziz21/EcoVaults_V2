'use client'
import { FC } from 'react'
import { Network } from 'lucide-react'

export const ChainPill: FC<{ label: string; active?: boolean; subtle?: boolean }> = ({ label, active, subtle }) => (
  <span
    className={[
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
      active ? 'bg-teal-600 text-white' : subtle ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-700',
    ].join(' ')}
  >
    <Network className="h-3.5 w-3.5" />
    {label}
  </span>
)

export const StatRow: FC<{ label: string; value: string; emphasize?: boolean }> = ({ label, value, emphasize }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-gray-500">{label}</span>
    <span className={emphasize ? 'font-semibold' : 'font-medium'}>{value}</span>
  </div>
)