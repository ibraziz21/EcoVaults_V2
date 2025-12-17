// src/components/ClaimRewards/columns.ts
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import Image from "next/image";
import { DataTableColumnHeader } from "../data-table-header";
import { Button } from "@/components/ui/button";

export type ClaimableReward = {
  network: string;
  source: string;
  claimable: string; // numeric string (no token suffix)
  token: string;
  // runtime-only: __raw is attached in the container component
  // __raw?: FlatReward
};

const networkIcons: Record<string, string> = {
  Ethereum: "/networks/ethereum.png",
  Lisk: "/networks/lisk.png",
  Arbitrum: "/networks/arbitrum.png",
  Optimism: "/networks/optimism.png",
  Base: "/networks/base.png",
};

const sourceIcons: Record<string, string> = {
  "Aave V3": "/protocols/aave.png",
  "Morpho Blue": "/protocols/morpho.png",
  Compound: "/protocols/compound.png",
  GMX: "/protocols/gmx.png",
  Merkl: "/protocols/merkle.png",
};

const tokenIcons: Record<string, string> = {
  AAVE: "/tokens/aave.png",
  USDC: "/tokens/usdc.png",
  ETH: "/tokens/eth.png",
  WETH: "/tokens/weth.png",
  GMX: "/tokens/gmx.png",
  USDT: "/tokens/usdt.png",
  LSK: "/tokens/lisk.png",
};

export const ClaimableRewardColumns: ColumnDef<ClaimableReward>[] = [
  {
    accessorKey: "network",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Network" />,
    cell: ({ row }) => {
      const network = row.getValue("network") as string;
      const iconPath = networkIcons[network] || "/networks/default.svg";
      return (
        <div className="flex items-center justify-start gap-2">
          <div className="relative h-5 w-5 rounded-md overflow-hidden">
            <Image
              src={iconPath}
              alt={network}
              width={20}
              height={20}
              className="rounded-none"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
          <span className="font-medium">{network}</span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "source",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Source" />,
    cell: ({ row }) => {
      const source = row.getValue("source") as string;
      const iconPath = sourceIcons[source] || "/protocols/default.svg";
      return (
        <div className="flex items-center justify-start gap-2">
          <div className="relative h-5 w-5 rounded-md overflow-hidden">
            <Image
              src={iconPath}
              alt={source}
              width={20}
              height={20}
              className="rounded-none"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
          <span className="font-medium">{source}</span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "claimable",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Claimable" />,
    cell: ({ row, table }) => {
      const claimable = Number(row.getValue("claimable") as string) || 0;
      const token = row.getValue("token") as string;

      const meta: any = table.options.meta ?? {};
      const priceFn =
        typeof meta.priceUsdForSymbol === "function" ? meta.priceUsdForSymbol : undefined;
      const price = priceFn ? priceFn(token) : 0;
      const usdValue = claimable * price;

      return (
        <div className="text-start">
          <div className="text-[14px] font-normal text-muted-foreground text-start">
            ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "token",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Token" />,
    cell: ({ row }) => {
      const token = row.getValue("token") as string;
      const iconPath = tokenIcons[token] || "/tokens/default.svg";
      return (
        <div className="flex items-center justify-start gap-2">
          <div className="relative h-5 w-5 rounded-md overflow-hidden">
            <Image
              src={iconPath}
              alt={token}
              width={20}
              height={20}
              className="rounded-none"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          </div>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "actions",
    cell: ({ row, table }) => {
      const meta: any = table.options.meta ?? {};
      const onClaim = meta.onClaim as
        | ((row: ClaimableReward & { __raw?: unknown }) => Promise<void>)
        | undefined;
      const isClaiming = typeof meta.isClaiming === "function" ? meta.isClaiming(row.original) : false;

      const handleClaim = async () => {
        try {
          await onClaim?.(row.original as any);
        } catch (e: any) {
          toast.error(e?.message ?? "Claim failed");
        }
      };

      return (
        <Button title="Claim" className="bg-[#376FFF] hover:bg-[#2F5DD1] rounded-[12px] px-3" onClick={handleClaim} disabled={!onClaim || isClaiming}>
          {isClaiming ? "Claiming…" : "Claim"}
        </Button>
      );
    },
    enableSorting: false,
  },
];
