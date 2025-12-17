// src/lib/quotes.ts
'use client'

import { getQuote } from '@lifi/sdk'
import { optimism, base, lisk as liskChain } from 'viem/chains'
import type { WalletClient } from 'viem'
import { TokenAddresses } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { configureLifiWith } from './bridge'

/* ────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: liskChain.id,
}

/** Map UI symbol to the *actual* representation on a chain for LI.FI */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC')  return 'USDCe'
    return token
  }
  // OP/Base cannot have USDCe/USDT0
  if (token === 'USDCe') return 'USDC'
  if (token === 'USDT0') return 'USDT'
  return token
}

/** Address for (token, chain). Throws if unsupported. */
function tokenAddress(token: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = resolveSymbolForChain(token, chain)
  const map = TokenAddresses[sym] as Partial<Record<ChainId, string>>
  const addr = map?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

function sumIncludedFeeCosts(feeCosts: any[] | undefined): bigint {
  if (!feeCosts || !Array.isArray(feeCosts)) return 0n
  return feeCosts
    .filter((f) => f?.included)
    .reduce<bigint>((acc, f) => {
      try { return acc + BigInt(f.amount ?? '0') } catch { return acc }
    }, 0n)
}

function pickSrcFromBalances(opBal: bigint | null | undefined, baBal: bigint | null | undefined, need: bigint) {
  const op = opBal ?? 0n
  const ba = baBal ?? 0n
  if (op >= need) return 'optimism' as const
  if (ba >= need) return 'base' as const
  return op >= ba ? ('optimism' as const) : ('base' as const)
}

/* ────────────────────────────────────────────────────────────────
   Generic quote (now supports selecting *source* token)
   ──────────────────────────────────────────────────────────────── */
export async function getBridgeQuote(params: {
  token: TokenSymbol           // token desired on destination (e.g. 'USDT0' when to='lisk')
  amount: bigint               // parsed units
  from: ChainId
  to: ChainId
  fromAddress?: `0x${string}`  // optional; improves allowance batching
  slippage?: number            // e.g. 0.003
  walletClient?: WalletClient  // optional (only needed if LI.FI needs provider)
  /** force the *source side* token symbol (USDC|USDT) */
  fromTokenSym?: Extract<TokenSymbol, 'USDC' | 'USDT' | 'USDCe' | 'USDT0'>
}) {
  const { token, amount, from, to, fromAddress, slippage, walletClient, fromTokenSym } = params

  if (walletClient) configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[from]
  const toChainId   = CHAIN_ID[to]

  const inputToken  = tokenAddress(fromTokenSym ?? token, from)  // respects explicit USDC/USDT
  const outputToken = tokenAddress(token, to)                    // maps USDC->USDCe on Lisk, keeps USDT0 on Lisk

  const quote = await getQuote({
    fromChain: fromChainId,
    toChain: toChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: fromAddress!.toString(),
    slippage: slippage ?? 0.003,
  })

  return {
    route: `${from.toUpperCase()} → ${to.toUpperCase()}`,
    estimate: quote.estimate,
    bridgeOutAmount: BigInt(quote.estimate.toAmount),
    bridgeFeeTotal: sumIncludedFeeCosts(quote.estimate.feeCosts),
    inputToken,
    outputToken,
    raw: quote,
  }
}

/* ────────────────────────────────────────────────────────────────
   Convenience wrappers to keep existing modal calls working
   ──────────────────────────────────────────────────────────────── */

/** USDC → USDCe on Lisk (choose OP/Base source by balances) */
export async function quoteUsdceOnLisk(params: {
  amountIn: bigint
  opBal?: bigint | null
  baBal?: bigint | null
  fromAddress?: `0x${string}`
  slippage?: number
  walletClient?: WalletClient
}) {
  const { amountIn, opBal, baBal, fromAddress, slippage, walletClient } = params
  const src = pickSrcFromBalances(opBal, baBal, amountIn)
  const q = await getBridgeQuote({
    token: 'USDCe',
    amount: amountIn,
    from: src,
    to: 'lisk',
    fromAddress,
    slippage,
    walletClient,
    fromTokenSym: 'USDC', // explicitly source USDC on OP/Base
  })
  return {
    route: q.route,
    bridgeFee: q.bridgeFeeTotal,
    bridgeOutUSDCe: q.bridgeOutAmount,
    estimate: q.estimate,
    raw: q.raw,
  }
}

/** USDT/USDC → USDT0 on Lisk (choose OP/Base source by balances; optionally pin source token) */
export async function smartQuoteUsdt0Lisk(params: {
  amountIn: bigint
  opBal?: bigint | null
  baBal?: bigint | null
  fromAddress?: `0x${string}`
  slippage?: number
  walletClient?: WalletClient
  /** force using USDC or USDT as the source token */
  sourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT'>
}) {
  const { amountIn, opBal, baBal, fromAddress, slippage, walletClient, sourceToken } = params
  const src = pickSrcFromBalances(opBal, baBal, amountIn)
  const q = await getBridgeQuote({
    token: 'USDT0',
    amount: amountIn,
    from: src,
    to: 'lisk',
    fromAddress,
    slippage,
    walletClient,
    fromTokenSym: sourceToken ?? 'USDT',
  })
  return {
    route: q.route,
    bridgeFee: q.bridgeFeeTotal,
    bridgeOutUSDT0: q.bridgeOutAmount,
    estimate: q.estimate,
    raw: q.raw,
  }
}
