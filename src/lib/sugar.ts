import type { Address, WalletClient } from 'viem'
import { erc20Abi } from 'viem'
import { lisk as liskChain } from 'viem/chains'
import { publicLisk } from '@/lib/clients'

export type SugarPlan = {
  to: Address
  commands: `0x${string}`
  inputs: `0x${string}`[]
  value: string
}

export async function getSugarPlanUsdtToUsdt0(amountInWei: bigint, account: Address, opts?: { slippage?: number }) {
  const res = await fetch('/api/sugar-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amountInWei: amountInWei.toString(), account, slippage: opts?.slippage }),
  })
  const j = await res.json()
  if (!j?.ok) throw new Error(j?.error || 'plan_failed')
  return { amountOut: BigInt(j.amountOut), plan: j.plan as SugarPlan }
}

const SWAPPER_ABI = [
  { type: 'function', name: 'execute', stateMutability: 'payable',
    inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }],
    outputs: [] },
] as const

export async function ensureAllowanceTo(wallet: WalletClient, token: Address, owner: Address, spender: Address, amount: bigint) {
  const allowance = (await publicLisk.readContract({
    address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender],
  })) as bigint
  if (allowance >= amount) return
  await wallet.writeContract({
    account: owner, chain: liskChain, address: token, abi: erc20Abi,
    functionName: 'approve', args: [spender, amount],
  })
}

export async function executeSugarPlan(wallet: WalletClient, plan: SugarPlan) {
  const value = BigInt(plan.value || '0')
  return await wallet.writeContract({
    account: wallet.account!, chain: liskChain,
    address: plan.to, abi: SWAPPER_ABI, functionName: 'execute',
    args: [plan.commands, plan.inputs],
    value,
  })
}
