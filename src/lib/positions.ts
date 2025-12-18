// src/lib/positions.ts
// OP receipt-token positions only (sVault). These are the user's withdrawable **shares** on OP.

import { publicOptimism } from "./clients";
import { TokenAddresses, type TokenSymbol } from "./constants";
import { erc20Abi } from "viem";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== "false";
const err = (...args: any[]) => console.error("[positions]", ...args);

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export type EvmChain = "optimism";

export interface Position {
  protocol: "sVault Receipt";
  chain: EvmChain;
  /**
   * We expose these as "USDC" / "USDT" because that's what the receipt shares correspond to on OP.
   * (USDC receipt -> Lisk USDCe vault, USDT receipt -> Lisk USDT0 vault)
   */
  token: Extract<TokenSymbol, "USDC" | "USDT">;
  /** Amount is in **shares** (receipt token balanceOf) */
  amount: bigint;
}

/** Anything below this is treated as dust and ignored as a "position". */
export const DUST_SHARES = 1000n;

/* ──────────────────────────────────────────────────────────────── */
/* Receipt balances (OP)                                            */
/* ──────────────────────────────────────────────────────────────── */

async function fetchReceiptBalance(
  user: `0x${string}`,
  which: "USDC" | "USDT"
): Promise<bigint> {
  const addr =
    which === "USDC"
      ? (TokenAddresses.sVault.optimismUSDC as `0x${string}`)
      : (TokenAddresses.sVault.optimismUSDT as `0x${string}`);

  if (!addr || addr === "0x0000000000000000000000000000000000000000") return 0n;

  try {
    const bal = (await publicOptimism.readContract({
      address: addr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user],
    })) as bigint;

    return bal ?? 0n;
  } catch (e) {
    err("fetchReceiptBalance.error", { which, e });
    return 0n;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all receipt positions                          */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(user: `0x${string}`): Promise<Position[]> {
  const [usdcShares, usdtShares] = await Promise.all([
    fetchReceiptBalance(user, "USDC"),
    fetchReceiptBalance(user, "USDT"),
  ]);

  const raw: Position[] = [
    {
      protocol: "sVault Receipt",
      chain: "optimism",
      token: "USDC",
      amount: usdcShares,
    },
    {
      protocol: "sVault Receipt",
      chain: "optimism",
      token: "USDT",
      amount: usdtShares,
    },
  ];

  const nonDust = raw.filter((p) => p.amount > DUST_SHARES);

  if (DEBUG) {
    console.debug("[positions] raw:", raw);
    console.debug("[positions] nonDust:", nonDust);
  }

  console.log("[positions] raw:", raw)

  return nonDust;
}
