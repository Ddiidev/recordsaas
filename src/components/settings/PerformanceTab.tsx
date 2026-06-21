import { useEffect, useState } from 'react'
import { ChevronDown } from '@icons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { Slider } from '../ui/slider'

const EXPORT_MEMORY_LIMIT_SETTING_KEY = 'export.memoryLimitPercent'
const RECORDING_PROCESS_PRIORITY_SETTING_KEY = 'general.recordingProcessPriority'
const RECORDING_PROCESS_PRIORITIES_SETTING_KEY = 'general.recordingProcessPriorities'
const DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT = 50
const EXPORT_MEMORY_HARD_CAP_FRACTION = 0.6

type RecordingProcessPriority = 'low' | 'normal' | 'high'
type RecordingProcessPriorityMode = RecordingProcessPriority | 'advanced'
type RecordingProcessPriorityRole = 'main' | 'webcam' | 'systemAudio'
type RecordingProcessPriorities = Record<RecordingProcessPriorityRole, RecordingProcessPriority>

const DEFAULT_RECORDING_PROCESS_PRIORITY: RecordingProcessPriority = 'normal'
const DEFAULT_RECORDING_PROCESS_PRIORITY_MODE: RecordingProcessPriorityMode = 'normal'
const DEFAULT_RECORDING_PROCESS_PRIORITIES: RecordingProcessPriorities = {
  main: DEFAULT_RECORDING_PROCESS_PRIORITY,
  webcam: DEFAULT_RECORDING_PROCESS_PRIORITY,
  systemAudio: DEFAULT_RECORDING_PROCESS_PRIORITY,
}

const RECORDING_PROCESS_PRIORITY_OPTIONS: Array<{
  value: RecordingProcessPriorityMode
  label: string
  description: string
}> = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'Recommended. Uses below-normal process priority on Windows.',
  },
  {
    value: 'low',
    label: 'Low',
    description: 'Reduces system impact more, but can increase dropped frames.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Gives recording more scheduling priority. Use only when capture is unstable.',
  },
  {
    value: 'advanced',
    label: 'Advanced',
    description: 'Configure process priority per FFmpeg recording role.',
  },
]

const GRANULAR_PRIORITY_ROLES: Array<{
  key: RecordingProcessPriorityRole
  label: string
  description: string
}> = [
  {
    key: 'main',
    label: 'Screen / microphone recording',
    description: 'Main FFmpeg process. It records the screen and also microphone audio when mic is enabled.',
  },
  {
    key: 'webcam',
    label: 'Webcam recording',
    description: 'Separate FFmpeg process used when webcam recording runs independently.',
  },
  {
    key: 'systemAudio',
    label: 'Computer audio recording',
    description: 'FFmpeg process that records or encodes PC audio when computer audio capture is enabled.',
  },
]

const PRIORITY_CHOICES: Array<{ value: RecordingProcessPriority; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const sanitizeExportMemoryLimitPercent = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT
  return Math.max(10, Math.min(100, Math.round(parsed)))
}

const isRecordingProcessPriority = (value: unknown): value is RecordingProcessPriority =>
  value === 'low' || value === 'normal' || value === 'high'

const sanitizeRecordingProcessPriorityMode = (value: unknown): RecordingProcessPriorityMode => {
  if (isRecordingProcessPriority(value) || value === 'advanced') return value
  return DEFAULT_RECORDING_PROCESS_PRIORITY_MODE
}

const sanitizeRecordingProcessPriorities = (value: unknown): RecordingProcessPriorities => {
  const source = value && typeof value === 'object' ? (value as Partial<RecordingProcessPriorities>) : {}
  return {
    main: isRecordingProcessPriority(source.main) ? source.main : DEFAULT_RECORDING_PROCESS_PRIORITIES.main,
    webcam: isRecordingProcessPriority(source.webcam) ? source.webcam : DEFAULT_RECORDING_PROCESS_PRIORITIES.webcam,
    systemAudio: isRecordingProcessPriority(source.systemAudio)
      ? source.systemAudio
      : DEFAULT_RECORDING_PROCESS_PRIORITIES.systemAudio,
  }
}

const formatGiB = (bytes: number | null): string => {
  if (!bytes || !Number.isFinite(bytes)) return 'unknown'
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

export function PerformanceTab() {
  const [forceGPU, setForceGPU] = useState(false)
  const [recordingProcessPriority, setRecordingProcessPriority] =
    useState<RecordingProcessPriorityMode>(DEFAULT_RECORDING_PROCESS_PRIORITY_MODE)
  const [recordingProcessPriorities, setRecordingProcessPriorities] = useState<RecordingProcessPriorities>(
    DEFAULT_RECORDING_PROCESS_PRIORITIES,
  )
  const [granularOpen, setGranularOpen] = useState(false)
  const [exportMemoryLimitPercent, setExportMemoryLimitPercent] = useState(DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT)
  const [totalMemoryBytes, setTotalMemoryBytes] = useState<number | null>(null)

  useEffect(() => {
    let isMounted = true

    const loadSettings = async () => {
      try {
        const [
          savedForceGPU,
          savedRecordingProcessPriority,
          savedRecordingProcessPriorities,
          savedExportMemoryLimitPercent,
          systemMemoryInfo,
        ] = await Promise.all([
          window.electronAPI.getSetting<boolean>('general.forceHighPerformanceGpu'),
          window.electronAPI.getSetting<RecordingProcessPriorityMode>(RECORDING_PROCESS_PRIORITY_SETTING_KEY),
          window.electronAPI.getSetting<RecordingProcessPriorities>(RECORDING_PROCESS_PRIORITIES_SETTING_KEY),
          window.electronAPI.getSetting<number>(EXPORT_MEMORY_LIMIT_SETTING_KEY),
          window.electronAPI.getSystemMemoryInfo(),
        ])

        if (!isMounted) return

        const priorityMode = sanitizeRecordingProcessPriorityMode(savedRecordingProcessPriority)
        setForceGPU(typeof savedForceGPU === 'boolean' ? savedForceGPU : false)
        setRecordingProcessPriority(priorityMode)
        setRecordingProcessPriorities(sanitizeRecordingProcessPriorities(savedRecordingProcessPriorities))
        setGranularOpen(priorityMode === 'advanced')
        setExportMemoryLimitPercent(sanitizeExportMemoryLimitPercent(savedExportMemoryLimitPercent))
        setTotalMemoryBytes(
          systemMemoryInfo?.totalMemoryBytes && Number.isFinite(systemMemoryInfo.totalMemoryBytes)
            ? systemMemoryInfo.totalMemoryBytes
            : null,
        )
      } catch (error) {
        console.error('Failed to load performance settings:', error)
      }
    }

    void loadSettings()

    return () => {
      isMounted = false
    }
  }, [])

  const isAdvancedPriority = recordingProcessPriority === 'advanced'
  const selectedRecordingPriorityDescription =
    RECORDING_PROCESS_PRIORITY_OPTIONS.find((option) => option.value === recordingProcessPriority)?.description ||
    RECORDING_PROCESS_PRIORITY_OPTIONS[0].description
  const exportMemoryBudgetBytes = totalMemoryBytes
    ? totalMemoryBytes * EXPORT_MEMORY_HARD_CAP_FRACTION * (exportMemoryLimitPercent / 100)
    : null
  const exportMemoryMaxBudgetBytes = totalMemoryBytes ? totalMemoryBytes * EXPORT_MEMORY_HARD_CAP_FRACTION : null

  const handleForceGPUChange = (checked: boolean) => {
    setForceGPU(checked)
    window.electronAPI.setSetting('general.forceHighPerformanceGpu', checked)
  }

  const handleRecordingProcessPriorityChange = (value: string) => {
    const nextValue = sanitizeRecordingProcessPriorityMode(value)
    setRecordingProcessPriority(nextValue)
    setGranularOpen(nextValue === 'advanced')
    window.electronAPI.setSetting(RECORDING_PROCESS_PRIORITY_SETTING_KEY, nextValue)
  }

  const handleGranularPriorityChange = (role: RecordingProcessPriorityRole, value: string) => {
    const nextPriority = isRecordingProcessPriority(value) ? value : DEFAULT_RECORDING_PROCESS_PRIORITY
    setRecordingProcessPriorities((current) => {
      const nextPriorities = { ...current, [role]: nextPriority }
      window.electronAPI.setSetting(RECORDING_PROCESS_PRIORITIES_SETTING_KEY, nextPriorities)
      return nextPriorities
    })
  }

  const handleExportMemoryLimitChange = (value: number) => {
    const nextValue = sanitizeExportMemoryLimitPercent(value)
    setExportMemoryLimitPercent(nextValue)
    window.electronAPI.setSetting(EXPORT_MEMORY_LIMIT_SETTING_KEY, nextValue)
  }

  return (
    <div className="p-8">
      <h2 className="mb-6 text-lg font-semibold text-foreground">Performance Settings</h2>

      <div className="space-y-8">
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border">
          <div>
            <h3 className="font-medium text-foreground">Hardware Acceleration</h3>
            <p className="text-sm text-muted-foreground">
              Force high-performance GPU for faster rendering (requires app restart).
            </p>
          </div>
          <Switch checked={forceGPU} onCheckedChange={handleForceGPUChange} />
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-4">
          <div className="flex items-center justify-between gap-6">
            <div>
              <h3 className="font-medium text-foreground">Recording Process Priority</h3>
              <p className="text-sm text-muted-foreground">{selectedRecordingPriorityDescription}</p>
            </div>
            <Select value={recordingProcessPriority} onValueChange={handleRecordingProcessPriorityChange}>
              <SelectTrigger className="w-40 h-10 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORDING_PROCESS_PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div
            className="rounded-md border border-border/70 bg-background/45"
            data-state={isAdvancedPriority && granularOpen ? 'open' : 'closed'}
          >
            <button
              type="button"
              disabled={!isAdvancedPriority}
              aria-expanded={isAdvancedPriority && granularOpen}
              onClick={() => {
                if (isAdvancedPriority) setGranularOpen((current) => !current)
              }}
              className="flex w-full items-center justify-between gap-4 rounded-md px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
            >
              <div>
                <div className="text-sm font-medium text-foreground">Advanced per-process priorities</div>
                <div className="text-xs text-muted-foreground">
                  {isAdvancedPriority
                    ? 'Configure each FFmpeg role separately.'
                    : 'Select Advanced above to enable granular process settings.'}
                </div>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  isAdvancedPriority && granularOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isAdvancedPriority && granularOpen && (
              <div className="space-y-3 border-t border-border/70 p-4">
                {GRANULAR_PRIORITY_ROLES.map((role) => (
                  <div key={role.key} className="flex items-center justify-between gap-6">
                    <div>
                      <div className="text-sm font-medium text-foreground">{role.label}</div>
                      <p className="text-xs text-muted-foreground">{role.description}</p>
                    </div>
                    <Select
                      value={recordingProcessPriorities[role.key]}
                      onValueChange={(value) => handleGranularPriorityChange(role.key, value)}
                    >
                      <SelectTrigger className="h-10 w-32 bg-background/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_CHOICES.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
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
