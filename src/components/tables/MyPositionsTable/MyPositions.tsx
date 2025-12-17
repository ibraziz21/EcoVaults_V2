// src/components/MyPositions/MyPositions.tsx
"use client";

import React, { useMemo } from "react";
import MyPositionsTable from ".";
import { MyPositionsColumns, type Position as TableRow } from "./columns";
import { usePositions } from "@/hooks/usePositions";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";
import {
  type Position as BasePosition,
  DUST_SHARES,
} from "@/lib/positions";
import { MORPHO_POOLS, TokenAddresses } from "@/lib/constants";

type EvmChain = "lisk";
type MorphoToken = "USDCe" | "USDT0" | "WETH";

type PositionLike =
  | BasePosition
  | {
    protocol: "Morpho Blue";
    chain: Extract<EvmChain, "lisk">;
    token: MorphoToken;
    amount: bigint;
  };

const CHAIN_LABEL: Record<EvmChain, string> = { lisk: "Lisk" };

const MORPHO_VAULT_BY_TOKEN: Record<MorphoToken, `0x${string}`> = {
  USDCe: MORPHO_POOLS["usdce-supply"] as `0x${string}`,
  USDT0: MORPHO_POOLS["usdt0-supply"] as `0x${string}`,
  WETH: MORPHO_POOLS["weth-supply"] as `0x${string}`,
};

const TOKEN_DECIMALS: Record<MorphoToken, number> = {
  USDCe: 6,
  USDT0: 6,
  WETH: 18,
};

export function formatAmountBigint(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;

  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac === 0n) return `${neg ? "-" : ""}${wholeStr}`;

  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.slice(0, Math.min(6, fracStr.length));
  fracStr = fracStr.replace(/0+$/, "");
  return `${neg ? "-" : ""}${wholeStr}${fracStr ? "." + fracStr : ""}`;
}

function formatPercent(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function normalizeDisplayVault(token: string): string {
  if (token === "USDCe") return "Re7 USDC.e";
  if (token === "USDT0") return "Re7 USDT0";
  if (token === "WETH") return "Re7 WETH";
  return token;
}

function findSnapshotForPosition(
  p: PositionLike,
  snapshots: YieldSnapshot[] | undefined
): YieldSnapshot {
  const normToken = String(p.token).toLowerCase();

  const direct = snapshots?.find(
    (y) =>
      y.chain === p.chain &&
      y.protocolKey === "morpho-blue" &&
      String(y.token).toLowerCase() ===
      (normToken === "usdce"
        ? "usdc"
        : normToken === "usdt0"
          ? "usdt"
          : normToken)
  );
  if (direct) return direct;

  const vault = MORPHO_VAULT_BY_TOKEN[p.token as MorphoToken];
  if (vault) {
    const byVault = snapshots?.find(
      (y) =>
        y.protocolKey === "morpho-blue" &&
        y.chain === "lisk" &&
        y.poolAddress?.toLowerCase() === vault.toLowerCase()
    );
    if (byVault) return byVault;
  }

  const underlyingAddr: `0x${string}` =
    p.token === "USDCe"
      ? (TokenAddresses.USDCe as any).lisk
      : p.token === "USDT0"
        ? (TokenAddresses.USDT0 as any).lisk
        : (TokenAddresses.WETH as any).lisk;

  const fallback: YieldSnapshot = {
    id: `fallback-Morpho-${p.chain}-${String(p.token)}`,
    chain: p.chain as any,
    protocol: "Morpho Blue",
    protocolKey: "morpho-blue",
    poolAddress: vault ?? "0x0000000000000000000000000000000000000000",
    token: p.token as any,
    apy: 0,
    tvlUSD: 0,
    updatedAt: new Date().toISOString(),
    underlying: underlyingAddr,
  };
  return fallback;
}

interface MyPositionsProps {
  networkFilter?: string[];
  protocolFilter?: string[];
  filterUI?: React.ReactNode;
}

const MyPositions: React.FC<MyPositionsProps> = ({
  networkFilter,
  protocolFilter,
  filterUI,
}) => {
  const { data: positionsRaw, isLoading: positionsLoading } = usePositions();
  const { yields: snapshots, isLoading: yieldsLoading } = useYields();

  const positions = useMemo(
    () => (positionsRaw ?? []) as unknown as PositionLike[],
    [positionsRaw]
  );

  const positionsForMorpho: PositionLike[] = useMemo(() => {
    return positions.filter((p) => {
      if (p.protocol !== "Morpho Blue") return false;
      if (p.chain !== "lisk") return false;

      const amt = (p as any).amount as bigint | undefined;
      if (typeof amt !== "bigint") return false;

      // same dust cutoff as lib/positions
      return amt > DUST_SHARES;
    });
  }, [positions]);

  const tableData: TableRow[] = useMemo(() => {
    let filtered = positionsForMorpho.map((p) => {
      const snap = findSnapshotForPosition(p, snapshots);
      const depositsHuman = formatAmountBigint(p.amount ?? 0n, 18);

      const tokenSymbol = String(p.token); // "USDCe" | "USDT0" | "WETH"

      return {
        // Display text on the row
        vault: normalizeDisplayVault(tokenSymbol), // e.g. "Re7 USDC.e"
        // Canonical route key for URLs
        routeKey: tokenSymbol, // used by MyPositionsTable for /vaults/USDCe
        network: CHAIN_LABEL[p.chain],
        deposits: depositsHuman,
        protocol: "Morpho Blue",
        apy: formatPercent(snap.apy),
      };
    });

    if (networkFilter && networkFilter.length > 0 && !networkFilter.includes("all")) {
      filtered = filtered.filter((row) => networkFilter.includes(row.network));
    }

    if (protocolFilter && protocolFilter.length > 0 && !protocolFilter.includes("all")) {
      filtered = filtered.filter((row) => protocolFilter.includes(row.protocol));
    }

    return filtered;
  }, [positionsForMorpho, snapshots, networkFilter, protocolFilter]);

  if (positionsLoading || yieldsLoading) {
    return (
      <div className="rounded-xl border border-border/60 p-4 text-sm text-muted-foreground">
        Loading positions…
      </div>
    );
  }

  return (
    <MyPositionsTable
      columns={MyPositionsColumns}
      data={tableData}
      emptyMessage="No active positions yet."
      emptySubMessage="Explore vaults to start earning."
      filterUI={filterUI}
    />
  );
};

export default MyPositions;
