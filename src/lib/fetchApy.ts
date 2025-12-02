// src/lib/fetchApy.ts
// Morpho-only APY helper (APR from Merkl, summed per vault)

import { MORPHO_VAULTS } from '@/lib/tvl'

export type LiskMorphoToken = 'USDCe' | 'USDT0' | 'WETH'

/** Fetch Merkl APR (as % APY approximation) for a given Morpho Lisk vault token. */
export async function fetchApy(p: {
  protocol: 'Morpho Blue'
  chain: 'lisk'
  token: LiskMorphoToken
}): Promise<number> {
  const vaultAddr = MORPHO_VAULTS[p.token]?.toLowerCase()
  if (!vaultAddr) return 0

  try {
    const res = await fetch('https://api.merkl.xyz/v4/campaigns?tokenSymbol=LSK', { cache: 'no-store' })
    const raw = await res.json()
    if (!Array.isArray(raw)) return 0

    let apr = 0
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

      const thisApr = aprCandidates[0] ?? 0
      if (thisApr <= 0) continue

      // collect any addresses present on the campaign and check if our vault is among them
      const blob = JSON.stringify(c)
      const matches = blob.match(/0x[0-9a-fA-F]{40}/g) ?? []
      const hasVault = matches.some((m) => m.toLowerCase() === vaultAddr)
      if (hasVault) apr += thisApr
    }

    return apr
  } catch {
    return 0
  }
}
