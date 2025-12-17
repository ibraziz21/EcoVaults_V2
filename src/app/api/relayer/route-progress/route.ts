// src/app/api/relayer/route-progress/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createPublicClient, http } from 'viem'
import { optimism } from 'viem/chains'

/* ──────────────────────────────────────────────────────────── */
/* Env / constants                                              */
/* ──────────────────────────────────────────────────────────── */

const LISK_CHAIN_ID = Number(process.env.LISK_CHAIN_ID ?? 1135)

// Who is allowed to receive on Lisk (anti-poisoning)
// If you *also* receive into an executor, set this env.
// If you don't, leave it empty and only RELAYER_LISK will be allowed.
const RELAYER_LISK = (process.env.RELAYER_LISK ?? '').toLowerCase() || null
const LISK_EXECUTOR = (process.env.LISK_EXECUTOR_ADDRESS ?? '').toLowerCase() || null

/* ──────────────────────────────────────────────────────────── */
/* Helpers                                                      */
/* ──────────────────────────────────────────────────────────── */

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  console.error('[route-progress]', m)
  return json({ ok: false, error: m }, s)
}

// Source side is **only Optimism** now.
const clientFor = (id: number) => {
  if (id !== optimism.id) {
    throw new Error(`unsupported fromChainId: ${id} (only Optimism is allowed)`)
  }
  return createPublicClient({ chain: optimism, transport: http() })
}

/* ──────────────────────────────────────────────────────────── */
/* Types                                                        */
/* ──────────────────────────────────────────────────────────── */

type Body = {
  refId: `0x${string}`
  fromTxHash?: `0x${string}` | null
  toTxHash?: `0x${string}` | null
  fromChainId?: number | null
  toChainId?: number | null
  toAddress?: `0x${string}` | null
  toTokenAddress?: `0x${string}` | null
  toTokenSymbol?: string | null
}

/* ──────────────────────────────────────────────────────────── */
/* Route                                                        */
/* ──────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body
  if (!b?.refId) return bad('refId required')

  const intent = await prisma.depositIntent.findUnique({ where: { refId: b.refId } })
  if (!intent) return bad('intent not found', 404)

  const data: Record<string, any> = { updatedAt: new Date() }

  // Helper to prevent mutation once a field is set (idempotency)
  const immutableGuard = (field: keyof typeof intent, incoming?: any) => {
    if (incoming == null) return
    const prev = (intent as any)[field]

    // normalize only for addresses/symbols; do NOT lowercase tx hashes
    const norm = (v: any) =>
      typeof v === 'string' && v.startsWith('0x') && v.length === 42
        ? v.toLowerCase()
        : v

    const prevNorm = norm(prev)
    const nextNorm = norm(incoming)

    if (prev != null && prev !== '' && prevNorm !== nextNorm) {
      throw new Error(`immutable field already set: ${String(field)}`)
    }
    data[field] = incoming
  }

  try {
    // ── Destination invariants (anti-poisoning) ──────────────
    if (b.toChainId != null) {
      if (typeof b.toChainId !== 'number') return bad('toChainId invalid')
      if (b.toChainId !== LISK_CHAIN_ID) {
        return bad(`toChainId mismatch (expected ${LISK_CHAIN_ID})`)
      }
      immutableGuard('toChainId', b.toChainId)
    }

    if (b.toAddress) {
      const toAddr = b.toAddress.toLowerCase()

      // allowed receivers: relayer and optionally executor (if configured)
      const allowed = new Set<string>()
      if (RELAYER_LISK) allowed.add(RELAYER_LISK)
      if (LISK_EXECUTOR) allowed.add(LISK_EXECUTOR)

      if (allowed.size > 0 && !allowed.has(toAddr)) {
        return bad('toAddress mismatch (receiver not allowed)')
      }

      immutableGuard('toAddress', toAddr)
    }

    if (b.toTokenAddress) {
      const tok = b.toTokenAddress.toLowerCase()

      // Validate against the intent's destination asset (source of truth)
      const expectedAsset = (intent.asset ?? '').toLowerCase()
      if (expectedAsset && tok !== expectedAsset) {
        return bad(`toTokenAddress mismatch (expected intent.asset ${expectedAsset})`)
      }

      immutableGuard('toTokenAddress', tok)
    }

    if (b.toTokenSymbol) {
      immutableGuard('toTokenSymbol', b.toTokenSymbol)
    }

    // ── Source tx: validate on chain (sender must be the user) ─
    if (b.fromTxHash) {
      immutableGuard('fromTxHash', b.fromTxHash)

      const srcId = b.fromChainId ?? intent.fromChainId
      if (!srcId) return bad('fromChainId required with fromTxHash')
      if (srcId !== optimism.id) {
        return bad(`fromChainId mismatch (expected Optimism: ${optimism.id})`)
      }
      immutableGuard('fromChainId', srcId)

      const client = clientFor(srcId)

      // IMPORTANT: sender is on the transaction, not reliably on receipt
      const tx = await client.getTransaction({ hash: b.fromTxHash }).catch(() => null)
      if (!tx) return bad('fromTx not found on chain', 422)

      const txFrom = (tx.from as string | undefined)?.toLowerCase?.()
      if (!txFrom || txFrom !== intent.user.toLowerCase()) {
        return bad('fromTx sender mismatch with intent.user', 422)
      }

      // Status bump: PENDING -> WAITING_ROUTE
      if (intent.status === 'PENDING') data.status = 'WAITING_ROUTE'
    }

    // ── Destination tx hash: set immutably and bump status ────
    if (b.toTxHash) {
      immutableGuard('toTxHash', b.toTxHash)
      if (intent.status === 'PENDING' || intent.status === 'WAITING_ROUTE') {
        data.status = 'BRIDGED'
      }
    }

    await prisma.depositIntent.update({ where: { refId: b.refId }, data })
    return json({ ok: true })
  } catch (e) {
    return bad((e as Error).message, 400)
  }
}