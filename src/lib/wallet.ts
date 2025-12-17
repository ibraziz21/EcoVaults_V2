// src/lib/wallet.ts
import type { WalletClient } from 'viem'
import { optimism } from 'viem/chains'

const toHex = (n: number) => `0x${n.toString(16)}`

export async function switchToOptimism(wallet: WalletClient) {
  await wallet.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: toHex(optimism.id) }],
  })
}

export const CHAINS = { optimism }