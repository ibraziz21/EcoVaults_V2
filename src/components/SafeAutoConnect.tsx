// src/components/SafeAutoConnect.tsx
'use client'

import { useEffect } from 'react'
import { useAccount, useConnect } from 'wagmi'

export function SafeAutoConnect() {
  const { isConnected } = useAccount()
  const { connectors, connectAsync } = useConnect()

  useEffect(() => {
    if (isConnected) return

    const safeConnector =
      connectors.find((c) => c.id === 'safe') ||
      connectors.find((c) => c.name.toLowerCase().includes('safe'))

    if (!safeConnector) return

    // If not running inside Safe, this will fail — ignore silently.
    connectAsync({ connector: safeConnector }).catch(() => {})
  }, [isConnected, connectors, connectAsync])

  return null
}
