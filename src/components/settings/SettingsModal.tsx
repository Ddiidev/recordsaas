import { useEffect, useState } from 'react'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { IconSwitch, InfoCircle, InfoCircleSolid, Keyboard, Settings, UserCircle, X, type IconComponent } from '@icons'
import { GeneralTab } from './GeneralTab'
import { AboutTab } from './AboutTab'
import { ShortcutsTab } from './ShortcutsTab'
import { AccountTab } from './AccountTab'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  isTransparent?: boolean
  defaultTab?: SettingsTab
}

export type SettingsTab = 'general' | 'shortcuts' | 'account' | 'about'

const TABS: Array<{ id: SettingsTab; label: string; icon: IconComponent; solid?: IconComponent }> = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'account', label: 'Account', icon: UserCircle },
  { id: 'about', label: 'About', icon: InfoCircle, solid: InfoCircleSolid },
]

export function SettingsModal({ isOpen, onClose, isTransparent = false, defaultTab = 'general' }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab)

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab)
    }
  }, [defaultTab, isOpen])

  if (!isOpen) return null

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />
      case 'shortcuts':
        return <ShortcutsTab />
      case 'account':
        return <AccountTab />
      case 'about':
        return <AboutTab />
      default:
        return null
    }
  }

  return (
    <div
      data-interactive="true"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center',
        isTransparent ? 'bg-transparent' : 'bg-background/80 backdrop-blur-[2px]'
      )}
      onClick={onClose}
    >
      <div
        data-interactive="true"
        className={cn(
          'relative m-4 flex h-[60vh] max-h-[500px] w-full max-w-3xl flex-row overflow-hidden rounded-lg border bg-card shadow-2xl',
          isTransparent ? 'border-white/20 dark:border-white/20' : 'border-border'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {window.process?.platform !== 'darwin' && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="icon-hover absolute right-4 top-4 z-[60] h-8 w-8 rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
          >
            <span className="sr-only">Close</span>
            <X className="h-4 w-4" />
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
                  'icon-hover flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-all duration-150',
                  activeTab === tab.id
                    ? 'bg-accent text-primary shadow-sm'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center">
                  <IconSwitch
                    regular={tab.icon}
                    solid={tab.solid}
                    active={activeTab === tab.id}
                    className="h-[18px] w-[18px]"
                  />
                </span>
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
