import { createAcrossClient } from "@across-protocol/app-sdk";
import { base, optimism, lisk } from "viem/chains";

export const client = createAcrossClient({
   // 2-byte hex string
  chains: [base, optimism, lisk],

});