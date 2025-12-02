// src/lib/wallet.ts
import type { WalletClient } from 'viem'
import { optimism, base, lisk as liskChain } from 'viem/chains'

const toHex = (n: number) => `0x${n.toString(16)}`

export async function switchOrAddChain(wallet: WalletClient, chain: typeof optimism | typeof base | typeof liskChain) {
  const id = chain.id
  try {
    // fast path: just switch
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(id) }],
    })
  } catch (err: any) {
    // if chain is missing in wallet, add it then switch
    await wallet.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: toHex(id),
        chainName: chain.name,
        nativeCurrency: {
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
          decimals: chain.nativeCurrency.decimals,
        },
        rpcUrls: chain.rpcUrls.default?.http?.length
          ? chain.rpcUrls.default.http
          : chain.rpcUrls.default.http,
        blockExplorerUrls: chain.blockExplorers?.default
          ? [chain.blockExplorers.default.url]
          : [],
      }],
    })
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: toHex(id) }],
    })
  }
}

// convenience
export const CHAINS = { optimism, base, lisk: liskChain }
