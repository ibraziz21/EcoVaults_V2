// src/lib/recovery.ts
const KEY = '__superyldr_active_deposits__'

export type ActiveMeta = {
  refId: `0x${string}`
  user: `0x${string}`
  fromChainId?: number
  toChainId?: number
  fromTxHash?: `0x${string}`
  toTxHash?: `0x${string}`
  minAmount?: string
  createdAt?: number
  updatedAt?: number
}

function readAll(): Record<string, ActiveMeta> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function writeAll(m: Record<string, ActiveMeta>) {
  localStorage.setItem(KEY, JSON.stringify(m))
}

export function trackActiveDeposit(meta: ActiveMeta) {
  const m = readAll()
  const prev = m[meta.refId]
  const now = Date.now()
  m[meta.refId] = {
    ...(prev ?? {}),
    ...meta,
    refId: meta.refId,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }
  writeAll(m)
}

export function updateActiveDeposit(refId: `0x${string}`, patch: Partial<ActiveMeta>) {
  const m = readAll()
  const prev = m[refId] ?? { refId } as ActiveMeta
  m[refId] = {
    ...prev,
    ...patch,
    refId,
    createdAt: prev.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
  writeAll(m)
}

export function clearActiveDeposit(refId: `0x${string}`) {
  const m = readAll()
  delete m[refId]
  writeAll(m)
}

export function readActiveDeposits(): Record<string, ActiveMeta> {
  return readAll()
}