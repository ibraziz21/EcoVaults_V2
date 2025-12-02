// src/hooks/useYields.ts
//
// Morpho Blue (Lisk) only. Export YieldSnapshot for consistency across the app.

import { useQuery } from '@tanstack/react-query'
import { fetchYields } from '@/lib/fetchYields'

export type Chain = 'lisk'
export type Protocol = 'Morpho Blue'
export type ProtocolKey = 'morpho-blue'
export type TokenSym = 'USDC' | 'USDT' | 'WETH' | 'USDCe' | 'USDT0'

export interface YieldSnapshot {
  id: string
  chain: Chain
  protocol: Protocol
  protocolKey: ProtocolKey
  poolAddress: `0x${string}`
  token: TokenSym            // display token (USDC/USDT/WETH)
  apy: number               // Merkl APR (%)
  tvlUSD: number
  updatedAt: string
  /** Vault asset on Lisk (USDCe/USDT0/WETH) */
  underlying: `0x${string}`
}

export function useYields() {
  const query = useQuery<YieldSnapshot[], Error>({
    queryKey: ['yields', 'morpho-lisk'],
    queryFn: fetchYields,
    staleTime: 60_000, // 1 min
    refetchOnWindowFocus: false,
  })

  return {
    yields: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
