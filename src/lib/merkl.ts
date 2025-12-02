// src/lib/merkl.ts
import type { Address } from 'viem'
import { optimism, base, lisk } from 'viem/chains'

/** Merkl Distributor — same on most chains per docs; override per chain if needed. */
export const MERKL_DISTRIBUTOR: Partial<Record<number, Address>> = {
  [optimism.id]: '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae',
  [base.id]:     '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae',
  [lisk.id]:     '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae',
}

/** Minimal Distributor ABI (claim per-token with proofs) */
export const distributorAbi = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'users',   type: 'address[]'   },
      { name: 'tokens',  type: 'address[]'   },
      { name: 'amounts', type: 'uint256[]'   },
      { name: 'proofs',  type: 'bytes32[][]' },
    ],
    outputs: [],
  },
] as const

/* ──────────────────────────────────────────────────────────────── */
/* API types (Merkl v4)                                            */
/* ──────────────────────────────────────────────────────────────── */

export interface MerklRewardItem {
  token: {
    address: Address
    symbol: string
    decimals: number
  }
  /** total credited (wei, as string) */
  amount: string
  /** already claimed on this token (wei, as string) */
  claimed: string
  /** pending rewards that are *not yet* in `amount` */
  pending: string
  /** merkle proof as array of bytes32 */
  proofs: `0x${string}`[]
}


export interface MerklRewardsByChain {
  chain: { id: number; name: string }
  rewards: MerklRewardItem[]
}

/**
 * Fetch claimable rewards for a user on 1+ chains (Merkl API v4).
 *
 * NOTE: Merkl caches this route per chain.
 * To avoid showing stale balances after a claim, we always pass
 * `reloadChainId=<chainId>` for each chain we query.
 */
export async function fetchMerklRewards(params: {
  user: Address
  chainIds: number[]
  apiBase?: string // defaults to https://api.merkl.xyz
}): Promise<MerklRewardsByChain[]> {
  const { user, chainIds, apiBase = 'https://api.merkl.xyz' } = params

  const allResults: MerklRewardsByChain[] = []

  for (const chainId of chainIds) {
    const url = `${apiBase}/v4/users/${user}/rewards?chainId=${chainId}&reloadChainId=${chainId}`

    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`Merkl API error on chain ${chainId}: ${res.status}`)
    }

    const data = (await res.json()) as MerklRewardsByChain[]
    allResults.push(...data)
  }

  return allResults
}

/** Build flat arrays for Distributor.claim(...) for a specific chain. */
export function buildClaimArgs(input: {
  user: Address
  items: MerklRewardItem[]
}): {
  users: Address[]
  tokens: Address[]
  amounts: bigint[]
  proofs: `0x${string}`[][]
} {
  const users: Address[] = []
  const tokens: Address[] = []
  const amounts: bigint[] = []
  const proofs: `0x${string}`[][] = []

  for (const r of input.items) {
    users.push(input.user)
    tokens.push(r.token.address)
    amounts.push(BigInt(r.amount))
    proofs.push(r.proofs)
  }

  return { users, tokens, amounts, proofs }
}
