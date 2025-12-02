// src/components/rewards/MerklRewardsPanel.tsx
'use client'

import { FC, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMerklRewards } from '@/hooks/useMerklRewards'
import { useAppKit } from '@reown/appkit/react'
import { useWalletClient, useSwitchChain, useChainId } from 'wagmi'
import { optimism, base, lisk } from 'viem/chains'
import type { Address } from 'viem'
import { formatUnits } from 'viem'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { buildClaimArgs, MERKL_DISTRIBUTOR, distributorAbi } from '@/lib/merkl'
import { useUsdPrices } from '@/hooks/useUSDPrices'

const CHAINS = [lisk, optimism, base] as const
const CHAIN_LABEL: Record<number, string> = {
    [lisk.id]: 'Lisk',
    [optimism.id]: 'Optimism',
    [base.id]: 'Base',
}

function explorerTxBaseUrl(chainId: number) {
    if (chainId === base.id) return 'https://basescan.org/tx/'
    if (chainId === optimism.id) return 'https://optimistic.etherscan.io/tx/'
    if (chainId === lisk.id) return 'https://blockscout.lisk.com/tx/'
    return '#'
}

export const MerklRewardsPanel: FC = () => {
    const { open: openConnect } = useAppKit()
    const { data: wallet } = useWalletClient()
    const activeChainId = useChainId()
    const { switchChainAsync, isPending: switching } = useSwitchChain()
    const { priceUsdForSymbol, isLoading: pricesLoading } = useUsdPrices()

    const { rewards, isLoading, error, refetch } = useMerklRewards()
    const [enabledChains, setEnabledChains] = useState<Record<number, boolean>>({
        [lisk.id]: true,
        [optimism.id]: true,
        [base.id]: true,
    })
    const [selected, setSelected] = useState<Record<string, boolean>>({}) // key = `${chainId}-${tokenAddr}`

    const filtered = useMemo(
        () =>
            rewards.filter((r) => enabledChains[r.chainId]),
        [rewards, enabledChains],
    )

    const grouped = useMemo(() => {
        const byChain = new Map<number, typeof filtered>()
        for (const r of filtered) {
            const arr = byChain.get(r.chainId) ?? []
            arr.push(r)
            byChain.set(r.chainId, arr)
        }
        return byChain
    }, [filtered])

    function usdOf(r: { amount: string; token: { decimals: number; symbol: string } }) {
        const qty = Number(BigInt(r.amount)) / 10 ** r.token.decimals
        const px = priceUsdForSymbol(r.token.symbol)
        return qty * px
    }
    const selectedUsdTotal = useMemo(() => {
        return filtered.reduce((acc, r) => {
            const k = keyOf(r)
            if (Object.keys(selected).length === 0 || selected[k]) acc += usdOf(r)
            return acc
        }, 0)
    }, [filtered, selected, priceUsdForSymbol])
    const anySelected = useMemo(() => Object.values(selected).some(Boolean), [selected])

    function toggleChain(id: number) {
        setEnabledChains((prev) => ({ ...prev, [id]: !prev[id] }))
    }

    function keyOf(r: { chainId: number; token: { address: Address } }) {
        return `${r.chainId}-${r.token.address.toLowerCase()}`
    }

    function toggleOne(r: { chainId: number; token: { address: Address } }) {
        const k = keyOf(r)
        setSelected((prev) => ({ ...prev, [k]: !prev[k] }))
    }

    const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
    const [status, setStatus] = useState<'idle' | 'switching' | 'claiming' | 'success' | 'error'>('idle')
    const [errMsg, setErrMsg] = useState<string | null>(null)

    async function claimForChain(chainId: number, items = grouped.get(chainId) ?? []) {
        if (!wallet) return openConnect()

        try {
            setErrMsg(null)
            setTxHash(null)

            const distributor = MERKL_DISTRIBUTOR[chainId]
            if (!distributor) throw new Error(`Missing Distributor address for chain ${chainId}`)

            // Ensure correct network
            if (activeChainId !== chainId && switchChainAsync) {
                setStatus('switching')
                await switchChainAsync({ chainId })
            }

            const toClaim = items.filter((r) => {
                // if nothing selected, treat as "claim all" for this chain
                if (!anySelected) return true
                return !!selected[keyOf(r)]
            })
            if (toClaim.length === 0) throw new Error('No rewards selected')

            const { users, tokens, amounts, proofs } = buildClaimArgs({
                user: wallet.account!.address as Address,
                items: toClaim,
            })

            setStatus('claiming')
            const hash = await wallet.writeContract({
                address: distributor,
                abi: distributorAbi,
                functionName: 'claim',
                args: [users, tokens, amounts, proofs],
                account: wallet.account!.address as Address,
            })
            if (typeof hash === 'string' && hash.startsWith('0x')) {
                setTxHash(hash as `0x${string}`)
            }

            setStatus('success')
            setSelected({})
            refetch()
        } catch (e) {
            console.error('[MerklRewardsPanel] claim error', e)
            setErrMsg(e instanceof Error ? e.message : String(e))
            setStatus('error')
        }
    }

    async function claimAll() {
        // Claim per chain (Merkl requires chain-specific Distributor)
        for (const chain of CHAINS) {
            const list = (grouped.get(chain.id) ?? []).filter((r) => enabledChains[chain.id])
            if (list.length > 0) {
                await claimForChain(chain.id, list)
            }
        }
    }

    return (
        <div className="space-y-4">
            {/* Header card */}
            <div className="rounded-2xl border border-border/60 bg-gradient-to-r from-white to-white/60 p-4 dark:from-white/5 dark:to-white/10">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-semibold">Merkl Rewards</h3>
                        <p className="text-xs text-muted-foreground">
                            View and claim rewards streamed via Merkl (per token & chain).
                            {pricesLoading ? ' • Loading prices…' : ''}
                        </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => refetch()} title="Refresh">
                        <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                    {CHAINS.map((c) => (
                        <button
                            key={c.id}
                            onClick={() => toggleChain(c.id)}
                            className={`rounded-full px-3 py-1 text-xs transition ${enabledChains[c.id]
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:bg-muted'
                                }`}
                            title={CHAIN_LABEL[c.id]}
                        >
                            {CHAIN_LABEL[c.id]}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            <div className="space-y-3">
                {isLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading rewards…
                    </div>
                )}
                {!isLoading && filtered.length === 0 && (
                    <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
                        No claimable rewards found for the selected chains.
                    </div>
                )}

                {Array.from(grouped.entries()).map(([chainId, items]) => {
                    if (!enabledChains[chainId] || items.length === 0) return null
                    const chainUsd = items.reduce((acc, r) => acc + usdOf(r), 0)
                    return (
                        <div key={chainId} className="rounded-xl border p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <div className="text-sm font-medium">
                                    {CHAIN_LABEL[chainId]}
                                    <span className="ml-2 text-xs text-muted-foreground">
                                        (~${chainUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                                    </span>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={switching || status === 'claiming'}
                                    onClick={() => claimForChain(chainId)} title={anySelected ? 'Selected' : 'All'}                >
                                    Claim {anySelected ? 'Selected' : 'All'}
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {items.map((r) => {
                                    const k = `${chainId}-${r.token.address}`
                                    const checked = !!selected[k]
                                    const amt = formatUnits(BigInt(r.amount), r.token.decimals)
                                    const usd = usdOf(r)
                                    return (
                                        <div
                                            key={k}
                                            className="flex items-center justify-between rounded-lg border bg-white p-3 dark:bg-background"
                                        >
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => toggleOne(r)}
                                                    className={`h-4 w-4 rounded border ${checked ? 'bg-primary' : 'bg-white'
                                                        }`}
                                                    aria-label={checked ? 'Unselect' : 'Select'}
                                                    title="Select"
                                                />
                                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                                                    {r.token.symbol.slice(0, 3)}
                                                </div>
                                                <div className="leading-tight">
                                                    <div className="text-sm font-medium">{r.token.symbol}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {r.token.address.slice(0, 6)}…{r.token.address.slice(-4)}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <div className="text-xs text-muted-foreground">Claimable</div>
                                                <div className="text-sm font-semibold">{Number(amt).toFixed(2)}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    ~${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Sticky action bar */}
            <div className="sticky bottom-3 z-10 mx-auto max-w-3xl rounded-full border bg-white/80 p-2 backdrop-blur dark:bg-background/80">
                <div className="flex items-center justify-between gap-2 px-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {status === 'claiming' || status === 'switching' ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status === 'switching' ? 'Switching network…' : 'Claiming…'}
                            </>
                        ) : status === 'success' ? (
                            <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Claimed
                            </>
                        ) : status === 'error' ? (
                            <>
                                <AlertTriangle className="h-4 w-4 text-red-600" /> {errMsg ?? 'Claim failed'}
                            </>
                        ) : (
                            <span>
               Select items or Claim All
                {filtered.length > 0 && (
                  <> • Selected: ~${selectedUsdTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</>
                )}
              </span>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelected({})}
                            disabled={status === 'claiming' || status === 'switching'} title={'Clear Selection'}            >
                            Clear Selection
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => claimAll()}
                            disabled={filtered.length === 0 || status === 'claiming' || status === 'switching'} title={filtered.length ? `(~$${filtered.reduce((a, r) => a + usdOf(r), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ''}          >
                             Claim All {filtered.length ? `(~$${filtered.reduce((a, r) => a + usdOf(r), 0).toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ''}
                        </Button>
                    </div>
                </div>

                {status === 'success' && txHash && (
                    <div className="px-4 pb-2 pt-1 text-center text-xs">
                        <a
                            href={`${explorerTxBaseUrl(activeChainId)}${txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                        >
                            View transaction <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>
                )}
            </div>
        </div>
    )
}
