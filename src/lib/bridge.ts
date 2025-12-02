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
import { optimism, lisk } from 'viem/chains'
import { ADAPTER_KEYS, ROUTERS, TokenAddresses, RELAYER_LISK } from './constants'
import type { ChainId, TokenSymbol } from './constants'
import { BigNumberish } from 'ethers'

const API = process.env.LIFI_API as string

export type RouterPushResult = {
  txHash: `0x${string}`              // user's bridge/send tx (if any)
  routerTxHash?: `0x${string}`       // L2 router tx that emitted Deposited
  received?: bigint                  // actual tokens router delivered to adapter/safe
  fee?: bigint                       // optional, if you compute it
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
      return 'USDCe' // fallback for non-morpho routes
  }
}

/** Map UI symbol to the *actual* representation on a chain. */
function resolveSymbolForChain(token: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    if (token === 'USDC') return 'USDCe'
    // Lisk has both USDT and USDT0; keep as provided
    return token
  }
  // OP cannot have USDCe/USDT0
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
   Simple bridge (withdrawals)
   ──────────────────────────────────────────────────────────────── */

/**
 * Bridge on withdrawal in one shot (bridge+swap if needed).
 * Examples:
 *   - USDCe (Lisk) -> USDC (OP)   ✅
 *   - USDT0 (Lisk) -> USDT (OP)   ✅
 */
export async function bridgeWithdrawal(params: {
  srcVaultToken: 'USDCe' | 'USDT0' | 'WETH'   // token you HAVE on Lisk after redeem
  destToken: 'USDC' | 'USDT' | 'WETH'         // token you want to RECEIVE on OP
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
  const { srcVaultToken, destToken, amount, to, walletClient, opts } = params

  const account = walletClient.account?.address as `0x${string}` | undefined
  if (!account)
    throw new Error('No account found on WalletClient – connect a wallet first')

  // Wire LI.FI to the active wallet (auto switch supported by switchChainHook)
  configureLifiWith(walletClient)

  // Source is ALWAYS Lisk for withdrawals
  const originChainId = CHAIN_ID.lisk
  const destinationChainId = CHAIN_ID[to]

  // Source token on Lisk (USDCe/USDT0/WETH)
  const inputToken = tokenAddress(srcVaultToken, 'lisk')
  // Destination is the native representation on OP (USDC/USDT/WETH)
  const outputToken = tokenAddress(destToken, to)

  const quote = await getQuote({
    fromChain: originChainId,
    toChain: destinationChainId,
    fromToken: inputToken,
    toToken: outputToken,
    fromAmount: amount.toString(),
    fromAddress: account,
    // Explicit toAddress = user, for clarity
    toAddress: account,
    slippage: opts?.slippage ?? 0.003,
    allowBridges: opts?.allowBridges,
    allowExchanges: opts?.allowExchanges,
  })

  const route = convertQuoteToRoute(quote)

  return executeRoute(route, {
    updateRouteHook: (updated) => opts?.onUpdate?.(updated),
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

/* ────────────────────────────────────────────────────────────────
   Simple bridge (deposits) — OP → Lisk → RELAYER_LISK
   ──────────────────────────────────────────────────────────────── */

   export async function bridgeTokens(
    token: TokenSymbol,        // token you want to receive on `to`
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
      /** Force the source-side token (e.g. 'USDC', 'USDT', 'USDT0', 'USDCe') */
      sourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT' | 'USDT0' | 'USDCe'>
    }
  ) {
    const account = walletClient.account?.address as `0x${string}` | undefined
    if (!account) {
      throw new Error('No account found on WalletClient – connect a wallet first')
    }
  
    configureLifiWith(walletClient)
  
    const originChainId      = CHAIN_ID[from]
    const destinationChainId = CHAIN_ID[to]
  
    // ---- Resolve source symbol, then map to a concrete address ----
    const sourceSymbol = opts?.sourceToken ?? token
  
    let inputToken: `0x${string}`
  
    // Hard-enforce OP USDT0 when requested
    if (sourceSymbol === 'USDT0' && from === 'optimism') {
      inputToken = TokenAddresses.USDT0.optimism as `0x${string}`
    } else if (sourceSymbol === 'USDCe' && from === 'lisk') {
      inputToken = TokenAddresses.USDCe.lisk as `0x${string}`
    } else {
      // fallback to your generic resolver for all other cases
      inputToken = tokenAddress(sourceSymbol, from)
    }
  
    const outputToken = tokenAddress(token, to)
  
    // 👇 IMPORTANT: any bridge *to Lisk* should land on the relayer, not the user
    const toAddressForBridge: `0x${string}` =
      to === 'lisk' ? RELAYER_LISK : account
  
    console.log('Bridging tokens with LI.FI:', {
      originChainId,
      destinationChainId,
      sourceSymbol,
      destSymbol: token,
      from,
      to,
      inputToken,
      outputToken,
      amount: amount.toString(),
      fromAddress: account,
      toAddress: toAddressForBridge,
    })
  
    const quote = await getQuote({
      fromChain: originChainId,
      toChain: destinationChainId,
      fromToken: inputToken,
      toToken: outputToken,
      fromAmount: amount.toString(),
      fromAddress: account,             // user pays / signs on source
      toAddress: toAddressForBridge,    // ✅ funds on Lisk go to relayer
      slippage: opts?.slippage ?? 0.003,
      allowBridges: opts?.allowBridges,
      allowExchanges: opts?.allowExchanges,
    })
  
    const route = convertQuoteToRoute(quote)
  
    console.log('LI.FI route:', JSON.stringify(route, null, 2))
  
    // 🔍 capture latest txHash from route execution
    let lastTxHash: `0x${string}` | undefined
  
    const executed = await executeRoute(route, {
      updateRouteHook: (updated) => {
        try {
          // drill into steps → execution → process[] → txHash
          for (const step of updated.steps ?? []) {
            const processes = step.execution?.process ?? []
            for (const p of processes) {
              if (p?.txHash) {
                lastTxHash = p.txHash as `0x${string}`
              }
            }
          }
        } catch (err) {
          console.warn('[bridgeTokens] failed to extract txHash from route', err)
        }
  
        // still forward updates to caller if they provided a hook
        opts?.onUpdate?.(updated)
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
  
    console.log('[bridgeTokens] final txHash:', lastTxHash)
  
    return {
      route: executed,
      txHash: lastTxHash,
    }
  }
  
/* ────────────────────────────────────────────────────────────────
   Router-based flows (kept, but OP-only source)
   ──────────────────────────────────────────────────────────────── */

const ROUTER_ABI = parseAbi([
  'function deposit(bytes32 key, address asset, uint256 amount, address onBehalfOf, bytes data) external',
])
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 value) external returns (bool)',
])

/**
 * One-click contract-call route:
 *  - LI.FI bridges to Lisk and makes ≥ `amount` of `destToken` available
 *  - Approves your Lisk router to spend it (USDT0 uses approve(0)->approve(amount))
 *  - Calls `AggregatorRouter.deposit(key, asset, amount, user, '0x')`
 * Router then pulls tokens from LI.FI executor and deposits via your adapter.
 *
 * NOTE: Source chain is OP-only in this build.
 */
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
  const {
    user,
    destToken,
    srcChain,
    srcToken,
    amount,
    adapterKey,
    minBps = 30,
    walletClient,
  } = params
  if (!user) throw new Error('user missing')

  // enforce adapter ↔ dest token match
  const must = requiredDestForAdapter(adapterKey)
  if (must !== destToken)
    throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId = CHAIN_ID.lisk
  const fromToken = tokenAddress(srcToken, srcChain)
  const toToken = tokenAddress(destToken, 'lisk')
  const routerAddr = ROUTERS.lisk

  // router.deposit(...)
  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'deposit',
    args: [adapterKey, toToken, amount, user, '0x'],
  })

  const needsUsdtFix = destToken === 'USDT0'

  const contractCalls: any[] = []

  if (needsUsdtFix) {
    // USDT-style allowance reset — every call includes fromAmount/fromTokenAddress/toTokenAddress
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

  // The only call that actually consumes tokens
  contractCalls.push({
    fromAmount: amount.toString() as BigNumberish,
    fromTokenAddress: toToken,
    toTokenAddress: toToken,
    toContractAddress: routerAddr,
    toContractCallData: depositCalldata,
    toContractGasLimit: '300000',
    ...(needsUsdtFix ? {} : { toApprovalAddress: routerAddr }),
  })

  console.log('contractCalls sent to LI.FI:', JSON.stringify(contractCalls, null, 2))
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
  srcChain: 'optimism'
  srcToken: 'USDC' | 'USDT' | 'WETH'
  amount: bigint
  adapterKey: `0x${string}`
  walletClient: WalletClient
}) {
  const { user, destToken, srcChain, srcToken, amount, adapterKey, walletClient } =
    params

  const must =
    adapterKey === ADAPTER_KEYS.morphoLiskUSDT0
      ? 'USDT0'
      : adapterKey === ADAPTER_KEYS.morphoLiskUSDCe
      ? 'USDCe'
      : 'WETH'
  if (must !== destToken)
    throw new Error(`Adapter/token mismatch: adapter requires ${must}, got ${destToken}`)

  configureLifiWith(walletClient)

  const fromChainId = CHAIN_ID[srcChain]
  const toChainId = CHAIN_ID.lisk
  const fromToken = tokenAddress(srcToken, srcChain)
  const toToken = tokenAddress(destToken, 'lisk')
  const routerAddr = ROUTERS.lisk

  const amt = amount.toString(10)

  // 1) executor → token: transfer(router, amount)  (consumes `amount`)
  const transferCalldata = encodeFunctionData({
    abi: parseAbi(['function transfer(address to, uint256 value) external returns (bool)']),
    functionName: 'transfer',
    args: [routerAddr, amount],
  })

  // 2) executor → router: depositFromBalance(...)   (no token spend)
  const depositCalldata = encodeFunctionData({
    abi: ROUTER_ABI_PUSH,
    functionName: 'depositFromBalance',
    args: [adapterKey, toToken, amount, user, '0x'],
  })

  const contractCalls: ContractCall[] = [
    {
      fromAmount: amt, // spends dest token
      fromTokenAddress: toToken,
      toContractAddress: toToken,
      toContractCallData: transferCalldata,
      toContractGasLimit: '90000',
    },
    {
      fromAmount: BigInt(1).toString(), // no spend here
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
