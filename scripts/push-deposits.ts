#!/usr/bin/env ts-node
/**
 * Push stuck deposit intents by re-running the /api/deposits/finish flow.
 *
 * Usage:
 *   pnpm dlx ts-node scripts/push-deposits.ts --limit=10 --finishUrl=http://localhost:3000/api/deposits/finish
 *
 * The script:
 * - Finds DepositIntent rows in FAILED/BRIDGED/DEPOSITED/MINTING without mintTxHash.
 * - Logs the last known stage/tx hashes.
 * - Calls the finish endpoint for each refId (idempotent) so it resumes at the correct stage.
 *
 * Requirements:
 * - DATABASE_URL set (Prisma can connect)
 * - The app server running and reachable at FINISH_URL (default http://localhost:3000/api/deposits/finish)
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function parseArgs() {
  const args = process.argv.slice(2)
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '10') || 10
  const finishUrl =
    args.find((a) => a.startsWith('--finishUrl='))?.split('=')[1] ||
    process.env.FINISH_URL ||
    'http://localhost:3000/api/deposits/finish'
  return { limit, finishUrl }
}

async function main() {
  const { limit, finishUrl } = parseArgs()

  const rows = await prisma.depositIntent.findMany({
    where: {
      status: { in: ['FAILED', 'BRIDGED', 'DEPOSITED', 'MINTING'] },
      mintTxHash: null,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })

  if (!rows.length) {
    console.log('No stuck intents found.')
    return
  }

  console.log(`Found ${rows.length} stuck intents; pushing via finish endpoint (${finishUrl})`)

  for (const row of rows) {
    const stage =
      row.mintTxHash ? 'minted' :
      row.depositTxHash ? 'deposited' :
      row.toTxHash ? 'bridged' :
      row.status?.toLowerCase() || 'unknown'

    console.log(`\n[refId ${row.refId}] stage=${stage}`)
    console.log({
      status: row.status,
      fromTxHash: row.fromTxHash,
      toTxHash: row.toTxHash,
      depositTxHash: row.depositTxHash,
      mintTxHash: row.mintTxHash,
      error: row.error,
    })

    try {
      const payload = {
        refId: row.refId,
        fromTxHash: row.fromTxHash ?? undefined,
        fromChainId: row.fromChainId ?? undefined,
        toChainId: row.toChainId ?? undefined,
        minAmount: row.minAmount ?? undefined,
      }

      const res = await fetch(finishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      console.log(`[refId ${row.refId}] finish ok`, json)
    } catch (err: any) {
      console.error(`[refId ${row.refId}] finish failed`, err?.message || err)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
