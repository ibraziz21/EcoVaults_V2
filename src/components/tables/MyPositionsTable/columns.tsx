import { ColumnDef } from "@tanstack/react-table";
import Image from "next/image";

export type Position = {
  vault: string;
  network: string;
  deposits: string;
  protocol: string;
  apy: string;
  routeKey?: string; // 👈 add this
};


import { DataTableColumnHeader } from "../data-table-header";

// Token icon mapping (reusing from ClaimRewards)
const tokenIcons: Record<string, string> = {
  USDC: "/tokens/usdc-icon.png",
  USDCe: "/tokens/usdc-icon.png",
  USDCE: "/tokens/usdc-icon.png",
  USDT: "/tokens/usdt-icon.png",
  USDT0: "/tokens/usdt0-icon.png",
  WETH: "/tokens/weth.png",
  DAI: "/tokens/dai.png",
};

// Network icon mapping
const networkIcons: Record<string, string> = {
  Ethereum: "/networks/ethereum.png",
  Lisk: "/networks/lisk.png",
  Arbitrum: "/networks/arbitrum.png",
  Optimism: "/networks/op-icon.png",
  Base: "/networks/base.png",
};

// Protocol icon mapping
const protocolIcons: Record<string, string> = {
  "Aave V3": "/protocols/aave.png",
  "Morpho Blue": "/protocols/morpho-icon.png",
  Compound: "/protocols/compound.png",
  Yearn: "/protocols/yearn.png",
  Merkle: "/protocols/merkle.png",
};

export const MyPositionsColumns: ColumnDef<Position>[] = [
  {
    accessorKey: "vault",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Vault" />
    ),
    cell: ({ row }) => {
      const vault = String(row.getValue("vault") ?? "");

      // Strip "Re7 " prefix and normalize the token part (USDC.e, USDT0, etc.)
      const base = vault.replace(/^Re7\s+/i, "").trim(); // e.g. "USDC.e", "USDT0"
      const key = base.replace(/\./g, "").toUpperCase(); // e.g. "USDCE", "USDT0"

      const iconPath =
        // direct matches first
        tokenIcons[base] ||
        tokenIcons[key] ||
        // family fallbacks (so USDCE/USDC.e → USDC icon, USDT0 → USDT0 icon, etc.)
        (/^USDC/.test(key)
          ? tokenIcons.USDC
          : /^USDT0/.test(key)
            ? tokenIcons.USDT0
            : /^USDT/.test(key)
              ? tokenIcons.USDT
              : /^WETH/.test(key)
                ? tokenIcons.WETH
                : tokenIcons.DAI) || "/tokens/default.svg";

      return (
        <div className="flex items-center justify-start gap-2">
          <div className="w-5 h-5 relative">
            <Image
              src={iconPath}
              alt={vault}
              width={24}
              height={24}
              className="rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className="font-medium">{vault}</span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "network",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Network" />
    ),
    cell: ({ row }) => {
      const network = row.getValue("network") as string;
      const iconPath = networkIcons[network] || "/networks/default.svg";

      return (
        <div className="flex items-center justify-start gap-2">
          <div className="w-5 h-5 relative rounded-sm overflow-hidden">
            <Image
              src={iconPath}
              alt={network}
              width={24}
              height={24}
              className="rounded-none"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className="font-medium">{network}</span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "deposits",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Deposits" />
    ),
    cell: ({ row }) => {
      const deposits = row.getValue("deposits") as string;

      return (
        <div className="text-start">
          <div className="font-medium">${Number(deposits).toFixed(2)}</div>
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "protocol",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Protocol" />
    ),
    cell: ({ row }) => {
      const protocol = row.getValue("protocol") as string;
      const iconPath = protocolIcons[protocol] || "/protocols/default.svg";

      return (
        <div className="flex items-center justify-start gap-2">
          <div className="w-5 h-5 relative rounded-sm overflow-hidden">
            <Image
              src={iconPath}
              alt={protocol}
              width={24}
              height={24}
              className="rounded-none"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span className="font-medium">{protocol}</span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "apy",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="APY" />
    ),
    cell: ({ row }) => {
      const apy = row.getValue("apy") as string;

      return (
        <div className="text-start">
          <div className="font-medium ">{apy}%</div>
        </div>
      );
    },
    enableSorting: true,
  },
];
