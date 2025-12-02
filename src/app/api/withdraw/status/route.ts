import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const refId = searchParams.get('refId') || ''
  if (!refId) return NextResponse.json({ ok: false, error: 'refId required' }, { status: 400 })

  const row = await prisma.withdrawIntent.findUnique({ where: { refId } })
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  return NextResponse.json({
    ok: true,
    refId: row.refId,
    status: row.status,
    redeemTxHash: row.redeemTxHash,
    fromTxHash: row.fromTxHash,
    toTxHash: row.toTxHash,
    amountOut: row.amountOut,
    burnTxHash: row.burnTxHash,
    updatedAt: row.updatedAt,
  })
}