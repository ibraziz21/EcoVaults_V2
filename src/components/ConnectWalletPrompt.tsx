// src/components/ConnectWalletPrompt.tsx
'use client'

import { useAccount, useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'

export function ConnectWalletPrompt() {
  const { isConnected } = useAccount()
  const { connectors, connectAsync, isPending } = useConnect()

  const onConnectSafe = async () => {
    if (isConnected) return

    const safe = connectors.find((c) => c.id === 'safe')
    if (!safe) {
      // If you want, swap this for a toast.
      console.warn(
        '[ConnectWalletPrompt] Safe connector not found. Ensure wagmi is configured with the Safe connector.',
      )
      return
    }

    await connectAsync({ connector: safe })
  }

  const safeAvailable = connectors.some((c) => c.id === 'safe')

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-3.5rem)]">
      <div className="w-full flex ecovaults-background bg-right bg-contain bg-no-repeat max-w-[1392px]">
        <div className="h-[350px] w-[700px] flex flex-col max-w-[1392px] lg:ml-[100px] justify-center p-2 lg:p-0 gap-6">
          <h2 className="text-3xl md:text-5xl lg:text-6xl font-semibold">
            Your gateway to <br /> smarter on-chain yields
          </h2>

          <h4 className="text-[#4B5563] text-base md:text-lg">
            Please connect your wallet to get started
          </h4>

          <div>
            <Button
              onClick={onConnectSafe}
              disabled={!safeAvailable || isPending}
              className="flex bg-[#376FFF] hover:bg-[#2F5DD1] p-4 rounded-[12px] text-base h-10 disabled:opacity-60 disabled:cursor-not-allowed"
              title={!safeAvailable ? 'Safe wallet not available' : 'Connect Safe Wallet'}
            >
              {isPending ? 'Connecting…' : 'Connect Wallet'}
            </Button>

            {!safeAvailable && (
              <div className="mt-2 text-xs text-muted-foreground">
                Safe wallet is not available. Open this app inside Safe, or ensure the Safe connector is configured in wagmi.
              </div>
            )}
          </div>
        </div>

        <div>
          <br />
        </div>
      </div>
    </div>
  )
}
