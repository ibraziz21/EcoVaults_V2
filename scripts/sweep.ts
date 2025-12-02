// scripts/sweep-intents.ts
/*

Sweeper for "stuck" deposit intents.

Usage (example):

  APP_BASE_URL="https://app.superyldr.xyz" \
  npx tsx scripts/sweep-intents.ts

Or add to package.json:

  "scripts": {
    "sweep:intents": "APP_BASE_URL=http://localhost:3000 tsx scripts/sweep-intents.ts"
  }

*/

import 'dotenv/config'
import { prisma } from '@/lib/db'

const TAG = '[sweep-intents]'

// Where to call the API (must reach your Next server)
const APP_BASE_URL =
  process.env.APP_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:3000'

// How many rows per sweep
const BATCH_LIMIT = Number(process.env.SWEEPER_BATCH_LIMIT || '20')

// Statuses we consider "unfinished" and worth sweeping
const STUCK_STATUSES = [
  'PENDING',
  'WAITING_ROUTE',
  'BRIDGING',
  'BRIDGE_IN_FLIGHT',
  'BRIDGED',
  'DEPOSITING',
  'MINTING',
] as const

type StuckStatus = (typeof STUCK_STATUSES)[number]

async function sweepOnce() {
  console.log(TAG, 'starting sweep…')

  const intents = await prisma.depositIntent.findMany({
    where: {
      status: { in: STUCK_STATUSES as any },
    },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_LIMIT,
  })

  if (!intents.length) {
    console.log(TAG, 'no stuck intents found')
    return
  }

  console.log(TAG, `found ${intents.length} candidate intents`)

  for (const row of intents) {
    try {
      const refId = row.refId
      const status = row.status as StuckStatus

      console.log(TAG, `→ processing refId=${refId} status=${status}`)

      // If we don't even know the LiFi source tx yet, there's a limit
      // to what we can do. We still try /finish, which may move it to
      // WAITING_ROUTE, but actual bridging confirmation requires a txHash.
      if (!row.fromTxHash) {
        console.log(
          TAG,
          `  refId=${refId} has no fromTxHash yet – calling /finish with minimal data`,
        )
      }

      const body: Record<string, any> = {
        refId,
      }

      if (row.fromTxHash) body.fromTxHash = row.fromTxHash
      if (row.fromChainId) body.fromChainId = row.fromChainId
      if (row.toChainId) body.toChainId = row.toChainId
      if (row.minAmount) body.minAmount = row.minAmount

      const res = await fetch(`${APP_BASE_URL}/api/relayer/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const json = await res.json().catch(() => null)

      if (!res.ok || !json?.ok) {
        console.warn(
          TAG,
          `  finish failed for refId=${refId} – HTTP ${res.status}`,
          json,
        )
        continue
      }

      console.log(
        TAG,
        `  finish ok for refId=${refId} → status=${json.status ?? 'unknown'}`,
      )
    } catch (e: any) {
      console.error(
        TAG,
        '  error while sweeping a row:',
        e?.message || e,
      )
    }
  }

  console.log(TAG, 'sweep complete.')
}

/**
 * If you want this to be a one-shot (cron job), keep as-is.
 * If you want it to be a daemon, wrap in a setInterval with some delay.
 */
if (require.main === module) {
  sweepOnce()
    .then(() => {
      console.log(TAG, 'done')
      process.exit(0)
    })
    .catch((err) => {
      console.error(TAG, 'fatal error', err)
      process.exit(1)
    })
}
