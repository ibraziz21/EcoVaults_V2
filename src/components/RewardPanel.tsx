// src/components/RewardsPanel.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import { createPublicClient, http } from 'viem'
import { optimism } from 'viem/chains'
import { useWalletClient } from 'wagmi'
import { formatUnits } from 'viem'
import { Button } from '@/components/ui/button'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import { REWARDS_VAULT } from '@/lib/constants'

// Single OP client is fine for both rewards vaults
const publicClient = createPublicClient({ chain: optimism, transport: http() })
const DECIMALS = 6 // both receipts accrue in 6d units

type TokenKind = 'USDC' | 'USDT'

type CardState = {
  earned: bigint
  available: bigint
  loading: boolean
  status: 'idle' | 'claiming' | 'success' | 'error'
  error: string | null
}

function useRewardsCardState() {
  const [st, setSt] = useState<CardState>({
    earned: 0n,
    available: 0n,
    loading: true,
    status: 'idle',
    error: null,
  })
  return [st, setSt] as const
}

const RewardCard: FC<{
  token: TokenKind
  vault: `0x${string}`
}> = ({ token, vault }) => {
  const { data: walletClient } = useWalletClient()
  const user = walletClient?.account?.address as `0x${string}` | undefined
  const [st, setSt] = useRewardsCardState()

  async function load() {
    setSt((s) => ({ ...s, loading: true, error: null }))
    try {
      // earned(user) and availableRewards() are on the rewards vault
      const [earned, available] = await Promise.all([
        user
          ? (publicClient.readContract({
              address: vault,
              abi: rewardsAbi,
              functionName: 'earned',
              args: [user],
            }) as Promise<bigint>)
          : Promise.resolve(0n),
        publicClient.readContract({
          address: vault,
          abi: rewardsAbi,
          functionName: 'availableRewards',
        }) as Promise<bigint>,
      ])

      setSt((s) => ({ ...s, earned, available, loading: false }))
    } catch (e: any) {
      setSt((s) => ({
        ...s,
        loading: false,
        error: e?.message ?? 'Failed to load rewards',
      }))
    }
  }

  useEffect(() => {
    // reload on wallet connect / change
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, vault])

  const earnedPretty = useMemo(() => formatUnits(st.earned, DECIMALS), [st.earned])
  const availablePretty = useMemo(() => formatUnits(st.available, DECIMALS), [st.available])

  const canClaim = Boolean(user) && st.earned > 0n && st.status !== 'claiming'

  async function claim() {
    if (!walletClient || !walletClient.account || !user) return
    setSt((s) => ({ ...s, status: 'claiming', error: null }))

    try {
      // Try full claim first
      try {
        const { request } = await publicClient.simulateContract({
          address: vault,
          abi: rewardsAbi,
          functionName: 'claimRewards',
          account: walletClient.account,
        })
        const tx = await walletClient.writeContract(request)
        await publicClient.waitForTransactionReceipt({ hash: tx })
        setSt((s) => ({ ...s, status: 'success' }))
        await load()
        return
      } catch {
        // Fallback: partial up to available
        if (st.available > 0n) {
          const { request } = await publicClient.simulateContract({
            address: vault,
            abi: rewardsAbi,
            functionName: 'claimRewardsUpToAvailable',
            account: walletClient.account,
          })
          const tx = await walletClient.writeContract(request)
          await publicClient.waitForTransactionReceipt({ hash: tx })
          setSt((s) => ({ ...s, status: 'success' }))
          await load()
          return
        }
        throw new Error('Nothing available to claim right now')
      }
    } catch (e: any) {
      setSt((s) => ({ ...s, status: 'error', error: e?.message ?? 'Claim failed' }))
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4 dark:bg-white/5">
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/5 text-[11px] font-bold dark:bg-white/10">
            {token}
          </span>
          <h4 className="text-sm font-semibold">Vault Rewards ({token})</h4>
        </div>
        <code className="rounded bg-black/5 px-2 py-0.5 text-[10px] dark:bg-white/10">
          {vault.slice(0, 6)}…{vault.slice(-4)}
        </code>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Accrued (claimable)</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {st.loading ? '…' : `${earnedPretty} ${token}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Vault liquidity</div>
          <div className="mt-1 text-sm font-medium tabular-nums">
            {st.loading ? '…' : `${availablePretty} ${token}`}
          </div>
        </div>
      </div>

      {/* Hints */}
      {!st.loading && st.earned === 0n && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing to claim yet. Rewards accrue continuously—check back soon.
        </p>
      )}
      {!st.loading && st.earned > 0n && st.available < st.earned && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
          The vault doesn’t have enough {token} to pay the full amount now. We’ll try a partial claim up to what’s available.
        </p>
      )}

      {/* Actions / status */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={claim}
          disabled={!canClaim}
          className="rounded-full bg-teal-600 hover:bg-teal-500"
          title={st.earned > 0n ? 'Claim rewards' : 'Nothing to claim'}
        >
          {st.status === 'claiming' ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Claiming…
            </span>
          ) : (
            'Claim'
          )}
        </Button>

        <Button
          variant="secondary"
          disabled={st.status === 'claiming'}
          onClick={load}
          className="rounded-full"
          title="Refresh"
        >
          Refresh
        </Button>
      </div>

      {st.status === 'success' && (
        <div className="mt-4 flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Rewards claimed to your wallet.
        </div>
      )}
      {st.status === 'error' && (
        <div className="mt-4 flex items-start gap-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span className="break-words">{st.error}</span>
        </div>
      )}
    </div>
  )
}

export const RewardsPanel: FC = () => {
  // Pull the two concrete vaults from constants
  const usdcVault = REWARDS_VAULT.optimismUSDC as `0x${string}`
  const usdtVault = REWARDS_VAULT.optimismUSDT as `0x${string}`

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <h3 className="text-lg font-semibold">Vault Rewards</h3>
        <p className="text-xs text-muted-foreground">
          Rewards accrue linearly based on your mirrored receipt balances on Optimism.
        </p>
      </div>

      <div className="grid gap-4">
        <RewardCard token="USDC" vault={usdcVault} />
        <RewardCard token="USDT" vault={usdtVault} />
      </div>
    </div>
  )
}
