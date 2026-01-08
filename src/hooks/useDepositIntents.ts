import { useQuery } from '@tanstack/react-query'

type DepositIntentRow = {
  refId: string
  status: string
  fromTxHash?: string | null
  toTxHash?: string | null
  depositTxHash?: string | null
  amount?: string | null
  minAmount?: string | null
  error?: string | null
  updatedAt: string
}

export function useDepositIntents(user?: string) {
  const q = useQuery({
    queryKey: ['deposit-intents', user],
    enabled: !!user,
    queryFn: async (): Promise<DepositIntentRow[]> => {
      const res = await fetch(`/api/deposits/intents?user=${user}`)
      if (!res.ok) throw new Error('Failed to load intents')
      const json = await res.json()
      if (!json?.ok) throw new Error(json?.error || 'Failed to load intents')
      return (json.intents || []) as DepositIntentRow[]
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
