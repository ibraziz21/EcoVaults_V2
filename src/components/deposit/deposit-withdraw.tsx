// src/components/deposit/deposit-withdraw.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '../ui/Card';
import { usePositions } from '@/hooks/usePositions';
import { SelectTokenModal } from './select-token-modal';
import { DepositModal } from './DepositModal/review-deposit-modal';
import { ReviewWithdrawModal } from '../WithdrawModal/review-withdraw-modal';
import logolifi from '@/public/logo_lifi_light.png';
import { useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';

import type { YieldSnapshot } from '@/hooks/useYields';

import { getBridgeQuote, quoteUsdceOnLisk } from '@/lib/quotes';
import { TokenAddresses } from '@/lib/constants';
import {
  readWalletBalance,
  symbolForWalletDisplay,
  tokenAddrFor,
} from './helpers';

type EvmChain = 'optimism' | 'lisk';
type TokenId = 'usdc' | 'usdt' | 'usdt0_op';

interface Token {
  id: TokenId;
  name: string;
  symbol: 'USDC' | 'USDT' | 'USDCe' | 'USDT0';
  icon: string;
  balance: number;
  address: string;
}

interface DepositWithdrawProps {
  initialTab?: 'deposit' | 'withdraw';
  snap?: YieldSnapshot;
}

function normalizeRouteLabel(raw?: string | null) {
  if (!raw) return raw ?? null;
  return raw
    .replace(/Optimism/gi, 'OP Mainnet')
    .replace(/optimism/gi, 'OP Mainnet')
    .replace(/OPTIMISM/gi, 'OP Mainnet')
    .replace(/OP mainnet/gi, 'OP Mainnet'); // just in case
}

function formatAmountBigint(n: bigint, decimals: number): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (frac === 0n) return `${neg ? '-' : ''}${wholeStr}`;

  let fracStr = frac.toString().padStart(decimals, '0');
  fracStr = fracStr.slice(0, Math.min(6, fracStr.length)).replace(/0+$/, '');
  return `${neg ? '-' : ''}${wholeStr}${fracStr ? '.' + fracStr : ''}`;
}

function toLiskDestLabel(
  src: YieldSnapshot['token'] | 'USDC' | 'USDT' | 'WETH',
): 'USDCe' | 'USDT0' | 'WETH' {
  if (src === 'USDC') return 'USDCe';
  if (src === 'USDT') return 'USDT0';
  return 'WETH';
}

export function DepositWithdraw({
  initialTab = 'deposit',
  snap,
}: DepositWithdrawProps) {
  const { data: walletClient } = useWalletClient();

  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>(initialTab);
  const [amount, setAmount] = useState('');

  const [selectedToken, setSelectedToken] = useState<Token>({
    id: 'usdc',
    name: 'USD Coin',
    symbol: 'USDC',
    icon: '/tokens/usdc-icon.png',
    balance: 0,
    address: '0x0000...0000',
  });

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const [showWithdrawReview, setShowWithdrawReview] = useState(false);
  const [withdrawDest, setWithdrawDest] =
    useState<'optimism' >('optimism'); // type kept; we just don't use 'base'
  const [showWithdrawMenu, setShowWithdrawMenu] = useState(false);

  // Disclaimer state for deposits over $1000
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);

  const [availableTokenBalances, setAvailableTokenBalances] = useState<{
    USDC_Op: number;
    USDT_Op: number;
    USDT0_OP: number;
    USDCe_Lisk: number;
    USDT0_Lisk: number;
  }>({
    USDC_Op: 0,
    USDT_Op: 0,
    USDT0_OP: 0,
    USDCe_Lisk: 0,
    USDT0_Lisk: 0,
  });

  const [opBal, setOpBal] = useState<bigint | null>(null);
  const [liBal, setLiBal] = useState<bigint | null>(null);
  const [liBalUSDT0, setLiBalUSDT0] = useState<bigint | null>(null);
  const [opUsdcBal, setOpUsdcBal] = useState<bigint | null>(null);
  const [opUsdtBal, setOpUsdtBal] = useState<bigint | null>(null);
  const [stableUser, setStableUser] = useState<`0x${string}` | null>(null)


  // Kept for DepositModal compatibility; no Base usage now.
  const [baBal] = useState<bigint | null>(null);
  const [baUsdcBal] = useState<bigint | null>(null);
  const [baUsdtBal] = useState<bigint | null>(null);

  const [route, setRoute] = useState<string | null>(null);
  const [fee, setFee] = useState<bigint>(0n);
  const [received, setReceived] = useState<bigint>(0n);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Route & fees expanded state
  const [routeExpanded, setRouteExpanded] = useState(false);

  const vaultToken: 'USDC' | 'USDT' | 'WETH' = (snap?.token as any) ?? 'USDC';
  const tokenDecimals = vaultToken === 'WETH' ? 18 : 6;
  const destTokenLabel = toLiskDestLabel(vaultToken);
  const isUsdtFamily = vaultToken === 'USDT' || destTokenLabel === 'USDT0';

  const { data: positionsRaw } = usePositions();

  const positions = useMemo(
    () =>
      (positionsRaw ?? []) as Array<{
        protocol: string;
        chain: 'lisk' | string;
        token: 'USDCe' | 'USDT0' | 'WETH' | string;
        amount: bigint;
      }>,
    [positionsRaw],
  );

  const morphoTokenOnLisk: 'USDCe' | 'USDT0' | 'WETH' = destTokenLabel;
  const withdrawPosition = useMemo(
    () =>
      positions.find(
        (p) =>
          p.protocol === 'Morpho Blue' &&
          p.chain === 'lisk' &&
          (p.token as any) === morphoTokenOnLisk,
      ),
    [positions, morphoTokenOnLisk],
  );

  const withdrawBalanceHuman = useMemo(
    () => formatAmountBigint(BigInt(withdrawPosition?.amount ?? 0n), 18),
    [withdrawPosition],
  );

  const depositWalletBalance = useMemo(() => {
    const toNum6 = (x: bigint | null | undefined) => Number(x ?? 0n) / 1e6;

    switch (selectedToken.id) {
      case 'usdt0_op':
        return availableTokenBalances.USDT0_OP;
      case 'usdc': {
        const op = toNum6(opUsdcBal);
        return op;
      }
      case 'usdt': {
        const op = toNum6(opUsdtBal);
        return op;
      }
      default:
        return 0;
    }
  }, [selectedToken.id, availableTokenBalances, opUsdcBal, opUsdtBal]);

  // Fetch OP + Lisk balances (Lisk balances are still useful for display/withdraw)
  useEffect(() => {
    if (!walletClient) {
      setAvailableTokenBalances({
        USDC_Op: 0,
        USDT_Op: 0,
        USDT0_OP: 0,
        USDCe_Lisk: 0,
        USDT0_Lisk: 0,
      });
      return;
    }
    const user = walletClient.account!.address as `0x${string}`;

    (async () => {
      try {
        const usdceAddr = TokenAddresses.USDCe.lisk as `0x${string}`;
        const usdt0Addr = TokenAddresses.USDT0.lisk as `0x${string}`;
        const usdt0OpAddr = TokenAddresses.USDT0.optimism as `0x${string}`;
        const usdcOpAddr = TokenAddresses.USDC.optimism as `0x${string}`;
        const usdtOpAddr = TokenAddresses.USDT.optimism as `0x${string}`;

        const [usdcOp, usdtOp, usdceLi, usdt0Li, usdt0Op] = await Promise.all([
          readWalletBalance('optimism', usdcOpAddr, user).catch(() => 0n),
          readWalletBalance('optimism', usdtOpAddr, user).catch(() => 0n),
          readWalletBalance('lisk', usdceAddr, user).catch(() => 0n),
          readWalletBalance('lisk', usdt0Addr, user).catch(() => 0n),
          readWalletBalance('optimism', usdt0OpAddr, user).catch(() => 0n),
        ]);

        const toNum6 = (x: bigint) => Number(x) / 1e6;

        setAvailableTokenBalances({
          USDC_Op: toNum6(usdcOp),
          USDT_Op: toNum6(usdtOp),
          USDT0_OP: toNum6(usdt0Op),
          USDCe_Lisk: toNum6(usdceLi),
          USDT0_Lisk: toNum6(usdt0Li),
        });
      } catch {
        setAvailableTokenBalances({
          USDC_Op: 0,
          USDT_Op: 0,
          USDT0_OP: 0,
          USDCe_Lisk: 0,
          USDT0_Lisk: 0,
        });
      }
    })();
  }, [walletClient]);

  useEffect(() => {
    if (showWithdrawReview && walletClient?.account?.address) {
      setStableUser(walletClient.account.address as `0x${string}`)
    }
  }, [showWithdrawReview, walletClient])
  

  useEffect(() => {
    if (!snap) return;
    const isUSDT = snap.token === 'USDT';
    setSelectedToken((prev) => ({
      ...prev,
      id: isUSDT ? 'usdt' : 'usdc',
      name: isUSDT ? 'Tether USD' : 'USD Coin',
      symbol: isUSDT ? 'USDT' : 'USDC',
      icon: isUSDT ? '/tokens/usdt-icon.png' : '/tokens/usdc-icon.png',
    }));
  }, [snap]);

  // Wallet balances per chain (OP + Lisk only)
  useEffect(() => {
    if (!walletClient || !snap) return;
    const user = walletClient.account?.address as `0x${string}`;

    const opSym = symbolForWalletDisplay(snap.token, 'optimism');
    const liSym = symbolForWalletDisplay(snap.token, 'lisk');

    const addrOrNull = (sym: YieldSnapshot['token'], ch: EvmChain) => {
      try {
        return tokenAddrFor(sym, ch);
      } catch {
        return null;
      }
    };

    const opAddr = addrOrNull(opSym, 'optimism');
    const liAddr = addrOrNull(liSym, 'lisk');

    const reads: Promise<bigint | null>[] = [
      opAddr
        ? readWalletBalance('optimism', opAddr, user)
        : Promise.resolve(null),
      liAddr ? readWalletBalance('lisk', liAddr, user) : Promise.resolve(null),
    ];

    const liskUSDT0Addr = (TokenAddresses.USDT0 as any)
      ?.lisk as `0x${string}` | undefined;
    if (isUsdtFamily && liskUSDT0Addr) {
      reads.push(readWalletBalance('lisk', liskUSDT0Addr, user));
    } else {
      reads.push(Promise.resolve(null));
    }

    const opUsdc = addrOrNull('USDC', 'optimism');
    const opUsdt = addrOrNull('USDT', 'optimism');

    reads.push(
      opUsdc
        ? readWalletBalance('optimism', opUsdc, user)
        : Promise.resolve(null),
    );
    reads.push(
      opUsdt
        ? readWalletBalance('optimism', opUsdt, user)
        : Promise.resolve(null),
    );

    Promise.allSettled(reads).then((vals) => {
      const v = vals.map((r) =>
        r.status === 'fulfilled' ? ((r as any).value as bigint | null) : null,
      );
      const [op, li, liU0, _opUsdc, _opUsdt] = v;
      setOpBal(op ?? null);
      setLiBal(li ?? null);
      setLiBalUSDT0(liU0 ?? null);
      setOpUsdcBal(_opUsdc ?? null);
      setOpUsdtBal(_opUsdt ?? null);
    });
  }, [walletClient, snap, isUsdtFamily]);

  // Quote logic – deposits always from OP now
  useEffect(() => {
    if (!walletClient || !amount || !snap) {
      setRoute(null);
      setFee(0n);
      setReceived(0n);
      setQuoteError(null);
      return;
    }
    if (snap.chain !== 'lisk') {
      setRoute(null);
      setFee(0n);
      setReceived(0n);
      setQuoteError('Only Lisk deposits are supported');
      return;
    }

    const amt = parseUnits(amount, tokenDecimals);

// We always use Optimism as the source now
const src = 'optimism' as const;


    if (destTokenLabel === 'USDT0') {
      getBridgeQuote({
        token: 'USDT0',
        amount: amt,
        from: src,
        to: 'lisk',
        fromAddress: walletClient.account!.address as `0x${string}`,
        fromTokenSym: selectedToken.symbol,
      })
        .then((q) => {
          const minOut = BigInt(q.estimate?.toAmountMin ?? '0');
          const f = BigInt(q.bridgeFeeTotal ?? '0');

          setRoute(
            normalizeRouteLabel(q.route) ??
              `Bridge ${selectedToken.symbol} → USDT0`,
          );
          setFee(f);
          setReceived(minOut);
          setQuoteError(null);
        })
        .catch(() => {
          setRoute(null);
          setFee(0n);
          setReceived(0n);
          setQuoteError('Could not fetch bridge quote');
        });

      return;
    }

    if (destTokenLabel === 'USDCe') {
      const opBalForQuote = opBal ?? 0n;
      const baBalForQuote = 0n; // no Base now

      quoteUsdceOnLisk({
        amountIn: amt,
        opBal: opBalForQuote,
        baBal: baBalForQuote,
        fromAddress: walletClient.account!.address as `0x${string}`,
      })
        .then((q) => {
          setRoute(
            normalizeRouteLabel(q.route) ?? 'Bridge → USDCe',
          );
          setFee(q.bridgeFee ?? 0n);
          setReceived(q.bridgeOutUSDCe ?? 0n);
          setQuoteError(null);
        })
        .catch(() => {
          setRoute(null);
          setFee(0n);
          setReceived(0n);
          setQuoteError('Could not fetch bridge quote');
        });
      return;
    }

    // Fallback (e.g. WETH vaults) – treat as bridged via LI.FI as well
    getBridgeQuote({
      token: destTokenLabel,
      amount: amt,
      from: src,
      to: 'lisk',
      fromAddress: walletClient.account!.address as `0x${string}`,
      fromTokenSym: selectedToken.symbol,
    })
      .then((q) => {
        const minOut = BigInt(q.estimate?.toAmountMin ?? '0');
        const f = BigInt(q.bridgeFeeTotal ?? '0');

        setRoute(
          normalizeRouteLabel(q.route) ??
            `Bridge ${selectedToken.symbol} → ${destTokenLabel}`,
        );
        setFee(f);
        setReceived(minOut);
        setQuoteError(null);
      })
      .catch(() => {
        setRoute(null);
        setFee(0n);
        setReceived(0n);
        setQuoteError('Could not fetch bridge quote');
      });
  }, [
    amount,
    walletClient,
    tokenDecimals,
    snap,
    destTokenLabel,
    opBal,
    liBal,
    liBalUSDT0,
    selectedToken.symbol,
  ]);

  const amountNum = Number.parseFloat(amount) || 0;

  const bridgeFeeDisplay = useMemo(() => {
    if (!amount || Number(amount) <= 0) return 0;
    if (fee === 0n) return 0.0025;
    return Number(fee) / 10 ** tokenDecimals;
  }, [amount, fee, tokenDecimals]);

  const receiveAmountDisplay = useMemo(() => {
    if (!amount) return 0;
    if (received === 0n) return Math.max(amountNum - 0.0025, 0);
    return Number(received) / 10 ** tokenDecimals;
  }, [amount, amountNum, received, tokenDecimals]);

  const withdrawBridgeFeeDisplay = 0.0025;
  const withdrawReceiveDisplay = Math.max(
    amountNum - withdrawBridgeFeeDisplay,
    0,
  );
  const withdrawSharesBigint = useMemo(() => {
    try {
      return parseUnits(amount || '0', 18);
    } catch {
      return 0n;
    }
  }, [amount]);

  const availableTokens: Token[] = [
    {
      id: 'usdc',
      name: 'USD Coin',
      symbol: 'USDC',
      icon: '/tokens/usdc-icon.png',
      balance: availableTokenBalances.USDC_Op,
      address: TokenAddresses.USDC.optimism as `0x${string}`,
    },
    {
      id: 'usdt',
      name: 'Tether USD',
      symbol: 'USDT',
      icon: '/tokens/usdt-icon.png',
      balance: availableTokenBalances.USDT_Op,
      address: TokenAddresses.USDT.optimism as `0x${string}`,
    },
    {
      id: 'usdt0_op',
      name: 'USDT0',
      symbol: 'USDT0',
      icon: '/tokens/usdt0-icon.png',
      balance: availableTokenBalances.USDT0_OP,
      address: TokenAddresses.USDT0.optimism as `0x${string}`,
    },
  ];

  const withdrawChoices = useMemo(() => {
    const isUSDT = destTokenLabel === 'USDT0';
    const stableSymbol = isUSDT ? 'USDT' : 'USDC';
    return [
      {
        id: 'optimism' as const,
        chainLabel: 'OP Mainnet',
        symbol: stableSymbol,
        icon: '/networks/op-icon.png',
        description: `Bridge to OP ${stableSymbol}`,
      },
      // no Base option anymore
    ];
  }, [destTokenLabel]);

  const currentWithdrawChoice =
    withdrawChoices.find((c) => c.id === withdrawDest) ?? withdrawChoices[0];

  const sourceSymbolForModal: 'USDC' | 'USDT' | 'USDCe' | 'USDT0' =
    selectedToken.id === 'usdt0_op'
      ? 'USDT0'
      : selectedToken.id === 'usdt'
      ? 'USDT'
      : 'USDC';

  // Check if deposit requires disclaimer (over $1000)
  const requiresDisclaimer = activeTab === 'deposit' && amountNum >= 1000;
  const canProceedWithDeposit = !requiresDisclaimer || disclaimerAccepted;

  const confirmDisabled =
    !(amountNum > 0) ||
    Boolean(quoteError) ||
    !snap ||
    (activeTab === 'deposit' && !canProceedWithDeposit);

  const onDepositClick = () => {
    if (confirmDisabled || activeTab !== 'deposit') return;
    setShowReview(true);
  };

  const onWithdrawClick = () => {
    if (!(amountNum > 0) || !snap) return;
    setShowWithdrawReview(true);
  };

  // Reset disclaimer when amount changes
  useEffect(() => {
    if (amountNum < 1000) {
      setDisclaimerAccepted(false);
    }
  }, [amountNum]);

  if (!snap) {
    return (
      <Card className="w-full max-w-2xl mx-auto p-6 shadow-none">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
          <div className="h-10 bg-muted rounded" />
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full max-w-2xl mx-auto p-6 shadow-none border-0">
        {/* Tabs */}
        <div className="flex items-center gap-8 mb-6 border-b">
          <button
            onClick={() => setActiveTab('deposit')}
            className={`pb-3 text-[16px] font-semibold transition-colors relative ${
              activeTab === 'deposit'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Deposit
            {activeTab === 'deposit' && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-foreground rounded-t" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('withdraw')}
            className={`pb-3 text-[16px] font-semibold transition-colors relative ${
              activeTab === 'withdraw'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Withdraw
            {activeTab === 'withdraw' && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-foreground rounded-t" />
            )}
          </button>
        </div>

        <div className="space-y-4">
          {/* Label and Balance */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">
              {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}{' '}
              {activeTab === 'deposit'
                ? selectedToken.symbol
                : destTokenLabel}
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {activeTab === 'withdraw'
                  ? `${withdrawBalanceHuman} ${destTokenLabel}`
                  : `${depositWalletBalance.toFixed(2)} ${selectedToken.symbol}`}
              </span>
              <button
                onClick={() => {
                  if (activeTab === 'withdraw') {
                    const raw =
                      Number(withdrawBalanceHuman.replace(/,/g, '')) || 0;
                    if (raw <= 0) {
                      setAmount('');
                      return;
                    }
                    const factor = 1e6;
                    const floored = Math.floor(raw * factor) / factor;
                    setAmount(floored.toString());
                  } else {
                    const raw = depositWalletBalance;
                    if (!Number.isFinite(raw) || raw <= 0) {
                      setAmount('');
                      return;
                    }
                    const factor = 1e6;
                    const floored = Math.floor(raw * factor) / factor;
                    setAmount(floored.toString());
                  }
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-1 rounded-md hover:bg-blue-50 transition-colors"
              >
                MAX
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="bg-muted rounded-xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="text-[20px] font-semibold bg-transparent outline-none w-full placeholder:text-muted-foreground"
                />
                <div className="text-muted-foreground text-base mt-2">
                  ${(Number.parseFloat(amount || '0') * 1).toFixed(2)}
                </div>
              </div>

              {activeTab === 'deposit' ? (
                <button
                  onClick={() => setShowTokenModal(true)}
                  className="flex items-center gap-2.5 bg-background rounded-xl hover:bg-muted/50 transition-colors border border-border px-3 py-2"
                >
                  <div className="relative">
                    <Image
                      src={selectedToken.icon}
                      alt={selectedToken.symbol}
                      width={28}
                      height={28}
                      className="rounded-full"
                    />
                    {/* Network badge: always OP for deposits */}
                    <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                      <Image
                        src="/networks/op-icon.png"
                        alt="OP Mainnet"
                        width={16}
                        height={16}
                        className="rounded-sm"
                      />
                    </div>
                  </div>
                  <span className="font-semibold text-base">{selectedToken.symbol}</span>
                  <ChevronDown size={18} className="text-muted-foreground" />
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowWithdrawMenu((v) => !v)}
                    className="flex items-center gap-2.5 bg-background rounded-xl hover:bg-muted/50 transition-colors border border-border px-3 py-2"
                  >
                    <div className="relative">
                      <Image
                        src={currentWithdrawChoice.icon}
                        alt={currentWithdrawChoice.symbol}
                        width={28}
                        height={28}
                        className="rounded-full"
                      />
                      {/* Network badge */}
                      <div className="absolute -bottom-0.5 -right-0.5 rounded-sm border-2 border-background">
                        <Image
                          src={'/networks/op-icon.png'}
                          alt="network"
                          width={16}
                          height={16}
                          className="rounded-sm"
                        />
                      </div>
                    </div>
                    <span className="font-semibold text-base">
                      {currentWithdrawChoice.symbol}
                    </span>
                    <ChevronDown size={18} className="text-muted-foreground" />
                  </button>

                  {showWithdrawMenu && (
                    <div className="absolute right-0 mt-2 w-64 rounded-xl border bg-popover shadow-lg z-20 overflow-hidden">
                      {withdrawChoices.map((choice) => (
                        <button
                          key={choice.id}
                          type="button"
                          onClick={() => {
                            setWithdrawDest(choice.id);
                            setShowWithdrawMenu(false);
                          }}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted transition-colors ${
                            choice.id === withdrawDest ? 'bg-muted' : 'bg-popover'
                          }`}
                        >
                          <div className="w-6 h-6 relative">
                            <Image
                              src={choice.icon}
                              alt={choice.chainLabel}
                              width={24}
                              height={24}
                              className="rounded-full"
                            />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-semibold text-sm">
                              {choice.symbol} • {choice.chainLabel}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {choice.description}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Empty State */}
          {!amount && (
            <div className="text-center p-4 text-muted-foreground text-[13px] rounded-xl bg-muted/50">
              Enter an amount
            </div>
          )}

          {/* Disclaimer for deposits over $1000 */}
          {amount && requiresDisclaimer && (
            <div className="border-2 border-orange-200 dark:border-orange-900/50 bg-orange-50 dark:bg-orange-950/20 rounded-xl p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-5 h-5 rounded-full bg-orange-200 dark:bg-orange-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    className="text-orange-600 dark:text-orange-400"
                  >
                    <path
                      d="M6 1L1 11H11L6 1Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M6 5V7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="6" cy="9" r="0.5" fill="currentColor" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-orange-900 dark:text-orange-200 mb-1">
                    Disclaimer
                  </h3>
                  <p className="text-sm text-orange-800 dark:text-orange-300">
                    EcoVaults is in beta. For safety, we recommend keeping deposits under $1,000.
                  </p>
                </div>
              </div>
              <div className="border-t border-orange-200 dark:border-orange-900/50 pt-3 mt-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={disclaimerAccepted}
                    onChange={(e) => setDisclaimerAccepted(e.target.checked)}
                    className="w-5 h-5 rounded border-orange-300 dark:border-orange-800 text-orange-600 focus:ring-orange-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium text-orange-900 dark:text-orange-200">
                    I understand and want to continue.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Action Button */}
          {amount && (
            <>
              <Button
                onClick={activeTab === 'deposit' ? onDepositClick : onWithdrawClick}
                size="lg"
                disabled={confirmDisabled}
                className="w-full text-white bg-blue-600 hover:bg-blue-700 text-base font-semibold h-14 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl"
                title={
                  quoteError ??
                  (activeTab === 'deposit' ? 'Deposit' : 'Withdraw')
                }
              >
                {activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}
              </Button>

              {/* Route & Fees Section */}
              <div className="border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setRouteExpanded(!routeExpanded)}
                  className="w-full px-5 py-4 flex items-center justify-center hover:bg-muted/30 transition-colors"
                >
                  <span className="font-semibold text-foreground text-base text-center">
                    Route & fees
                  </span>
                  <ChevronDown
                    size={20}
                    className={`text-muted-foreground transition-transform ${
                      routeExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {routeExpanded && (() => {
                  const isDeposit = activeTab === 'deposit';

                  const depSrcChainName = 'OP Mainnet';
                  const depSrcIcon = '/networks/op-icon.png';
                  const depSrcToken = selectedToken.symbol;
                  const depDstChainName = 'Lisk';
                  const depDstIcon = '/networks/lisk.png';
                  const depDstToken = destTokenLabel;

                  const wSrcChainName = 'Lisk';
                  const wSrcIcon = '/networks/lisk.png';
                  const wSrcToken = destTokenLabel;
                  const wDstChainName =
                    withdrawDest === 'optimism'
                      ? 'OP Mainnet'
                      : 'Lisk';
                  const wDstIcon =
                    withdrawDest === 'optimism'
                      ? '/networks/op-icon.png'
                      : '/networks/lisk.png';
                  const wDstToken ='USDT'

                  const feeToken = isDeposit ? selectedToken.symbol : wDstToken;
                  const receiveToken = isDeposit ? destTokenLabel : wDstToken;

                  const bridgingOnDeposit =
                    isDeposit &&
                    (destTokenLabel === 'USDT0' || destTokenLabel === 'USDCe');

                  const bridgingOnWithdraw =
                    !isDeposit;

                  const protocolFee =
                    !isDeposit && amountNum > 0 ? amountNum * 0.005 : 0;

                  const bridgeFee =
                    isDeposit
                      ? (bridgingOnDeposit ? bridgeFeeDisplay : 0)
                      : (bridgingOnWithdraw ? withdrawBridgeFeeDisplay : 0);

                  const totalFee = protocolFee + bridgeFee;

                  const receiveDisplay = (() => {
                    if (isDeposit) return receiveAmountDisplay;
                    const gross = amountNum;
                    const net = Math.max(
                      gross - protocolFee - (bridgingOnWithdraw ? withdrawBridgeFeeDisplay : 0),
                      0,
                    );
                    return net;
                  })();

                  const routeLabel = (() => {
                    if (isDeposit) {
                      if (route && route !== 'On-chain') return route;
                      if (bridgingOnDeposit) {
                        return 'Routing via LI.FI bridge';
                      }
                      return 'On-chain';
                    }
                    if (!bridgingOnWithdraw) return 'On-chain';
                    return 'Routing via LI.FI bridge';
                  })();

                  return (
                    <div className="border-t border-border px-5 py-5">
                      {/* Chain Route Visualization */}
                      <div className="flex justify-between gap-3 mb-5">
                        <div className="flex-1 bg-muted rounded-xl px-4 py-3.5">
                          <div className="flex items-center gap-2.5 bg-white p-2 rounded-lg">
                            <div className="w-6 h-6 relative rounded-md overflow-hidden">
                              <Image
                                src={isDeposit ? depSrcIcon : wSrcIcon}
                                alt={isDeposit ? depSrcChainName : wSrcChainName}
                                width={24}
                                height={24}
                                className="rounded-none"
                              />
                            </div>
                            <span className="font-semibold text-sm text-foreground">
                              {isDeposit ? depSrcChainName : wSrcChainName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 mt-1.5 bg-white p-2 rounded-full">
                            <div className="w-6 h-6 relative">
                              <Image
                                src={
                                  isDeposit
                                    ? selectedToken.icon
                                    : (destTokenLabel === 'USDCe'
                                        ? '/tokens/usdc-icon.png'
                                        : '/tokens/usdt0-icon.png')
                                }
                                alt={isDeposit ? depSrcToken : wSrcToken}
                                width={24}
                                height={24}
                                className="rounded-full"
                              />
                            </div>
                            <span className="font-semibold text-sm text-foreground">
                              {isDeposit ? depSrcToken : wSrcToken}
                            </span>
                          </div>
                        </div>

                        <div className="">
                          <div className="w-18 h-full rounded-xl border border-border flex items-center justify-center flex-shrink-0">
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 20 20"
                              fill="none"
                              className="text-muted-foreground"
                            >
                              <path
                                d="M4 10H16M16 10L10 4M16 10L10 16"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        </div>

                        <div className="flex-1 bg-muted rounded-xl px-4 py-3.5">
                          <div className="flex items-center gap-2.5 bg-white p-2 rounded-lg">
                            <div className="w-6 h-6 relative rounded-md overflow-hidden">
                              <Image
                                src={isDeposit ? depDstIcon : wDstIcon}
                                alt={isDeposit ? depDstChainName : wDstChainName}
                                width={24}
                                height={24}
                                className="rounded-none"
                              />
                            </div>
                            <span className="font-semibold text-sm text-foreground">
                              {isDeposit ? depDstChainName : wDstChainName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2.5 mt-1.5 bg-white p-2 rounded-full">
                            <div className="w-6 h-6 relative">
                              <Image
                                src={
                                  destTokenLabel === 'USDCe'
                                    ? '/tokens/usdc-icon.png'
                                    : '/tokens/usdt0-icon.png'
                                }
                                alt={isDeposit ? depDstToken : wDstToken}
                                width={24}
                                height={24}
                                className="rounded-full"
                              />
                            </div>
                            <span className="font-semibold text-sm text-foreground">
                              {isDeposit ? depDstToken : wDstToken}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Fee Details */}
                      <div className="border-[#E5E7EB] border rounded-xl p-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            {routeLabel}
                          </span>
                          {bridgingOnDeposit && (
                            <div className="w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                              <Image
                                src={logolifi}
                                alt="Bridge"
                                width={16}
                                height={16}
                                className="object-contain"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src =
                                    '/protocols/morpho-icon.png';
                                }}
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            Bridge fee (estimated):
                          </span>
                          <span className="font-normal text-foreground">
                            {totalFee.toFixed(4)} {feeToken}
                          </span>
                        </div>

                        {!isDeposit && amountNum > 0 && (
                          <div className="text-xs text-muted-foreground space-y-0.5 pl-2 border-l-2 border-muted">
                            <div>• 0.5% vault withdraw fee</div>
                            {bridgingOnWithdraw && (
                              <div>• Bridge fee via LI.FI (est.)</div>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">
                            You&apos;ll {isDeposit ? 'deposit' : 'receive'}:
                          </span>
                          <span className="font-normal text-foreground">
                            {receiveDisplay.toFixed(6)} {receiveToken}
                          </span>
                        </div>

                        {quoteError && isDeposit && (
                          <div className="mt-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 rounded">
                            Quote error: {quoteError}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </Card>

      {showTokenModal && (
        <SelectTokenModal
          tokens={availableTokens}
          selectedToken={selectedToken}
          onSelect={(token: any) => {
            setSelectedToken(token);
            setShowTokenModal(false);
          }}
          onClose={() => setShowTokenModal(false)}
        />
      )}

      {showReview && activeTab === 'deposit' && snap && (
        <DepositModal
          open={showReview}
          onClose={() => setShowReview(false)}
          snap={snap}
          amount={amount}
          sourceSymbol={sourceSymbolForModal}
          destTokenLabel={destTokenLabel}
          routeLabel={route ?? 'Routing via LI.FI'}
          bridgeFeeDisplay={bridgeFeeDisplay}
          receiveAmountDisplay={receiveAmountDisplay}
          opBal={opBal}
          baBal={baBal}
          liBal={liBal}
          liBalUSDT0={liBalUSDT0}
          opUsdcBal={opUsdcBal}
          baUsdcBal={baUsdcBal}
          opUsdtBal={opUsdtBal}
          baUsdtBal={baUsdtBal}
        />
      )}

{showWithdrawReview &&
  activeTab === 'withdraw' &&
  snap &&
  stableUser && (
    <ReviewWithdrawModal
      open={showWithdrawReview}
      onClose={() => setShowWithdrawReview(false)}
      snap={{
        token: snap.token as 'USDC' | 'USDT',
        chain: 'lisk',
        poolAddress: (snap as any).poolAddress,
      }}
      shares={withdrawSharesBigint}
      amountOnLiskDisplay={amountNum}
      bridgeFeeDisplay={
         withdrawBridgeFeeDisplay
      }
      receiveOnDestDisplay={
         withdrawReceiveDisplay
      }
      dest={withdrawDest}
      user={stableUser}
    />
)}

    </>
  );
}
