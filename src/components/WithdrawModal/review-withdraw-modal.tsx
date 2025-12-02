// src/components/WithdrawModal/review-withdraw-modal.tsx
'use client'

import { FC, useCallback, useMemo, useState } from 'react'
import Image from 'next/image'
import { X, Check, ExternalLink, AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWalletClient } from 'wagmi'
import type { Address } from 'viem'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { withdrawMorphoOnLisk } from '@/lib/withdrawer'
import { bridgeWithdrawal } from '@/lib/bridge'
import { publicLisk } from '@/lib/clients'
import { erc20Abi } from 'viem'
import { CHAINS } from '@/lib/wallet'
import { switchOrAddChain } from '@/lib/wallet'
import lifi from '@/public/logo_lifi_light_vertical.png'
import { WithdrawSuccessModal } from './withdraw-success-modal'

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ChainSel = 'optimism'

type FlowStep =
  | 'idle'
  | 'withdrawing'   // withdrawing from vault on Lisk
  | 'sign-bridge'   // user should sign bridge tx
  | 'bridging'      // bridge in flight
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
  // (old prop – now superseded by internal net calculation, but kept for compatibility)
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

async function readLiskBalance(
  token: `0x${string}`,
  user: `0x${string}`,
): Promise<bigint> {
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
  receiveOnDestDisplay, // not used in new math, kept for compat
  dest,
  user,
}) => {
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient()

  const [step, setStep] = useState<FlowStep>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  // remember whether withdraw succeeded, and how much to bridge
  const [withdrawOk, setWithdrawOk] = useState(false)
  const [bridgableAmount, setBridgableAmount] = useState<bigint | null>(null)

  const liskToken: 'USDCe' | 'USDT0' = tokenLabelOnLisk(
    snap.token as 'USDC' | 'USDT',
  )
  const destSymbol: 'USDC' | 'USDT' = liskToken === 'USDT0' ? 'USDT' : 'USDC'

  const liskTokenAddr = useMemo(
    () =>
      liskToken === 'USDCe'
        ? (TokenAddresses.USDCe.lisk as Address)
        : (TokenAddresses.USDT0.lisk as Address),
    [liskToken],
  )

  // ----- Fee math (UI-only, estimates) ---------------------------------------
  const grossAmount = amountOnLiskDisplay || 0
  const protocolFeePct = 0.005 // 0.5% vault withdraw fee
  const protocolFeeAmount = grossAmount > 0 ? grossAmount * protocolFeePct : 0
  const bridgeFeeAmount = bridgeFeeDisplay || 0

  // Net amounts (approximate)
  const netOnLisk = Math.max(grossAmount - protocolFeeAmount, 0)
  const netOnDest = Math.max(grossAmount - protocolFeeAmount - bridgeFeeAmount, 0)

  // Visual helpers (for step rows)
  const trigger1Done =
    withdrawOk ||
    step === 'sign-bridge' ||
    step === 'bridging' ||
    step === 'success'

  const trigger2InError = step === 'error' && err?.toLowerCase().includes('signature')
  const trigger3InError = step === 'error' && !trigger2InError && withdrawOk

  const primaryLabel =
    step === 'success'
      ? 'Done'
      : step === 'withdrawing'
      ? 'Withdrawing…'
      : step === 'sign-bridge'
      ? 'Sign bridge transaction…'
      : step === 'bridging'
      ? 'Bridging…'
      : step === 'error' && withdrawOk
      ? 'Try bridge again'
      : step === 'error'
      ? 'Try again'
      : 'Withdraw now'

  /* ------------------------------------------------------------------------ */
  /* Flow pieces                                                              */
  /* ------------------------------------------------------------------------ */

  async function performWithdraw(): Promise<bigint> {
    if (!walletClient) throw new Error('Wallet not connected')
  
    // 1) switch to Lisk
    await switchOrAddChain(walletClient, CHAINS.lisk)
  
    // 2) IMPORTANT: refetch the walletClient because provider changed!
    const { data: freshClient } = await refetchWalletClient()
    const wc = freshClient ?? walletClient
  
    // measure delta
    const pre = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
  
    await withdrawMorphoOnLisk({
      token: liskToken,
      shares,
      shareToken: snap.poolAddress,
      underlying: liskTokenAddr as `0x${string}`,
      to: user,
      wallet: wc,        // 👈 corrected wallet instance
    })
  
    // poll for arrival
    let tries = 0
    while (tries++ < 40) {
      const cur = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
      if (cur > pre) return cur - pre
      await new Promise((r) => setTimeout(r, 1500))
    }
  
    const cur = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
    if (cur <= pre) throw new Error('Withdrawal did not arrive on Lisk')
    return cur - pre
  }
  

  async function performBridge(amount: bigint) {
    if (!walletClient) throw new Error('Wallet not connected')

    setStep('sign-bridge')
    await new Promise((r) => setTimeout(r, 80)) // small UX pause
    setStep('bridging')

    const toChain ='optimism'

    await bridgeWithdrawal({
      srcVaultToken: liskToken, // 'USDCe' | 'USDT0'
      destToken: destSymbol, // 'USDC' | 'USDT'
      amount,
      to: toChain,
      walletClient,
    })

    // Switch user back to OP when done
    await switchOrAddChain(walletClient, CHAINS.optimism)

    setStep('success')
    setShowSuccess(true)
  }

  /* ------------------------------------------------------------------------ */
  /* Main confirm flow – SINGLE click like Deposit                            */
  /* ------------------------------------------------------------------------ */

  async function handleConfirm() {
    if (!walletClient) throw new Error("Wallet not connected");
    setStep('withdrawing') 
    try {
      setErr(null);
      setWithdrawOk(false);
      setBridgableAmount(null);
   
  
      /* ------------------------------------------------------------- */
      /* 1) SWITCH TO LISK                                              */
      /* ------------------------------------------------------------- */
  
      await switchOrAddChain(walletClient, CHAINS.lisk);
  
      // After chain switch, get a fresh wallet client
      const { data: freshClient } = await refetchWalletClient();
      const wc = freshClient ?? walletClient;
  
      /* ------------------------------------------------------------- */
      /* 2) PERFORM WITHDRAW                                            */
      /* ------------------------------------------------------------- */
  
      const pre = await publicLisk.readContract({
        address: liskTokenAddr,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [user],
      });
  
      await withdrawMorphoOnLisk({
        token: liskToken,
        shares,
        shareToken: snap.poolAddress,
        underlying: liskTokenAddr as `0x${string}`,
        to: user,
        wallet: wc,
      });
  
      // Poll until balance increases
      let delta = 0n;
      for (let i = 0; i < 40; i++) {
        const cur = await publicLisk.readContract({
          address: liskTokenAddr,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [user],
        });
        if (cur > pre) {
          delta = cur - pre;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
  
      if (delta <= 0n) throw new Error("Withdrawal did not arrive on Lisk");
  
      setWithdrawOk(true);
      setBridgableAmount(delta);
  
      /* ------------------------------------------------------------- */
      /* 3) BRIDGE TO OP                                                */
      /* ------------------------------------------------------------- */
  
      setStep("sign-bridge");
      await new Promise((r) => setTimeout(r, 50));
      setStep("bridging");
  
      await bridgeWithdrawal({
        srcVaultToken: liskToken,
        destToken: destSymbol,
        amount: delta,
        to: "optimism",
        walletClient: wc,
      });
  
      /* ------------------------------------------------------------- */
      /* 4) SWITCH BACK TO OP                                           */
      /* ------------------------------------------------------------- */
  
      await switchOrAddChain(wc, CHAINS.optimism);
  
      /* ------------------------------------------------------------- */
      /* 5) DONE                                                        */
      /* ------------------------------------------------------------- */
  
      setStep("success");
      setShowSuccess(true);
    } catch (e: any) {
      console.error("WITHDRAW FLOW FAILED:", e);
      const code = e?.code ?? e?.error?.code;
      if (code === 4001) {
        setErr("Signature was cancelled.");
      } else {
        setErr(e?.message ?? String(e));
      }
      setStep("error");
    }
  }
  

  /* ------------------------------------------------------------------------ */
  /* Bridge-only retry (after successful withdraw)                            */
  /* ------------------------------------------------------------------------ */

  async function resumeBridgeOnly() {
    if (!walletClient) return
    try {
      setErr(null)

      let amount = bridgableAmount
      if (!amount || amount <= 0n) {
        amount = await readLiskBalance(liskTokenAddr as `0x${string}`, user)
      }
      if (!amount || amount <= 0n) throw new Error('No funds available on Lisk to bridge')

      await performBridge(amount)
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
  /* Button handler (mirror Deposit modal semantics)                          */
  /* ------------------------------------------------------------------------ */

  function onPrimary() {
    if (step === 'success') {
      setShowSuccess(true)
      return
    }

    if (step === 'error') {
      if (withdrawOk) {
        // withdraw done, bridge failed → resume bridge only
        void resumeBridgeOnly()
      } else {
        // withdraw failed → restart full flow
        void handleConfirm()
      }
      return
    }

    if (step === 'idle') {
      void handleConfirm()
      return
    }
  }

  const isWorking =
    step === 'withdrawing' ||
    step === 'sign-bridge' ||
    step === 'bridging'

  const disabled = !walletClient || isWorking

  // Convenience for display
  const destChainLabel = 'OP Mainnet'
  const finalTokenOnDest = destSymbol
  const finalNetAmount = netOnDest

  // Step hint (intermediate copy)
  const stepHint = (() => {
    if (step === 'withdrawing') {
      return 'Withdrawing from the vault on Lisk. This usually takes under a minute.'
    }
    if (step === 'sign-bridge') {
      return 'Please confirm the bridge transaction in your wallet.'
    }
    if (step === 'bridging') {
      return 'Bridge in progress. Final arrival time depends on network congestion.'
    }
    if (step === 'success') {
      return 'Withdrawal complete. Your balances should update shortly.'
    }
    if (step === 'error') {
      return 'Something went wrong. Check the steps above and retry.'
    }
    return 'Review the details and confirm your withdrawal.'
  })()

  // If withdraw fails (step=error && !withdrawOk), we hide the bridge block entirely
  const showBridgeBlock = !(step === 'error' && !withdrawOk)

  // Show bridge step 2 only once we actually enter bridge phase / error
  const showBridgeStep2 =
    step === 'sign-bridge' ||
    step === 'bridging' ||
    step === 'success' ||
    trigger2InError ||
    trigger3InError

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className={`fixed inset-0 z-[100] ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
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
                <Image
                  src={ICON.mor}
                  alt="Morpho"
                  width={28}
                  height={28}
                  className="rounded-lg"
                />
              </div>
              <div className="flex-1">
                <div className="text-lg font-semibold">Withdrawing from Vault</div>
                <div className="text-xs text-muted-foreground">
                  Re7 {snap.token} Vault (Morpho Blue)
                </div>
              </div>
            </div>

            {/* withdrawal failed step (reverse of deposit failed) */}
            {step === 'error' && !withdrawOk && (
              <div className="flex items-center gap-2 text-xs text-red-600 ml-11">
                <AlertCircle className="h-4 w-4" />
                <span>Withdrawal failed</span>
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
                {/* Square network badge */}
                <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                  <Image
                    src="/networks/lisk.png"
                    alt="Lisk"
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{amountOnLiskDisplay}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${amountOnLiskDisplay.toFixed(2)} • {liskToken} on Lisk (before fees)
                </div>
              </div>
            </div>

            {/* row 3: bridging via LI.FI (hidden entirely if withdraw step failed) */}
            {showBridgeBlock && (
              <div className="flex items-start gap-3">
                <div className="relative mt-0.5">
                  <Image
                    src={ICON.bridge}
                    alt="LI.FI"
                    width={28}
                    height={28}
                    className="rounded-full"
                  />
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold">Bridging via LI.FI</div>
                  <div className="text-xs text-muted-foreground">
                    Bridge fee (est.): {bridgeFeeAmount.toFixed(6)} {destSymbol}
                  </div>

                  <div className="mt-2 space-y-2 text-xs">
                    {/* Step 1: spending approved (initial state) */}
                    <div className="flex items-center gap-2">
                      {trigger1Done ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : step === 'error' && !withdrawOk ? (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      ) : step === 'withdrawing' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                      )}
                      <span>{destSymbol} spending approved</span>
                    </div>

                    {/* Step 2: bridge transaction */}
                    {showBridgeStep2 && (
                      <div className="flex items-center gap-2">
                        {trigger3InError || trigger2InError ? (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        ) : step === 'sign-bridge' || step === 'bridging' ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        ) : step === 'success' ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                        )}
                        <span>
                          {trigger3InError
                            ? 'Bridge failed'
                            : trigger2InError
                            ? 'Signature required'
                            : 'Bridge transaction confirmed'}
                        </span>
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
                  <Image
                    src="/networks/op-icon.png"
                    alt={destChainLabel}
                    width={16}
                    height={16}
                    className="rounded-sm"
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{finalNetAmount}</div>
                <div className="text-xs text-muted-foreground">
                  ≈ ${finalNetAmount.toFixed(2)} • {finalTokenOnDest} on {destChainLabel}
                </div>

                <div className="mt-2 text-[11px] text-muted-foreground space-y-0.5">
                  <div>
                    • 0.5% vault withdraw fee (~{protocolFeeAmount.toFixed(6)} {liskToken})
                  </div>
                  <div>
                    • Bridge fee (est.) ~{bridgeFeeAmount.toFixed(6)} {destSymbol}
                  </div>
                </div>
              </div>
            </div>

            {/* No big error box – states above are the UX */}
            {stepHint && (
              <div className="text-xs text-muted-foreground">
                {stepHint}
              </div>
            )}
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
