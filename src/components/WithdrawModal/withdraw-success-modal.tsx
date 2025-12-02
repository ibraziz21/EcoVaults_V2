// src/components/WithdrawModal/withdraw-success-modal.tsx
'use client'

import { Check, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Image from 'next/image'

interface WithdrawSuccessModalProps {
  liskAmount: number
  liskToken: 'USDCe' | 'USDT0' | 'WETH'
  destAmount?: number
  destToken?: 'USDC' | 'USDT' | 'WETH'
  destChain?: 'optimism' | 'base' | 'lisk'
  vault: string
  onClose: () => void
}

const tokenIcons: Record<string, string> = {
  USDC: '/tokens/usdc-icon.png',
  USDT: '/tokens/usdt-icon.png',
  USDT0: '/tokens/usdt0-icon.png',
  USDCe: '/tokens/usdc-icon.png',
  WETH: '/tokens/weth.png',
}

const chainName: Record<NonNullable<WithdrawSuccessModalProps['destChain']>, string> = {
  optimism: 'OP Mainnet',
  base: 'Base',
  lisk: 'Lisk',
}

export function WithdrawSuccessModal({
  liskAmount,
  liskToken,
  destAmount,
  destToken,
  destChain = 'optimism',
  vault,
  onClose,
}: WithdrawSuccessModalProps) {
  const liskIcon = tokenIcons[liskToken] || tokenIcons.USDCe
  const destIcon = destToken ? tokenIcons[destToken] : undefined
  const bridged = destChain !== 'lisk' && !!destToken && typeof destAmount === 'number'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto z-[110]">
      <div className="w-full max-w-lg my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden">
        {/* Header - no green background */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-300">Withdrawal successful</h2>
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30">
            <Check size={28} className="text-green-600 dark:text-green-400" strokeWidth={3} />
          </div>
        </div>

        <div className="p-6 space-y-6">
          <h3 className="text-sm text-muted-foreground font-semibold mb-2">Withdrawal summary</h3>

          {/* Withdrawn from vault */}
          <div className="bg-muted rounded-xl p-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 relative flex-shrink-0">
                <Image src="/protocols/morpho-icon.png" alt="Morpho" width={40} height={40} className="rounded-lg" />
              </div>
              <div>
                <div className="font-semibold">Withdrawn from Vault</div>
                <div className="text-xs text-muted-foreground">{vault}</div>
              </div>
            </div>
          </div>

          {/* Lisk amount */}
          <div className="bg-muted rounded-xl p-4 mb-3 flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div className="w-8 h-8 relative">
                <Image src={liskIcon} alt={liskToken} width={32} height={32} className="rounded-full" />
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
            </div>
            <div className="flex-1">
              <p className="text-2xl font-bold text-foreground">{liskAmount.toFixed(4)}</p>
              <p className="text-sm text-muted-foreground">${liskAmount.toFixed(4)} • {liskToken} on Lisk</p>
            </div>
          </div>

          {/* Arrow */}
          {bridged && (
            <div className="flex justify-center py-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                <ArrowDown size={20} className="text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Destination */}
          {bridged && (
            <div className="bg-muted rounded-xl p-4 mb-3 flex items-center gap-3">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="w-8 h-8 relative">
                  <Image src={destIcon!} alt={destToken!} width={32} height={32} className="rounded-full" />
                  {/* Square network badge */}
                  <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                    <Image
                      src={destChain === 'optimism' ? '/networks/op-icon.png' : '/networks/base.png'}
                      alt={chainName[destChain]}
                      width={16}
                      height={16}
                      className="rounded-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-foreground">{(destAmount ?? 0).toFixed(4)}</p>
                <p className="text-sm text-muted-foreground">
                  ${(destAmount ?? 0).toFixed(4)} • {destToken} on {chainName[destChain]}
                </p>
              </div>
            </div>
          )}

          <Button
            onClick={onClose}
            size="lg"
            className="w-full text-white bg-blue-600 hover:bg-blue-700 text-lg font-semibold py-6"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  )
}