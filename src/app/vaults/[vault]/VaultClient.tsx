'use client'

import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Card, CardContent } from '@/components/ui/Card'
import { DepositWithdraw } from '@/components/deposit/deposit-withdraw'
import { useMemo, useState } from 'react'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { usePositions } from '@/hooks/usePositions'
import { formatUnits } from 'viem'

import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'
import { InfoIcon } from '@phosphor-icons/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAccount } from 'wagmi'
import { useDepositIntents } from '@/hooks/useDepositIntents'
import { useWithdrawIntents } from '@/hooks/useWithdrawIntents'
import { ChevronDown } from 'lucide-react'

// Accept both canonical and alias slugs, normalize for lookups
const CANONICAL: Record<string, 'USDC' | 'USDT'> = {
  USDC: 'USDC',
  USDCE: 'USDC',
  'USDC.E': 'USDC',
  USDT: 'USDT',
  USDT0: 'USDT',
}

// Token icon mapping (include aliases)
const tokenIcons: Record<string, string> = {
  USDC: '/tokens/usdc-icon.png',
  USDCe: '/tokens/usdc-icon.png',
  USDT: '/tokens/usdt-icon.png',
  USDT0: '/tokens/usdt0-icon.png',
  WETH: '/tokens/weth.png',
  DAI: '/tokens/dai.png',
}

// Network icon mapping
const networkIcons: Record<string, string> = {
  Ethereum: '/networks/ethereum.png',
  Lisk: '/networks/lisk.png',
  Arbitrum: '/networks/arbitrum.png',
  Optimism: '/networks/op-icon.png',
  Base: '/networks/base.png',
}

// Protocol icon mapping
const protocolIcons: Record<string, string> = {
  'Morpho Blue': '/protocols/morpho-icon.png',
  Morpho: '/protocols/morpho-icon.png',
}

// Normalize for display parity with YieldRow (underlying → canonical)
const DISPLAY_TOKEN: Record<string, string> = {
  USDCe: 'USDC',
  USDT0: 'USDT',
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
}

// Only Lisk + Morpho Blue + (USDC/USDT)
const HARD_FILTER = (y: Pick<YieldSnapshot, 'chain' | 'protocolKey' | 'token'>) =>
  y.chain === 'lisk' &&
  y.protocolKey === 'morpho-blue' &&
  (y.token === 'USDC' || y.token === 'USDT')

export default function VaultDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { address, isConnected } = useAccount()

  // Raw slug from URL (preserve for header/icon); also build a canonical token for queries
  const vaultSlugRaw = ((params.vault as string) || '').toUpperCase()
  const vaultSlugKey = vaultSlugRaw.replace(/\./g, '')
  const vaultCanonical: 'USDC' | 'USDT' | undefined = CANONICAL[vaultSlugKey]
  const headerLabel = vaultSlugKey || 'Vault'

  // Human-facing label for the header
  const headerDisplayLabel =
    ['USDC', 'USDCE', 'USDC.E'].includes(vaultSlugKey)
      ? 'USDC.e'
      : headerLabel

  // ── Hooks must always run ──
  const { yields, isLoading, error } = useYields()
  const { data: positionsRaw } = usePositions()
  const { intents: stuckIntents, isLoading: intentsLoading, refetch: refetchIntents } = useDepositIntents(address)
  const {
    intents: stuckWithdraws,
    isLoading: withdrawsLoading,
    refetch: refetchWithdraws,
  } = useWithdrawIntents(address)
  const [showRetries, setShowRetries] = useState(false)
  const [showWithdrawRetries, setShowWithdrawRetries] = useState(false)
  const [showActive, setShowActive] = useState(false)
  const [retryingRefId, setRetryingRefId] = useState<string | null>(null)
  const [resumeRequest, setResumeRequest] = useState<{ amountBase: string; refId?: string } | null>(null)
  const [retryingWithdrawId, setRetryingWithdrawId] = useState<string | null>(null)

  // Derive variants using the canonical token (so USDT0/USDCe work)
  const vaultVariants = useMemo(() => {
    if (!yields || !vaultCanonical) return []
    const filtered = yields.filter(HARD_FILTER)
    const forThisVault = filtered.filter(
      (s) => (DISPLAY_TOKEN[s.token] ?? s.token) === vaultCanonical
    )
    return forThisVault.map((s) => ({
      vault: DISPLAY_TOKEN[s.token] ?? s.token, // canonical view (USDC/USDT)
      network: 'Lisk',
      protocol: 'Morpho Blue',
      apy: (Number(s.apy) || 0).toFixed(2),
      tvl: Number.isFinite(s.tvlUSD) ? Math.round(s.tvlUSD).toLocaleString() : '0',
    }))
  }, [yields, vaultCanonical])

  const primaryVariant = vaultVariants[0] // we only have Lisk/Morpho for now

  /**
   * ✅ Total deposits (My Positions)
   * Your positions source is OP sVault receipt tokens.
   * They are 6 decimals, and positions look like:
   *   { protocol: 'sVault Receipt', chain: 'optimism', token: 'USDC' | 'USDT', amount: bigint }
   */
  const receiptTokenOnOp: 'USDC' | 'USDT' | undefined = useMemo(() => {
    if (!vaultCanonical) return undefined
    return vaultCanonical === 'USDT' ? 'USDT' : 'USDC'
  }, [vaultCanonical])

  const userDepositsShares = useMemo(() => {
    const positions = (positionsRaw ?? []) as any[]

    // Debug logs
    console.debug('[vault] slugKey:', vaultSlugKey, 'canonical:', vaultCanonical, 'receiptTokenOnOp:', receiptTokenOnOp)
    console.debug(
      '[vault] positionsRaw:',
      positions.map((p) => ({
        protocol: p?.protocol,
        chain: p?.chain,
        token: p?.token,
        amount: typeof p?.amount === 'bigint' ? p.amount.toString() : String(p?.amount),
      }))
    )

    if (!receiptTokenOnOp) return 0n

    const pos = positions.find(
      (p) =>
        p?.protocol === 'sVault Receipt' &&
        String(p?.chain).toLowerCase() === 'optimism' &&
        String(p?.token).toUpperCase() === receiptTokenOnOp
    )

    console.debug('[vault] matchedPosition:', pos ? {
      protocol: pos?.protocol,
      chain: pos?.chain,
      token: pos?.token,
      amount: typeof pos?.amount === 'bigint' ? pos.amount.toString() : String(pos?.amount),
    } : null)

    return (pos?.amount ?? 0n) as bigint
  }, [positionsRaw, receiptTokenOnOp, vaultSlugKey, vaultCanonical])

  // ✅ Receipt token is 6 decimals
  const RECEIPT_DECIMALS = 6

  // For stable vaults, shares are treated 1:1 in UI as deposited amount in that stable.
  const userDepositsHuman = useMemo(() => {
    try {
      const s = formatUnits(userDepositsShares, RECEIPT_DECIMALS)
      const num = Number(s)
      return Number.isFinite(num) ? num : 0
    } catch (e) {
      console.debug('[vault] formatUnits error:', e)
      return 0
    }
  }, [userDepositsShares])

  // Choose the snapshot by canonical token (works for USDT0/USDCe routes)
  const snapCandidate = (yields ?? []).find(
    (s) =>
      s.chain === 'lisk' &&
      s.protocolKey === 'morpho-blue' &&
      (DISPLAY_TOKEN[s.token] ?? s.token) === vaultCanonical
  )

  const handleRetryIntent = async (refId: string) => {
    if (!refId) return
    setRetryingRefId(refId)
    try {
      const res = await fetch('/api/deposits/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Retry failed')
      }
      await refetchIntents()
    } catch (err) {
      console.error('[retry intent]', err)
    } finally {
      setRetryingRefId(null)
    }
  }

  const handleRetryWithdraw = async (refId: string) => {
    if (!refId) return
    setRetryingWithdrawId(refId)
    try {
      const res = await fetch('/api/withdraw/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || 'Retry failed')
      }
      await refetchWithdraws()
    } catch (err) {
      console.error('[retry withdraw]', err)
    } finally {
      setRetryingWithdrawId(null)
    }
  }

  // ── Only rendering branches below this line ──

  if (!isConnected || !address) {
    return <ConnectWalletPrompt />
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading vault…
      </div>
    )
  }

  if (error || !vaultCanonical || vaultVariants.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Vault Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The vault &quot;{headerLabel}&quot; does not exist.
          </p>
          <Button onClick={() => router.push('/vaults')}>Back to Markets</Button>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#F9FAFB] p-4 md:p-6">
        <div className="max-w-[1182px] mx-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 md:gap-4">
              <Image
                src={tokenIcons[headerLabel] || tokenIcons[vaultCanonical] || '/tokens/usdc-icon.png'}
                alt={headerLabel}
                width={32}
                height={32}
                className="rounded-full"
              />
              <div>
                <h1 className="text-xl md:text-2xl font-semibold">
                  Re7 {headerDisplayLabel}{' '}
                  <span className="text-[#9CA3AF]">Vault</span>
                </h1>
              </div>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Overview Stats */}
              <div className="bg-white rounded-xl p-6">
                <h2 className="text-[16px] font-semibold mb-4">Overview</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Network */}
                  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                    <CardContent className="space-y-1 p-4 h-[128px] flex flex-col justify-between">
                      <p className="text-[14px] font-normal tracking-wide text-[#4B5563] flex items-center">
                        Network
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-2">
                              <InfoIcon size={16} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              The blockchain network where this vault operates. Currently only Lisk network is supported.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="w-[24px] h-[24px] relative rounded-[6px] overflow-hidden">
                          <Image
                            src={networkIcons[primaryVariant.network] || '/networks/default.svg'}
                            alt={primaryVariant.network}
                            width={24}
                            height={24}
                            className="rounded-none"
                          />
                        </div>
                        <p className="font-semibold text-[20px]">{primaryVariant.network}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Protocol */}
                  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                    <CardContent className="space-y-1 p-4 h-[128px] flex flex-col justify-between">
                      <p className="text-[14px] font-normal tracking-wide text-[#4B5563] flex items-center">
                        Protocol
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-2">
                              <InfoIcon size={16} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              The DeFi protocol used for yield generation. This vault uses Morpho Blue for decentralized lending.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <div className="flex items-center gap-3">
                        <div className="w-[24px] h-[24px] relative rounded-[6px] overflow-hidden">
                          <Image
                            src={protocolIcons[primaryVariant.protocol] || '/protocols/default.svg'}
                            alt={primaryVariant.protocol}
                            width={24}
                            height={24}
                            className="rounded-none"
                          />
                        </div>
                        <p className="font-semibold text-[20px]">{primaryVariant.protocol}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* TVL */}
                  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                    <CardContent className="space-y-1 p-4 h-[128px] flex flex-col justify-between">
                      <p className="text-[14px] font-normal tracking-wide text-[#4B5563] flex items-center">
                        Total TVL
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-2">
                              <InfoIcon size={16} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Total Value Locked across all variants of this vault. Represents the sum of all deposits from all users.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className="text-[20px] font-semibold">
                        $
                        {vaultVariants
                          .reduce((sum, v) => {
                            const raw = v.tvl ?? 0
                            const s = String(raw ?? '').trim()

                            const euPattern = /^\d{1,3}(\.\d{3})+(,\d+)?$/ // 1.234.567,89
                            const usPattern = /^\d{1,3}(,\d{3})+(\.\d+)?$/ // 1,234,567.89

                            let parsed = 0
                            if (euPattern.test(s)) {
                              const n = Number(s.replace(/\./g, '').replace(',', '.'))
                              parsed = Number.isFinite(n) ? n : 0
                            } else if (usPattern.test(s)) {
                              const n = Number(s.replace(/,/g, ''))
                              parsed = Number.isFinite(n) ? n : 0
                            } else {
                              const fallback = Number(s.replace(/,/g, '.').replace(/[^\d.]/g, ''))
                              parsed = Number.isFinite(fallback) ? fallback : 0
                            }

                            return sum + parsed
                          }, 0)
                          .toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>

                  {/* APY */}
                  <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                    <CardContent className="space-y-1 p-4 h-[128px] flex flex-col justify-between">
                      <p className="text-[14px] font-normal tracking-wide text-[#4B5563] flex items-center">
                        APY
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-2">
                              <InfoIcon size={16} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">
                              Annual Percentage Yield based on current rates. This is an estimate and may fluctuate based on market conditions.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className="text-[20px] font-semibold">
                        {(
                          vaultVariants.reduce((sum, v) => sum + Number(v.apy || 0), 0) /
                          (vaultVariants.length || 1)
                        ).toFixed(2)}
                        %
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* My Positions */}
              <div className="bg-white rounded-xl p-6">
                <h2 className="text-[16px] font-semibold mb-4">My Positions</h2>
                <Card className="rounded-2xl border-[1.5px] border-gray-200 bg-white shadow-none">
                  <CardContent className="space-y-1 p-4 h-[128px] flex flex-col justify-between">
                    <p className="text-[14px] font-normal tracking-wide text-[#4B5563] flex items-center">
                      Total deposits
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-2">
                            <InfoIcon size={16} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-xs">
                            Your personal deposits into this vault, based on your OP sVault receipt token balance (6 decimals).
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </p>
                    <p className="text-[20px] font-semibold text-left">
                      $
                      {userDepositsHuman.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column - Deposit/Withdraw */}
            <div className="lg:sticky lg:top-6 h-fit">
              {snapCandidate && (
                <DepositWithdraw
                  initialTab="deposit"
                  snap={snapCandidate}
                  resumeDeposit={resumeRequest ?? undefined}
                  onResumeHandled={() => setResumeRequest(null)}
                />
              )}

              {/* Active transactions: deposits + withdrawals */}
              {address && (
                <div className="mt-4 border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowActive((v) => !v)}
                    className="w-full px-5 py-4 flex items-center justify-between h-12 bg-muted/30 hover:bg-muted/50 transition"
                  >
                    <span className="font-semibold text-foreground text-base">Active Transactions</span>
                    <ChevronDown
                      size={18}
                      className={`transition-transform ${showActive ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showActive && (
                    <div className="divide-y">
                      <div className="border-t border-border">
                        <button
                          onClick={() => setShowRetries((v) => !v)}
                          className="w-full px-5 py-4 flex items-center justify-between h-12 bg-muted/20 hover:bg-muted/40 transition"
                        >
                          <span className="font-semibold text-foreground text-base">Resume Deposits</span>
                          <div className="flex items-center gap-2 text-muted-foreground text-xs">
                            {intentsLoading && <span>Loading…</span>}
                            <ChevronDown
                              size={18}
                              className={`transition-transform ${showRetries ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        {showRetries && (
                          <div className="divide-y">
                            {stuckIntents.map((intent) => {
                            const shortRef = `${intent.refId.slice(0, 6)}…${intent.refId.slice(-4)}`
                            const status = intent.status?.toUpperCase?.() || 'UNKNOWN'
                            const isFailed = status === 'FAILED' || !!intent.error
                            const needsAction = isFailed || status === 'PENDING' || status === 'WAITING_ROUTE'
                            const label = isFailed ? 'Retry' : needsAction ? 'Continue' : 'Processing…'
                              const disabled = retryingRefId === intent.refId || (!needsAction && !isFailed)
                              const btnVariant = isFailed ? 'destructive' : 'secondary'

                              const hasBridge = intent.fromTxHash && intent.fromTxHash.trim().length > 0
                              const hasDeposit = intent.depositTxHash && intent.depositTxHash.trim().length > 0
                              const canResumeBridge = !hasBridge && !hasDeposit
                              const baseAmount = intent.amount || intent.minAmount || '0'
                              const canResume = canResumeBridge && BigInt(baseAmount || '0') > 0n

                              return (
                                <div key={intent.refId} className="px-5 py-3 flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-foreground truncate">{shortRef}</div>
                                    <div className="text-xs text-muted-foreground">{status}</div>
                                    {intent.error && <div className="text-xs text-destructive truncate">{intent.error}</div>}
                                  </div>
                                  {canResume ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => setResumeRequest({ amountBase: baseAmount, refId: intent.refId })}
                                    >
                                      Start Bridge
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant={btnVariant as any}
                                      disabled={disabled}
                                      onClick={() => handleRetryIntent(intent.refId)}
                                    >
                                      {retryingRefId === intent.refId ? 'Working…' : label}
                                    </Button>
                                  )}
                               </div>
                             )
                            })}
                            {!intentsLoading && stuckIntents.length === 0 && (
                              <div className="px-5 py-3 text-sm text-muted-foreground">No pending deposits.</div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-border">
                        <button
                          onClick={() => setShowWithdrawRetries((v) => !v)}
                          className="w-full px-5 py-4 flex items-center justify-between h-12 bg-muted/20 hover:bg-muted/40 transition"
                        >
                          <span className="font-semibold text-foreground text-base">Resume Withdrawals</span>
                          <div className="flex items-center gap-2 text-muted-foreground text-xs">
                            {withdrawsLoading && <span>Loading…</span>}
                            <ChevronDown
                              size={18}
                              className={`transition-transform ${showWithdrawRetries ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        {showWithdrawRetries && (
                          <div className="divide-y">
                            {stuckWithdraws.map((intent) => {
                              const shortRef = `${intent.refId.slice(0, 6)}…${intent.refId.slice(-4)}`
                              const status = intent.status?.toUpperCase?.() || 'UNKNOWN'
                              const isFailed = status === 'FAILED' || !!intent.error
                              const needsAction =
                                isFailed ||
                                ['PENDING', 'PROCESSING', 'BURNED', 'REDEEMING', 'REDEEMED', 'BRIDGING'].includes(status)
                              const label = isFailed ? 'Retry' : needsAction ? 'Continue' : 'Processing…'
                              const disabled = retryingWithdrawId === intent.refId || (!needsAction && !isFailed)
                              const btnVariant = isFailed ? 'destructive' : 'secondary'

                              return (
                                <div key={intent.refId} className="px-5 py-3 flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-foreground truncate">{shortRef}</div>
                                    <div className="text-xs text-muted-foreground">{status}</div>
                                    {intent.error && <div className="text-xs text-destructive truncate">{intent.error}</div>}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={btnVariant as any}
                                    disabled={disabled}
                                    onClick={() => handleRetryWithdraw(intent.refId)}
                                  >
                                    {retryingWithdrawId === intent.refId ? 'Working…' : label}
                                  </Button>
                                </div>
                              )
                            })}
                            {!withdrawsLoading && stuckWithdraws.length === 0 && (
                              <div className="px-5 py-3 text-sm text-muted-foreground">No pending withdrawals.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
