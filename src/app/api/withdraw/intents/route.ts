import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { prisma } from '@/lib/db'

// Stuck/ongoing statuses we want users to be able to resume
const STUCK = [
  'PENDING',
  'PROCESSING',
  'BURNED',
  'REDEEMING',
  'REDEEMED',
  'BRIDGING',
  'FAILED',
] as const

export async function GET(req: Request) {
  const url = new URL(req.url)
  const user = url.searchParams.get('user') || ''
  if (!user || !isAddress(user as `0x${string}`)) {
    return NextResponse.json({ ok: false, error: 'Invalid user' }, { status: 400 })
  }

  const intents = await prisma.withdrawIntent.findMany({
    where: {
      user: { equals: user, mode: 'insensitive' },
      status: { in: STUCK as any },
      // Hide completed
      toTxHash: null,
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      refId: true,
      status: true,
      burnTxHash: true,
      redeemTxHash: true,
      fromTxHash: true,
      toTxHash: true,
      amountOut: true,
      amountShares: true,
      minAmountOut: true,
      error: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ ok: true, intents })
}
