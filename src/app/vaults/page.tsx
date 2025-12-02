// app/vaults/page.tsx
import type { Metadata } from 'next'
import VaultsClient from './vaultsClient'

export const metadata: Metadata = {
  title: 'EcoVaults | Explore Active Vaults and Yields',
  description:
    'Browse all active EcoVaults, compare APYs and TVL, and find vaults that match your strategy across supported networks.',
  alternates: {
    canonical: '/vaults',
  },
  openGraph: {
    title: 'Explore EcoVaults',
    description:
      'Compare yields, networks and protocols. Discover active vaults with real-time performance data.',
    url: 'https://vaults.labs.eco/vaults',
  },
}

export default function Page() {
  return <VaultsClient />
}
