// src/app/api/create-intent/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyTypedData, hashTypedData } from 'viem'
import { optimism } from 'viem/chains'
import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'

/* ──────────────────────────────────────────────────────────── */
/* Types & helpers                                              */
/* ──────────────────────────────────────────────────────────── */

type CreateIntentBody = {
  intent?: {
    user: `0x${string}`
    /** Optional in current UI—if omitted, we sign with 0x00..00 and store null */
    adapterKey?: `0x${string}`
    /** Destination asset (e.g., USDT0 on Lisk) */
    asset: `0x${string}`
    /** amount as decimal string (6d) */
    amount: string
    /** unix seconds as string */
    deadline: string
    /** user-controlled/monotonic or random—stringified uint256 */
    nonce: string
    /** bytes32 unique reference for idempotency */
    refId: `0x${string}`
    /** random bytes32 per intent for replay resistance */
    salt: `0x${string}`

    // Non-signed context (optional)
    srcToken?: 'USDC' | 'USDT'
  }
  /** 65-byte ECDSA sig (0x…) */
  signature?: `0x${string}`
}

const nowSec = () => Math.floor(Date.now() / 1000)

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}

const ZERO32 = '0x'.padEnd(66, '0') as `0x${string}`

/* ──────────────────────────────────────────────────────────── */
/* Route                                                       */
/* ──────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  const { intent, signature } = (await req.json().catch(() => ({}))) as CreateIntentBody

  if (!intent || !signature) return bad('intent/signature required')

  // Required fields
  const required = ['user', 'asset', 'amount', 'deadline', 'nonce', 'refId', 'salt'] as const
  for (const k of required) {
    if (!(intent as any)[k]) return bad(`missing ${k}`)
  }

  // Domain is always Optimism now (user side = OP only)
  const chainId = optimism.id
  const domain = { name: 'SuperYLDR', version: '1', chainId }

  // Enforce expiry before any heavy work
  if (BigInt(intent.deadline) <= BigInt(nowSec())) return bad('intent expired', 401)

  const adapterKeyForSig = (intent.adapterKey ?? ZERO32) as `0x${string}`

  const types = {
    DepositIntent: [
      { name: 'user',     type: 'address' },
      { name: 'key',      type: 'bytes32' },
      { name: 'asset',    type: 'address' },
      { name: 'amount',   type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce',    type: 'uint256' },
      { name: 'refId',    type: 'bytes32' },
      { name: 'salt',     type: 'bytes32' },
    ],
  } as const

  const message = {
    user: intent.user,
    key: adapterKeyForSig,
    asset: intent.asset,
    amount: BigInt(intent.amount),
    deadline: BigInt(intent.deadline),
    nonce: BigInt(intent.nonce),
    refId: intent.refId,
    salt: intent.salt,
  }

  // 1) Verify ECDSA signature (recover == intent.user)
  const ok = await verifyTypedData({
    address: intent.user,
    domain,
    types,
    primaryType: 'DepositIntent',
    message,
    signature,
  }).catch(() => false)
  if (!ok) return bad('invalid signature', 401)

  // 2) Compute EIP-712 digest for replay/idempotency control
  const digest = hashTypedData({
    domain,
    types,
    primaryType: 'DepositIntent',
    message,
  })

  // 3) Pre-flight uniqueness checks (idempotency & replay safety)
  //    - We allow same refId to be re-sent only if it is still PENDING
  //    - digest and signature must be globally unique
  const existingByRef = await prisma.depositIntent
    .findUnique({ where: { refId: intent.refId } })
    .catch(() => null)

  if (existingByRef) {
    if (
      (existingByRef as any).digest?.toLowerCase?.() === digest.toLowerCase() &&
      (existingByRef as any).signature?.toLowerCase?.() === signature.toLowerCase() &&
      (existingByRef as any).status === 'PENDING'
    ) {
      // Idempotent replay – return same refId/digest
      return json({ ok: true, refId: existingByRef.refId, digest })
    }
    return bad('refId already exists', 409)
  }

  const existed = await prisma.depositIntent
    .findFirst({
      where: {
        OR: [
          { digest: digest as any },
          { signature: signature as any },
        ] as any,
      },
      select: { refId: true, status: true },
    })
    .catch(() => null)

  if (existed) {
    // Another intent with same digest/signature already exists
    return bad('intent already recorded', 409)
  }

  // 4) Create the persistent record (PENDING)
  const data: any = {
    refId: intent.refId,
    user: intent.user,
    adapterKey: intent.adapterKey ?? null,
    asset: intent.asset,
    amount: intent.amount,      // store as string
    minAmount: intent.amount,   // initial; can be relaxed later in /finish
    deadline: intent.deadline,
    nonce: intent.nonce,
    salt: intent.salt,
    digest,
    signature,
    status: 'PENDING',
    fromChainId: optimism.id,   // 🔒 user side is always Optimism now
    // srcToken: intent.srcToken ?? null, // uncomment if added to Prisma
  }

  const intentToken = randomUUID()

  try {
    const row = await prisma.depositIntent.create({
      data: {
        ...data,
        intentToken,
      },
    })

    return json({ ok: true, refId: row.refId, digest, intentToken })
  } catch (e: any) {
    console.error('[create-intent] create failed:', e)

    // Prisma unique-constraint race (e.g. two rapid clicks)
    if (e?.code === 'P2002') {
      try {
        const conflict = await prisma.depositIntent.findFirst({
          where: {
            OR: [
              { refId: intent.refId },
              { digest: digest as any },
              { signature: signature as any },
            ] as any,
          },
        })

        if (conflict) {
          // If the conflicting row is the same logical intent & still pending, treat as idempotent
          if (
            conflict.digest?.toLowerCase?.() === digest.toLowerCase() &&
            conflict.signature?.toLowerCase?.() === signature.toLowerCase() &&
            conflict.status === 'PENDING'
          ) {
            return json({ ok: true, refId: conflict.refId, digest })
          }

          return bad('intent already exists (race)', 409)
        }
      } catch (re) {
        console.error('[create-intent] follow-up lookup after P2002 failed:', re)
      }
    }

    // Fallback: bubble the message so you see the actual DB problem in the client
    const msg =
      e?.message ||
      e?.meta?.cause ||
      'failed to persist intent'
    return bad(msg, 500)
  }
}
