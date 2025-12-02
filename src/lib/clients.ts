// lib/clients.ts
import { http, createPublicClient } from 'viem'
import { optimism, base, lisk } from 'viem/chains'

export const publicOptimism = createPublicClient({
  chain: optimism,
  transport: http(),          // or Alchemy / Infura URL
})

export const publicBase = createPublicClient({
  chain: base,
  transport: http(),
})

export const publicLisk = createPublicClient({
  chain: lisk,
  transport: http(),
})

/* the signer (wallet client) comes from wagmi’s useWalletClient() */
