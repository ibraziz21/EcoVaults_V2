/* src/hooks/useAaveAccounts.ts
   Repurposed: Morpho accounts (kept filename for compatibility).
   Returns a single Lisk entry with supplied assets across USDCe/USDT0/WETH.
*/
'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWalletClient } from 'wagmi'
import { fetchPositions, type Position } from '@/lib/positions'

export type MorphoAccount = {
  chain: 'lisk'
  /** Sum of Morpho supplied balances on Lisk (USD approx uses stables 1:1; value here is raw asset units and informational) */
  suppliedUSDCe: bigint
  suppliedUSDT0: bigint
  suppliedWETH: bigint
}

function toMorphoAccount(positions: Position[]): MorphoAccount {
  let usdcE = 0n
  let usdt0 = 0n
  let weth  = 0n

  for (const p of positions) {
    if (p.protocol !== 'Morpho Blue' || p.chain !== 'lisk') continue
    if (p.token === 'USDCe') usdcE += p.amount
    else if (p.token === 'USDT0') usdt0 += p.amount
    else if (p.token === 'WETH') weth += p.amount
  }

  return {
    chain: 'lisk',
    suppliedUSDCe: usdcE,
    suppliedUSDT0: usdt0,
    suppliedWETH:  weth,
  }
}

export function useAaveAccounts() {
  const { data: walletClient } = useWalletClient()

  const query = useQuery<MorphoAccount>({
    queryKey: ['morphoAccount', walletClient?.account.address],
    enabled: !!walletClient?.account.address,
    queryFn: async () => {
      const user = walletClient!.account.address as `0x${string}`
      console.time('[useMorphoAccounts] fetch time')
      const positions = await fetchPositions(user)
      const result = toMorphoAccount(positions)
      console.timeEnd('[useMorphoAccounts] fetch time')
      return result
    },
    refetchInterval: 30_000,
  })

  useEffect(() => {
    console.log('[useMorphoAccounts] state →', {
      status: query.status,
      isFetching: query.isFetching,
      data: query.data,
      error: query.error,
      fetchStatus: query.fetchStatus,
      isStale: query.isStale,
    })
  }, [
    query.status,
    query.isFetching,
    query.data,
    query.error,
    query.fetchStatus,
    query.isStale,
  ])

  return query
}
