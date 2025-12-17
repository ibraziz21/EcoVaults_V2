// src/app/dashboard/page.tsx
'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { PortfolioHeader } from '@/components/dashboard/PortfolioHeader'
import { DepositModal } from '@/components/deposit/DepositModal'
import type { YieldSnapshot } from '@/hooks/useYields'
import { TokenAddresses } from '@/lib/constants'
import { MORPHO_VAULTS } from '@/lib/tvl'
import ClaimRewards from '@/components/tables/ClaimRewardTable/ClaimReward'
import MyPositions from '@/components/tables/MyPositionsTable/MyPositions'
import { useAppKitAccount } from '@reown/appkit/react'
import { ConnectWalletPrompt } from '@/components/ConnectWalletPrompt'
import { ArrowRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useMerklRewards } from '@/hooks/useMerklRewards'

import { formatUnits } from 'viem'
import { MultiSelectComboBox } from '@/components/multi-select-combobox'
import Image from 'next/image'
import Base from "../../public/networks/base.png"
import Unichain from "../../public/networks/unichain.png"
import WorldCoin from "../../public/networks/worldcoin.png"
import Lisk from "../../public/networks/lisk.png"
import OpIcon from "../../public/networks/op-icon.png"
import MorphoIcon from "../../public/protocols/morpho-icon.png"
import MerkleIcon from "../../public/protocols/merkle.png"
import { useUsdPrices } from '@/hooks/useUSDPrices'

/** Morpho-only helper: Lisk positions → YieldSnapshot */
function toSnapshotFromPosition(p: {
  protocol: 'Morpho Blue'
  chain: 'lisk'
  token: 'USDCe' | 'USDT0' | 'WETH'
}): YieldSnapshot {
  // normalize for app-wide token label (bridging logic expects base symbols)
  const token: YieldSnapshot['token'] =
    p.token === 'USDCe' ? 'USDC'
      : p.token === 'USDT0' ? 'USDT'
        : 'WETH'

  const poolAddress: `0x${string}` =
    p.token === 'USDCe' ? MORPHO_VAULTS.USDCe
      : p.token === 'USDT0' ? MORPHO_VAULTS.USDT0
        : MORPHO_VAULTS.WETH

  const underlying: `0x${string}` =
    p.token === 'USDCe' ? TokenAddresses.USDCe.lisk
      : p.token === 'USDT0' ? TokenAddresses.USDT0.lisk
        : TokenAddresses.WETH.lisk

  return {
    id: `lisk-morpho-blue-${token.toLowerCase()}`,
    chain: 'lisk',
    protocol: 'Morpho Blue',
    protocolKey: 'morpho-blue',
    poolAddress,
    token,
    apy: 0,
    tvlUSD: 0,
    updatedAt: new Date().toISOString(),
    underlying,
  }
}

export default function Dashboard() {
  const [depositSnap, setDepositSnap] = useState<YieldSnapshot | null>(null)
  const { address, isConnected } = useAppKitAccount()
  const { refetch } = useMerklRewards()
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>([])

  const handleNetworkToggle = (network: string) => {
    setSelectedNetworks(prev => {
      if (prev.includes(network)) {
        const newSelection = prev.filter(n => n !== network)
        return newSelection
      } else {
        return [...prev, network]
      }
    })
  }

  const handleProtocolToggle = (protocol: string) => {
    setSelectedProtocols(prev => {
      if (prev.includes(protocol)) {
        const newSelection = prev.filter(p => p !== protocol)
        return newSelection
      } else {
        return [...prev, protocol]
      }
    })
  }

  // ──────────────────────────────────────────────────────
  // Claimable rewards total ($) using Merkl + live prices
  // ──────────────────────────────────────────────────────
  const { rewards, isLoading: isRewardsLoading } = useMerklRewards()
  const { priceUsdForSymbol, isLoading: isPricesLoading } = useUsdPrices()

  const totalClaimableUsd = useMemo(() => {
    if (!rewards || rewards.length === 0) return 0

    return rewards.reduce((sum, r) => {
      const qty = Number(formatUnits(BigInt(r.claimable), r.token.decimals)) || 0
      const price = priceUsdForSymbol(r.token.symbol)
      return sum + qty * price
    }, 0)
  }, [rewards, priceUsdForSymbol])

  const isClaimableLoading = isRewardsLoading || isPricesLoading

  // Filter options - same as positions page
  const networkOptions = [
    {
      value: "Lisk",
      label: "Lisk",
      icon: <Image src={Lisk} alt="Lisk" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Base",
      label: "Base",
      icon: <Image src={Base} alt="Base" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Unichain",
      label: "Unichain",
      icon: <Image src={Unichain} alt="Unichain" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Op Mainnet",
      label: "Op Mainnet",
      icon: <Image src={OpIcon} alt="OpIcon" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "World Chain",
      label: "World Chain",
      icon: <Image src={WorldCoin} alt="WorldCoin" className="h-4 w-4 rounded-[4px]" />
    },
  ]

  const protocolOptions = [
    {
      value: "Morpho Blue",
      label: "Morpho Blue",
      icon: <Image src={MorphoIcon} alt="Morpho Blue" className="h-4 w-4 rounded-[4px]" />
    },
    {
      value: "Merkle",
      label: "Merkle",
      icon: <Image src={MerkleIcon} alt="Merkle" className="h-4 w-4 rounded-[4px]" />
    },
  ]

  // Reusable filter UI
  const filterUI = (
    <div className="flex items-center gap-3 md:gap-4 px-2 py-3 flex-wrap">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Network:</span>
        <MultiSelectComboBox
          options={networkOptions}
          selectedValues={selectedNetworks}
          onToggle={handleNetworkToggle}
          placeholder="network"
          allLabel="All"
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Protocol:</span>
        <MultiSelectComboBox
          options={protocolOptions}
          selectedValues={selectedProtocols}
          onToggle={handleProtocolToggle}
          placeholder="protocol"
          allLabel="All"
        />
      </div>
    </div>
  )

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#F9FAFB]">
      {isConnected && address ? (
        <div className="w-full px-4">
          <PortfolioHeader />

          {/* Action modals */}
          {depositSnap && (
            <DepositModal
              open
              onClose={() => setDepositSnap(null)}
              snap={depositSnap}
            />
          )}

          {/* Claimable Rewards */}
          <section className="bg-white p-5 rounded-[20px] max-w-[1392px] mx-auto">
            <div className="mb-3 flex justify-start items-center gap-2 ">
              <h2 className="text-base md:text-lg font-semibold tracking-tight text-center">
                Claimable Rewards
              </h2>
              <div className="px-2 py-1 bg-[#E5E7EB] text-[#4B5563] text-[12px] rounded-full min-w-[64px] text-center">
                {isClaimableLoading
                  ? '...'
                  : `$${totalClaimableUsd.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
              </div>
            </div>
            <ClaimRewards />
          </section>

          {/* My Positions */}
          <section className="bg-white my-4 p-4 md:p-6 rounded-xl max-w-[1392px] mx-auto">
            <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-base md:text-lg font-semibold tracking-tight">
                My Positions
              </h2>
              <Link href="/vaults">
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 text-sm font-medium hover:bg-gray-100"
                  title="Explore Vaults"
                >
                  Explore Vaults
                  <ArrowRight size={18} weight="bold" />
                </Button>
              </Link>
            </div>

            <MyPositions
              networkFilter={selectedNetworks}
              protocolFilter={selectedProtocols}
              filterUI={filterUI}
            />
          </section>
        </div>
      ) : (
        <ConnectWalletPrompt />
      )}
    </div>
  )
}