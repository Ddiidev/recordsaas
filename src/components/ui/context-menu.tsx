import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/utils'

interface ContextMenuProps {
  isOpen: boolean
  onClose: () => void
  position: { x: number; y: number }
  children: React.ReactNode
  className?: string
}

export function ContextMenu({ isOpen, onClose, position, children, className }: ContextMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!isOpen) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    window.addEventListener('mousedown', handleClickOutside)

    return () => {
      window.removeEventListener('keydown', handleEscape)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  // Adjust menu position to prevent overflow
  React.useEffect(() => {
    if (!isOpen || !menuRef.current) return

    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let adjustedX = position.x
    let adjustedY = position.y

    // Adjust horizontal position
    if (rect.right > viewportWidth) {
      adjustedX = viewportWidth - rect.width - 8
    }

    // Adjust vertical position
    if (rect.bottom > viewportHeight) {
      adjustedY = viewportHeight - rect.height - 8
    }

    if (adjustedX < 8) adjustedX = 8
    if (adjustedY < 8) adjustedY = 8

    menu.style.left = `${adjustedX}px`
    menu.style.top = `${adjustedY}px`
  }, [isOpen, position])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        className={cn(
          'fixed min-w-[200px] rounded-lg overflow-hidden',
          'bg-zinc-900/60 backdrop-blur-3xl backdrop-saturate-200',
          'border border-white/5 shadow-2xl shadow-black/40',
          'animate-in fade-in-0 zoom-in-95 duration-100',
          'ring-1 ring-white/10 ring-inset',
          className,
        )}
        style={{
          left: position.x,
          top: position.y,
          willChange: 'transform, opacity',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="py-1">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

interface ContextMenuItemProps {
  inset?: boolean
}

export const ContextMenuItem = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & ContextMenuItemProps
>(({ className, inset, children, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'w-full px-3 py-1.5 text-left text-sm font-medium',
      'text-white/90 hover:text-white',
      'hover:bg-white/10 active:bg-white/15',
      'transition-colors duration-75',
      'flex items-center gap-2',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      inset && 'pl-8',
      className,
    )}
    {...props}
  >
    {children}
  </button>
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuDivider = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('context-menu-divider', className)} {...props} />,
)
ContextMenuDivider.displayName = 'ContextMenuDivider'

export const ContextMenuLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-3 py-1.5 text-xs font-semibold text-white/40 uppercase tracking-wider', className)}
      {...props}
    />
  ),
)
ContextMenuLabel.displayName = 'ContextMenuLabel'
