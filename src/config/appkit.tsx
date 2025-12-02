'use client'
import React, { type ReactNode } from 'react'
import { createAppKit } from '@reown/appkit/react'
import { optimism, base,lisk } from '@reown/appkit/networks'
import { wagmiAdapter, projectId } from '@/config'

import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Set stable, HTTPS metadata. Do NOT leave blanks.
// NEXT_PUBLIC_APP_URL must be the exact origin and be whitelisted in WC Cloud → Allowed Origins
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')
const queryClient = new QueryClient()
const ICON_URL = process.env.NEXT_PUBLIC_ICON_URL || `${APP_URL}/icon-512.png`

if (!APP_URL || !APP_URL.startsWith('http')) {
  // Helpful console warning; won’t crash dev, but you should set it in prod
  console.warn('[AppKit] metadata.url is missing or not https. Set NEXT_PUBLIC_APP_URL.')
}

createAppKit({
  projectId,
  adapters: [wagmiAdapter],
  networks: [optimism, base, lisk],
  defaultNetwork: optimism,
  metadata: {
    name: 'SuperYield-R',
    description: 'Cross-chain yield aggregator',
    url: APP_URL,        // must be HTTPS and whitelisted
    icons: [ICON_URL],   // must be a reachable HTTPS icon
  },
  features: {
    analytics: true // Optional - defaults to your Cloud configuration
  },
  themeVariables: {
    "--w3m-accent": "#18b180",  
    "--w3m-border-radius-master": "1px", 
    "--w3m-color-mix": "#000000",
  },
  enableWallets: true,
})

function ContextProvider({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

export default ContextProvider



