// src/lib/memo.ts
const M = new Map<string, { t: number; v: any }>()
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = M.get(key)
  const now = Date.now()
  if (hit && now - hit.t < ttlMs) return hit.v as T
  const v = await fn()
  M.set(key, { t: now, v })
  return v
}