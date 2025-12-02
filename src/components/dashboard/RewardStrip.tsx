'use client'

import { FC } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

/**
 * Displays claimable rewards (e.g., Merkl) aggregated by protocol.
 * Wire real data later; for now, accept props or stub with 0.
 */
type RewardItem = { protocol: string; amountUsd: number }
export const RewardsStrip: FC<{ rewards?: RewardItem[]; onClaimAll?: () => void }> = ({
  rewards = [],
  onClaimAll,
}) => {
  const total = rewards.reduce((s, r) => s + (r.amountUsd || 0), 0)
  if (!rewards.length) return null

  return (
    <Card className="mx-auto mt-2 w-full max-w-6xl rounded-2xl border-primary/20 bg-primary/5 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">Rewards</span>
          {rewards.map((r, i) => (
            <span key={i} className="text-muted-foreground">
              {r.protocol}: <strong className="text-foreground">${r.amountUsd.toFixed(2)}</strong>
            </span>
          ))}
          <span className="hidden text-muted-foreground sm:inline">•</span>
          <span className="font-medium">Total: ${total.toFixed(2)}</span>
        </div>
        <Button
          size="sm"
          className="bg-teal-600 hover:bg-teal-500"
          onClick={onClaimAll}
          title="Claim all rewards"
        >
          Claim all
        </Button>
      </div>
    </Card>
  )
}
