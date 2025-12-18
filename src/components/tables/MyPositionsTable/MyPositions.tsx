// src/components/MyPositions/MyPositions.tsx
"use client";

import React, { useMemo } from "react";
import MyPositionsTable from ".";
import { MyPositionsColumns, type Position as TableRow } from "./columns";
import { usePositions } from "@/hooks/usePositions";
import { useYields, type YieldSnapshot } from "@/hooks/useYields";
import { formatUnits } from "viem";

type ReceiptToken = "USDC" | "USDT";
type VaultRouteKey = "USDCe" | "USDT0";
type DisplayVault = "Re7 USDC.e" | "Re7 USDT0";

type ReceiptPosition = {
  protocol: "sVault Receipt";
  chain: "optimism";
  token: ReceiptToken;
  amount: bigint;
};

function formatPercent(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function receiptToVault(token: ReceiptToken): {
  routeKey: VaultRouteKey;
  displayVault: DisplayVault;
  canonicalUnderlying: "USDC" | "USDT";
} {
  if (token === "USDT") {
    return { routeKey: "USDT0", displayVault: "Re7 USDT0", canonicalUnderlying: "USDT" };
  }
  return { routeKey: "USDCe", displayVault: "Re7 USDC.e", canonicalUnderlying: "USDC" };
}

function findMorphoLiskSnapshot(
  canonicalUnderlying: "USDC" | "USDT",
  snapshots: YieldSnapshot[] | undefined
): YieldSnapshot | undefined {
  return snapshots?.find(
    (y) =>
      y.chain === "lisk" &&
      y.protocolKey === "morpho-blue" &&
      String(y.token).toUpperCase() === canonicalUnderlying
  );
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

  const receiptPositions = useMemo(() => {
    const arr = (positionsRaw ?? []) as any[];

    // Debug what we received (helps catch mismatched protocol/chain names)
    console.debug(
      "[MyPositions] positionsRaw:",
      arr.map((p) => ({
        protocol: p?.protocol,
        chain: p?.chain,
        token: p?.token,
        amount: typeof p?.amount === "bigint" ? p.amount.toString() : String(p?.amount),
      }))
    );

    return arr
      .filter((p): p is ReceiptPosition => {
        const protocolOk = String(p?.protocol ?? "").toLowerCase() === "svault receipt";
        const chainOk = String(p?.chain ?? "").toLowerCase() === "optimism";
        const token = String(p?.token ?? "").toUpperCase();
        const tokenOk = token === "USDC" || token === "USDT";
        const amtOk = typeof p?.amount === "bigint";
        return protocolOk && chainOk && tokenOk && amtOk;
      })
      .map((p) => ({
        protocol: "sVault Receipt" as const,
        chain: "optimism" as const,
        token: String(p.token).toUpperCase() as ReceiptToken,
        amount: (p.amount ?? 0n) as bigint,
      }));
  }, [positionsRaw]);

  const tableData: TableRow[] = useMemo(() => {
    let rows: TableRow[] = receiptPositions
      // only show non-zero positions
      .filter((p) => (p.amount ?? 0n) > 0n)
      .map((p) => {
        const { routeKey, displayVault, canonicalUnderlying } = receiptToVault(p.token);

        // receipts are 6 decimals; keep deposits as plain numeric string (NO commas)
        const depositsNumericStr = String(formatUnits(p.amount ?? 0n, 6));

        const snap = findMorphoLiskSnapshot(canonicalUnderlying, snapshots);
        const apy = snap ? formatPercent(Number(snap.apy) || 0) : formatPercent(0);

        return {
          vault: displayVault,        // UI text stays the same format you already use
          routeKey,                   // used by row click -> /vaults/USDCe or /vaults/USDT0
          network: "Lisk",            // vault lives on Lisk (UI expectation)
          deposits: depositsNumericStr,
          protocol: "Morpho Blue",
          apy,
        };
      });

    if (networkFilter && networkFilter.length > 0 && !networkFilter.includes("all")) {
      rows = rows.filter((row) => networkFilter.includes(row.network));
    }

    if (protocolFilter && protocolFilter.length > 0 && !protocolFilter.includes("all")) {
      rows = rows.filter((row) => protocolFilter.includes(row.protocol));
    }

    return rows;
  }, [receiptPositions, snapshots, networkFilter, protocolFilter]);

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
