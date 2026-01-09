import { useQuery } from '@tanstack/react-query'

type WithdrawIntentRow = {
  refId: string
  status: string
  burnTxHash?: string | null
  redeemTxHash?: string | null
  fromTxHash?: string | null
  toTxHash?: string | null
  amountOut?: string | null
  amountShares?: string | null
  minAmountOut?: string | null
  error?: string | null
  updatedAt: string
}

export function useWithdrawIntents(user?: string) {
  const q = useQuery({
    queryKey: ['withdraw-intents', user],
    enabled: !!user,
    queryFn: async (): Promise<WithdrawIntentRow[]> => {
      const res = await fetch(`/api/withdraw/intents?user=${user}`)
      if (!res.ok) throw new Error('Failed to load withdraw intents')
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load withdraw intents')
      return (json.intents || []) as WithdrawIntentRow[]
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  return {
    intents: q.data ?? [],
    isLoading: q.isLoading,
    refetch: q.refetch,
    error: q.error as Error | null,
  }
}
