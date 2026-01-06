// src/app/api/relayer/finish/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { advanceDeposit } from '@/domain/advance'
import type { DepositState } from '@/domain/states'

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk, optimism } from 'viem/chains'
import { ensureAllowanceThenDeposit } from '@/lib/ensureAllowanceThenDeposit'
import morphoAbi from '@/lib/abi/morphoLisk.json'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import {
  TokenAddresses,
  SAFEVAULT,
  REWARDS_VAULT,
  MORPHO_POOLS,
  ADAPTER_KEYS,
} from '@/lib/constants'
import { randomUUID } from 'node:crypto'
import {
  registryMarkBridged,
  registryMarkDeposited,
  registryMarkMinted,
  registryMarkFailed,
} from '@/lib/intentRegistry'

// ---------- config / env ----------
const LIFI_STATUS_URL = 'https://li.quest/v1/status'
const LISK_ID = lisk.id
const MIN_CONFIRMATIONS = 3 // Lisk confirmations for reorg safety
const LEASE_MS = 60_000 // single-flight lease time
const ZERO32 = (`0x${'0'.repeat(64)}`) as `0x${string}`

const RELAYER_PRIVATE_KEY_RAW = (process.env.RELAYER_PRIVATE_KEY || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
if (!RELAYER_PRIVATE_KEY_RAW) {
  console.warn('[finish] RELAYER_PRIVATE_KEY is empty or missing')
}
const RELAYER_PRIVATE_KEY = (`0x${RELAYER_PRIVATE_KEY_RAW.replace(/^0x/i, '')}`) as `0x${string}`
const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY)

// Simple in-process mutex to serialize relayer tx nonces (prevent underpriced replacements)
let mintLock: Promise<void> = Promise.resolve()
const withMintLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const prev = mintLock.catch(() => {})
  let release: () => void = () => {}
  mintLock = new Promise<void>((res) => {
    release = res
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

// Lisk-side relayer mutex (approve/deposit) to avoid nonce races under load
let liskLock: Promise<void> = Promise.resolve()
const withLiskLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const prev = liskLock.catch(() => {})
  let release: () => void = () => {}
  liskLock = new Promise<void>((res) => {
    release = res
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

/* ────────────────────────────────────────────────────────────
   Classification helpers: choose asset kind, Morpho pool and
   OP rewards vault (USDC vs USDT)
   ──────────────────────────────────────────────────────────── */

type AssetKind = 'USDC' | 'USDT'

function classifyIntentForVault(intent: { asset?: string | null; adapterKey?: string | null }) {
  const assetLc = (intent.asset ?? '').toLowerCase()
  const usdcLisk = TokenAddresses.USDCe.lisk.toLowerCase()
  const usdt0Lisk = TokenAddresses.USDT0.lisk.toLowerCase()

  // Primary source of truth: asset field (destination asset on Lisk)
  if (assetLc === usdcLisk) {
    return {
      kind: 'USDC' as AssetKind,
      liskToken: TokenAddresses.USDCe.lisk as `0x${string}`,
      morphoPool: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
      opRewardsVault: REWARDS_VAULT.optimismUSDC as `0x${string}`,
    }
  }
  if (assetLc === usdt0Lisk) {
    return {
      kind: 'USDT' as AssetKind,
      liskToken: TokenAddresses.USDT0.lisk as `0x${string}`,
      morphoPool: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
      opRewardsVault: REWARDS_VAULT.optimismUSDT as `0x${string}`,
    }
  }

  // Fallback: adapterKey (handles cases where asset is not yet wired)
  const keyLc = (intent.adapterKey ?? '').toLowerCase()
  if (keyLc && keyLc === (ADAPTER_KEYS.morphoLiskUSDCe as string).toLowerCase()) {
    return {
      kind: 'USDC' as AssetKind,
      liskToken: TokenAddresses.USDCe.lisk as `0x${string}`,
      morphoPool: MORPHO_POOLS['usdce-supply'] as `0x${string}`,
      opRewardsVault: REWARDS_VAULT.optimismUSDC as `0x${string}`,
    }
  }
  if (keyLc && keyLc === (ADAPTER_KEYS.morphoLiskUSDT0 as string).toLowerCase()) {
    return {
      kind: 'USDT' as AssetKind,
      liskToken: TokenAddresses.USDT0.lisk as `0x${string}`,
      morphoPool: MORPHO_POOLS['usdt0-supply'] as `0x${string}`,
      opRewardsVault: REWARDS_VAULT.optimismUSDT as `0x${string}`,
    }
  }

  throw new Error(
    `Unsupported asset/adapter for rewards vault: asset=${intent.asset}, adapterKey=${intent.adapterKey}`,
  )
}

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const leaseUntil = (ms = LEASE_MS) => new Date(Date.now() + ms)

/* ────────────────────────────────────────────────────────────
   State ranking (must match your canonical DepositState machine)
   ──────────────────────────────────────────────────────────── */
const STATE_ORDER: DepositState[] = [
  'PENDING',
  'PROCESSING',
  'WAITING_ROUTE',
  'BRIDGE_IN_FLIGHT',
  'BRIDGED',
  'DEPOSITING',
  'DEPOSITED',
  'MINTING',
  'MINTED',
  'FAILED',
]
const stateRank = (s?: string) => {
  const i = STATE_ORDER.indexOf((s || '').toUpperCase() as DepositState)
  return i === -1 ? -1 : i
}
const isAheadOrEqual = (curr?: string, want?: DepositState) =>
  stateRank(curr) >= stateRank(want)

/* ────────────────────────────────────────────────────────────
   Idempotent advance wrapper
   ──────────────────────────────────────────────────────────── */
async function advanceIdempotent(
  refId: string,
  from: DepositState,
  to: DepositState,
  data?: Record<string, any>,
) {
  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) throw new Error('intent not found')

  if (row.status === to || isAheadOrEqual(row.status, to)) {
    if (data && Object.keys(data).length) {
      await prisma.depositIntent.update({ where: { refId }, data }).catch(() => {})
    }
    return
  }

  if (row.status !== from) return
  await advanceDeposit(refId, from, to, data)
}

/* ────────────────────────────────────────────────────────────
   Li.Fi status (by tx hash) + keepalive hook
   ──────────────────────────────────────────────────────────── */
async function getLifiStatusByTx(params: {
  fromChainId: number
  toChainId: number
  fromTxHash: `0x${string}`
  bridge?: string
}) {
  const q = new URLSearchParams({
    fromChain: String(params.fromChainId),
    toChain: String(params.toChainId),
    txHash: params.fromTxHash,
  })
  if (params.bridge) q.set('bridge', params.bridge)

  const res = await fetch(`${LIFI_STATUS_URL}?${q.toString()}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`LiFi status HTTP ${res.status}`)
  return res.json()
}

async function waitForLiFiDone(args: {
  fromChainId: number
  toChainId: number
  fromTxHash: `0x${string}`
  timeoutMs?: number
  pollMs?: number
  keepAlive?: () => Promise<void> | void
  keepAliveEvery?: number
}) {
  const {
    fromChainId,
    toChainId,
    fromTxHash,
    timeoutMs = 12 * 60_000,
    pollMs = 6_000,
    keepAlive,
    keepAliveEvery = 5,
  } = args

  const endAt = Date.now() + timeoutMs
  let polls = 0

  while (true) {
    const st = await getLifiStatusByTx({ fromChainId, toChainId, fromTxHash })
    const status = st?.status as string | undefined

    if (status === 'DONE') {
      const recv = st?.receiving
      const amountStr = recv?.amount as string | undefined
      const bridgedAmount = amountStr ? BigInt(amountStr) : 0n
      return { st, bridgedAmount, receiving: recv }
    }

    if (status === 'FAILED') throw new Error(`LiFi status FAILED for ${fromTxHash}`)
    if (Date.now() > endAt) throw new Error(`Timeout waiting LiFi status for ${fromTxHash}`)

    polls++
    if (keepAlive && polls % keepAliveEvery === 0) {
      await keepAlive()
    }

    await sleep(pollMs)
  }
}

/* ────────────────────────────────────────────────────────────
   Viem clients
   ──────────────────────────────────────────────────────────── */
function makeLiskClients() {
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  const transport = http(process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com')
  const pub = createPublicClient({ chain: lisk, transport })
  const wlt = createWalletClient({ account, chain: lisk, transport })
  return { pub, wlt, account }
}
function makeOpClients() {
  const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
  const transport = http(process.env.OP_RPC_URL)
  const pub = createPublicClient({ chain: optimism, transport })
  const wlt = createWalletClient({ account, chain: optimism, transport })
  return { pub, wlt, account }
}

/* ────────────────────────────────────────────────────────────
   Mint on Optimism (USDC vs USDT based on intent)
   ──────────────────────────────────────────────────────────── */
async function mintReceipt(user: `0x${string}`, amount: bigint, rewardsVault: `0x${string}`) {
  return await withMintLock(async () => {
    const { pub, wlt, account } = makeOpClients()

    // Serialize nonce against any in-flight txs from the relayer (recordDeposit)
    const nonce = await pub.getTransactionCount({
      address: account.address,
      blockTag: 'pending',
    })

    const { request } = await pub.simulateContract({
      address: rewardsVault,
      abi: rewardsAbi,
      functionName: 'recordDeposit',
      args: [user, amount],
      account,
      nonce,
    })
    const mintTx = await wlt.writeContract({ ...request, nonce })
    await pub.waitForTransactionReceipt({ hash: mintTx, confirmations: 3 })
    return { mintTx }
  })
}

/* ────────────────────────────────────────────────────────────
   Single-flight lease (owner + expiry)
   ──────────────────────────────────────────────────────────── */
async function tryLockIntent(refId: string) {
  const owner = randomUUID()

  const allowed = [
    'PENDING',
    'WAITING_ROUTE',
    'BRIDGE_IN_FLIGHT',
    'BRIDGED',
    'DEPOSITING',
    'DEPOSITED',
    'MINTING',
    'FAILED',
    'PROCESSING',
  ] as const

  const acquired = await prisma.depositIntent.updateMany({
    where: {
      refId,
      status: { in: allowed as any },
      OR: [
        // fresh or unlocked
        { processingLeaseUntil: null },
        { processingLeaseUntil: { lt: new Date() } },
        // or already owned by nobody (safe to take)
        { processingOwner: null },
      ],
    },
    data: {
      status: 'PROCESSING',
      error: null,
      processingOwner: owner,
      processingLeaseUntil: leaseUntil(),
      updatedAt: new Date(),
    },
  })

  if (acquired.count === 1) return { ok: true, owner }

  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) return { ok: false, reason: 'Unknown refId' }
  if (row.status === 'MINTED') return { ok: false, reason: 'Already done' }

  return { ok: false, reason: 'Already processing', status: row.status, updatedAt: row.updatedAt }
}

async function ensureOwner(refId: string, owner: string) {
  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) throw new Error('Unknown refId')
  if (row.processingOwner !== owner && row.status !== 'MINTED') {
    throw new Error('Lost lease to another finisher')
  }
}

async function renewLease(refId: string, owner: string) {
  await prisma.depositIntent.updateMany({
    where: { refId, processingOwner: owner },
    data: { processingLeaseUntil: leaseUntil(), updatedAt: new Date() },
  })
}

/* ────────────────────────────────────────────────────────────
   Route
   ──────────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  let refIdForCatch: string | undefined
  let mintedOk = false

  try {
    const body = await req.json().catch(() => ({}))
    console.log('[finish] body:', body)

    const refId = body?.refId as `0x${string}` | undefined
    refIdForCatch = refId
    if (!refId) return bad('refId required')

    const fromTxHash = body?.fromTxHash as `0x${string}` | undefined
    const fromChainId = body?.fromChainId as number | undefined
    const toChainId = (body?.toChainId as number | undefined) ?? LISK_ID
    const minAmountStr = body?.minAmount as string | undefined

    // Enforce OP -> Lisk only (this build)
    if (fromChainId != null && fromChainId !== optimism.id) {
      return bad(`fromChainId must be Optimism (${optimism.id})`, 422)
    }
    if (toChainId != null && toChainId !== LISK_ID) {
      return bad(`toChainId must be Lisk (${LISK_ID})`, 422)
    }

    // lock row (single-flight)
    const lock = await tryLockIntent(refId)
    if (!lock.ok) {
      if (lock.reason === 'Already done') return json({ ok: true, already: true, status: 'MINTED' })
      return json({ ok: true, processing: true, reason: lock.reason }, 202)
    }
    const owner = lock.owner!

    let intent = await prisma.depositIntent.findUnique({ where: { refId } })
    if (!intent) return bad('Unknown refId', 404)

    // Figure out what this intent *actually* targets (USDC vs USDT)
    const classification = classifyIntentForVault(intent)
    const { liskToken, morphoPool, opRewardsVault } = classification

    // short-circuit if already MINTED
    if (intent.status === 'MINTED' && intent.mintTxHash) {
      return json({ ok: true, already: true, status: 'MINTED', mintTxHash: intent.mintTxHash })
    }

    // Merge new facts (fromTxHash/chain ids/minAmount)
    const patch: any = {}
    if (fromTxHash && intent.fromTxHash !== fromTxHash) patch.fromTxHash = fromTxHash
    if (minAmountStr) {
      const incoming = BigInt(minAmountStr)
      const current = intent.minAmount ? BigInt(intent.minAmount) : null
      if (current === null || incoming < current) patch.minAmount = incoming.toString()
    }
    if (Object.keys(patch).length) {
      intent = await prisma.depositIntent.update({ where: { refId }, data: patch })
    }

    // If still no source tx, move to WAITING_ROUTE and exit
    if (!intent.fromTxHash) {
      await advanceIdempotent(refId, 'PENDING', 'WAITING_ROUTE')
      await advanceIdempotent(refId, 'PROCESSING', 'WAITING_ROUTE')
      return json({ ok: true, waiting: true }, 202)
    }

    // We have a txHash; bridge should be in flight
    await advanceIdempotent(refId, 'WAITING_ROUTE', 'BRIDGE_IN_FLIGHT')
    await advanceIdempotent(refId, 'PROCESSING', 'BRIDGE_IN_FLIGHT')

    const srcChain = optimism.id
    const dstChain = LISK_ID

    // 1) Wait Li.Fi (renew the lease periodically)
    console.log('[finish] waiting Li.Fi by tx…')
    const { bridgedAmount, receiving } = await waitForLiFiDone({
      fromChainId: srcChain,
      toChainId: dstChain,
      fromTxHash: intent.fromTxHash as `0x${string}`,
      keepAlive: () => renewLease(refId, owner),
      keepAliveEvery: 5,
    })

    if (!receiving) throw new Error('LiFi DONE but missing receiving payload')

    const toTxHash = (receiving?.txHash as `0x${string}` | undefined) ?? intent.toTxHash ?? undefined
    const recvAddr = receiving.token?.address as `0x${string}` | undefined
    const expectedToken = liskToken

    if (!recvAddr) throw new Error('LiFi DONE but receiving.token.address is empty')

    if (recvAddr.toLowerCase() !== expectedToken.toLowerCase()) {
      throw new Error(`Unexpected dest token ${recvAddr}, expected ${expectedToken}`)
    }

    if (intent.toTokenAddress && intent.toTokenAddress.toLowerCase() !== expectedToken.toLowerCase()) {
      throw new Error(
        `Intent toTokenAddress ${intent.toTokenAddress} mismatches classified Lisk asset ${expectedToken}`,
      )
    }

    // Reorg safety on destination chain
    if (toTxHash) {
      const { pub: liskPub } = makeLiskClients()
      await liskPub.waitForTransactionReceipt({
        hash: toTxHash as `0x${string}`,
        confirmations: MIN_CONFIRMATIONS,
      })
    }

    // Respect minAmount
    const minAmount =
      intent.minAmount && intent.minAmount.length > 0
        ? BigInt(intent.minAmount)
        : typeof minAmountStr === 'string'
          ? BigInt(minAmountStr)
          : 0n

    if (minAmount > 0n && bridgedAmount < minAmount) {
      throw new Error(`Bridged amount ${bridgedAmount} < minAmount ${minAmount}`)
    }

    await advanceIdempotent(refId, 'BRIDGE_IN_FLIGHT', 'BRIDGED', {
      toTxHash: toTxHash ?? null,
      toTokenAddress: recvAddr ?? null,
      bridgedAmount: bridgedAmount.toString(),
    })

    // Mirror bridge info onchain (best-effort)
    try {
      await registryMarkBridged({
        refId: refId as `0x${string}`,
        bridgedAmount,
        // IMPORTANT: bytes32-safe fallback (avoid passing 0x)
        toTxHash: (toTxHash ?? ZERO32) as `0x${string}`,
      })
    } catch (e: any) {
      console.warn('[finish] registryMarkBridged failed (non-fatal):', e?.message || e)
    }

    const amt = bridgedAmount
    if (amt <= 0n) throw new Error('Zero bridged amount')

    // 2) Deposit on Lisk (idempotent)
    intent = await prisma.depositIntent.findUnique({ where: { refId } })
    const { pub: liskPub } = makeLiskClients()

    if (!intent?.depositTxHash) {
      await ensureOwner(refId, owner)
      await renewLease(refId, owner)

      await advanceIdempotent(refId, 'BRIDGED', 'DEPOSITING')
      const { depositTx, verified } = await withLiskLock(async () => {
        const baseNonce = await liskPub.getTransactionCount({
          address: relayer.address,
          blockTag: 'pending',
        })
        return await ensureAllowanceThenDeposit({
          pub: liskPub as PublicClient,
          account: relayer,
          chain: lisk,
          token: liskToken,
          vaultAddr: morphoPool,
          receiver: SAFEVAULT,
          amount: amt,
          morphoAbi,
          log: console.log,
          nonce: Number(baseNonce),
        })
      })

      if (verified.sender.toLowerCase() !== relayer.address.toLowerCase()) {
        throw new Error('Deposit sender mismatch (expected relayer EOA)')
      }
      if (verified.vault.toLowerCase() !== morphoPool.toLowerCase()) {
        throw new Error('Deposit vault mismatch')
      }
      if (verified.receiver.toLowerCase() !== SAFEVAULT.toLowerCase()) {
        throw new Error('Deposit receiver mismatch (must be SAFE)')
      }
      if (verified.token.toLowerCase() !== liskToken.toLowerCase()) {
        throw new Error('Deposit token mismatch (must match Lisk asset)')
      }
      if (verified.assetsDeposited !== amt) {
        throw new Error(`Deposit amount mismatch: ${verified.assetsDeposited} != ${amt}`)
      }

      await advanceIdempotent(refId, 'DEPOSITING', 'DEPOSITED', {
        depositTxHash: depositTx,
      })

      // Mirror deposit onchain (best-effort)
      try {
        await registryMarkDeposited({
          refId: refId as `0x${string}`,
          depositTxHash: depositTx as `0x${string}`,
        })
      } catch (e: any) {
        console.warn('[finish] registryMarkDeposited failed (non-fatal):', e?.message || e)
      }
    } else {
      console.log('[finish] deposit already done; skipping')
    }

    // 3) Mint on OP — idempotent
    intent = await prisma.depositIntent.findUnique({ where: { refId } })
    if (intent?.status === 'MINTED' && intent.mintTxHash) {
      return json({ ok: true, refId, status: 'MINTED', mintTxHash: intent.mintTxHash })
    }

    if (!intent?.mintTxHash) {
      if (!intent || !intent.user) throw new Error('Missing user on intent row')

      await ensureOwner(refId, owner)
      await renewLease(refId, owner)

      // Move into MINTING if we are at DEPOSITED
      await prisma.depositIntent.updateMany({
        where: { refId, status: { in: ['DEPOSITED'] } },
        data: { status: 'MINTING', updatedAt: new Date() },
      })

      const { mintTx } = await mintReceipt(intent.user as `0x${string}`, amt, opRewardsVault)

      // Atomically mark MINTED from either DEPOSITED or MINTING
      const upd = await prisma.depositIntent.updateMany({
        where: { refId, status: { in: ['DEPOSITED', 'MINTING'] } },
        data: {
          status: 'MINTED',
          mintTxHash: mintTx,
          consumedAt: new Date(),
          updatedAt: new Date(),
        },
      })

      if (upd.count === 0) {
        const finalRow = await prisma.depositIntent.findUnique({ where: { refId } })
        if (finalRow?.status !== 'MINTED') {
          await prisma.depositIntent
            .update({
              where: { refId },
              data: {
                status: 'MINTED',
                mintTxHash: mintTx,
                consumedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .catch(() => {})
        }
      }

      // Mirror mint onchain (best-effort)
      try {
        await registryMarkMinted({
          refId: refId as `0x${string}`,
          mintTxHash: mintTx as `0x${string}`,
        })
      } catch (e: any) {
        console.warn('[finish] registryMarkMinted failed (non-fatal):', e?.message || e)
      }

      mintedOk = true
    }

    return json({ ok: true, refId, status: 'MINTED' })
  } catch (e: any) {
    console.error('[finish] failed:', e?.message || e)

    try {
      if (refIdForCatch && !mintedOk) {
        const current = await prisma.depositIntent.findUnique({ where: { refId: refIdForCatch } })
        if (current && current.status !== 'MINTED') {
          await prisma.depositIntent.update({
            where: { refId: refIdForCatch },
            data: { status: 'FAILED', error: e?.message || String(e) },
          })

          // Mirror failure onchain (best-effort)
          try {
            await registryMarkFailed({
              refId: refIdForCatch as `0x${string}`,
              reason: e?.message || 'finish failed',
            })
          } catch (regErr: any) {
            console.warn('[finish] registryMarkFailed failed (non-fatal):', regErr?.message || regErr)
          }
        }
      }
    } catch {}

    return NextResponse.json({ ok: false, error: e?.message || 'finish failed' }, { status: 500 })
  }
}
