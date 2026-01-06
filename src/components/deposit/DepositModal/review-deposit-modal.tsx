// src/components/deposit/DepositModal/review-deposit-modal.tsx
'use client'

import { FC, useMemo, useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { X, ExternalLink, Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccount, useConnect, useWalletClient } from 'wagmi'
import { parseUnits, type WalletClient } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import lifilogo from '@/public/lifi.png'
import { getBridgeQuote } from '@/lib/quotes'
import { CHAINS } from '@/lib/wallet'
import { bridgeTokens } from '@/lib/bridge'
import { TokenAddresses } from '@/lib/constants'
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

  // balances: included in props contract; not required for the modal core flow
  opBal: bigint | null
  baBal: bigint | null
  liBal: bigint | null
  liBalUSDT0: bigint | null
  opUsdcBal: bigint | null
  baUsdcBal: bigint | null
  opUsdtBal: bigint | null
  baUsdtBal: bigint | null
}

const TAG = '[deposit]'
const ZERO32 = `0x${'0'.repeat(64)}` as `0x${string}`
const STATUS_POLL_INTERVAL_MS = 5000
const STATUS_POLL_TIMEOUT_MS = 4 * 60_000

function opTxUrl(hash: `0x${string}`) {
  return `https://optimistic.etherscan.io/tx/${hash}`
}

function randomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32)
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`
}

function assertOnOptimism(walletClient: WalletClient) {
  const current = walletClient.chain?.id
  if (current && current !== CHAINS.optimism.id) {
    throw new Error('Please switch your wallet to OP Mainnet to continue.')
  }
}

async function ensureConnected(
  isConnected: boolean,
  connectors: ReturnType<typeof useConnect>['connectors'],
  connectAsync: ReturnType<typeof useConnect>['connectAsync'],
) {
  if (isConnected) return

  const isSafeEnv = typeof window !== 'undefined' && window.parent !== window
  const safeConnector = connectors.find((c) => c.id === 'safe')
  const injectedConnector = connectors.find((c) => c.id === 'injected')

  if (safeConnector && isSafeEnv) {
    try {
      await connectAsync({ connector: safeConnector })
      return
    } catch (err) {
      console.warn('[connect] Safe connector failed, falling back to injected', err)
    }
  }

  if (injectedConnector) {
    await connectAsync({ connector: injectedConnector })
    return
  }

  if (safeConnector) {
    await connectAsync({ connector: safeConnector })
    return
  }

  throw new Error('No wallet connector available')
}

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

  const { isConnected } = useAccount()
  const { connectors, connectAsync } = useConnect()
  const { data: walletClient } = useWalletClient()

  const [step, setStep] = useState<FlowStep>('idle')
  const [error, setError] = useState<string | null>(null)

  // progress flags for UI
  const [bridgeOk, setBridgeOk] = useState(false) // means: OP bridge tx broadcast succeeded
  const [bridgeTxHash, setBridgeTxHash] = useState<`0x${string}` | null>(null)
  const [bridgeSubmitted, setBridgeSubmitted] = useState(false)
  const [bridgeDone, setBridgeDone] = useState(false)

  // for retrying finish only
  const [currentRefId, setCurrentRefId] = useState<`0x${string}` | null>(null)
  const [lastFromTxHash, setLastFromTxHash] = useState<`0x${string}` | null>(null)
  const pollAbortRef = useRef<AbortController | null>(null)

  // reset modal state on open
  useEffect(() => {
    if (!open) return
    setStep('idle')
    setError(null)
    setBridgeOk(false)
    setBridgeTxHash(null)
    setBridgeSubmitted(false)
    setBridgeDone(false)
    setCurrentRefId(null)
    setLastFromTxHash(null)
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }, [open])

  const amountNumber = Number(amount || 0)
  const canStart = open && !!walletClient && Number.isFinite(amountNumber) && amountNumber > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(() => receiveAmountDisplay ?? 0, [receiveAmountDisplay])

  // OP-side decimals in this build: USDC/USDT/USDT0/USDCe (representations) are 6
  const sourceDecimals = 6

  const optimismChainId = CHAINS.optimism.id
  const liskChainId = 1135 // Lisk L2 chain id

  // ---------- Source row visuals (always OP source) ----------
  const sourceIcon =
    sourceSymbol === 'USDT'
      ? '/tokens/usdt-icon.png'
      : sourceSymbol === 'USDT0'
        ? '/tokens/usdt0-icon.png'
        : '/tokens/usdc-icon.png'

  const sourceTokenLabel = sourceSymbol
  const sourceChainLabel = 'OP Mainnet'

  /* -------------------------------------------------------------------------- */
  /* Status polling (for async finish)                                          */
  /* -------------------------------------------------------------------------- */
  const waitForTerminalStatus = useCallback(
    async (refId: `0x${string}`) => {
      const ctrl = new AbortController()
      pollAbortRef.current = ctrl
      const endAt = Date.now() + STATUS_POLL_TIMEOUT_MS

      while (true) {
        if (ctrl.signal.aborted) throw new Error('Status polling cancelled')
        try {
          const res = await fetch(`/api/deposits/status?refId=${refId}`, { signal: ctrl.signal })
          const js = await res.json().catch(() => null)
          if (!res.ok || !js?.ok) throw new Error(js?.error || 'Status check failed')

          const status = String(js.status || '').toUpperCase()
          if (status === 'MINTED') return js
          if (status === 'FAILED') throw new Error(js?.error || 'Deposit failed')
        } catch (err: any) {
          if (ctrl.signal.aborted) throw err
          // swallow transient errors; continue until timeout
          console.warn(TAG, 'status poll error', err?.message || err)
        }

        if (Date.now() > endAt) throw new Error('Deposit is still processing. Please try resume in a moment.')
        await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS))
      }
    },
    [],
  )

  /* -------------------------------------------------------------------------- */
  /* Create + sign deposit intent (OP)                                           */
  /* -------------------------------------------------------------------------- */
  const createDepositIntent = useCallback(async () => {
    if (!walletClient) throw new Error('No wallet client')
    if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')

    const user = walletClient.account!.address as `0x${string}`

    const asset =
      destTokenLabel === 'USDCe'
        ? (TokenAddresses.USDCe.lisk as `0x${string}`)
        : destTokenLabel === 'USDT0'
          ? (TokenAddresses.USDT0.lisk as `0x${string}`)
          : (TokenAddresses.WETH.lisk as `0x${string}`)

    const amountIn = parseUnits(amount || '0', sourceDecimals)

    const nowSec = Math.floor(Date.now() / 1000)
    const deadline = (nowSec + 60 * 30).toString() // 30 minutes
    const nonce = BigInt(nowSec).toString()
    const refId = randomBytes32()
    const salt = randomBytes32()

    const domain = {
      name: 'SuperYLDR',
      version: '1',
      chainId: optimismChainId,
    }

    const types = {
      DepositIntent: [
        { name: 'user', type: 'address' },
        { name: 'key', type: 'bytes32' },
        { name: 'asset', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'refId', type: 'bytes32' },
        { name: 'salt', type: 'bytes32' },
      ] as const,
    }

    const message = {
      user,
      key: ZERO32,
      asset,
      amount: amountIn,
      deadline: BigInt(deadline),
      nonce: BigInt(nonce),
      refId,
      salt,
    }

    console.info(TAG, 'signing deposit intent', { message })

    const signature = await walletClient.signTypedData({
      account: user,
      domain,
      types,
      primaryType: 'DepositIntent',
      message,
    })

    // Normalize “OP rep” → underlying source token for relayer, if needed
    const srcToken: 'USDC' | 'USDT' =
      sourceSymbol === 'USDT' || sourceSymbol === 'USDT0' ? 'USDT' : 'USDC'

    const res = await fetch('/api/create-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: {
          user,
          adapterKey: ZERO32,
          asset,
          amount: amountIn.toString(),
          deadline,
          nonce,
          refId,
          salt,
          fromChain: 'optimism',
          srcToken,
        },
        signature,
      }),
    })

    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      console.error(TAG, 'create-intent failed', json)
      throw new Error(json?.error || 'Failed to create deposit intent')
    }

    return { refId: json.refId as `0x${string}` }
  }, [walletClient, snap.chain, destTokenLabel, amount, sourceSymbol, optimismChainId])

  /* -------------------------------------------------------------------------- */
  /* Retry deposit only (finish)                                                */
  /* -------------------------------------------------------------------------- */
  const depositOnlyRetry = useCallback(async () => {
    if (!currentRefId) {
      setError('Missing deposit reference; please try again.')
      setStep('error')
      return
    }

    try {
      setError(null)
      setStep('depositing')

      const res = await fetch('/api/deposits/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refId: currentRefId,
          fromTxHash: lastFromTxHash ?? undefined,
          fromChainId: optimismChainId,
          toChainId: liskChainId,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        console.error(TAG, 'finish (retry) failed', json)
        throw new Error(json?.error || 'Failed to finalize deposit')
      }

      const processing = res.status === 202 || json.waiting || json.processing
      if (processing) {
        const statusResult = await waitForTerminalStatus(currentRefId)
        if (String(statusResult.status || '').toUpperCase() !== 'MINTED') {
          throw new Error(statusResult?.error || 'Deposit did not complete')
        }
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
      console.error(TAG, 'retry deposit error', e)
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }, [
    currentRefId,
    lastFromTxHash,
    optimismChainId,
    liskChainId,
    onSuccess,
    onClose,
    amount,
    receiveDisplay,
    destTokenLabel,
    snap.token,
    sourceTokenLabel,
    waitForTerminalStatus,
  ])

  /* -------------------------------------------------------------------------- */
  /* Full confirm flow (Safe-first wagmi)                                        */
  /* -------------------------------------------------------------------------- */
  const handleConfirm = useCallback(async () => {
    // Show progress immediately so the stepper reflects work while signing
    setStep('bridging')

    // 0) Ensure connected (Safe first)
    await ensureConnected(isConnected, connectors, connectAsync)

    // After connecting, wagmi may not have hydrated walletClient *this tick*.
    if (!walletClient) return

    setError(null)
    setBridgeOk(false)

    // Reset per-run UI state
    setBridgeSubmitted(false)
    setBridgeDone(false)
    setBridgeTxHash(null)
    pollAbortRef.current?.abort()
    pollAbortRef.current = null

    try {
      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')

      // 1) Ensure OP (OP-only interactions; no programmatic switching)
      assertOnOptimism(walletClient)

      const user = walletClient.account!.address as `0x${string}`
      const inputAmt = parseUnits(amount || '0', sourceDecimals)

      // 2) Create intent (store refId for retry)
      const { refId } = await createDepositIntent()
      setCurrentRefId(refId)

      // 3) Fresh quote for minAmount (tolerate by small buffer)
      const quote = await getBridgeQuote({
        token: destTokenLabel,
        amount: inputAmt,
        from: 'optimism',
        to: 'lisk',
        fromAddress: user,
        fromTokenSym: sourceSymbol,
      })

      const rawMinOut = BigInt(quote.estimate?.toAmountMin ?? '0')
      const minOut = rawMinOut > 0n ? rawMinOut - 10n : 0n
      console.info(TAG, 'bridge quote', { minOut: minOut.toString(), quote })

      // 4) Execute bridge OP → Lisk (bridge util should route to relayer on Lisk)
      const bridgeResult = await bridgeTokens(destTokenLabel, inputAmt, 'optimism', 'lisk', walletClient, {
        sourceToken: sourceSymbol,
        onUpdate: (u?: any) => {
          const stage = String(u?.stage ?? '').toLowerCase()
          const hash = (u?.txHash as `0x${string}` | undefined) ?? undefined

          if (hash && !bridgeTxHash) setBridgeTxHash(hash)

          // Once the route is submitted, hide the “Approve…” sub-step and show progress
          if (stage === 'submitted' || stage === 'confirming' || stage === 'completed') {
            setBridgeSubmitted(true)
          }
          if (hash) setBridgeSubmitted(true)
        },
      })

      const fromTxHash: `0x${string}` | undefined = bridgeResult?.txHash ?? bridgeTxHash ?? undefined
      if (!fromTxHash) throw new Error('Bridge executed but no txHash was captured from LiFi route')

      setLastFromTxHash(fromTxHash)

      // route finished (not just signed)
      setBridgeDone(true)
      setBridgeSubmitted(true)

      // 5) Attach route info (non-fatal)
      try {
        await fetch('/api/deposits/route-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            refId,
            fromTxHash,
            fromChainId: optimismChainId,
            toChainId: liskChainId,
          }),
        })
      } catch (routeErr) {
        console.warn(TAG, 'route-progress failed (non-fatal)', routeErr)
      }

      // 6) Finish (relayer wait+deposit+mint)
      setBridgeOk(true)
      setStep('depositing')

      const finishRes = await fetch('/api/deposits/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refId,
          fromTxHash,
          fromChainId: optimismChainId,
          toChainId: liskChainId,
          minAmount: minOut.toString(),
        }),
      })

      const finishJson = await finishRes.json().catch(() => null)
      if (!finishRes.ok || !finishJson?.ok) {
        console.error(TAG, 'finish failed', finishJson)
        throw new Error(finishJson?.error || 'Failed to finalize deposit')
      }

      const processing = finishRes.status === 202 || finishJson.waiting || finishJson.processing
      if (processing) {
        const statusResult = await waitForTerminalStatus(refId)
        if (String(statusResult.status || '').toUpperCase() !== 'MINTED') {
          throw new Error(statusResult?.error || 'Deposit did not complete')
        }
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
      console.error(TAG, 'handleConfirm error', e)
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }, [
    isConnected,
    connectors,
    connectAsync,
    walletClient,
    snap.chain,
    snap.token,
    amount,
    sourceDecimals,
    destTokenLabel,
    sourceSymbol,
    optimismChainId,
    liskChainId,
    createDepositIntent,
    bridgeTxHash,
    onSuccess,
    onClose,
    receiveDisplay,
    sourceTokenLabel,
    waitForTerminalStatus,
  ])

  // ---------- UI state mapping ----------
  const bridgeState: 'idle' | 'working' | 'done' | 'error' =
    step === 'bridging'
      ? 'working'
      : step === 'depositing' || step === 'success' || (step === 'error' && bridgeOk)
        ? 'done'
        : step === 'error'
          ? 'error'
          : 'idle'

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
    step === 'depositing' ? 'active' : step === 'success' ? 'done' : depositFailedAfterBridge ? 'error' : 'idle'

  const stepHint = (() => {
    if (step === 'bridging') {
      return bridgeSubmitted
        ? 'Bridge submitted. Waiting for relayer to finalize on Lisk…'
        : 'Signature required to start bridging.'
    }
    if (step === 'depositing') return 'Finalizing: deposit on Lisk and minting receipt on OP…'
    if (step === 'success') return 'Deposit complete. Your position will refresh shortly.'
    if (step === 'error') return 'Something went wrong. Check the error below and try again.'
    return 'You’re depositing.'
  })()

  const isWorking = step === 'bridging' || step === 'depositing'

  const primaryCta =
    !walletClient && !isConnected
      ? 'Connect wallet'
      : step === 'error'
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
    if (!walletClient && !isConnected) {
      void handleConfirm()
      return
    }

    if (step === 'error') {
      if (bridgeOk) {
        void depositOnlyRetry()
        return
      }
      setError(null)
      setStep('idle')
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

  const onCloseSafe = () => {
    if (isWorking && currentRefId) {
      const ok = window.confirm(
        'Your deposit is still finalizing. Closing will hide progress, but the process will continue. Close anyway?',
      )
      if (!ok) return
    }
    pollAbortRef.current?.abort()
    onClose()
  }

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              {step === 'error' ? 'Deposit failed' : "You're depositing"}
            </h3>
            <button onClick={onCloseSafe} className="cursor-pointer p-2 hover:bg-muted rounded-full" disabled={false}>
              <X size={20} />
            </button>
          </div>

          <div className="px-5 space-y-0">{stepHint && <StepHintRow hint={stepHint} />}</div>

          <div className="px-5 py-5 space-y-0">
            {/* Step 1: Source */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={sourceIcon} alt={sourceTokenLabel} width={40} height={40} className="rounded-full" />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image
                    src="/networks/op-icon.png"
                    alt={sourceChainLabel}
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
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
                    <div className="text-xs text-muted-foreground">
                      Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}
                    </div>
                    <div className="text-xs text-muted-foreground">{routeLabel}</div>
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
            {step !== 'idle' && bridgeSubmitted && (
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

                    {/* Explorer link ONLY once bridge is complete */}
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
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3 mt-2 max-h-24 overflow-y-auto">
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
