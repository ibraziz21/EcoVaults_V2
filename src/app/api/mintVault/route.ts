// app/api/mintVault/route.ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { optimism } from 'viem/chains'
import rewardsAbi from '@/lib/abi/rewardsAbi.json'
import { REWARDS_VAULT } from '@/lib/constants'
import * as dotenv from 'dotenv'
dotenv.config()

const PRIVATE_KEY_RAW = (process.env.RELAYER_PRIVATE_KEY || '').trim().replace(/^['"]|['"]$/g, '')
if (!PRIVATE_KEY_RAW) {
  console.warn('[mintVault] RELAYER_PRIVATE_KEY is empty or missing')
}
const PRIVATE_KEY = (`0x${PRIVATE_KEY_RAW.replace(/^0x/i, '')}`) as `0x${string}`

const account = privateKeyToAccount(PRIVATE_KEY)
const chain = optimism

const publicClient = createPublicClient({ chain, transport: http() })
const client = createWalletClient({ account, chain, transport: http() })

type TokenKind = 'USDC' | 'USDT'

export async function POST(req: Request) {
  const { userAddress, tokenAmt, tokenKind } = (await req.json()) as {
    userAddress: `0x${string}`
    tokenAmt: string       // bigint-as-decimal string (6d)
    tokenKind?: TokenKind  // decides which rewards vault to mint in
  }

  // default to USDC if not provided
  const kind: TokenKind = tokenKind === 'USDT' ? 'USDT' : 'USDC'
  const rewardsVault =
    kind === 'USDT'
      ? (REWARDS_VAULT.optimismUSDT as `0x${string}`)
      : (REWARDS_VAULT.optimismUSDC as `0x${string}`)

  console.log('[mintVault] inputs', { userAddress, tokenAmt, tokenKind, chosen: kind, rewardsVault })

  try {
    const { request } = await publicClient.simulateContract({
      address: rewardsVault,
      abi: rewardsAbi,
      functionName: 'recordDeposit',
      args: [userAddress, BigInt(tokenAmt)],
      account,
    })
    const txHash = await client.writeContract(request)
    await publicClient.waitForTransactionReceipt({ hash: txHash })

    return Response.json({ success: true, txHash, kind })
  } catch (err: any) {
    console.error('[mintVault] failed', { kind, err: err?.message || err })
    return Response.json({ success: false, message: 'Error minting receipt token' }, { status: 500 })
  }
}
