// src/app/api/create-intent/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { verifyTypedData, hashTypedData } from 'viem'
import { optimism, base } from 'viem/chains'
import { prisma } from '@/lib/db'

/* ──────────────────────────────────────────────────────────── */
/* Types & helpers                                              */
/* ──────────────────────────────────────────────────────────── */

type ChainSrc = 'optimism' | 'base'

type CreateIntentBody = {
  intent?: {
    user: `0x${string}`
    /** Optional in current UI—if omitted, we sign with 0x00..00 and store null */
    adapterKey?: `0x${string}`
    /** Destination asset (e.g., USDT0 on Lisk) */
    asset: `0x${string}`
    /** minAmount as decimal string */
    amount: string
    /** unix seconds as string */
    deadline: string
    /** user-controlled/monotonic or random—stringified uint256 */
    nonce: string
    /** bytes32 unique reference for idempotency */
    refId: `0x${string}`
    /** NEW: random bytes32 per intent for replay resistance */
    salt: `0x${string}`

    // Non-signed context (optional)
    fromChain?: ChainSrc
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

  // Domain by source chain (signer’s chain id)
  const chainId = intent.fromChain === 'base' ? base.id : optimism.id
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
      { name: 'salt',     type: 'bytes32' }, // NEW
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
  const existingByRef = await prisma.depositIntent.findUnique({
    where: { refId: intent.refId },
  }).catch(() => null)

  if (existingByRef) {
    // If same digest/signature arrives for the same refId and still pending, treat as idempotent OK.
    if (
      (existingByRef as any).digest?.toLowerCase?.() === digest.toLowerCase() &&
      (existingByRef as any).signature?.toLowerCase?.() === signature.toLowerCase() &&
      (existingByRef as any).status === 'PENDING'
    ) {
      return json({ ok: true, refId: existingByRef.refId, digest })
    }
    // Otherwise, do not allow mutation of an existing intent
    return bad('refId already exists', 409)
  }

  const existed = await prisma.depositIntent.findFirst({
    where: {
      OR: [
        { digest: digest as any },
        { signature: signature as any },
      ] as any,
    },
    select: { refId: true },
  }).catch(() => null)

  if (existed) return bad('intent already recorded', 409)

  // OPTIONAL: per-user monotonic nonce (uncomment if you want strict nonce policy)
  // const last = await prisma.depositIntent.findFirst({
  //   where: { user: intent.user },
  //   orderBy: { nonce: 'desc' as any },
  //   select: { nonce: true },
  // })
  // if (last && BigInt(intent.nonce) <= BigInt(last.nonce as any)) {
  //   return bad('nonce too low', 409)
  // }

  // 4) Create the persistent record (PENDING)
  // NOTE: We cast to `any` to tolerate schema drift (e.g., if some columns are not yet added).
  const data: any = {
    refId: intent.refId,
    user: intent.user,
    adapterKey: intent.adapterKey ?? null,
    asset: intent.asset,
    amount: intent.amount,      // store as string
    minAmount: intent.amount,   // mirror for convenience
    deadline: intent.deadline,
    nonce: intent.nonce,
    salt: intent.salt,          // NEW
    digest,                     // NEW (store hex string)
    signature,                  // NEW (store hex string)
    status: 'PENDING',
    fromChainId: intent.fromChain === 'base' ? base.id : optimism.id,
    // srcToken: intent.srcToken ?? null, // uncomment if your schema has it
  }

// 4) Create the persistent record (PENDING)
const intentToken = crypto.randomUUID() // or: import { randomUUID } from 'crypto'; const intentToken = randomUUID();

const row = await prisma.depositIntent.create({
  data: {
    ...data,       // your assembled base payload (refId, user, asset, amount, minAmount, deadline, nonce, salt, digest, signature, status, fromChainId, ...)
    intentToken,   // NEW: binds later /progress and /finish calls to this run
  },
}).catch((e) => {
  console.error('[create-intent] create failed:', e)
  return null
})

if (!row) return bad('failed to persist intent', 500)

return json({ ok: true, refId: row.refId, digest, intentToken })
}