// src/lib/bridge.ts
'use client'

import {
  createConfig,
  EVM,
  getQuote,
  getContractCallsQuote,
  convertQuoteToRoute,
  executeRoute,
  type ContractCall,
} from '@lifi/sdk'
import type { WalletClient } from 'viem'
import { parseAbi, encodeFunctionData } from 'viem'
import { optimism, lisk } from 'viem/chains'
import { ADAPTER_KEYS, ROUTERS, TokenAddresses, RELAYER_LISK } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { BigNumberish } from 'ethers'

const API = process.env.LIFI_API as string

export type RouterPushResult = {
  txHash: `0x${string}` // user's bridge/send tx (if any)
  routerTxHash?: `0x${string}`
  received?: bigint
  fee?: bigint
}

/* ────────────────────────────────────────────────────────────────
   Chain + symbol helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  lisk: lisk.id,
}

function requiredDestForAdapter(key: `0x${string}`): 'USDT0' | 'USDCe' | 'WETH' {
  switch (key) {
    case ADAPTER_KEYS.morphoLiskUSDT0:
      return 'USDT0'
    case ADAPTER_KEYS.morphoLiskUSDCe:
      return 'USDCe'
    case ADAPTER_KEYS.morphoLiskWETH:
      return 'WETH'
    default:
      return 'USDCe'
  }
}

function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
    return token
  }
  if (token === 'USDCe') return 'USDC'
  if (token === 'USDT0') return 'USDT'
  return token
}

function tokenAddress(token: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = resolveSymbolForChain(token, chain)
  const map = TokenAddresses[sym] as Partial<Record<ChainId, string>>
  const addr = map?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

/* ────────────────────────────────────────────────────────────────
   OP-only guard (NO auto switching; Safe Apps compatible)
   ──────────────────────────────────────────────────────────────── */

function assertOptimismOnly(walletClient: WalletClient, requestedChainId?: number) {
  if (requestedChainId != null && requestedChainId !== optimism.id) {
    throw new Error(
      `This action must be signed on OP Mainnet only (requested chainId=${requestedChainId}).`,
    )
  }

  const current = walletClient.chain?.id
  if (current && current !== optimism.id) {
    throw new Error('Please switch your wallet to OP Mainnet to continue.')
  }
}

/* ────────────────────────────────────────────────────────────────
   LI.FI provider wiring (idempotent)
   ──────────────────────────────────────────────────────────────── */
let _configured = false
let _activeWallet: WalletClient | null = null

export function configureLifiWith(walletClient: WalletClient) {
  _activeWallet = walletClient
  if (_configured) return

  createConfig({
    integrator: 'superYLDR',
    apiKey: API,
    providers: [
      EVM({
        getWalletClient: async () => {
          if (!_activeWallet) throw new Error('Wallet not set for LI.FI')
          return _activeWallet
        },

        // OP-only: never switch chains programmatically
        switchChain: async (chainId) => {
          if (!_activeWallet) throw new Error('Wallet not set for LI.FI')
          assertOptimismOnly(_activeWallet, chainId)
          return _activeWallet
        },
      }),
    ],
  })

  _configured = true
}

/* ────────────────────────────────────────────────────────────────
   Withdraw bridge (client-side) — intentionally unsupported
   ──────────────────────────────────────────────────────────────── */
export async function bridgeWithdrawal(params: {
  srcVaultToken: 'USDCe' | 'USDT0' | 'WETH'
  destToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  to: 'optimism'
  walletClient: WalletClient
  opts?: {
    slippage?: number
    allowBridges?: string[]
    allowExchanges?: string[]
    onUpdate?: (route: any) => void
    onRateChange?: (nextToAmount: string) => Promise<boolean> | boolean
  }
}) {
  // In Safe-first OP-only model, user should not sign from Lisk in browser.
  throw new Error('bridgeWithdrawal() is not supported in client. Use relayer/server-side bridging.')
}

/* ────────────────────────────────────────────────────────────────
   Deposit bridge — OP → Lisk → RELAYER_LISK
   ──────────────────────────────────────────────────────────────── */

export async function bridgeTokens(
  token: TokenSymbol,
  amount: bigint,
  from: ChainId,
  to: ChainId,
  walletClient: WalletClient,
  opts?: {
    slippage?: number
    allowBridges?: string[]
    allowExchanges?: string[]
    onUpdate?: (route: any) => void
    onRateChange?: (nextToAmount: string) => Promise<boolean> | boolean
    sourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT' | 'USDT0' | 'USDCe'>
  },
) {
  const account = walletClient.account?.address as `0x${string}` | undefined
  if (!account) throw new Error('No account found on WalletClient – connect a wallet first')

  // enforce OP-only signing for client bridge
  if (from !== 'optimism') {
    throw new Error(`bridgeTokens() in the client is OP-only. Got from=${from}.`)
  }

  // must be on OP (no auto switching)
  assertOptimismOnly(walletClient, optimism.id)

  configureLifiWith(walletClient)

  const originChainId = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  const sourceSymbol = opts?.sourceToken ?? token

  let inputToken: `0x${string}`
  if (sourceSymbol === 'USDT0' && from === 'optimism') {
    inputToken = TokenAddresses.USDT0.optimism as `0x${string}`
  } else {
    inputToken = tokenAddress(sourceSymbol, from)
  }

  const outputToken = tokenAddress(token, to)

  const toAddressForBridge: `0x${string}` = to === 'lisk' ? RELAYER_LISK : account

  const quote = await getQuote({
    fromChain: originChainId,
    toChain: destinationChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: account,
    toAddress: toAddressForBridge,
    slippage: opts?.slippage ?? 0.003,
    allowBridges: opts?.allowBridges,
    allowExchanges: opts?.allowExchanges,
  })

  const route = convertQuoteToRoute(quote)
  const routeId = (route as any)?.id ?? (quote as any)?.id
  console.log('[bridgeTokens] routeId', routeId, {
    quoteId: (quote as any)?.id,
    routeIdFromRoute: (route as any)?.id,
  })

  let lastTxHash: `0x${string}` | undefined

  const executed = await executeRoute(route, {
    updateRouteHook: (updated) => {
      try {
        for (const step of updated.steps ?? []) {
          const processes = step.execution?.process ?? []
          for (const p of processes) {
            if (p?.txHash) lastTxHash = p.txHash as `0x${string}`
          }
        }
      } catch (err) {
        console.warn('[bridgeTokens] failed to extract txHash from route', err)
      }
      opts?.onUpdate?.(updated)
    },

    // OP-only: never switch chains programmatically
    switchChainHook: async (chainId) => {
      assertOptimismOnly(walletClient, chainId)
      return walletClient
    },

    acceptExchangeRateUpdateHook: async (p) => {
      if (opts?.onRateChange) return await opts.onRateChange(p.newToAmount)
      return true
    },
  })

  return {
    route: executed,
    routeId,
    txHash: lastTxHash,
  }
}

/* ────────────────────────────────────────────────────────────────
   Router-based flows (kept, but OP-only source)
   ──────────────────────────────────────────────────────────────── */

const ROUTER_ABI = parseAbi([
  'function deposit(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])
const ERC20_ABI = parseAbi(['function approve(address spender, uint256 value) external returns (bool)'])

export async function bridgeAndDepositViaRouter(params: {
  user: `0x${string}`
  destToken: 'USDT0' | 'USDCe' | 'WETH'
  srcChain: 'optimism'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  minBps?: number
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, minBps = 30, walletClient } = params
  if (!user) throw new Error('user missing')

  const must = requiredDestForAdapter(adapterKey)
  if (must !== destToken) {
    throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)
  }

  // OP-only
  assertOptimismOnly(walletClient, optimism.id)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId = CHAIN_ID.lisk
  const fromToken = tokenAddress(srcToken, srcChain)
  const toToken = tokenAddress(destToken, 'lisk')
  const routerAddr = ROUTERS.lisk

  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'deposit',
    args: [adapterKey, toToken, amount, user, '0x'],
  })

  const needsUsdtFix = destToken === 'USDT0'
  const contractCalls: any[] = []

  if (needsUsdtFix) {
    const approve0 = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routerAddr, 0n],
    })
    const approveN = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [routerAddr, amount],
    })

    contractCalls.push(
      {
        fromAmount: '1000000000000000000' as BigNumberish,
        fromTokenAddress: toToken,
        toTokenAddress: toToken,
        toContractAddress: toToken,
        toContractCallData: approve0,
        toContractGasLimit: '80000',
      },
      {
        fromAmount: '1000000000000000000' as BigNumberish,
        fromTokenAddress: toToken,
        toTokenAddress: toToken,
        toContractAddress: toToken,
        toContractCallData: approveN,
        toContractGasLimit: '80000',
      },
    )
  }

  contractCalls.push({
    fromAmount: amount.toString() as BigNumberish,
    fromTokenAddress: toToken,
    toTokenAddress: toToken,
    toContractAddress: routerAddr,
    toContractCallData: depositCalldata,
    toContractGasLimit: '300000',
    ...(needsUsdtFix ? {} : { toApprovalAddress: routerAddr }),
  })

  const quote = await getContractCallsQuote({
    fromAddress: user,
    fromChain: fromChainId,
    fromToken,
    toChain: toChainId,
    toToken,
    toAmount: amount.toString(),
    contractCalls,
  })

  const route = convertQuoteToRoute(quote)

  return executeRoute(route, {
    updateRouteHook: () => {},

    switchChainHook: async (chainId) => {
      assertOptimismOnly(walletClient, chainId)
      return walletClient
    },

    acceptExchangeRateUpdateHook: async () => true,
  })
}

const ROUTER_ABI_PUSH = parseAbi([
  'function depositFromBalance(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])

export async function bridgeAndDepositViaRouterPush(params: {
  user: `0x${string}`
  destToken: 'USDT0' | 'USDCe' | 'WETH'
  srcChain: 'optimism'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, walletClient } = params

  const must =
    adapterKey === ADAPTER_KEYS.morphoLiskUSDT0
      ? 'USDT0'
      : adapterKey === ADAPTER_KEYS.morphoLiskUSDCe
        ? 'USDCe'
        : 'WETH'
  if (must !== destToken) {
    throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)
  }

  // OP-only
  assertOptimismOnly(walletClient, optimism.id)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId = CHAIN_ID.lisk
  const fromToken = tokenAddress(srcToken, srcChain)
  const toToken = tokenAddress(destToken, 'lisk')
  const routerAddr = ROUTERS.lisk

  const amt = amount.toString(10)

  const transferCalldata = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 value) external returns (bool)']),
    functionName: 'transfer',
    args: [routerAddr, amount],
  })

  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI_PUSH,
    functionName: 'depositFromBalance',
    args: [adapterKey, toToken, amount, user, '0x'],
  })

  const contractCalls: ContractCall[] = [
    {
      fromAmount: amt,
      fromTokenAddress: toToken,
      toContractAddress: toToken,
      toContractCallData: transferCalldata,
      toContractGasLimit: '90000',
    },
    {
      fromAmount: BigInt(1).toString(),
      fromTokenAddress: toToken,
      toContractAddress: routerAddr,
      toContractCallData: depositCalldata,
      toContractGasLimit: '300000',
    },
  ]

  const quote = await getContractCallsQuote({
    fromAddress: user,
    fromChain: fromChainId,
    fromToken,
    toChain: toChainId,
    toToken,
    toAmount: amt,
    contractCalls,
  })

  const route = convertQuoteToRoute(quote)

  return executeRoute(route, {
    updateRouteHook: () => {},

    switchChainHook: async (chainId) => {
      assertOptimismOnly(walletClient, chainId)
      return walletClient
    },

    acceptExchangeRateUpdateHook: async () => true,
  })
}
