'use client'

import { useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'

type PendingIntent = {
  refId: `0x${string}`
  type: 'deposit' | 'withdraw'
  user: `0x${string}`
  createdAt: number
}

const STORAGE_KEY = 'pending_intents_v1'

function safeParse<T>(x: string | null): T | null {
  if (!x) return null
  try { return JSON.parse(x) as T } catch { return null }
}

function loadPending(): PendingIntent[] {
  return safeParse<PendingIntent[]>(localStorage.getItem(STORAGE_KEY)) ?? []
}

function savePending(intents: PendingIntent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(intents))
}

async function postFinish(type: PendingIntent['type'], refId: string) {
  const url = type === 'deposit' ? '/api/relayer/finish' : '/api/withdraw/finish'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refId }),
  })
  return { ok: res.ok, json: await res.json().catch(() => ({})), status: res.status }
}

export function ResumeIntents() {
  const { address } = useAccount()
  const ranForSession = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!address) return

    const user = address.toLowerCase()
    const intents = loadPending()

    // Only resume intents created by this wallet
    const mine = intents.filter(i => i.user.toLowerCase() === user)

    for (const intent of mine) {
      const key = `${intent.type}:${intent.refId}`

      // Avoid spamming finish calls in the same tab/session
      if (ranForSession.current.has(key)) continue
      ranForSession.current.add(key)

      ;(async () => {
        const res = await postFinish(intent.type, intent.refId)

        // If finish says “already” / “done”, you can remove it.
        // Your APIs return { ok: true, status: 'MINTED' } for deposit,
        // and { ok: true, status: 'SUCCESS' } for withdraw.
        const status = (res.json?.status || res.json?.stage || '').toString().toUpperCase()

        const isTerminal =
          status === 'MINTED' ||
          status === 'SUCCESS' ||
          res.json?.already === true

        if (isTerminal) {
          const latest = loadPending().filter(i => !(i.refId === intent.refId && i.type === intent.type))
          savePending(latest)
        }

        // If processing (202) or failed (500), we leave it in storage so next refresh retries.
      })()
    }
  }, [address])

  return null
}
