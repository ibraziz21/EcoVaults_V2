// src/components/DepositModal.tsx
'use client'

/**
 * Morpho-only Deposit Modal (Lisk)
 * - Removes all Aave/Compound logic
 * - Bridges + deposits to Morpho Blue vaults on Lisk
 * - Shows simple route/fee info for USDCe via quoteUsdceOnLisk()
 */

import { FC, useEffect, useMemo, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

import type { YieldSnapshot } from '@/hooks/useYields'
import { quoteUsdceOnLisk } from '@/lib/quotes'
import { ensureLiquidity } from '@/lib/smartbridge'
import { bridgeAndDepositViaRouterPush } from '@/lib/bridge'
import { adapterKeyForSnapshot } from '@/lib/adapters'
import { TokenAddresses } from '@/lib/constants'
import { publicOptimism, publicBase, publicLisk } from '@/lib/clients'

import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { erc20Abi } from 'viem'
import {
  CheckCircle2,
  Loader2,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Network,
} from 'lucide-react'

/* =============================================================================
   Types / Helpers
   ============================================================================= */

type EvmChain = 'optimism' | 'base' | 'lisk'

function clientFor(chain: EvmChain) {
  if (chain === 'optimism') return publicOptimism
  if (chain === 'base') return publicBase
  return publicLisk
}

/** Lisk mapping for bridge preview / resolution */
function mapCrossTokenForDest(
  symbol: YieldSnapshot['token'],
  dest: EvmChain,
): YieldSnapshot['token'] {
  if (dest !== 'lisk') return symbol
  if (symbol === 'USDC') return 'USDCe'
  if (symbol === 'USDT') return 'USDT0'
  return symbol // already USDCe/USDT0/WETH
}

/** Resolve token address for a chain */
function tokenAddrFor(
  symbol: YieldSnapshot['token'],
  chain: EvmChain,
): `0x${string}` {
  const m = TokenAddresses[symbol] as Partial<Record<EvmChain, `0x${string}`>>
  const addr = m?.[chain]
  if (!addr) throw new Error(`Token ${symbol} not supported on ${chain}`)
  return addr
}

/** Read wallet balance for a token on a chain */
async function readWalletBalance(
  chain: EvmChain,
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
  return await clientFor(chain).readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [user],
  }) as bigint
}

/** For display: map chosen token to per-chain wallet token symbol. */
function symbolForWalletDisplay(
  symbol: YieldSnapshot['token'],
  chain: EvmChain,
): YieldSnapshot['token'] {
  if (chain === 'lisk') {
    if (symbol === 'USDC') return 'USDCe'
    if (symbol === 'USDT') return 'USDT0'
    return symbol // already USDCe/USDT0/WETH
  } else {
    if (symbol === 'USDCe') return 'USDC'
    if (symbol === 'USDT0') return 'USDT'
    return symbol
  }
}

/* =============================================================================
   UI Subcomponents (pills/cards)
   ============================================================================= */

const ChainPill: FC<{ label: string; active?: boolean; subtle?: boolean }> = ({ label, active, subtle }) => (
  <span
    className={[
      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
      active ? 'bg-teal-600 text-white' : subtle ? 'bg-gray-100 text-gray-600' : 'bg-gray-200 text-gray-700',
    ].join(' ')}
  >
    <Network className="h-3.5 w-3.5" />
    {label}
  </span>
)

const StatRow: FC<{ label: string; value: string; emphasize?: boolean }> = ({ label, value, emphasize }) => (
  <div className="flex items-center justify-between text-sm">
    <span className="text-gray-500">{label}</span>
    <span className={emphasize ? 'font-semibold' : 'font-medium'}>{value}</span>
  </div>
)

/* =============================================================================
   Main Modal (Morpho-only)
   ============================================================================= */

interface DepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot
}

type FlowStep = 'idle' | 'bridging' | 'waitingFunds' | 'depositing' | 'success' | 'error'

export const DepositModal: FC<DepositModalProps> = ({ open, onClose, snap }) => {
  const { open: openConnect } = useAppKit()
  const { data: walletClient } = useWalletClient()

  const [amount, setAmount] = useState('')

  // Wallet balances
  const [opBal, setOpBal] = useState<bigint | null>(null)
  const [baBal, setBaBal] = useState<bigint | null>(null)
  const [liBal, setLiBal] = useState<bigint | null>(null)
  const [liBalUSDT, setLiBalUSDT] = useState<bigint | null>(null)
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null)

  // Routing / fees / flow
  const [route, setRoute] = useState<string | null>(null)
  const [fee, setFee] = useState<bigint>(0n)
  const [received, setReceived] = useState<bigint>(0n)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [liquidityEnsured, setLiquidityEnsured] = useState(false)

  // bridge tracking (baseline and latest dest balance)
  const destStartBal = useRef<bigint>(0n)
  const destCurrBal  = useRef<bigint>(0n)

  // Reset when inputs change
  useEffect(() => {
    setLiquidityEnsured(false)
    setStep('idle')
    setError(null)
  }, [open, amount, snap.chain, snap.token, snap.protocolKey])

  const tokenDecimals = useMemo(() => (snap.token === 'WETH' ? 18 : 6), [snap.token])

  /* ---------------- Wallet balances (OP/Base/Lisk) ---------------- */
  useEffect(() => {
    if (!open || !walletClient) return
    const user = walletClient.account.address as `0x${string}`

    const opSym = symbolForWalletDisplay(snap.token, 'optimism')
    const baSym = symbolForWalletDisplay(snap.token, 'base')
    const liSym = symbolForWalletDisplay(snap.token, 'lisk')

    const addrOrNull = (sym: YieldSnapshot['token'], ch: EvmChain) => {
      try { return tokenAddrFor(sym, ch) } catch { return null }
    }

    const opAddr = addrOrNull(opSym, 'optimism')
    const baAddr = addrOrNull(baSym, 'base')
    const liAddr = addrOrNull(liSym, 'lisk')

    const reads: Promise<bigint | null>[] = [
      opAddr ? readWalletBalance('optimism', opAddr, user) : Promise.resolve(null),
      baAddr ? readWalletBalance('base',     baAddr, user) : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk',     liAddr, user) : Promise.resolve(null),
    ]

    const liskUSDTAddr  = (TokenAddresses.USDT  as any)?.lisk as `0x${string}` | undefined
    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)?.lisk as `0x${string}` | undefined
    const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'

    if (isUsdtFamily) {
      reads.push(liskUSDTAddr  ? readWalletBalance('lisk', liskUSDTAddr,  user) : Promise.resolve(null))
      reads.push(liskUSDT0Addr ? readWalletBalance('lisk', liskUSDT0Addr, user) : Promise.resolve(null))
    } else {
      reads.push(Promise.resolve(null), Promise.resolve(null))
    }

    Promise.allSettled(reads).then((vals) => {
      const [op, ba, li, liU, liU0] = vals.map((r) => (r.status === 'fulfilled' ? (r as any).value as bigint | null : null))
      setOpBal(op ?? null)
      setBaBal(ba ?? null)
      setLiBal(li ?? null)
      setLiBalUSDT(liU ?? null)
      setLiBalUSDT0(liU0 ?? null)
    })
  }, [open, walletClient, snap.token])

  /* ---------------- Quote (Morpho-only) ---------------- */
  useEffect(() => {
    if (!walletClient || !amount) {
      setRoute(null); setFee(0n); setReceived(0n); setQuoteError(null)
      return
    }

    const dest = snap.chain as EvmChain
    const amt  = parseUnits(amount, tokenDecimals)

    const destOutSymbol = mapCrossTokenForDest(snap.token, dest)

    // Source heuristic: pick OP/Base where you have more of the **display token**
    const src: Extract<EvmChain, 'optimism' | 'base'> =
      (opBal ?? 0n) >= amt ? 'optimism'
      : (baBal ?? 0n) >= amt ? 'base'
      : ((opBal ?? 0n) >= (baBal ?? 0n) ? 'optimism' : 'base')

    // If already on destination (rare in this UI), it's on-chain
    if (src === dest) {
      setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
      return
    }

    // USDCe on Lisk → show LI.FI / Across-style quote helper
    if (dest === 'lisk' && destOutSymbol === 'USDCe') {
      if ((liBal ?? 0n) >= amt) {
        setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
        return
      }
      quoteUsdceOnLisk({ amountIn: amt, opBal, baBal })
        .then(q => { setRoute(q.route); setFee(q.bridgeFee); setReceived(q.bridgeOutUSDCe); setQuoteError(null) })
        .catch(() => { setRoute(null); setFee(0n); setReceived(0n); setQuoteError('Could not fetch bridge quote') })
      return
    }

    // USDT0 on Lisk → bridge USDT then local swap; we skip fee calc and show on-chain
    if (dest === 'lisk' && destOutSymbol === 'USDT0') {
      setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
      return
    }

    // WETH on Lisk or anything else → treat as on-chain
    setRoute('On-chain'); setFee(0n); setReceived(amt); setQuoteError(null)
  }, [amount, walletClient, opBal, baBal, liBal, liBalUSDT, liBalUSDT0, snap.chain, snap.token, tokenDecimals])

  /* ---------------- Confirm (Morpho-only) ---------------- */
  async function handleConfirm() {
    if (!walletClient) { openConnect(); return }
    setError(null)

    try {
      if (snap.protocolKey !== 'morpho-blue' || snap.chain !== 'lisk') {
        throw new Error('This build only supports Morpho Blue deposits on Lisk.')
      }

      const inputAmt = parseUnits(amount || '0', tokenDecimals)
      const dest = 'lisk' as const
      const user = walletClient.account!.address as `0x${string}`
      const destTokenLabel = mapCrossTokenForDest(snap.token, dest) as 'USDCe'|'USDT0'|'WETH'
      const adapterKey = adapterKeyForSnapshot(snap)

      // Choose src chain by higher balance of display token
      const pickSrc = (a: bigint | null, b: bigint | null): 'optimism' | 'base' =>
        (a ?? 0n) >= (b ?? 0n) ? 'optimism' : 'base'
      const srcChain = pickSrc(opBal, baBal)

      // Map to source token symbol expected by the router
      const srcToken =
        destTokenLabel === 'USDCe' ? 'USDC' :
        destTokenLabel === 'USDT0' ? 'USDT' : 'WETH'

      // Bridge (if needed) + Deposit via router push (relayer path)
      setStep('bridging')
      await bridgeAndDepositViaRouterPush({
        user,
        destToken: destTokenLabel,
        srcChain,
        srcToken: srcToken as 'USDC' | 'USDT' | 'WETH',
        amount: inputAmt,
        adapterKey,
        walletClient,
      })

      // Success
      setStep('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  /* =============================================================================
     Derived UI values
     ============================================================================= */
  const pretty = (bn: bigint | null | undefined, dec = tokenDecimals) => bn != null ? formatUnits(bn, dec) : '…'

  const hasAmount = amount.trim().length > 0 && Number(amount) > 0
  const confirmDisabled = step !== 'idle' ? true : !hasAmount || Boolean(quoteError)

  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'

  const isLiskTarget = snap.chain === 'lisk'
  const isUsdtFamily = snap.token === 'USDT' || snap.token === 'USDT0'
  const destTokenLabel = mapCrossTokenForDest(snap.token, snap.chain as EvmChain)

  /* =============================================================================
     Render
     ============================================================================= */
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="p-0 overflow-hidden shadow-xl w-[min(100vw-1rem,44rem)] sm:max-w-2xl rounded-xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-600 to-cyan-500 px-5 py-4">
          <DialogHeader>
            <DialogTitle className="text-white text-base font-semibold sm:text-lg flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white text-xs font-bold">
                {destTokenLabel}
              </span>
              Deposit to {snap.protocol} on <span className="underline decoration-white/40 underline-offset-4">{(snap.chain as string).toUpperCase()}</span>
            </DialogTitle>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6 bg-white">
            {showForm && (
              <>
                {/* Amount Card */}
                <div className="rounded-xl border border-gray-200 bg-white">
                  <div className="p-4 sm:p-5">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">Amount</div>
                      <div className="flex items-center gap-2">
                        <ChainPill label={(snap.chain as string).toUpperCase()} subtle />
                        <span className="text-[11px] text-gray-500">Destination token: {destTokenLabel}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <Input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value.replace(',', '.'))}
                        className="h-12 text-2xl font-bold border-0 bg-gray-50 focus-visible:ring-0"
                        autoFocus
                      />
                      <span className="text-gray-600 font-semibold">{snap.token}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setAmount('')} title="Clear">Clear</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const dec = tokenDecimals
                          const amt = (() => {
                            if (isLiskTarget && isUsdtFamily) {
                              // choose larger of Lisk USDT or USDT0 for convenience
                              const a = liBalUSDT ?? 0n
                              const b = liBalUSDT0 ?? 0n
                              return formatUnits(a > b ? a : b, dec)
                            }
                            if (isLiskTarget) {
                              return formatUnits(liBal ?? 0n, dec)
                            }
                            // choose larger of OP/Base for cross-chain sourcing
                            const a = opBal ?? 0n
                            const b = baBal ?? 0n
                            return formatUnits(a > b ? a : b, dec)
                          })()
                          setAmount(amt === '0' ? '' : amt)
                        }}
                        title="Max"
                      >
                        MAX
                      </Button>
                    </div>
                  </div>

                  {/* Balance strip */}
                  <div className="border-t bg-gray-50 p-3 sm:p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {/* OP */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="OP" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'optimism')}</span>
                        </div>
                        <div className="mt-1 text-base font-semibold">{pretty(opBal)}</div>
                      </div>
                      {/* Base */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="BASE" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'base')}</span>
                        </div>
                        <div className="mt-1 text-base font-semibold">{pretty(baBal)}</div>
                      </div>
                      {/* Lisk */}
                      <div className="rounded-lg border bg-white p-3">
                        <div className="flex items-center justify-between">
                          <ChainPill label="LISK" />
                          <span className="text-[11px] text-gray-500">{symbolForWalletDisplay(snap.token, 'lisk')}</span>
                        </div>
                        {isLiskTarget && isUsdtFamily ? (
                          <div className="mt-1 space-y-1">
                            <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT</span><span className="font-medium">{pretty(liBalUSDT)}</span></div>
                            <div className="flex items-center justify-between text-sm"><span className="text-gray-500">USDT0</span><span className="font-medium">{pretty(liBalUSDT0)}</span></div>
                          </div>
                        ) : (
                          <div className="mt-1 text-base font-semibold">{pretty(liBal)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Routing via LI.FI bridge */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <ShieldCheck className="h-4 w-4" />
                      Routing via LI.FI bridge
                    </div>
                    {route && route !== 'On-chain' ? (
                      <span className="inline-flex items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-md bg-gray-100 px-2 py-1">Bridging via Li.Fi</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">On-chain</span>
                    )}
                  </div>

                  {/* Pretty route line */}
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <ChainPill label="SRC" subtle />
                    <ArrowRight className="h-4 w-4 text-gray-400" />
                    <ChainPill label={(snap.chain as string).toUpperCase()} subtle />
                    <span className="ml-auto text-xs text-gray-500">{snap.token} → {destTokenLabel}</span>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    {fee > 0n && (
                      <StatRow label="Bridge fee" value={`${formatUnits(fee, tokenDecimals)} ${snap.token}`} />
                    )}
                    <StatRow label="Will deposit" value={`${formatUnits(received, tokenDecimals)} ${snap.token}`} emphasize />
                    {quoteError && <div className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> {quoteError}</div>}
                  </div>

                  {isLiskTarget && (
                    <div className="mt-3 text-[11px] text-gray-500">
                      Funds arrive as <span className="font-medium">{destTokenLabel}</span> on Lisk.
                    </div>
                  )}
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}
              </>
            )}

            {/* Progress */}
            {showProgress && (
              <div className="space-y-3">
                <StepCard current={step} label="Bridging liquidity"   k="bridging" />
                <StepCard current={step} label="Waiting for funds"    k="waitingFunds" />
                <StepCard current={step} label="Depositing to Morpho" k="depositing" />
              </div>
            )}

            {/* Success */}
            {showSuccess && (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <div className="text-center">
                  <div className="text-lg font-semibold">Deposit successful</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Your {snap.token} was bridged to Lisk and deposited into Morpho.
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {showError && (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="text-lg font-semibold text-red-600">Transaction failed</div>
                <div className="text-sm text-muted-foreground">{error}</div>
              </div>
            )}
          </div>

          {/* Sticky action bar */}
          <div className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-6">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              {showForm && (
                <>
                  <Button
                    variant="outline"
                    onClick={onClose}
                    title="Cancel"
                    className="h-10 w-full  sm:w-auto"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={confirmDisabled}
                    title="Confirm"
                    className="h-10 w-full  sm:w-auto"
                  >
                    Confirm
                  </Button>
                </>
              )}

              {showProgress && (
                <Button
                  variant="outline"
                  onClick={onClose}
                  title="Close"
                  className="h-10 w-full  sm:w-auto"
                >
                  Close
                </Button>
              )}

              {showSuccess && (
                <Button onClick={onClose} title="Done" className="h-10 w-full  sm:w-auto">
                  Done
                </Button>
              )}

              {showError && (
                <div className="flex w-full gap-2 sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setStep('idle')}
                    title="Try Again"
                    className="h-10 w-full  sm:w-auto"
                  >
                    Try again
                  </Button>
                  <Button onClick={onClose} title="Close" className="h-10 w-full  sm:w-auto">
                    Close
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* =============================================================================
   Tiny Step Card
   ============================================================================= */

function StepCard(props: { current: FlowStep, k: Exclude<FlowStep, 'idle'|'success'|'error'>, label: string }) {
  const order: FlowStep[] = ['bridging', 'waitingFunds', 'depositing']
  const idx = order.indexOf(props.current)
  const my  = order.indexOf(props.k)
  const done = idx > my
  const active = idx === my
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : active ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <span className="h-4 w-4 rounded-full border" />)
      }
      <span className={`text-sm ${done ? 'text-green-700' : active ? 'text-primary' : 'text-muted-foreground'}`}>
        {props.label}
      </span>
    </div>
  )
}
