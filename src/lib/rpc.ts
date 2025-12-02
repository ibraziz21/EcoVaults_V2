// src/lib/rpc.ts
import { ethers } from 'ethers'

/**
 * Put these in .env.local (Alchemy, Infura, or public):
 *  OPTI_RPC=https://opt-mainnet.g.alchemy.com/v2/xxx
 *  BASE_RPC=https://base-mainnet.g.alchemy.com/v2/yyy
 */
const OPTI_RPC = process.env.NEXT_PUBLIC_OPTI_RPC ??
  'https://mainnet.optimism.io'

const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ??
  'https://developer-access-mainnet.base.org'

export const providerOptimism = new ethers.providers.JsonRpcProvider(OPTI_RPC)
export const providerBase     = new ethers.providers.JsonRpcProvider(BASE_RPC)
