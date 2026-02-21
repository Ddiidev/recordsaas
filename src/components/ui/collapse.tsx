import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDown, Refresh } from 'tabler-icons-react'

interface CollapseProps {
  title: string
  description?: string
  icon?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
  onReset?: () => void
}

export function Collapse({
  title,
  description,
  icon,
  defaultOpen = true,
  children,
  className = '',
  onReset,
}: CollapseProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  const handleResetClick = (e: React.MouseEvent) => {
    e.stopPropagation() // ngăn toggle
    onReset?.()
  }

  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      className={`collapse-root group/collapse ${className}`}
    >
      <CollapsiblePrimitive.Trigger className="collapse-trigger flex w-full items-center justify-between text-left transition-colors duration-200 hover:bg-accent/60 group">
        <div className="flex items-center gap-3">
          {icon && <div className="w-5 h-5 flex items-center justify-center text-primary flex-shrink-0">{icon}</div>}
          <div className="flex-1">
            <div className="text-sm font-medium text-sidebar-foreground">{title}</div>
            {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onReset && (
            <div
              onClick={handleResetClick}
              className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer hover:bg-accent/70"
              aria-label={`Reset ${title}`}
            >
              <Refresh className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
          )}
          <ChevronDown
            className={`collapse-chevron ml-1 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content className="collapse-content">
        <div className="collapse-content-inner">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
