// src/app/layout.tsx
import '@/app/globals.css'
import { ReactNode } from 'react'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
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

const baseUrl = 'https://vaults.labs.eco'

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: 'EcoVaults',
  description:
    'Earn, track and manage your EcoVaults positions across supported networks.',
  openGraph: {
    type: 'website',
    url: `${baseUrl}/`,
    title: 'EcoVaults',
    description:
      'Earn, track and manage your EcoVaults positions across supported networks.',
    images: [
      {
        url: `${baseUrl}/opengraph_dark.jpg`,
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
    images: [`${baseUrl}/opengraph_dark.jpg`],
  },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
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
