'use client'

import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Card, CardContent } from '@/components/ui/Card'
import { DepositWithdraw } from '@/components/deposit/deposit-withdraw'
import { useMemo } from 'react'
import { useYields, type YieldSnapshot } from '@/hooks/useYields'
import { usePositions } from '@/hooks/usePositions'
import { formatUnits } from 'viem'
import { useAppKitAccount } from '@reown/appkit/react'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'
import { InfoIcon } from '@phosphor-icons/react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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
  'Morpho Blue': '/protocols/morpho-icon.png', // Added this key
  Morpho: '/protocols/morpho-icon.png', // Keep as fallback
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
  const { address, isConnected } = useAppKitAccount()

  // Raw slug from URL (preserve for header/icon); also build a canonical token for queries
  const vaultSlugRaw = ((params.vault as string) || '').toUpperCase()
  const vaultSlugKey = vaultSlugRaw.replace(/\./g, '')
  const vaultCanonical: 'USDC' | 'USDT' | undefined = CANONICAL[vaultSlugKey]
  const headerLabel = vaultSlugKey || 'Vault'

  // 🔹 Human-facing label for the header
  const headerDisplayLabel =
    ['USDC', 'USDCE', 'USDC.E'].includes(vaultSlugKey)
      ? 'USDC.e'
      : headerLabel

  // ── Hooks must always run, regardless of connection state ──
  const { yields, isLoading, error } = useYields()
  const { data: positionsRaw } = usePositions()

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

  // User shares: on Morpho Lisk, the share token is 18d; map header label to underlying
  const userShares = useMemo(() => {
    const positions = (positionsRaw ?? []) as any[]

    // If user visited alias, keep it; otherwise map canonical to underlying alias
    const morphoToken =
      vaultSlugKey === 'USDT0' || vaultSlugKey === 'USDCe'
        ? vaultSlugKey
        : vaultCanonical === 'USDC'
          ? 'USDCe'
          : vaultCanonical === 'USDT'
            ? 'USDT0'
            : vaultSlugKey

    const pos = positions.find(
      (p) =>
        p?.protocol === 'Morpho Blue' &&
        String(p?.chain).toLowerCase() === 'lisk' &&
        String(p?.token) === morphoToken
    )
    return (pos?.amount ?? 0n) as bigint
  }, [positionsRaw, vaultCanonical, vaultSlugKey])

  const userSharesHuman = useMemo(() => {
    const num = Number(formatUnits(userShares, 18))
    return Number.isFinite(num) ? num : 0
  }, [userShares])

  // Choose the snapshot by canonical token (works for USDT0/USDCe routes)
  const snapCandidate = (yields ?? []).find(
    (s) =>
      s.chain === 'lisk' &&
      s.protocolKey === 'morpho-blue' &&
      (DISPLAY_TOKEN[s.token] ?? s.token) === vaultCanonical
  )

  // ── Only rendering branches below this line, no new hooks ──

  // Show wallet prompt if not connected
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

  // If the slug is unknown or we couldn't find a matching Lisk/Morpho vault for it
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
          {/* Header with back button */}
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
                  Re7 {headerDisplayLabel} <span className="text-[#9CA3AF]">Vault</span>
                </h1>

              </div>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Left Column - Overview & Positions */}
            <div className="space-y-6">
              {/* Overview Stats */}
              <div className="bg-white rounded-xl p-6">
                <h2 className="text-[16px] font-semibold mb-4">Overview</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Network Card */}
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
                            <p className="max-w-xs">The blockchain network where this vault operates. Currently only Lisk network is supported.</p>
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

                  {/* Protocol Card */}
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
                            <p className="max-w-xs">The DeFi protocol used for yield generation. This vault uses Morpho Blue for decentralized lending.</p>
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

                  {/* TVL Card */}
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
                            <p className="max-w-xs">Total Value Locked across all variants of this vault. Represents the sum of all deposits from all users.</p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className=" text-[20px] font-semibold">
                        $
                        {vaultVariants
                          .reduce((sum, v) => sum + Number((v.tvl || '0').toString().replace(/,/g, '')), 0)
                          .toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>

                  {/* APY Card */}
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
                            <p className="max-w-xs">Annual Percentage Yield based on current rates. This is an estimate and may fluctuate based on market conditions.</p>
                          </TooltipContent>
                        </Tooltip>
                      </p>
                      <p className=" text-[20px] font-semibold">
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
                          <p className="max-w-xs">Your personal deposit amount in this specific vault. Does not include your deposits in other vaults.</p>
                        </TooltipContent>
                      </Tooltip>
                    </p>
                    <p className=" text-[20px] font-semibold text-left">
                      ${' '}
                      {userSharesHuman.toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column - Deposit/Withdraw */}
            <div className="lg:sticky lg:top-6 h-fit">
              {snapCandidate && <DepositWithdraw initialTab="deposit" snap={snapCandidate} />}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}