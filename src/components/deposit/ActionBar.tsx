'use client'
import { FC, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { FlowStep } from './types'

export const ActionBar: FC<{
  step: FlowStep
  confirmDisabled: boolean
  onConfirm: () => void
  onClose: () => void
  onRetry: () => void
}> = ({ step, confirmDisabled, onConfirm, onClose, onRetry }) => {
  const showForm = step === 'idle'
  const showProgress = step !== 'idle' && step !== 'success' && step !== 'error'
  const showSuccess = step === 'success'
  const showError = step === 'error'

  return (
    <div className="sticky bottom-0 border-t bg-white px-4 py-3 sm:px-6">
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
        {showForm && (
          <>
            <Button variant="outline" onClick={onClose} title="Cancel" className="h-10 w-full sm:h-9 sm:w-auto">Cancel</Button>
            <Button onClick={onConfirm} disabled={confirmDisabled} title="Confirm" className="h-10 w-full sm:h-9 sm:w-auto">Confirm</Button>
          </>
        )}
        {showProgress && (
          <Button variant="outline" onClick={onClose} title="Close" className="h-10 w-full sm:h-9 sm:w-auto">Close</Button>
        )}
        {showSuccess && (
          <Button onClick={onClose} title="Done" className="h-10 w-full sm:h-9 sm:w-auto">Done</Button>
        )}
        {showError && (
          <div className="flex w-full gap-2 sm:justify-end">
            <Button variant="outline" onClick={onRetry} title="Try Again" className="h-10 w-full sm:h-9 sm:w-auto">Try again</Button>
            <Button onClick={onClose} title="Close" className="h-10 w-full sm:h-9 sm:w-auto">Close</Button>
          </div>
        )}
      </div>
    </div>
  )
}
