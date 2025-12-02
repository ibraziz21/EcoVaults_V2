'use client'

import { useEffect, useRef, useState } from 'react'

type Hex = `0x${string}`

type UseBridgePollOpts = {
  /** Start/stop the poller */
  enabled: boolean
  /** User address on Lisk (same EOA) */
  user: Hex | null
  /** Destination token on Lisk */
  tokenAddr: Hex | null
  /** Balance before starting the bridge (baseline) */
  startBal: bigint

  /** Read balance on Lisk; return null on RPC hiccups */
  readBalance: (tokenAddr: Hex, user: Hex) => Promise<bigint | null>
  /** Called when funds land (> startBal). Passes the *landed* delta. If timed out, called with 0n. */
  onLanded: (landed: bigint) => void

  /** UX: first wait before first poll (default 10s) */
  firstDelayMs?: number
  /** UX/Load: poll cadence (default 6s) */
  intervalMs?: number
  /** Safety: total timeout in minutes (default 15) */
  maxMinutes?: number
}

type UseBridgePollRet = {
  /** Seconds until the next poll; null if idle/disabled */
  nextCheckIn: number | null
}

export function useBridgePoll(options: UseBridgePollOpts): UseBridgePollRet {
  const {
    enabled,
    user,
    tokenAddr,
    startBal,
    readBalance,
    onLanded,
    firstDelayMs = 10_000,
    intervalMs = 6_000,
    maxMinutes = 15,
  } = options

  const [nextCheckIn, setNextCheckIn] = useState<number | null>(null)

  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const tickRef = useRef<NodeJS.Timeout | null>(null)
  const stopAll = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    setNextCheckIn(null)
  }

  useEffect(() => {
    // Guard rails
    if (!enabled || !user || !tokenAddr) {
      stopAll()
      return
    }

    let cancelled = false
    const endAt = Date.now() + maxMinutes * 60_000

    // 1) visual 1s countdown for next poll
    let remainingMs = firstDelayMs
    setNextCheckIn(Math.ceil(remainingMs / 1000))
    tickRef.current = setInterval(() => {
      if (cancelled) return
      remainingMs -= 1000
      const secs = Math.max(0, Math.ceil(remainingMs / 1000))
      setNextCheckIn(secs)
    }, 1000)

    // 2) actual poll function
    const pollOnce = async () => {
      if (cancelled) return
      try {
        const bal = await readBalance(tokenAddr, user)
        if (bal != null) {
          const delta = bal - startBal
          if (delta > 0n) {
            // landed!
            stopAll()
            if (!cancelled) onLanded(delta)
            return
          }
        }
      } catch {
        // swallow; we'll try again
      }

      // schedule next poll or timeout
      if (Date.now() > endAt) {
        stopAll()
        if (!cancelled) onLanded(0n) // signal timeout
        return
      }

      // reset countdown for the next tick
      remainingMs = intervalMs
      setNextCheckIn(Math.ceil(remainingMs / 1000))
      timerRef.current = setTimeout(pollOnce, intervalMs)
    }

    // 3) kick off the first poll after firstDelayMs
    timerRef.current = setTimeout(pollOnce, firstDelayMs)

    return () => {
      cancelled = true
      stopAll()
    }
  
  }, [enabled, user, tokenAddr, startBal, firstDelayMs, intervalMs, maxMinutes, readBalance, onLanded])

  return { nextCheckIn }
}

export default useBridgePoll
