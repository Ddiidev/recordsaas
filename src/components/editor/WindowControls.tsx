import { useState, useEffect } from 'react'
import { Minus, X } from '@icons'
import { cn } from '../../lib/utils'

const Maximize2 = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-maximize2-icon lucide-maximize-2"
    {...props}
  >
    <path d="M15 3h6v6" />
    <path d="m21 3-7 7" />
    <path d="m3 21 7-7" />
    <path d="M9 21H3v-6" />
  </svg>
)

const Minimize2 = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={24}
    height={24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="lucide lucide-minimize2-icon lucide-minimize-2"
    {...props}
  >
    <path d="m14 10 7-7" />
    <path d="M20 10h-6V4" />
    <path d="m3 21 7-7" />
    <path d="M4 14h6v6" />
  </svg>
)

function WindowControlButton({
  icon,
  label,
  onClick,
  intent = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  intent?: 'neutral' | 'close'
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'icon-hover flex h-7 w-7 items-center justify-center rounded-md border transition-all duration-150',
        'border-border/60 bg-background/75 text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
        intent === 'close' &&
          'hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40',
      )}
      aria-label={label}
    >
      {icon}
    </button>
  )
}

export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  const handleMinimize = () => window.electronAPI.minimizeWindow()
  const handleMaximize = () => window.electronAPI.maximizeWindow()
  const handleClose = () => window.electronAPI.closeWindow()

  useEffect(() => {
    // Get initial state when component is mounted
    const getInitialState = async () => {
      const maximized = await window.electronAPI.windowIsMaximized()
      setIsMaximized(maximized)
    }
    getInitialState()

    // Listen for state changes from main process
    const cleanup = window.electronAPI.onWindowStateChange(({ isMaximized: newIsMaximized }) => {
      setIsMaximized(newIsMaximized)
    })

    // Cleanup listener when component unmounts
    return () => cleanup()
  }, [])

  // Render for Linux (macOS has native controls)
  return (
    <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' }}>
      <WindowControlButton icon={<Minus className="h-3.5 w-3.5" />} label="Minimize" onClick={handleMinimize} />
      <WindowControlButton
        icon={
          isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />
        }
        label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={handleMaximize}
      />
      <WindowControlButton icon={<X className="h-3.5 w-3.5" />} label="Close" onClick={handleClose} intent="close" />
    </div>
  )
}
