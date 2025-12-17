// src/components/tables/VaultsTable/Vaults.tsx
"use client";

import React, { useMemo } from "react";
import VaultsTable from ".";
import { VaultsColumns } from "./columns";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";

// Display names for Morpho Lisk vault tokens
const DISPLAY_TOKEN: Record<string, string> = {
  USDC: "Re7 USDC.e",
  USDT: "Re7 USDT0",
  USDCe: "Re7 USDC.e",
  USDT0: "Re7 USDT0",
  WETH: "Re7 WETH",
};

// Hard filter: only show Lisk + Morpho Blue + (USDC/USDT underlying)
const HARD_FILTER = (
  y: Pick<YieldSnapshot, "chain" | "protocolKey" | "token">,
) =>
  y.chain === "lisk" &&
  y.protocolKey === "morpho-blue" &&
  (y.token === "USDC" || y.token === "USDT");

// Props interface with multi-select filters
interface VaultsProps {
  networkFilter?: string[];
  protocolFilter?: string[];
  filterUI?: React.ReactNode;
}

const Vaults: React.FC<VaultsProps> = ({ networkFilter, protocolFilter, filterUI }) => {
  const { yields, isLoading, error } = useYields();

  const data = useMemo(() => {
    if (!yields || isLoading || error) return [];

    // Keep only Lisk • Morpho Blue • USDC/USDT
    const filtered = yields.filter((y) => HARD_FILTER(y));

    // Map YieldSnapshot -> Vault row shape
    let mapped = filtered.map((snap) => {
      const vaultDisplay = DISPLAY_TOKEN[snap.token] ?? snap.token;
      const routeKey =
        snap.token === "USDC"
          ? "USDCe"
          : snap.token === "USDT"
            ? "USDT0"
            : snap.token;

      return {
        vault: vaultDisplay,
        routeKey,
        network: "Lisk",
        protocol: "Morpho Blue",
        apy: (Number(snap.apy) || 0).toFixed(2),
        tvl: Number.isFinite(snap.tvlUSD)
          ? Math.round(snap.tvlUSD).toLocaleString()
          : "0",
      };
    });

    // Apply network filter
    if (networkFilter && networkFilter.length > 0 && !networkFilter.includes("all")) {
      mapped = mapped.filter((row) => networkFilter.includes(row.network));
    }

    // Apply protocol filter
    if (protocolFilter && protocolFilter.length > 0 && !protocolFilter.includes("all")) {
      mapped = mapped.filter((row) => protocolFilter.includes(row.protocol));
    }

    return mapped;
  }, [yields, isLoading, error, networkFilter, protocolFilter]);

  return <VaultsTable columns={VaultsColumns} data={data} filterUI={filterUI} />;
};

export default Vaults;