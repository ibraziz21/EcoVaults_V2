// src/lib/depositIntent.ts
import type { Address, Hex } from 'viem'


// We’re not verifying on-chain, but the domain still binds signatures.
export const INTENT_DOMAIN = {
  name: 'SuperYLDR-Intent',
  version: '1',             // binds to Lisk flow
  verifyingContract: '0x0000000000000000000000000000000000000000', // sentinel
} as const

export const INTENT_TYPES = {
  DepositIntent: [
    { name: 'user',      type: 'address' },
    { name: 'key',       type: 'bytes32' },
    { name: 'asset',     type: 'address' },   // USDT0 (Lisk)
    { name: 'amount',    type: 'uint256' },   // optional; we rely on minAmount
    { name: 'minAmount', type: 'uint256' },
    { name: 'deadline',  type: 'uint256' },
    { name: 'nonce',     type: 'uint256' },
    { name: 'refId',     type: 'bytes32' },
    { name: 'dstChainId',     type: 'uint256' }
  ],
} as const

export type DepositIntent = {
  user: Address
  key: Hex
  asset: Address
  amount: bigint
  minAmount: bigint
  deadline: bigint
  nonce: bigint
  refId: Hex
  dstChainId: bigint
}
