import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { prisma } from '@/lib/db'

// Include early states so users who close the modal early still see their intents
const STUCK_STATUSES = [
  'PENDING',
  'WAITING_ROUTE',
  'PROCESSING',
  'BRIDGE_IN_FLIGHT',
  'DEPOSITED',
  'MINTING',
  'FAILED',
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const user = url.searchParams.get('user') || ''
  if (!user || !isAddress(user as `0x${string}`)) {
    return NextResponse.json({ ok: false, error: 'Invalid user' }, { status: 400 })
  }

  const rows = await prisma.depositIntent.findMany({
    where: {
      user: {
        equals: user,
        mode: 'insensitive',
      },
      status: { in: STUCK_STATUSES },
      mintTxHash: null,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      refId: true,
      status: true,
      fromTxHash: true,
      toTxHash: true,
      depositTxHash: true,
      amount: true,
      minAmount: true,
      error: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ ok: true, intents: rows })
}
