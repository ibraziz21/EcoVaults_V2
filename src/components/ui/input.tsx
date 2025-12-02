'use client'
import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>


export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-secondary/30 bg-white',
        'px-3 py-2 text-sm text-secondary-foreground shadow-sm',
        'placeholder:text-secondary-foreground/40',
        'focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
