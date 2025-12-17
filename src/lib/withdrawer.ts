// src/lib/withdrawer.ts
import type { WalletClient, Chain } from 'viem'
import { encodeAbiParameters, keccak256, stringToBytes } from 'viem'
import aggregatorRouterAbi from './abi/AggregatorRouter.json'
import { ROUTERS } from './constants'
import { ensureAllowanceForRouterOnLisk } from './depositor'
import { publicLisk } from './clients'

type TokenLisk = 'USDCe' | 'USDT0'

/**
 * Hard-coded Lisk chain for viem call overrides.
 * Replace the chainId if your deployment uses a different Lisk chain id.
 */
const LISK_CHAIN_ID = 1135

const LISK_CHAIN: Chain = {
  id: LISK_CHAIN_ID,
  name: 'Lisk',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.api.lisk.com'] },
    public: { http: ['https://rpc.api.lisk.com'] },
  },
} as const

function keyForMorphoLisk(token: TokenLisk): `0x${string}` {
  // keccak256("morpho-blue:lisk:USDCe" | "morpho-blue:lisk:USDT0")
  const label = `morpho-blue:lisk:${token}`
  return keccak256(stringToBytes(label)) as `0x${string}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Withdraw from Morpho on Lisk via Router:
 * - Approves SHARES (vault token) to Router if needed
 * - Calls router.withdraw(key, shareToken, shares, to, abi.encode(underlying))
 */
export async function withdrawMorphoOnLisk(opts: {
  token: TokenLisk
  shares: bigint
  shareToken: `0x${string}` // vault (ERC-4626) address — this is the "asset" for router.withdraw()
  underlying: `0x${string}` // Lisk underlying token to receive
  to: `0x${string}`
  wallet: WalletClient
}) {
  const { token, shares, shareToken, underlying, to, wallet } = opts

  const owner = wallet.account?.address as `0x${string}` | undefined
  if (!owner) throw new Error('Wallet not connected')

  const router = ROUTERS.lisk as `0x${string}`
  if (!router) throw new Error('Router missing for lisk')

  // 1) Approve SHARES (vault token) -> Router
  await ensureAllowanceForRouterOnLisk(shareToken, router, shares, wallet)

  // 2) Encode data = abi.encode(address underlying)
  const data = encodeAbiParameters([{ type: 'address' }], [underlying])

  // 3) Call router.withdraw
  const key = keyForMorphoLisk(token)

  const { request } = await publicLisk.simulateContract({
    address: router,
    abi: aggregatorRouterAbi,
    functionName: 'withdraw',
    args: [key, shareToken, shares, to, data],
    account: owner,
    chain: LISK_CHAIN, // ✅ hard-coded chain object
  })

  // ✅ force the write on Lisk even if the wallet client is multi-chain
  const txHash = await wallet.writeContract({
    ...request,
    chain: LISK_CHAIN, // ✅ hard-coded chain object
  })

  const receipt = await publicLisk.waitForTransactionReceipt({ hash: txHash })

  // Optional: wait a couple blocks for indexers / UI to catch up
  const minedAt = BigInt(receipt.blockNumber ?? 0)
  const target = minedAt + 2n
  while ((await publicLisk.getBlockNumber()) < target) {
    await sleep(1200)
  }

  return { tx: txHash }
}