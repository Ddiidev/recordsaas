import { useState, useEffect, useRef, useMemo } from 'react'
import {
  Microphone,
  MicrophoneOff,
  DeviceComputerCamera,
  DeviceComputerCameraOff,
  DeviceDesktop,
  Loader2,
  Video,
  X,
  Marquee2,
  Pointer,
  FileImport,
  Folder,
  Square,
  Settings,
  UserCircle,
} from 'tabler-icons-react'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { SettingsModal } from '../components/settings/SettingsModal'
import { useDeviceManager } from '../hooks/useDeviceManager'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { cn } from '../lib/utils'
import { useDesktopAuth } from '../hooks/useDesktopAuth'
import log from 'electron-log/renderer'
import type { SettingsTab } from '../components/settings/SettingsModal'
import '../index.css'

// --- Constants ---
const LINUX_SCALES = [
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
]
const WINDOWS_SCALES = [
  { value: 3, label: '3x' },
  { value: 2, label: '2x' },
  { value: 1, label: '1x' },
]
const PREPARATION_COUNTDOWN_OPTIONS = [0, 2, 3, 5, 10] as const
const DEFAULT_PREPARATION_COUNTDOWN_SECONDS = 3
const RECORDER_WINDOW_COMPACT_SIZE = { width: 960, height: 400 }
// Preview no longer controls window size; keep content scrollable instead
// const RECORDER_WINDOW_PREVIEW_SIZE = { width: 900, height: 360 }
const RECORDER_WINDOW_SETTINGS_SIZE = { width: 960, height: 700 }

const isPreparationCountdownOption = (value: number): value is (typeof PREPARATION_COUNTDOWN_OPTIONS)[number] =>
  PREPARATION_COUNTDOWN_OPTIONS.includes(value as (typeof PREPARATION_COUNTDOWN_OPTIONS)[number])

// --- Types ---
type RecordingState = 'idle' | 'preparing' | 'recording'
type ActionInProgress = 'none' | 'recording' | 'loading'
type RecordingSource = 'area' | 'fullscreen' | 'window'
type DisplayInfo = { id: number; name: string; isPrimary: boolean }

export function RecorderPage() {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [isRecording, setIsRecording] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<ActionInProgress>('none')
  const [source, setSource] = useState<RecordingSource>('fullscreen')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplayId, setSelectedDisplayId] = useState<string>('')
  const [selectedWebcamId, setSelectedWebcamId] = useState<string>('none')
  const [selectedMicId, setSelectedMicId] = useState<string>('none')
  const [cursorScale, setCursorScale] = useState<number>(1)
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general')
  const [preparationCountdownSeconds, setPreparationCountdownSeconds] = useState<number>(
    DEFAULT_PREPARATION_COUNTDOWN_SECONDS,
  )
  const [preparationSecondsLeft, setPreparationSecondsLeft] = useState<number | null>(null)

  const { platform, webcams, mics, isInitializing, reload: reloadDevices } = useDeviceManager()
  const { authState } = useDesktopAuth()
  const webcamPreviewRef = useRef<HTMLVideoElement>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const preparationCountdownIntervalRef = useRef<number | null>(null)

  const cursorScales = useMemo(() => (platform === 'win32' ? WINDOWS_SCALES : LINUX_SCALES), [platform])
  const isWebcamPreviewVisible = selectedWebcamId !== 'none' && actionInProgress === 'none' && !isRecording
  const handleSettingsClose = () => {
    setSettingsModalOpen(false)
    setSettingsInitialTab('general')
    window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_COMPACT_SIZE)
  }

  const openSettingsTab = (tab: SettingsTab) => {
    setSettingsInitialTab(tab)
    setSettingsModalOpen(true)
  }

  // Effect for initializing settings and devices from storage/system
  useEffect(() => {
    const initialize = async () => {
      try {
        const [savedWebcamId, savedMicId, savedCursorScale, savedPreparationCountdown, fetchedDisplays] =
          await Promise.all([
            window.electronAPI.getSetting<string>('recorder.selectedWebcamId'),
            window.electronAPI.getSetting<string>('recorder.selectedMicId'),
            window.electronAPI.getSetting<number>('recorder.cursorScale'),
            window.electronAPI.getSetting<number>('recorder.preparationCountdownSeconds'),
            window.electronAPI.getDisplays(),
          ])

        setSelectedWebcamId(savedWebcamId || 'none')
        setSelectedMicId(savedMicId || 'none')

        if (typeof savedPreparationCountdown === 'number' && isPreparationCountdownOption(savedPreparationCountdown)) {
          setPreparationCountdownSeconds(savedPreparationCountdown)
        } else {
          setPreparationCountdownSeconds(DEFAULT_PREPARATION_COUNTDOWN_SECONDS)
        }

        // Only set cursor scale from settings for Linux
        if (platform === 'linux') {
          const scale = savedCursorScale ?? 1
          setCursorScale(scale)
          window.electronAPI.setCursorScale(scale)
        }

        setDisplays(fetchedDisplays)
        const primary = fetchedDisplays.find((d) => d.isPrimary) || fetchedDisplays[0]
        if (primary) setSelectedDisplayId(String(primary.id))
      } catch (error) {
        log.error('[Recorder] Failed to initialize recorder settings:', error)
      }
    }
    initialize()
  }, [platform]) // Depend on platform to ensure correct logic is applied

  // Effect to validate saved settings against available devices after initialization
  useEffect(() => {
    if (isInitializing) return

    if (webcams.length > 0 && !webcams.some((w) => w.id === selectedWebcamId)) {
      setSelectedWebcamId('none')
    }
    if (mics.length > 0 && !mics.some((m) => m.id === selectedMicId)) {
      setSelectedMicId('none')
    }
    if (platform === 'linux' && !cursorScales.some((s) => s.value === cursorScale)) {
      setCursorScale(1)
      window.electronAPI.setCursorScale(1)
    }
  }, [isInitializing, webcams, mics, platform, cursorScales, selectedWebcamId, selectedMicId, cursorScale])

  // Effect to manage IPC listeners for recording completion
  useEffect(() => {
    const cleanupStarted = window.electronAPI.onRecordingStarted(() => {
      setRecordingState('recording')
      setIsRecording(true)
      setPreparationSecondsLeft(null)
      setActionInProgress('none')
    })

    const cleanupFinished = window.electronAPI.onRecordingFinished(() => {
      setActionInProgress('none')
      setRecordingState('idle')
      setIsRecording(false)
      setPreparationSecondsLeft(null)
      reloadDevices() // Refresh device list in case something changed
    })
    return () => {
      cleanupStarted()
      cleanupFinished()
    }
  }, [reloadDevices])

  // Effect to manage the webcam preview stream
  useEffect(() => {
    const videoEl = webcamPreviewRef.current
    const stopStream = () => {
      if (webcamStreamRef.current) {
        webcamStreamRef.current.getTracks().forEach((track) => track.stop())
        webcamStreamRef.current = null
      }
      if (videoEl) videoEl.srcObject = null
    }

    if (recordingState !== 'idle' || selectedWebcamId === 'none' || !videoEl) {
      stopStream()
      return
    }

    const startStream = async () => {
      stopStream()
      try {
        log.debug(`[Recorder] Starting webcam preview for device: ${selectedWebcamId}`)
        const constraints = { video: platform === 'win32' ? true : { deviceId: { exact: selectedWebcamId } } }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        webcamStreamRef.current = stream
        if (videoEl) videoEl.srcObject = stream
      } catch (error) {
        log.error('[Recorder] Failed to start webcam preview stream:', error)
      }
    }

    startStream()
    return stopStream
  }, [selectedWebcamId, platform, recordingState])

  useEffect(() => {
    return () => {
      if (preparationCountdownIntervalRef.current !== null) {
        window.clearInterval(preparationCountdownIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (isSettingsModalOpen) {
      window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_SETTINGS_SIZE)
    } else {
      window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_COMPACT_SIZE)
    }

    return () => {
      window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_COMPACT_SIZE)
    }
  }, [isSettingsModalOpen])

  // Enable click-through only when Settings is closed
  useEffect(() => {
    if (isSettingsModalOpen) {
      window.electronAPI.setRecorderIgnoreMouse(false)
      return
    }
    const onMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const interactive =
        target?.closest('[data-interactive="true"]') ||
        target?.closest('[data-radix-popper-content-wrapper]')
      window.electronAPI.setRecorderIgnoreMouse(!interactive)
    }
    const onMouseLeave = () => {
      window.electronAPI.setRecorderIgnoreMouse(true)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)
    window.electronAPI.setRecorderIgnoreMouse(true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.electronAPI.setRecorderIgnoreMouse(false)
    }
  }, [isSettingsModalOpen])

  const clearPreparationCountdown = () => {
    if (preparationCountdownIntervalRef.current !== null) {
      window.clearInterval(preparationCountdownIntervalRef.current)
      preparationCountdownIntervalRef.current = null
    }
    setPreparationSecondsLeft(null)
  }

  const resolvePreparationCountdownSeconds = async () => {
    try {
      const savedPreparationCountdown = await window.electronAPI.getSetting<number>(
        'recorder.preparationCountdownSeconds',
      )
      if (typeof savedPreparationCountdown === 'number' && isPreparationCountdownOption(savedPreparationCountdown)) {
        if (savedPreparationCountdown !== preparationCountdownSeconds) {
          setPreparationCountdownSeconds(savedPreparationCountdown)
        }
        return savedPreparationCountdown
      }
    } catch (error) {
      log.error('[Recorder] Failed to read preparation countdown setting:', error)
    }

    return preparationCountdownSeconds
  }

  const runPreparationCountdown = (seconds: number) =>
    new Promise<void>((resolve) => {
      clearPreparationCountdown()

      if (seconds <= 0) {
        resolve()
        return
      }

      setPreparationSecondsLeft(seconds)
      preparationCountdownIntervalRef.current = window.setInterval(() => {
        setPreparationSecondsLeft((previousSeconds) => {
          if (previousSeconds === null) return null
          if (previousSeconds <= 1) {
            if (preparationCountdownIntervalRef.current !== null) {
              window.clearInterval(preparationCountdownIntervalRef.current)
              preparationCountdownIntervalRef.current = null
            }
            resolve()
            return null
          }

          return previousSeconds - 1
        })
      }, 1000)
    })

  const startRecordingAfterPreparation = async () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop())
      webcamStreamRef.current = null
      if (webcamPreviewRef.current) webcamPreviewRef.current.srcObject = null
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    try {
      const webcam = selectedWebcamId !== 'none' ? webcams.find((d) => d.id === selectedWebcamId) : undefined
      const mic = selectedMicId !== 'none' ? mics.find((d) => d.id === selectedMicId) : undefined

      log.info(`[Recorder] Starting recording: source=${source}, webcam=${webcam?.name ?? 'none'}, mic=${mic?.name ?? 'none'}`)
      const result = await window.electronAPI.startRecording({
        source,
        displayId: source === 'fullscreen' ? Number(selectedDisplayId) : undefined,
        webcam: webcam ? { deviceId: webcam.id, deviceLabel: webcam.id, index: webcams.indexOf(webcam) } : undefined,
        mic: mic ? { deviceId: mic.id, deviceLabel: mic.id, index: mics.indexOf(mic) } : undefined,
      })

      if (result.canceled) {
        setActionInProgress('none')
        setRecordingState('idle')
        setIsRecording(false)
        clearPreparationCountdown()
      }
    } catch (error) {
      log.error('[Recorder] Failed to start recording:', error)
      setActionInProgress('none')
      setRecordingState('idle')
      setIsRecording(false)
      clearPreparationCountdown()
    }
  }

  const handleStart = async () => {
    setActionInProgress('recording')
    setRecordingState('preparing')

    try {
      const countdownSeconds = await resolvePreparationCountdownSeconds()
      await runPreparationCountdown(countdownSeconds)
      await startRecordingAfterPreparation()
    } catch (error) {
      log.error('[Recorder] Failed to run preparation countdown:', error)
      setActionInProgress('none')
      setRecordingState('idle')
      setIsRecording(false)
      clearPreparationCountdown()
    }
  }

  const handleStop = () => {
    setActionInProgress('recording')
    window.electronAPI.stopRecording()
  }

  const handleLoadVideo = async () => {
    setActionInProgress('loading')
    try {
      const result = await window.electronAPI.loadVideoFromFile()
      if (result.canceled) setActionInProgress('none')
    } catch (error) {
      log.error('[Recorder] Failed to load video from file:', error)
      setActionInProgress('none')
    }
  }

  const handleImportProject = async () => {
    setActionInProgress('loading')
    try {
      const result = await window.electronAPI.importProject()
      if (result.canceled) setActionInProgress('none')
    } catch (error) {
      log.error('[Recorder] Failed to import project from file:', error)
      setActionInProgress('none')
    }
  }

  const handleSelectionChange = (setter: (id: string) => void, key: string) => (id: string) => {
    setter(id)
    window.electronAPI.setSetting(key, id)
  }

  const handleCursorScaleChange = (value: string) => {
    const newScale = Number(value)
    setCursorScale(newScale)
    window.electronAPI.setCursorScale(newScale)
    window.electronAPI.setSetting('recorder.cursorScale', newScale)
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative h-full w-full overflow-hidden bg-transparent select-none">
        <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-6">
          <div data-interactive="true" className="relative">
          {/* Main Control Bar */}
          <div
            className={cn(
              "relative flex items-center gap-3 px-4 py-3 rounded-lg bg-card border shadow-2xl",
              "border-primary"
            )}
            style={{ WebkitAppRegion: 'drag' }}
          >
            {/* Close Button - macOS/Linux (Left) */}
            {platform !== 'win32' && (
              <button
                onClick={() => window.electronAPI.closeWindow()}
                style={{ WebkitAppRegion: 'no-drag' }}
                className="absolute -top-2.5 -left-2.5 z-20 flex items-center justify-center w-6 h-6 rounded-md bg-destructive/90 hover:bg-destructive text-white shadow-lg transition-all hover:scale-110"
                aria-label="Close Recorder"
                disabled={isRecording || actionInProgress !== 'none'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Close Button - Windows (Right) */}
            {platform === 'win32' && (
              <button
                onClick={() => window.electronAPI.closeWindow()}
                style={{ WebkitAppRegion: 'no-drag' }}
                className="absolute -top-2.5 -right-2.5 z-20 flex items-center justify-center w-6 h-6 rounded-md bg-destructive/90 hover:bg-destructive text-white shadow-lg transition-all hover:scale-110"
                aria-label="Close Recorder"
                disabled={isRecording || actionInProgress !== 'none'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Source Toggle */}
            <div
              className="flex items-center p-1 bg-muted/60 rounded-xl border border-border/50"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              <SourceButton
                icon={<DeviceDesktop size={16} />}
                isActive={source === 'fullscreen'}
                onClick={() => setSource('fullscreen')}
                tooltip="Full Screen"
                disabled={isRecording || actionInProgress !== 'none'}
              />
              <SourceButton
                icon={<Marquee2 size={16} />}
                isActive={source === 'area'}
                onClick={() => setSource('area')}
                tooltip="Area"
                disabled={isRecording || actionInProgress !== 'none'}
              />
            </div>

            <div className="w-px h-8 bg-border/50"></div>

            {/* Device Selectors */}
            <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
              <Select
                value={selectedDisplayId}
                onValueChange={setSelectedDisplayId}
                disabled={source !== 'fullscreen' || isRecording || actionInProgress !== 'none'}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select display"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      <DeviceDesktop size={14} className="text-primary shrink-0" />
                      <span className="truncate">
                        {displays.find((d) => String(d.id) === selectedDisplayId)?.name || '...'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {displays.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedWebcamId}
                onValueChange={handleSelectionChange(setSelectedWebcamId, 'recorder.selectedWebcamId')}
                disabled={isRecording || actionInProgress !== 'none'}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select webcam"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      {selectedWebcamId !== 'none' ? (
                        <DeviceComputerCamera size={14} className="text-primary shrink-0" />
                      ) : (
                        <DeviceComputerCameraOff size={14} className="text-muted-foreground/60" />
                      )}
                      <span className={cn('truncate', selectedWebcamId === 'none' && 'text-muted-foreground')}>
                        {webcams.find((w) => w.id === selectedWebcamId)?.name || 'No webcam'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No webcam</SelectItem>
                  {webcams.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedMicId}
                onValueChange={handleSelectionChange(setSelectedMicId, 'recorder.selectedMicId')}
                disabled={isRecording || actionInProgress !== 'none'}
              >
                <SelectTrigger
                  variant="minimal"
                  className="w-auto min-w-[120px] max-w-[150px] h-9"
                  aria-label="Select microphone"
                >
                  <SelectValue asChild>
                    <div className="flex items-center gap-1.5 text-xs">
                      {selectedMicId !== 'none' ? (
                        <Microphone size={14} className="text-primary shrink-0" />
                      ) : (
                        <MicrophoneOff size={14} className="text-muted-foreground/60" />
                      )}
                      <span className={cn('truncate', selectedMicId === 'none' && 'text-muted-foreground')}>
                        {mics.find((m) => m.id === selectedMicId)?.name || 'No microphone'}
                      </span>
                    </div>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No microphone</SelectItem>
                  {mics.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-px h-8 bg-border/50"></div>

            {/* Cursor Scale (Linux Only) */}
            {platform === 'linux' && (
              <>
                <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' }}>
                  <Pointer size={14} className="text-muted-foreground/60" />
                  <Select
                    value={String(cursorScale)}
                    onValueChange={handleCursorScaleChange}
                    disabled={isRecording || actionInProgress !== 'none'}
                  >
                    <SelectTrigger variant="minimal" className="w-[56px] h-9 text-xs" aria-label="Select cursor scale">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {cursorScales.map((s) => (
                        <SelectItem key={s.value} value={String(s.value)}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-px h-8 bg-border/50"></div>
              </>
            )}

            {/* Action Buttons */}
            <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' }}>
              <div className="flex items-center gap-2">
                {isRecording ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleStop}
                        variant="destructive"
                        size="icon"
                        className="h-10 w-10 rounded-lg shadow-lg"
                      >
                        <Square size={16} fill="currentColor" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                      Stop Recording
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleStart}
                        disabled={isInitializing || actionInProgress !== 'none'}
                        size="icon"
                        className="h-10 w-10 rounded-lg shadow-lg"
                      >
                        <Video size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                      Record Screen
                    </TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleLoadVideo}
                      disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 rounded-lg shadow-lg"
                    >
                      <Folder size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                    Load Local Video
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleImportProject}
                      disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 rounded-lg shadow-lg"
                    >
                      <FileImport size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                    Import Project
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => openSettingsTab('account')}
                      disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 rounded-lg shadow-lg overflow-hidden p-0 border border-primary"
                    >
                      {authState.user?.picture ? (
                        <img
                          src={authState.user.picture}
                          alt={authState.user.name || authState.user.email}
                          className="w-full h-full object-cover rounded-lg border border-primary"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <UserCircle size={18} />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                    {authState.user?.name || 'Account'}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => openSettingsTab('general')}
                      disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                      variant="secondary"
                      size="icon"
                      className="h-10 w-10 rounded-lg shadow-lg"
                    >
                      <Settings size={18} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={12} className="px-3 py-1.5 text-xs font-medium rounded-md">
                    Settings
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="w-8 h-10 flex items-center justify-center">
                <Loader2
                  size={20}
                  className={cn(
                    'animate-spin text-primary transition-opacity duration-300',
                    actionInProgress !== 'none' || isInitializing ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </div>
            </div>
          </div>

          {/* Webcam Preview */}
          <div
            className={cn(
              'mt-4 mx-auto w-48 aspect-square rounded-2xl overflow-hidden shadow-xl bg-black transition-all duration-300',
              isWebcamPreviewVisible
                ? 'opacity-100 scale-100'
                : 'opacity-0 scale-95 pointer-events-none',
            )}
          >
            <video ref={webcamPreviewRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        </div>
      </div>

      {recordingState === 'preparing' && preparationSecondsLeft !== null && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="card-clean bg-card/90 border-border/80 px-10 py-8 text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Get Ready</p>
            <p className="mt-2 text-6xl leading-none font-semibold tabular-nums text-foreground">
              {preparationSecondsLeft}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">Recording starts in seconds</p>
          </div>
        </div>
      )}

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={handleSettingsClose}
        isTransparent
        initialTab={settingsInitialTab}
      />
      </div>
    </TooltipProvider>
  )
}

const SourceButton = ({
  icon,
  isActive,
  tooltip,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; isActive: boolean; tooltip?: string }) => (
  <button
    className={cn(
      'flex items-center justify-center w-10 h-9 rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isActive
        ? 'bg-primary shadow-sm text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
    )}
    title={tooltip}
    {...props}
  >
    {icon}
  </button>
)
