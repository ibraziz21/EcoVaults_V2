import { FC } from 'react'
import { palette } from '@/lib/pallete'

export const TokenBadge: FC<{ symbol: string }> = ({ symbol }) => (
  <span
    className="inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-medium uppercase shadow-sm"
    style={{ backgroundColor: palette.primary, color: palette.onPrimary }}
  >
    {symbol}
  </span>
)