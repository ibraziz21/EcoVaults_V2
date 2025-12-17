// src/components/NavBar.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { useAppKit } from '@reown/appkit/react'
import { useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi'
import { Button } from '@/components/ui/button'
import socialImg from '@/public/logo_horizontal.svg'
import ecovaults from "@/public/eco-vaults.svg"
import baseImg from '@/public/base_square_blue.svg'
import { ExitIcon } from '@radix-ui/react-icons'
import ExitIconSvg from "../../public/exit-icon.svg"
import CopyIconSvg from "../../public/copy.svg"
import ShareIconSvg from "../../public/share.svg"

/* ──────────────────────────────────────────────────────────────── */

const CHAIN_META: Record<
  number,
  {
    key: 'optimism' | 'base' | 'lisk'
    label: string
    badge: string
    icon: any
    bg: string
    ring: string
  }
> = {
  10: {
    key: 'optimism',
    label: 'OP Mainnet',
    badge: 'OP',
    icon: '/networks/op-icon.png',
    bg: 'bg-rose-600',
    ring: 'ring-rose-500/30',
  },
  8453: {
    key: 'base',
    label: 'Base',
    badge: 'BASE',
    icon: baseImg,
    bg: 'bg-blue-600',
    ring: 'ring-blue-500/30',
  },
  1135: {
    key: 'lisk',
    label: 'Lisk',
    badge: 'LSK',
    icon: '/networks/lisk.png',
    bg: 'bg-indigo-600',
    ring: 'ring-indigo-500/30',
  },
}

function shortAddr(a?: string) {
  if (!a) return ''
  if (a.length <= 10) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function NetworkBadge({ chainId, size = 'sm' }: { chainId?: number; size?: 'sm' | 'md' }) {
  if (!chainId || !CHAIN_META[chainId]) return null
  const m = CHAIN_META[chainId]
  const iconSize = size === 'sm' ? 20 : 28
  const containerSize = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'

  return (
    <div
      className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1"
      title={m.label}
    >
      <span className={`relative inline-flex ${containerSize} items-center justify-center rounded-md overflow-hidden`}>
        <Image
          src={m.icon}
          alt={m.label}
          width={iconSize}
          height={iconSize}
          className={`${size === 'sm' ? 'h-5 w-5' : 'h-7 w-7'} rounded`} 
        />
      </span>
    </div>
  )
}

function ActiveLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/' && pathname.startsWith(href))
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-sm transition ${active
        ? 'bg-[#F3F4F6] text-black font-semibold'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
        }`}
    >
      {children}
    </Link>
  )
}

/* ──────────────────────────────────────────────────────────────── */

export function Navbar() {
  const pathname = usePathname()
  const { open } = useAppKit()
  
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()

  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [elevated, setElevated] = useState(false)

  const mobileRef = useRef<HTMLDivElement | null>(null)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    // Lock body scroll when mobile sheet is open
    const body = document.body
    if (mobileOpen) {
      const prev = body.style.overflow
      body.style.overflow = 'hidden'
      return () => {
        body.style.overflow = prev
      }
    }
  }, [mobileOpen])

  useEffect(() => {
    // Close menus on outside click
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (accountMenuRef.current && !accountMenuRef.current.contains(t)) setMenuOpen(false)
      if (mobileRef.current && !mobileRef.current.contains(t) && mobileOpen) setMobileOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen])

  const currentChain = useMemo(() => (chainId ? CHAIN_META[chainId] : undefined), [chainId])

  async function copyAddress() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { }
  }

  function openOnOptimismExplorer() {
    if (!address) return
    const url = `https://optimistic.etherscan.io/address/${address}` 
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function quickSwitch(id: number) {
    try {
      await switchChainAsync?.({ chainId: id })
    } catch (e) {
      console.error('Switch chain failed:', e)
    }
  }

  const closeMobile = () => setMobileOpen(false)

  return (
    <div className='w-full pt-3 px-4'>
      <div className="mx-auto max-w-[1392px]" >
      {/* Top App Bar */}
      <header className={`sticky top-0 z-50 w-full bg-background border-b border-border/60 rounded-xl transition-shadow`}> 
        <div className="mx-auto flex h-14 w-full items-center justify-between px-2.5"> 
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Link href="/" className="group inline-flex items-center gap-2 min-w-0">
              <Image
                src={ecovaults}
                alt="ecovaults"
                width={120}
                height={40}
                priority
                className="h-10 w-auto sm:w-auto object-contain"
              />
            </Link>
            {/* Desktop nav */}
            <nav className="ml-2 hidden items-center gap-1 md:flex flex-1">
              <ActiveLink href="/">Dashboard</ActiveLink>
              <ActiveLink href="/vaults">Vaults</ActiveLink>
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mobile: hamburger */}
            <button
              className=" cursor-pointer inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 md:hidden active:scale-95 transition"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              title="Menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" className="opacity-80">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {/* Network control (if connected) */}
            {address &&
              (chainId === 10 ? (
                // On OP → show small chain badge
                <NetworkBadge chainId={chainId} size="sm" />
              ) : (
                // Not on OP → show "Switch to OP Mainnet" pill
                <button
                  type="button"
                  onClick={() => quickSwitch(10)}
                  disabled={isSwitching}
                  className=" cursor-pointer hidden md:inline-flex h-10 items-center gap-2 rounded-[12px] border border-[#FAB55A] bg-[#FEF4E6] px-4 text-sm font-medium text-black disabled:opacity-60 hover:bg-[#FDE7CD] transition"
                  title="Switch network to Optimism"
                >
                  <span className="whitespace-nowrap">Switch to OP</span>
                  <span className="flex h-5 w-5 items-center justify-center relative rounded-[4px] overflow-hidden">
                    <Image
                      src="/networks/op-icon.png"
                      alt="OP Mainnet"
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded-none"
                    />
                  </span>
                </button>
              ))}

            {/* Wallet area */}
            {!address ? (
              <Button
                onClick={() => open({ view: 'Connect' })}
                className="hidden md:flex bg-[#376FFF] px-5 py-2 rounded-[12px] text-white hover:bg-[#2A5FCC] transition h-10"
                title="Connect Wallet"
              >
                Connect Wallet
              </Button>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className=" cursor-pointer inline-flex h-10 items-center gap-2 rounded-[12px] border border-gray-200 bg-background/60 px-3 text-sm font-semibold hover:bg-muted active:scale-[.98] transition min-w-0"
                  title="Wallet menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <div className="h-5 w-5 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5 flex-shrink-0" />
                  <span className="max-w-[92px] whitespace-nowrap">
                    {shortAddr(address)}
                  </span>
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl focus:outline-none z-[70]"
                    role="menu"
                  >
                    {/* header */}
                    <div className="flex items-center justify-between border-b px-3 py-3">
                      <div className="flex flex-col justify-around w-full h-[94px] bg-[#F9FAFB] rounded-[12px] p-3">
                        <div className="w-full flex justify-center">
                          <div className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        </div>

                        <div className="flex justify-center items-center p-2 gap-2 min-w-0">
                          <div className="flex min-w-0 flex-col flex-1">
                            <span className="truncate text-[13px] font-semibold text-center" title={address}>
                              {shortAddr(address)}
                            </span>
                          </div>
                          <Image
                            src={CopyIconSvg}
                            width={18}
                            height={18}
                            alt="Copy address"
                            onClick={copyAddress}
                            className="cursor-pointer hover:opacity-70 transition flex-shrink-0"
                          />
                          <Image
                            src={ShareIconSvg}
                            width={18}
                            height={18}
                            alt="View on Optimism explorer"
                            onClick={openOnOptimismExplorer}
                            className="cursor-pointer hover:opacity-70 transition flex-shrink-0"
                          />
                        </div>
                      </div>
                    </div>

                    {/* actions */}
                    <div className="p-2 text-sm">
                      <button
                        className="flex w-full items-center justify-start rounded-md px-3 py-2 font-medium text-red-600 hover:bg-red-50 transition"
                        onClick={() => {
                          setMenuOpen(false)
                          disconnect()
                        }}
                        title="Disconnect"
                      >
                        <span className="text-xs">
                          <Image src={ExitIconSvg} alt="" />
                        </span>
                        <span className="mx-2">Disconnect</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Sheet (Slide-over) */}
      <div
        className={`md:hidden fixed inset-0 z-[60] ${mobileOpen ? '' : 'pointer-events-none'}`}
        aria-hidden={!mobileOpen}
      >
        {/* overlay */}
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'
            }`}
          onClick={closeMobile}
        />

        {/* panel */}
        <div
          ref={mobileRef}
          role="dialog"
          aria-modal="true"
          className={`absolute right-0 top-0 h-full w-[85%] max-w-sm bg-background  ring-1 ring-border/60 transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          {/* Header - Logo & Close */}
          <div className="flex h-14 items-center justify-between border-b px-3">
            <div className="inline-flex items-center gap-2">
              <Image
                src={ecovaults}
                alt="ecovaults"
                width={120}
                height={36}
                className="h-6 w-auto object-contain"
                priority
              />
            </div>
            <button
              onClick={closeMobile}
              className=" cursor-pointer inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 active:scale-95 transition"
              aria-label="Close menu"
              title="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" className="opacity-80">
                <path
                  d="M6 6l12 12M6 18L18 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex h-[calc(100%-56px)] flex-col justify-between overflow-y-auto">
            <div className="p-3">
              {/* Wallet Section - Desktop Style */}
              <div className="rounded-2xl border border-border/60 bg-white shadow-xl overflow-hidden">
                {!address ? (
                  <div className="p-4 space-y-3">
                    <div className="text-sm text-muted-foreground">You&apos;re not connected</div>
                    <Button
                      onClick={() => {
                        open({ view: 'Connect' })
                        closeMobile()
                      }}
                      className="w-full bg-[#376FFF] text-white rounded-lg hover:bg-[#2A5FCC] transition h-10 font-semibold"
                      title="Connect Wallet"
                    >
                      Connect Wallet
                    </Button>
                    <div className="text-[11px] text-muted-foreground text-center">
                      Works with WalletConnect & injected wallets
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Header - Desktop Style */}
                    <div className="flex items-center justify-between border-b px-3 py-3">
                      <div className="flex flex-col justify-around w-full h-[94px] bg-[#F9FAFB] rounded-[12px] p-3">
                        <div className="w-full flex justify-center">
                          <div className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        </div>
                        <div className="flex justify-center items-center p-2 gap-2 min-w-0">
                          <div className="flex min-w-0 flex-col flex-1">
                            <span className="truncate text-[13px] font-semibold items-center" title={address}>
                              {shortAddr(address)}
                            </span>
                          </div>
                          <Image
                            src={CopyIconSvg}
                            width={18}
                            height={18}
                            alt="Copy address"
                            onClick={() => {
                              copyAddress()
                              closeMobile()
                            }}
                            className="cursor-pointer hover:opacity-70 transition flex-shrink-0"
                          />
                          <Image
                            src={ShareIconSvg}
                            width={18}
                            height={18}
                            alt="View on Optimism explorer"
                            onClick={() => {
                              openOnOptimismExplorer()
                              closeMobile()
                            }}
                            className="cursor-pointer hover:opacity-70 transition flex-shrink-0"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Actions - Desktop Style */}
                    <div className="p-2 text-sm">
                      {/* Network Switch - Desktop Style Pill */}
                      {chainId !== 10 && (
                        <button
                          type="button"
                          onClick={() => {
                            quickSwitch(10)
                            closeMobile()
                          }}
                          disabled={isSwitching}
                          className=" cursor-pointer w-full mb-2 flex h-9 items-center justify-center gap-2 rounded-[12px] border border-[#FAB55A] bg-[#FEF4E6] px-4 text-sm font-semibold text-black disabled:opacity-60 hover:bg-[#FDE7CD] transition"
                          title="Switch network to Optimism"
                        >
                          <span>Switch to OP Mainnet</span>
                          <span className="flex h-7 w-7 items-center justify-center relative rounded-sm overflow-hidden flex-shrink-0">
                            <Image
                              src="/networks/op-icon.png"
                              alt="OP Mainnet"
                              width={28}
                              height={28}
                              className="h-7 w-7 rounded-none"
                            />
                          </span>
                        </button>
                      )}

                      {/* Disconnect - Desktop Style */}
                      <button
                        className=" cursor-pointer mt-2 flex w-full items-center justify-start rounded-md px-3 py-2 font-medium text-red-600 hover:bg-red-50 transition"
                        onClick={() => {
                          disconnect()
                          closeMobile()
                        }}
                        title="Disconnect"
                      >
                        <span className="text-xs">
                          <Image src={ExitIconSvg} alt="" width={16} height={16} />
                        </span>
                        <span className="mx-2">Disconnect</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Navigation Links */}
              <nav className="mt-4 grid gap-1">
                <ActiveLink href="/" onClick={closeMobile}>Dashboard</ActiveLink>
                <ActiveLink href="/vaults" onClick={closeMobile}>Vaults</ActiveLink>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}