// src/components/WithdrawModal/review-withdraw-modal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, ExternalLink, Loader2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletClient, useConnect } from 'wagmi'
import { parseUnits } from 'viem'
import { optimism } from 'viem/chains'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { WithdrawSuccessModal } from './withdraw-success-modal'

import lifilogo from '@/public/logo_lifi_light.png'
import InfoIconModal from '../../../../public/info-icon-modal.svg'
import CheckIconModal from '../../../../public/check-icon-modal.svg'
import AlertIconModal from '../../../../public/alert-icon-modal.svg'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ChainSel = 'optimism'

type FlowStep = 'idle' | 'withdrawing' | 'bridging' | 'success' | 'error'

interface Props {
  open: boolean
  onClose: () => void
  snap: Pick<YieldSnapshot, 'token' | 'chain'> & { poolAddress: `0x${string}` } // token: 'USDC' | 'USDT', chain: 'lisk'
  shares: bigint
  amountOnLiskDisplay: number
  bridgeFeeDisplay: number
  receiveOnDestDisplay: number
  dest: ChainSel
  user: `0x${string}`
}

function tokenLabelOnLisk(src: 'USDC' | 'USDT'): 'USDCe' | 'USDT0' {
  return src === 'USDC' ? 'USDCe' : 'USDT0'
}

const ICON = {
  mor: '/protocols/morpho-icon.png',
  bridge: lifilogo,
  USDC: '/tokens/usdc-icon.png',
  USDT: '/tokens/usdt-icon.png',
  USDCe: '/tokens/usdc-icon.png',
  USDT0: '/tokens/usdt0-icon.png',
} as const

const WITHDRAW_TYPES = {
  WithdrawIntent: [
    { name: 'user', type: 'address' },
    { name: 'amountShares', type: 'uint256' },
    { name: 'dstChainId', type: 'uint256' },
    { name: 'dstToken', type: 'address' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'refId', type: 'bytes32' },
  ],
} as const

function randomRefId(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex}` as `0x${string}`
}

function fmt(n: number, decimals = 6) {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(decimals)
  return s.replace(/\.?0+$/, '')
}

function opTxUrl(hash: `0x${string}`) {
  return `https://optimistic.etherscan.io/tx/${hash}`
}

/**
 * Safe Apps do not support chain switching in the embedded signer.
 * We must sign on OP only; if not on OP, show a clear error.
 */
async function ensureOnOptimism(walletClient: any) {
  const hex = (await walletClient.request({ method: 'eth_chainId' })) as string
  const chainId = Number.parseInt(hex, 16)
  if (chainId === optimism.id) return

  try {
    await walletClient.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${optimism.id.toString(16)}` }],
    })
  } catch {
    throw new Error('Please switch your wallet to OP Mainnet to continue.')
  }

  const hex2 = (await walletClient.request({ method: 'eth_chainId' })) as string
  const chainId2 = Number.parseInt(hex2, 16)
  if (chainId2 !== optimism.id) {
    throw new Error('Please switch your wallet to OP Mainnet to continue.')
  }
}

/** Matches the deposit modal so the ETA block never jumps when hint/title changes. */
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

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export const ReviewWithdrawModal: FC<Props> = ({
  open,
  onClose,
  snap,
  shares,
  amountOnLiskDisplay,
  bridgeFeeDisplay,
  receiveOnDestDisplay,
  dest,
  user,
}) => {
  const { data: walletClient } = useWalletClient()
  const { connect, connectors } = useConnect()

  function openConnect() {
    const safeConn = connectors.find((c) => c.id === 'safe')
    const injectedConn = connectors.find((c) => c.id === 'injected')
    const connector = safeConn ?? injectedConn ?? connectors[0]
    if (!connector) throw new Error('No wallet connectors available')
    connect({ connector })
  }

  const [step, setStep] = useState<FlowStep>('idle')
  const [err, setErr] = useState<string | null>(null)

  const [showSuccess, setShowSuccess] = useState(false)
  const [currentRefId, setCurrentRefId] = useState<`0x${string}` | null>(null)

  // UI state (ported from Standalone UI semantics)
  const [intentOk, setIntentOk] = useState(false)
  const [bridgeDone, setBridgeDone] = useState(false)
  const [bridgeTxHash, setBridgeTxHash] = useState<`0x${string}` | null>(null)

  useEffect(() => {
    if (!open) return
    setStep('idle')
    setErr(null)
    setShowSuccess(false)
    setCurrentRefId(null)
    setIntentOk(false)
    setBridgeDone(false)
    setBridgeTxHash(null)
  }, [open])

  const liskToken: 'USDCe' | 'USDT0' = tokenLabelOnLisk(snap.token as 'USDC' | 'USDT')
  const destSymbol: 'USDC' | 'USDT' = liskToken === 'USDT0' ? 'USDT' : 'USDC'

  const dstTokenAddr = useMemo(
    () =>
      destSymbol === 'USDT'
        ? (TokenAddresses.USDT.optimism as `0x${string}`)
        : (TokenAddresses.USDC.optimism as `0x${string}`),
    [destSymbol],
  )

  // Fee math (UI-only estimates)
  const grossAmount = amountOnLiskDisplay || 0
  const protocolFeePct = 0.005
  const protocolFeeAmount = grossAmount > 0 ? grossAmount * protocolFeePct : 0
  const bridgeFeeAmount = bridgeFeeDisplay || 0
  const netOnLisk = Math.max(grossAmount - protocolFeeAmount, 0)
  const netOnDest = Math.max(grossAmount - protocolFeeAmount - bridgeFeeAmount, 0)

  const isWorking = step === 'withdrawing' || step === 'bridging'
  const disabled = isWorking

  const reminderMinOutDisplay =
    receiveOnDestDisplay && receiveOnDestDisplay > 0 ? receiveOnDestDisplay : netOnDest

  const primaryLabel =
    !walletClient
      ? 'Connect wallet'
      : step === 'success'
      ? 'Done'
      : step === 'withdrawing'
      ? 'Withdrawing…'
      : step === 'bridging'
      ? 'Bridging…'
      : step === 'error'
      ? intentOk
        ? 'Retry bridge'
        : 'Try again'
      : 'Withdraw now'

  /* ------------------------------------------------------------------------ */
  /* Main confirm flow — using withdraw APIs                                  */
  /* ------------------------------------------------------------------------ */

  async function handleConfirm() {
    if (!walletClient) {
      openConnect()
      return
    }

    try {
      setErr(null)
      setIntentOk(false)
      setBridgeDone(false)
      setBridgeTxHash(null)
      setStep('withdrawing')

      if (snap.chain !== 'lisk') {
        throw new Error('Withdrawals are only supported from Lisk vaults.')
      }

      // OP-only signing (Safe compatible)
      await ensureOnOptimism(walletClient)

      const nowMs = Date.now()
      const nowSec = Math.floor(nowMs / 1000)
      const deadlineSec = nowSec + 60 * 60 // 1h
      const nonceStr = String(nowMs)

      // Conservative minAmountOut (dest token units, 6 decimals)
      const conservativeDisplay = reminderMinOutDisplay * 0.98
      const minAmountOutBn = parseUnits(conservativeDisplay.toFixed(6), 6)

      const amountSharesStr = shares.toString()
      const dstChainIdNum = optimism.id
      const deadlineStr = String(deadlineSec)
      const minAmountOutStr = minAmountOutBn.toString()
      const refId = currentRefId ?? randomRefId()

      const domain = {
        name: 'SuperYLDR',
        version: '1',
        chainId: optimism.id,
      } as const

      const message = {
        user,
        amountShares: BigInt(amountSharesStr),
        dstChainId: BigInt(dstChainIdNum),
        dstToken: dstTokenAddr,
        minAmountOut: minAmountOutBn,
        deadline: BigInt(deadlineStr),
        nonce: BigInt(nonceStr),
        refId,
      } as const

      const signature = await walletClient.signTypedData({
        account: user,
        domain,
        types: WITHDRAW_TYPES,
        primaryType: 'WithdrawIntent',
        message,
      })

      // Create intent on backend (idempotent)
      const createRes = await fetch('/api/withdraw/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: {
            user,
            amountShares: amountSharesStr,
            dstChainId: dstChainIdNum,
            dstToken: dstTokenAddr,
            minAmountOut: minAmountOutStr,
            deadline: deadlineStr,
            nonce: nonceStr,
            refId,
            signedChainId: optimism.id,
          },
          signature,
        }),
      })

      const createJson = await createRes.json().catch(() => null)
      if (!createRes.ok || !createJson?.ok) {
        throw new Error(createJson?.error || 'Failed to create withdraw intent')
      }

      const finalRefId = (createJson.refId as `0x${string}` | undefined) ?? refId
      setCurrentRefId(finalRefId)
      setIntentOk(true)

      // Burn → redeem → bridge (idempotent)
      setStep('bridging')

      const finishRes = await fetch('/api/withdraw/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: finalRefId }),
      })

      const finishJson = await finishRes.json().catch(() => null)
      if (!finishRes.ok || !finishJson?.ok) {
        throw new Error(finishJson?.error || 'Failed to finalize withdrawal & bridge')
      }

      // If backend returns a tx hash, capture for explorer link (optional)
      const maybeHash =
        (finishJson?.txHash as `0x${string}` | undefined) ??
        (finishJson?.fromTxHash as `0x${string}` | undefined) ??
        null
      if (maybeHash) setBridgeTxHash(maybeHash)

      setBridgeDone(true)
      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      console.error('[withdraw modal] handleConfirm failed:', e)
      const code = e?.code ?? e?.error?.code
      if (code === 4001) setErr('Signature was cancelled.')
      else setErr(e?.message ?? String(e))
      setStep('error')
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Retry: finish only (idempotent)                                           */
  /* ------------------------------------------------------------------------ */

  async function retryFinishOnly() {
    if (!walletClient) {
      openConnect()
      return
    }
    if (!currentRefId) {
      await handleConfirm()
      return
    }

    try {
      setErr(null)
      setBridgeDone(false)
      setBridgeTxHash(null)
      setStep('bridging')

      const finishRes = await fetch('/api/withdraw/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: currentRefId }),
      })

      const finishJson = await finishRes.json().catch(() => null)
      if (!finishRes.ok || !finishJson?.ok) {
        throw new Error(finishJson?.error || 'Failed to finalize withdrawal & bridge')
      }

      const maybeHash =
        (finishJson?.txHash as `0x${string}` | undefined) ??
        (finishJson?.fromTxHash as `0x${string}` | undefined) ??
        null
      if (maybeHash) setBridgeTxHash(maybeHash)

      setBridgeDone(true)
      setStep('success')
      setShowSuccess(true)
    } catch (e: any) {
      console.error('[withdraw modal] retryFinishOnly failed:', e)
      const code = e?.code ?? e?.error?.code
      if (code === 4001) setErr('Signature was cancelled. You can try again.')
      else setErr(e?.message ?? String(e))
      setStep('error')
    }
  }

  function onPrimary() {
    if (!walletClient) {
      openConnect()
      return
    }

    if (step === 'success') {
      setShowSuccess(true)
      return
    }

    if (step === 'error') {
      if (intentOk && currentRefId) void retryFinishOnly()
      else void handleConfirm()
      return
    }

    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  const destChainLabel = 'OP Mainnet'
  const finalTokenOnDest = destSymbol
  const finalNetAmount = netOnDest

  const isSigErr = !!err && err.toLowerCase().includes('signature')

  // Sub-step visuals (Standalone-style)
  const withdrawStepActive = step === 'withdrawing'
  const withdrawStepDone = intentOk || step === 'bridging' || step === 'success'
  const withdrawStepError = step === 'error' && !intentOk

  const bridgeStepActive = step === 'bridging'
  const bridgeStepDone = bridgeDone || step === 'success'
  const bridgeStepError = step === 'error' && intentOk && !bridgeDone

  const stepHint = (() => {
    if (step === 'withdrawing') {
      return 'Please confirm the withdrawal signature in your wallet. The relayer will then burn your shares and redeem on Lisk.'
    }
    if (step === 'bridging') {
      return 'Bridge in progress (relayer). Final arrival time depends on network congestion.'
    }
    if (step === 'success') return 'Withdrawal complete. Your balances should update shortly.'
    if (step === 'error') return 'Something went wrong. Check the steps above and retry.'
    return 'Review the details and confirm your withdrawal.'
  })()

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              {step === 'error' ? 'Withdrawal failed' : "You're withdrawing"}
            </h3>
            <button onClick={onClose} className="cursor-pointer p-2 hover:bg-muted rounded-full">
              <X size={20} />
            </button>
          </div>

          <div className="px-5 space-y-0">{stepHint && <StepHintRow hint={stepHint} />}</div>

          <div className="px-5 py-5 space-y-0">
            {/* Step 1: Withdraw from Vault */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={ICON.mor} alt="Morpho" width={40} height={40} className="rounded-[6px]" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Withdrawing from Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
            </div>

            {/* Sub-step: Withdrawal signature / intent creation */}
            {(step === 'withdrawing' || step === 'bridging' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {withdrawStepError ? (
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : withdrawStepDone ? (
                      <div className="bg-[#E7F8F0] rounded-full p-1">
                        <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : withdrawStepActive ? (
                      <div className="bg-[#EBF1FF] rounded-full p-1">
                        <Image src={InfoIconModal} alt="" className="w-4 h-4" />
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
                    {withdrawStepError
                      ? isSigErr
                        ? 'Signature required'
                        : 'Withdrawal intent failed'
                      : withdrawStepDone
                      ? 'Withdrawal intent signed'
                      : 'Sign withdrawal intent…'}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Amount on Lisk (before fees) */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={ICON[liskToken]} alt={liskToken} width={40} height={40} className="rounded-full" />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} className="rounded-sm" />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{fmt(amountOnLiskDisplay, 6)}</div>
                <div className="text-xs text-muted-foreground">
                  ${Number(amountOnLiskDisplay || 0).toFixed(2)} • {liskToken} on Lisk (before fees)
                </div>
              </div>
            </div>

            {/* Step 3: Bridging via LI.FI */}
            <div className="flex items-start gap-3 pb-5 relative">
              <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
              <div className="relative mt-0.5 shrink-0">
                <Image src={lifilogo.src} alt="LI.FI" width={40} height={40} className="rounded-full" />
              </div>
              <div className="flex-1 space-y-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-lg font-semibold">Bridging via LI.FI</div>
                    <div className="text-xs text-muted-foreground">
                      Bridge Fee (est.): {fmt(bridgeFeeAmount, 6)} {destSymbol}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-step: Relayer bridge status */}
            {(intentOk || step === 'bridging' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {bridgeStepError ? (
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : bridgeStepDone ? (
                      <div className="bg-[#E7F8F0] rounded-full p-1">
                        <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : bridgeStepActive ? (
                      <div className="bg-[#EBF1FF] rounded-full p-1">
                        <Image src={InfoIconModal} alt="" className="w-4 h-4" />
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
                      {bridgeStepError
                        ? 'Bridge failed'
                        : bridgeStepDone
                        ? 'Bridge transaction confirmed'
                        : bridgeStepActive
                        ? 'Bridging…'
                        : 'Waiting to bridge…'}
                    </div>

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

            {/* Step 4: Final Destination */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 shrink-0">
                <Image
                  src={ICON[finalTokenOnDest]}
                  alt={finalTokenOnDest}
                  width={40}
                  height={40}
                  className="rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image src="/networks/op-icon.png" alt={destChainLabel} width={16} height={16} className="rounded-sm" />
                </div>
              </div>

              <div className="flex-1">
                <div className="text-2xl font-bold">{fmt(finalNetAmount, 6)}</div>
                <div className="text-xs text-muted-foreground">
                  ${Number(finalNetAmount || 0).toFixed(2)} • {finalTokenOnDest} on {destChainLabel}
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                  <div>• 0.5% vault withdraw fee (~{fmt(protocolFeeAmount, 6)} {liskToken})</div>
                  <div>• Bridge fee (est.) ~{fmt(bridgeFeeAmount, 6)} {destSymbol}</div>
                </div>
              </div>
            </div>

            {err && <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3 mt-2">{err}</div>}
          </div>

          {/* Action button */}
          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-10 text-white bg-blue-600 hover:bg-blue-700 font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
              disabled={disabled}
            >
              {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>{primaryLabel}</span>
            </Button>
          </div>
        </div>
      </div>

      {showSuccess && (
        <WithdrawSuccessModal
          liskAmount={netOnLisk}
          liskToken={liskToken}
          destAmount={netOnDest}
          destToken={destSymbol}
          destChain={dest}
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
