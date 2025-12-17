// src/app/api/create-intent/route.ts
'use server'
import 'server-only'
import { createPublicClient, http, parseAbi } from 'viem'
import { NextResponse } from 'next/server'
import { verifyTypedData, hashTypedData } from 'viem'
import { optimism, lisk as liskChain } from 'viem/chains'
import { prisma } from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { registryCreateIntent } from '@/lib/intentRegistry'
import { TokenAddresses } from '@/lib/constants'

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

/** allowlist of supported destination assets (Lisk) */
const ALLOWED_ASSETS = new Set<string>([
  TokenAddresses.USDCe.lisk.toLowerCase(),
  TokenAddresses.USDT0.lisk.toLowerCase(),
  TokenAddresses.WETH.lisk.toLowerCase(),
])

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

  // Enforce supported destination asset (anti-poisoning)
  const assetLc = String(intent.asset).toLowerCase()
  if (!ALLOWED_ASSETS.has(assetLc)) {
    return bad('unsupported asset', 422)
  }

  // Enforce amount > 0 before any heavy work
  let amt: bigint
  try {
    amt = BigInt(intent.amount)
  } catch {
    return bad('amount invalid', 422)
  }
  if (amt <= 0n) return bad('amount must be > 0', 422)

  // Domain is always Optimism now (user side = OP only)
  const chainId = optimism.id
  const domain = { name: 'SuperYLDR', version: '1', chainId }

  // Enforce expiry before any heavy work
  if (BigInt(intent.deadline) <= BigInt(nowSec())) return bad('intent expired', 401)

  const adapterKeyForSig = (intent.adapterKey ?? ZERO32) as `0x${string}`

  const types = {
    DepositIntent: [
      { name: 'user', type: 'address' },
      { name: 'key', type: 'bytes32' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'refId', type: 'bytes32' },
      { name: 'salt', type: 'bytes32' },
    ],
  } as const

  const message = {
    user: intent.user,
    key: adapterKeyForSig,
    asset: intent.asset,
    amount: amt,
    deadline: BigInt(intent.deadline),
    nonce: BigInt(intent.nonce),
    refId: intent.refId,
    salt: intent.salt,
  }
  const EIP1271_ABI = parseAbi([
    'function isValidSignature(bytes32 _hash, bytes _signature) view returns (bytes4)',
  ])
  const EIP1271_MAGICVALUE = '0x1626ba7e' as const
  
  const opPublic = createPublicClient({
    chain: optimism,
    transport: http(process.env.OP_RPC_URL || 'https://mainnet.optimism.io'),
  })
  
  async function isContractAddress(addr: `0x${string}`) {
    const code = await opPublic.getBytecode({ address: addr })
    return !!code && code !== '0x'
  }
  
  async function verifyEOAor1271(opts: {
    user: `0x${string}`
    domain: any
    types: any
    primaryType: 'DepositIntent'
    message: any
    signature: `0x${string}`
  }) {
    const { user, domain, types, primaryType, message, signature } = opts
  
    // 1) Try EOA verification first
    const okEOA = await verifyTypedData({
      address: user,
      domain,
      types,
      primaryType,
      message,
      signature,
    }).catch(() => false)
  
    if (okEOA) return true
  
    // 2) If it's a contract (Safe), verify via EIP-1271
    const isContract = await isContractAddress(user)
    if (!isContract) return false
  
    const digest = hashTypedData({ domain, types, primaryType, message })
  
    const res = await opPublic.readContract({
      address: user,
      abi: EIP1271_ABI,
      functionName: 'isValidSignature',
      args: [digest, signature],
    }).catch(() => null)
  
    return (res as string | null)?.toLowerCase() === EIP1271_MAGICVALUE
  }

 // 1) Verify signature (EOA or Safe EIP-1271)
const ok = await verifyEOAor1271({
  user: intent.user,
  domain,
  types,
  primaryType: 'DepositIntent',
  message,
  signature,
})
if (!ok) return bad('invalid signature', 401)

  // 2) Compute EIP-712 digest for replay/idempotency control
  const digest = hashTypedData({
    domain,
    types,
    primaryType: 'DepositIntent',
    message,
  })

  // 3) Pre-flight uniqueness checks (idempotency & replay safety)
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
        OR: [{ digest: digest as any }, { signature: signature as any }] as any,
      },
      select: { refId: true },
    })
    .catch(() => null)

  if (existed) return bad('intent already recorded', 409)

  // 4) Create the persistent record (PENDING)
  const data: any = {
    refId: intent.refId,
    user: intent.user,
    adapterKey: intent.adapterKey ?? null,
    asset: intent.asset,
    amount: intent.amount, // store as string
    minAmount: intent.amount, // initial; can be relaxed later in /finish
    deadline: intent.deadline,
    nonce: intent.nonce,
    salt: intent.salt,
    digest,
    signature,
    status: 'PENDING',
    fromChainId: optimism.id, // 🔒 user side is always Optimism now
    toChainId: liskChain.id, // 🔒 destination is Lisk in this build
    // srcToken: intent.srcToken ?? null, // uncomment if added to Prisma
  }

  const intentToken = randomUUID()

  const row = await prisma.depositIntent
    .create({
      data: {
        ...data,
        intentToken,
      },
    })
    .catch((e) => {
      console.error('[create-intent] create failed:', e)
      return null
    })

  if (!row) return bad('failed to persist intent', 500)

  // 5) Mirror to onchain registry (best-effort, non-fatal)
  try {
    if (row.asset) {
      await registryCreateIntent({
        refId: row.refId as `0x${string}`,
        user: row.user as `0x${string}`,
        asset: row.asset as `0x${string}`,
        amount: BigInt(row.amount),
        fromChainId: row.fromChainId ?? optimism.id,
        toChainId: row.toChainId ?? liskChain.id,
      })
    }
  } catch (e: any) {
    console.warn('[create-intent] registryCreateIntent failed (non-fatal):', e?.message || e)
  }

  return json({ ok: true, refId: row.refId, digest, intentToken })
}