'use client'
import { useEffect, useState } from 'react'
import { readActiveDeposits, clearActiveDeposit } from '@/lib/recovery'

export type ResumeItem = {
  refId: `0x${string}`
  status: string
  fromTxHash?: `0x${string}`
  toTxHash?: `0x${string}`
}

export function useDepositRecovery(user?: `0x${string}`) {
  const [resuming, setResuming] = useState<ResumeItem[]>([])

  useEffect(() => {
    if (!user) return

    const locals = readActiveDeposits()
    const localIds = Object.keys(locals) as `0x${string}`[]

    const start = async () => {
      // 1) server truth
      const q = await fetch(`/api/deposits/pending?user=${user}`)
      const js = await q.json().catch(() => ({}))
      const serverItems: ResumeItem[] = (js.items || []).map((r: any) => ({ refId: r.refId, status: r.status, fromTxHash: r.fromTxHash, toTxHash: r.toTxHash }))

      // 2) union with locals (in case local has refs not listed yet)
      const unionIds = Array.from(new Set([...serverItems.map(i => i.refId), ...localIds]))
      const snapshot: ResumeItem[] = unionIds.map(r => serverItems.find(i => i.refId === r) || ({ refId: r, status: 'UNKNOWN' } as any))

      setResuming(snapshot)

      // 3) nudge finisher & poll each until terminal
      snapshot.forEach(async ({ refId }) => {
        // initial nudge
        fetch('/api/relayer/finish', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refId }),
        }).catch(() => {})

        // poll status until terminal
        for (;;) {
          const s = await fetch(`/api/deposits/status?refId=${refId}`)
          const js = await s.json().catch(() => ({}))
          if (!js?.ok) break
          const st = js.status as string
          setResuming(old => old.map(i => i.refId === refId ? { ...i, status: st, fromTxHash: js.fromTxHash, toTxHash: js.toTxHash } : i))

          if (['MINTED', 'SUCCESS', 'FAILED'].includes(st)) {
            clearActiveDeposit(refId)
            break
          }
          await new Promise(r => setTimeout(r, 5000))
          // periodic nudge to keep server busy (safe idempotent)
          fetch('/api/relayer/finish', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refId }),
          }).catch(() => {})
        }
      })
    }

    start()
  }, [user])

  return { resuming }
}
