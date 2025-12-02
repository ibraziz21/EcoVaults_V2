// Centralized states + allowed transitions for deposit & withdraw

export type DepositState =
  | 'PENDING' | 'PROCESSING' | 'WAITING_ROUTE' | 'BRIDGE_IN_FLIGHT'
  | 'BRIDGED' | 'DEPOSITING' | 'DEPOSITED' | 'MINTING' | 'MINTED'
  | 'FAILED';

export type WithdrawState =
  | 'PENDING' | 'PROCESSING'
  | 'BURNED' | 'REDEEMING' | 'REDEEMED' | 'BRIDGING'
  | 'SUCCESS' | 'FAILED';

// Allowed transitions (forward-only + a couple of resumable jumps)
const DEP_EDGES = new Set<`${DepositState}->${DepositState}`>([
  'PENDING->PROCESSING',
  'PROCESSING->WAITING_ROUTE',
  'WAITING_ROUTE->BRIDGE_IN_FLIGHT',
  'BRIDGE_IN_FLIGHT->BRIDGED',
  'BRIDGED->DEPOSITING',
  'DEPOSITING->DEPOSITED',
  'DEPOSITED->MINTING',
  'MINTING->MINTED',
  // resumable jumps after observation:
  'WAITING_ROUTE->BRIDGED',
  'BRIDGE_IN_FLIGHT->BRIDGED',
  // failures (terminal)
  'PROCESSING->FAILED','WAITING_ROUTE->FAILED','BRIDGE_IN_FLIGHT->FAILED',
  'DEPOSITING->FAILED','MINTING->FAILED',
  'PROCESSING->BRIDGE_IN_FLIGHT',
]);

const WDR_EDGES = new Set<`${WithdrawState}->${WithdrawState}`>([
  'PENDING->PROCESSING',
  'PROCESSING->BURNED',
  'BURNED->REDEEMING',
  'REDEEMING->REDEEMED',
  'REDEEMED->BRIDGING',
  'BRIDGING->SUCCESS',
  // failures (terminal)
  'PROCESSING->FAILED','BURNED->FAILED','REDEEMING->FAILED','BRIDGING->FAILED',
]);

export const canAdvanceDeposit = (from: DepositState, to: DepositState) =>
  from === to || DEP_EDGES.has(`${from}->${to}` as any);

export const canAdvanceWithdraw = (from: WithdrawState, to: WithdrawState) =>
  from === to || WDR_EDGES.has(`${from}->${to}` as any);