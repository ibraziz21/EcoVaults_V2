// src/components/ui/separator.tsx
'use client'
import { cn } from '@/lib/utils'      // helper that concats class names

interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Direction of the separator.  
   * `horizontal` ➜ width: 100%, height: 1px (default)  
   * `vertical`   ➜ height: 100%, width: 1px
   */
  orientation?: 'horizontal' | 'vertical'
}

export function Separator({
  orientation = 'horizontal',
  className,
  ...props
}: SeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border/60',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
