'use client'
import { FC } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { FlowStep } from './types'

const StepCard: FC<{ current: FlowStep; k: Exclude<FlowStep, 'idle' | 'success' | 'error'>; label: string; visible?: boolean }>= ({ current, k, label, visible }) => {
  if (!visible) return null
  const order: FlowStep[] = ['bridging', 'waitingFunds', 'switching', 'depositing']
  const idx = order.indexOf(current)
  const my = order.indexOf(k)
  const done = idx > my
  const active = idx === my
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      {done ? (
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      ) : active ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : (
        <span className="h-4 w-4 rounded-full border" />
      )}
      <span className={`text-sm ${done ? 'text-green-700' : active ? 'text-primary' : 'text-muted-foreground'}`}>{label}</span>
    </div>
  )
}

export const ProgressSteps: FC<{ step: FlowStep; show: boolean; crossChain: boolean }>= ({ step, show, crossChain }) => {
  if (!show) return null
  return (
    <div className="space-y-3">
      <StepCard current={step} label="Bridging liquidity"   k="bridging"     visible={crossChain} />
      <StepCard current={step} label="Waiting for funds"    k="waitingFunds" visible={crossChain} />
      <StepCard current={step} label="Switching network"    k="switching"    visible />
      <StepCard current={step} label="Depositing to protocol" k="depositing"  visible />
    </div>
  )
}