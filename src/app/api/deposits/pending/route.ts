import 'server-only'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const user = searchParams.get('user')?.toLowerCase()
  if (!user) return NextResponse.json({ ok: false, error: 'user required' }, { status: 400 })

  const rows = await prisma.depositIntent.findMany({
    where: {
      user: { equals: user, mode: 'insensitive' },
      status: { notIn: ['MINTED', 'SUCCESS', 'FAILED'] },
    },
    select: {
      refId: true, status: true, fromTxHash: true, toTxHash: true,
      fromChainId: true, toChainId: true, toTokenAddress: true,
      minAmount: true, bridgedAmount: true, updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ ok: true, items: rows })
}
