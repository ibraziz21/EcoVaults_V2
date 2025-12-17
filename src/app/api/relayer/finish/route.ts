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
} from '@/lib/constants'
import { randomUUID } from 'node:crypto'

// ---------- config / env ----------
const LIFI_STATUS_URL = 'https://li.quest/v1/status'
const LISK_ID = lisk.id
const MIN_CONFIRMATIONS = 3            // Lisk confirmations for reorg safety
const LEASE_MS = 60_000                // single-flight lease time

const RELAYER_PRIVATE_KEY_RAW = (process.env.RELAYER_PRIVATE_KEY || '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
if (!RELAYER_PRIVATE_KEY_RAW) {
  console.warn('[finish] RELAYER_PRIVATE_KEY is empty or missing')
}
const RELAYER_PRIVATE_KEY = (`0x${RELAYER_PRIVATE_KEY_RAW.replace(/^0x/i, '')}`) as `0x${string}`
const relayer = privateKeyToAccount(RELAYER_PRIVATE_KEY)

// Lisk (USDT0, Morpho), OP (mint)
const USDT0_LISK = TokenAddresses.USDT0.lisk as `0x${string}`
const MORPHO_POOL = '0x50cb55be8cf05480a844642cb979820c847782ae' as `0x${string}`
const OP_REWARDS_VAULT = (REWARDS_VAULT.optimismUSDT ??
  '0x1aDBe89F2887a79C64725128fd1D53b10FD6b441') as `0x${string}`

function json(x: any, s = 200) { return NextResponse.json(x, { status: s }) }
function bad(m: string, s = 400) { return json({ ok: false, error: m }, s) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const leaseUntil = (ms = LEASE_MS) => new Date(Date.now() + ms)

/* ────────────────────────────────────────────────────────────
   Status ordering & idempotent advance wrapper
   ──────────────────────────────────────────────────────────── */
const ORDER = [
  'PENDING',
  'WAITING_ROUTE',
  'BRIDGING',
  'BRIDGE_IN_FLIGHT',
  'BRIDGED',
  'DEPOSITING',
  'DEPOSITED',
  'MINTING',
  'MINTED',
  'FAILED',
] as const
type Status = typeof ORDER[number]
const rank = (s?: string) => Math.max(0, ORDER.indexOf((s || '').toUpperCase() as Status))
const aheadOrEqual = (curr?: string, want?: string) => rank(curr) >= rank(want)

async function advanceIdempotent(
  refId: string,
  from: DepositState,
  to: DepositState,
  data?: Record<string, any>,
) {
  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) throw new Error('intent not found')
  if (row.status === to || aheadOrEqual(row.status, to)) {
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
  const res = await fetch(`${LIFI_STATUS_URL}?${q.toString()}`, { method: 'GET', headers: { accept: 'application/json' } })
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
  keepAliveEvery?: number  // in polls
}) {
  const { fromChainId, toChainId, fromTxHash, timeoutMs = 12 * 60_000, pollMs = 6_000, keepAlive, keepAliveEvery = 5 } = args
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
   Mint on Optimism (idempotent at caller level)
   ──────────────────────────────────────────────────────────── */
async function mintReceipt(user: `0x${string}`, amount: bigint) {
  const { pub, wlt, account } = makeOpClients()
  const { request } = await pub.simulateContract({
    address: OP_REWARDS_VAULT,
    abi: rewardsAbi,
    functionName: 'recordDeposit',
    args: [user, amount],
    account,
  })
  const mintTx = await wlt.writeContract(request)
  await pub.waitForTransactionReceipt({ hash: mintTx , confirmations: 3 })
  return { mintTx }
}

/* ────────────────────────────────────────────────────────────
   Single-flight lease (owner + expiry)
   ──────────────────────────────────────────────────────────── */
async function tryLockIntent(refId: string) {
  const owner = randomUUID()

  // try acquire fresh lease
  const acquired = await prisma.depositIntent.updateMany({
    where: {
      refId,
      OR: [
        { status: { in: ['PENDING', 'WAITING_ROUTE', 'BRIDGING', 'BRIDGE_IN_FLIGHT', 'BRIDGED', 'FAILED'] } },
        {
          status: { in: ['PROCESSING', 'DEPOSITING', 'MINTING'] },
          OR: [
            { processingLeaseUntil: null },
            { processingLeaseUntil: { lt: new Date() } }, // stale
          ],
        },
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
  if (row.status === 'MINTED' || row.status === 'SUCCESS') return { ok: false, reason: 'Already done' }
  return { ok: false, reason: 'Already processing', status: row.status, updatedAt: row.updatedAt }
}

async function ensureOwner(refId: string, owner: string) {
  const row = await prisma.depositIntent.findUnique({ where: { refId } })
  if (!row) throw new Error('Unknown refId')
  if (row.processingOwner !== owner && row.status !== 'MINTED')
    throw new Error('Lost lease to another finisher')
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

    // lock row (single-flight)
    const lock = await tryLockIntent(refId)
    if (!lock.ok) {
      if (lock.reason === 'Already done') return json({ ok: true, already: true, status: 'MINTED' })
      return json({ ok: true, processing: true, reason: lock.reason }, 202)
    }
    const owner = lock.owner!

    let intent = await prisma.depositIntent.findUnique({ where: { refId } })
    if (!intent) return bad('Unknown refId', 404)

    // ✅ short-circuit if already MINTED
    if (intent.status === 'MINTED' && intent.mintTxHash) {
      return json({ ok: true, already: true, status: 'MINTED', mintTxHash: intent.mintTxHash })
    }

    // Merge new facts (fromTxHash/chain ids/minAmount)
    const patch: any = {}
    if (fromTxHash && intent.fromTxHash !== fromTxHash) patch.fromTxHash = fromTxHash
    if (fromChainId && intent.fromChainId !== fromChainId) patch.fromChainId = fromChainId
    if (toChainId && intent.toChainId !== toChainId) patch.toChainId = toChainId
    if (minAmountStr) {
      // only relax or set once; never raise the bar later
      const incoming = BigInt(minAmountStr)
      const current  = intent.minAmount ? BigInt(intent.minAmount) : null
      if (current === null || incoming < current) {
        patch.minAmount = incoming.toString()
      }
    }
    if (Object.keys(patch).length) {
      intent = await prisma.depositIntent.update({ where: { refId }, data: patch })
    }

    // If still no source tx, move to WAITING_ROUTE and exit
    if (!intent.fromTxHash) {
      await advanceIdempotent(refId, 'PENDING', 'WAITING_ROUTE')
      return json({ ok: true, waiting: true }, 202)
    }

    // We have a txHash; bridge should be in flight
    await advanceIdempotent(refId, 'WAITING_ROUTE', 'BRIDGE_IN_FLIGHT')
    await advanceIdempotent(refId, 'PROCESSING', 'BRIDGE_IN_FLIGHT')

    const srcChain = intent.fromChainId ?? fromChainId
    const dstChain = intent.toChainId ?? toChainId
    if (!srcChain) return bad('fromChainId required')
    if (!dstChain) return bad('toChainId required')

    // 1) Wait Li.Fi (renew the lease periodically)
    console.log('[finish] waiting Li.Fi by tx…')
    const { bridgedAmount, receiving } = await waitForLiFiDone({
      fromChainId: srcChain,
      toChainId: dstChain,
      fromTxHash: intent.fromTxHash as `0x${string}`,
      keepAlive: () => renewLease(refId, owner),
      keepAliveEvery: 5,
    })

    const toTxHash = (receiving?.txHash as `0x${string}` | undefined) ?? intent.toTxHash ?? undefined
    if (!receiving) throw new Error('LiFi DONE but missing receiving payload')

      const recvAddr = receiving.token?.address as `0x${string}` | undefined
      const expected = (intent.toTokenAddress as `0x${string}` | undefined) ?? USDT0_LISK
      
      if (!recvAddr) {
        throw new Error('LiFi DONE but receiving.token.address is empty')
      }
      if (recvAddr.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`Unexpected dest token ${recvAddr}, expected ${expected}`)
      }

    // Reorg safety on destination chain
    if (toTxHash) {
      const { pub: liskPub } = makeLiskClients()
      await liskPub.waitForTransactionReceipt({ hash: toTxHash as `0x${string}`, confirmations: MIN_CONFIRMATIONS })
    }

    // Respect minAmount (from DB or request)
    const minAmount =
      (intent.minAmount && intent.minAmount.length > 0)
        ? BigInt(intent.minAmount)
        : (typeof minAmountStr === 'string' ? BigInt(minAmountStr) : 0n)

    if (minAmount > 0n && bridgedAmount < minAmount) {
      throw new Error(`Bridged amount ${bridgedAmount} < minAmount ${minAmount}`)
    }
    const toTokenAddr = recvAddr

    await advanceIdempotent(refId, 'BRIDGE_IN_FLIGHT', 'BRIDGED', {
      toTxHash: toTxHash ?? null,
      toTokenAddress: toTokenAddr ?? null,
      bridgedAmount: bridgedAmount.toString(),
    })

    const amt = bridgedAmount
    if (amt <= 0n) throw new Error('Zero bridged amount')

    // 2) Deposit on Lisk (idempotent)
    intent = await prisma.depositIntent.findUnique({ where: { refId } })
    const { pub: liskPub } = makeLiskClients()

    if (!intent?.depositTxHash) {
      await ensureOwner(refId, owner)
      await renewLease(refId, owner)

      await advanceIdempotent(refId, 'BRIDGED', 'DEPOSITING')
      const { depositTx, verified } = await ensureAllowanceThenDeposit({
        pub: liskPub as PublicClient,
        account: relayer,
        chain: lisk,
        token: USDT0_LISK,
        vaultAddr: MORPHO_POOL,
        receiver: SAFEVAULT,
        amount: amt,
        morphoAbi,
        log: console.log,
      })

      if (verified.sender.toLowerCase()  !== relayer.address.toLowerCase()) {
        throw new Error('Deposit sender mismatch (expected relayer EOA)')
      }
      if (verified.vault.toLowerCase()   !== MORPHO_POOL.toLowerCase()) {
        throw new Error('Deposit vault mismatch')
      }
      if (verified.receiver.toLowerCase()!== SAFEVAULT.toLowerCase()) {
        throw new Error('Deposit receiver mismatch (must be SAFE)')
      }
      if (verified.token.toLowerCase()   !== USDT0_LISK.toLowerCase()) {
        throw new Error('Deposit token mismatch (must be USDT0)')
      }
      if (verified.amount !== amt) {
        throw new Error(`Deposit amount mismatch: ${verified.amount} != ${amt}`)
      }
      
      await advanceIdempotent(refId, 'DEPOSITING', 'DEPOSITED', {
        depositTxHash: depositTx,
      })
    } else {
      console.log('[finish] deposit already done; skipping')
    }

    // 3) Mint on OP — idempotent transition using updateMany
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

      const { mintTx } = await mintReceipt(intent.user as `0x${string}`, amt)

      // Atomically mark MINTED from either DEPOSITED or MINTING
      const upd = await prisma.depositIntent.updateMany({
        where: { refId, status: { in: ['DEPOSITED', 'MINTING'] } },
        data: { status: 'MINTED', mintTxHash: mintTx,consumedAt: new Date(), updatedAt: new Date() },
      })

      if (upd.count === 0) {
        // If someone else already marked MINTED, ensure we won't re-mint next call
        const finalRow = await prisma.depositIntent.findUnique({ where: { refId } })
        if (finalRow?.status !== 'MINTED') {
          await prisma.depositIntent.update({
            where: { refId },
            data: { status: 'MINTED', mintTxHash: mintTx, consumedAt: new Date(), updatedAt: new Date() },
          }).catch(() => {})
        }
      }
      mintedOk = true
    }

    return json({ ok: true, refId, status: 'MINTED' })
  } catch (e: any) {
    console.error('[finish] failed:', e?.message || e)

    // Don’t regress to FAILED if mint already succeeded
    try {
      if (refIdForCatch && !mintedOk) {
        const current = await prisma.depositIntent.findUnique({ where: { refId: refIdForCatch } })
        if (current && current.status !== 'MINTED') {
          await prisma.depositIntent.update({
            where: { refId: refIdForCatch },
            data: { status: 'FAILED', error: e?.message || String(e) },
          })
        }
      }
    } catch {}
    return NextResponse.json({ ok: false, error: e?.message || 'finish failed' }, { status: 500 })
  }
}