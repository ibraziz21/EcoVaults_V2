// src/app/api/withdraw/create-intent/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyTypedData, isAddress, type Address } from 'viem'

function json(x: any, s = 200) { return NextResponse.json(x, { status: s }) }
function bad(m: string, s = 400) { return json({ ok: false, error: m }, s) }

const TYPES = {
  WithdrawIntent: [
    { name: 'user',         type: 'address' },
    { name: 'amountShares', type: 'uint256' },
    { name: 'dstChainId',   type: 'uint256' },
    { name: 'dstToken',     type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'deadline',     type: 'uint256' },
    { name: 'nonce',        type: 'uint256' },
    { name: 'refId',        type: 'bytes32' },
  ],
} as const

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const intent = body?.intent ?? {}
    const signature = body?.signature as `0x${string}` | undefined

    if (!signature) return bad('Missing signature')

    const user         = intent.user as Address
    const amountStr    = intent.amountShares as string
    const dstChainNum  = Number(intent.dstChainId ?? 0)
    const dstToken     = intent.dstToken as Address
    const minOutStr    = intent.minAmountOut as string
    const deadlineStr  = intent.deadline as string
    const nonceStr     = intent.nonce as string
    const refId        = intent.refId as `0x${string}`
    const signedChainId = Number(intent.signedChainId ?? 0)

    if (!isAddress(user)) return bad('Invalid user')
    if (!isAddress(dstToken)) return bad('Invalid dstToken')
    if (!refId || !refId.startsWith('0x') || refId.length !== 66) return bad('Invalid refId')
    if (!Number.isInteger(dstChainNum) || dstChainNum <= 0) return bad('Invalid dstChainId')
    if (!Number.isInteger(signedChainId) || signedChainId <= 0) return bad('Missing signedChainId')

    // Rebuild the same domain the wallet used
    const domain = { name: 'SuperYLDR', version: '1', chainId: signedChainId } as const

    // Rebuild message with proper bigints (uint256)
    const message = {
      user,
      amountShares: BigInt(amountStr),
      dstChainId:   BigInt(dstChainNum),
      dstToken,
      minAmountOut: BigInt(minOutStr),
      deadline:     BigInt(deadlineStr),
      nonce:        BigInt(nonceStr),
      refId,
    } as const

    const ok = await verifyTypedData({
      address: user,
      domain,
      types: TYPES,
      primaryType: 'WithdrawIntent',
      message,
      signature,
    }).catch(() => false)

    if (!ok) return bad('Invalid signature', 401)

    // Persist intent — schema per your last message
    await prisma.withdrawIntent.create({
      data: {
        refId,
        user,
        amountShares: amountStr,
        dstChainId: dstChainNum,
        dstToken,
        minAmountOut: minOutStr,
        deadline: deadlineStr,
        nonce: nonceStr,
        status: 'PENDING',
      },
    })

    return json({ ok: true, refId })
  } catch (e: any) {
    return bad(e?.message ?? 'create-intent failed', 500)
  }
}