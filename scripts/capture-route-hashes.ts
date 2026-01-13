/**
 * Poll Li.Fi for intents that have a routeId but missing fromTxHash, attach the txHash,
 * and optionally trigger /api/deposits/finish.
 *
 * Usage:
 *   pnpm ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' scripts/capture-route-hashes.ts --finishUrl=http://localhost:3000/api/deposits/finish
 */

import { prisma } from '@/lib/db'

const args = process.argv.slice(2)
const finishArg = args.find((a) => a.startsWith('--finishUrl='))
const finishUrl = finishArg ? finishArg.replace('--finishUrl=', '') : 'http://localhost:3000/api/deposits/finish'

async function fetchStatus(routeId: string) {
  // Li.Fi status endpoint (routeId)
  const res = await fetch(`https://li.quest/v1/status?id=${routeId}`).catch(() => null)
  if (!res || !res.ok) return null
  return res.json().catch(() => null) as any
}

async function main() {
  const targets = await prisma.depositIntent.findMany({
    where: {
      routeId: { not: null },
      fromTxHash: null,
      status: { in: ['PENDING', 'WAITING_ROUTE', 'PROCESSING', 'BRIDGE_IN_FLIGHT'] },
    },
    take: 50,
    orderBy: { updatedAt: 'asc' },
    select: { refId: true, routeId: true },
  })

  console.log(`[capture-route-hashes] checking ${targets.length} intents`)

  for (const row of targets) {
    const routeId = row.routeId as string
    if (!routeId) continue
    const status = await fetchStatus(routeId)
    const txHash = (status as any)?.txHash as string | undefined
    if (!txHash) {
      console.log('[capture-route-hashes] no txHash yet', row.refId)
      continue
    }

    console.log('[capture-route-hashes] attaching fromTxHash', row.refId, txHash)
    await prisma.depositIntent.update({
      where: { refId: row.refId },
      data: { fromTxHash: txHash.trim().toLowerCase(), status: 'WAITING_ROUTE', updatedAt: new Date() },
    })

    // Kick finish to progress the flow
    try {
      await fetch(finishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: row.refId, fromTxHash: txHash }),
      })
    } catch (e) {
      console.warn('[capture-route-hashes] finish trigger failed', row.refId, e)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
