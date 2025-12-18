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
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism, lisk } from 'viem/chains'

// Safe Protocol Kit v4+
import Safe from '@safe-global/protocol-kit'
import type { MetaTransactionData } from '@safe-global/types-kit'
import { OperationType } from '@safe-global/types-kit'

// LI.FI (server-side)
import { createConfig, EVM, getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

// Contracts / constants
import rewardsVaultAbi from '@/lib/abi/rewardsAbi.json'
import { TokenAddresses, SAFEVAULT, MORPHO_POOLS, REWARDS_VAULT } from '@/lib/constants'

// State guard
import { advanceWithdraw } from '@/domain/advance'

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
const LIFI_API = process.env.LIFI_API || ''
const OP_RPC = process.env.OP_RPC_URL || 'https://mainnet.optimism.io'
const LSK_RPC = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com'

/* ─────────────── Clients ─────────────── */
const relayer = privateKeyToAccount(RELAYER_PK)
const opPublic = createPublicClient({ chain: optimism, transport: http(OP_RPC) })
const opWallet = createWalletClient({ chain: optimism, transport: http(OP_RPC), account: relayer })
const liskPublic = createPublicClient({ chain: lisk, transport: http(LSK_RPC) })
const liskWallet = createWalletClient({ chain: lisk, transport: http(LSK_RPC), account: relayer })

/* ─────────────── ABIs ─────────────── */
const ERC4626_ABI = parseAbi([
  'function asset() view returns (address)',
  'function decimals() view returns (uint8)',
  'function previewRedeem(uint256 shares) view returns (uint256 assets)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
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

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ─────────────── Prisma lock (idempotency) ─────────────── */
async function tryLock(refId: string) {
  const res = await prisma.withdrawIntent.updateMany({
    where: {
      refId,
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        {
          status: { in: ['PROCESSING', 'BURNED', 'REDEEMING', 'REDEEMED', 'BRIDGING'] },
          updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      ],
    },
    data: { status: 'PROCESSING', error: null, updatedAt: new Date() },
  })
  if (res.count === 1) return { ok: true }

  const row = await prisma.withdrawIntent.findUnique({ where: { refId } })
  if (!row) return { ok: false, reason: 'Unknown refId' as const }
  if (row.status === 'SUCCESS') return { ok: false, reason: 'Already done' as const, stage: row.status }
  return { ok: false, reason: 'Already processing' as const, stage: row.status }
}

/* ─────────────── Helpers ─────────────── */
function pickFamilies(dstToken: `0x${string}`) {
  const isUSDT = dstToken.toLowerCase() === (TokenAddresses.USDT.optimism as `0x${string}`).toLowerCase()

  return {
    rewardsVault: (isUSDT ? REWARDS_VAULT.optimismUSDT : REWARDS_VAULT.optimismUSDC) as `0x${string}`,
    morphoPool: (isUSDT ? MORPHO_POOLS['usdt0-supply'] : MORPHO_POOLS['usdce-supply']) as `0x${string}`,
    liskAsset: (isUSDT ? TokenAddresses.USDT0.lisk : TokenAddresses.USDCe.lisk) as `0x${string}`,
    opToken: (isUSDT ? TokenAddresses.USDT.optimism : TokenAddresses.USDC.optimism) as `0x${string}`,
    // IMPORTANT: this is the OP receipt token (sVault) whose decimals define amountShares base units
    receiptToken: (isUSDT ? TokenAddresses.sVault.optimismUSDT : TokenAddresses.sVault.optimismUSDC) as `0x${string}`,
  }
}

async function readErc20Bal(
  client: typeof liskPublic,
  token: `0x${string}`,
  holder: `0x${string}`,
) {
  return (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [holder],
  })) as bigint
}

async function readErc20Decimals(
  client: typeof opPublic | typeof liskPublic,
  token: `0x${string}`,
) {
  const d = (await client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'decimals',
  })) as number
  return BigInt(d)
}

function scaleDecimals(amount: bigint, fromDec: bigint, toDec: bigint) {
  if (fromDec === toDec) return amount
  if (fromDec < toDec) return amount * 10n ** (toDec - fromDec)
  return amount / 10n ** (fromDec - toDec)
}

async function waitForBalanceAtLeast(
  client: typeof liskPublic,
  token: `0x${string}`,
  holder: `0x${string}`,
  min: bigint,
  timeoutMs = 90_000,
  pollMs = 3_000,
) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const bal = await readErc20Bal(client, token, holder)
    if (bal >= min) return bal
    await sleep(pollMs)
  }
  throw new Error(`timeout waiting for ${min} of ${token} on ${holder}`)
}

/* ─────────────── Route ─────────────── */
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
      console.log('[withdraw/finish] lock miss', { refId, reason: lock.reason, stage: lock.stage })
      if (lock.reason === 'Already done') return json({ ok: true, already: true, stage: lock.stage })
      return json({ ok: true, processing: true, reason: lock.reason, stage: lock.stage }, 202)
    }

    let row = await prisma.withdrawIntent.findUnique({ where: { refId } })
    if (!row) return bad('Unknown refId', 404)

    if (!isAddress(row.user as any) || !isAddress(row.dstToken as any)) {
      console.warn('[withdraw/finish] invalid addresses on row', { refId, user: row.user, dstToken: row.dstToken })
      return bad('Row has invalid addresses; recreate intent', 400)
    }

    const user = row.user as Address
    const dstToken = row.dstToken as `0x${string}`

    // amountShares stored in DB MUST be base units of the OP receipt token (sVault)
    const receiptShares = BigInt(row.amountShares)
    const minAmountOut = BigInt(row.minAmountOut)

    const { rewardsVault, morphoPool, liskAsset, opToken, receiptToken } = pickFamilies(dstToken)

    // Read actual decimals from chain (do NOT hardcode)
    const receiptDecimals = await readErc20Decimals(opPublic, receiptToken)
    const vaultDecimals = BigInt(
      (await liskPublic.readContract({
        address: morphoPool,
        abi: ERC4626_ABI,
        functionName: 'decimals',
      })) as number,
    )

    // 0.30% buffer
const BUFFER_BPS = 30n
const BPS = 10_000n

function applyBuffer(x: bigint) {
  // floor(x * 9970 / 10000)
  return (x * (BPS - BUFFER_BPS)) / BPS
}
    // Convert receipt shares -> vault shares (ERC4626 share token) decimals
    const redeemSharesOG = scaleDecimals(receiptShares, receiptDecimals, vaultDecimals)
    const redeemShares = applyBuffer(redeemSharesOG)

    /* 0) Preflight: make sure redeemShares produces >0 assets, and Safe has shares
          (Fail BEFORE burn to avoid accounting mismatch) */
    {
      const safeShareBal = await readErc20Bal(liskPublic, morphoPool, SAFEVAULT as `0x${string}`)
      const previewAssets = (await liskPublic.readContract({
        address: morphoPool,
        abi: ERC4626_ABI,
        functionName: 'previewRedeem',
        args: [redeemShares],
      })) as bigint

      console.log('[withdraw/finish] preflight', {
        refId,
        receiptToken,
        receiptDecimals: receiptDecimals.toString(),
        morphoPool,
        vaultDecimals: vaultDecimals.toString(),
        receiptShares: receiptShares.toString(),
        redeemShares: redeemShares.toString(),
        safeShareBal: safeShareBal.toString(),
        previewAssets: previewAssets.toString(),
      })

      if (safeShareBal < redeemShares) {
        throw new Error(`Safe has insufficient vault shares (have=${safeShareBal}, need=${redeemShares})`)
      }
      if (previewAssets <= 0n) {
        throw new Error(
          `Redeem would produce zero underlying (previewRedeem=0). ` +
            `Likely dust amount after conversion. receiptShares=${receiptShares} redeemShares=${redeemShares}`,
        )
      }
    }

    /* 1) Burn on OP (idempotent) */
    if (!row.burnTxHash) {
      console.log('[withdraw/finish] burn → OP', {
        refId,
        rewardsVault,
        user,
        amountShares: receiptShares.toString(),
        receiptToken,
        receiptDecimals: receiptDecimals.toString(),
      })

      const { request } = await opPublic.simulateContract({
        address: rewardsVault,
        abi: rewardsVaultAbi,
        functionName: 'recordWithdrawal',
        args: [user, receiptShares],
        account: relayer,
      })
      const burnTx = await opWallet.writeContract(request)
      await opPublic.waitForTransactionReceipt({ hash: burnTx })

      await advanceWithdraw(refId, 'PROCESSING', 'BURNED', { burnTxHash: burnTx })
      row = await prisma.withdrawIntent.findUnique({ where: { refId } })
      console.log('[withdraw/finish] burn OK', { refId, burnTx })
    } else {
      console.log('[withdraw/finish] burn already done', { refId, burnTx: row.burnTxHash })
    }

    /* 2) SAFE executes redeem on Lisk (ERC4626 redeem) */
    if (!row?.redeemTxHash) {
      console.log('[withdraw/finish] redeem via SAFE → Lisk', {
        refId,
        morphoPool,
        receiptShares: receiptShares.toString(),
        redeemShares: redeemShares.toString(),
        receiver: relayer.address,
      })
      await advanceWithdraw(refId, 'BURNED', 'REDEEMING')

      // Redeem to relayer (so relayer can bridge)
      const calldata = encodeFunctionData({
        abi: ERC4626_ABI,
        functionName: 'redeem',
        args: [redeemShares, relayer.address as `0x${string}`, SAFEVAULT as `0x${string}`],
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
        (execRes as any)?.hash ?? (execRes as any)?.transactionResponse?.hash ?? null

      if (!redeemTxHash) throw new Error('Safe redeem tx hash not found')

      // Ensure it actually succeeded on-chain
      const receipt = await liskPublic.waitForTransactionReceipt({ hash: redeemTxHash as `0x${string}` })
      const status = (receipt as any)?.status
      if (status === 'reverted' || status === 0n || status === 0) {
        throw new Error(`Safe redeem reverted. tx=${redeemTxHash}`)
      }

      await advanceWithdraw(refId, 'REDEEMING', 'REDEEMED', { redeemTxHash })
      row = await prisma.withdrawIntent.findUnique({ where: { refId } })
      console.log('[withdraw/finish] redeem OK', { refId, redeemTxHash })
    } else {
      console.log('[withdraw/finish] redeem already done', { refId, redeemTx: row?.redeemTxHash })
    }

    /* 3) Bridge on LI.FI from Lisk -> OP to user */
    ensureLifiServer()

    console.log('[withdraw/finish] wait Lisk balance ≥ minAmountOut', {
      refId,
      token: liskAsset,
      holder: relayer.address,
      min: minAmountOut.toString(),
    })
    await waitForBalanceAtLeast(liskPublic, liskAsset, relayer.address as `0x${string}`, minAmountOut)

    if (!row?.fromTxHash || !row?.toTxHash || !row?.amountOut) {
      console.log('[withdraw/finish] bridging with Li.Fi', {
        refId,
        fromToken: liskAsset,
        toToken: opToken,
        fromAmount: minAmountOut.toString(),
        user,
      })
      await advanceWithdraw(refId, 'REDEEMED', 'BRIDGING')

      const quote = await getQuote({
        fromChain: lisk.id,
        toChain: optimism.id,
        fromToken: liskAsset,
        toToken: opToken,
        fromAmount: minAmountOut.toString(),
        fromAddress: relayer.address,
        toAddress: user,
        slippage: 0.003,
      })
      const route = convertQuoteToRoute(quote)

      let seenFrom: `0x${string}` | undefined
      let seenTo: `0x${string}` | undefined

      await executeRoute(route, {
        updateRouteHook: async (rt) => {
          for (const step of rt.steps ?? []) {
            for (const p of step.execution?.process ?? []) {
              if (p.txHash) {
                if (!seenFrom && (p.status === 'DONE' || p.status === 'PENDING')) {
                  seenFrom = p.txHash as `0x${string}`
                }
                if (
                  p.status === 'DONE' &&
                  (['SWAP', 'CROSS_CHAIN', 'BRIDGE'] as const).includes(step.type as any)
                ) {
                  seenTo = p.txHash as `0x${string}`
                }
              }
            }
          }
        },
        switchChainHook: async (chainId) => {
          if (chainId === lisk.id) return liskWallet
          if (chainId === optimism.id) return opWallet
          throw new Error(`Unsupported chainId: ${chainId}`)
        },
        acceptExchangeRateUpdateHook: async () => true,
      })

      const amountOut = route.toAmount ?? String(minAmountOut)

      await advanceWithdraw(refId, 'BRIDGING', 'SUCCESS', {
        fromTxHash: seenFrom ?? row?.fromTxHash ?? null,
        toTxHash: seenTo ?? row?.toTxHash ?? null,
        amountOut,
      })
      row = await prisma.withdrawIntent.findUnique({ where: { refId } })

      console.log('[withdraw/finish] bridge OK', {
        refId,
        fromTx: row?.fromTxHash,
        toTx: row?.toTxHash,
        amountOut,
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
    return NextResponse.json({ ok: false, error: e?.message || 'withdraw/finish failed' }, { status: 500 })
  }
}
