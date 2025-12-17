'use client'

import { FC, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, ExternalLink, Loader2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { withdrawMorphoOnLisk } from '@/lib/withdrawer'
import { bridgeWithdrawal } from '@/lib/bridge'
import { publicLisk } from '@/lib/clients'
import { erc20Abi } from 'viem'
import { CHAINS, switchOrAddChain } from '@/lib/wallet'
import lifilogo from '@/public/lifi.png'
import InfoIconModal from '../../../public/info-icon-modal.svg'
import CheckIconModal from '../../../public/check-icon-modal.svg'
import AlertIconModal from '../../../public/alert-icon-modal.svg'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type FlowStep = 'idle' | 'withdrawing' | 'sign-bridge' | 'bridging' | 'success' | 'error'

interface WithdrawSuccessData {
  liskAmount: number
  liskToken: 'USDCe' | 'USDT0' | 'WETH'
  destAmount?: number
  destToken?: 'USDC' | 'USDT' | 'WETH'
  destChain?: 'optimism' | 'base' | 'lisk'
  vault: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: (data: WithdrawSuccessData) => void
  snap: Pick<YieldSnapshot, 'token' | 'chain'> & { poolAddress: `0x${string}` }
  shares: bigint
  amountOnLiskDisplay: number
  bridgeFeeDisplay: number
  receiveOnDestDisplay: number
  dest: 'optimism'
  user: `0x${string}`
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} (>${ms}ms)`)), ms)),
  ])
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
  WETH: '/tokens/weth.png',
} as const

async function readLiskBalance(token: `0x${string}`, user: `0x${string}`): Promise<bigint> {
  try {
    return (await publicLisk.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint
  } catch {
    return 0n
  }
}

function opTxUrl(hash: `0x${string}`) {
  return `https://blockscout.lisk.com/tx/${hash}`
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
  onSuccess,
  snap,
  shares,
  amountOnLiskDisplay,
  bridgeFeeDisplay,
  dest,
  user,
}) => {
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient()

  const [step, setStep] = useState<FlowStep>('idle')
  const [err, setErr] = useState<string | null>(null)

  const [withdrawOk, setWithdrawOk] = useState(false)
  const [bridgableAmount, setBridgableAmount] = useState<bigint | null>(null)

  // Bridge UI state (separate submitted vs done)
  const [bridgeSubmitted, setBridgeSubmitted] = useState(false)
  const [bridgeDone, setBridgeDone] = useState(false)
  const [bridgeTxHash, setBridgeTxHash] = useState<`0x${string}` | null>(null)

  const liskToken: 'USDCe' | 'USDT0' = tokenLabelOnLisk(snap.token as 'USDC' | 'USDT')
  const destSymbol: 'USDC' | 'USDT' = liskToken === 'USDT0' ? 'USDT' : 'USDC'

  const liskTokenAddr = useMemo(
    () =>
      liskToken === 'USDCe'
        ? (TokenAddresses.USDCe.lisk as Address)
        : (TokenAddresses.USDT0.lisk as Address),
    [liskToken],
  )

  // Fee math
  const grossAmount = amountOnLiskDisplay || 0
  const protocolFeePct = 0.005
  const protocolFeeAmount = grossAmount > 0 ? grossAmount * protocolFeePct : 0
  const bridgeFeeAmount = bridgeFeeDisplay || 0
  const netOnLisk = Math.max(grossAmount - protocolFeeAmount, 0)
  const netOnDest = Math.max(grossAmount - protocolFeeAmount - bridgeFeeAmount, 0)

  /* ------------------------------------------------------------------------ */
  /* Main Flow                                                                */
  /* ------------------------------------------------------------------------ */

  async function ensureLiskClient() {
    if (!walletClient) throw new Error('Wallet not connected')

    await withTimeout(
      switchOrAddChain(walletClient, CHAINS.lisk),
      20_000,
      'Chain switch to Lisk timed out',
    )

    for (let i = 0; i < 10; i++) {
      const { data } = await withTimeout(refetchWalletClient(), 10_000, 'Refetch wallet client timed out')
      const wc = data ?? walletClient
      if (wc.chain?.id === CHAINS.lisk.id) return wc
      await new Promise((r) => setTimeout(r, 400))
    }

    throw new Error('Wallet did not switch to Lisk (chain id not updated)')
  }

  function resetBridgeUi() {
    setBridgeSubmitted(false)
    setBridgeDone(false)
    setBridgeTxHash(null)
  }

  async function handleConfirm() {
    if (!walletClient) throw new Error('Wallet not connected')

    setStep('withdrawing')
    resetBridgeUi()

    try {
      setErr(null)
      setWithdrawOk(false)
      setBridgableAmount(null)

      const wc = await ensureLiskClient()

      const pre = (await withTimeout(
        publicLisk.readContract({
          address: liskTokenAddr,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [user],
        }) as Promise<bigint>,
        15_000,
        'Pre-balance read timed out',
      )) as bigint

      await withTimeout(
        withdrawMorphoOnLisk({
          token: liskToken,
          shares,
          shareToken: snap.poolAddress,
          underlying: liskTokenAddr as `0x${string}`,
          to: user,
          wallet: wc,
        }),
        120_000,
        'Withdraw signing/submit timed out',
      )

      let delta = 0n
      for (let i = 0; i < 40; i++) {
        const cur = await publicLisk.readContract({
          address: liskTokenAddr,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [user],
        })
        if (cur > pre) {
          delta = cur - pre
          break
        }
        await new Promise((r) => setTimeout(r, 1500))
      }

      if (delta <= 0n) throw new Error('Withdrawal did not arrive on Lisk')

      setWithdrawOk(true)
      setBridgableAmount(delta)

      // Signature prompt first
      setStep('sign-bridge')

      await withTimeout(
        bridgeWithdrawal({
          srcVaultToken: liskToken,
          destToken: destSymbol,
          amount: delta,
          to: 'optimism',
          walletClient: wc,
          opts: {
            onUpdate: (u: any) => {
              const stage = String(u?.stage ?? '').toLowerCase()
              const hash = u?.txHash as `0x${string}` | undefined

              if (hash) setBridgeTxHash(hash)

              // Flip the button & substep copy as soon as submitted (or when hash appears)
              if (stage === 'submitted' || stage === 'confirming' || stage === 'completed' || hash) {
                setBridgeSubmitted(true)
                setStep('bridging')
              }
            },
          },
        }),
        180_000,
        'Bridge signing/submit timed out',
      )

      // Bridge completion only after executeRoute resolves
      setBridgeDone(true)

      await switchOrAddChain(wc, CHAINS.optimism)

      setStep('success')
      onSuccess({
        liskAmount: netOnLisk,
        liskToken,
        destAmount: netOnDest,
        destToken: destSymbol,
        destChain: dest,
        vault: `Re7 ${snap.token} Vault (Morpho Blue)`,
      })
      onClose()
    } catch (e: any) {
      console.error('WITHDRAW FLOW FAILED:', e)
      const code = e?.code ?? e?.error?.code
      if (code === 4001) {
        setErr('Signature was cancelled.')
      } else {
        setErr(e?.message ?? String(e))
      }
      setStep('error')
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Bridge Retry                                                             */
  /* ------------------------------------------------------------------------ */

  async function resumeBridgeOnly() {
    if (!walletClient) return

    resetBridgeUi()

    try {
      setErr(null)

      let amount = bridgableAmount
      if (!amount || amount <= 0n) {
        amount = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
      }
      if (!amount || amount <= 0n) throw new Error('No funds available on Lisk to bridge')

      setStep('sign-bridge')

      await bridgeWithdrawal({
        srcVaultToken: liskToken,
        destToken: destSymbol,
        amount,
        to: 'optimism',
        walletClient,
        opts: {
          onUpdate: (u: any) => {
            const stage = String(u?.stage ?? '').toLowerCase()
            const hash = u?.txHash as `0x${string}` | undefined

            if (hash) setBridgeTxHash(hash)

            if (stage === 'submitted' || stage === 'confirming' || stage === 'completed' || hash) {
              setBridgeSubmitted(true)
              setStep('bridging')
            }
          },
        },
      })

      setBridgeDone(true)

      await switchOrAddChain(walletClient, CHAINS.optimism)
      setStep('success')
    } catch (e: any) {
      const code = e?.code ?? e?.error?.code
      if (code === 4001) {
        setErr('Signature was cancelled. You can try again.')
        setStep('error')
        return
      }
      setErr(e?.message ?? String(e))
      setStep('error')
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Button Handler                                                           */
  /* ------------------------------------------------------------------------ */

  function onPrimary() {
    if (step === 'success') return

    if (step === 'error') {
      if (withdrawOk) void resumeBridgeOnly()
      else void handleConfirm()
      return
    }

    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  const isWorking = step === 'withdrawing' || step === 'sign-bridge' || step === 'bridging'
  const disabled = !walletClient || isWorking

  const destChainLabel = 'OP Mainnet'
  const finalTokenOnDest = destSymbol
  const finalNetAmount = netOnDest

  // Withdrawal sub-step visuals
  const withdrawStepError = step === 'error' && !withdrawOk
  const withdrawStepActive = step === 'withdrawing'

  // Bridge sub-step visuals
  const bridgeStepActive = step === 'sign-bridge' || step === 'bridging'
  const bridgeStepDone = bridgeDone || step === 'success'
  const bridgeStepError = step === 'error' && withdrawOk && !bridgeDone
  const isSigErr = !!err && err.toLowerCase().includes('signature')

  // Button label
  const primaryLabel =
    step === 'success'
      ? 'Done'
      : step === 'withdrawing'
        ? 'Withdrawing…'
        : step === 'sign-bridge'
          ? bridgeSubmitted
            ? 'Bridging…'
            : 'Sign bridge transaction…'
          : step === 'bridging'
            ? 'Bridging…'
            : step === 'error' && withdrawOk
              ? 'Try bridge again'
              : step === 'error'
                ? 'Try again'
                : 'Withdraw now'

  // Step hint
  const stepHint = (() => {
    if (step === 'withdrawing') return 'Withdrawing from the vault on Lisk. This usually takes under a minute.'
    if (step === 'sign-bridge') {
      return bridgeSubmitted
        ? 'Bridge submitted. Waiting for funds to arrive on OP…'
        : 'Please confirm the bridge transaction in your wallet.'
    }
    if (step === 'bridging') return 'Bridge in progress. Final arrival time depends on network congestion.'
    if (step === 'success') return 'Withdrawal complete. Your balances should update shortly.'
    if (step === 'error') return 'Something went wrong. Check the steps above and retry.'
    return 'Review the details and confirm your withdrawal.'
  })()

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}
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

          <div className="px-5 space-y-0">
            {stepHint && <StepHintRow hint={stepHint} />}
          </div>

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

            {/* Sub-step: Withdrawal status */}
            {(step === 'withdrawing' || step === 'success' || step === 'error') && (
              <div className="flex items-start gap-3 pb-5 relative">
                <div className="absolute left-5 top-10 bottom-0 w-px bg-border" aria-hidden="true" />
                <div className="relative mt-0.5 shrink-0">
                  <div className="flex h-10 w-10 items-center justify-center">
                    {withdrawStepError ? (
                      <div className="bg-[#FEECEB] rounded-full p-1">
                        <Image src={AlertIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : withdrawOk ? (
                      <div className="bg-[#E7F8F0] rounded-full p-1">
                        <Image src={CheckIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : withdrawStepActive ? (
                      <div className="bg-[#EBF1FF] rounded-full p-1">
                        <Image src={InfoIconModal} alt="" className="w-4 h-4" />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex-1 mt-3">
                  <div className="text-xs">
                    {withdrawStepError ? 'Withdrawal failed' : withdrawOk ? 'Withdrawal complete' : 'Withdrawing from vault…'}
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
                <div className="text-2xl font-bold">{amountOnLiskDisplay}</div>
                <div className="text-xs text-muted-foreground">
                  ${amountOnLiskDisplay.toFixed(2)} • {liskToken} on Lisk (before fees)
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
                      Bridge Fee (est.): {bridgeFeeAmount.toFixed(6)} {destSymbol}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sub-step: Bridge transaction status */}
            {(bridgeStepActive || bridgeStepDone || bridgeStepError) && (
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
                        ? (isSigErr ? 'Signature required' : 'Bridge failed')
                        : bridgeStepDone
                          ? 'Bridge transaction confirmed'
                          : bridgeSubmitted
                            ? 'Bridging…'
                            : 'Sign bridge transaction…'}
                    </div>

                    {/* Explorer link ONLY on bridge completion */}
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
                <Image src={ICON[finalTokenOnDest]} alt={finalTokenOnDest} width={40} height={40} className="rounded-full" />
                <div className="absolute -bottom-0.5 -right-3 rounded-sm border-2 border-background">
                  <Image src="/networks/op-icon.png" alt={destChainLabel} width={16} height={16} className="rounded-sm" />
                </div>
              </div>

              <div className="flex-1">
                <div className="text-2xl font-bold">{finalNetAmount}</div>
                <div className="text-xs text-muted-foreground">
                  ${finalNetAmount.toFixed(2)} • {finalTokenOnDest} on {destChainLabel}
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                  <div>• 0.5% vault withdraw fee (~{protocolFeeAmount.toFixed(6)} {liskToken})</div>
                  <div>• Bridge fee (est.) ~{bridgeFeeAmount.toFixed(6)} {destSymbol}</div>
                </div>
              </div>
            </div>

            {err && (
              <div className="rounded-lg bg-red-50 text-red-700 text-xs p-3 mt-2">
                {err}
              </div>
            )}
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
    </div>
  )
}
