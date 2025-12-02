'use client'
import { FC } from 'react'
import { useDepositRecovery } from '@/hooks/useDepositRecovery'

export const ResumeDepositsBanner: FC<{ user?: `0x${string}` }> = ({ user }) => {
  const { resuming } = useDepositRecovery(user)
  const items = resuming.filter(i => !['MINTED','SUCCESS','FAILED'].includes(i.status))

  if (!user || items.length === 0) return null
  return (
    <div className="mx-auto mb-3 w-full max-w-3xl rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
      <div className="mb-1 font-semibold">Resuming your deposit{items.length>1?'s':''}…</div>
      <ul className="list-inside list-disc text-sm">
        {items.map(i => (
          <li key={i.refId} className="truncate">
            <span className="font-mono">{i.refId.slice(0,10)}…</span> – {i.status.replaceAll('_',' ')}
          </li>
        ))}
      </ul>
    </div>
  )
}
