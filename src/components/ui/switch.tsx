import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const switchVariants = cva(
  'peer group inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-md border-2 border-transparent bg-transparent p-[2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
        primary: '',
        destructive: '',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const trackVariants = cva(
  'pointer-events-none absolute inset-[2px] rounded-sm transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-input group-hover:bg-accent',
        primary: 'bg-primary/20 group-hover:bg-primary/30',
        destructive: 'bg-destructive/20 group-hover:bg-destructive/30',
      },
      isChecked: {
        true: '',
      },
    },
    compoundVariants: [
      {
        variant: 'default',
        isChecked: true,
        className: 'bg-primary group-hover:bg-primary/90',
      },
      {
        variant: 'primary',
        isChecked: true,
        className: 'bg-primary group-hover:bg-primary/90',
      },
      {
        variant: 'destructive',
        isChecked: true,
        className: 'bg-destructive group-hover:bg-destructive/90',
      },
    ],
    defaultVariants: {
      variant: 'default',
    },
  },
)

const thumbVariants = cva(
  'pointer-events-none relative z-10 block h-4 w-4 rounded-sm bg-white shadow-[0_1px_3px_rgba(15,23,42,0.28),0_1px_1px_rgba(15,23,42,0.18)] ring-0 transition-transform',
  {
    variants: {
      isChecked: {
        true: 'translate-x-5',
        false: 'translate-x-0',
      },
    },
  },
)

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    VariantProps<typeof switchVariants> {}

const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, variant, checked, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        switchVariants({ variant }),
        'relative inline-flex h-6 w-11 items-center rounded-md transition-colors',
        className,
      )}
      checked={checked}
      {...props}
      ref={ref}
    >
      <span className={trackVariants({ variant, isChecked: checked })} />
      <SwitchPrimitives.Thumb
        className={cn(
          thumbVariants({ isChecked: checked }),
          'border border-border/20 dark:border-white/20',
        )}
      />
    </SwitchPrimitives.Root>
  ),
)
Switch.displayName = 'Switch'

export { Switch }
