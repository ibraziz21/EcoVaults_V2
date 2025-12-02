// src/lib/fetchYields.ts
//
// Morpho Blue (Lisk) only.
// TVL via src/lib/tvl.ts (robust; never throws).
// APY via Merkl (LSK) campaigns summed per vault.

import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { getTvlUsd, MORPHO_VAULTS } from '@/lib/tvl'

/** Merkl APR map keyed by vault address (lowercased). */
async function fetchMerklLiskMorphoRewards(): Promise<Record<string, number>> {
  const wanted = new Set(Object.values(MORPHO_VAULTS).map((a) => a.toLowerCase()))
  const out: Record<string, number> = {}

  try {
    const res = await fetch('https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK', { cache: 'no-store' })
    const raw = await res.json()
    if (!Array.isArray(raw)) return {}

    for (const c of raw) {
      const sym = String(c?.rewardToken?.symbol ?? c?.rewardTokens?.[0]?.symbol ?? '').toUpperCase()
      if (sym !== 'LSK') continue

      const aprCandidates = [
        c?.apr,
        c?.globalApr,
        c?.estimatedApr,
        c?.rewardTokens?.[0]?.apr,
        c?.rewards?.[0]?.apr,
      ]
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0)

      const apr = aprCandidates[0] ?? 0
      if (apr <= 0) continue

      const targets = new Set<string>()
      const tryAdd = (a: unknown) => {
        if (typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) targets.add(a.toLowerCase())
      }

      tryAdd(c?.params?.targetToken)
      tryAdd(c?.params?.target)
      tryAdd(c?.params?.vault)
      tryAdd(c?.params?.vaultAddress)
      tryAdd(c?.target?.address)
      tryAdd(c?.pool?.address)
      ;(c?.params?.targetTokens ?? []).forEach(tryAdd)
      ;(c?.targets ?? []).forEach((t: any) => tryAdd(t?.address))

      if (targets.size === 0) {
        const blob = JSON.stringify(c)
        const matches = blob.match(/0x[0-9a-fA-F]{40}/g) ?? []
        matches.forEach((m) => targets.add(m.toLowerCase()))
      }

      for (const t of targets) {
        if (wanted.has(t)) out[t] = (out[t] ?? 0) + apr
      }
    }
  } catch {
    /* ignore network/schema errors; return what we have */
  }
  return out
}

// Morpho Blue (Lisk)
async function buildMorpho(): Promise<YieldSnapshot[]> {
  type Chain = 'lisk'
  const chain: Chain = 'lisk'
  const tokens = ['USDCe', 'USDT0', 'WETH'] as const
  const merkl = await fetchMerklLiskMorphoRewards()

  const rows: YieldSnapshot[] = []
  for (const t of tokens) {
    const vault = MORPHO_VAULTS[t]
    const underlying =
      t === 'WETH'
        ? (TokenAddresses.WETH.lisk as `0x${string}`)
        : t === 'USDCe'
          ? (TokenAddresses.USDCe.lisk as `0x${string}`)
          : (TokenAddresses.USDT0.lisk as `0x${string}`)

    const tvlUSD = await getTvlUsd({ protocol: 'Morpho Blue', chain, token: t })
    const apy = merkl[vault.toLowerCase()] ?? 0

    // Normalize to app-wide display tokens:
    const displayToken = t === 'USDCe' ? 'USDC' : t === 'USDT0' ? 'USDT' : 'WETH'

    rows.push({
      id: `lisk-morpho-${t.toLowerCase()}`,
      chain,
      protocol: 'Morpho Blue',
      protocolKey: 'morpho-blue',
      poolAddress: vault,
      token: displayToken as YieldSnapshot['token'],
      apy,
      tvlUSD,
      updatedAt: new Date().toISOString(),
      underlying,
    })
  }
  return rows
}

export async function fetchYields(): Promise<YieldSnapshot[]> {
  const morpho = await buildMorpho().catch(() => [])
  return morpho.sort((a, b) => a.token.localeCompare(b.token))
}
