import { prisma } from '@/lib/db'
import { canAdvanceDeposit, canAdvanceWithdraw, type DepositState, type WithdrawState } from './states'

type Patch = Record<string, any>

/** Single guarded advance for DepositIntent */
export async function advanceDeposit(refId: string, from: DepositState, to: DepositState, patch: Patch = {}) {
  if (!canAdvanceDeposit(from, to)) throw new Error(`Illegal deposit transition ${from} -> ${to}`)

  const updated = await prisma.depositIntent.updateMany({
    where: { refId, status: from },
    data: { status: to, updatedAt: new Date(), ...patch },
  })

  if (updated.count === 0) {
    // Re-read to help debugging
    const cur = await prisma.depositIntent.findUnique({ where: { refId } })
    throw new Error(`advanceDeposit race or bad from-state: wanted ${from} -> ${to}, got ${cur?.status ?? 'unknown'}`)
  }
}

/** Single guarded advance for WithdrawIntent */
export async function advanceWithdraw(refId: string, from: WithdrawState, to: WithdrawState, patch: Patch = {}) {
  if (!canAdvanceWithdraw(from, to)) throw new Error(`Illegal withdraw transition ${from} -> ${to}`)

  const updated = await prisma.withdrawIntent.updateMany({
    where: { refId, status: from },
    data: { status: to, updatedAt: new Date(), ...patch },
  })

  if (updated.count === 0) {
    const cur = await prisma.withdrawIntent.findUnique({ where: { refId } })
    throw new Error(`advanceWithdraw race or bad from-state: wanted ${from} -> ${to}, got ${cur?.status ?? 'unknown'}`)
  }
}