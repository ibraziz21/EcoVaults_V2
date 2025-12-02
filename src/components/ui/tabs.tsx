/* Radix Tabs wrapped in shadcn / Tailwind styling */
'use client'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cva, VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* ------ styles ------ */
const triggerVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium ' +
    'ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-0 border-white text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground  data-[state=active]:border-b-2',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground data-[state=active]:bg-accent data-[state=active]:text-accent-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export const Tabs = TabsPrimitive.Root
export const TabsList = ({ className, ...props }: TabsPrimitive.TabsListProps) => (
  <TabsPrimitive.List
    className={cn('inline-flex items-center justify-center rounded-md bg-muted p-1', className)}
    {...props}
  />
)

export const TabsTrigger = ({
  className,
  variant,
  ...props
}: TabsPrimitive.TabsTriggerProps & VariantProps<typeof triggerVariants>) => (
  <TabsPrimitive.Trigger
    className={cn(triggerVariants({ variant }), className)}
    {...props}
  />
)

export const TabsContent = ({
  className,
  ...props
}: TabsPrimitive.TabsContentProps) => (
  <TabsPrimitive.Content
    className={cn('mt-6 focus-visible:outline-none', className)}
    {...props}
  />
)
