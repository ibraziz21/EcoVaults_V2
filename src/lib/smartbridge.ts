// src/lib/smartbridge.ts
import { publicOptimism, publicBase, publicLisk } from './clients'
import { erc20Abi } from 'viem'
import { TokenAddresses, type ChainId, type TokenSymbol, LISK_EXECUTOR_ADDRESS } from './constants'
import { bridgeTokens } from './bridge'
import type { WalletClient } from 'viem'

function clientFor(chain: ChainId) {
  return chain === 'optimism'
    ? publicOptimism
    : chain === 'base'
    ? publicBase
    : publicLisk
}

/** Map a requested symbol to what exists on a chain for **balance reads**. */
function symbolOnChainForRead(symbol: TokenSymbol, chain: ChainId): TokenSymbol {
  if (chain === 'lisk') {
    // Map canonical → Lisk’s representations for balance reads
    if (symbol === 'USDC') return 'USDCe'
    // Lisk has both USDT and USDT0; keep whichever the caller provided
    return symbol
  }
  // OP/Base cannot read USDCe/USDT0; map to canonical
  if (symbol === 'USDCe') return 'USDC'
  if (symbol === 'USDT0') return 'USDT'
  return symbol
}

function addressOnChain(symbol: TokenSymbol, chain: ChainId): `0x${string}` {
  const sym = symbolOnChainForRead(symbol, chain)
  const addr = (TokenAddresses[sym] as any)?.[chain]
  if (!addr) throw new Error(`Token ${sym} not supported on ${chain}`)
  return addr as `0x${string}`
}

async function getBalanceOnChain(
  chain: ChainId,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as Promise<bigint>
}

/**
 * Ensure recipient has `amount` of the **destination token form** on `target`
 * and wait until funds actually arrive (single call).
 *
 * - If target=Lisk + USDT0/USDCe → we bridge to the **Executor** on Lisk (not the user).
 * - Otherwise (OP/Base or same-chain) we bridge to the user.
 *
 * `onStatus`: 'bridging' | 'waiting' | 'done'
 */
export async function ensureLiquidity(
  symbol: TokenSymbol,   // desired token on the target chain (e.g., 'USDT0' on Lisk)
  amount: bigint,
  target: ChainId,
  wallet: WalletClient,
  opts?: {
    timeoutMs?: number
    pollMs?: number
    onStatus?: (s: 'bridging' | 'waiting' | 'done') => void
    /** Optional hint from UI; we'll prefer it but fall back automatically */
    preferredSourceToken?: Extract<TokenSymbol, 'USDC' | 'USDT'>
  }
) {
  const user = wallet.account?.address as `0x${string}`
  if (!user) throw new Error('Wallet not connected')

  const timeoutMs = opts?.timeoutMs ?? 15 * 60 * 1000
  const pollMs    = opts?.pollMs    ?? 10_000

  // Destination token & starting balance snapshot — note recipient:
  const destTokenAddr = addressOnChain(symbol, target)
  const recipient: `0x${string}` =
    target === 'lisk' ? (LISK_EXECUTOR_ADDRESS as `0x${string}`) : user

  const startBal = await getBalanceOnChain(target, destTokenAddr, recipient)

  // Already enough? Done.
  if (startBal >= amount) {
    opts?.onStatus?.('done')
    return { finalBalance: startBal, delta: 0n }
  }

  // Compute how much we're short on the destination chain
  const missing = amount - startBal

  // ───────────────────────────────────────────────────────────────
  // PICK SOURCE CHAIN + TOKEN (now robust with fallback)
  // ───────────────────────────────────────────────────────────────

  const isLisk = target === 'lisk'
  const wantsUsdt0 = isLisk && symbol === 'USDT0'
  const wantsUsdce = isLisk && symbol === 'USDCe'

  const candidateSourceTokens: Extract<TokenSymbol, 'USDC' | 'USDT'>[] =
    wantsUsdt0 || wantsUsdce
      ? (opts?.preferredSourceToken
          ? [opts.preferredSourceToken, (opts.preferredSourceToken === 'USDC' ? 'USDT' : 'USDC')]
          : ['USDC', 'USDT']) // try both if no preference
      : [symbol as Extract<TokenSymbol, 'USDC' | 'USDT'>] // non-Lisk or other assets

  // Source chains we can bridge from
  const sources: ChainId[] = isLisk ? ['optimism', 'base'] : ['optimism', 'base', 'lisk']

  // Helper to find a source (chain, token) that has at least `need`
  const findSourceWith = async (tok: Extract<TokenSymbol, 'USDC' | 'USDT'>, need: bigint) => {
    const balances: Record<ChainId, bigint> = { optimism: 0n, base: 0n, lisk: 0n }
    await Promise.all(sources.map(async (c) => {
      try {
        const addr = addressOnChain(tok, c)
        balances[c] = await getBalanceOnChain(c, addr, user)
      } catch {
        balances[c] = 0n
      }
    }))
    // prefer chain with highest balance that covers `need`
    const ordered = sources.sort((a, b) => Number(balances[b] - balances[a]))
    const from = ordered.find((c) => balances[c] >= need)
    return { from, balances }
  }

  // Try candidates in order; pick the first that can fully satisfy the missing amount on a single source chain
  let picked: { from?: ChainId, token?: Extract<TokenSymbol, 'USDC' | 'USDT'> } = {}
  for (const t of candidateSourceTokens) {
    const { from } = await findSourceWith(t, missing)
    if (from) { picked = { from, token: t }; break }
  }

  if (!picked.from) {
    // As a last resort, allow partial bridging from the best (largest) candidate if any balance exists.
    const totals: Array<{token: 'USDC' | 'USDT', chain: ChainId, bal: bigint}> = []
    for (const t of candidateSourceTokens) {
      const balances: Record<ChainId, bigint> = { optimism: 0n, base: 0n, lisk: 0n }
      await Promise.all(sources.map(async (c) => {
        try { balances[c] = await getBalanceOnChain(c, addressOnChain(t, c), user) } catch { balances[c] = 0n }
      }))
      const bestChain = sources.sort((a,b) => Number(balances[b] - balances[a]))[0]
      totals.push({ token: t, chain: bestChain, bal: balances[bestChain] })
    }
    totals.sort((a, b) => Number(b.bal - a.bal))
    const best = totals[0]
    if (!best || best.bal === 0n) {
      throw new Error(`Insufficient liquidity: need ${missing} ${symbol} on ${target}`)
    }
    picked = { from: best.chain, token: best.token }
  }

  // Which token should we receive on the target chain?
  const tokenToReceiveOnDest: TokenSymbol =
    wantsUsdt0 ? 'USDT0'
    : wantsUsdce ? 'USDCe'
    : symbol

  // ───────────────────────────────────────────────────────────────
  // BRIDGE
  // ───────────────────────────────────────────────────────────────
  opts?.onStatus?.('bridging')
  await bridgeTokens(
    tokenToReceiveOnDest, // receive on Lisk as USDT0/USDCe
    missing,              // only bridge what's missing
    picked.from!,         // chosen source chain
    target,
    wallet,
    {
      sourceToken: picked.token,                       // picked source token
    }
  )

  // ───────────────────────────────────────────────────────────────
  // WAIT FOR FUNDS (in recipient = user or executor)
  // ───────────────────────────────────────────────────────────────
  opts?.onStatus?.('waiting')
  const started = Date.now()
  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timeout waiting for bridged funds')
    }
    const bal = await getBalanceOnChain(target, destTokenAddr, recipient)
    if (bal > startBal) {
      opts?.onStatus?.('done')
      return { finalBalance: bal, delta: bal - startBal }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
}
