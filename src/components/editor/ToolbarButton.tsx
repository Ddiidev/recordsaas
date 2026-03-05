import React from 'react'
import { cn } from '../../lib/utils'
import { SimpleTooltip } from '../ui/tooltip'

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'icon'
  tooltip?: string
  children: React.ReactNode
}

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ variant = 'default', className = '', disabled, tooltip, children, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-40',
          variant === 'icon' ? 'h-10 w-10 rounded-lg' : 'h-10 px-4 rounded-lg text-sm gap-2',
          disabled
            ? 'bg-card/80 text-muted-foreground/50 border border-border shadow-sm opacity-50'
            : 'icon-hover bg-card/90 text-foreground border border-border shadow-sm hover:bg-accent hover:text-accent-foreground hover:border-border hover:shadow-md',
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )

    if (tooltip && !disabled) {
      return (
        <SimpleTooltip content={tooltip}>
          {button}
        </SimpleTooltip>
      )
    }

    return button
  },
)

ToolbarButton.displayName = 'ToolbarButton'
