import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { AppearanceMode } from '../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { useShallow } from 'zustand/react/shallow'

const PREPARATION_COUNTDOWN_OPTIONS = [0, 2, 3, 5, 10] as const
const DEFAULT_PREPARATION_COUNTDOWN_SECONDS = 3

const isPreparationCountdownOption = (value: number): value is (typeof PREPARATION_COUNTDOWN_OPTIONS)[number] =>
  PREPARATION_COUNTDOWN_OPTIONS.includes(value as (typeof PREPARATION_COUNTDOWN_OPTIONS)[number])

export function GeneralTab() {
  const { mode, setMode } = useEditorStore(
    useShallow((state) => ({
      mode: state.mode,
      setMode: state.setMode,
    })),
  )
  const [preparationCountdownSeconds, setPreparationCountdownSeconds] = useState<number>(
    DEFAULT_PREPARATION_COUNTDOWN_SECONDS,
  )
  const [forceGPU, setForceGPU] = useState(false)

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const savedCountdown = await window.electronAPI.getSetting<number>('recorder.preparationCountdownSeconds')
        if (typeof savedCountdown === 'number' && isPreparationCountdownOption(savedCountdown) && isMounted) {
          setPreparationCountdownSeconds(savedCountdown)
        }

        const savedForceGPU = await window.electronAPI.getSetting<boolean>('general.forceHighPerformanceGpu')
        if (typeof savedForceGPU === 'boolean' && isMounted) {
          setForceGPU(savedForceGPU)
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const handlePreparationCountdownChange = (value: string) => {
    const parsedValue = Number(value)
    if (!isPreparationCountdownOption(parsedValue)) return

    setPreparationCountdownSeconds(parsedValue)
    window.electronAPI.setSetting('recorder.preparationCountdownSeconds', parsedValue)
  }

  const handleForceGPUChange = (checked: boolean) => {
    setForceGPU(checked)
    window.electronAPI.setSetting('general.forceHighPerformanceGpu', checked)
  }

  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-foreground mb-6">General Settings</h2>

      <div className="space-y-8">
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
          <div>
            <h3 className="font-medium text-foreground">Appearance</h3>
            <p className="text-sm text-muted-foreground">Choose Light, Dark, or Auto (follow system).</p>
          </div>
          <Select value={mode} onValueChange={(value) => setMode(value as AppearanceMode)}>
            <SelectTrigger className="w-44 h-10 bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (System)</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
          <div>
            <h3 className="font-medium text-foreground">Preparation Screen</h3>
            <p className="text-sm text-muted-foreground">Countdown time before recording starts.</p>
          </div>
          <Select value={String(preparationCountdownSeconds)} onValueChange={handlePreparationCountdownChange}>
            <SelectTrigger className="w-24 h-10 bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PREPARATION_COUNTDOWN_OPTIONS.map((seconds) => (
                <SelectItem key={seconds} value={String(seconds)}>
                  {seconds === 0 ? 'Disabled' : `${seconds}s`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
          <div>
            <h3 className="font-medium text-foreground">Hardware Acceleration</h3>
            <p className="text-sm text-muted-foreground">Force high-performance GPU for faster rendering (requires app restart).</p>
          </div>
          <Switch 
            checked={forceGPU} 
            onCheckedChange={handleForceGPUChange} 
          />
        </div>
      </div>
    </div>
  )
}
