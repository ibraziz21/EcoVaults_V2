/**
 * Best-effort reconciliation script:
 * - Finds deposit intents missing depositTxHash or mintTxHash (but with a refId)
 * - Calls /api/deposits/finish for each to let the relayer complete/repair the flow.
 *
 * Usage:
 *   pnpm ts-node --transpile-only --compiler-options '{"module":"CommonJS"}' scripts/reconcile-deposits.ts --finishUrl=http://localhost:3000/api/deposits/finish
 */
import { prisma } from '@/lib/db'

const args = process.argv.slice(2)
const finishArg = args.find((a) => a.startsWith('--finishUrl='))
const finishUrl = finishArg ? finishArg.replace('--finishUrl=', '') : 'http://localhost:3000/api/deposits/finish'

async function main() {
  const targets = await prisma.depositIntent.findMany({
    where: {
      refId: { not: undefined },
      status: { not: 'MINTED' },
      OR: [
        { depositTxHash: null },
        { mintTxHash: null },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { refId: true, status: true, fromTxHash: true, depositTxHash: true, mintTxHash: true },
  })

  console.log(`[reconcile] found ${targets.length} intents to retry`)

  for (const row of targets) {
    try {
      console.log('[reconcile] retry', row.refId, {
        status: row.status,
        from: row.fromTxHash,
        deposit: row.depositTxHash,
        mint: row.mintTxHash,
      })
      const res = await fetch(finishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refId: row.refId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        console.warn('[reconcile] finish failed', row.refId, json)
      } else {
        console.log('[reconcile] finish ok', row.refId, json.status || json)
      }
    } catch (e) {
      console.error('[reconcile] error', row.refId, e)
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
