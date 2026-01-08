import { prisma } from './db'

type PushResult = {
  refId: string
  ok: boolean
  error?: string
  status?: number
  body?: any
}

const STUCK_STATUSES = ['FAILED', 'BRIDGED', 'DEPOSITED', 'MINTING']

export async function findStuckDepositIntents(limit: number) {
  return prisma.depositIntent.findMany({
    where: {
      status: { in: STUCK_STATUSES },
      mintTxHash: null,
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })
}

/**
 * Push stuck deposits by invoking the existing /api/deposits/finish handler.
 * finishUrl should point to that endpoint (absolute URL).
 */
export async function pushDeposits(opts: { limit: number; finishUrl: string }) {
  const { limit, finishUrl } = opts
  const rows = await findStuckDepositIntents(limit)
  const results: PushResult[] = []

  for (const row of rows) {
    const payload = {
      refId: row.refId,
      fromTxHash: row.fromTxHash ?? undefined,
      fromChainId: row.fromChainId ?? undefined,
      toChainId: row.toChainId ?? undefined,
      minAmount: row.minAmount ?? undefined,
    }

    try {
      const res = await fetch(finishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }

      results.push({ refId: row.refId, ok: true, status: res.status, body })
    } catch (err: any) {
      results.push({ refId: row.refId, ok: false, error: err?.message || String(err) })
    }
  }

  return { total: rows.length, results }
}
