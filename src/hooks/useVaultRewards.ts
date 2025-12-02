// src/hooks/useVaultRewards.ts
import { useQuery } from '@tanstack/react-query'
import { createPublicClient, http } from 'viem'
import { optimism } from 'viem/chains'
import { useWalletClient } from 'wagmi'
import { REWARDS_VAULT } from '@/lib/constants'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'

const publicClient = createPublicClient({ chain: optimism, transport: http() })

export type DualRewardsData = {
  byToken: {
    USDC: {
      vault: `0x${string}`
      earned: bigint
      availableRewards: bigint
    }
    USDT: {
      vault: `0x${string}`
      earned: bigint
      availableRewards: bigint
    }
  }
  // totals
  earnedTotal: bigint
  availableTotal: bigint

  // ✅ legacy fields for backward compatibility
  earned: bigint
  availableRewards: bigint
}

export function useVaultRewards() {
  const { data: walletClient } = useWalletClient()
  const user = walletClient?.account?.address as `0x${string}` | undefined

  const usdcVault = REWARDS_VAULT.optimismUSDC as `0x${string}`
  const usdtVault = REWARDS_VAULT.optimismUSDT as `0x${string}`

  const query = useQuery<DualRewardsData>({
    queryKey: ['vault-rewards-v2', user, usdcVault, usdtVault],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [earnedUSDC, availUSDC, earnedUSDT, availUSDT] = (await Promise.all([
        publicClient.readContract({
          address: usdcVault,
          abi: rewardsAbi,
          functionName: 'earned',
          args: [user!],
        }),
        publicClient.readContract({
          address: usdcVault,
          abi: rewardsAbi,
          functionName: 'availableRewards',
        }),
        publicClient.readContract({
          address: usdtVault,
          abi: rewardsAbi,
          functionName: 'earned',
          args: [user!],
        }),
        publicClient.readContract({
          address: usdtVault,
          abi: rewardsAbi,
          functionName: 'availableRewards',
        }),
      ])) as [bigint, bigint, bigint, bigint]

      const earnedTotal = earnedUSDC + earnedUSDT
      const availableTotal = availUSDC + availUSDT

      return {
        byToken: {
          USDC: { vault: usdcVault, earned: earnedUSDC, availableRewards: availUSDC },
          USDT: { vault: usdtVault, earned: earnedUSDT, availableRewards: availUSDT },
        },
        earnedTotal,
        availableTotal,
        // legacy fields (totals) for older UIs
        earned: earnedTotal,
        availableRewards: availableTotal,
      }
    },
  })

  return { ...query, user }
}
