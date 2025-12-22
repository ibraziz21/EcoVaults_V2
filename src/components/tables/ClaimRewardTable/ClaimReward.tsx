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
  symbol: "USDC" | "USDT";
  vault: `0x${string}`;
  earned: bigint;
};

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

    const rows: (ClaimableReward & { __raw: RowRaw })[] = [];

    const pushRow = (
      symbol: "USDC" | "USDT",
      tokenData: DualRewardsData["byToken"]["USDC" | "USDT"]
    ) => {
      const earned = tokenData.earned ?? 0n;
      const human = Number(formatUnits(earned, 6)); // USDC/USDT assumed 6 decimals

      rows.push({
        network: "OP Mainnet",
        source: "Morpho Blue",
        claimable: human.toString(),
        token: symbol,
        __raw: { symbol, vault: tokenData.vault, earned },
      });
    };

    if (dualRewards.byToken.USDC) pushRow("USDC", dualRewards.byToken.USDC);
    if (dualRewards.byToken.USDT) pushRow("USDT", dualRewards.byToken.USDT);

    return rows;
  }, [dualRewards]);

  function onClaimClick(row: ClaimableReward & { __raw?: RowRaw }) {
    if (!isConnected || !wallet || !userAddr) return openConnect();
    setSelectedReward(row);
    setShowModal(true);
  }

  async function handleModalClaim() {
    if (!wallet || !userAddr || !selectedReward) return;

    const item = selectedReward.__raw!;
    const { vault } = item;

    try {
      const key = vault.toLowerCase();
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
      await signer.writeContract({
        address: vault,
        abi: rewardsAbi as any,
        functionName: "claimRewardsUpToAvailable", // or "claimRewards"
        args: [],
        account: signer.account, // Safe connector: this is the Safe address
      });

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
              return !!raw && claimingKey === raw.vault.toLowerCase();
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
          rewards={[
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
          ]}
        />
      )}
    </>
  );
};

export default ClaimRewards;