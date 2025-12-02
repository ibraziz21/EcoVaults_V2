// src/app/docs/page.tsx
'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

export default function DocsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-teal-600 via-cyan-600 to-teal-700 text-white shadow-lg">
        <div className="absolute right-[-80px] top-[-80px] h-60 w-60 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            SuperYield-R — Docs
          </h1>
          <p className="mt-2 max-w-2xl text-white/85">
            A simple way to supply USDC/USDT (and WETH on Lisk) across Aave v3, Compound v3,
            and Morpho—without juggling chains or approvals yourself.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/">
              <Button size="sm" variant="secondary" title={'Open App'}>Open App</Button>
            </Link>
            <a href="#getting-started">
              <Button size="sm" variant="outline" className="bg-white/10 text-white hover:bg-white/20" title={'Getting Started'}>
                Getting Started
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mt-10 grid gap-8">
        <Section title="What is SuperYield-R?">
          <p>
            SuperYield-R is a cross-chain yield router. Pick a market, enter an amount,
            and we’ll handle the rest: bridging if needed, approving the token, and
            depositing on the correct network. You see the route, fees, and the net
            amount that will be supplied—before you confirm.
          </p>
        </Section>

        <Section id="getting-started" title="Getting started (2 minutes)">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <b>Connect your wallet</b> on the Dashboard.
            </li>
            <li>
              <b>Pick a market</b> in the Markets table (Aave, Compound, or Morpho),
              then click <i>Deposit</i>.
            </li>
            <li>
              <b>Review the route</b>: If funds are on the wrong chain,
              we’ll show a bridge quote and the net amount after fees.
            </li>
            <li>
              <b>Confirm</b>: We’ll switch networks (if needed), approve, and supply in one flow.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            You stay in control the whole time—every transaction is shown and requires your approval.
          </p>
        </Section>

        <CardsRow
          items={[
            {
              title: 'Supported networks',
              body: (
                <ul className="grid list-disc grid-cols-2 gap-1 pl-5 text-sm text-muted-foreground sm:grid-cols-3">
                  <li>Optimism</li>
                  <li>Base</li>
                  <li>Lisk</li>
                </ul>
              ),
            },
            {
              title: 'Supported assets',
              body: (
                <ul className="grid list-disc grid-cols-2 gap-1 pl-5 text-sm text-muted-foreground sm:grid-cols-3">
                  <li>USDC (OP / Base)</li>
                  <li>USDT (OP / Base)</li>
                  <li>USDCe (Lisk)</li>
                  <li>USDT0 (Lisk)</li>
                  <li>WETH (Lisk)</li>
                </ul>
              ),
            },
            {
              title: 'Protocols',
              body: (
                <ul className="grid list-disc grid-cols-2 gap-1 pl-5 text-sm text-muted-foreground sm:grid-cols-3">
                  <li>Aave v3</li>
                  <li>Compound v3 (Comet)</li>
                  <li>Morpho Blue (MetaMorpho vaults)</li>
                </ul>
              ),
            },
          ]}
        />

        <Section title="Fees (plain English)">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li>
              <b>Bridge fee:</b> Only when funds must move chains (via Across). Shown in the modal before you confirm.
            </li>
            <li>
              <b>Protocol fee:</b> Built into Aave/Compound/Morpho rates (reflected in APY).
            </li>
            <li>
              <b>Platform fee (optional):</b> If enabled, clearly shown in the modal before you proceed.
            </li>
          </ul>
        </Section>

        <Section title="Safety & control">
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            <li><b>You always sign</b> each step (approve, bridge, deposit).</li>
            <li><b>Funds go directly</b> to protocol contracts—no custody.</li>
            <li><b>Transparent preview</b> of routes, network switches, and net deposit amount.</li>
          </ul>
        </Section>

        <Section title="Common questions">
          <FAQ
            items={[
              {
                q: 'Why is the deposit amount smaller than I entered?',
                a: 'If your funds are on another chain, we show the bridge quote with fees. The “Will deposit” line reflects the net amount after fees.',
              },
              {
                q: 'Can I withdraw back to a different chain automatically?',
                a: 'Withdraws happen on the chain where you deposited. Auto-bridge on withdraw is planned for a future update.',
              },
              {
                q: 'Do you rebalance across protocols automatically?',
                a: 'Not in the MVP. You choose where to deposit. We may add automated strategies later.',
              },
            ]}
          />
        </Section>

        <Section title="Need help?">
          <p className="text-sm text-muted-foreground">
            Spot something off or need support? Reach out and we’ll jump in.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="#" rel="noreferrer">
              <Button variant="secondary" title={'Discord'}>Discord</Button>
            </Link>
            <Link href="#" rel="noreferrer">
              <Button variant="outline" title={'Email'}>Email</Button>
            </Link>
          </div>
        </Section>
      </div>
    </div>
  )
}

/* ---------- tiny UI helpers ---------- */

function Section({
  id,
  title,
  children,
}: {
  id?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 text-sm leading-6">{children}</div>
    </section>
  )
}

function CardsRow({
  items,
}: {
  items: { title: string; body: React.ReactNode }[]
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <h4 className="mb-2 font-semibold">{it.title}</h4>
            {it.body}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function FAQ({
  items,
}: {
  items: { q: string; a: string }[]
}) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="divide-y rounded-lg border">
      {items.map((x, i) => (
        <details
          key={i}
          open={open === i}
          onClick={(e) => {
            e.preventDefault()
            setOpen(open === i ? null : i)
          }}
          className="group"
        >
          <summary className="cursor-pointer select-none p-3 font-medium group-open:bg-secondary/10">
            {x.q}
          </summary>
          <div className="px-3 pb-3 text-sm text-muted-foreground">{x.a}</div>
        </details>
      ))}
    </div>
  )
}
