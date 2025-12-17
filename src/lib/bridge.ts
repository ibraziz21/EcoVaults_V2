// src/lib/bridge.ts
'use client'

import {
  createConfig,
  EVM,
  getQuote,
  getContractCallsQuote,
  convertQuoteToRoute,
  executeRoute,
  ContractCall,
} from '@lifi/sdk'
import type { WalletClient } from 'viem'
import { parseAbi, encodeFunctionData } from 'viem'
import { optimism, base, lisk } from 'viem/chains'
import { ADAPTER_KEYS, ROUTERS, TokenAddresses } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import type { BigNumberish } from 'ethers'
import 'dotenv/config'

const API = process.env.LIFI_API as string

export type RouterPushResult = {
  txHash: `0x${string}`              // user's bridge/send tx (if any)
  routerTxHash?: `0x${string}`       // L2 router tx that emitted Deposited
  received?: bigint                  // actual tokens router delivered
  fee?: bigint
}

/* ────────────────────────────────────────────────────────────────
   Chain + symbol helpers
   ──────────────────────────────────────────────────────────────── */
const CHAIN_ID: Record<ChainId, number> = {
  optimism: optimism.id,
  base: base.id,
  lisk: lisk.id,
}

function requiredDestForAdapter(key: `0x${string}`): 'USDT0' | 'USDCe' | 'WETH' {
  switch (key) {
    case ADAPTER_KEYS.morphoLiskUSDT0: return 'USDT0'
    case ADAPTER_KEYS.morphoLiskUSDCe: return 'USDCe'
    case ADAPTER_KEYS.morphoLiskWETH:  return 'WETH'
    default:                           return 'USDCe'
  }
}

/** Map UI symbol to the *actual* representation on a chain. */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
    return token
  }
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

const toHexChain = (id: number) => `0x${id.toString(16)}`

/* ────────────────────────────────────────────────────────────────
   Route parsing helpers (txHash + stage)
   ──────────────────────────────────────────────────────────────── */

type BridgeStage = 'quote' | 'signature_required' | 'submitted' | 'confirming' | 'completed' | 'failed' | 'running'

function isTxHash(x: unknown): x is `0x${string}` {
  return typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x)
}

function extractTxHashFromRoute(route: any): `0x${string}` | null {
  const steps = route?.steps
  if (!Array.isArray(steps)) return null

  for (const s of steps) {
    const procs = s?.execution?.process
    if (!Array.isArray(procs)) continue

    for (const p of procs) {
      const direct = p?.txHash ?? p?.transactionHash ?? p?.hash
      if (isTxHash(direct)) return direct

      const txHashes = p?.txHashes
      if (Array.isArray(txHashes)) {
        for (const h of txHashes) {
          if (isTxHash(h)) return h
        }
      }
    }
  }
  return null
}

function deriveStage(route: any): BridgeStage {
  // Prefer execution/process status if present
  const steps = route?.steps
  if (!Array.isArray(steps)) return 'running'

  // FAILED?
  for (const s of steps) {
    const sStatus = String(s?.execution?.status ?? '').toUpperCase()
    if (sStatus === 'FAILED') return 'failed'
    const procs = s?.execution?.process
    if (Array.isArray(procs)) {
      for (const p of procs) {
        const ps = String(p?.status ?? '').toUpperCase()
        if (ps === 'FAILED') return 'failed'
      }
    }
  }

  // COMPLETED?
  const allDone = steps.length > 0 && steps.every((s: any) => String(s?.execution?.status ?? '').toUpperCase() === 'DONE')
  if (allDone) return 'completed'

  // ACTION REQUIRED? (wallet signature)
  for (const s of steps) {
    const procs = s?.execution?.process
    if (!Array.isArray(procs)) continue
    for (const p of procs) {
      const ps = String(p?.status ?? '').toUpperCase()
      if (ps === 'ACTION_REQUIRED') return 'signature_required'
    }
  }

  // SUBMITTED? (has tx hash)
  const h = extractTxHashFromRoute(route)
  if (h) {
    // If any process is still running/pending, treat as confirming
    for (const s of steps) {
      const procs = s?.execution?.process
      if (!Array.isArray(procs)) continue
      for (const p of procs) {
        const ps = String(p?.status ?? '').toUpperCase()
        if (ps === 'PENDING' || ps === 'STARTED') return 'submitted'
      }
    }
    return 'confirming'
  }

  return 'running'
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
        switchChain: async (chainId) => {
          if (!_activeWallet) throw new Error('Wallet not set for LI.FI')
          await _activeWallet.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: toHexChain(chainId) }],
          })
          return _activeWallet
        },
      }),
    ],
  })

  _configured = true
}

/* ────────────────────────────────────────────────────────────────
   Simple bridge (existing)
   ──────────────────────────────────────────────────────────────── */

export async function bridgeWithdrawal(params: {
  srcVaultToken: 'USDCe' | 'USDT0' | 'WETH'
  destToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  to: 'optimism' | 'base'
  walletClient: WalletClient
  opts?: {
    slippage?: number
    allowBridges?: string[]
    allowExchanges?: string[]
    onUpdate?: (route: any) => void
    onRateChange?: (nextToAmount: string) => Promise<boolean> | boolean
  }
}) {
  const { srcVaultToken, destToken, amount, to, walletClient, opts } = params

  const account = walletClient.account?.address as `0x${string}` | undefined
  if (!account) throw new Error('No account found on WalletClient – connect a wallet first')

  configureLifiWith(walletClient)

  const originChainId = CHAIN_ID.lisk
  const destinationChainId = CHAIN_ID[to]

  const inputToken = tokenAddress(srcVaultToken, 'lisk')
  const outputToken = tokenAddress(destToken, to)

  const quote = await getQuote({
    fromChain: originChainId,
    toChain: destinationChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: account,
    slippage: opts?.slippage ?? 0.003,
    allowBridges: opts?.allowBridges,
    allowExchanges: opts?.allowExchanges,
  })

  const route = convertQuoteToRoute(quote)

  return executeRoute(route, {
    updateRouteHook: (updated) => {
      const txHash = extractTxHashFromRoute(updated)
      const stage = deriveStage(updated)
      opts?.onUpdate?.({ ...updated, txHash, stage })
    },
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async (p) => {
      if (opts?.onRateChange) return await opts.onRateChange(p.newToAmount)
      return true
    },
  })
}

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

  configureLifiWith(walletClient)

  const originChainId = CHAIN_ID[from]
  const destinationChainId = CHAIN_ID[to]

  const sourceSymbol = opts?.sourceToken ?? token

  let inputToken: `0x${string}`
  if (sourceSymbol === 'USDT0' && from === 'optimism') {
    inputToken = TokenAddresses.USDT0.optimism as `0x${string}`
  } else if (sourceSymbol === 'USDCe' && from === 'lisk') {
    inputToken = TokenAddresses.USDCe.lisk as `0x${string}`
  } else {
    inputToken = tokenAddress(sourceSymbol, from)
  }

  const outputToken = tokenAddress(token, to)

  const quote = await getQuote({
    fromChain: originChainId,
    toChain: destinationChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: account,
    slippage: opts?.slippage ?? 0.003,
    allowBridges: opts?.allowBridges,
    allowExchanges: opts?.allowExchanges,
  })

  const route = convertQuoteToRoute(quote)

  return executeRoute(route, {
    updateRouteHook: (updated) => {
      const txHash = extractTxHashFromRoute(updated)
      const stage = deriveStage(updated)

      // ✅ IMPORTANT: make UI usable immediately
      // - ACTION_REQUIRED => wallet needs signature
      // - SUBMITTED/CONFIRMING => tx hash exists (bridge submitted)
      opts?.onUpdate?.({ ...updated, txHash, stage })
    },
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChain(chainId) }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async (p) => {
      if (opts?.onRateChange) return await opts.onRateChange(p.newToAmount)
      return true
    },
  })
}

/* ────────────────────────────────────────────────────────────────
   Router contract-call flows (unchanged)
   ──────────────────────────────────────────────────────────────── */

const ROUTER_ABI = parseAbi([
  'function deposit(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])

export async function bridgeAndDepositViaRouter(params: {
  user: `0x${string}`
  destToken: 'USDT0' | 'USDCe' | 'WETH'
  srcChain: 'optimism' | 'base'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  minBps?: number
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, minBps = 30, walletClient } = params
  if (!user) throw new Error('user missing')

  const must = requiredDestForAdapter(adapterKey)
  if (must !== destToken) throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

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
    const approve0 = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [routerAddr, 0n] })
    const approveN = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [routerAddr, amount] })

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

  const _min = amount - (amount * BigInt(minBps)) / 10_000n
  void _min

  const quote = await getContractCallsQuote({
    fromAddress: user,
    fromChain: fromChainId,
    fromToken,
    toChain: toChainId,
    toToken: toToken,
    toAmount: amount.toString(),
    contractCalls,
  })

  const route = convertQuoteToRoute(quote)
  return executeRoute(route, {
    updateRouteHook: () => {},
    switchChainHook: async (chainId) => {
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
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
  srcChain: 'optimism' | 'base'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, walletClient } = params

  const must =
    adapterKey === ADAPTER_KEYS.morphoLiskUSDT0 ? 'USDT0' :
      adapterKey === ADAPTER_KEYS.morphoLiskUSDCe ? 'USDCe' : 'WETH'
  if (must !== destToken) throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

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
      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chainId.toString(16)}` }],
      })
      return walletClient
    },
    acceptExchangeRateUpdateHook: async () => true,
  })
}
