// src/components/DepositModal/deposit-success-modal.tsx
"use client";

import { Check, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import CheckIconModal from "../../../../public/check-icon-modal.svg";

interface DepositSuccessModalProps {
  open: boolean;
  onClose: () => void;
  amount: number;
  sourceToken: string;
  destinationAmount: number;
  destinationToken: string;
  vault: string;
}

const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  WETH: "/tokens/weth.png",
  DAI: "/tokens/dai.png",
  USDCe: "/tokens/usdc-icon.png",
};

export function DepositSuccessModal({
  open,
  onClose,
  amount,
  sourceToken,
  destinationAmount,
  destinationToken,
  vault,
}: DepositSuccessModalProps) {
  const sourceTokenIcon = tokenIcons[sourceToken] || "/tokens/usdc-icon.png";
  const destTokenIcon =
    tokenIcons[destinationToken.replace("e", "")] || sourceTokenIcon;

  return (
    <div className={`fixed inset-0 z-[110] ${open ? "" : "pointer-events-none"}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity ${open ? "opacity-100" : "opacity-0"
          }`}
      />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
        <div
          className={`w-full max-w-[400px] my-8 rounded-2xl bg-background border border-border shadow-xl overflow-hidden transform transition-all ${open ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-[18px] font-medium text-foreground">
              Deposit successful
            </h2>
            <div className='bg-[#E7F8F0] rounded-[8px] p-1'>
              <Image src={CheckIconModal} alt="" className='w-4 h-4' />
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            <h3 className="text-sm text-muted-foreground font-normal mb-2 tracking-wide">
              Deposit summary
            </h3>

            {/* Source */}
            <div className="bg-muted rounded-xl p-4 flex items-center gap-3">
              <div className="flex items-center justify-center rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="w-10 h-10 relative">
                  <Image
                    src={sourceTokenIcon}
                    alt={sourceToken}
                    width={40}
                    height={40}
                    className="rounded-[6px]"
                  />
                  {/* Add this badge here */}
                  <div className="absolute -bottom-0.5 -right-2 rounded-sm border-2 border-background">
                    <Image
                      src="/networks/op-icon.png"
                      alt="OP Mainnet"
                      width={16}
                      height={16}
                      className="rounded-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-2xl font-bold text-foreground">
                  {amount.toFixed(2)}
                </p>
                <p className="text-sm text-muted-foreground">
                  ${amount.toFixed(2)} • {sourceToken} on OP Mainnet
                </p>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center mb-2 py-3 border border-border rounded-[12px]">
              <div className="flex items-center justify-center w-8 h-8">
                <ArrowDown size={20} className="text-muted-foreground" />
              </div>
            </div>

            {/* Combined Destination & Vault Container */}
            <div className="border border-border rounded-xl overflow-hidden">
              {/* Destination */}
              <div className="bg-muted p-4 flex items-center gap-3">
                <div className="flex items-center justify-center rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <div className="w-10 h-10 relative">
                    <Image
                      src={destTokenIcon}
                      alt={destinationToken}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                    <div className="absolute -bottom-0.5 -right-2 rounded-sm border-2 border-background">
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
                  <p className="text-2xl font-bold text-foreground">
                    {destinationAmount.toFixed(4)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ${destinationAmount.toFixed(4)} • {destinationToken} on Lisk
                    • Fee: -0.04%
                  </p>
                </div>
              </div>

              {/* Vault with top border */}
              <div className="border-t border-border p-4 flex items-center gap-3">
                <div className="flex items-center justify-center">
                  <div className="w-10 h-10 relative flex-shrink-0">
                    <Image
                      src="/protocols/morpho-icon.png"
                      alt="Vault"
                      width={40}
                      height={40}
                      className="rounded-[6px]"
                    />
                  </div>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground text-sm">
                    Deposited into Vault
                  </p>
                  <p className="text-xs text-muted-foreground">{vault}</p>
                </div>
              </div>
            </div>

            <Button
              onClick={onClose}
              size="lg"
              className="w-full rounded-[12px] text-white bg-[#376FFF] hover:bg-blue-700 text-lg font-normal py-6"
            >
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}