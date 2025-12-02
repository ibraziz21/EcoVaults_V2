import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const refId = searchParams.get('refId') as `0x${string}` | null
  if (!refId) return NextResponse.json({ ok: false, error: 'refId required' }, { status: 400 })

  const row = await prisma.depositIntent.findUnique({
    where: { refId },
    select: {
      refId: true, status: true,
      fromTxHash: true, toTxHash: true, depositTxHash: true, mintTxHash: true,
      fromChainId: true, toChainId: true, toTokenAddress: true,
      minAmount: true, bridgedAmount: true, error: true, updatedAt: true,
    },
  })
  if (!row) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })

  return NextResponse.json({ ok: true, ...row })
}
