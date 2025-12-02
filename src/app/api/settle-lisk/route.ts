// src/app/api/relayer/settle-lisk/route.ts
// Next.js (App Router) server route • Node runtime (needs private key)
// POST body: { intent, signature }
// - intent fields are strings (addresses hex, uints as decimal strings, bytes32 hex)
// - signature is 0x... string

import 'server-only'
export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { createWalletClient, http, Hex, Address, zeroAddress, parseAbi, createPublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { lisk } from 'viem/chains'

const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as Hex 
const LISK_RPC_URL        = process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com' // set your RPC
const EXECUTOR_ADDRESS    = '0x8F60907f41593d4B41f5e0cEa48415cd61854a79' as Address

const EXECUTOR_ABI = parseAbi([
  'function settleAndDeposit((address user,bytes32 key,address asset,uint256 amount,uint256 minAmount,uint256 deadline,uint256 nonce,bytes32 refId) intent, bytes userSig) external',
  'function adapterAllowed(bytes32) view returns (bool)',
  'function assetAllowed(address) view returns (bool)',
])

type IntentBody = {
  user: Address
  key: Hex
  asset: Address
  amount: string
  minAmount: string
  deadline: string
  nonce: string
  refId: Hex
}

type PostBody = {
  intent: IntentBody
  signature: Hex
}

function bad(msg: string, code = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: code })
}

export async function POST(req: Request) {
  try {
    if (!RELAYER_PRIVATE_KEY) return bad('Server not configured: RELAYER_PRIVATE_KEY missing', 500)

    const body = (await req.json()) as PostBody
    if (!body?.intent || !body?.signature) return bad('Missing intent or signature')

    const intent = body.intent
    const signature = body.signature

    // Basic sanity
    if (!intent.user || !intent.key || !intent.asset) return bad('Malformed intent')

    // Build clients
    const account = privateKeyToAccount(RELAYER_PRIVATE_KEY)
    const transport = http(LISK_RPC_URL)
    const wallet = createWalletClient({ account, chain: lisk, transport })
    const pub    = createPublicClient({ chain: lisk, transport })

    // Optional: fast preflight allowlist checks to give nicer errors
    const [adapterOk, assetOk] = await Promise.all([
      pub.readContract({ address: EXECUTOR_ADDRESS, abi: EXECUTOR_ABI, functionName: 'adapterAllowed', args: [intent.key] }),
      pub.readContract({ address: EXECUTOR_ADDRESS, abi: EXECUTOR_ABI, functionName: 'assetAllowed',   args: [intent.asset] }),
    ])
    if (!adapterOk) return bad('Adapter key not allowed on executor', 400)
    if (!assetOk)   return bad('Asset not allowed on executor', 400)

    // Submit tx
    const hash = await wallet.writeContract({
      address: EXECUTOR_ADDRESS, 
      abi: EXECUTOR_ABI,
      functionName: 'settleAndDeposit',
      args: [
        {
          user: intent.user,
          key: intent.key,
          asset: intent.asset,
          amount: BigInt(intent.amount),
          minAmount: BigInt(intent.minAmount),
          deadline: BigInt(intent.deadline),
          nonce: BigInt(intent.nonce),
          refId: intent.refId,
        },
        signature,
      ],
    })

    const receipt = await pub.waitForTransactionReceipt({ hash })
    return NextResponse.json({ ok: true, txHash: hash, blockNumber: receipt.blockNumber })
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || String(e)
    return bad(msg, 500)
  }
}
