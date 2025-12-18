// src/app/api/relayer/attach-tx/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { optimism, lisk } from 'viem/chains'
import type { DepositState } from '@/domain/states'
import { advanceDeposit } from '@/domain/advance'

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}

const LISK_ID = lisk.id
const OP_ID = optimism.id

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
const rank = (s?: string) => {
  const i = STATE_ORDER.indexOf((s || '').toUpperCase() as DepositState)
  return i === -1 ? -1 : i
}
const aheadOrEqual = (curr?: string, want?: DepositState) => rank(curr) >= rank(want)

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    const refId = body?.refId as `0x${string}` | undefined
    const fromTxHash = body?.fromTxHash as `0x${string}` | undefined
    const fromChainId = (body?.fromChainId as number | undefined) ?? OP_ID
    const toChainId = (body?.toChainId as number | undefined) ?? LISK_ID
    const minAmount = body?.minAmount as string | undefined

    if (!refId) return bad('refId required')
    if (!fromTxHash) return bad('fromTxHash required')

    if (fromChainId !== OP_ID) return bad(`fromChainId must be Optimism (${OP_ID})`, 422)
    if (toChainId !== LISK_ID) return bad(`toChainId must be Lisk (${LISK_ID})`, 422)

    const row = await prisma.depositIntent.findUnique({ where: { refId } })
    if (!row) return bad('Unknown refId', 404)

    // Idempotent patch: never overwrite a different hash
    if (row.fromTxHash && row.fromTxHash.toLowerCase() !== fromTxHash.toLowerCase()) {
      return bad(`fromTxHash already set to a different value on this refId`, 409)
    }

    const patch: any = {
      fromTxHash,
      fromChainId,
      toChainId,
      updatedAt: new Date(),
    }

    // Optional: store minAmount as the most conservative value (smaller min is safer)
    if (typeof minAmount === 'string' && minAmount.length > 0) {
      const incoming = BigInt(minAmount)
      const current = row.minAmount ? BigInt(row.minAmount) : null
      if (current === null || incoming < current) patch.minAmount = incoming.toString()
    }

    const updated = await prisma.depositIntent.update({
      where: { refId },
      data: patch,
    })

    // Nudge state forward so finish can immediately poll LiFi
    // - If user was still PENDING / WAITING_ROUTE / FAILED, move to BRIDGE_IN_FLIGHT.
    // - If already beyond, do nothing.
    if (updated.status === 'PENDING') {
      await advanceIdempotent(refId, 'PENDING', 'BRIDGE_IN_FLIGHT')
    } else if (updated.status === 'WAITING_ROUTE') {
      await advanceIdempotent(refId, 'WAITING_ROUTE', 'BRIDGE_IN_FLIGHT')
    } else if (updated.status === 'FAILED') {
      // treat attach as a “retry”: move FAILED -> BRIDGE_IN_FLIGHT only if you want auto-retry semantics
      await prisma.depositIntent.updateMany({
        where: { refId, status: 'FAILED' },
        data: { status: 'BRIDGE_IN_FLIGHT', error: null, updatedAt: new Date() },
      })
    }

    return json({ ok: true, refId, fromTxHash })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'attach-tx failed' }, { status: 500 })
  }
}
