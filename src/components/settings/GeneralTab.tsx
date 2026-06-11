import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { AppearanceMode } from '../../types'
import { LINUX_CURSOR_SCALE_OPTIONS, isLinuxCursorScaleOption } from '../../lib/recorder-window'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { useShallow } from 'zustand/react/shallow'

const PREPARATION_COUNTDOWN_OPTIONS = [0, 2, 3, 5, 10] as const
const DEFAULT_PREPARATION_COUNTDOWN_SECONDS = 3
const EXPORT_MEMORY_LIMIT_SETTING_KEY = 'export.memoryLimitPercent'
const RECORDSAAS_ROOT_SETTING_KEY = 'storage.recordsaasRootPath'
const DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT = 50
const EXPORT_MEMORY_HARD_CAP_FRACTION = 0.6

const isPreparationCountdownOption = (value: number): value is (typeof PREPARATION_COUNTDOWN_OPTIONS)[number] =>
  PREPARATION_COUNTDOWN_OPTIONS.includes(value as (typeof PREPARATION_COUNTDOWN_OPTIONS)[number])

const sanitizeExportMemoryLimitPercent = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT
  return Math.max(10, Math.min(100, Math.round(parsed)))
}

const formatGiB = (bytes: number | null): string => {
  if (!bytes || !Number.isFinite(bytes)) return 'unknown'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

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
  const [forceGPU, setForceGPU] = useState(false)
  const [playExportCompletionSound, setPlayExportCompletionSound] = useState(true)
  const [exportMemoryLimitPercent, setExportMemoryLimitPercent] = useState(DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT)
  const [totalMemoryBytes, setTotalMemoryBytes] = useState<number | null>(null)
  const [recordSaaSRootPath, setRecordSaaSRootPath] = useState('')
  const [defaultRecordSaaSRootPath, setDefaultRecordSaaSRootPath] = useState('')

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const [
          savedCountdown,
          savedForceGPU,
          savedPlayExportCompletionSound,
          currentPlatform,
          savedCursorScale,
          savedExportMemoryLimitPercent,
          systemMemoryInfo,
          configuredRecordSaaSRootPath,
          defaultRootPath,
        ] = await Promise.all([
          window.electronAPI.getSetting<number>('recorder.preparationCountdownSeconds'),
          window.electronAPI.getSetting<boolean>('general.forceHighPerformanceGpu'),
          window.electronAPI.getSetting<boolean>('general.playExportCompletionSound'),
          window.electronAPI.getPlatform(),
          window.electronAPI.getSetting<number>('recorder.cursorScale'),
          window.electronAPI.getSetting<number>(EXPORT_MEMORY_LIMIT_SETTING_KEY),
          window.electronAPI.getSystemMemoryInfo(),
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

        if (typeof savedForceGPU === 'boolean' && isMounted) {
          setForceGPU(savedForceGPU)
        }

        if (isMounted) {
          setPlayExportCompletionSound(
            typeof savedPlayExportCompletionSound === 'boolean' ? savedPlayExportCompletionSound : true,
          )
          setExportMemoryLimitPercent(sanitizeExportMemoryLimitPercent(savedExportMemoryLimitPercent))
          setTotalMemoryBytes(
            systemMemoryInfo?.totalMemoryBytes && Number.isFinite(systemMemoryInfo.totalMemoryBytes)
              ? systemMemoryInfo.totalMemoryBytes
              : null,
          )
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

  const handleForceGPUChange = (checked: boolean) => {
    setForceGPU(checked)
    window.electronAPI.setSetting('general.forceHighPerformanceGpu', checked)
  }

  const handlePlayExportCompletionSoundChange = (checked: boolean) => {
    setPlayExportCompletionSound(checked)
    window.electronAPI.setSetting('general.playExportCompletionSound', checked)
  }

  const handleExportMemoryLimitChange = (value: number) => {
    const nextValue = sanitizeExportMemoryLimitPercent(value)
    setExportMemoryLimitPercent(nextValue)
    window.electronAPI.setSetting(EXPORT_MEMORY_LIMIT_SETTING_KEY, nextValue)
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

  const exportMemoryBudgetBytes = totalMemoryBytes
    ? totalMemoryBytes * EXPORT_MEMORY_HARD_CAP_FRACTION * (exportMemoryLimitPercent / 100)
    : null
  const exportMemoryMaxBudgetBytes = totalMemoryBytes ? totalMemoryBytes * EXPORT_MEMORY_HARD_CAP_FRACTION : null

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
            <h3 className="font-medium text-foreground">Hardware Acceleration</h3>
            <p className="text-sm text-muted-foreground">
              Force high-performance GPU for faster rendering (requires app restart).
            </p>
          </div>
          <Switch checked={forceGPU} onCheckedChange={handleForceGPUChange} />
        </div>

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
              className="h-10 bg-background/50"
            />
            <Button variant="secondary" onClick={handleRecordSaaSRootBrowse} className="h-10 shrink-0">
              Browse
            </Button>
            <Button variant="secondary" onClick={handleResetRecordSaaSRootPath} className="h-10 shrink-0">
              Reset
            </Button>
          </div>
        </div>

        <div className="p-4 bg-muted/50 rounded-lg border border-border">
          <div className="mb-4 flex items-start justify-between gap-6">
            <div>
              <h3 className="font-medium text-foreground">Export RAM Budget</h3>
              <p className="text-sm text-muted-foreground">
                Limits renderer buffering during export. 100% equals {formatGiB(exportMemoryMaxBudgetBytes)}, below
                70% of total system RAM.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-foreground">{exportMemoryLimitPercent}%</div>
              <div className="text-xs text-muted-foreground">{formatGiB(exportMemoryBudgetBytes)}</div>
            </div>
          </div>
          <Slider
            min={10}
            max={100}
            step={5}
            value={exportMemoryLimitPercent}
            onChange={handleExportMemoryLimitChange}
          />
        </div>
      </div>
    </div>
  )
}
