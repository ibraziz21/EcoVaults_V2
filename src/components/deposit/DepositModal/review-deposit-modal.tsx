'use client'

import { FC, useMemo, useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { X, ExternalLink, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient } from 'wagmi'
import { parseUnits } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import lifilogo from '@/public/lifi.png'
import { getBridgeQuote } from '@/lib/quotes'
import { switchOrAddChain, CHAINS } from '@/lib/wallet'
import { bridgeTokens } from '@/lib/bridge'
import { TokenAddresses } from '@/lib/constants'
import { readWalletBalance } from '../helpers'
import { depositMorphoOnLiskAfterBridge } from '@/lib/depositor'
import { switchOrAddChainStrict } from '@/lib/switch'
import InfoIconModal from '../../../../public/info-icon-modal.svg'
import CheckIconModal from '../../../../public/check-icon-modal.svg'
import AlertIconModal from '../../../../public/alert-icon-modal.svg'

type FlowStep = 'idle' | 'bridging' | 'depositing' | 'success' | 'error'

interface DepositSuccessData {
  amount: number
  sourceToken: string
  destinationAmount: number
  destinationToken: string
  vault: string
}

interface ReviewDepositModalProps {
  open: boolean
  onClose: () => void
  onSuccess: (data: DepositSuccessData) => void
  snap: YieldSnapshot

  amount: string
  /** Now supports OP USDT0 + Lisk USDCe/USDT0 */
  sourceSymbol: 'USDC' | 'USDT' | 'USDCe' | 'USDT0'
  destTokenLabel: 'USDCe' | 'USDT0' | 'WETH'
  routeLabel: string
  bridgeFeeDisplay: number
  receiveAmountDisplay: number

  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT0: bigint | null
  opUsdcBal: bigint | null
  baUsdcBal: bigint | null
  opUsdtBal: bigint | null
  baUsdtBal: bigint | null
}

function opTxUrl(hash: `0x${string}`) {
  return `https://optimistic.etherscan.io/tx/${hash}`
}

function toTokenDecimals(sym: 'USDC' | 'USDT' | 'WETH' | 'USDCe' | 'USDT0') {
  return sym === 'WETH' ? 18 : 6
}

const TAG = '[deposit]'

function StepHintRow({ hint }: { hint: string }) {
  return (
    <div className="pt-4">
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground min-h-[32px]">
        <span className="leading-4 min-w-0">{hint}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Clock className="w-4 h-4" strokeWidth={1.5} />
          <span className="font-normal whitespace-nowrap">~5 min</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Poll for token landing on Lisk without a fixed 60s sleep.
 * - polls immediately
 * - also re-checks on focus/visibility change
 * - avoids "stuck until click" symptoms
 */
async function waitForLanding(params: {
  destAddr: `0x${string}`
  user: `0x${string}`
  preBal: bigint
  timeoutMs?: number
  intervalMs?: number
}): Promise<{ landed: bigint; last: bigint }> {
  const { destAddr, user, preBal, timeoutMs = 15 * 60_000, intervalMs = 6_000 } = params

  let last = preBal
  const start = Date.now()

  const read = async () => {
    const bal = await readWalletBalance('lisk', destAddr, user).catch(() => null)
    if (bal === null) return null
    last = bal
    const delta = bal - preBal
    return delta > 0n ? delta : null
  }

  return new Promise((resolve, reject) => {
    let done = false
    let timer: any = null

    const cleanup = () => {
      if (timer) clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }

    const succeed = (landed: bigint) => {
      if (done) return
      done = true
      cleanup()
      resolve({ landed, last })
    }

    const fail = () => {
      if (done) return
      done = true
      cleanup()
      reject(
        new Error(
          `Bridging not finalized on Lisk in time. Last balance ${last.toString()}, start ${preBal.toString()}.`,
        ),
      )
    }

    const tick = async () => {
      if (done) return
      if (Date.now() - start > timeoutMs) {
        fail()
        return
      }
      try {
        const landed = await read()
        if (landed && landed > 0n) succeed(landed)
      } catch {
        // ignore transient read errors
      }
    }

    const onFocus = () => void tick()
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)

    // immediate check + interval
    void tick()
    timer = setInterval(tick, intervalMs)
  })
}

export const DepositModal: FC<ReviewDepositModalProps> = (props) => {
  const {
    open,
    onClose,
    onSuccess,
    snap,
    amount,
    sourceSymbol,
    destTokenLabel,
    routeLabel,
    bridgeFeeDisplay,
    receiveAmountDisplay,
  } = props

  const { open: openConnect } = useAppKit()
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient()

  const tokenDecimals = useMemo(
    () => toTokenDecimals((snap.token as any) === 'WETH' ? 'WETH' : 'USDC'),
    [snap.token],
  )

  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // recovery-aware caches
  const [bridgeOk, setBridgeOk] = useState(false)
  const [cachedInputAmt, setCachedInputAmt] = useState<bigint | null>(null)
  const [cachedMinOut, setCachedMinOut] = useState<bigint | null>(null)

  // destination token (for polling/deposit)
  const [destAddr, setDestAddr] = useState<`0x${string}` | null>(null)
  const [preBal, setPreBal] = useState<bigint>(0n)

  // UI flags
  const [approvalDone, setApprovalDone] = useState(false)
  const [bridgeTxHash, setBridgeTxHash] = useState<`0x${string}` | null>(null)
  const [bridgeSubmitted, setBridgeSubmitted] = useState(false)
  const [bridgeDone, setBridgeDone] = useState(false) // ✅ only true once route finishes

  const canStart = open && !!walletClient && Number(amount) > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(() => receiveAmountDisplay ?? 0, [receiveAmountDisplay])
  const amountNumber = Number(amount || 0)

  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`${label} (>${ms}ms)`)), ms),
      ),
    ])
  }

  /** Ensure wallet on Lisk and return a **fresh** wallet client after switch */
  const ensureLiskWalletClient = useCallback(async () => {
    if (!walletClient) throw new Error('No wallet client')

    await withTimeout(
      switchOrAddChainStrict(walletClient, CHAINS.lisk),
      20_000,
      'Chain switch to Lisk timed out',
    )

    for (let i = 0; i < 10; i++) {
      const refreshed =
        (await withTimeout(refetchWalletClient(), 10_000, 'Refetch wallet client timed out')).data ??
        walletClient

      const chainId = refreshed?.chain?.id
      if (chainId === CHAINS.lisk.id) return refreshed
      await new Promise((r) => setTimeout(r, 400))
    }

    throw new Error('Wallet did not switch to Lisk (chain id not updated)')
  }, [walletClient, refetchWalletClient])

  // ---------- Focus recovery (kept as a backup; main flow no longer depends on it) ----------
  useEffect(() => {
    if (!walletClient || !destAddr) return

    const handler = async () => {
      if (step !== 'bridging') return
      try {
        const user0 = walletClient.account!.address as `0x${string}`
        const bal = await readWalletBalance('lisk', destAddr, user0).catch(() => 0n)

        if (bal > preBal) {
          console.info(TAG, '[focus] detected landing, advancing to deposit')
          setBridgeOk(true)
          const landed = bal - preBal
          setCachedMinOut(landed)

          const wc = await ensureLiskWalletClient()
          setStep('depositing')
          await depositMorphoOnLiskAfterBridge(snap, landed, wc)

          setStep('success')
          onSuccess({
            amount: Number(amount || 0),
            sourceToken: sourceTokenLabel,
            destinationAmount: Number(receiveDisplay ?? 0),
            destinationToken: destTokenLabel,
            vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
          })
          onClose()
        }
      } catch (e) {
        console.error(TAG, '[focus] failed', e)
      }
    }

    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [step, walletClient, destAddr, preBal, snap, ensureLiskWalletClient, onClose, onSuccess, amount, receiveDisplay, destTokenLabel])

  // ---------- Deposit-only retry ----------
  async function depositOnlyRetry() {
    if (!walletClient || !destAddr) return
    const wc = await ensureLiskWalletClient()

    const user = wc.account!.address as `0x${string}`
    let amt = cachedMinOut && cachedMinOut > 0n ? cachedMinOut : (cachedInputAmt ?? 0n)

    const bal = await readWalletBalance('lisk', destAddr, user).catch(() => 0n)
    if (amt <= 0n || amt > bal) amt = bal
    if (amt <= 0n) {
      setError('Nothing to deposit')
      setStep('error')
      return
    }

    try {
      setError(null)
      setStep('depositing')
      await depositMorphoOnLiskAfterBridge(snap, amt, wc)

      setStep('success')
      onSuccess({
        amount: Number(amount || 0),
        sourceToken: sourceTokenLabel,
        destinationAmount: Number(receiveDisplay ?? 0),
        destinationToken: destTokenLabel,
        vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }

    setError(null)
    setBridgeOk(false)

    // Reset per-run state
    setApprovalDone(false)
    setBridgeSubmitted(false)
    setBridgeDone(false)
    setBridgeTxHash(null)

    try {
      const inputAmt = parseUnits(amount || '0', snap.token === 'WETH' ? 18 : 6)
      const user = walletClient.account!.address as `0x${string}`

      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')

      const _destAddr =
        destTokenLabel === 'USDCe'
          ? (TokenAddresses.USDCe.lisk as `0x${string}`)
          : destTokenLabel === 'USDT0'
            ? (TokenAddresses.USDT0.lisk as `0x${string}`)
            : (TokenAddresses.WETH.lisk as `0x${string}`)

      setDestAddr(_destAddr)
      setCachedInputAmt(inputAmt)

      // ── All deposits now bridge from OP → Lisk ──
      const srcToken: 'USDC' | 'USDT' | 'USDT0' | 'USDCe' = sourceSymbol
      const srcChain = 'optimism' as const

      // Baseline Lisk balance for landing detection
      const pre = (await readWalletBalance('lisk', _destAddr, user).catch(() => 0n)) as bigint
      setPreBal(pre)

      setStep('bridging')

      // Quote (for minOut display; we still accept any positive landing)
      const q = await getBridgeQuote({
        token: destTokenLabel,
        amount: inputAmt,
        from: srcChain,
        to: 'lisk',
        fromAddress: user,
        fromTokenSym: srcToken,
      })
      setCachedMinOut(BigInt(q.estimate?.toAmountMin ?? '0'))

      // Execute bridge on Optimism only
      const srcViem = CHAINS.optimism
      await switchOrAddChain(walletClient, srcViem)

      await bridgeTokens(destTokenLabel, inputAmt, srcChain, 'lisk', walletClient, {
        sourceToken: srcToken,
        onUpdate: (u?: any) => {
          const stage = String(u?.stage ?? '').toLowerCase()
          const hash = u?.txHash as `0x${string}` | undefined

          if (hash && !bridgeTxHash) setBridgeTxHash(hash)

          // Submitted => show "Bridging…" and mark approval done
          if (stage === 'submitted' || stage === 'confirming' || stage === 'completed') {
            setBridgeSubmitted(true)
            setApprovalDone(true)
          }

          if (hash) {
            setBridgeSubmitted(true)
            setApprovalDone(true)
          }
        },
      })

      // ✅ Route finished (not just signed)
      setBridgeDone(true)

      // If LI.FI never emitted updates, don’t hang “Approve”
      setBridgeSubmitted(true)
      setApprovalDone(true)

      // ✅ Poll immediately for landing (no fixed 60s sleep)
      const { landed } = await waitForLanding({
        destAddr: _destAddr,
        user,
        preBal: pre,
        timeoutMs: 15 * 60_000,
        intervalMs: 6_000,
      })

      setBridgeOk(true)
      setCachedMinOut(landed)

      const wc = await ensureLiskWalletClient()
      if (landed <= 0n) throw new Error('Nothing to deposit on Lisk')

      setStep('depositing')

      await withTimeout(
        depositMorphoOnLiskAfterBridge(snap, landed, wc),
        120_000,
        'Deposit signing/submit timed out',
      )

      // Optional: switch back to OP Mainnet
      try {
        await switchOrAddChain(wc, srcViem)
      } catch (switchErr) {
        console.warn(TAG, 'Failed to switch back to OP, ignoring', switchErr)
      }

      setStep('success')
      onSuccess({
        amount: Number(amount || 0),
        sourceToken: sourceTokenLabel,
        destinationAmount: Number(receiveDisplay ?? 0),
        destinationToken: destTokenLabel,
        vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
      })
      onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }

  // ---------- UI state mapping ----------
  const bridgeState: 'idle' | 'working' | 'done' | 'error' =
    step === 'bridging'
      ? 'working'
      : step === 'depositing' || step === 'success' || (step === 'error' && bridgeOk)
        ? 'done'
        : step === 'error'
          ? 'error'
          : 'idle'

  // ---------- Retry semantics ----------
  const primaryCta =
    step === 'error'
      ? bridgeOk
        ? 'Retry deposit'
        : 'Try again'
      : step === 'idle'
        ? 'Deposit'
        : step === 'bridging'
          ? bridgeSubmitted
            ? 'Bridging…'
            : 'Sign bridge transaction…'
          : step === 'depositing'
            ? 'Depositing…'
            : step === 'success'
              ? 'Done'
              : 'Working…'

  const onPrimary = () => {
    if (step === 'error') {
      if (bridgeOk) {
        void depositOnlyRetry()
        return
      }
      setError(null)
      setStep('idle')
      setApprovalDone(false)
      setBridgeSubmitted(false)
      setBridgeDone(false)
      setBridgeTxHash(null)
      void handleConfirm()
      return
    }
    if (step === 'success') {
      onClose()
      return
    }
    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  // ---------- Source row visuals (always OP source) ----------
  const sourceIcon =
    sourceSymbol === 'USDT'
      ? '/tokens/usdt-icon.png'
      : sourceSymbol === 'USDT0'
        ? '/tokens/usdt0-icon.png'
        : '/tokens/usdc-icon.png'

  const sourceTokenLabel = sourceSymbol
  const sourceChainLabel = 'OP Mainnet'

  // ---------- Bridge dots (UI only) ----------
  const bridgeFailedBeforeLanding = step === 'error' && !bridgeOk
  const depositFailedAfterBridge = step === 'error' && bridgeState === 'done'

  type DotState = 'pending' | 'idle' | 'active' | 'done' | 'error'

  const dot2: DotState =
    bridgeFailedBeforeLanding
      ? 'error'
      : step === 'depositing' || step === 'success' || depositFailedAfterBridge
        ? 'done'
        : step === 'bridging'
          ? 'active'
          : 'idle'

  const dot3: DotState =
    step === 'depositing'
      ? 'active'
      : step === 'success'
        ? 'done'
        : depositFailedAfterBridge
          ? 'error'
          : 'idle'

  // ---------- Step hint ----------
  const stepHint = (() => {
    if (step === 'bridging') {
      return bridgeSubmitted
        ? 'Bridge submitted. Waiting for funds to arrive on Lisk…'
        : 'Signature required to start bridging.'
    }
    if (step === 'depositing') return 'Your funds have arrived on Lisk. Depositing into the vault…'
    if (step === 'success') return 'Deposit complete. Your position will refresh shortly.'
    if (step === 'error') return 'Something went wrong. Check the error below and try again.'
    return 'You’re depositing.'
  })()

  const isWorking = step === 'bridging' || step === 'depositing'

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
            }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              {step === 'error' ? 'Deposit failed' : "You're depositing"}
            </h3>
            <button onClick={onClose} className="cursor-pointer p-2 hover:bg-muted rounded-full">
              <X size={20} />
            </button>
          </div>

          <div className="px-5 space-y-0">
            {stepHint && <StepHintRow hint={stepHint} />}
          </div>

          <div className="px-5 py-5 space-y-0">
            {/* Step 1: Source */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={sourceIcon} alt={sourceTokenLabel} width={40} height={40} className="rounded-full" />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image src="/networks/op-icon.png" alt={sourceChainLabel} width={16} height={16} className="rounded-sm" />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{Number(amountNumber).toString()}</div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {sourceTokenLabel} on {sourceChainLabel}
                </div>
              </div>
            </div>

            {/* Step 2: Bridge */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={lifilogo.src} alt="bridge" width={40} height={40} className="rounded-full" />
              </div>

              <div className="flex-1 space-y-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-lg font-semibold">Bridging via LI.FI</div>
                    <div className="text-xs text-muted-foreground">Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-step 1: Approve spending (ONLY before bridge is submitted) */}
            {step === 'bridging' && !bridgeSubmitted && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    <div className="bg-[#EBF1FF] rounded-full p-1">
                      <Image src={InfoIconModal} alt="" className="w-4 h-4" />
                    </div>
                  </div>
                </div>
                <div className="flex-1 mt-3">
                  <div className="text-xs">Approve {sourceTokenLabel} spending</div>
                </div>
              </div>
            )}

            {/* Sub-step 1: Approval complete (once bridge submitted) */}
            {(step !== 'idle' && bridgeSubmitted) && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    <div className="bg-[#E7F8F0] rounded-full p-1">
                      <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                    </div>
                  </div>
                </div>
                <div className="flex-1 mt-3">
                  <div className="text-xs">{sourceTokenLabel} spending approved</div>
                </div>
              </div>
            )}

            {/* Sub-step 2: Bridge transaction */}
            {(step === 'bridging' || step === 'depositing' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {dot2 === 'error' ? (
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : dot2 === 'done' ? (
                      <div className="bg-[#E7F8F0] rounded-full p-1">
                        <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="bg-[#EBF1FF] rounded-full p-1">
                        <Image src={InfoIconModal} alt="" className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 mt-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs">
                      {dot2 === 'error'
                        ? 'Signature required'
                        : bridgeDone
                          ? 'Bridge transaction confirmed'
                          : bridgeSubmitted
                            ? 'Bridging…'
                            : 'Sign bridge transaction'}
                    </div>

                    {/* ✅ Explorer link ONLY once bridge is complete (not immediately after signature) */}
                    {bridgeDone && bridgeTxHash && (
                      <a
                        href={opTxUrl(bridgeTxHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        title="View on explorer"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Destination */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src={
                    destTokenLabel === 'USDT0'
                      ? '/tokens/usdt0-icon.png'
                      : destTokenLabel === 'USDCe'
                        ? '/tokens/usdc-icon.png'
                        : '/tokens/weth.png'
                  }
                  alt={destTokenLabel}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} className="rounded-sm" />
                </div>
              </div>

              <div className="flex-1">
                <div className="text-2xl font-bold">{(receiveDisplay ?? 0).toFixed(4)}</div>
                <div className="text-xs text-muted-foreground">
                  ${amountNumber.toFixed(2)} • {destTokenLabel} on Lisk
                </div>

                {depositFailedAfterBridge && (
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <div className="flex h-10 w-10 items-center justify-center shrink-0">
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="flex-1 text-red-500">Deposit failed</div>
                  </div>
                )}
              </div>
            </div>

            {/* Sub-step 3: Vault deposit */}
            {(step === 'depositing' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {dot3 === 'error' ? (
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : dot3 === 'done' ? (
                      <div className="bg-[#E7F8F0] rounded-full p-1">
                        <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : (
                      <div className="bg-[#EBF1FF] rounded-full p-1">
                        <Image src={InfoIconModal} alt="" className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 mt-3">
                  <div className="text-xs">
                    {dot3 === 'error'
                      ? 'Vault deposit failed'
                      : dot3 === 'done'
                        ? 'Successfully deposited in vault'
                        : dot3 === 'active'
                          ? 'Depositing in vault…'
                          : 'Waiting for deposit…'}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 shrink-0">
                <Image src="/protocols/morpho-icon.png" alt="Morpho" width={40} height={40} className="rounded-[6px]" />
              </div>
              <div className="flex-1 space-y-0">
                <div className="text-lg font-semibold">Depositing in Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3 mt-2">
                {error}
              </div>
            )}
          </div>

          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-10 text-white bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={isWorking || !canStart}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryCta}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}