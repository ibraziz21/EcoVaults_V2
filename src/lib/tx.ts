// src/lib/tx.ts
import type { PublicClient, Chain, Hex, Address } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'

export async function sendSimulated(
  pub: PublicClient,
  account: PrivateKeyAccount,
  chain: Chain,
  req: {
    to?: Address
    data?: Hex
    value?: bigint
    gas?: bigint
    nonce?: number
  }
): Promise<Hex> {
  const to    = (req.to ?? null) as Address | null
  const data  = req.data
  const value = req.value ?? 0n
  const gas   = req.gas ?? await pub.estimateGas({ to: to ?? undefined, data, value, account: account.address })
  const nonce = req.nonce ?? await pub.getTransactionCount({ address: account.address })

  // Try EIP-1559, fallback to legacy gasPrice.
  let hash: Hex | undefined

  // 1) attempt EIP-1559
  try {
    const fees = await pub.estimateFeesPerGas()
    if (fees?.maxFeePerGas != null && fees?.maxPriorityFeePerGas != null) {
      const signed = await account.signTransaction({
        chainId: chain.id,
        to,
        data,
        value,
        gas,
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      })
      hash = await pub.sendRawTransaction({ serializedTransaction: signed })
    }
  } catch {
    // ignore, we'll try legacy next
  }

  // 2) legacy fallback if 1559 path didn’t run
  if (!hash) {
    const gasPrice = await pub.getGasPrice()
    const signed = await account.signTransaction({
      chainId: chain.id,
      to,
      data,
      value,
      gas,
      nonce,
      gasPrice,           // legacy
      type: 'legacy',     // be explicit
    })
    hash = await pub.sendRawTransaction({ serializedTransaction: signed })
  }

  await pub.waitForTransactionReceipt({ hash })
  return hash
}