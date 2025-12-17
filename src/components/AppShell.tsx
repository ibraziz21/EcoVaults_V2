// src/components/AppShell.tsx
'use client'

import React from 'react'
import { Navbar } from '@/components/NavBar'
import { DisclaimerBanner } from '@/components/DisclaimerBanner'

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='bg-[#F9FAFB]'>
      <DisclaimerBanner />
      <Navbar />
      <main className="min-h-[calc(100vh-3.5rem)] mt-[24px]">{children}</main>
    </div>
  )
}
