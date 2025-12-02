// src/lib/adapters.ts
import type { YieldSnapshot } from '@/hooks/useYields'
import { ADAPTER_KEYS, type AdapterKey } from './constants'

/** Map YieldSnapshot → router adapter key (Morpho/Lisk only). */
export function adapterKeyForSnapshot(s: YieldSnapshot): AdapterKey {
  if (s.protocolKey !== 'morpho-blue') {
    throw new Error('Only Morpho Blue is supported in this build')
  }
  if (s.chain !== 'lisk') {
    throw new Error(`Morpho Blue is only available on Lisk (got: ${s.chain})`)
  }

  // Snapshots usually carry base labels (USDC/USDT/WETH). If they already
  // come in as USDCe/USDT0, handle that too.
  switch (s.token) {
    case 'USDC':
    case 'USDCe':
      return ADAPTER_KEYS.morphoLiskUSDCe
    case 'USDT':
    case 'USDT0':
      return ADAPTER_KEYS.morphoLiskUSDT0
    case 'WETH':
      return ADAPTER_KEYS.morphoLiskWETH
    default:
      throw new Error(`Unsupported Morpho(Lisk) token: ${String(s.token)}`)
  }
}
