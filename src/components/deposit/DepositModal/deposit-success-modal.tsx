// src/components/DepositModal/deposit-success-modal.tsx
"use client"

import { Check, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import Image from "next/image"

interface DepositSuccessModalProps {
  amount: number
  sourceToken: string
  destinationAmount: number
  destinationToken: string
  vault: string
  onClose: () => void
}

const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  WETH: "/tokens/weth.png",
  DAI: "/tokens/dai.png",
  USDCe: "/tokens/usdc-icon.png",
}

export function DepositSuccessModal({
  amount,
  sourceToken,
  destinationAmount,
  destinationToken,
  vault,
  onClose,
}: DepositSuccessModalProps) {
  const sourceTokenIcon = tokenIcons[sourceToken] || "/tokens/usdc-icon.png"
  const destTokenIcon = tokenIcons[destinationToken.replace("e", "")] || sourceTokenIcon

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto z-50">
      <div className="w-full max-w-lg my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden">
        {/* Header -  */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground">Deposit successful</h2>
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30">
            <Check size={28} className="text-green-600 dark:text-green-400" strokeWidth={3} />
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm text-muted-foreground font-semibold mb-4 uppercase tracking-wide">
              Deposit summary
            </h3>

            {/* Source */}
            <div className="bg-muted rounded-xl p-4 mb-3 flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="w-8 h-8 relative">
                  <Image src={sourceTokenIcon} alt={sourceToken} width={32} height={32} className="rounded-full" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-foreground">{amount.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">${amount.toFixed(2)} • {sourceToken} on OP Mainnet</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center py-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                <ArrowDown size={20} className="text-muted-foreground" />
              </div>
            </div>

            {/* Destination */}
            <div className="bg-muted rounded-xl p-4 mb-3 flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="w-8 h-8 relative">
                  <Image src={destTokenIcon} alt={destinationToken} width={32} height={32} className="rounded-full" />
                </div>
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-foreground">{destinationAmount.toFixed(4)}</p>
                <p className="text-sm text-muted-foreground">${destinationAmount.toFixed(4)} • {destinationToken} on Lisk • Fee: -0.04%</p>
              </div>
            </div>

            {/* Vault */}
            <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl p-4 flex items-center gap-3 border border-blue-100 dark:border-blue-800">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-blue-200 dark:border-blue-700 flex-shrink-0">
                <div className="w-8 h-8 relative">
                  <Image src="/protocols/morpho-icon.png" alt="Vault" width={32} height={32} className="rounded-full" />
                </div>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground text-sm">Deposited into Vault</p>
                <p className="text-xs text-muted-foreground">{vault}</p>
              </div>
            </div>
          </div>

          <Button onClick={onClose} size="lg" className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6 disabled:opacity-60">
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}