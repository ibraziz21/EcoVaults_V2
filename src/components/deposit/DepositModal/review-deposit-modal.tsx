// src/components/deposit/DepositModal/review-deposit-modal.tsx
'use client'

import { FC, useMemo, useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useWalletClient } from 'wagmi'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseUnits, type WalletClient } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import lifilogo from '@/public/logo_lifi_light.png'
import { getBridgeQuote } from '@/lib/quotes'
import { CHAINS } from '@/lib/wallet'
import { bridgeTokens } from '@/lib/bridge'
import { TokenAddresses } from '@/lib/constants'
import { DepositSuccessModal } from './deposit-success-modal'

type FlowStep = 'idle' | 'bridging' | 'depositing' | 'success' | 'error'

function assertOnOptimism(walletClient: WalletClient) {
  const current = walletClient.chain?.id
  if (current && current !== CHAINS.optimism.id) {
    throw new Error('Please switch your wallet to OP Mainnet to continue.')
  }
}

interface ReviewDepositModalProps {
  open: boolean
  onClose: () => void
  snap: YieldSnapshot

  amount: string
  /** OP representations only; Lisk reps are derived server-side / in bridge util */
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

async function ensureConnected(
  isConnected: boolean,
  connectors: ReturnType<typeof useConnect>['connectors'],
  connectAsync: ReturnType<typeof useConnect>['connectAsync'],
) {
  if (isConnected) return

  const safeConnector = connectors.find((c) => c.id === 'safe')
  if (safeConnector) {
    await connectAsync({ connector: safeConnector })
    return
  }

  const injectedConnector = connectors.find((c) => c.id === 'injected')
  if (!injectedConnector) throw new Error('No wallet connector available')
  await connectAsync({ connector: injectedConnector })
}

export const DepositModal: FC<ReviewDepositModalProps> = (props) => {
  const {
    open,
    onClose,
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

  // whether the user has successfully broadcast the OP bridge tx
  const [bridgeOk, setBridgeOk] = useState(false)

  // for retrying finish only (deposit/mint)
  const [currentRefId, setCurrentRefId] = useState<`0x${string}` | null>(null)
  const [lastFromTxHash, setLastFromTxHash] = useState<`0x${string}` | null>(null)

  // success modal
  const [showSuccess, setShowSuccess] = useState(false)

  // reset modal state on open/close
  useEffect(() => {
    if (!open) return
    setStep('idle')
    setError(null)
    setBridgeOk(false)
    setCurrentRefId(null)
    setLastFromTxHash(null)
    setShowSuccess(false)
  }, [open])

  const amountNumber = Number(amount || 0)
  const canStart = open && Number.isFinite(amountNumber) && amountNumber > 0

  const feeDisplay = useMemo(() => bridgeFeeDisplay ?? 0, [bridgeFeeDisplay])
  const receiveDisplay = useMemo(() => receiveAmountDisplay ?? 0, [receiveAmountDisplay])

  // OP-side decimals: USDC/USDT are always 6 in this build.
  const sourceDecimals = 6

  const optimismChainId = CHAINS.optimism.id
  const liskChainId = 1135 // keep as const in this file for now

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

      const res = await fetch('/api/relayer/finish', {
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

      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      console.error(TAG, 'retry deposit error', e)
      setError(e?.message ?? String(e))
      setStep('error')
    }
  }, [currentRefId, lastFromTxHash, optimismChainId])

  /* -------------------------------------------------------------------------- */
  /* Full confirm flow                                                          */
  /* -------------------------------------------------------------------------- */
  const handleConfirm = useCallback(async () => {
    // 0) Ensure connected (Safe first)
    await ensureConnected(isConnected, connectors, connectAsync)

    // After connecting, wagmi may not have hydrated walletClient *this tick*.
    if (!walletClient) return

    setError(null)
    setBridgeOk(false)

    try {
      if (snap.chain !== 'lisk') throw new Error('Only Lisk deposits are supported in this build')

      // 1) Ensure OP (OP-only interactions; no programmatic switching)
      assertOnOptimism(walletClient)

      const user = walletClient.account!.address as `0x${string}`
      const inputAmt = parseUnits(amount || '0', sourceDecimals)

      // 2) Create intent
      const { refId } = await createDepositIntent()
      setCurrentRefId(refId)

      // 3) Fresh quote for minAmount
      setStep('bridging')
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

      // 4) Execute bridge OP → Lisk (to = relayer on Lisk, in bridgeTokens)
      const bridgeResult = await bridgeTokens(destTokenLabel, inputAmt, 'optimism', 'lisk', walletClient, {
        sourceToken: sourceSymbol,
        onUpdate: () => {},
      })

      const fromTxHash: `0x${string}` | undefined = bridgeResult.txHash
      if (!fromTxHash) throw new Error('Bridge executed but no txHash was captured from LiFi route')

      setLastFromTxHash(fromTxHash)

      // 5) Attach route info (non-fatal)
      try {
        await fetch('/api/relayer/route-progress', {
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

      const finishRes = await fetch('/api/relayer/finish', {
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

      setStep('success')
      setShowSuccess(true)
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
    amount,
    destTokenLabel,
    sourceSymbol,
    optimismChainId,
    createDepositIntent,
  ])

  /* -------------------------------------------------------------------------- */
  /* UI derived state                                                           */
  /* -------------------------------------------------------------------------- */
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
  const dot1: DotState = step === 'idle' ? 'pending' : 'done'
  const dot2: DotState =
    step === 'bridging' && !bridgeOk
      ? 'active'
      : bridgeFailedBeforeLanding
      ? 'error'
      : step === 'depositing' || step === 'success' || depositFailedAfterBridge
      ? 'done'
      : 'idle'

  const primaryCta =
    !walletClient
      ? 'Connect wallet'
      : step === 'error'
      ? bridgeOk
        ? 'Retry deposit'
        : 'Try again'
      : step === 'idle'
      ? 'Deposit'
      : step === 'bridging'
      ? 'Sign bridge transaction…'
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
      void handleConfirm()
      return
    }

    if (step === 'success') {
      setShowSuccess(true)
      return
    }

    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  const stepHint = (() => {
    if (step === 'bridging') {
      return 'Bridge in progress. This can take a few minutes depending on network congestion.'
    }
    if (step === 'depositing') {
      return 'Your funds are being deposited into the vault and your receipt tokens minted on OP…'
    }
    if (step === 'success') {
      return 'Deposit complete. Your position will refresh shortly.'
    }
    if (step === 'error') {
      return 'Something went wrong. Check the error below and try again.'
    }
    return 'Review the details and confirm your deposit.'
  })()

  const isWorking = step === 'bridging' || step === 'depositing'

  const sourceIcon =
    sourceSymbol === 'USDT'
      ? '/tokens/usdt-icon.png'
      : sourceSymbol === 'USDT0'
      ? '/tokens/usdt0-icon.png'
      : '/tokens/usdc-icon.png'

  const sourceTokenLabel = sourceSymbol
  const sourceChainLabel = 'OP Mainnet'

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-lg my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold">{step === 'error' ? 'Review deposit – Error' : 'Review deposit'}</h3>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
              <X size={20} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5">
            {/* source */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={sourceIcon} alt={sourceTokenLabel} width={40} height={40} className="rounded-full" />
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
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

            {/* bridge */}
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <div className="relative mt-0.5">
                  <Image src={lifilogo.src} alt="bridge" width={40} height={40} className="rounded-full" />
                </div>

                <div className="flex-1">
                  <div className="text-lg font-semibold">Bridging via LI.FI</div>
                  <div className="text-xs text-muted-foreground">
                    Bridge Fee: {feeDisplay.toFixed(4)} {sourceSymbol}
                  </div>
                  <div className="text-xs text-muted-foreground">{routeLabel}</div>
                </div>

                {bridgeState === 'done' && (
                  <a href="#" className="text-muted-foreground hover:text-foreground" onClick={(e) => e.preventDefault()}>
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>

              {/* dot 1 */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex h-10 w-10 items-center justify-center">
                  {dot1 === 'done' ? <Check className="h-3 w-3 text-emerald-500" /> : <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />}
                </div>
                <div className="flex-1">
                  {dot1 === 'done' ? `${sourceTokenLabel} spending approved` : `Approve ${sourceTokenLabel} spending`}
                </div>
              </div>

              {/* dot 2 */}
              {(step === 'bridging' || step === 'depositing' || step === 'success' || bridgeFailedBeforeLanding || depositFailedAfterBridge) && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {dot2 === 'error' ? (
                      <AlertCircle className="h-3 w-3 text-red-500" />
                    ) : dot2 === 'done' ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : dot2 === 'active' ? (
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                    ) : (
                      <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                    )}
                  </div>

                  <div className="flex-1">
                    {dot2 === 'error' ? 'Signature required' : dot2 === 'done' ? 'Bridge transaction confirmed' : 'Sign bridge transaction'}
                  </div>
                </div>
              )}
            </div>

            {/* destination */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={destTokenLabel === 'USDT0' ? '/tokens/usdt0-icon.png' : destTokenLabel === 'USDCe' ? '/tokens/usdc-icon.png' : '/tokens/weth.png'}
                  alt={destTokenLabel}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                  <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} className="rounded-sm" />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{(receiveDisplay ?? 0).toFixed(4)}</div>
                <div className="text-xs text-muted-foreground">≈ ${amountNumber.toFixed(2)} • {destTokenLabel} on Lisk</div>

                {depositFailedAfterBridge && (
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <div className="flex h-10 w-10 items-center justify-center">
                      <AlertCircle className="h-3 w-3 text-red-500" />
                    </div>
                    <div className="flex-1">Deposit failed</div>
                  </div>
                )}
              </div>
            </div>

            {/* vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src="/protocols/morpho-icon.png" alt="Morpho" width={40} height={40} className="rounded-lg" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Depositing in Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
            </div>

            {stepHint && <div className="text-xs text-muted-foreground">{stepHint}</div>}
            {error && <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3">{error}</div>}
          </div>

          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-12 text-white bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={isWorking || !canStart}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryCta}</span>
            </Button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <DepositSuccessModal
          amount={Number(amount || 0)}
          sourceToken={sourceTokenLabel as 'USDC' | 'USDT' | 'USDCe' | 'USDT0'}
          destinationAmount={Number(receiveDisplay ?? 0)}
          destinationToken={destTokenLabel}
          vault={`Re7 ${snap.token} Vault (Morpho Blue)`}
          onClose={() => {
            setShowSuccess(false)
            onClose()
          }}
        />
      )}
    </div>
  )
}
