// src/components/NavBar.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { useAppKit } from '@reown/appkit/react' // keep only useAppKit
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


function NetworkBadge({ chainId }: { chainId?: number }) {
  if (!chainId || !CHAIN_META[chainId]) return null
  const m = CHAIN_META[chainId]

  return (
    <div
      className="inline-flex items-center justify-center rounded-md border border-gray-200 bg-white p-1"
      title={m.label}
    >
      <span className="relative inline-flex h-5 w-5 items-center justify-center rounded-md overflow-hidden">
        <Image
          src={m.icon}
          alt={m.label}
          width={20}
          height={20}
          className="h-5 w-5 rounded-md"
        />
      </span>
    </div>
  )
}

function ActiveLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/' && pathname.startsWith(href))
  return (
    <Link
      href={href}
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
  const { address } = useAccount()
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

  return (
    <div className="mt-[12px]">
      {/* Top App Bar */}
      <header className="sticky top-0 z-50 w-full bg-white border-b border-border/60 max-w-6xl mx-auto rounded-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-3 sm:px-4">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="group inline-flex items-center gap-2 min-w-0">
              <Image
                src={ecovaults}
                alt="ecovaults"
                width={0}
                height={0}
                priority
                className="h-auto w-auto"
              />
            </Link>
            {/* Desktop nav */}
            <nav className="ml-2 hidden items-center gap-1 md:flex">
              <ActiveLink href="/">Dashboard</ActiveLink>
              <ActiveLink href="/vaults">Vaults</ActiveLink>
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Mobile: hamburger */}
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 md:hidden active:scale-95"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              title="Menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80">
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
                <NetworkBadge chainId={chainId} />
              ) : (
                // Not on OP → show "Switch to OP Mainnet" pill
                <button
                  type="button"
                  onClick={() => quickSwitch(10)}
                  disabled={isSwitching}
                  className="hidden md:inline-flex h-9 items-center gap-2 rounded-xl border border-[#FACC6B] bg-[#FFFAEB] px-4 text-sm font-semibold text-black shadow-sm disabled:opacity-60"
                  title="Switch network to Optimism"
                >
                  <span>Switch to OP Mainnet</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F04438]">
                    <Image
                      src="/networks/op-icon.png"
                      alt="OP Mainnet"
                      width={18}
                      height={18}
                      className="h-4 w-4"
                    />
                  </span>
                </button>
              ))}

            {/* Wallet area */}
            {!address ? (
              <Button
                onClick={() => open({ view: 'Connect' })}
                className="hidden md:flex bg-[#376FFF] p-5 rounded-lg"
                title="Connect Wallet"
              >
                Connect Wallet
              </Button>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-background/60 px-3 text-sm font-semibold hover:bg-background active:scale-[.98]"
                  title="Wallet menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <div className="h-5 w-5 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                  <span className="max-w-[92px] whitespace-nowrap">
                    {shortAddr(address)}
                  </span>

                </button>

                {menuOpen && (
                  <div
                    className="absolute flex flex-col justify-between right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl focus:outline-none"
                    role="menu"
                  >
                    {/* header */}
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <div className="flex flex-col justify-between w-full">
                        <div className="w-full flex justify-center">
                          <div className="h-6 w-6 shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        </div>

                        <div className="flex justify-center items-center p-2 gap-2 min-w-0">
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-xs font-semibold" title={address}>
                              {shortAddr(address)}
                            </span>
                          </div>
                          <Image
                            src={CopyIconSvg}
                            width={14}
                            height={14}
                            alt="Copy address"
                            onClick={copyAddress}
                            className="cursor-pointer"
                          />
                          <Image
                            src={ShareIconSvg}
                            width={14}
                            height={14}
                            alt="View on Optimism explorer"
                            onClick={openOnOptimismExplorer}
                            className="cursor-pointer"
                          />

                        </div>
                      </div>
                    </div>

                    {/* actions */}
                    <div className="p-2 text-sm">
                      <button
                        className="mt-2 flex w-full items-center justify-start rounded-md px-3 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
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
          onClick={() => setMobileOpen(false)}
        />

        {/* panel */}
        <div
          ref={mobileRef}
          role="dialog"
          aria-modal="true"
          className={`absolute right-0 top-0 h-full w-[86%] max-w-sm bg-background shadow-2xl ring-1 ring-border/60 transition-transform duration-200 ease-out ${mobileOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          <div className="flex h-14 items-center justify-between border-b px-3">
            <div className="inline-flex items-center gap-2">
              <Image
                src={ecovaults}
                alt="ecovaults"
                width={140}
                height={24}
                className="h-6 w-auto"
                priority
              />
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 active:scale-95"
              aria-label="Close menu"
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-80">
                <path
                  d="M6 6l12 12M6 18L18 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex h-[calc(100%-56px)] flex-col justify-between">
            <div className="p-3">
              {/* wallet box */}
              <div className="rounded-2xl border p-3">
                {!address ? (
                  <>
                    <div className="mb-2 text-sm">You&rsquo;re not connected</div>
                    <Button
                      onClick={() => open({ view: 'Connect' })}
                      className="w-full bg-[#376FFF] text-white rounded-lg"
                      title={''}
                    >
                      Connect Wallet
                    </Button>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Works with WalletConnect & injected wallets
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        <div className="text-sm font-semibold">{shortAddr(address)}</div>
                      </div>
                      <NetworkBadge chainId={chainId} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={copyAddress}
                        title={copied ? 'Copied' : 'Copy'}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => open({ view: 'Connect' })}
                        title={'Switch'}
                      >
                        Switch
                      </Button>
                      <Button
                        variant="destructive"
                        className="col-span-2"
                        onClick={() => {
                          disconnect()
                          setMobileOpen(false)
                        }}
                        title={'Disconnect'}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* nav links */}
              <nav className="mt-3 grid gap-1">
                <ActiveLink href="/">Dashboard</ActiveLink>
                <ActiveLink href="/vaults">Vaults</ActiveLink>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
