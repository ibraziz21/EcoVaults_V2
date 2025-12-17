// src/app/api/withdraw/finish/route.ts
import 'server-only'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  isAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism, lisk } from 'viem/chains'

// Safe Protocol Kit v4+
import Safe from '@safe-global/protocol-kit'
import type { MetaTransactionData } from '@safe-global/types-kit'
import { OperationType } from '@safe-global/types-kit'

// LI.FI (server-side)
import {
  createConfig,
  EVM,
  getQuote,
  convertQuoteToRoute,
  executeRoute,
} from '@lifi/sdk'

// Contracts / constants
import rewardsVaultAbi from '@/lib/abi/rewardsAbi.json'
import {
  TokenAddresses,
  SAFEVAULT,
  MORPHO_POOLS,
  REWARDS_VAULT,
} from '@/lib/constants'

// State guard
import { advanceWithdraw } from '@/domain/advance'
import type { WithdrawState } from '@/domain/states'

/* ─────────────── Env & helpers ─────────────── */
const PK_RE = /^0x[0-9a-fA-F]{64}$/
function normalizePrivateKey(raw?: string): `0x${string}` {
  const s = (raw ?? '').trim().replace(/^['"]|['"]$/g, '')
  if (!s) throw new Error('RELAYER_PRIVATE_KEY is missing')
  const with0x = (`0x${s.replace(/^0x/i, '')}`.toLowerCase()) as `0x${string}`
  if (!PK_RE.test(with0x)) throw new Error('RELAYER_PRIVATE_KEY format invalid')
  return with0x
}

const RELAYER_PK = normalizePrivateKey(process.env.RELAYER_PRIVATE_KEY)
const LIFI_API = process.env.LIFI_API || ''
const OP_RPC = process.env.OP_RPC_URL || 'https://mainnet.optimism.io'
const LSK_RPC = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com'

/* ─────────────── Clients ─────────────── */
const relayer = privateKeyToAccount(RELAYER_PK)

const opPublic = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet = createWalletClient({
  chain: optimism,
  transport: http(OP_RPC),
  account: relayer,
})

const liskPublic = createPublicClient({ chain: lisk, transport: http(LSK_RPC) })
const liskWallet = createWalletClient({
  chain: lisk,
  transport: http(LSK_RPC),
  account: relayer,
})

/* ─────────────── ABIs ─────────────── */
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
])

// Treat MORPHO_POOLS[...] as an ERC-4626 vault address.
// Shares are held by the Safe; redeem pulls underlying out to relayer.
const ERC4626_ABI = parseAbi([
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
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
        // executeRoute will ask for a wallet client; it may also switch chains.
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

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nowSec = () => Math.floor(Date.now() / 1000)

/* ─────────────── Prisma lock (idempotency) ─────────────── */
async function tryLock(refId: string) {
  const res = await prisma.withdrawIntent.updateMany({
    where: {
      refId,
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        {
          status: { in: ['PROCESSING', 'BURNED', 'REDEEMING', 'REDEEMED', 'BRIDGING'] },
          updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) }, // stale processing
        },
      ],
    },
    data: { status: 'PROCESSING', error: null, updatedAt: new Date() },
  })
  if (res.count === 1) return { ok: true }

  const row = await prisma.withdrawIntent.findUnique({ where: { refId } })
  if (!row) return { ok: false, reason: 'Unknown refId' }
  if (row.status === 'SUCCESS') return { ok: false, reason: 'Already done', stage: row.status }
  return { ok: false, reason: 'Already processing', stage: row.status }
}

/* ─────────────── Helpers ─────────────── */
function pickFamilies(dstToken: `0x${string}`) {
  const isUSDT =
    dstToken.toLowerCase() ===
    (TokenAddresses.USDT.optimism as `0x${string}`).toLowerCase()

  return {
    rewardsVault: (isUSDT
      ? REWARDS_VAULT.optimismUSDT
      : REWARDS_VAULT.optimismUSDC) as `0x${string}`,

    // This is the Lisk vault address whose shares the Safe holds.
    morphoPool: (isUSDT
      ? MORPHO_POOLS['usdt0-supply']
      : MORPHO_POOLS['usdce-supply']) as `0x${string}`,

    // Underlying token on Lisk that relayer receives after redeem.
    liskAsset: (isUSDT
      ? TokenAddresses.USDT0.lisk
      : TokenAddresses.USDCe.lisk) as `0x${string}`,

    // Destination token on OP that user receives after bridging.
    opToken: (isUSDT
      ? TokenAddresses.USDT.optimism
      : TokenAddresses.USDC.optimism) as `0x${string}`,
  }
}

async function readErc20Balance(
  token: `0x${string}`,
  holder: `0x${string}`,
) {
  return (await liskPublic.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [holder],
  })) as bigint
}

async function waitForTxLisk(hash: `0x${string}`, confirmations = 2) {
  await liskPublic.waitForTransactionReceipt({ hash, confirmations })
}

async function waitForTxOp(hash: `0x${string}`, confirmations = 2) {
  await opPublic.waitForTransactionReceipt({ hash, confirmations })
}

/* ─────────────── Route (POST) ─────────────── */
export async function POST(req: Request) {
  let _refId: string | undefined

  try {
    const body = await req.json().catch(() => ({}))
    const refId = body?.refId as `0x${string}` | undefined
    _refId = refId
    if (!refId) return bad('refId required')

    console.log('[withdraw/finish] start', { refId })

    const lock = await tryLock(refId)
    if (!lock.ok) {
      console.log('[withdraw/finish] lock miss', {
        refId,
        reason: lock.reason,
        stage: (lock as any).stage,
      })
      if (lock.reason === 'Already done') {
        return json({ ok: true, already: true, stage: (lock as any).stage })
      }
      return json(
        { ok: true, processing: true, reason: lock.reason, stage: (lock as any).stage },
        202,
      )
    }

    let row = await prisma.withdrawIntent.findUnique({ where: { refId } })
    if (!row) return bad('Unknown refId', 404)

    // Deadline guard: enforce only before irreversible steps
    try {
      const dl = BigInt(row.deadline)
      if (dl <= BigInt(nowSec()) && row.status === 'PROCESSING') {
        await prisma.withdrawIntent.update({
          where: { refId },
          data: { status: 'FAILED', error: 'Withdraw intent expired before processing' },
        })
        return bad('Withdraw intent expired', 401)
      }
    } catch {
      // ignore malformed deadline
    }

    // Validate row fields
    if (!isAddress(row.user as any) || !isAddress(row.dstToken as any)) {
      console.warn('[withdraw/finish] invalid addresses on row', {
        refId,
        user: row.user,
        dstToken: row.dstToken,
      })
      return bad('Row has invalid addresses; recreate intent', 400)
    }

    const user = row.user as `0x${string}`
    const dstToken = row.dstToken as `0x${string}`
    const amountShares = BigInt(row.amountShares)
    const minAmountOutOnOp = BigInt(row.minAmountOut)

    const { rewardsVault, morphoPool, liskAsset, opToken } = pickFamilies(dstToken)

    /* 1) Burn on OP (idempotent) */
    if (!row.burnTxHash) {
      console.log('[withdraw/finish] burn → OP', {
        refId,
        rewardsVault,
        user,
        amountShares: amountShares.toString(),
      })

      const { request } = await opPublic.simulateContract({
        address: rewardsVault,
        abi: rewardsVaultAbi,
        functionName: 'recordWithdrawal',
        args: [user, amountShares],
        account: relayer,
      })

      const burnTx = await opWallet.writeContract(request)
      await waitForTxOp(burnTx, 2)

      await advanceWithdraw(
        refId,
        'PROCESSING' as WithdrawState,
        'BURNED' as WithdrawState,
        { burnTxHash: burnTx },
      )

      row = await prisma.withdrawIntent.findUnique({ where: { refId } })
      console.log('[withdraw/finish] burn OK', { refId, burnTx })
    } else {
      console.log('[withdraw/finish] burn already done', { refId, burnTx: row.burnTxHash })
    }

    /* 2) SAFE redeems shares on Lisk (ERC-4626 redeem) */
    let redeemedAmount: bigint | null = null

    if (!row?.redeemTxHash) {
      console.log('[withdraw/finish] redeem via SAFE → Lisk', {
        refId,
        morphoPool,
        shares: amountShares.toString(),
        receiver: relayer.address,
        owner: SAFEVAULT,
        underlying: liskAsset,
      })

      await advanceWithdraw(refId, 'BURNED' as WithdrawState, 'REDEEMING' as WithdrawState)

      // Balance delta method (robust even if redeem() return value isn't easily decoded from Safe exec)
      const beforeBal = await readErc20Balance(liskAsset, relayer.address as `0x${string}`)

      const calldata = encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: 'redeem',
        args: [amountShares, relayer.address, SAFEVAULT],
      })

      const protocolKit = await Safe.init({
        provider: LSK_RPC,
        signer: RELAYER_PK,
        safeAddress: SAFEVAULT,
      })

      const tx: MetaTransactionData = {
        to: morphoPool,
        value: '0',
        data: calldata,
        operation: OperationType.Call,
      }

      const safeTx = await protocolKit.createTransaction({ transactions: [tx] })
      const signed = await protocolKit.signTransaction(safeTx)
      const execRes = await protocolKit.executeTransaction(signed)

      const redeemTxHash =
        (execRes as any)?.hash ??
        (execRes as any)?.transactionResponse?.hash ??
        null

      if (!redeemTxHash) throw new Error('Safe redeem tx hash not found')

      // Wait a bit for finality / balance update
      await waitForTxLisk(redeemTxHash as `0x${string}`, 2)

      const afterBal = await readErc20Balance(liskAsset, relayer.address as `0x${string}`)
      redeemedAmount = afterBal - beforeBal

      if (redeemedAmount <= 0n) {
        throw new Error(`Redeem produced zero underlying (before=${beforeBal}, after=${afterBal})`)
      }

      await advanceWithdraw(refId, 'REDEEMING' as WithdrawState, 'REDEEMED' as WithdrawState, {
        redeemTxHash,
        // optional: persist redeemed amount (string) if your Prisma model has a field for it
        // redeemedAmount: redeemedAmount.toString(),
      })

      row = await prisma.withdrawIntent.findUnique({ where: { refId } })
      console.log('[withdraw/finish] redeem OK', { refId, redeemTxHash, redeemedAmount: redeemedAmount.toString() })
    } else {
      console.log('[withdraw/finish] redeem already done', { refId, redeemTx: row?.redeemTxHash })
    }

    // If we didn't compute redeemedAmount in this call (because redeem already happened),
    // estimate it as the relayer’s current balance of the underlying.
    // NOTE: This assumes relayer keeps near-zero balance of that underlying between runs.
    if (redeemedAmount === null) {
      const bal = await readErc20Balance(liskAsset, relayer.address as `0x${string}`)
      if (bal <= 0n) {
        throw new Error('No Lisk underlying balance found to bridge (relayer balance is zero)')
      }
      redeemedAmount = bal
    }

    /* 3) Bridge on LI.FI from Lisk -> OP to user (server-side) */
    ensureLifiServer()

    if (!row?.fromTxHash || !row?.toTxHash || !row?.amountOut) {
      console.log('[withdraw/finish] bridging with Li.Fi', {
        refId,
        fromToken: liskAsset,
        toToken: opToken,
        fromAmount: redeemedAmount.toString(),
        minAmountOutOnOp: minAmountOutOnOp.toString(),
        user,
      })

      await advanceWithdraw(refId, 'REDEEMED' as WithdrawState, 'BRIDGING' as WithdrawState)

      // Quote using the REAL fromAmount on Lisk
      const quote = await getQuote({
        fromChain: lisk.id,
        toChain: optimism.id,
        fromToken: liskAsset,
        toToken: opToken,
        fromAmount: redeemedAmount.toString(),
        fromAddress: relayer.address,
        toAddress: user,
        slippage: 0.003,
      })

      // Enforce minAmountOut using LI.FI's minimum-to-receive estimate
      const quotedMinToAmount = BigInt(quote.estimate?.toAmountMin ?? '0')
      if (quotedMinToAmount < minAmountOutOnOp) {
        throw new Error(
          `Quoted min on OP ${quotedMinToAmount} < minAmountOut ${minAmountOutOnOp}`,
        )
      }

      const route = convertQuoteToRoute(quote)

      let seenFrom: `0x${string}` | undefined
      let seenTo: `0x${string}` | undefined

      const executed = await executeRoute(route, {
        updateRouteHook: async (rt) => {
          try {
            for (const step of rt.steps ?? []) {
              for (const p of step.execution?.process ?? []) {
                if (!p?.txHash) continue
                if (!seenFrom && (p.status === 'PENDING' || p.status === 'DONE')) {
                  seenFrom = p.txHash as `0x${string}`
                }
                // best-effort: capture a DONE hash later in the pipeline
                if (p.status === 'DONE') {
                  seenTo = p.txHash as `0x${string}`
                }
              }
            }
          } catch {}
        },
        switchChainHook: async (chainId) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
        acceptExchangeRateUpdateHook: async () => true,
      })

      const finalToAmount = BigInt((executed as any)?.toAmount ?? quote.estimate?.toAmountMin ?? '0')
      if (finalToAmount < minAmountOutOnOp) {
        throw new Error(`Final OP amount ${finalToAmount} < minAmountOut ${minAmountOutOnOp}`)
      }

      await advanceWithdraw(refId, 'BRIDGING' as WithdrawState, 'SUCCESS' as WithdrawState, {
        fromTxHash: seenFrom ?? null,
        toTxHash: seenTo ?? null,
        amountOut: finalToAmount.toString(),
      })

      row = await prisma.withdrawIntent.findUnique({ where: { refId } })

      console.log('[withdraw/finish] bridge OK', {
        refId,
        fromTx: row?.fromTxHash,
        toTx: row?.toTxHash,
        amountOut: row?.amountOut,
      })
    } else {
      console.log('[withdraw/finish] bridge already recorded', {
        refId,
        fromTx: row?.fromTxHash,
        toTx: row?.toTxHash,
        amountOut: row?.amountOut,
      })
    }

    console.log('[withdraw/finish] done', { refId, status: row?.status })
    return json({ ok: true, refId, status: row?.status })
  } catch (e: any) {
    console.error('[withdraw/finish] failed:', e?.message || e)

    // best-effort failure update
    try {
      if (_refId) {
        const cur = await prisma.withdrawIntent.findUnique({ where: { refId: _refId } })
        if (cur && cur.status !== 'SUCCESS') {
          await prisma.withdrawIntent.update({
            where: { refId: _refId },
            data: { status: 'FAILED', error: e?.message || String(e) },
          })
        }
      }
    } catch {}

    return NextResponse.json(
      { ok: false, error: e?.message || 'withdraw/finish failed' },
      { status: 500 },
    )
  }
}

/* ─────────────── Route (GET status) ─────────────── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const refId = (searchParams.get('refId') || '') as `0x${string}`
  if (!refId) return NextResponse.json({ ok: false, error: 'refId required' }, { status: 400 })

  const row = await prisma.withdrawIntent.findUnique({ where: { refId } })
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    refId: row.refId,
    status: row.status,
    redeemTxHash: row.redeemTxHash,
    fromTxHash: row.fromTxHash,
    toTxHash: row.toTxHash,
    amountOut: row.amountOut,
    burnTxHash: row.burnTxHash,
    updatedAt: row.updatedAt,
  })
}