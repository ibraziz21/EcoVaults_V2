// file: src/components/deposit/types.ts
// ─────────────────────────────────────────────────────────────────────────────
export type EvmChain = 'optimism' | 'base' | 'lisk'

export type FlowStep =
  | 'idle'
  | 'bridging'
  | 'waitingFunds'
  | 'switching'
  | 'depositing'
  | 'success'
  | 'error'