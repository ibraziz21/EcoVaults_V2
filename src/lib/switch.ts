// src/lib/wallet/switchStrict.ts
import type { WalletClient } from 'viem'
import { CHAINS } from '@/lib/wallet' // your chain defs

// Strict in the sense of "always try to end up on target",
// but no aggressive polling / timeouts.
export async function switchOrAddChainStrict(
  walletClient: WalletClient,
  target = CHAINS.lisk
) {
  const hex = `0x${target.id.toString(16)}`

  // 1) Fast path – already on target chain
  try {
    const currentHex = await walletClient.request({ method: 'eth_chainId' })
    if (currentHex?.toLowerCase() === hex.toLowerCase()) {
      return
    }
  } catch {
    // ignore, we'll just try to switch/add
  }

  // 2) Try simple switch first
  try {
    await walletClient.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hex }],
    })
  } catch (e: any) {
    // 4902 = chain not added
    if (e?.code === 4902 || /unknown chain/i.test(e?.message ?? '')) {
      // 3) Add chain, then switch
      await walletClient.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: hex,
            chainName: target.name,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: target.rpcUrls.default.http,
            blockExplorerUrls: target.blockExplorers
              ? [target.blockExplorers.default.url]
              : [],
          },
        ],
      })

      await walletClient.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      })
    } else {
      // real error (user rejected, etc.)
      throw e
    }
  }

  // 4) Tiny settle delay so wallets/wagmi can update internally
  await new Promise((r) => setTimeout(r, 400))
}
