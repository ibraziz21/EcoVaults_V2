// app/page.tsx
import type { Metadata } from 'next'
import DashboardClient from './Dashboard'

export const metadata: Metadata = {
  title: 'EcoVaults Dashboard | Track Deposits, APY and Rewards',
  description:
    'View your total deposits, APY, weekly yield and claimable rewards across all EcoVaults. A simple way to monitor your positions in real time.',
  alternates: {
    canonical: '/', // -> https://vaults.labs.eco/
  },
  openGraph: {
    title: 'EcoVaults Dashboard',
    description:
      'Track your deposits, rewards and performance across all active EcoVaults.',
    url: 'https://vaults.labs.eco/',
  },
}

export default function Page() {
  return <DashboardClient />
}
