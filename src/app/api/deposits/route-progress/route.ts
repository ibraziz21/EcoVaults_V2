// src/app/api/relayer/route-progress/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createPublicClient, http } from 'viem'
import { base, optimism } from 'viem/chains'

/* ──────────────────────────────────────────────────────────── */
/* Env / constants                                              */
/* ──────────────────────────────────────────────────────────── */

const RELAYER_LISK = process.env.RELAYER_LISK?.toLowerCase() || null
const USDT0_LISK   = process.env.USDT0_LISK?.toLowerCase()   || null
const LISK_CHAIN_ID = Number(process.env.LISK_CHAIN_ID ?? 1135) // adjust if different on your setup

/* ──────────────────────────────────────────────────────────── */
/* Helpers                                                      */
/* ──────────────────────────────────────────────────────────── */

function json(x: any, s = 200) { return NextResponse.json(x, { status: s }) }
function bad(m: string, s = 400) {
  console.error('[route-progress]', m)
  return json({ ok: false, error: m }, s)
}

// Only need OP/Base for source tx validation
const clientFor = (id: number) => {
  if (id === base.id) return createPublicClient({ chain: base, transport: http() })
  if (id === optimism.id) return createPublicClient({ chain: optimism, transport: http() })
  // If you later allow other sources, add them here.
  throw new Error(`unsupported fromChainId: ${id}`)
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
    const prevNorm = typeof prev === 'string' ? prev.toLowerCase?.() ?? prev : prev
    const nextNorm = typeof incoming === 'string' ? incoming.toLowerCase?.() ?? incoming : incoming
    if (prev != null && prev !== '' && prevNorm !== nextNorm) {
      throw new Error(`immutable field already set: ${String(field)}`)
    }
    data[field] = incoming
  }

  try {
    // ── Destination invariants (anti-poisoning) ──────────────
    if (b.toChainId != null) {
      if (typeof b.toChainId !== 'number') return bad('toChainId invalid')
      if (b.toChainId !== LISK_CHAIN_ID) return bad(`toChainId mismatch (expected ${LISK_CHAIN_ID})`)
      immutableGuard('toChainId', b.toChainId)
    }

    if (b.toAddress) {
      const toAddr = b.toAddress.toLowerCase()
      if (RELAYER_LISK && toAddr !== RELAYER_LISK) return bad('toAddress mismatch (relayer)')
      immutableGuard('toAddress', toAddr)
    }

    if (b.toTokenAddress) {
      const tok = b.toTokenAddress.toLowerCase()
      if (USDT0_LISK && tok !== USDT0_LISK) return bad('toTokenAddress mismatch (USDT0)')
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

      immutableGuard('fromChainId', srcId)

      const client = clientFor(srcId)
      const rcp = await client.getTransactionReceipt({ hash: b.fromTxHash }).catch(() => null)
      if (!rcp) return bad('fromTx not found on chain', 422)

      const txFrom = rcp.from?.toLowerCase?.()
      if (!txFrom || txFrom !== intent.user.toLowerCase()) {
        return bad('fromTx sender mismatch with intent.user', 422)
      }

      // Status bump: PENDING -> ROUTING
      if (intent.status === 'PENDING') data.status = 'ROUTING'
    }

    // ── Destination tx hash: set immutably and bump status ────
    if (b.toTxHash) {
      immutableGuard('toTxHash', b.toTxHash)
      if (intent.status === 'PENDING' || intent.status === 'ROUTING') {
        data.status = 'BRIDGED'
      }
    }

    await prisma.depositIntent.update({ where: { refId: b.refId }, data })
    return json({ ok: true })
  } catch (e) {
    return bad((e as Error).message, 400)
  }
}