// src/lib/lifi.ts
'use client'
import { createConfig, EVM } from '@lifi/sdk'
import type { WalletClient } from 'viem'
import 'dotenv/config'


const API = process.env.LIFI_API as string
let configured = false

export function configureLifiWith(walletClient: WalletClient) {
  if (configured) return
  const hex = (id: number) => `0x${id.toString(16)}`
  createConfig({
    integrator: 'superYLDR',
    apiKey: API,
    providers: [
      EVM({
        getWalletClient: async () => walletClient,
        switchChain: async (chainId) => {
          await walletClient.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: hex(chainId) }],
          })
          return walletClient
        },
      }),
    ],
  })
  configured = true
}
