// src/lib/positions.ts
// Morpho Blue positions only (Lisk). Keeps OP receipt-token check for pending deposits.
// Returns **shares** for Lisk vaults (and OP receipt tokens are already shares).

import { publicOptimism, publicLisk } from "./clients";
import { MORPHO_POOLS, TokenAddresses, type TokenSymbol } from "./constants";
import { erc20Abi } from "viem";

const DEBUG = process.env.NEXT_PUBLIC_DEBUG_POSITIONS !== "false";

const err = (...args: any[]) => console.error("[positions]", ...args);

/* ──────────────────────────────────────────────────────────────── */
/* Types                                                            */
/* ──────────────────────────────────────────────────────────────── */

export type EvmChain = "lisk";

export interface Position {
  protocol: "Morpho Blue";
  chain: EvmChain;
  token: Extract<TokenSymbol, "USDCe" | "USDT0" | "WETH">;
  /** Amount is in **shares** (ERC-4626 share tokens for Lisk, sVault shares on OP). */
  amount: bigint;
}

/** Anything below this is treated as dust and ignored as a "position". */
export const DUST_SHARES = 10n ** 12n;

/* ──────────────────────────────────────────────────────────────── */
/* Morpho Blue (Lisk) – return **shares** (ERC-4626 share token)   */
/* ──────────────────────────────────────────────────────────────── */

const MORPHO_VAULT_BY_TOKEN: Record<
  Extract<TokenSymbol, "USDCe" | "USDT0" | "WETH">,
  `0x${string}`
> = {
  USDCe: MORPHO_POOLS["usdce-supply"] as `0x${string}`,
  USDT0: MORPHO_POOLS["usdt0-supply"] as `0x${string}`,
  WETH: MORPHO_POOLS["weth-supply"] as `0x${string}`,
};

/** Read the user's **share** balance directly from the vault (ERC20 balanceOf). */
async function morphoSharesLisk(
  token: Extract<TokenSymbol, "USDCe" | "USDT0" | "WETH">,
  user: `0x${string}`
): Promise<bigint> {
  const vault = MORPHO_VAULT_BY_TOKEN[token];

  try {
    const shares = (await publicLisk.readContract({
      address: vault,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user],
    })) as bigint;

    return shares ?? 0n;
  } catch (e) {
    err("morphoSharesLisk.error", e);
    return 0n;
  }
}

/* ──────────────────────────────────────────────────────────────── */
/* Optimism receipt tokens (sVault) — also **shares**               */
/* ──────────────────────────────────────────────────────────────── */

const maxBigint = (a: bigint, b: bigint) => (a > b ? a : b);

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

/**
 * For USDCe: return the greater of OP receipt **shares** and Lisk vault **shares**.
 * This keeps your “pending deposit” logic intact but now everything is in shares.
 */
async function morphoUSDCeSharesViaReceiptOrLisk(
  user: `0x${string}`
): Promise<bigint> {
  const [receiptShares, liskShares] = await Promise.all([
    fetchReceiptBalance(user, "USDC"),
    morphoSharesLisk("USDCe", user),
  ]);
  return maxBigint(receiptShares, liskShares);
}

/**
 * For USDT0: return the greater of OP receipt **shares** and Lisk vault **shares**.
 */
async function morphoUSDT0SharesViaReceiptOrLisk(
  user: `0x${string}`
): Promise<bigint> {
  const [receiptShares, liskShares] = await Promise.all([
    fetchReceiptBalance(user, "USDT"),
    morphoSharesLisk("USDT0", user),
  ]);
  return maxBigint(receiptShares, liskShares);
}

/* ──────────────────────────────────────────────────────────────── */
/* Aggregator – fetch all positions (shares)                        */
/* ──────────────────────────────────────────────────────────────── */

export async function fetchPositions(
  user: `0x${string}`
): Promise<Position[]> {
  const tasks: Promise<Position>[] = [];

  tasks.push(
    morphoUSDCeSharesViaReceiptOrLisk(user).then((amt) => ({
      protocol: "Morpho Blue" as const,
      chain: "lisk" as const,
      token: "USDCe" as const,
      amount: amt,
    }))
  );

  tasks.push(
    morphoUSDT0SharesViaReceiptOrLisk(user).then((amt) => ({
      protocol: "Morpho Blue" as const,
      chain: "lisk" as const,
      token: "USDT0" as const,
      amount: amt,
    }))
  );

  tasks.push(
    morphoSharesLisk("WETH", user)
      .then((amt) => ({
        protocol: "Morpho Blue" as const,
        chain: "lisk" as const,
        token: "WETH" as const,
        amount: amt,
      }))
      .catch(() => ({
        protocol: "Morpho Blue" as const,
        chain: "lisk" as const,
        token: "WETH" as const,
        amount: 0n,
      }))
  );

  const raw = await Promise.all(tasks);

  // ✅ Only keep positions above dust – this is “how many pools the user is in”
  const nonDust = raw.filter((p) => p.amount > DUST_SHARES);

  if (DEBUG) {
    console.debug("[positions] raw:", raw);
    console.debug("[positions] nonDust:", nonDust);
  }

  return nonDust;
}
