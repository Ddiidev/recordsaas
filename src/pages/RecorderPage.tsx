import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  CameraSolid,
  Microphone,
  MicrophoneOff,
  DeviceComputerCamera,
  DeviceComputerCameraOff,
  DeviceDesktop,
  Loader2,
  Video,
  X,
  Marquee2,
  FileImport,
  Folder,
  IconShell,
  IconSwitch,
  MicrophoneSolid,
  Square,
  Settings,
  UserCircle,
} from '@icons'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { SettingsModal, type SettingsTab } from '../components/settings/SettingsModal'
import { useDeviceManager } from '../hooks/useDeviceManager'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { isLinuxCursorScaleOption, RECORDER_WINDOW_SIZES } from '../lib/recorder-window'
import { cn } from '../lib/utils'
import type { AuthSession } from '../types/auth'
import '../index.css'

// --- Constants ---
const PREPARATION_COUNTDOWN_OPTIONS = [0, 2, 3, 5, 10] as const
const DEFAULT_PREPARATION_COUNTDOWN_SECONDS = 3
const WEBCAM_RELEASE_DELAY_MS = 1000
const RECORDER_DEVICE_LABEL_MAX_LENGTH = 50

const EMPTY_AUTH_SESSION: AuthSession = {
  user: null,
  license: null,
  credits: null,
  sessionToken: null,
  entitlementToken: null,
  isAuthenticated: false,
  status: 'free',
}

const isPreparationCountdownOption = (value: number): value is (typeof PREPARATION_COUNTDOWN_OPTIONS)[number] =>
  PREPARATION_COUNTDOWN_OPTIONS.includes(value as (typeof PREPARATION_COUNTDOWN_OPTIONS)[number])

const truncateRecorderLabel = (value: string, maxLength = RECORDER_DEVICE_LABEL_MAX_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

// --- Types ---
type RecordingState = 'idle' | 'preparing' | 'recording'
type ActionInProgress = 'none' | 'recording' | 'loading'
type RecordingSource = 'area' | 'fullscreen' | 'window'
type ToolbarSelectKey = 'display' | 'webcam' | 'mic'
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
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [toolbarSelectOpenStates, setToolbarSelectOpenStates] = useState<Record<ToolbarSelectKey, boolean>>({
    display: false,
    webcam: false,
    mic: false,
  })
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('general')
  const [preparationCountdownSeconds, setPreparationCountdownSeconds] = useState<number>(
    DEFAULT_PREPARATION_COUNTDOWN_SECONDS,
  )
  const [preparationSecondsLeft, setPreparationSecondsLeft] = useState<number | null>(null)
  const [authSession, setAuthSession] = useState<AuthSession>(EMPTY_AUTH_SESSION)

  const { platform, webcams, mics, isInitializing, reload: reloadDevices } = useDeviceManager()
  const webcamPreviewRef = useRef<HTMLVideoElement>(null)
  const webcamStreamRef = useRef<MediaStream | null>(null)
  const webcamPreviewRequestIdRef = useRef(0)
  const preparationCountdownIntervalRef = useRef<number | null>(null)
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null)

  const isAnyToolbarSelectOpen = Object.values(toolbarSelectOpenStates).some(Boolean)
  const isWebcamPreviewVisible = selectedWebcamId !== 'none' && actionInProgress === 'none' && !isRecording
  const recorderWindowPreset = isSettingsModalOpen ? 'settings' : isWebcamPreviewVisible ? 'preview' : 'toolbar'
  const isWindowClickThroughSupported = platform === 'win32' || platform === 'darwin'
  const accountTooltip = useMemo(() => {
    if (authSession.isAuthenticated) {
      return authSession.user?.name || authSession.user?.email || 'Logged in'
    }
    return 'Not logged in'
  }, [authSession.isAuthenticated, authSession.user?.email, authSession.user?.name])

  const loadAuthSession = useCallback(async () => {
    try {
      const session = await window.electronAPI.getAuthSession()
      setAuthSession(session)
    } catch (error) {
      console.error('Failed to load desktop auth session:', error)
      setAuthSession(EMPTY_AUTH_SESSION)
    }
  }, [])

  const stopPreviewStream = useCallback((stream?: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop())
  }, [])

  const clearPreviewElement = useCallback(() => {
    const videoEl = webcamPreviewRef.current
    if (!videoEl) return

    videoEl.pause()
    videoEl.srcObject = null
  }, [])

  const teardownWebcamPreview = useCallback(() => {
    stopPreviewStream(webcamStreamRef.current)
    webcamStreamRef.current = null
    clearPreviewElement()
  }, [clearPreviewElement, stopPreviewStream])

  const releaseWebcamPreview = useCallback(async () => {
    webcamPreviewRequestIdRef.current += 1
    teardownWebcamPreview()
    await new Promise((resolve) => setTimeout(resolve, WEBCAM_RELEASE_DELAY_MS))
  }, [teardownWebcamPreview])

  const handleOpenSettings = () => {
    setSettingsDefaultTab('general')
    setSettingsModalOpen(true)
  }

  const handleOpenAccount = async () => {
    if (authSession.isAuthenticated) {
      setSettingsDefaultTab('account')
      setSettingsModalOpen(true)
      return
    }

    try {
      await window.electronAPI.startAuthLogin()
    } catch (error) {
      console.error('Failed to start desktop login flow:', error)
    }
  }

  const handleSettingsClose = () => {
    setSettingsModalOpen(false)
    setSettingsDefaultTab('general')
  }

  const handleToolbarSelectOpenChange = useCallback(
    (selectKey: ToolbarSelectKey) => (open: boolean) => {
      setToolbarSelectOpenStates((current) => {
        if (current[selectKey] === open) {
          return current
        }

        return { ...current, [selectKey]: open }
      })
    },
    [],
  )

  // Effect for initializing settings and devices from storage/system
  useEffect(() => {
    if (!platform) return

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

        if (platform === 'linux') {
          const scale =
            typeof savedCursorScale === 'number' && isLinuxCursorScaleOption(savedCursorScale) ? savedCursorScale : 1
          window.electronAPI.setCursorScale(scale)
        }

        setDisplays(fetchedDisplays)
        const primary = fetchedDisplays.find((d) => d.isPrimary) || fetchedDisplays[0]
        if (primary) setSelectedDisplayId(String(primary.id))
      } catch (error) {
        console.error('Failed to initialize recorder settings:', error)
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
  }, [isInitializing, webcams, mics, selectedWebcamId, selectedMicId])

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

  useEffect(() => {
    void loadAuthSession()

    const cleanupSessionUpdates = window.electronAPI.onAuthSessionUpdated((session) => {
      setAuthSession(session)
    })

    const cleanupDeepLink = window.electronAPI.onAuthDeepLink((payload) => {
      if (payload.status === 'error') {
        console.error('Desktop login deep-link error:', payload.error || payload.rawUrl)
      }
      void loadAuthSession()
    })

    return () => {
      cleanupSessionUpdates()
      cleanupDeepLink()
    }
  }, [loadAuthSession])

  // Effect to manage the webcam preview stream
  useEffect(() => {
    const videoEl = webcamPreviewRef.current

    if (recordingState !== 'idle' || selectedWebcamId === 'none' || !videoEl) {
      webcamPreviewRequestIdRef.current += 1
      teardownWebcamPreview()
      return
    }

    const requestId = webcamPreviewRequestIdRef.current + 1
    webcamPreviewRequestIdRef.current = requestId
    const isCurrentRequest = () => webcamPreviewRequestIdRef.current === requestId

    const startStream = async () => {
      teardownWebcamPreview()
      let permissionStream: MediaStream | null = null
      let stream: MediaStream | null = null

      try {
        permissionStream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (!isCurrentRequest()) {
          stopPreviewStream(permissionStream)
          return
        }

        const browserDevices = await navigator.mediaDevices.enumerateDevices()
        const selectedWebcam = webcams.find((device) => device.id === selectedWebcamId)
        const matchedBrowserDevice = browserDevices.find((device) => {
          if (device.kind !== 'videoinput') return false
          if (device.deviceId === selectedWebcamId) return true
          if (!selectedWebcam) return false
          return device.label === selectedWebcam.name
        })

        stream = permissionStream
        permissionStream = null
        if (
          matchedBrowserDevice?.deviceId &&
          matchedBrowserDevice.deviceId !== stream.getVideoTracks()[0]?.getSettings().deviceId
        ) {
          stopPreviewStream(stream)
          stream = null
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: matchedBrowserDevice.deviceId } },
          })
        }

        if (!isCurrentRequest()) {
          stopPreviewStream(stream)
          return
        }

        webcamStreamRef.current = stream
        videoEl.srcObject = stream
      } catch (error) {
        console.error('Failed to start webcam preview stream:', error)
        if (stream) {
          stopPreviewStream(stream)
        }
      } finally {
        if (permissionStream) {
          stopPreviewStream(permissionStream)
        }

        if (!isCurrentRequest() && stream) {
          stopPreviewStream(stream)
          if (webcamStreamRef.current === stream) {
            webcamStreamRef.current = null
          }
        }
      }
    }

    void startStream()
    return () => {
      if (webcamPreviewRequestIdRef.current === requestId) {
        webcamPreviewRequestIdRef.current += 1
      }
      teardownWebcamPreview()
    }
  }, [selectedWebcamId, platform, recordingState, webcams, stopPreviewStream, teardownWebcamPreview])

  useEffect(() => {
    return () => {
      if (preparationCountdownIntervalRef.current !== null) {
        window.clearInterval(preparationCountdownIntervalRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const cleanupReleaseRequest = window.electronAPI.onReleaseWebcamRequest(() => {
      void releaseWebcamPreview().finally(() => {
        window.electronAPI.sendWebcamReleasedConfirmation()
      })
    })

    return cleanupReleaseRequest
  }, [releaseWebcamPreview])

  useEffect(() => {
    window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_SIZES[recorderWindowPreset])
  }, [recorderWindowPreset])

  useEffect(() => {
    return () => {
      window.electronAPI.setRecorderWindowSize(RECORDER_WINDOW_SIZES.toolbar)
    }
  }, [])

  // Enable click-through only when Settings is closed
  useEffect(() => {
    if (isSettingsModalOpen || isAnyToolbarSelectOpen || !isWindowClickThroughSupported) {
      window.electronAPI.setRecorderIgnoreMouse(false)
      return
    }

    const isInteractiveElement = (target: HTMLElement | null) =>
      !!target?.closest('[data-interactive="true"], [data-radix-popper-content-wrapper], [role="listbox"]')

    const syncIgnoreMouseState = (target: HTMLElement | null) => {
      const interactive = isInteractiveElement(target)
      window.electronAPI.setRecorderIgnoreMouse(!interactive)
    }

    const onMouseMove = (e: MouseEvent) => {
      lastPointerPositionRef.current = { x: e.clientX, y: e.clientY }
      syncIgnoreMouseState(e.target as HTMLElement | null)
    }

    const onMouseLeave = () => {
      window.electronAPI.setRecorderIgnoreMouse(true)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)

    const lastPointerPosition = lastPointerPositionRef.current
    if (lastPointerPosition) {
      syncIgnoreMouseState(document.elementFromPoint(lastPointerPosition.x, lastPointerPosition.y) as HTMLElement | null)
    } else {
      window.electronAPI.setRecorderIgnoreMouse(true)
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
      window.electronAPI.setRecorderIgnoreMouse(false)
    }
  }, [isAnyToolbarSelectOpen, isSettingsModalOpen, isWindowClickThroughSupported])

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
      console.error('Failed to read preparation countdown setting:', error)
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

  const startRecordingAfterPreparation = async (areaGeometry?: {
    x: number
    y: number
    width: number
    height: number
  }) => {
    await releaseWebcamPreview()

    try {
      const webcam = selectedWebcamId !== 'none' ? webcams.find((d) => d.id === selectedWebcamId) : undefined
      const mic = selectedMicId !== 'none' ? mics.find((d) => d.id === selectedMicId) : undefined

      const result = await window.electronAPI.startRecording({
        source,
        geometry: source === 'area' ? areaGeometry : undefined,
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
      console.error('Failed to start recording:', error)
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
      let selectedAreaGeometry:
        | {
            x: number
            y: number
            width: number
            height: number
          }
        | undefined
      if (source === 'area') {
        selectedAreaGeometry = await window.electronAPI.selectRecordingArea()
        if (!selectedAreaGeometry) {
          setActionInProgress('none')
          setRecordingState('idle')
          setIsRecording(false)
          clearPreparationCountdown()
          return
        }
      }

      const countdownSeconds = await resolvePreparationCountdownSeconds()
      await runPreparationCountdown(countdownSeconds)
      await startRecordingAfterPreparation(selectedAreaGeometry)
    } catch (error) {
      console.error('Failed to run preparation countdown:', error)
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
      console.error('Failed to load video from file:', error)
      setActionInProgress('none')
    }
  }

  const handleImportProject = async () => {
    setActionInProgress('loading')
    try {
      const result = await window.electronAPI.importProject()
      if (result.canceled) setActionInProgress('none')
    } catch (error) {
      console.error('Failed to import project from file:', error)
      setActionInProgress('none')
    }
  }

  const handleSelectionChange = (setter: (id: string) => void, key: string) => (id: string) => {
    setter(id)
    window.electronAPI.setSetting(key, id)
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative h-full w-full overflow-hidden bg-transparent select-none">
        <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-6">
          <div data-interactive="true" className="relative max-w-[calc(100vw-24px)]">
            {/* Main Control Bar */}
            <div
              className={cn(
                'relative flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-2xl',
                'border-primary',
              )}
              style={{ WebkitAppRegion: 'drag' }}
            >
              <button
                onClick={() => window.electronAPI.closeWindow()}
                style={{ WebkitAppRegion: 'no-drag' }}
                className="icon-hover absolute -right-2.5 -top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-destructive/30 bg-destructive/90 text-white shadow-lg transition-all hover:scale-110 hover:bg-destructive"
                aria-label="Close Recorder"
                disabled={isRecording || actionInProgress !== 'none'}
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Source Toggle */}
              <div
                className="flex items-center rounded-lg border border-border/50 bg-muted/45 p-1"
                style={{ WebkitAppRegion: 'no-drag' }}
              >
                <SourceButton
                  icon={<IconSwitch regular={DeviceDesktop} active={source === 'fullscreen'} className="h-4 w-4" />}
                  isActive={source === 'fullscreen'}
                  onClick={() => setSource('fullscreen')}
                  tooltip="Full Screen"
                  disabled={isRecording || actionInProgress !== 'none'}
                />
                <SourceButton
                  icon={<IconSwitch regular={Marquee2} active={source === 'area'} className="h-4 w-4" />}
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
                  onOpenChange={handleToolbarSelectOpenChange('display')}
                  disabled={source !== 'fullscreen' || isRecording || actionInProgress !== 'none'}
                >
                  <SelectTrigger
                    variant="minimal"
                    className="w-auto min-w-[120px] max-w-[150px] h-9"
                    aria-label="Select display"
                  >
                    <SelectValue asChild>
                      <div className="flex items-center gap-2 text-xs">
                        <IconShell active className="h-6 w-6 shrink-0">
                          <DeviceDesktop size={14} />
                        </IconShell>
                        <span className="truncate">
                          {truncateRecorderLabel(displays.find((d) => String(d.id) === selectedDisplayId)?.name || '...')}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent side="bottom" avoidCollisions={false}>
                    {displays.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {truncateRecorderLabel(d.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={selectedWebcamId}
                  onValueChange={handleSelectionChange(setSelectedWebcamId, 'recorder.selectedWebcamId')}
                  onOpenChange={handleToolbarSelectOpenChange('webcam')}
                  disabled={isRecording || actionInProgress !== 'none'}
                >
                  <SelectTrigger
                    variant="minimal"
                    className="w-auto min-w-[120px] max-w-[150px] h-9"
                    aria-label="Select webcam"
                  >
                    <SelectValue asChild>
                      <div className="flex items-center gap-2 text-xs">
                        <IconShell
                          active={selectedWebcamId !== 'none'}
                          disabled={selectedWebcamId === 'none'}
                          className="h-6 w-6 shrink-0"
                        >
                          {selectedWebcamId !== 'none' ? (
                            <IconSwitch
                              regular={DeviceComputerCamera}
                              solid={CameraSolid}
                              active
                              className="h-3.5 w-3.5"
                            />
                          ) : (
                            <DeviceComputerCameraOff size={14} className="text-muted-foreground/70" />
                          )}
                        </IconShell>
                        <span className={cn('truncate', selectedWebcamId === 'none' && 'text-muted-foreground')}>
                          {truncateRecorderLabel(webcams.find((w) => w.id === selectedWebcamId)?.name || 'No webcam')}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent side="bottom" avoidCollisions={false}>
                    <SelectItem value="none">No webcam</SelectItem>
                    {webcams.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {truncateRecorderLabel(c.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={selectedMicId}
                  onValueChange={handleSelectionChange(setSelectedMicId, 'recorder.selectedMicId')}
                  onOpenChange={handleToolbarSelectOpenChange('mic')}
                  disabled={isRecording || actionInProgress !== 'none'}
                >
                  <SelectTrigger
                    variant="minimal"
                    className="w-auto min-w-[120px] max-w-[150px] h-9"
                    aria-label="Select microphone"
                  >
                    <SelectValue asChild>
                      <div className="flex items-center gap-2 text-xs">
                        <IconShell
                          active={selectedMicId !== 'none'}
                          disabled={selectedMicId === 'none'}
                          className="h-6 w-6 shrink-0"
                        >
                          {selectedMicId !== 'none' ? (
                            <IconSwitch regular={Microphone} solid={MicrophoneSolid} active className="h-3.5 w-3.5" />
                          ) : (
                            <MicrophoneOff size={14} className="text-muted-foreground/70" />
                          )}
                        </IconShell>
                        <span className={cn('truncate', selectedMicId === 'none' && 'text-muted-foreground')}>
                          {truncateRecorderLabel(mics.find((m) => m.id === selectedMicId)?.name || 'No microphone')}
                        </span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent side="bottom" avoidCollisions={false}>
                    <SelectItem value="none">No microphone</SelectItem>
                    {mics.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {truncateRecorderLabel(m.name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="w-px h-8 bg-border/50"></div>
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
                          className="icon-hover h-10 w-10 rounded-md shadow-lg"
                        >
                          <Square size={16} fill="currentColor" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        sideOffset={12}
                        className="px-3 py-1.5 text-xs font-medium rounded-md"
                      >
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
                          className="icon-hover h-10 w-10 rounded-md shadow-lg"
                        >
                          <Video size={18} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        sideOffset={12}
                        className="px-3 py-1.5 text-xs font-medium rounded-md"
                      >
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
                        className="icon-hover h-10 w-10 rounded-md shadow-lg"
                      >
                        <Folder size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={12}
                      className="px-3 py-1.5 text-xs font-medium rounded-md"
                    >
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
                        className="icon-hover h-10 w-10 rounded-md shadow-lg"
                      >
                        <FileImport size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={12}
                      className="px-3 py-1.5 text-xs font-medium rounded-md"
                    >
                      Import Project
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={handleOpenSettings}
                        disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                        variant="secondary"
                        size="icon"
                        className="icon-hover h-10 w-10 rounded-md shadow-lg"
                      >
                        <Settings size={18} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={12}
                      className="px-3 py-1.5 text-xs font-medium rounded-md"
                    >
                      Settings
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          void handleOpenAccount()
                        }}
                        disabled={isInitializing || actionInProgress !== 'none' || isRecording}
                        variant="secondary"
                        size="icon"
                        className="icon-hover h-10 w-10 cursor-pointer overflow-hidden rounded-xl border-2 border-emerald-500 bg-background p-0 shadow-lg hover:bg-background"
                      >
                        {authSession.user?.picture ? (
                          <img
                            src={authSession.user.picture}
                            alt={accountTooltip}
                            referrerPolicy="no-referrer"
                            className="h-full w-full rounded-[inherit] object-cover"
                          />
                        ) : (
                          <UserCircle size={20} className="text-muted-foreground" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={12}
                      className="px-3 py-1.5 text-xs font-medium rounded-md"
                    >
                      {accountTooltip}
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
            {isWebcamPreviewVisible && (
              <div className="mx-auto mt-4 aspect-square w-48 overflow-hidden rounded-lg bg-black shadow-xl">
                <video ref={webcamPreviewRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              </div>
            )}
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
        defaultTab={settingsDefaultTab}
      />
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
      'icon-hover flex h-10 w-10 items-center justify-center rounded-md transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isActive
        ? 'bg-background text-primary shadow-sm'
        : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
    )}
    title={tooltip}
    {...props}
  >
    <span className="flex h-8 w-8 items-center justify-center">{icon}</span>
  </button>
)
