import { useState, useEffect } from 'react'
import { Minus, X } from 'tabler-icons-react'

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
    <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
      <button
        onClick={handleClose}
        className="group w-3 h-3 bg-red-400 rounded-full flex justify-center items-center transition-colors duration-200 hover:bg-red-600"
        aria-label="Close"
      >
        <X className="w-1.5 h-1.5 text-red-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      </button>
      <button
        onClick={handleMinimize}
        className="group w-3 h-3 bg-yellow-400 rounded-full flex justify-center items-center transition-colors duration-200 hover:bg-yellow-600"
        aria-label="Minimize"
      >
        <Minus className="w-1.5 h-1.5 text-yellow-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      </button>
      <button
        onClick={handleMaximize}
        className="group w-3 h-3 bg-green-400 rounded-full flex justify-center items-center transition-colors duration-200 hover:bg-green-600"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <Minimize2 className="w-1.5 h-1.5 text-green-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        ) : (
          <Maximize2 className="w-1.5 h-1.5 text-green-900/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        )}
      </button>
    </div>
  )
}
