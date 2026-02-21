import { useState } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Settings, InfoCircle, Keyboard } from 'tabler-icons-react'
import { GeneralTab } from './GeneralTab'
import { AboutTab } from './AboutTab'
import { ShortcutsTab } from './ShortcutsTab'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isTransparent?: boolean
}

type SettingsTab = 'general' | 'shortcuts' | 'about'

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-5 h-5" /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="w-5 h-5" /> },
  { id: 'about', label: 'About', icon: <InfoCircle className="w-5 h-5" /> },
]

export function SettingsModal({ isOpen, onClose, isTransparent = false }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  if (!isOpen) return null

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />
      case 'shortcuts':
        return <ShortcutsTab />
      case 'about':
        return <AboutTab />
      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        isTransparent ? 'bg-transparent' : 'bg-background/80 backdrop-blur-[2px]'
      )}
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-3xl h-[60vh] max-h-[500px] flex flex-row m-4 rounded-xl bg-card border shadow-2xl overflow-hidden relative',
          isTransparent ? 'border-white/20 dark:border-white/20' : 'border-border'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {window.process?.platform !== 'darwin' && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="absolute top-4 right-4 z-[60] w-8 h-8 rounded-lg text-muted-foreground hover:bg-destructive hover:text-white transition-colors"
          >
            <span className="sr-only">Close</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </Button>
        )}
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-gradient-to-b from-primary/5 to-transparent p-4 border-r border-border flex flex-col relative z-20">
          <h2 className="text-lg font-bold text-foreground px-2 mb-4">Settings</h2>
          <div className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-accent text-primary'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto relative">{renderContent()}</div>
      </div>
    </div>
  )
}
