// src/app/layout.tsx
import '@/app/globals.css'
import { ReactNode } from 'react'
import { headers } from 'next/headers'
import type { Metadata } from 'next'              // ⬅️ NEW
import ContextProvider from '@/config/appkit'
import AppShell from '@/components/AppShell'
import { Toaster } from '@/components/ui/sonner'
import localFont from 'next/font/local'

const openSauce = localFont({
  src: [
    { path: '../../public/open-sauce-one/OpenSauceOne-Light.ttf', weight: '300' },
    { path: '../../public/open-sauce-one/OpenSauceOne-Regular.ttf', weight: '400' },
    { path: '../../public/open-sauce-one/OpenSauceOne-Medium.ttf', weight: '500' },
    { path: '../../public/open-sauce-one/OpenSauceOne-SemiBold.ttf', weight: '600' },
    { path: '../../public/open-sauce-one/OpenSauceOne-Bold.ttf', weight: '700' },
  ],
  variable: '--font-opensauce',
})

// 🔹 Global defaults (can be overridden per page)
export const metadata: Metadata = {
  metadataBase: new URL('https://vaults.labs.eco'),
  title: 'EcoVaults',
  description:
    'Earn, track and manage your EcoVaults positions across supported networks.',
  openGraph: {
    type: 'website',
    url: 'https://vaults.labs.eco/',
    title: 'EcoVaults',
    description:
      'Earn, track and manage your EcoVaults positions across supported networks.',
    images: [
      {
        url: '/opengraph_dark.jpg', // ⬅️ new OG image
        width: 1200,
        height: 630,
        alt: 'EcoVaults',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EcoVaults',
    description:
      'Earn, track and manage your EcoVaults positions across supported networks.',
    images: ['/opengraph_dark.jpg'],
  },
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  // runs on the server; cookies() is async in Next 13.4+
  const cookieHeader = (await headers()).get('cookie')

  return (
    <html lang="en" className={openSauce.variable}>
      <body className="text-secondary-foreground antialiased font-opensauce">
        <ContextProvider cookies={cookieHeader}>
          <AppShell>{children}</AppShell>
          <Toaster />
        </ContextProvider>
      </body>
    </html>
  )
}
