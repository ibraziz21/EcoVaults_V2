// src/components/positions/ProtocolTabs.tsx
'use client'

import { useState, useMemo } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { RewardsPanel } from './RewardPanel'
import { PositionsDashboardInner } from './PositionsDashboardInner'
import { usePositions } from '@/hooks/usePositions'
import { useMerklRewards } from '@/hooks/useMerklRewards'

const PROTOCOLS = [
  { value: 'Morpho Blue', label: 'Morpho' },
  { value: 'Rewards',     label: 'Rewards' },
] as const

type TabValue = (typeof PROTOCOLS)[number]['value']

export function ProtocolTabs() {
  const [tab, setTab] = useState<TabValue>('Morpho Blue')
  const { data: positions } = usePositions()
  const { totalCount: rewardsCount } = useMerklRewards()

  // counts per tab (Morpho + Rewards only)
  const counts = useMemo(() => {
    const morphoCount =
      positions?.filter((p) => p.protocol === 'Morpho Blue').length ?? 0
    return new Map<TabValue, number>([
      ['Morpho Blue', morphoCount],
      ['Rewards', rewardsCount],
    ])
  }, [positions, rewardsCount])

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Heading */}
      <div className="mb-4 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <h2 className="text-lg font-semibold">Your Positions</h2>
        <p className="text-xs text-muted-foreground">
          Browse balances by protocol. Use filters inside each section to refine further.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)} className="w-full">
        {/* Triggers with badges */}
        <TabsList className="inline-flex rounded-full bg-muted/50 p-1 ring-1 ring-border/60 dark:bg-white/10">
          {PROTOCOLS.map(({ value, label }) => {
            const count = counts.get(value) ?? 0
            return (
              <TabsTrigger
                key={value}
                value={value}
                className="
                  rounded-full px-4 py-1.5 text-sm text-muted-foreground transition
                  data-[state=active]:bg-primary data-[state=active]:text-primary-foreground
                "
              >
                <span>{label}</span>
                <span
                  className="
                    ml-2 rounded-full bg-black/5 px-2 py-[2px] text-[10px]
                    data-[state=active]:bg-white/20
                    dark:bg-white/10
                  "
                >
                  {count}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Panels */}
        <TabsContent value="Morpho Blue" className="mt-6">
          <PositionsDashboardInner />
        </TabsContent>
        <TabsContent value="Rewards" className="mt-6">
          <RewardsPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
