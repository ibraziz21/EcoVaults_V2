// src/lib/intentRegistry.ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { optimism } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const INTENT_REGISTRY = process.env.INTENT_REGISTRY as `0x${string}`

export const intentRegistryAbi = [
  {
    type: 'function',
    name: 'createIntent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'user', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'fromChainId', type: 'uint256' },
      { name: 'toChainId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setStatus',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'markBridged',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'bridgedAmount', type: 'uint256' },
      { name: 'toTxHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'markDeposited',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'depositTxHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'markMinted',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'mintTxHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'markFailed',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'refId', type: 'bytes32' },
      { name: 'reason', type: 'string' },
    ],
    outputs: [],
  },
] as const

function getOpClients() {
  const RAW = (process.env.RELAYER_PRIVATE_KEY || '').trim().replace(/^['"]|['"]$/g, '')
  const priv = (`0x${RAW.replace(/^0x/i, '')}`) as `0x${string}`
  const account = privateKeyToAccount(priv)

  const transport = http(process.env.OP_RPC_URL)
  const pub = createPublicClient({ chain: optimism, transport })
  const wlt = createWalletClient({ account, chain: optimism, transport })

  return { pub, wlt, account }
}

export async function registryCreateIntent(params: {
  refId: `0x${string}`
  user: `0x${string}`
  asset: `0x${string}`
  amount: bigint
  fromChainId: number
  toChainId: number
}) {
  if (!INTENT_REGISTRY) return
  const { pub, wlt, account } = getOpClients()

  const { request } = await pub.simulateContract({
    address: INTENT_REGISTRY,
    abi: intentRegistryAbi,
    functionName: 'createIntent',
    args: [
      params.refId,
      params.user,
      params.asset,
      params.amount,
      BigInt(params.fromChainId),
      BigInt(params.toChainId),
    ],
    account,
  })

  await wlt.writeContract(request)
}

export async function registryMarkBridged(params: {
  refId: `0x${string}`
  bridgedAmount: bigint
  toTxHash?: `0x${string}` | null
}) {
  if (!INTENT_REGISTRY) return
  const { pub, wlt, account } = getOpClients()

  const { request } = await pub.simulateContract({
    address: INTENT_REGISTRY,
    abi: intentRegistryAbi,
    functionName: 'markBridged',
    args: [
      params.refId,
      params.bridgedAmount,
      (params.toTxHash ?? '0x') as `0x${string}`,
    ],
    account,
  })

  await wlt.writeContract(request)
}

export async function registryMarkDeposited(params: {
  refId: `0x${string}`
  depositTxHash: `0x${string}`
}) {
  if (!INTENT_REGISTRY) return
  const { pub, wlt, account } = getOpClients()

  const { request } = await pub.simulateContract({
    address: INTENT_REGISTRY,
    abi: intentRegistryAbi,
    functionName: 'markDeposited',
    args: [params.refId, params.depositTxHash],
    account,
  })

  await wlt.writeContract(request)
}

export async function registryMarkMinted(params: {
  refId: `0x${string}`
  mintTxHash: `0x${string}`
}) {
  if (!INTENT_REGISTRY) return
  const { pub, wlt, account } = getOpClients()

  const { request } = await pub.simulateContract({
    address: INTENT_REGISTRY,
    abi: intentRegistryAbi,
    functionName: 'markMinted',
    args: [params.refId, params.mintTxHash],
    account,
  })

  await wlt.writeContract(request)
}

export async function registryMarkFailed(params: {
  refId: `0x${string}`
  reason: string
}) {
  if (!INTENT_REGISTRY) return
  const { pub, wlt, account } = getOpClients()

  const { request } = await pub.simulateContract({
    address: INTENT_REGISTRY,
    abi: intentRegistryAbi,
    functionName: 'markFailed',
    args: [params.refId, params.reason],
    account,
  })

  await wlt.writeContract(request)
}
