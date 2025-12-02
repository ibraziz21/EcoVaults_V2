// status.ts
export const ORDER = [
    'PENDING',
    'BRIDGE_IN_FLIGHT',
    'BRIDGED',
    'DEPOSITING',
    'DEPOSITED',
    'MINTING',
    'MINTED',
    'FAILED',
  ] as const;
  export type Status = typeof ORDER[number];
  export const rank = (s?: string) => Math.max(0, ORDER.indexOf((s || '').toUpperCase() as Status));
  
  export function aheadOrEqual(curr?: string, want?: string) {
    return rank(curr) >= rank(want);
  }