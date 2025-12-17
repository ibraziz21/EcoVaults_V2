// src/app/api/withdraw/create-intent/route.ts
import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  verifyTypedData,
  hashTypedData,
  isAddress,
  type Address,
  createPublicClient,
  http,
} from 'viem'
import { optimism } from 'viem/chains'

function json(x: any, s = 200) {
  return NextResponse.json(x, { status: s })
}
function bad(m: string, s = 400) {
  return json({ ok: false, error: m }, s)
}

const TYPES = {
  WithdrawIntent: [
    { name: 'user', type: 'address' },
    { name: 'amountShares', type: 'uint256' },
    { name: 'dstChainId', type: 'uint256' },
    { name: 'dstToken', type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'refId', type: 'bytes32' },
  ],
} as const

const nowSec = () => Math.floor(Date.now() / 1000)

const EIP1271_ABI = [
  {
    type: 'function',
    name: 'isValidSignature',
    stateMutability: 'view',
    inputs: [
      { name: 'hash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'magicValue', type: 'bytes4' }],
  },
] as const

const EIP1271_MAGIC_VALUE = '0x1626ba7e' as const

const opRpc =
  process.env.OP_RPC_URL ||
  process.env.OPTIMISM_RPC_URL ||
  'https://mainnet.optimism.io'

const publicClient = createPublicClient({
  chain: optimism,
  transport: http(opRpc),
})

async function isContractAddress(addr: Address): Promise<boolean> {
  const code = await publicClient.getBytecode({ address: addr }).catch(() => undefined)
  return !!code && code !== '0x'
}

async function verifyEip1271Signature(args: {
  contract: Address
  digest: `0x${string}`
  signature: `0x${string}`
}): Promise<boolean> {
  const { contract, digest, signature } = args
  const magic = await publicClient
    .readContract({
      address: contract,
      abi: EIP1271_ABI,
      functionName: 'isValidSignature',
      args: [digest, signature],
    })
    .catch(() => null)

  return (magic as string | null)?.toLowerCase?.() === EIP1271_MAGIC_VALUE
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const intent = body?.intent ?? {}
    const signature = body?.signature as `0x${string}` | undefined

    if (!signature) return bad('Missing signature')

    const user = intent.user as Address
    const amountStr = intent.amountShares as string
    const dstChainNum = Number(intent.dstChainId ?? 0)
    const dstToken = intent.dstToken as Address
    const minOutStr = intent.minAmountOut as string
    const deadlineStr = intent.deadline as string
    const nonceStr = intent.nonce as string
    const refId = intent.refId as `0x${string}`
    const signedChainId = Number(intent.signedChainId ?? optimism.id)

    if (!isAddress(user)) return bad('Invalid user')
    if (!isAddress(dstToken)) return bad('Invalid dstToken')
    if (!refId || !refId.startsWith('0x') || refId.length !== 66) return bad('Invalid refId')
    if (!Number.isInteger(dstChainNum) || dstChainNum <= 0) return bad('Invalid dstChainId')
    if (!Number.isInteger(signedChainId) || signedChainId <= 0) return bad('Missing signedChainId')

    // Enforce signing on Optimism (OP-only)
    if (signedChainId !== optimism.id) {
      return bad('signedChainId must be Optimism', 400)
    }

    // Numeric sanity
    if (!amountStr || BigInt(amountStr) <= 0n) return bad('amountShares must be > 0')
    if (!minOutStr || BigInt(minOutStr) <= 0n) return bad('minAmountOut must be > 0')
    if (!deadlineStr) return bad('Missing deadline')
    if (!nonceStr) return bad('Missing nonce')

    const deadline = BigInt(deadlineStr)
    if (deadline <= BigInt(nowSec())) return bad('Withdraw intent expired', 401)

    // Domain (must match the wallet)
    const domain = {
      name: 'SuperYLDR',
      version: '1',
      chainId: signedChainId,
    } as const

    // Message (must match the wallet)
    const message = {
      user,
      amountShares: BigInt(amountStr),
      dstChainId: BigInt(dstChainNum),
      dstToken,
      minAmountOut: BigInt(minOutStr),
      deadline,
      nonce: BigInt(nonceStr),
      refId,
    } as const

    // 1) Try EOA verification first
    let ok = await verifyTypedData({
      address: user,
      domain,
      types: TYPES,
      primaryType: 'WithdrawIntent',
      message,
      signature,
    }).catch(() => false)

    // 2) If EOA check fails, try EIP-1271 (Safe / contract wallet)
    if (!ok) {
      const digest = hashTypedData({
        domain,
        types: TYPES,
        primaryType: 'WithdrawIntent',
        message,
      })

      const contract = await isContractAddress(user)
      if (contract) {
        ok = await verifyEip1271Signature({
          contract: user,
          digest,
          signature,
        })
      }
    }

    if (!ok) return bad('Invalid signature', 401)

    // Idempotency: refId
    const existingByRef = await prisma.withdrawIntent
      .findUnique({ where: { refId } })
      .catch(() => null)

    if (existingByRef) {
      return json({ ok: true, refId, already: true, status: existingByRef.status })
    }

    // Persist
    try {
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
    } catch (e: any) {
      // Handle unique constraint on (user, nonce) gracefully
      const msg = String(e?.message ?? '')
      if (msg.includes('P2002') || msg.includes('Unique constraint')) {
        const existingByUserNonce = await prisma.withdrawIntent
          .findFirst({ where: { user, nonce: nonceStr } })
          .catch(() => null)

        if (existingByUserNonce) {
          return json({
            ok: true,
            refId: existingByUserNonce.refId,
            already: true,
            status: existingByUserNonce.status,
          })
        }
      }
      throw e
    }

    return json({ ok: true, refId })
  } catch (e: any) {
    return bad(e?.message ?? 'create-intent failed', 500)
  }
}