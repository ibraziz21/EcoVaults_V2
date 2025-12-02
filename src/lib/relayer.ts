// src/lib/relayer.ts
import { createWalletClient, http } from 'viem'
import { optimism, lisk } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

export function createRelayerBundle() {
  const pk = process.env.RELAYER_PK as `0x${string}`
  if (!pk) throw new Error('RELAYER_PK missing')

  const account = privateKeyToAccount(pk)

  const opRpc   = process.env.OP_RPC   || "https://opt-mainnet.g.alchemy.com/v2/DveHxSKr36JndCFNqcd61YrVMev0BTpU"
  const liskRpc = process.env.LISK_RPC || 'https://rpc.api.lisk.com'

  const optimismClient = createWalletClient({ account, chain: optimism, transport: http(opRpc) })
  const liskClient     = createWalletClient({ account, chain: lisk,     transport: http(liskRpc) })

  return {
    optimism: optimismClient,
    lisk: liskClient,
    clientFor: (chainId: number) => {
      if (chainId === optimism.id) return optimismClient
      if (chainId === lisk.id)     return liskClient
      throw new Error(`Unsupported chainId ${chainId}`)
    },
  }
}
