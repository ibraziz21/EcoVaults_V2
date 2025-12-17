'use client'
import '@/config/appkit'
import { ReactNode } from 'react'
import { WagmiProvider, cookieToInitialState } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/config'
import { Navbar } from '@/components/NavBar'

const queryClient = new QueryClient()


export function ProvidersWrapper({ initialState, children }: { initialState?: string; children: ReactNode }) {
  const wagmiState = cookieToInitialState(wagmiConfig, initialState)
  return (
    <WagmiProvider config={wagmiConfig} initialState={wagmiState}>
      <QueryClientProvider client={queryClient}>
        <Navbar />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
