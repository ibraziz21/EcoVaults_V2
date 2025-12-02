// src/components/PositionCard.tsx
'use client'

import { FC, useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits, type Address } from 'viem'
import { erc20Abi } from 'viem'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'
import { type Position as BasePosition } from '@/lib/positions'
import { useYields } from '@/hooks/useYields'
import { TokenAddresses, MORPHO_POOLS } from '@/lib/constants'
import { publicOptimism } from '@/lib/clients'

type EvmChain = 'optimism' | 'base' | 'lisk'
type MorphoToken = 'USDCe' | 'USDT0' | 'WETH'

type PositionLike =
  | BasePosition
  | {
      protocol: 'Morpho Blue'
      chain: Extract<EvmChain, 'lisk'>
      token: MorphoToken
      amount: bigint
    }

interface Props {
  p: PositionLike
  onSupply?: (p: PositionLike) => void
  onWithdraw?: (p: PositionLike) => void
}

/** Decimals resolver for Morpho tokens */
function tokenDecimals(token: MorphoToken): number {
  if (token === 'WETH') return 18
  return 6 // USDCe & USDT0
}

function morphoDisplayToken(t: MorphoToken): 'USDC' | 'USDT' | 'WETH' {
  return t === 'USDCe' ? 'USDC' : t === 'USDT0' ? 'USDT' : 'WETH'
}

export const PositionCard: FC<Props> = ({ p, onSupply, onWithdraw }) => {
  const { address: user } = useAccount()

  // quick render log
  useEffect(() => {
    console.log('[PositionCard] render', {
      protocol: p.protocol,
      chain: p.chain,
      token: String(p.token),
      amount: (p as any)?.amount?.toString?.() ?? undefined,
    })
  }, [p])

  useEffect(() => {
    console.log('[PositionCard] user address', user)
  }, [user])

  // ─────────────────────────────────────────────────────────────
  // OP receipt tokens (for Morpho Blue)
  // USDCe → read sVault.optimismUSDC
  // USDT0 → read sVault.optimismUSDT
  // WETH   has no OP receipt → fall back to p.amount
  // ─────────────────────────────────────────────────────────────
  const [svtBal, setSvtBal] = useState<bigint | null>(null)
  const [svtDec, setSvtDec] = useState<number>(6)

  const VAULT_ADDR: Address | undefined =
    p.protocol === 'Morpho Blue'
      ? (p.token === 'USDCe'
          ? (TokenAddresses as any)?.sVault?.optimismUSDC
          : p.token === 'USDT0'
          ? (TokenAddresses as any)?.sVault?.optimismUSDT
          : undefined)
      : undefined

  useEffect(() => {
    if (p.protocol !== 'Morpho Blue') {
      setSvtBal(null)
      return
    }
    if (!VAULT_ADDR) {
      setSvtBal(null) // no receipt for this token; we'll use p.amount
      return
    }
    if (!user) {
      setSvtBal(null)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const [dec, bal] = await Promise.all([
          publicOptimism.readContract({
            address: VAULT_ADDR,
            abi: erc20Abi,
            functionName: 'decimals',
          }) as Promise<number>,
          publicOptimism.readContract({
            address: VAULT_ADDR,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [user],
          }) as Promise<bigint>,
        ])

        if (!cancelled) {
          setSvtDec(dec ?? 6)
          setSvtBal(bal ?? 0n)
        }
      } catch {
        if (!cancelled) {
          setSvtBal(0n)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [p.protocol, p.token, user, VAULT_ADDR])

  // ----- Amount to display -----
  const decs = p.protocol === 'Morpho Blue'
    ? tokenDecimals(p.token as MorphoToken)
    : 6

  // Prefer OP receipt balance when available
  const displayAmt =
    p.protocol === 'Morpho Blue'
      ? VAULT_ADDR != null && svtBal != null
        ? formatUnits(svtBal, svtDec)
        : formatUnits(p.amount, decs)
      : formatUnits(p.amount, decs)

  useEffect(() => {
    console.debug('[PositionCard] display amount resolved', {
      protocol: p.protocol,
      token: String(p.token),
      svaultDecimals: VAULT_ADDR ? svtDec : '(none)',
      svaultBalance: VAULT_ADDR ? svtBal?.toString() : '(none)',
      decimalsUsed: decs,
      displayAmt,
    })
  }, [displayAmt, decs, p.protocol, p.token, svtBal, svtDec, VAULT_ADDR])

  // ----- APY from Morpho yields -----
  const { yields } = useYields()
  const displayToken = morphoDisplayToken(p.token as MorphoToken)
  const vaultAddr =
    p.token === 'USDCe'
      ? MORPHO_POOLS['usdce-supply']
      : p.token === 'USDT0'
      ? MORPHO_POOLS['usdt0-supply']
      : MORPHO_POOLS['weth-supply']

  const morphoApy =
    yields?.find(
      (y) =>
        y.protocolKey === 'morpho-blue' &&
        y.chain === 'lisk' &&
        (y.token === displayToken ||
         y.poolAddress.toLowerCase() === vaultAddr.toLowerCase()),
    )?.apy

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-50 via-white to-gray-50 p-5 shadow transition hover:-translate-y-1 hover:shadow-lg dark:from-white/5 dark:via-gray-900 dark:to-gray-800">
      <CardContent>
        <div className="flex items-center justify-between text-xs uppercase text-gray-500 dark:text-gray-400">
          <span>{p.chain}</span>
          {typeof morphoApy === 'number' && (
            <span className="text-teal-600 dark:text-teal-400">{morphoApy.toFixed(2)}%</span>
          )}
        </div>

        <p className="mt-2 truncate text-3xl font-bold">
          {displayAmt}{' '}
          <span className="text-lg font-medium text-gray-500 dark:text-gray-400">
            {String(p.token)}
          </span>
        </p>

        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="bg-teal-600 hover:bg-teal-500"
            onClick={() => onSupply?.(p)}
            disabled={!onSupply}
            title={onSupply ? 'Supply' : 'Supply (unavailable)'}
          >
            Supply
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onWithdraw?.(p)}
            disabled={!onWithdraw}
            title={onWithdraw ? 'Withdraw' : 'Withdraw (unavailable)'}
          >
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
