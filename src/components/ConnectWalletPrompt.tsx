'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useAccount, useConnect } from 'wagmi'

function detectSafeAppEnv(): boolean {
  if (typeof window === 'undefined') return false
  const isIframe = window.parent && window.parent !== window
  const host = window.location.hostname.toLowerCase()
  const isSafeHost = host === 'app.safe.global' || host.endsWith('.safe.global')
  const hasSafeParam = new URLSearchParams(window.location.search).has('safe')
  return Boolean(isIframe || isSafeHost || hasSafeParam)
}

export function ConnectWalletPrompt() {
  const router = useRouter()
  const { isConnected } = useAccount()
  const { connectAsync, connectors, isPending } = useConnect()

  const [isSafeApp, setIsSafeApp] = useState(false)
  const [safeAutoConnecting, setSafeAutoConnecting] = useState(false)

  useEffect(() => {
    setIsSafeApp(detectSafeAppEnv())
  }, [])

  // If we are inside Safe and wagmi isn't connected yet, try to connect via Safe connector once.
  useEffect(() => {
    let cancelled = false

    async function autoConnectSafe() {
      if (!isSafeApp || isConnected || isPending) return

      const safeConn =
        connectors.find((c) => c.id === 'safe') ??
        connectors.find((c) => c.name?.toLowerCase().includes('safe'))

      if (!safeConn) return // wagmi config likely missing Safe connector

      try {
        setSafeAutoConnecting(true)
        await connectAsync({ connector: safeConn })
      } catch {
        // swallow: user can still use button / open in safe messaging
      } finally {
        if (!cancelled) setSafeAutoConnecting(false)
      }
    }

    void autoConnectSafe()
    return () => {
      cancelled = true
    }
  }, [isSafeApp, isConnected, isPending, connectors, connectAsync])

  const primaryLabel = useMemo(() => {
    if (isConnected) return 'Continue'
    if (isSafeApp) return safeAutoConnecting ? 'Loading Safe…' : 'Continue'
    return isPending ? 'Connecting…' : 'Connect Wallet'
  }, [isConnected, isSafeApp, isPending, safeAutoConnecting])

  const subtitle = useMemo(() => {
    if (isSafeApp) {
      return 'You are using EcoVaults inside Safe. Your Safe wallet is available automatically.'
    }
    return 'Please connect your wallet to get started'
  }, [isSafeApp])

  async function onPrimary() {
    if (isConnected) {
      router.push('/')
      return
    }

    const safeConn =
      connectors.find((c) => c.id === 'safe') ??
      connectors.find((c) => c.name?.toLowerCase().includes('safe'))

    const injectedConn =
      connectors.find((c) => c.id === 'injected') ??
      connectors.find((c) => c.name?.toLowerCase().includes('metamask')) ??
      connectors.find((c) => c.name?.toLowerCase().includes('injected'))

    const fallbackConn = connectors[0]
    const connector = (isSafeApp ? safeConn : null) ?? injectedConn ?? fallbackConn
    if (!connector) throw new Error('No wallet connectors configured')

    await connectAsync({ connector })
    router.push('/')
  }

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-3.5rem)] px-4">
      <div className="w-full flex ecovaults-background bg-right bg-contain bg-no-repeat">
        <div className="h-[350px] w-[700px] flex flex-col max-w-6xl lg:ml-[100px] justify-center p-2 lg:p-0 gap-6">
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-semibold">
            Your gateway to <br /> smarter on-chain yields
          </h2>

          <h4 className="text-[#4B5563] text-base md:text-lg">{subtitle}</h4>

          <div>
            <Button
              onClick={() => void onPrimary()}
              className="flex bg-[#376FFF] p-4 py-6 rounded-xl text-base"
              disabled={isPending || safeAutoConnecting}
              title={primaryLabel}
            >
              {primaryLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
