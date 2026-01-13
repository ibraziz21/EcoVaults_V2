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
  routeId?: string | null
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
      // In some retries the UI may not know the dest; accept but still enforce if it is the expected Lisk id
      if (b.toChainId !== LISK_CHAIN_ID) console.warn('[route-progress] toChainId differs from expected', b.toChainId)
      immutableGuard('toChainId', b.toChainId)
    }

    if (b.toAddress) {
      const toAddr = b.toAddress.toLowerCase()
      if (RELAYER_LISK && toAddr !== RELAYER_LISK) {
        console.warn('[route-progress] toAddress mismatch (relayer)', { toAddr, expected: RELAYER_LISK })
      }
      immutableGuard('toAddress', toAddr)
    }

    if (b.toTokenAddress) {
      const tok = b.toTokenAddress.toLowerCase()
      if (USDT0_LISK && tok !== USDT0_LISK) {
        console.warn('[route-progress] toTokenAddress mismatch (USDT0)', { tok, expected: USDT0_LISK })
      }
      immutableGuard('toTokenAddress', tok)
    }

    if (b.toTokenSymbol) {
      immutableGuard('toTokenSymbol', b.toTokenSymbol)
    }

    // RouteId persistence (for later hash polling)
    if (b.routeId && b.routeId.trim()) {
      if (!intent.routeId) data.routeId = b.routeId.trim()
    }

    // ── Source tx: store immediately (may be pending; avoid 422s) ─
    if (b.fromTxHash) {
      const incomingHash = b.fromTxHash.trim().toLowerCase() as `0x${string}`
      if (!incomingHash || incomingHash.length < 10) {
        console.warn('[route-progress] empty/short fromTxHash ignored')
      } else {
        // If an intent already has a different hash, do not fail; just acknowledge
        if (intent.fromTxHash && intent.fromTxHash.trim().toLowerCase() !== incomingHash) {
          console.warn('[route-progress] fromTxHash already set, ignoring new value', {
            existing: intent.fromTxHash,
            incoming: incomingHash,
          })
        } else {
          data.fromTxHash = incomingHash
        }

        const srcId = b.fromChainId ?? intent.fromChainId
        if (srcId) {
          immutableGuard('fromChainId', srcId)

          // Do not block on chain lookups; hash may still be pending when UI calls us
          try {
            const client = clientFor(srcId)
            const rcp = await client.getTransactionReceipt({ hash: incomingHash })
            const txFrom = rcp.from?.toLowerCase?.()
            if (txFrom && txFrom !== intent.user.toLowerCase()) {
              console.warn('[route-progress] fromTx sender mismatch with intent.user', { txFrom, user: intent.user })
            }
          } catch (e) {
            console.warn('[route-progress] tx receipt not yet available (non-fatal)', (e as any)?.message || e)
          }
        }

        // Status bump: PENDING -> WAITING_ROUTE to align with finish flow
        if (intent.status === 'PENDING') data.status = 'WAITING_ROUTE'
      }
    }

    // ── Destination tx hash: set immutably and bump status ────
    if (b.toTxHash) {
      immutableGuard('toTxHash', b.toTxHash)
      if (intent.status === 'PENDING' || intent.status === 'ROUTING' || intent.status === 'WAITING_ROUTE') {
        data.status = 'BRIDGED'
      }
    }

    await prisma.depositIntent.update({ where: { refId: b.refId }, data })
    return json({ ok: true })
  } catch (e) {
    return bad((e as Error).message, 400)
  }
}
