// src/components/deposit/helpers.ts
// Morpho-only helpers (OP/Base/Lisk wallet reads & symbol/address mapping)

'use client'

import { erc20Abi, type Address } from 'viem'
import { base, optimism, lisk as liskChain } from 'viem/chains'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'
import { TokenAddresses } from '@/lib/constants'
import type {  YieldSnapshot } from '@/hooks/useYields'
import type { EvmChain } from './types'

type WalletToken = YieldSnapshot['token']

export function clientFor(chain: EvmChain) {
  if (chain === 'optimism') return publicOptimism
  if (chain === 'base') return publicBase
  return publicLisk
}

export function chainIdOf(chain: EvmChain) {
  if (chain === 'optimism') return optimism.id
  if (chain === 'base') return base.id
  return liskChain.id
}

export function mapCrossTokenForDest(symbol: WalletToken, dest: EvmChain): WalletToken {
  if (dest !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol // WETH stays WETH; USDCe/USDT0 remain as-is
}

/** Resolve token address for a chain */
export function tokenAddrFor(symbol: WalletToken, chain: EvmChain): `0x${string}` {
  const m = TokenAddresses[symbol] as Partial<Record<EvmChain, `0x${string}`>>
  const addr = m?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

export function symbolForWalletDisplay(symbol: WalletToken, chain: EvmChain): WalletToken {
  if (chain === 'lisk') {
    if (symbol === 'USDC') return 'USDCe'
    if (symbol === 'USDT') return 'USDT0'
    return symbol
  } else {
    if (symbol === 'USDCe') return 'USDC'
    if (symbol === 'USDT0') return 'USDT'
    return symbol
  }
}

/** Read wallet balance for a token on a chain */
export async function readWalletBalance(
  chain: EvmChain,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return (await clientFor(chain).readContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  })) as bigint
}
