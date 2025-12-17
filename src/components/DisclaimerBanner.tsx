'use client'

import { useState, useEffect } from 'react'
import { WarningIcon, XIcon } from '@phosphor-icons/react'
import { useAccount } from 'wagmi'

export function DisclaimerBanner() {
  const [isVisible, setIsVisible] = useState(false)
  const { address, isConnected } = useAccount()

  useEffect(() => {
    // Check if user has previously dismissed the banner
    const dismissed = localStorage.getItem('disclaimer-dismissed')
    if (!dismissed) {
      setIsVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    setIsVisible(false)
    localStorage.setItem('disclaimer-dismissed', 'true')
  }

  if (!isVisible) return null

  return (
    <div className="w-full px-4">
      <div className="mx-auto my-2 max-w-[1392px]">
        <div className="flex items-center justify-between gap-3 md:gap-4 bg-[#FEF4E6] border-2 border-[#FAB55A] rounded-[20px] p-3 md:p-4 h-[44px]">
          <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
            <WarningIcon size={24} className="text-[#AF6606] shrink-0" />
            <p className="text-xs md:text-sm font-medium text-gray-800">
              <span className="font-semibold text-[#AF6606]">Disclaimer:</span> EcoVaults is in beta. For safety, we recommend keeping deposits below $1,000.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 cursor-pointer rounded-lg p-1 hover:bg-[#FAB55A]/10 transition-colors"
            aria-label="Dismiss disclaimer"
            title="Dismiss"
          >
            <XIcon size={20} weight="bold" className="text-[#FAB55A]" />
          </button>
        </div>
      </div>
    </div>
  )
}
