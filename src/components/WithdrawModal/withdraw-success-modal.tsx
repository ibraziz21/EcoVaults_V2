"use client";

import { Check, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import CheckIconModal from "../../../public/check-icon-modal.svg";

interface WithdrawSuccessModalProps {
  open: boolean; // <-- ADDED: controlled by parent
  onClose: () => void;
  liskAmount: number;
  liskToken: "USDCe" | "USDT0" | "WETH";
  destAmount?: number;
  destToken?: "USDC" | "USDT" | "WETH";
  destChain?: "optimism" | "base" | "lisk";
  vault: string;
}

const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  USDCe: "/tokens/usdc-icon.png",
  WETH: "/tokens/weth.png",
};

const chainName: Record<NonNullable<WithdrawSuccessModalProps["destChain"]>, string> = {
  optimism: "OP Mainnet",
  base: "Base",
  lisk: "Lisk",
};

export function WithdrawSuccessModal({
  open,
  onClose,
  liskAmount,
  liskToken,
  destAmount,
  destToken,
  destChain = "optimism",
  vault,
}: WithdrawSuccessModalProps) {
  const liskIcon = tokenIcons[liskToken] || tokenIcons.USDCe;
  const destIcon = destToken ? tokenIcons[destToken] : undefined;
  const bridged = destChain !== "lisk" && !!destToken && typeof destAmount === "number";

  // FIXED: Match review modal width and animation
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
            <h2 className="text-[18px] font-medium text-black">
              Withdrawal successful
            </h2>
            <div className='bg-[#E7F8F0] rounded-[8px] p-1'>
              <Image src={CheckIconModal} alt="" className='w-4 h-4' />
            </div>
          </div>

          <div className="p-6 space-y-6">
            <h3 className="text-sm text-muted-foreground font-normal mb-2">Withdrawal summary</h3>

            <div className="border border-border rounded-xl">
              {/* Withdrawn from vault */}
              <div className="rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 relative flex-shrink-0">
                    <Image
                      src="/protocols/morpho-icon.png"
                      alt="Morpho"
                      width={40}
                      height={40}
                      className="rounded-[6px]"
                    />
                  </div>
                  <div>
                    <div className="font-semibold">Withdrawn from Vault</div>
                    <div className="text-xs text-muted-foreground">{vault}</div>
                  </div>
                </div>
              </div>

              {/* Lisk amount */}
              <div className="bg-muted rounded-b-xl p-4 flex items-center gap-3">
                <div className="flex items-center justify-center  rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <div className="w-10 h-10 relative">
                    <Image
                      src={liskIcon}
                      alt={liskToken}
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
                  <p className="text-2xl font-bold text-foreground">{liskAmount.toFixed(4)}</p>
                  <p className="text-sm text-muted-foreground">
                    ${liskAmount.toFixed(4)} • {liskToken} on Lisk
                  </p>
                </div>
              </div>
            </div>

            {/* Arrow */}
            {bridged && (
              <div className="flex justify-center py-3 border border-border rounded-[12px]">
                <div className="flex items-center justify-center w-8 h-8 ">
                  <ArrowDown size={20} className="text-muted-foreground" />
                </div>
              </div>
            )}

            {/* Destination */}
            {bridged && (
              <div className="bg-muted rounded-xl p-4 flex items-center gap-3">
                <div className="flex items-center justify-center rounded-full bg-white border border-gray-200 dark:border-gray-700 flex-shrink-0">
                  <div className="w-10 h-10 relative">
                    <Image
                      src={destIcon!}
                      alt={destToken!}
                      width={40}
                      height={40}
                      className="rounded-full"
                    />
                    <div className="absolute -bottom-0.5 -right-2 rounded-sm border-2 border-background">
                      <Image
                        src={
                          destChain === "optimism"
                            ? "/networks/op-icon.png"
                            : "/networks/base.png"
                        }
                        alt={chainName[destChain]}
                        width={16}
                        height={16}
                        className="rounded-sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold text-foreground">
                    {(destAmount ?? 0).toFixed(4)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    ${(destAmount ?? 0).toFixed(4)} • {destToken} on {chainName[destChain]}
                  </p>
                </div>
              </div>
            )}

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

      {/* FIXED: Removed nested rendering, now controlled by parent */}
    </div>
  );
}