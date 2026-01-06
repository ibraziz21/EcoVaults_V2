// src/components/ClaimRewards/ClaimRewards.tsx
"use client";

import React, { useMemo, useState } from "react";
import ClaimRewardTable from ".";
import { ClaimableRewardColumns, type ClaimableReward } from "./columns";

import { useAccount, useConnect, useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { optimism } from "viem/chains";
import type { Address } from "viem";
import { formatUnits } from "viem";
import { Loader2 } from "lucide-react";

import { useVaultRewards, type DualRewardsData } from "@/hooks/useVaultRewards";
import rewardsAbi from "@/lib/abi/rewardsAbi.json";
import { useUsdPrices } from "@/hooks/useUSDPrices";
import { ClaimRewardsModal } from "@/components/claim-rewards-modal";

type RowRaw = {
  rewards: Array<{
    symbol: "USDC" | "USDT";
    vault: `0x${string}`;
    earned: bigint;
    usd: number;
  }>;
  usdTotal: number;
};

const MIN_DISPLAY_AMOUNT = 0.01; // anything below this is treated as zero / hidden

const ClaimRewards: React.FC = () => {
  const { address: accountAddress, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  function openConnect() {
    const safeConn = connectors.find((c) => c.id === "safe");
    const injectedConn = connectors.find((c) => c.id === "injected");
    const connector = safeConn ?? injectedConn ?? connectors[0];
    if (!connector) throw new Error("No wallet connectors available");
    connect({ connector });
  }

  const { data: wallet, refetch: refetchWalletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const activeChainId = useChainId();

  const { data: dualRewards, isLoading, refetch, user } = useVaultRewards();
  const { priceUsdForSymbol } = useUsdPrices();

  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedReward, setSelectedReward] = useState<
    (ClaimableReward & { __raw?: RowRaw }) | null
  >(null);

  const userAddr = (user ?? accountAddress) as Address | undefined;

  const tableData: (ClaimableReward & { __raw: RowRaw })[] = useMemo(() => {
    if (!dualRewards) return [];

    const rewards: RowRaw["rewards"] = [];

    const pushReward = (
      symbol: "USDC" | "USDT",
      tokenData: DualRewardsData["byToken"]["USDC" | "USDT"]
    ) => {
      const earned = tokenData.earned ?? 0n;
      const human = Number(formatUnits(earned, 6)); // USDC/USDT assumed 6 decimals
      if (human < MIN_DISPLAY_AMOUNT) return;
      rewards.push({ symbol, vault: tokenData.vault, earned, usd: human * priceUsdForSymbol(symbol) });
    };

    if (dualRewards.byToken.USDC) pushReward("USDC", dualRewards.byToken.USDC);
    if (dualRewards.byToken.USDT) pushReward("USDT", dualRewards.byToken.USDT);

    const usdTotal = rewards.reduce((s, r) => s + r.usd, 0);
    if (rewards.length === 0 || usdTotal < MIN_DISPLAY_AMOUNT) return [];

    return [
      {
        network: "OP Mainnet",
        source: "Morpho Blue",
        claimable: usdTotal.toFixed(2), // USD total
        token: "USDC & USDT",
        __raw: { rewards, usdTotal },
      },
    ];
  }, [dualRewards, priceUsdForSymbol]);

  function onClaimClick(row: ClaimableReward & { __raw?: RowRaw }) {
    if (!isConnected || !wallet || !userAddr) return openConnect();
    setSelectedReward(row);
    setShowModal(true);
  }

  async function handleModalClaim() {
    if (!wallet || !userAddr || !selectedReward) return;

    const item = selectedReward.__raw!;
    const rewards = item.rewards ?? [];
    if (rewards.length === 0) return;

    try {
      const key = rewards[0].vault.toLowerCase();
      setClaimingKey(key);

      // ensure Optimism
      let signer = wallet;
      if (activeChainId !== optimism.id && switchChainAsync) {
        await switchChainAsync({ chainId: optimism.id });
        const refreshed = (await refetchWalletClient()).data;
        if (refreshed) signer = refreshed;
      }
      if (!signer) throw new Error("No wallet client available after chain switch");

      // ✅ ABI has claimRewards() / claimRewardsUpToAvailable() (no args)
      for (const r of rewards) {
        await signer.writeContract({
          address: r.vault,
          abi: rewardsAbi as any,
          functionName: "claimRewardsUpToAvailable", // or "claimRewards"
          args: [],
          account: signer.account, // Safe connector: this is the Safe address
        });
      }

      await refetch();
    } catch (err) {
      console.error("[ClaimRewards] claim error:", err);
      throw err;
    } finally {
      setClaimingKey(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading claimable rewards…
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        <ClaimRewardTable
          columns={ClaimableRewardColumns}
          data={tableData as ClaimableReward[]}
          meta={{
            onClaim: onClaimClick,
            priceUsdForSymbol,
            isClaiming: (r: any) => {
              const raw = (r as any).__raw as RowRaw | undefined;
              const key = raw?.rewards?.[0]?.vault?.toLowerCase?.();
              return !!key && claimingKey === key;
            },
          }}
          emptyMessage="No rewards to claim yet."
          emptySubMessage="Keep your vaults active to start earning."
        />
      </div>

      {selectedReward && (
        <ClaimRewardsModal
          isOpen={showModal}
          onClose={() => {
            setShowModal(false);
            setSelectedReward(null);
          }}
          onClaim={handleModalClaim}
          rewards={
            selectedReward.__raw?.rewards?.length
              ? selectedReward.__raw.rewards.map((r) => ({
                  token: r.symbol,
                  symbol: `${Number(formatUnits(r.earned, 6)).toFixed(4)} ${r.symbol}`,
                  amount: Number(formatUnits(r.earned, 6)),
                  usdValue: r.usd,
                  icon: `/tokens/${r.symbol.toLowerCase()}-icon.png`,
                  color: r.symbol === "USDC" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-cyan-100 dark:bg-cyan-900/30",
                  checked: true,
                }))
              : [
                  {
                    token: selectedReward.token,
                    symbol: `${selectedReward.claimable} ${selectedReward.token}`,
                    amount: parseFloat(selectedReward.claimable),
                    usdValue:
                      parseFloat(selectedReward.claimable) *
                      priceUsdForSymbol(selectedReward.token),
                    icon: `/tokens/${selectedReward.token.toLowerCase()}-icon.png`,
                    color: "bg-blue-100 dark:bg-blue-900/30",
                    checked: true,
                  },
                ]
          }
        />
      )}
    </>
  );
};

export default ClaimRewards;
