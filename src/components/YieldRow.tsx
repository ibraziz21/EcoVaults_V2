// src/components/positions/YieldRow.tsx
'use client'

import { FC, useState, useMemo } from 'react'
import type { YieldSnapshot } from '@/hooks/useYields'
import { useAppKitAccount, useAppKit } from '@reown/appkit/react'
import { Button } from '@/components/ui/button'
import { TokenBadge } from '@/components/TokenBadge'
import { DepositModal } from '@/components/deposit/DepositModal'

// Normalize Lisk vault symbols for display
const DISPLAY_TOKEN: Record<string, string> = {
  USDCe: 'USDC',
  USDT0: 'USDT',
  USDC: 'USDC',
  USDT: 'USDT',
  WETH: 'WETH',
}

export const YieldRow: FC<{ snap: YieldSnapshot }> = ({ snap }) => {
  const { address } = useAppKitAccount()
  const { open } = useAppKit()
  const [show, setShow] = useState(false)

  // We only support Morpho Blue on Lisk in this build
  const isEnabled = useMemo(
    () => snap.protocol === 'Morpho Blue' && snap.chain === 'lisk',
    [snap.protocol, snap.chain],
  )

  function openModal() {
    if (!isEnabled) return
    if (!address) open() // Reown connect first
    else setShow(true)
  }

  const tokenForUi = DISPLAY_TOKEN[snap.token] ?? snap.token

  return (
    <>
      <tr className="group border-b hover:bg-secondary/5">
        <td className="px-4 py-3">
          <TokenBadge symbol={tokenForUi} />
        </td>
        <td className="px-4 py-3 capitalize">{snap.chain}</td>
        <td className="px-4 py-3">{snap.protocol}</td>
        <td className="px-4 py-3 text-right font-semibold">{snap.apy.toFixed(2)}%</td>
        <td className="px-4 py-3 text-right">
          ${Number.isFinite(snap.tvlUSD) ? snap.tvlUSD.toLocaleString() : '0'}
        </td>
        <td className="px-4 py-3 text-right">
          <Button
            onClick={openModal}
            className="h-8 px-3 text-xs"
            title="Deposit"
            disabled={!isEnabled}
          >
            Deposit
          </Button>
        </td>
      </tr>

      {isEnabled && (
        <DepositModal open={show} onClose={() => setShow(false)} snap={snap} />
      )}
    </>
  )
}
