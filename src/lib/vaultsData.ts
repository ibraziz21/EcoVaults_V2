// Shared vault data
export type Vault = {
  vault: string;
  network: string;
  tvl: string;
  protocol: string;
  apy: string;
}

export const vaultsData: Vault[] = [
  {
    vault: "USDC",
    network: "Ethereum",
    tvl: "2,450,000",
    protocol: "Aave V3",
    apy: "5.25",
  },
  {
    vault: "USDT",
    network: "Lisk",
    tvl: "1,850,000",
    protocol: "Morpho Blue",
    apy: "6.80",
  },
  {
    vault: "USDC",
    network: "Base",
    tvl: "950,000",
    protocol: "Aave V3",
    apy: "5.80",
  },
  {
    vault: "USDT0",
    network: "Lisk",
    tvl: "1,200,000",
    protocol: "Morpho Blue",
    apy: "6.45",
  },
  {
    vault: "WETH",
    network: "Ethereum",
    tvl: "4,100,000",
    protocol: "Compound",
    apy: "3.90",
  },
  {
    vault: "DAI",
    network: "Arbitrum",
    tvl: "2,800,000",
    protocol: "Merkle",
    apy: "8.20",
  },
  {
    vault: "WETH",
    network: "Arbitrum",
    tvl: "3,200,000",
    protocol: "Compound",
    apy: "4.15",
  },
  {
    vault: "DAI",
    network: "Optimism",
    tvl: "1,500,000",
    protocol: "Yearn",
    apy: "7.50",
  },
];
