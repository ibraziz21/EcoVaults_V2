// import { erc20Abi } from 'viem'
// import { publicOptimism, publicBase } from './clients'
// import { AAVE_POOL, TokenAddresses } from './constants'
// import aavePoolAbi from '@/lib/abi/aavePool.json'

// type Evm = 'optimism' | 'base'

// const clientFor = (c: Evm) => (c === 'optimism' ? publicOptimism : publicBase)

// /**
//  * Returns the aToken address for a given underlying on Aave v3.
//  * If the market doesn’t exist, returns 0x0.
//  */
// export async function getATokenAddress(
//   chain: Evm,
//   underlying: `0x${string}`,
// ): Promise<`0x${string}`> {
//   const pool = AAVE_POOL[chain]
//   // Aave v3 IPool.getReserveData(asset) returns struct with aTokenAddress
//   const rd = await clientFor(chain).readContract({
//     address: pool,
//     abi: aavePoolAbi,
//     functionName: 'getReserveData',
//     args: [underlying],
//   }) as {
//     // viem will coerce named outputs if your ABI includes them; fallback to index if not
//     aTokenAddress: `0x${string}`
//   } | any

//   const addr: `0x${string}` =
//     (rd?.aTokenAddress as `0x${string}`) ?? (rd?.[7] as `0x${string}`) ?? '0x0000000000000000000000000000000000000000'
//   return addr
// }

// /**
//  * Reads user’s aToken balance for (chain, token).
//  * Amount is in the underlying’s decimals (USDC/USDT = 6).
//  */
// export async function getAaveATokenBalance(
//   chain: Evm,
//   token: 'USDC' | 'USDT',
//   user: `0x${string}`,
// ): Promise<bigint> {
//   const underlying = (TokenAddresses as any)[token][chain] as `0x${string}`

//   const aToken = await getATokenAddress(chain, underlying)
//   if (aToken === '0x0000000000000000000000000000000000000000') return BigInt(0) // market not listed

//   const bal = await clientFor(chain).readContract({
//     address: aToken,
//     abi: erc20Abi,
//     functionName: 'balanceOf',
//     args: [user],
//   }) as bigint

//   return bal // 6 decimals for USDC/USDT aTokens
// }
