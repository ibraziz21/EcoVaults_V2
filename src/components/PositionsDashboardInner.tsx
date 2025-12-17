'use client'

import { FC, useMemo, useState } from 'react'
import { usePositions } from '@/hooks/usePositions'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { type Position as BasePosition } from '@/lib/positions'
import { PositionCard } from './PositionCard'
import { DepositModal } from '@/components/DepositModal'
import WithdrawModal from '@/components/WithdrawModal'
import { Input } from '@/components/ui/input'
import { MORPHO_POOLS, TokenAddresses } from '@/lib/constants'

type EvmChain = 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'

type WithdrawSnap = {
  token: 'USDCe' | 'USDT0'
  chain: 'lisk'
  poolAddress?: `0x${string}`
  shares: bigint
}

function toWithdrawSnap(pos: PositionLike, snap: YieldSnapshot): WithdrawSnap | null {
  // Only support USDCe / USDT0 withdrawals for now.
  const t = String(snap.token).toUpperCase()
  if (t === 'USDC' || t === 'USDCE') {
    return {
      token: 'USDCe',
      chain: 'lisk',
      poolAddress: snap.poolAddress as `0x${string}` | undefined,
      shares: (pos as any).amount ?? 0n,
    }
  }
  if (t === 'USDT' || t === 'USDT0') {
    return {
      token: 'USDT0',
      chain: 'lisk',
      poolAddress: snap.poolAddress as `0x${string}` | undefined,
      shares: (pos as any).amount ?? 0n,
    }
  }
  return null // WETH (or anything else) not supported by WithdrawModal
}

type PositionLike =
  | BasePosition
  | {
    protocol: 'Morpho Blue'
    chain: Extract<EvmChain, 'lisk'>
    token: MorphoToken
    amount: bigint // interpreted as the user’s current **receipt shares** for this modal
  }

const CHAIN_LABEL: Record<EvmChain, string> = { lisk: 'Lisk' }

const MORPHO_VAULT_BY_TOKEN: Record<MorphoToken, `0x${string}`> = {
  USDCe: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
  USDT0: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
  WETH: MORPHO_POOLS['weth-supply'] as `0x${string}`,
}

export const PositionsDashboardInner: FC = () => {
  const { data: positionsRaw } = usePositions()
  const { yields: snapshots, isLoading: yieldsLoading } = useYields()

  const positions = (positionsRaw ?? []) as unknown as PositionLike[]

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'amount_desc' | 'amount_asc'>('amount_desc')

  // Only Morpho positions (Lisk). If none, show fallback zeroed rows.
  const positionsForMorpho: PositionLike[] = useMemo(() => {
    const morpho = positions.filter((p) => p.protocol === 'Morpho Blue') as PositionLike[]
    if (morpho.length > 0) return morpho
    return [
      { protocol: 'Morpho Blue', chain: 'lisk', token: 'USDCe', amount: 0n },
      { protocol: 'Morpho Blue', chain: 'lisk', token: 'USDT0', amount: 0n },
    ]
  }, [positions])

  const subset = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = positionsForMorpho.filter(
      (p) =>
        p.protocol === 'Morpho Blue' &&
        (q ? `${p.token} ${p.chain} ${p.protocol}`.toLowerCase().includes(q) : true),
    )
    const sorted = filtered.slice().sort((a, b) => {
      if (sort === 'amount_desc') return Number((b.amount ?? 0n) - (a.amount ?? 0n))
      return Number((a.amount ?? 0n) - (b.amount ?? 0n))
    })
    return sorted
  }, [positionsForMorpho, query, sort])

  // Deposit / Withdraw modals
  const [depositSnap, setDepositSnap] = useState<YieldSnapshot | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawSnap, setWithdrawSnap] = useState<WithdrawSnap | null>(null)
  const [withdrawMaxShares, setWithdrawMaxShares] = useState<bigint>(0n)

  function findSnapshotForPosition(p: PositionLike): YieldSnapshot {
    const normToken = String(p.token).toLowerCase()

    const direct =
      snapshots?.find(
        (y) =>
          y.chain === p.chain &&
          y.protocolKey === 'morpho-blue' &&
          String(y.token).toLowerCase() ===
          (normToken === 'usdce' ? 'usdc' : normToken === 'usdt0' ? 'usdt' : normToken),
      )
    if (direct) return direct

    const vault = MORPHO_VAULT_BY_TOKEN[p.token as MorphoToken]
    if (vault) {
      const byVault = snapshots?.find(
        (y) =>
          y.protocolKey === 'morpho-blue' &&
          y.chain === 'lisk' &&
          y.poolAddress?.toLowerCase() === vault.toLowerCase(),
      )
      if (byVault) return byVault
    }

    const underlyingAddr: `0x${string}` =
      p.token === 'USDCe'
        ? (TokenAddresses.USDCe as any).lisk
        : p.token === 'USDT0'
          ? (TokenAddresses.USDT0 as any).lisk
          : (TokenAddresses.WETH as any).lisk

    const fallback: YieldSnapshot = {
      id: `fallback-Morpho-${p.chain}-${String(p.token)}`,
      chain: p.chain as any,
      protocol: 'Morpho Blue',
      protocolKey: 'morpho-blue',
      poolAddress: vault ?? '0x0000000000000000000000000000000000000000',
      token: p.token as any,
      apy: 0,
      tvlUSD: 0,
      updatedAt: new Date().toISOString(),
      underlying: underlyingAddr,
    }
    return fallback
  }

  const title = 'Morpho Blue (Lisk)'
  const hint = 'MetaMorpho vaults live on Lisk.'
  const totalPositions = subset.length

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 backdrop-blur dark:from-white/5 dark:to-white/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {totalPositions} {totalPositions === 1 ? 'position' : 'positions'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full bg-muted/60 px-3 py-1 text-xs">{CHAIN_LABEL.lisk}</div>
            <div className="w-40 sm:w-56">
              <Input
                placeholder="Search token…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8"
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
              title="Sort"
            >
              <option value="amount_desc">Balance: High → Low</option>
              <option value="amount_asc">Balance: Low → High</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {hint}
          {yieldsLoading ? ' • Loading yields…' : ''}
        </p>
      </div>

      {subset.length === 0 ? (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
          No positions match your filters.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subset.map((p, idx) => (
              <PositionCard
                key={`${String(p.protocol)}-${String(p.chain)}-${String(p.token)}-${idx}`}
                p={p as any}
                onSupply={(pos) => setDepositSnap(findSnapshotForPosition(pos as any))}
                onWithdraw={(pos) => {
                  const snap = findSnapshotForPosition(pos as any)
                  const narrowed = toWithdrawSnap(pos as any, snap)
                  if (narrowed) {
                    setWithdrawSnap(narrowed)
                  } else {
                    // Optional: toast or silently ignore when token isn’t supported
                    // toast.error('Withdraw not supported for this asset yet.')
                  }
                }}
              />
            ))}
          </div>
        </>
      )}

      {depositSnap && (
        <DepositModal open={true} snap={depositSnap} onClose={() => setDepositSnap(null)} />
      )}
      {withdrawSnap && (
        <WithdrawModal
          open={true}
          snap={{ token: withdrawSnap.token, chain: withdrawSnap.chain, poolAddress: withdrawSnap.poolAddress as `0x${string}` }}
          shares={withdrawSnap.shares}
          onClose={() => setWithdrawSnap(null)}
        />
      )}
    </>
  )
}

export default PositionsDashboardInner