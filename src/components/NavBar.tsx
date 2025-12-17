// src/components/NavBar.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";

import ecovaults from "@/public/eco-vaults.svg";
import CopyIconSvg from "../../public/copy.svg";
import ShareIconSvg from "../../public/share.svg";
import ExitIconSvg from "../../public/exit-icon.svg";

/* ──────────────────────────────────────────────────────────────── */
/* Constants                                                         */
/* ──────────────────────────────────────────────────────────────── */

const OP_CHAIN_ID = 10;

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function isProbablyInIframe() {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Safe embeds apps in an iframe, but iframes can happen elsewhere too.
 * Heuristic: treat iframe as “likely Safe”.
 */
function useLikelySafeContext() {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded(isProbablyInIframe());
  }, []);
  return embedded;
}

function NetworkBadge() {
  return (
    <div
      className="inline-flex items-center justify-center rounded-[10px] border border-border/60 bg-white p-1"
      title="OP Mainnet"
    >
      <span className="relative inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-[6px]">
        <Image
          src="/networks/op-icon.png"
          alt="OP Mainnet"
          width={20}
          height={20}
          className="h-5 w-5 rounded-[6px]"
        />
      </span>
    </div>
  );
}

function ActiveLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      className={`rounded-xl px-3 py-2 text-sm transition ${
        active
          ? "bg-[#F3F4F6] text-black font-semibold"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {children}
    </Link>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Navbar                                                            */
/* ──────────────────────────────────────────────────────────────── */

export function Navbar() {
  const pathname = usePathname();
  const likelySafe = useLikelySafeContext();

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();

  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();

  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const mobileRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMenuOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (accountMenuRef.current && !accountMenuRef.current.contains(t))
        setMenuOpen(false);
      if (mobileRef.current && !mobileRef.current.contains(t) && mobileOpen)
        setMobileOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  function openOnOptimismExplorer() {
    if (!address) return;
    const url = `https://optimistic.etherscan.io/address/${address}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const onWrongChain = isConnected && chainId !== OP_CHAIN_ID;

  async function switchToOP() {
    try {
      await switchChainAsync?.({ chainId: OP_CHAIN_ID });
    } catch (e) {
      console.error("[Navbar] switch chain failed:", e);
    }
  }

  // Optional dev connect (same behavior as your original)
  const injectedConnector = useMemo(
    () =>
      connectors.find(
        (c) =>
          c.id === "injected" ||
          c.name?.toLowerCase().includes("metamask")
      ),
    [connectors]
  );

  async function connectDevWallet() {
    if (!injectedConnector) return;
    try {
      await connectAsync({ connector: injectedConnector });
    } catch (e) {
      console.error("[Navbar] connect failed:", e);
    }
  }

  function openInSafe() {
    window.open("https://app.safe.global/apps", "_blank", "noopener,noreferrer");
  }

  return (
    <div className="w-full pt-3 px-4">
      <header className="sticky top-0 z-50 mx-auto w-full max-w-6xl rounded-xl border border-border/60 bg-white">
        <div className="flex h-14 w-full items-center justify-between px-2.5 sm:px-3">
          {/* Brand + desktop nav */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link href="/" className="inline-flex min-w-0 items-center gap-2">
              <Image
                src={ecovaults}
                alt="EcoVaults"
                width={144}
                height={36}
                priority
                className="h-9 w-auto object-contain"
              />
            </Link>

            <nav className="ml-1 hidden items-center gap-1 md:flex">
              <ActiveLink href="/">Dashboard</ActiveLink>
              <ActiveLink href="/vaults">Vaults</ActiveLink>
            </nav>
          </div>

          {/* Right side */}
          <div className="flex flex-shrink-0 items-center gap-2">
            {/* Mobile hamburger */}
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 transition active:scale-95 md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              title="Menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                className="opacity-80"
              >
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {/* OP-only: network badge / switch pill */}
            {isConnected &&
              (onWrongChain ? (
                <button
                  type="button"
                  onClick={switchToOP}
                  disabled={isSwitching}
                  className="hidden h-10 items-center gap-2 rounded-[12px] border border-[#FAB55A] bg-[#FEF4E6] px-4 text-sm font-medium text-black transition hover:bg-[#FDE7CD] disabled:opacity-60 md:inline-flex"
                  title="Switch network to Optimism"
                >
                  <span className="whitespace-nowrap">Switch to OP</span>
                  <span className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-[6px]">
                    <Image
                      src="/networks/op-icon.png"
                      alt="OP Mainnet"
                      width={20}
                      height={20}
                      className="h-5 w-5"
                    />
                  </span>
                </button>
              ) : (
                <NetworkBadge />
              ))}

            {/* Wallet area */}
            {!isConnected ? (
              <div className="hidden items-center gap-2 md:flex">
                <Button
                  onClick={openInSafe}
                  className="h-10 rounded-[12px] bg-[#376FFF] px-5 text-white transition hover:bg-[#2A5FCC]"
                  title="Open in Safe"
                  disabled={likelySafe}
                >
                  Open in Safe
                </Button>

                {!!injectedConnector && !likelySafe && (
                  <Button
                    onClick={connectDevWallet}
                    variant="secondary"
                    className="h-10 rounded-[12px]"
                    disabled={isConnecting}
                    title="Connect wallet (dev)"
                  >
                    {isConnecting ? "Connecting…" : "Connect wallet (dev)"}
                  </Button>
                )}
              </div>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex h-10 min-w-0 items-center gap-2 rounded-[12px] border border-gray-200 bg-background/60 px-3 text-sm font-semibold transition hover:bg-muted active:scale-[.98]"
                  title="Wallet menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <div className="h-5 w-5 flex-shrink-0 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />

                  {/* ✅ FIXED: preserve shortAddr logic AND enforce proper truncation */}
                  <span className="whitespace-nowrap">
                    {shortAddr(address)}
                  </span>
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-64 overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl z-[70]"
                    role="menu"
                  >
                    <div className="border-b p-3">
                      <div className="flex h-[94px] w-full flex-col justify-around rounded-[12px] bg-[#F9FAFB] p-3">
                        <div className="flex w-full justify-center">
                          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        </div>

                        <div className="flex min-w-0 items-center justify-center gap-2 p-2">
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span
                              className="truncate text-center text-[13px] font-semibold"
                              title={address}
                            >
                              {shortAddr(address)}
                            </span>
                            <span className="text-center text-[11px] text-muted-foreground">
                              {onWrongChain ? "Wrong network" : "OP Mainnet"}
                            </span>
                          </div>

                          <Image
                            src={CopyIconSvg}
                            width={18}
                            height={18}
                            alt="Copy address"
                            onClick={copyAddress}
                            className="cursor-pointer flex-shrink-0 transition hover:opacity-70"
                          />
                          <Image
                            src={ShareIconSvg}
                            width={18}
                            height={18}
                            alt="View on Optimism explorer"
                            onClick={openOnOptimismExplorer}
                            className="cursor-pointer flex-shrink-0 transition hover:opacity-70"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-2">
                      <button
                        className="flex w-full items-center justify-start rounded-md px-3 py-2 font-medium text-red-600 transition hover:bg-red-50"
                        onClick={() => {
                          setMenuOpen(false);
                          disconnect();
                        }}
                        title="Disconnect"
                      >
                        <span className="text-xs">
                          <Image src={ExitIconSvg} alt="" width={16} height={16} />
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

      {/* Mobile Sheet */}
      <div
        className={`fixed inset-0 z-[60] md:hidden ${
          mobileOpen ? "" : "pointer-events-none"
        }`}
        aria-hidden={!mobileOpen}
      >
        {/* overlay */}
        <div
          className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity ${
            mobileOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setMobileOpen(false)}
        />

        {/* panel */}
        <div
          ref={mobileRef}
          role="dialog"
          aria-modal="true"
          className={`absolute right-0 top-0 h-full w-[85%] max-w-sm bg-background ring-1 ring-border/60 transition-transform duration-200 ease-out ${
            mobileOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b px-3">
            <Image
              src={ecovaults}
              alt="EcoVaults"
              width={120}
              height={24}
              className="h-6 w-auto object-contain"
              priority
            />
            <button
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/60 transition active:scale-95"
              aria-label="Close menu"
              title="Close"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                className="opacity-80"
              >
                <path
                  d="M6 6l12 12M6 18L18 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex h-[calc(100%-56px)] flex-col justify-between overflow-y-auto">
            <div className="p-3">
              {/* wallet box */}
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-white shadow-xl">
                {!isConnected ? (
                  <div className="space-y-3 p-4">
                    <div className="text-sm text-muted-foreground">
                      {likelySafe
                        ? "Waiting for Safe context…"
                        : "Open this app in Safe{Wallet}."}
                    </div>

                    <Button
                      onClick={openInSafe}
                      className="h-10 w-full rounded-lg bg-[#376FFF] font-semibold text-white transition hover:bg-[#2A5FCC]"
                      title="Open in Safe"
                      disabled={likelySafe}
                    >
                      Open in Safe
                    </Button>

                    {!!injectedConnector && !likelySafe && (
                      <Button
                        onClick={connectDevWallet}
                        variant="secondary"
                        className="h-10 w-full rounded-lg"
                        disabled={isConnecting}
                        title="Connect wallet (dev)"
                      >
                        {isConnecting ? "Connecting…" : "Connect wallet (dev)"}
                      </Button>
                    )}

                    <div className="text-center text-[11px] text-muted-foreground">
                      OP-only app. Safe recommended.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="border-b p-3">
                      <div className="flex h-[94px] w-full flex-col justify-around rounded-[12px] bg-[#F9FAFB] p-3">
                        <div className="flex w-full justify-center">
                          <div className="h-6 w-6 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 ring-1 ring-black/5" />
                        </div>

                        <div className="flex min-w-0 items-center justify-center gap-2 p-2">
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span
                              className="truncate text-center text-[13px] font-semibold"
                              title={address}
                            >
                              {shortAddr(address)}
                            </span>
                            <span className="text-center text-[11px] text-muted-foreground">
                              {onWrongChain ? "Wrong network" : "OP Mainnet"}
                            </span>
                          </div>

                          <Image
                            src={CopyIconSvg}
                            width={18}
                            height={18}
                            alt="Copy address"
                            onClick={copyAddress}
                            className="cursor-pointer flex-shrink-0 transition hover:opacity-70"
                          />
                          <Image
                            src={ShareIconSvg}
                            width={18}
                            height={18}
                            alt="View on Optimism explorer"
                            onClick={openOnOptimismExplorer}
                            className="cursor-pointer flex-shrink-0 transition hover:opacity-70"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 p-3">
                      {onWrongChain && (
                        <button
                          type="button"
                          onClick={switchToOP}
                          disabled={isSwitching}
                          className="flex h-10 w-full items-center justify-center gap-2 rounded-[12px] border border-[#FAB55A] bg-[#FEF4E6] px-4 text-sm font-semibold text-black transition hover:bg-[#FDE7CD] disabled:opacity-60"
                          title="Switch network to Optimism"
                        >
                          <span>Switch to OP Mainnet</span>
                          <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm">
                            <Image
                              src="/networks/op-icon.png"
                              alt="OP Mainnet"
                              width={28}
                              height={28}
                              className="h-7 w-7"
                            />
                          </span>
                        </button>
                      )}

                      <Button
                        variant="secondary"
                        className="h-10 w-full"
                        onClick={copyAddress}
                        title={copied ? "Copied" : "Copy"}
                      >
                        {copied ? "Copied" : "Copy Address"}
                      </Button>

                      <Button
                        variant="secondary"
                        className="h-10 w-full"
                        onClick={openOnOptimismExplorer}
                        title="Explorer"
                      >
                        View on Explorer
                      </Button>

                      <Button
                        variant="destructive"
                        className="h-10 w-full"
                        onClick={() => {
                          disconnect();
                          setMobileOpen(false);
                        }}
                        title="Disconnect"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {/* nav links */}
              <nav className="mt-4 grid gap-1">
                <ActiveLink href="/">Dashboard</ActiveLink>
                <ActiveLink href="/vaults">Vaults</ActiveLink>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
