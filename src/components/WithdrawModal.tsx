// src/components/WithdrawModal.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { optimism, base, lisk as liskChain } from 'viem/chains'
import type { Address } from 'viem'
import { useAccount, useWalletClient } from 'wagmi'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { TokenAddresses } from '@/lib/constants'
import { withdrawMorphoOnLisk } from '@/lib/withdrawer'
import { bridgeWithdrawal } from '@/lib/bridge'
import { publicLisk } from '@/lib/clients'
import { erc20Abi } from 'viem'

type Props = {
  open: boolean
  onClose: () => void
  snap: { token: 'USDCe' | 'USDT0'; chain: 'lisk'; poolAddress: `0x${string}` }
  shares: bigint
}

function fmtAmount(x: bigint, decimals = 6) {
  const s = x.toString().padStart(decimals + 1, '0')
  const head = s.slice(0, -decimals) || '0'
  const tail = s.slice(-decimals).replace(/0+$/, '')
  return tail ? `${head}.${tail}` : head
}

const STEP_ORDER = ['withdrawing', 'bridging', 'done'] as const
type VisualStep = (typeof STEP_ORDER)[number] | 'error' | 'idle'
function stepIndex(s: VisualStep): number {
  const i = STEP_ORDER.indexOf(s as any)
  return i === -1 ? -1 : i
}

function StepRow({ label, state }: { label: string; state: 'pending' | 'active' | 'done' | 'error' }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2 text-sm',
        state === 'done' && 'border-emerald-400/40 bg-emerald-500/5',
        state === 'active' && 'border-blue-400/40 bg-blue-500/5',
        state === 'pending' && 'border-border/60',
        state === 'error' && 'border-destructive/40 bg-destructive/10'
      )}
    >
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          state === 'done' && 'bg-emerald-500',
          state === 'active' && 'bg-blue-500 animate-pulse',
          state === 'pending' && 'bg-muted-foreground/40',
          state === 'error' && 'bg-destructive'
        )}
      />
      <span className="flex-1">{label}</span>
      {state === 'done' && <span className="text-xs text-emerald-600">done</span>}
      {state === 'active' && <span className="text-xs text-blue-600">working…</span>}
    </div>
  )
}

async function ensureWalletChain(walletClient: any, chainId: number) {
  try {
    if ((walletClient as any)?.chain?.id === chainId) return
  } catch {}
  await walletClient.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: `0x${chainId.toString(16)}` }],
  })
}

// inline minimal balance reader on Lisk
async function readWalletBalanceLisk(tokenAddr: `0x${string}`, user: `0x${string}`): Promise<bigint> {
  try {
    return (await publicLisk.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [user],
    })) as bigint
  } catch {
    return 0n
  }
}

export default function WithdrawModal({ open, onClose, snap, shares }: Props) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()

  const [dest, setDest] = useState<'lisk' | 'optimism' | 'base'>('lisk')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState<VisualStep>('idle')
  const [error, setError] = useState<string | null>(null)

  const underlyingOnLisk: Address = useMemo(
    () => (snap.token === 'USDT0' ? (TokenAddresses.USDT0.lisk as Address) : (TokenAddresses.USDCe.lisk as Address)),
    [snap.token]
  )

  const destTokenSymbol = useMemo(() => {
    if (dest === 'lisk') return snap.token // USDCe | USDT0
    return snap.token === 'USDT0' ? 'USDT' : 'USDC' // bridge mapping
  }, [dest, snap.token])

  const destBadge = useMemo(() => {
    if (dest === 'lisk') return `${snap.token} to you (Lisk)`
    if (dest === 'optimism') return `${destTokenSymbol} to you (Optimism)`
    return `${destTokenSymbol} to you (Base)`
  }, [dest, destTokenSymbol, snap.token])

  useEffect(() => {
    if (!open) {
      setSubmitting(false)
      setStep('idle')
      setError(null)
      setDest('lisk')
    }
  }, [open])

  const visualActive: VisualStep = step
  const currentIdx = stepIndex(visualActive)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Withdraw {snap.token}</span>
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              Lisk vault shares → {destBadge}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Destination picker */}
        <div className="mt-2 flex items-center justify-between rounded-lg border p-2">
          <span className="text-xs text-muted-foreground">Receive on</span>
          <div className="inline-flex rounded-md bg-gray-100 p-1">
            {(['lisk', 'optimism', 'base'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDest(d)}
                className={` cursor-pointer px-3 py-1 text-xs rounded ${dest === d ? 'bg-white shadow font-medium' : 'opacity-70'}`}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="mt-2 rounded-lg border bg-card p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Max shares</span>
            <span className="font-medium">{fmtAmount(shares, 6)} shares</span>
          </div>
          <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 p-2 text-xs text-amber-700">
            Shares are redeemed on Lisk, then {dest !== 'lisk' ? `bridged to ${dest.toUpperCase()}` : 'sent to you on Lisk'}.
          </div>
        </div>

        {/* Steps */}
        <div className="mt-4 space-y-2">
          <StepRow
            label="Withdraw on Lisk"
            state={
              visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('withdrawing')
                ? 'pending'
                : visualActive === 'withdrawing'
                ? 'active'
                : currentIdx > stepIndex('withdrawing')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow
            label={dest === 'lisk' ? 'No bridge needed' : `Bridge to ${dest.toUpperCase()}`}
            state={
              dest === 'lisk'
                ? currentIdx >= stepIndex('withdrawing')
                  ? 'done'
                  : 'pending'
                : visualActive === 'error'
                ? 'pending'
                : currentIdx < stepIndex('bridging')
                ? 'pending'
                : visualActive === 'bridging'
                ? 'active'
                : currentIdx > stepIndex('bridging')
                ? 'done'
                : 'pending'
            }
          />
          <StepRow label="Complete" state={visualActive === 'done' ? 'done' : 'pending'} />
        </div>

        {/* Status */}
        <div
          className={cn(
            'mt-3 rounded-md border p-2 text-xs',
            step === 'error' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border/60 text-muted-foreground'
          )}
        >
          {step === 'idle' && 'Ready to withdraw.'}
          {step === 'withdrawing' && 'Confirm the Lisk transaction…'}
          {step === 'bridging' && `Bridging ${snap.token === 'USDT0' ? 'USDT' : 'USDC'} to ${dest.toUpperCase()}…`}
          {step === 'done' && 'All set.'}
          {step === 'error' && error}
        </div>

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          <Button title="Cancel" onClick={onClose} disabled={submitting} variant="ghost">
            Cancel
          </Button>

          <Button
            title="Withdraw now"
            onClick={() => {
              if (!walletClient || !address) return
              setError(null)
              setSubmitting(true)

              ;(async () => {
                try {
                  // 1) Switch to Lisk and withdraw shares -> underlying to user
                  await ensureWalletChain(walletClient, liskChain.id)
                  setStep('withdrawing')

                  const pre = await readWalletBalanceLisk(underlyingOnLisk as `0x${string}`, address as `0x${string}`)

                  await withdrawMorphoOnLisk({
                    token: snap.token,                 // 'USDCe' | 'USDT0'
                    shares,                            // shares amount
                    shareToken: snap.poolAddress,      // vault shares token
                    underlying: underlyingOnLisk as `0x${string}`,
                    to: address as `0x${string}`,
                    wallet: walletClient,
                  })

                  // Wait until balance increases on Lisk
                  let tries = 0
                  while (tries++ < 30) {
                    const cur = await readWalletBalanceLisk(underlyingOnLisk as `0x${string}`, address as `0x${string}`)
                    if (cur > pre) break
                    await new Promise((r) => setTimeout(r, 2000))
                  }

                  // 2) If destination is Lisk, done
                  if (dest === 'lisk') {
                    setStep('done')
                    setSubmitting(false)
                    return
                  }

                  // 3) Bridge to chosen chain (USDCe->USDC, USDT0->USDT)
                  setStep('bridging')
                  const toChain = dest === 'optimism' ? 'optimism' : 'base' as const
                  const sourceToken = snap.token === 'USDT0' ? 'USDT' : 'USDC' // Li.Fi input mapper when leaving Lisk
                  const destToken = snap.token === 'USDT0' ? 'USDT' : 'USDC'

                  // Re-read actual balance to bridge all newly received underlying (or use a %)
                  const afterBal = await readWalletBalanceLisk(underlyingOnLisk as `0x${string}`, address as `0x${string}`)
                  const delta = afterBal - pre
                  if (delta <= 0n) throw new Error('No underlying received from withdraw')

                    await bridgeWithdrawal({
                      srcVaultToken: snap.token,                   // 'USDCe' | 'USDT0' (or 'WETH')
                      destToken:     snap.token === 'USDT0' ? 'USDT'
                                    : snap.token === 'USDCe' ? 'USDC'
                                    : 'WETH',
                      amount:        delta,                // bigint
                      to:            toChain,
                      walletClient,
                    })

                  setStep('done')
                } catch (e: any) {
                  setError(e?.message || String(e))
                  setStep('error')
                } finally {
                  setSubmitting(false)
                }
              })()
            }}
            disabled={submitting || shares === 0n}
          >
            {submitting ? 'Working…' : 'Withdraw now'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
