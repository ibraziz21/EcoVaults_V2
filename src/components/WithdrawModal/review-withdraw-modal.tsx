// src/components/WithdrawModal/review-withdraw-modal.tsx
'use client'

import { FC, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletClient } from 'wagmi'
import { useAppKit } from '@reown/appkit/react'
import { parseUnits } from 'viem'
import { optimism } from 'viem/chains'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import lifi from '@/public/logo_lifi_light_vertical.png'
import { WithdrawSuccessModal } from './withdraw-success-modal'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ChainSel = 'optimism'

type FlowStep =
  | 'idle'
  | 'withdrawing' // signing + server-side burn/redeem
  | 'bridging' // server-side Li.Fi bridge in flight
  | 'success'
  | 'error'

interface Props {
  open: boolean
  onClose: () => void
  snap: Pick<YieldSnapshot, 'token' | 'chain'> & { poolAddress: `0x${string}` } // token: 'USDC' | 'USDT', chain: 'lisk'
  shares: bigint
  // amount user typed (approximate pre-fee amount on Lisk, in token units)
  amountOnLiskDisplay: number
  // estimated bridge fee in dest token units
  bridgeFeeDisplay: number
  // estimated amount on dest (we now use this as a floor for minAmountOut)
  receiveOnDestDisplay: number
  dest: ChainSel
  user: `0x${string}`
}

function tokenLabelOnLisk(src: 'USDC' | 'USDT'): 'USDCe' | 'USDT0' {
  return src === 'USDC' ? 'USDCe' : 'USDT0'
}

const ICON = {
  mor: '/protocols/morpho-icon.png',
  bridge: lifi,
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
  // trim trailing zeros
  return s.replace(/\.?0+$/, '')
}

/**
 * Safe Apps do not support chain switching in the embedded signer.
 * We must sign on OP only; if not on OP, show a clear error.
 */
async function ensureOnOptimism(walletClient: any) {
  // Prefer eth_chainId (works even if walletClient.chain is undefined)
  const hex = (await walletClient.request({ method: 'eth_chainId' })) as string
  const chainId = Number.parseInt(hex, 16)
  if (chainId === optimism.id) return

  // Outside Safe, switching might work; try once, otherwise fail clearly.
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
  const { open: openConnect } = useAppKit()

  const [step, setStep] = useState<FlowStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [currentRefId, setCurrentRefId] = useState<`0x${string}` | null>(null)

  // Reset modal state when (re)opened
  useEffect(() => {
    if (!open) return
    setStep('idle')
    setErr(null)
    setShowSuccess(false)
    setCurrentRefId(null)
  }, [open])

  const liskToken: 'USDCe' | 'USDT0' = tokenLabelOnLisk(
    snap.token as 'USDC' | 'USDT',
  )
  const destSymbol: 'USDC' | 'USDT' = liskToken === 'USDT0' ? 'USDT' : 'USDC'

  const dstTokenAddr = useMemo(
    () =>
      destSymbol === 'USDT'
        ? (TokenAddresses.USDT.optimism as `0x${string}`)
        : (TokenAddresses.USDC.optimism as `0x${string}`),
    [destSymbol],
  )

  // ----- Fee math (UI-only, estimates) ---------------------------------------
  const grossAmount = amountOnLiskDisplay || 0
  const protocolFeePct = 0.005 // 0.5% vault withdraw fee (UI-only estimate)
  const protocolFeeAmount = grossAmount > 0 ? grossAmount * protocolFeePct : 0
  const bridgeFeeAmount = bridgeFeeDisplay || 0

  const netOnLisk = Math.max(grossAmount - protocolFeeAmount, 0)
  const netOnDest = Math.max(grossAmount - protocolFeeAmount - bridgeFeeAmount, 0)

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
      ? 'Try again'
      : 'Withdraw now'

  const isWorking = step === 'withdrawing' || step === 'bridging'
  const disabled = isWorking

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
      const baseMinOutDisplay =
        receiveOnDestDisplay && receiveOnDestDisplay > 0
          ? receiveOnDestDisplay
          : netOnDest

      const conservativeDisplay = baseMinOutDisplay * 0.98
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

      // 3) Create intent on backend (idempotent)
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

      // 4) Ask backend to burn → redeem → bridge (idempotent)
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
  /* Retry: simply re-run finish (idempotent)                                  */
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
      if (currentRefId) void retryFinishOnly()
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

  const stepHint = (() => {
    if (step === 'withdrawing') {
      return 'Signing your withdrawal intent, then the relayer burns your shares and redeems on Lisk.'
    }
    if (step === 'bridging') {
      return 'Bridge in progress (relayer). Final arrival time depends on network congestion.'
    }
    if (step === 'success') {
      return 'Withdrawal complete. Your balances should update shortly.'
    }
    if (step === 'error') {
      return err || 'Something went wrong. Check the error and retry.'
    }
    return 'Review the details and confirm your withdrawal.'
  })()

  const showBridgeBlock = true
  const showBridgeStep2 =
    step === 'withdrawing' || step === 'bridging' || step === 'success' || step === 'error'

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-md my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${
            open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
        >
          {/* header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-lg font-semibold">
              {step === 'error' ? 'Review withdrawal – Error' : 'Review withdrawal'}
            </h3>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-full">
              <X size={20} />
            </button>
          </div>

          {/* body */}
          <div className="px-5 py-4 space-y-5">
            {/* row 1: withdrawing from vault */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image src={ICON.mor} alt="Morpho" width={28} height={28} className="rounded-lg" />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Withdrawing from Vault</div>
                <div className="text-xs text-muted-foreground">Re7 {snap.token} Vault (Morpho Blue)</div>
              </div>
            </div>

            {/* error indicator */}
            {step === 'error' && (
              <div className="flex items-center gap-2 text-xs text-red-600 ml-11">
                <AlertCircle className="h-4 w-4" />
                <span>{err || 'Withdrawal failed'}</span>
              </div>
            )}

            {/* row 2: amount on Lisk (pre-fee estimate) */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={ICON[liskToken]}
                  alt={liskToken}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                  <Image src="/networks/lisk.png" alt="Lisk" width={16} height={16} className="rounded-sm" />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{fmt(amountOnLiskDisplay, 6)}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${amountOnLiskDisplay.toFixed(2)} • {liskToken} on Lisk (before fees)
                </div>
              </div>
            </div>

            {/* row 3: bridging via LI.FI (relayer-only) */}
            {showBridgeBlock && (
              <div className="flex items-start gap-3">
                <div className="relative mt-0.5">
                  <Image src={ICON.bridge} alt="LI.FI" width={28} height={28} className="rounded-full" />
                </div>

                <div className="flex-1">
                  <div className="text-lg font-semibold">Bridging via LI.FI</div>
                  <div className="text-xs text-muted-foreground">
                    Bridge happens via the relayer. No extra signatures needed.
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Bridge fee (est.): {fmt(bridgeFeeAmount, 6)} {destSymbol}
                  </div>

                  <div className="mt-2 space-y-2 text-xs">
                    {/* Step 1 */}
                    <div className="flex items-center gap-2">
                      {step === 'bridging' || step === 'success' ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : step === 'withdrawing' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      ) : step === 'error' ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                      )}
                      <span>Burn & redeem vault shares</span>
                    </div>

                    {/* Step 2 */}
                    {showBridgeStep2 && (
                      <div className="flex items-center gap-2">
                        {step === 'bridging' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        ) : step === 'success' ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : step === 'error' ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                        )}
                        <span>{step === 'error' ? 'Bridge or redeem may have failed' : 'Bridge to OP Mainnet'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {(step === 'bridging' || step === 'success') && (
                  <a
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            )}

            {/* row 4: final destination amount + fee breakdown */}
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5">
                <Image
                  src={ICON[finalTokenOnDest]}
                  alt={finalTokenOnDest}
                  width={28}
                  height={28}
                  className="rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                  <Image src="/networks/op-icon.png" alt={destChainLabel} width={16} height={16} className="rounded-sm" />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{fmt(finalNetAmount, 6)}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${finalNetAmount.toFixed(2)} • {finalTokenOnDest} on {destChainLabel}
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                  <div>
                    • 0.5% vault withdraw fee (~{fmt(protocolFeeAmount, 6)} {liskToken})
                  </div>
                  <div>
                    • Bridge fee (est.) ~{fmt(bridgeFeeAmount, 6)} {destSymbol}
                  </div>
                </div>
              </div>
            </div>

            {stepHint && <div className="text-xs text-muted-foreground">{stepHint}</div>}
          </div>

          {/* footer */}
          <div className="px-5 pb-5">
            <Button
              onClick={onPrimary}
              className="w-full h-12 text-base bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
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
