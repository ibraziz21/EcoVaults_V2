// import { prisma } from '@/lib/db'

// export async function tryLockDeposit(refId: string, actor: string, ttlMs = 60_000) {
//   const now = new Date()
//   const staleAt = new Date(Date.now() - ttlMs)

//   const res = await prisma.depositIntent.updateMany({
//     where: {
//       refId,
//       status: { notIn: ['MINTED', 'SUCCESS'] },
//       OR: [{ lockedBy: null }, { lockedAt: { lt: staleAt } }, { lockedBy: actor }],
//     },
//     data: { lockedBy: actor, lockedAt: now, updatedAt: now },
//   })
//   if (res.count === 1) return { ok: true as const }

//   const row = await prisma.depositIntent.findUnique({ where: { refId } })
//   if (!row) return { ok: false as const, reason: 'Unknown refId' }
//   if (row.status === 'MINTED' || row.status === 'SUCCESS') return { ok: false as const, reason: 'Already done' }
//   return { ok: false as const, reason: 'Locked', lockedBy: row.lockedBy, lockedAt: row.lockedAt }
// }

// export async function refreshDepositLock(refId: string, actor: string) {
//   await prisma.depositIntent.updateMany({
//     where: { refId, lockedBy: actor },
//     data: { lockedAt: new Date() },
//   })
// }

// export async function releaseDepositLock(refId: string, actor: string) {
//   await prisma.depositIntent.updateMany({
//     where: { refId, lockedBy: actor },
//     data: { lockedBy: null, lockedAt: null },
//   })
// }

// /* Mirror for withdraw */
// export async function tryLockWithdraw(refId: string, actor: string, ttlMs = 60_000) {
//   const now = new Date()
//   const staleAt = new Date(Date.now() - ttlMs)

//   const res = await prisma.withdrawIntent.updateMany({
//     where: {
//       refId,
//       status: { notIn: ['SUCCESS'] },
//       OR: [{ lockedBy: null }, { lockedAt: { lt: staleAt } }, { lockedBy: actor }],
//     },
//     data: { lockedBy: actor, lockedAt: now, updatedAt: now },
//   })
//   if (res.count === 1) return { ok: true as const }

//   const row = await prisma.withdrawIntent.findUnique({ where: { refId } })
//   if (!row) return { ok: false as const, reason: 'Unknown refId' }
//   if (row.status === 'SUCCESS') return { ok: false as const, reason: 'Already done' }
//   return { ok: false as const, reason: 'Locked', lockedBy: row.lockedBy, lockedAt: row.lockedAt }
// }

// export async function refreshWithdrawLock(refId: string, actor: string) {
//   await prisma.withdrawIntent.updateMany({
//     where: { refId, lockedBy: actor },
//     data: { lockedAt: new Date() },
//   })
// }

// export async function releaseWithdrawLock(refId: string, actor: string) {
//   await prisma.withdrawIntent.updateMany({
//     where: { refId, lockedBy: actor },
//     data: { lockedBy: null, lockedAt: null },
//   })
// }