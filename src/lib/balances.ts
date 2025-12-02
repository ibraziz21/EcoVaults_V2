import { publicOptimism, publicBase } from './clients'
import { Abi } from 'viem'
import { erc20Abi } from 'viem' // ['function balanceOf(address) view returns (uint256)']

export async function getBalance(
  token: `0x${string}`,
  user: `0x${string}`,
  chain: 'optimism' | 'base',
) {
  const client = chain === 'optimism' ? publicOptimism : publicBase
  const bal = await client.readContract({
    address: token,
    abi: erc20Abi as Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint

  return bal
}

export async function getDualBalances(
  tokenAddr: { optimism: `0x${string}`; base: `0x${string}` },
  user: `0x${string}`,
) {
  const [opBal, baBal] = await Promise.all([
    getBalance(tokenAddr.optimism, user, 'optimism'),
    getBalance(tokenAddr.base, user, 'base'),
  ])
  return { opBal, baBal }
}
