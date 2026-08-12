import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { AppearanceMode } from '../../types'
import { LINUX_CURSOR_SCALE_OPTIONS, isLinuxCursorScaleOption } from '../../lib/recorder-window'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useShallow } from 'zustand/react/shallow'

const PREPARATION_COUNTDOWN_OPTIONS = [0, 2, 3, 5, 10] as const
const DEFAULT_PREPARATION_COUNTDOWN_SECONDS = 3
const RECORDSAAS_ROOT_SETTING_KEY = 'storage.recordsaasRootPath'

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
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const [linuxCursorScale, setLinuxCursorScale] = useState<number>(1)
  const [playExportCompletionSound, setPlayExportCompletionSound] = useState(true)
  const [showRecordingTimer, setShowRecordingTimer] = useState(true)
  const [recordSaaSRootPath, setRecordSaaSRootPath] = useState('')
  const [defaultRecordSaaSRootPath, setDefaultRecordSaaSRootPath] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const [
          savedCountdown,
          savedPlayExportCompletionSound,
          savedShowRecordingTimer,
          currentPlatform,
          savedCursorScale,
          configuredRecordSaaSRootPath,
          defaultRootPath,
        ] = await Promise.all([
          window.electronAPI.getSetting<number>('recorder.preparationCountdownSeconds'),
          window.electronAPI.getSetting<boolean>('general.playExportCompletionSound'),
          window.electronAPI.getSetting<boolean>('recorder.showTimer'),
          window.electronAPI.getPlatform(),
          window.electronAPI.getSetting<number>('recorder.cursorScale'),
          window.electronAPI.getRecordSaaSRootPath(),
          window.electronAPI.getDefaultRecordSaaSRootPath(),
        ])

        if (typeof savedCountdown === 'number' && isPreparationCountdownOption(savedCountdown) && isMounted) {
          setPreparationCountdownSeconds(savedCountdown)
        }

        if (isMounted) {
          setPlatform(currentPlatform)
        }

        if (currentPlatform === 'linux' && isMounted) {
          setLinuxCursorScale(
            typeof savedCursorScale === 'number' && isLinuxCursorScaleOption(savedCursorScale) ? savedCursorScale : 1,
          )
        }

        if (isMounted) {
          setPlayExportCompletionSound(
            typeof savedPlayExportCompletionSound === 'boolean' ? savedPlayExportCompletionSound : true,
          )
          setShowRecordingTimer(typeof savedShowRecordingTimer === 'boolean' ? savedShowRecordingTimer : true)
          setRecordSaaSRootPath(configuredRecordSaaSRootPath || defaultRootPath || '')
          setDefaultRecordSaaSRootPath(defaultRootPath || '')
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

  const handleLinuxCursorScaleChange = (value: string) => {
    const parsedValue = Number(value)
    if (!isLinuxCursorScaleOption(parsedValue)) return

    setLinuxCursorScale(parsedValue)
    window.electronAPI.setCursorScale(parsedValue)
    window.electronAPI.setSetting('recorder.cursorScale', parsedValue)
  }

  const handlePlayExportCompletionSoundChange = (checked: boolean) => {
    setPlayExportCompletionSound(checked)
    window.electronAPI.setSetting('general.playExportCompletionSound', checked)
  }

  const handleShowRecordingTimerChange = (checked: boolean) => {
    setShowRecordingTimer(checked)
    window.electronAPI.setSetting('recorder.showTimer', checked)
  }

  const persistRecordSaaSRootPath = (pathValue: string) => {
    const nextPath = pathValue.trim() || defaultRecordSaaSRootPath
    setRecordSaaSRootPath(nextPath)
    window.electronAPI.setSetting(RECORDSAAS_ROOT_SETTING_KEY, nextPath)
  }

  const handleRecordSaaSRootBrowse = async () => {
    const result = await window.electronAPI.showOpenDialog({
      title: 'Select RecordSaaS Folder',
      defaultPath: recordSaaSRootPath || defaultRecordSaaSRootPath,
      properties: ['openDirectory', 'createDirectory'],
    })

    if (!result.canceled && result.filePaths[0]) {
      persistRecordSaaSRootPath(result.filePaths[0])
    }
  }

  const handleResetRecordSaaSRootPath = () => {
    if (!defaultRecordSaaSRootPath) return
    persistRecordSaaSRootPath(defaultRecordSaaSRootPath)
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
            <h3 className="font-medium text-foreground">Recording Timer</h3>
            <p className="text-sm text-muted-foreground">Show the floating elapsed-time window while recording.</p>
          </div>
          <Switch checked={showRecordingTimer} onCheckedChange={handleShowRecordingTimerChange} />
        </div>

        {platform === 'linux' && (
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
            <div>
              <h3 className="font-medium text-foreground">Cursor Size</h3>
              <p className="text-sm text-muted-foreground">Apply the Linux cursor scale used while recording.</p>
            </div>
            <Select value={String(linuxCursorScale)} onValueChange={handleLinuxCursorScaleChange}>
              <SelectTrigger className="w-24 h-10 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINUX_CURSOR_SCALE_OPTIONS.map((scale) => (
                  <SelectItem key={scale.value} value={String(scale.value)}>
                    {scale.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
          <div>
            <h3 className="font-medium text-foreground">Export Completion Sound</h3>
            <p className="text-sm text-muted-foreground">Play a sound when export finishes with success or error.</p>
          </div>
          <Switch checked={playExportCompletionSound} onCheckedChange={handlePlayExportCompletionSoundChange} />
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border border-border">
          <div className="mb-4">
            <h3 className="font-medium text-foreground">RecordSaaS Folder</h3>
            <p className="text-sm text-muted-foreground">Default location for projects and renders.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={recordSaaSRootPath}
              onChange={(event) => setRecordSaaSRootPath(event.target.value)}
              onBlur={() => persistRecordSaaSRootPath(recordSaaSRootPath)}
              className="h-10 min-w-0 flex-1 bg-background/50"
            />
            <Button variant="secondary" onClick={handleRecordSaaSRootBrowse} className="h-10 shrink-0">
              Browse
            </Button>
            <Button variant="secondary" onClick={handleResetRecordSaaSRootPath} className="h-10 shrink-0">
              Reset
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
