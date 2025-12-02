import type { WalletClient } from 'viem'
import { optimism, lisk } from 'viem/chains'
import { parseAbi, encodeFunctionData } from 'viem'
import { TokenAddresses } from './constants'
import { configureLifiWith } from './bridge'
import { getQuote, convertQuoteToRoute, executeRoute } from '@lifi/sdk'

/* ──────────────────────────────────────────────────────────────── */
/* Relayer bundle                                                   */
/* ──────────────────────────────────────────────────────────────── */
type RelayerBundle = {
  clientFor: (chainId: number) => WalletClient
  lisk: WalletClient
  optimism: WalletClient
}



/* ──────────────────────────────────────────────────────────────── */
/* ABIs                                                             */
/* ──────────────────────────────────────────────────────────────── */

// Safe v1.3 execTransaction
const SAFE_ABI = parseAbi([
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) public payable returns (bool success)',
])

// Minimal ERC-4626 withdraw
const ERC4626_ABI = parseAbi([
  'function withdraw(uint256 assets,address receiver,address owner) external returns (uint256 shares)',
])

/* ──────────────────────────────────────────────────────────────── */
/* Helpers                                                          */
/* ──────────────────────────────────────────────────────────────── */

// Safe pre-validated signature for a single owner (relayer must be a Safe owner; threshold=1)
function prevalidatedSignature(owner: `0x${string}`): `0x${string}` {
  const r = `0x${owner.slice(2).padStart(64, '0')}`
  const s = `0x${''.padStart(64, '0')}`
  const v = '01'
  return `${r}${s.slice(2)}${v}` as `0x${string}`
}

/** Bridge USDC.e (Lisk) → USDC (OP) directly to the user */
async function bridgeLiskToOpToUser(params: {
  relayer: RelayerBundle
  fromToken: `0x${string}`  // USDC.e on Lisk
  toToken: `0x${string}`    // USDC on Optimism
  amount: bigint
  to: `0x${string}`         // user on OP
}) {
  const { relayer, fromToken, toToken, amount, to } = params
  const fromAddr = relayer.lisk.account?.address as `0x${string}`

  configureLifiWith(relayer.lisk)

  const quote = await getQuote({
    fromChain: lisk.id,
    toChain: optimism.id,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress: fromAddr,
    toAddress: to,
  })

  const route = convertQuoteToRoute(quote)
  return executeRoute(route, {
    switchChainHook: async (chainId) => relayer.clientFor(chainId),
    acceptExchangeRateUpdateHook: async () => true,
  })
}

/* ──────────────────────────────────────────────────────────────── */
/* Safe.execTransaction → vault.withdraw(assets, relayer, SAFE)     */
/* ──────────────────────────────────────────────────────────────── */
async function safeWithdrawErc4626(params: {
  relayer: RelayerBundle
  safe: `0x${string}`                  // Lisk Safe (owner of the assets)
  vault: `0x${string}`                 // ERC-4626 vault on Lisk (USDC.e MetaMorpho)
  assets: bigint                       // USDC.e amount in wei
  receiver?: `0x${string}`             // default = relayer
}) {
  const { relayer, safe, vault, assets } = params
  const receiver = params.receiver ?? (relayer.lisk.account!.address as `0x${string}`)

  const data = encodeFunctionData({
    abi: ERC4626_ABI,
    functionName: 'withdraw',
    args: [assets, receiver, safe],
  })

  const signatures = prevalidatedSignature(relayer.lisk.account!.address as `0x${string}`)

  await relayer.lisk.writeContract({
      address: safe,
      abi: SAFE_ABI,
      functionName: 'execTransaction',
      args: [
        vault, 0n, data,
        0,     // CALL
        0n, 0n, 0n,
        '0x0000000000000000000000000000000000000000',
        '0x0000000000000000000000000000000000000000',
        signatures,
      ],
      chain: lisk, // Add the chain property
      account: relayer.lisk.account!.address as `0x${string}`, // Add the account property
    })
}

/* ──────────────────────────────────────────────────────────────── */
/* Main flow                                                        */
/* ──────────────────────────────────────────────────────────────── */
/**
 * 1) Burn sAVault on OP (relayer must be onlyAllowed)
 * 2) Safe.execTransaction on Lisk → vault.withdraw(assets, relayer, SAFE)
 * 3) Bridge USDC.e → USDC (OP) to the user
 */
export async function withdrawMorphoCrosschain(params: {
  relayer: RelayerBundle
  user: `0x${string}`

  // Burn on OP
  savaultAddress: `0x${string}`
  burnAbi: readonly any[]
  burnFunction: 'burn'
  sharesToBurn: bigint
  burnOwner: `0x${string}`

  // Safe on Lisk
  liskSafe: `0x${string}`
  liskVault: `0x${string}`       // ERC-4626 MetaMorpho vault
  amountAssets: bigint           // USDC.e to withdraw

  // Bridge
  liskAssetUSDCe?: `0x${string}`
}) {
  const {
    relayer, user,
    savaultAddress, burnAbi, burnFunction, sharesToBurn, burnOwner,
    liskSafe, liskVault, amountAssets,
    liskAssetUSDCe,
  } = params

  // 1) Burn receipt token on Optimism
  await relayer.optimism.writeContract({
    address: savaultAddress,
    abi: burnAbi,
    functionName: burnFunction, // burn(address account, uint256 amount)
    args: [burnOwner, sharesToBurn],
    chain: optimism, // Add the chain property
    account: relayer.optimism.account!.address as `0x${string}`, // Add the account property
  })

  // 2) Execute Safe tx to withdraw USDC.e to relayer
  await safeWithdrawErc4626({
    relayer,
    safe: liskSafe,
    vault: liskVault,
    assets: amountAssets,
  })

  // 3) Bridge USDC.e → USDC to the user (OP)
  await bridgeLiskToOpToUser({
    relayer,
    fromToken: (liskAssetUSDCe ?? TokenAddresses.USDCe.lisk) as `0x${string}`,
    toToken: TokenAddresses.USDC.optimism as `0x${string}`,
    amount: amountAssets,
    to: user,
  })
}
