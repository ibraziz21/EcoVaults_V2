// src/app/api/withdraw/morpho/route.ts
import { NextResponse } from 'next/server'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism, lisk } from 'viem/chains'

// Safe Protocol Kit v4+
import Safe from '@safe-global/protocol-kit'
import type { MetaTransactionData } from '@safe-global/types-kit'
import { OperationType } from '@safe-global/types-kit'

// Contracts / constants
import rewardsVaultAbi from '@/lib/abi/rewardsAbi.json'
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS, REWARDS_VAULT } from '@/lib/constants'

// LI.FI (server-side)
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ─────────────── Env & helpers ─────────────── */
const PK_RE = /^0x[0-9a-fA-F]{64}$/
function normalizePrivateKey(raw?: string): `0x${string}` {
  const s = (raw ?? '').trim().replace(/^['"]|['"]$/g, '')
  if (!s) throw new Error('RELAYER_PRIVATE_KEY is missing')
  const with0x = ('0x' + s.replace(/^0x/i, '')).toLowerCase() as `0x${string}`
  if (!PK_RE.test(with0x)) throw new Error('RELAYER_PRIVATE_KEY format invalid')
  return with0x
}

const RELAYER_PK = normalizePrivateKey(process.env.RELAYER_PRIVATE_KEY)
const LIFI_API   = process.env.LIFI_API || ''
const OP_RPC     = process.env.OP_RPC_URL   || 'https://mainnet.optimism.io'
const LSK_RPC    = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com'

/** Resolve token kind from hints (falls back to USDCe). */
type TokenKind = 'USDCe' | 'USDT0'
function resolveTokenKind(hint?: { tokenSymbol?: string; reward?: string; poolAddress?: string }): TokenKind {
  const t = (hint?.tokenSymbol || hint?.reward || '').toUpperCase()
  if (t.includes('USDT')) return 'USDT0'
  if (hint?.poolAddress) {
    const addr = hint.poolAddress.toLowerCase()
    if (addr === (MORPHO_POOLS['usdt0-supply'] as string).toLowerCase()) return 'USDT0'
  }
  return 'USDCe'
}

/* ─────────────── Clients ─────────────── */
const relayer = privateKeyToAccount(RELAYER_PK)
const opPublic   = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet   = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayer })
const liskPublic = createPublicClient({ chain: lisk,     transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk,     transport: http(LSK_RPC), account: relayer })

/* ─────────────── ABIs ─────────────── */
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function supply(address asset, address onBehalf, uint256 amount, bytes data) external',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
])


/* ─────────────── LI.FI server configuration ─────────────── */
let LIFI_READY = false
function ensureLifiServer() {
  if (LIFI_READY) return
  createConfig({
    integrator: 'superYLDR',
    apiKey: LIFI_API || undefined,
    providers: [
      EVM({
        getWalletClient: async () => liskWallet,
        switchChain: async (chainId: number) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
      }),
    ],
  })
  LIFI_READY = true
}

async function waitForTokenBalance(opts: {
  client: typeof liskPublic
  token: `0x${string}`
  holder: `0x${string}`
  min: bigint
  timeoutMs?: number
  intervalMs?: number
}) {
  const { client, token, holder, min, timeoutMs = 45000, intervalMs = 2500 } = opts
  const start = Date.now()
  let last = 0n
  // read with the SAME client you’ll use in executeRoute
  while (Date.now() - start < timeoutMs) {
    const bal = await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [holder],
    }) as bigint
    last = bal
    if (bal >= min) return bal
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`timeout: waiting for ${min} tokens; last=${last}`)
}

/* ─────────────── Compensating actions ─────────────── */
async function recordDepositBackOnOP(params: {
  rewardsVault: `0x${string}`
  user: `0x${string}`
  amountShares: bigint
}) {
  const { rewardsVault, user, amountShares } = params
  const { request } = await opPublic.simulateContract({
    address: rewardsVault,
    abi: rewardsVaultAbi,
    functionName: 'recordDeposit',
    args: [user, amountShares],
    account: relayer,
  })
  const tx = await opWallet.writeContract(request)
  await opPublic.waitForTransactionReceipt({ hash: tx })
  return tx
}

async function depositAssetsBackToVaultOnLisk(params: {
  token: `0x${string}`   // underlying on Lisk (USDT0/USDCe)
  vault: `0x${string}`   // ✨ Morpho Blue POOL address (spender + callee)
  safe:  `0x${string}`   // Safe that should receive the position
  wantAssets: bigint
}) {
  const { token, vault, safe, wantAssets } = params

  // 1) relayer balance of underlying
  const bal = (await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [relayer.address],
  })) as bigint

  const toDeposit = bal >= wantAssets ? wantAssets : bal
  if (toDeposit === 0n) {
    return { resetTx: null, approveTx: null, deposited: null, depositedAmt: 0n as bigint }
  }

  // 2) USDT-safe approvals to the POOL (spender = pool)
  let resetTx: `0x${string}` | null = null
  let approveTx: `0x${string}` | null = null

  const currAllowance = (await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [relayer.address, vault],
  })) as bigint

  try {
    if (currAllowance < toDeposit) {
      if (currAllowance !== 0n) {
        const { request: resetReq } = await liskPublic.simulateContract({
          address: token,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [vault, 0n],
          account: relayer,
        })
        resetTx = await liskWallet.writeContract(resetReq)
        await liskPublic.waitForTransactionReceipt({ hash: resetTx })
      }
      const { request: approveReq } = await liskPublic.simulateContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [vault, toDeposit],
        account: relayer,
      })
      approveTx = await liskWallet.writeContract(approveReq)
      await liskPublic.waitForTransactionReceipt({ hash: approveTx })
    }
  } catch (e) {
    console.error('[compensate] approve failed → transfer back', e)
    const xfer = await transferAssetsBackToSafeOnLisk({ token, safe })
    return { resetTx, approveTx, deposited: xfer.tx, depositedAmt: 0n }
  }

  // 3) Morpho resupply to SAFE (onBehalf = Safe)
  try {
    const { request: supplyReq } = await liskPublic.simulateContract({
      address: vault,                 // pool
      abi: ERC4626_ABI,
      functionName: 'supply',
      args: [token, safe, toDeposit, '0x'],
      account: relayer,
    })
    const depositTx = await liskWallet.writeContract(supplyReq)
    await liskPublic.waitForTransactionReceipt({ hash: depositTx })

    return { resetTx, approveTx, deposited: depositTx, depositedAmt: toDeposit }
  } catch (e) {
    console.error('[compensate] supply failed → transfer back', e)
    const xfer = await transferAssetsBackToSafeOnLisk({ token, safe })
    return { resetTx, approveTx, deposited: xfer.tx, depositedAmt: 0n }
  }
}

async function transferAssetsBackToSafeOnLisk(params: {
  token: `0x${string}`
  safe: `0x${string}`
}) {
  const { token, safe } = params
  const bal = (await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [relayer.address],
  })) as bigint
  if (bal === 0n) return { tx: null, transferred: 0n as bigint }
  const { request } = await liskPublic.simulateContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [safe, bal],
    account: relayer,
  })
  const tx = await liskWallet.writeContract(request)
  await liskPublic.waitForTransactionReceipt({ hash: tx })
  return { tx, transferred: bal }
}

/* ─────────────── POST ─────────────── */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const user       = body?.user as `0x${string}` | undefined
    const assetsIn   = (body?.assets ?? body?.amount) as string | undefined
    const tokenKind  = resolveTokenKind({
      tokenSymbol: body?.tokenSymbol,   // e.g., "USDCe" | "USDT0"
      reward: body?.reward,             // e.g., "USDC" | "USDT"
      poolAddress: body?.poolAddress,   // Morpho vault address
    })

    if (!user || !assetsIn) {
      return NextResponse.json({ ok: false, error: 'Missing user/amount' }, { status: 400 })
    }

    // Resolve contracts for the selected token
    const rewardsVault =
      tokenKind === 'USDT0'
        ? (REWARDS_VAULT.optimismUSDT as `0x${string}`)
        : (REWARDS_VAULT.optimismUSDC as `0x${string}`)

    const vault4626 =
      tokenKind === 'USDT0'
        ? (MORPHO_POOLS['usdt0-supply'] as `0x${string}`)
        : (MORPHO_POOLS['usdce-supply'] as `0x${string}`)

    const toTokenOP =
      tokenKind === 'USDT0'
        ? (TokenAddresses.USDT.optimism as `0x${string}`)
        : (TokenAddresses.USDC.optimism as `0x${string}`)

    const liskSafe = SAFEVAULT as `0x${string}`

    // Vault asset (USDCe or USDT0) on Lisk
    const vaultAsset = (await liskPublic.readContract({
      address: vault4626,
      abi: ERC4626_ABI,
      functionName: 'asset',
    })) as `0x${string}`

    const requestedAssets = BigInt(assetsIn)
    const withdrawAssets  = (requestedAssets * 994n) / 1000n // 0.5% buffer

    if (withdrawAssets === 0n) {
      return NextResponse.json({ ok: false, error: 'Withdraw amount too small' }, { status: 400 })
    }

    console.log('[withdraw][inputs]', {
      user,
      tokenKind,
      vault4626,
      vaultAsset,
      requestedAssets: requestedAssets.toString(),
      withdrawAssets: withdrawAssets.toString(),
    })

    /* 1) Burn on OP via correct rewards vault */
    let burnTxHash: `0x${string}` | null = null
    try {
      const { request: burnReq } = await opPublic.simulateContract({
        address: rewardsVault,
        abi: rewardsVaultAbi,
        functionName: 'recordWithdrawal',
        args: [user, requestedAssets],
        account: relayer,
      })
      burnTxHash = await opWallet.writeContract(burnReq)
      await opPublic.waitForTransactionReceipt({ hash: burnTxHash })
      console.log('[withdraw] recordWithdrawal ok', { burnTxHash })
    } catch (err: any) {
      console.error('[withdraw] recordWithdrawal failed', err?.message || err)
      return NextResponse.json({ ok: false, stage: 'burn', error: err?.message ?? 'recordWithdrawal failed' }, { status: 500 })
    }

    /* 2) Safe executes vault.withdraw(assets, receiver=relayer, owner=Safe) on Lisk */
    const calldata = encodeFunctionData({
      abi: ERC4626_ABI,
      functionName: 'withdraw',
      args: [requestedAssets, relayer.address, liskSafe],
    })

    const protocolKit = await Safe.init({
      provider: LSK_RPC,
      signer: RELAYER_PK,
      safeAddress: liskSafe,
    })

    let safeExecHash: `0x${string}` | null = null
    try {
      const tx: MetaTransactionData = {
        to: vault4626,
        value: '0',
        data: calldata,
        operation: OperationType.Call,
      }
      const safeTx  = await protocolKit.createTransaction({ transactions: [tx] })
      const signed  = await protocolKit.signTransaction(safeTx)
      const execRes = await protocolKit.executeTransaction(signed)
      safeExecHash =
        (execRes as any)?.hash ??
        (execRes as any)?.transactionResponse?.hash ??
        null
      console.log('[withdraw] safe exec ok', { safeExecHash })
    } catch (err: any) {
      console.error('[withdraw] safe exec failed; compensating by re-minting…', err?.message || err)
      try {
        const mintTx = await recordDepositBackOnOP({ rewardsVault, user, amountShares: withdrawAssets })
        console.warn('[compensate] recordDeposit back ok', { mintTx })
      } catch (cErr: any) {
        console.error('[compensate] recordDeposit back FAILED', cErr?.message || cErr)
      }
      return NextResponse.json({
        ok: false,
        stage: 'safe-exec',
        error: err?.message ?? 'Safe execution failed',
        compensated: { sharesMintedBack: true },
      }, { status: 500 })
    }

    const minNeeded = withdrawAssets
const relayerBalReady = await waitForTokenBalance({
  client: liskPublic,
  token: vaultAsset,
  holder: relayer.address as `0x${string}`,
  min: minNeeded,
})
// be conservative: bridge the lesser of balance and planned amount
const fromAmount = relayerBalReady < withdrawAssets ? relayerBalReady : withdrawAssets

    /* 3) Bridge Lisk:{USDCe|USDT0} → OP:{USDC|USDT} to user */
    ensureLifiServer()

    const relayerBalBefore = (await liskPublic.readContract({
      address: vaultAsset,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [relayer.address],
    })) as bigint

    console.log('[withdraw] LI.FI quote', {
      tokenKind,
      fromChain: lisk.id, toChain: optimism.id,
      fromToken: vaultAsset, toToken: toTokenOP,
      fromAmount: fromAmount.toString(),
      fromAddress: relayer.address, toAddress: user,
      relayerBalBefore: relayerBalBefore.toString(),
    })

    try {
      const quote = await getQuote({
        fromChain:  lisk.id,
        toChain:    optimism.id,
        fromToken:  vaultAsset,
        toToken:    toTokenOP,
        fromAmount: withdrawAssets.toString(),
        fromAddress: relayer.address,
        toAddress:  user,
      })
      const route = convertQuoteToRoute(quote)

      await executeRoute(route, {
        switchChainHook: async (chainId: number) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
        acceptExchangeRateUpdateHook: async () => true,
      })

      return NextResponse.json({
        ok: true,
        tokenKind,
        burnTxHash,
        safeExecHash,
        bridgedFrom: `Lisk:${tokenKind}`,
        bridgedTo:   `Optimism:${tokenKind === 'USDT0' ? 'USDT' : 'USDC'}`,
        toAmount: route.toAmount,
        receiver: user,
      })
    } catch (err: any) {
      console.error('[withdraw] bridge failed; compensating by deposit/transfer back + re-mint…', err?.message || err)

      let depositedAmt = 0n
      try {
        const freshBal = await liskPublic.readContract({ address: vaultAsset, abi: ERC20_ABI, functionName: 'balanceOf', args: [relayer.address] }) as bigint
        const res = await depositAssetsBackToVaultOnLisk({
          token: vaultAsset,
          vault: vault4626,
          safe: liskSafe,
          wantAssets: freshBal, // use fresh balance
        })
        
        depositedAmt = res.depositedAmt
        console.warn('[compensate] depositBack result', res)
      } catch (depErr: any) {
        console.error('[compensate] depositBack FAILED; falling back to transferBack', depErr?.message || depErr)
        try {
          const xfer = await transferAssetsBackToSafeOnLisk({ token: vaultAsset, safe: liskSafe })
          console.warn('[compensate] transferBack result', xfer)
        } catch (xfErr: any) {
          console.error('[compensate] transferBack FAILED', xfErr?.message || xfErr)
        }
      }

      try {
        const mintTx = await recordDepositBackOnOP({ rewardsVault, user, amountShares: requestedAssets })
        console.warn('[compensate] recordDeposit back ok', { mintTx, shares: requestedAssets.toString() })
      } catch (mintErr: any) {
        console.error('[compensate] recordDeposit back FAILED', mintErr?.message || mintErr)
      }

      return NextResponse.json({
        ok: false,
        tokenKind,
        stage: 'bridge',
        error: err?.message ?? 'Bridge failed',
        compensated: {
          depositBackTried: true,
          depositedAmt: depositedAmt.toString(),
          sharesMintedBack: true,
        },
        burnTxHash,
        safeExecHash,
      }, { status: 500 })
    }
  } catch (e: any) {
    console.error('[api/withdraw/morpho] error:', e)
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 })
  }
}
