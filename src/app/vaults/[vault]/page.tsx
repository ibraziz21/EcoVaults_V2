// src/app/vaults/[vault]/page.tsx
import type { Metadata } from 'next'
import VaultClientPage from './VaultClient'

// Reuse the alias → canonical logic for SEO
const CANONICAL: Record<string, 'USDC' | 'USDT'> = {
  USDC: 'USDC',
  USDCE: 'USDC',
  'USDC.E': 'USDC',
  USDT: 'USDT',
  USDT0: 'USDT',
}

function getVaultMeta(slug: string) {
  const raw = (slug || '').toUpperCase()
  const key = raw.replace(/\./g, '')
  const canonical = CANONICAL[key] ?? key

  // {Vault Name} & {Token} as per SEO spec
  const vaultName = `Re7 ${canonical}`
  const tokenLabel = canonical

  return { vaultName, tokenLabel }
}

// Use `any` here to play nicely with your custom PageProps typing
export async function generateMetadata({ params }: any): Promise<Metadata> {
  const { vault } = await params;
  const { vaultName, tokenLabel } = getVaultMeta(vault)

  const title = `${vaultName} Vault | APY, TVL and Deposit Options`
  const description = `View live APY, TVL, network and protocol details for the ${vaultName} Vault. Deposit or withdraw with a simple, clean interface.`

  return {
    title,
    description,
    alternates: {
      canonical: `/vaults/${vault}`,
    },
    openGraph: {
      title: `${vaultName} Vault`,
      description: `See APY, TVL, network and protocol details for the Re7 ${tokenLabel} Vault. Deposit or withdraw in a few clicks.`,
      url: `https://vaults.labs.eco/vaults/${vault}`,
    },
  }
}

// Server component wrapper – props type kept as `any` to avoid PageProps mismatch
export default function Page(_props: any) {
  return <VaultClientPage />
}
