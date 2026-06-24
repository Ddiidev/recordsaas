/* eslint-disable @typescript-eslint/no-explicit-any */
// Contains core business logic for recording, stopping, and cleanup.

import log from 'electron-log/main'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { constants as osConstants, cpus, setPriority } from 'node:os'
import { app, Menu, Tray, nativeImage, screen, ipcMain, dialog, systemPreferences, type Display } from 'electron'
import Store from 'electron-store'
import { appState } from '../state'
import { getFFmpegPath, ensureDirectoryExists, getFFmpegSpawnErrorMessage, getBinaryPath } from '../lib/utils'
import { VITE_PUBLIC } from '../lib/constants'
import { normalizeMediaPath, toMediaUrl } from '../lib/media-url'
import { createMouseTracker } from './mouse-tracker'
import { getCursorScale, restoreOriginalCursorScale, resetCursorScale } from './cursor-manager'
import { createEditorWindow, cleanupEditorFiles } from '../windows/editor-window'
import { createSavingWindow, createSelectionWindow } from '../windows/temporary-windows'
import type { RecordingSession, RecordingGeometry } from '../state'
import type { ScreenEncoderStatus } from '../../../src/types/screen-encoder'
import {
  getWindowsPhysicalAreaRect,
  getWindowsPhysicalDisplayRect,
  getWindowsScreenCaptureCandidates,
  selectWindowsScreenCaptureCandidate,
  PhysicalCaptureRect,
} from './windows-screen-capture'
import { getScreenEncoderDefinition, getScreenEncoderStatus } from './screen-encoder'

const FFMPEG_PATH = getFFmpegPath()
const WINDOWS_SYSTEM_AUDIO_HELPER_PATH = process.platform === 'win32' ? getBinaryPath('recordsaas-system-audio.exe') : ''
const store = new Store()

const getFFmpegVersionLine = (): string | undefined => {
  const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-version'], {
    encoding: 'utf-8',
    timeout: 4000,
  })

  if (result.error || result.status !== 0) return undefined
  return (result.stdout || result.stderr)
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim()
}

type ImportedProjectPayload = {
  videoPath?: string | null
  metadataPath?: string | null
  webcamVideoPath?: string | null
  audioPath?: string | null
  systemAudioPath?: string | null
  timelineLanes?: Array<{
    id?: string
    name?: string
    order?: number
    visible?: boolean
    locked?: boolean
  }>
  mediaAudioClip?: {
    id?: string
    path?: string | null
    url?: string | null
    name?: string | null
    duration?: number
    startTime?: number
  } | null
  mediaAudioRegions?: Record<
    string,
    {
      id?: string
      type?: 'media-audio'
      laneId?: string
      startTime?: number
      duration?: number
      sourceStart?: number
      isMuted?: boolean
      volume?: number
      fadeInDuration?: number
      fadeOutDuration?: number
      zIndex?: number
    }
  >
  changeSoundRegions?: Record<
    string,
    {
      id?: string
      type?: 'change-sound'
      laneId?: string
      startTime?: number
      duration?: number
      sourceKey?: 'recording-mic'
      isMuted?: boolean
      volume?: number
      fadeInDuration?: number
      fadeOutDuration?: number
      zIndex?: number
    }
  >
  recordingGeometry?: RecordingGeometry
  geometry?: RecordingGeometry
  scaleFactor?: number
  events?: any[]
  metadata?: any[]
  cursorImages?: Record<string, any>
  platform?: NodeJS.Platform
  screenSize?: { width: number; height: number } | null
  syncOffset?: number
  [key: string]: any
}

type RuntimeProjectMetadata = ImportedProjectPayload & {
  platform: NodeJS.Platform
  events: any[]
  cursorImages: Record<string, any>
  geometry: RecordingGeometry
  recordingGeometry: RecordingGeometry
  syncOffset: number
}

type RecordingResolution = 'native' | 'sd' | 'hd' | 'full-hd' | '2k'
type RecordingScreenFps = 30 | 60 | 120
type RecordingWebcamFps = 'synced' | 30 | 60
type RecordingAudioCodec = 'aac' | 'mp3'
type RecordingAudioBitrateKbps = 128 | 192 | 320
type RecordingAudioSampleRate = 44100 | 48000
type RecordingProcessPriority = 'low' | 'normal' | 'high'
type RecordingProcessPriorityMode = RecordingProcessPriority | 'advanced'
type RecordingProcessPriorityKey = 'main' | 'webcam' | 'systemAudio'
type RecordingProcessPriorities = Record<RecordingProcessPriorityKey, RecordingProcessPriority>
type RecordingProfile = {
  id?: string
  name?: string
  isNative?: boolean
  screenResolution?: RecordingResolution
  screenFps?: RecordingScreenFps
  webcamResolution?: RecordingResolution
  webcamFps?: RecordingWebcamFps
  audioCodec?: RecordingAudioCodec
  audioBitrateKbps?: RecordingAudioBitrateKbps
  audioSampleRate?: RecordingAudioSampleRate
}
type RecordingProfileRuntime = {
  isNative: boolean
  screenResolution: RecordingResolution
  screenFps: RecordingScreenFps
  webcamResolution: RecordingResolution
  webcamFps: RecordingWebcamFps
  audioCodec: RecordingAudioCodec
  audioBitrateKbps: RecordingAudioBitrateKbps
  audioSampleRate: RecordingAudioSampleRate
}
type RecordingOutputOptions = {
  screenScale?: { width: number; height: number }
  screenFps?: RecordingScreenFps
  screenNeedsHwDownload?: boolean
  screenCaptureBackend?: string
  screenEncoderStatus?: ScreenEncoderStatus
  screenCaptureDisplay?: any
}
type FfmpegProcessRole = 'main' | 'webcam' | 'system-audio'
type ComputerAudioBackend = 'windows-helper' | 'pulse'
type FfmpegProcessSpec = {
  role: FfmpegProcessRole
  args: string[]
}
type WindowsSystemAudioProbe = {
  id?: string
  deviceName: string
  sampleRate: number
  channels: number
  bitsPerSample: number
  encoding: string
  sampleFormat?: 's16le' | 's24le' | 's32le' | 'f32le' | 'f64le'
}

type WindowsAudioDevice = {
  id: string
  name: string
  isDefault: boolean
  sampleRate: number
  channels: number
  bitsPerSample: number
  sampleFormat: string
}
type SplitRecordingInputArgs = {
  micInputArgs: string[]
  webcamInputArgs: string[]
  screenInputArgs: string[]
}

type RecordingCapabilityProbeBackend = 'gfxcapture' | 'gdigrab' | 'x11grab' | 'ddagrab'
type RecordingCapabilityProbeResult = {
  backend: RecordingCapabilityProbeBackend
  ok: boolean
  stderr: string
  measuredFps: number | null
}
type WebcamInputContext = {
  screenWidth?: number
  screenHeight?: number
}
type WebcamInputOptions = {
  fps: 30 | 60
  size?: { width: number; height: number }
}
const DEFAULT_TIMELINE_LANE_ID = 'lane-1'
const DEFAULT_TIMELINE_LANE_NAME = 'Lane 1'
const LINUX_MIC_PROBE_DURATION_SECONDS = '0.15'
const LINUX_WEBCAM_PROBE_DURATION_SECONDS = '0.15'
const LINUX_WEBCAM_RELEASE_PROBE_TIMEOUT_MS = 5000
const LINUX_WEBCAM_RELEASE_PROBE_INTERVAL_MS = 150
const FFMPEG_STOP_GRACE_PERIOD_MS = 2000
const FFMPEG_STOP_FORCE_PERIOD_MS = 4500
const FFMPEG_STOP_RESOLVE_PERIOD_MS = 5500
const FFMPEG_STARTUP_TIMEOUT_MS = 10000
const WEBCAM_RELEASE_REQUEST_TIMEOUT_MS = 3000
const RECORDING_CAPABILITY_PROBE_SECONDS = 5
const RECORDING_CAPABILITY_PROBE_TIMEOUT_MS = 8000
const RECORDING_PROCESS_PRIORITY_SETTING_KEY = 'general.recordingProcessPriority'
const RECORDING_PROCESS_PRIORITIES_SETTING_KEY = 'general.recordingProcessPriorities'
const DEFAULT_RECORDING_PROCESS_PRIORITY: RecordingProcessPriority = 'normal'
const DEFAULT_RECORDING_PROCESS_PRIORITY_MODE: RecordingProcessPriorityMode = 'normal'
const DEFAULT_RECORDING_PROCESS_PRIORITIES: RecordingProcessPriorities = {
  main: DEFAULT_RECORDING_PROCESS_PRIORITY,
  webcam: DEFAULT_RECORDING_PROCESS_PRIORITY,
  systemAudio: DEFAULT_RECORDING_PROCESS_PRIORITY,
}
const FFMPEG_ROLE_PRIORITY_KEYS: Record<FfmpegProcessRole, RecordingProcessPriorityKey> = {
  main: 'main',
  webcam: 'webcam',
  'system-audio': 'systemAudio',
}
const ffmpegDemuxerAvailability: Partial<Record<ComputerAudioBackend, boolean | null>> = {
  pulse: null,
}
const WIN32_DSHOW_WEBCAM_THREAD_QUEUE_SIZE = '1024'
const WIN32_DSHOW_WEBCAM_RTBUF_SIZE = '512M'
const WEBCAM_RECORDING_ENCODING_CONFIG = {
  codec: 'libx264',
  preset: 'ultrafast',
  crf: '30',
  maxrate: '2500k',
  bufsize: '5000k',
  pixFmt: 'yuv420p',
}
const RECORDING_RESOLUTION_HEIGHTS: Record<Exclude<RecordingResolution, 'native'>, number> = {
  sd: 480,
  hd: 720,
  'full-hd': 1080,
  '2k': 1440,
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isRecordingProcessPriority = (value: unknown): value is RecordingProcessPriority =>
  value === 'low' || value === 'normal' || value === 'high'

const normalizeRecordingProcessPriority = (value: unknown): RecordingProcessPriority => {
  if (isRecordingProcessPriority(value)) return value
  return DEFAULT_RECORDING_PROCESS_PRIORITY
}

const normalizeRecordingProcessPriorityMode = (value: unknown): RecordingProcessPriorityMode => {
  if (value === 'low' || value === 'normal' || value === 'high') return value
  if (value === 'advanced') return value
  return DEFAULT_RECORDING_PROCESS_PRIORITY_MODE
}

const normalizeRecordingProcessPriorities = (value: unknown): RecordingProcessPriorities => {
  const source = value && typeof value === 'object' ? (value as Partial<RecordingProcessPriorities>) : {}
  return {
    main: normalizeRecordingProcessPriority(source.main),
    webcam: normalizeRecordingProcessPriority(source.webcam),
    systemAudio: normalizeRecordingProcessPriority(source.systemAudio),
  }
}

const getRecordingProcessPriorityCandidates = (priority: RecordingProcessPriority): number[] => {
  if (process.platform === 'win32') {
    if (priority === 'low') return [osConstants.priority.PRIORITY_LOW]
    if (priority === 'high') return [osConstants.priority.PRIORITY_ABOVE_NORMAL, osConstants.priority.PRIORITY_NORMAL]
    return [osConstants.priority.PRIORITY_BELOW_NORMAL, osConstants.priority.PRIORITY_NORMAL]
  }

  if (priority === 'low') return [10]
  if (priority === 'high') return [-5, 0]
  return [5, 0]
}

const applyRecordingProcessPriority = (
  childProcess: ChildProcessWithoutNullStreams,
  priority: RecordingProcessPriority,
  label: string,
) => {
  if (!childProcess.pid) return

  for (const candidate of getRecordingProcessPriorityCandidates(priority)) {
    try {
      setPriority(childProcess.pid, candidate)
      log.info(
        `[RecordingManager] Recording process priority applied: label=${label} pid=${childProcess.pid} mode=${priority} priority=${candidate}`,
      )
      return
    } catch (error) {
      log.warn(
        `[RecordingManager] Failed to set recording process priority: label=${label} pid=${childProcess.pid} mode=${priority} priority=${candidate}`,
        error,
      )
    }
  }
}

const resolveRecordingProcessPriority = (
  role: FfmpegProcessRole,
  mode: RecordingProcessPriorityMode,
  priorities: RecordingProcessPriorities,
): RecordingProcessPriority => {
  if (mode !== 'advanced') return mode
  return priorities[FFMPEG_ROLE_PRIORITY_KEYS[role]] || DEFAULT_RECORDING_PROCESS_PRIORITY
}

const getRecordingRootDir = () => path.join(process.env.HOME || process.env.USERPROFILE || '.', '.recordsaas')

const formatRecordingSessionFolderName = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23)
  return `recording-${timestamp}`
}

const createRecordingSessionDir = async (): Promise<string> => {
  const recordingRoot = getRecordingRootDir()
  await ensureDirectoryExists(recordingRoot)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const recordingDir = path.join(recordingRoot, `${formatRecordingSessionFolderName()}${suffix}`)
    try {
      await fsPromises.mkdir(recordingDir, { recursive: false })
      return recordingDir
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  const fallbackDir = path.join(recordingRoot, `recording-${Date.now()}`)
  await ensureDirectoryExists(fallbackDir)
  return fallbackDir
}

const normalizeRecordingFps = (value: unknown, fallback: RecordingScreenFps): RecordingScreenFps => {
  if (value === 30 || value === 60 || value === 120) return value
  return fallback
}

const normalizeWebcamFps = (value: unknown, fallback: RecordingWebcamFps): RecordingWebcamFps => {
  if (value === 'synced' || value === 30 || value === 60) return value
  return fallback
}

const normalizeRecordingAudioCodec = (value: unknown, fallback: RecordingAudioCodec): RecordingAudioCodec => {
  if (value === 'aac' || value === 'mp3') return value
  return fallback
}

const normalizeRecordingAudioBitrate = (
  value: unknown,
  fallback: RecordingAudioBitrateKbps,
): RecordingAudioBitrateKbps => {
  if (value === 128 || value === 192 || value === 320) return value
  return fallback
}

const normalizeRecordingAudioSampleRate = (
  value: unknown,
  fallback: RecordingAudioSampleRate,
): RecordingAudioSampleRate => {
  if (value === 44100 || value === 48000) return value
  return fallback
}

const normalizeRecordingResolution = (value: unknown, fallback: RecordingResolution): RecordingResolution => {
  if (value === 'native' || value === 'sd' || value === 'hd' || value === 'full-hd' || value === '2k') return value
  return fallback
}

const normalizeRecordingProfile = (value: RecordingProfile | null | undefined): RecordingProfileRuntime => {
  const isNative = value?.isNative === true || value?.id === 'native-adaptive'
  if (isNative) {
    return {
      isNative: true,
      screenResolution: 'native',
      screenFps: normalizeRecordingFps(value?.screenFps, 30),
      webcamResolution: 'native',
      webcamFps: 30,
      audioCodec: normalizeRecordingAudioCodec(value?.audioCodec, 'aac'),
      audioBitrateKbps: normalizeRecordingAudioBitrate(value?.audioBitrateKbps, 192),
      audioSampleRate: normalizeRecordingAudioSampleRate(value?.audioSampleRate, 48000),
    }
  }

  return {
    isNative: false,
    screenResolution: normalizeRecordingResolution(value?.screenResolution, 'native'),
    screenFps: normalizeRecordingFps(value?.screenFps, 30),
    webcamResolution: normalizeRecordingResolution(value?.webcamResolution, 'native'),
    webcamFps: normalizeWebcamFps(value?.webcamFps, 'synced'),
    audioCodec: normalizeRecordingAudioCodec(value?.audioCodec, 'aac'),
    audioBitrateKbps: normalizeRecordingAudioBitrate(value?.audioBitrateKbps, 192),
    audioSampleRate: normalizeRecordingAudioSampleRate(value?.audioSampleRate, 48000),
  }
}

const resolveScaledDimensions = (
  width: number,
  height: number,
  resolution: RecordingResolution,
): { width: number; height: number } | null => {
  if (resolution === 'native') return null
  const targetHeight = RECORDING_RESOLUTION_HEIGHTS[resolution]
  if (!targetHeight || height <= 0 || width <= 0) return null
  const targetWidth = Math.max(2, Math.round((targetHeight * width) / height / 2) * 2)
  return { width: targetWidth, height: targetHeight % 2 === 0 ? targetHeight : targetHeight + 1 }
}

const resolveWebcamFps = (profile: RecordingProfileRuntime): 30 | 60 => {
  if (profile.webcamFps === 'synced') return Math.min(profile.screenFps, 60) as 30 | 60
  return profile.webcamFps
}

const resolveDesiredWebcamSize = (
  profile: RecordingProfileRuntime,
  context: WebcamInputContext = {},
): { width: number; height: number } | undefined => {
  const webcamSize =
    profile.isNative && context.screenWidth && context.screenHeight
      ? { width: context.screenWidth, height: context.screenHeight }
      : resolveScaledDimensions(16, 9, profile.webcamResolution)

  return webcamSize || undefined
}

const appendWebcamInputOptions = (args: string[], options: WebcamInputOptions) => {
  args.push('-framerate', String(options.fps))
  if (options.size) {
    args.push('-video_size', `${options.size.width}x${options.size.height}`)
  }
}

const appendWin32DshowWebcamBufferOptions = (args: string[]) => {
  args.push('-thread_queue_size', WIN32_DSHOW_WEBCAM_THREAD_QUEUE_SIZE, '-rtbufsize', WIN32_DSHOW_WEBCAM_RTBUF_SIZE)
}

const isSameWebcamSize = (
  left: { width: number; height: number } | undefined,
  right: { width: number; height: number } | undefined,
) => left?.width === right?.width && left?.height === right?.height

const getWin32WebcamFallbackSizes = (
  desiredSize: { width: number; height: number } | undefined,
): Array<{ width: number; height: number } | undefined> => {
  const candidates: Array<{ width: number; height: number } | undefined> = []
  const pushUnique = (size: { width: number; height: number } | undefined) => {
    if (candidates.some((candidate) => isSameWebcamSize(candidate, size))) return
    candidates.push(size)
  }

  pushUnique(desiredSize)
  pushUnique({ width: 1920, height: 1080 })
  pushUnique({ width: 1280, height: 720 })
  pushUnique({ width: 640, height: 480 })
  pushUnique(undefined)

  return candidates
}

const getWin32WebcamFallbackFps = (desiredFps: 30 | 60): Array<30 | 60> => (desiredFps === 60 ? [60, 30] : [30])

const probeWin32DshowWebcamInput = (
  deviceLabel: string,
  fps: 30 | 60,
  size: { width: number; height: number } | undefined,
): Promise<boolean> =>
  new Promise((resolve) => {
    const args = ['-hide_banner', '-f', 'dshow']
    appendWin32DshowWebcamBufferOptions(args)
    args.push('-framerate', String(fps))
    if (size) {
      args.push('-video_size', `${size.width}x${size.height}`)
    }
    args.push('-t', '0.2', '-i', `video=${deviceLabel}`, '-f', 'null', '-')

    const probe = spawn(FFMPEG_PATH, args, { windowsHide: true })
    let settled = false

    const settle = (result: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve(result)
    }

    const timeoutId = setTimeout(() => {
      try {
        probe.kill('SIGKILL')
      } catch {
        // ignore probe cleanup errors
      }
      settle(false)
    }, 3000)

    probe.once('error', () => settle(false))
    probe.once('exit', (code) => settle(code === 0))
  })

const resolveWebcamInputOptions = async (
  profile: RecordingProfileRuntime,
  context: WebcamInputContext,
  webcam: { deviceLabel: string },
): Promise<WebcamInputOptions> => {
  const fps = resolveWebcamFps(profile)
  const desiredSize = resolveDesiredWebcamSize(profile, context)

  if (process.platform !== 'win32') {
    return { fps, size: desiredSize }
  }

  for (const candidateFps of getWin32WebcamFallbackFps(fps)) {
    for (const candidateSize of getWin32WebcamFallbackSizes(desiredSize)) {
      const canOpen = await probeWin32DshowWebcamInput(webcam.deviceLabel, candidateFps, candidateSize)
      if (canOpen) {
        if (candidateFps !== fps) {
          log.warn(`[RecordingManager] Webcam rejected requested ${fps}fps; using ${candidateFps}fps instead.`)
        }
        if (!isSameWebcamSize(candidateSize, desiredSize)) {
          log.warn(
            `[RecordingManager] Webcam rejected requested capture size ${desiredSize ? `${desiredSize.width}x${desiredSize.height}` : 'native/default'}; using ${
              candidateSize ? `${candidateSize.width}x${candidateSize.height}` : 'device default'
            } instead.`,
          )
        }
        return { fps: candidateFps, size: candidateSize }
      }
    }
  }

  const fallbackFps = fps === 60 ? 30 : fps
  log.warn(
    `[RecordingManager] Webcam probe failed for all explicit FPS/size combinations; falling back to DShow device default at ${fallbackFps}fps.`,
  )
  return { fps: fallbackFps }
}

const parseProbeTimeSeconds = (value: string): number | null => {
  const match = value.match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (![hours, minutes, seconds].every(Number.isFinite)) return null
  return hours * 3600 + minutes * 60 + seconds
}

const parseRecordingCapabilityProbeFps = (stderr: string): number | null => {
  const fpsValues = Array.from(stderr.matchAll(/fps=\s*([0-9.]+)/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
  const lastReportedFps = fpsValues.length > 0 ? fpsValues[fpsValues.length - 1] : null
  const progressMatches = Array.from(stderr.matchAll(/frame=\s*(\d+).*?time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/g))
  const lastProgress = progressMatches.length > 0 ? progressMatches[progressMatches.length - 1] : null
  const frameCount = lastProgress ? Number(lastProgress[1]) : null
  const durationSeconds = lastProgress ? parseProbeTimeSeconds(lastProgress[2]) : null
  const frameDerivedFps = frameCount && durationSeconds && durationSeconds > 0 ? frameCount / durationSeconds : null

  if (frameDerivedFps && lastReportedFps) return Math.max(frameDerivedFps, lastReportedFps)
  return frameDerivedFps || lastReportedFps
}

const runRecordingCapabilityProbe = async (
  backend: RecordingCapabilityProbeBackend,
  args: string[],
): Promise<RecordingCapabilityProbeResult> =>
  await new Promise((resolve) => {
    let stderr = ''
    let settled = false
    const probe = spawn(FFMPEG_PATH, args)
    const timeout = setTimeout(() => {
      if (!probe.killed) probe.kill('SIGKILL')
    }, RECORDING_CAPABILITY_PROBE_TIMEOUT_MS)

    const settle = (result: RecordingCapabilityProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    probe.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    probe.on('error', (error) => {
      log.warn(`[RecordingManager] ${backend} recording capability probe failed:`, error)
      settle({ backend, ok: false, stderr, measuredFps: null })
    })
    probe.on('close', (code) => {
      const measuredFps = parseRecordingCapabilityProbeFps(stderr)
      settle({ backend, ok: code === 0 && Boolean(measuredFps), stderr, measuredFps })
    })
  })

function shouldApplyLinuxDisplayScale(scaleFactor: number): boolean {
  return (
    process.platform === 'linux' && Number.isFinite(scaleFactor) && scaleFactor > 0 && Math.abs(scaleFactor - 1) > 0.001
  )
}

function getLinuxScaledDimension(value: number, scaleFactor: number): number {
  if (!shouldApplyLinuxDisplayScale(scaleFactor)) {
    return Math.floor(value / 2) * 2
  }

  return Math.max(2, Math.floor((value * scaleFactor) / 2) * 2)
}

function getLinuxScaledOffset(value: number, scaleFactor: number): number {
  if (!shouldApplyLinuxDisplayScale(scaleFactor)) {
    return value
  }

  return Math.floor(value * scaleFactor)
}

function toEvenPhysicalDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2)
}

function getPlatformPhysicalDimension(value: number, scaleFactor: number): number {
  if (process.platform === 'win32') {
    return toEvenPhysicalDimension(value * scaleFactor)
  }
  if (process.platform === 'linux') {
    return getLinuxScaledDimension(value, scaleFactor)
  }
  return Math.floor(value / 2) * 2
}

function getPlatformPhysicalOffset(value: number, scaleFactor: number): number {
  if (process.platform === 'win32') {
    return Math.floor(value * scaleFactor)
  }
  if (process.platform === 'linux') {
    return getLinuxScaledOffset(value, scaleFactor)
  }
  return value
}

function getWindowsDdagrabDisplayRect(display: Display): PhysicalCaptureRect {
  const rect = getWindowsPhysicalDisplayRect(display)
  return {
    ...rect,
    x: 0,
    y: 0,
  }
}

function getWindowsDdagrabAreaRect(geometry: RecordingGeometry, containingDisplay: Display): PhysicalCaptureRect {
  const scaleFactor = containingDisplay.scaleFactor || 1
  const displayRect = getWindowsPhysicalDisplayRect(containingDisplay)
  const relativeX = Math.floor((geometry.x - containingDisplay.bounds.x) * scaleFactor)
  const relativeY = Math.floor((geometry.y - containingDisplay.bounds.y) * scaleFactor)
  const x = Math.max(0, relativeX)
  const y = Math.max(0, relativeY)
  const maxWidth = Math.max(2, displayRect.width - x)
  const maxHeight = Math.max(2, displayRect.height - y)

  return {
    x,
    y,
    width: Math.min(toEvenPhysicalDimension(geometry.width * scaleFactor), maxWidth),
    height: Math.min(toEvenPhysicalDimension(geometry.height * scaleFactor), maxHeight),
  }
}
function isFFmpegRecordingReadyMessage(message: string): boolean {
  return message.includes('Press [q] to stop') || message.includes('Output #0,') || message.includes('frame=')
}

function hasFFmpegDemuxer(demuxer: 'pulse'): boolean {
  const cachedValue = ffmpegDemuxerAvailability[demuxer]
  if (cachedValue !== null && cachedValue !== undefined) {
    return cachedValue
  }

  const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-h', `demuxer=${demuxer}`], {
    encoding: 'utf-8',
    timeout: 4000,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  const isAvailable = result.status === 0 && !output.includes(`Unknown format '${demuxer}'`)
  ffmpegDemuxerAvailability[demuxer] = isAvailable
  return isAvailable
}

function normalizeWindowsSystemAudioSampleFormat(
  probe: WindowsSystemAudioProbe,
): 's16le' | 's24le' | 's32le' | 'f32le' | 'f64le' {
  const sampleFormat = probe.sampleFormat?.toLowerCase()
  if (
    sampleFormat === 's16le' ||
    sampleFormat === 's24le' ||
    sampleFormat === 's32le' ||
    sampleFormat === 'f32le' ||
    sampleFormat === 'f64le'
  ) {
    return sampleFormat
  }

  const encoding = probe.encoding.toLowerCase()
  if (encoding.includes('float')) {
    return probe.bitsPerSample >= 64 ? 'f64le' : 'f32le'
  }

  switch (probe.bitsPerSample) {
    case 24:
      return 's24le'
    case 32:
      return 's32le'
    default:
      return 's16le'
  }
}

function probeWindowsSystemAudioHelper(deviceId?: string):
  | { supported: true; probe: WindowsSystemAudioProbe }
  | { supported: false; reason?: string } {
  const probeArgs = deviceId ? ['--probe', '--device-id', deviceId] : ['--probe']
  const result = spawnSync(WINDOWS_SYSTEM_AUDIO_HELPER_PATH, probeArgs, {
    encoding: 'utf-8',
    timeout: 4000,
    windowsHide: true,
  })

  if (result.error) {
    return {
      supported: false,
      reason: `Windows system-audio helper is unavailable: ${result.error.message}`,
    }
  }

  if (result.status !== 0) {
    return {
      supported: false,
      reason:
        (result.stderr || result.stdout || `Windows system-audio helper exited with code ${result.status}`).trim(),
    }
  }

  try {
    const probe = JSON.parse((result.stdout || result.stderr || '').trim()) as WindowsSystemAudioProbe
    if (
      typeof probe.deviceName !== 'string' ||
      typeof probe.sampleRate !== 'number' ||
      typeof probe.channels !== 'number' ||
      typeof probe.bitsPerSample !== 'number' ||
      typeof probe.encoding !== 'string'
    ) {
      throw new Error('Probe did not include a usable PCM format.')
    }

    return {
      supported: true,
      probe: {
        ...probe,
        sampleFormat: normalizeWindowsSystemAudioSampleFormat(probe),
      },
    }
  } catch (error) {
    return {
      supported: false,
      reason: `Could not parse Windows system-audio helper probe: ${(error as Error).message}`,
    }
  }
}

export function listWindowsAudioDevices(): WindowsAudioDevice[] {
  if (process.platform !== 'win32') return []
  const result = spawnSync(WINDOWS_SYSTEM_AUDIO_HELPER_PATH, ['--probe-all'], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    log.warn('[SystemAudio] probe-all failed:', result.error?.message || result.stderr)
    return []
  }
  try {
    return JSON.parse((result.stdout || '').trim()) as WindowsAudioDevice[]
  } catch {
    return []
  }
}

function probeLinuxPulseSource(sourceName: string): boolean {
  const result = spawnSync(
    FFMPEG_PATH,
    ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'pulse', '-i', sourceName, '-t', '0.2', '-f', 'null', '-'],
    {
      encoding: 'utf-8',
      timeout: 4000,
    },
  )

  if (result.error) {
    log.warn(`[LinuxAudio] Pulse probe failed for source "${sourceName}":`, result.error)
    return false
  }

  if (result.status === 0) {
    log.info(`[LinuxAudio] Using PulseAudio source "${sourceName}" for computer audio capture.`)
    return true
  }

  const detail = (result.stderr || result.stdout || `exit code ${result.status}`).trim()
  log.warn(`[LinuxAudio] Pulse source "${sourceName}" is unavailable: ${detail}`)
  return false
}

function resolveLinuxSystemAudioSource(): string | null {
  const sourceList = spawnSync('pactl', ['list', 'short', 'sources'], {
    encoding: 'utf-8',
    timeout: 4000,
  })
  if (sourceList.error || sourceList.status !== 0) {
    log.warn('[LinuxAudio] Failed to list PulseAudio sources through pactl:', sourceList.error || sourceList.stderr || sourceList.stdout)
    return null
  }

  const pactlResult = spawnSync('pactl', ['get-default-sink'], {
    encoding: 'utf-8',
    timeout: 4000,
  })
  const defaultSink = pactlResult.status === 0 ? (pactlResult.stdout || '').trim() : ''
  if (pactlResult.error || pactlResult.status !== 0) {
    log.warn('[LinuxAudio] Could not resolve default PulseAudio sink:', pactlResult.error || pactlResult.stderr || pactlResult.stdout)
  }

  const sourceNames = (sourceList.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(/\s+/)[1])
    .filter((name): name is string => Boolean(name))

  const monitorSources = sourceNames.filter((name) => name.endsWith('.monitor'))
  const preferredMonitor = defaultSink ? `${defaultSink}.monitor` : null
  const selectedSource =
    (preferredMonitor && monitorSources.find((name) => name === preferredMonitor)) ||
    monitorSources[0] ||
    null

  if (!selectedSource) {
    log.warn('[LinuxAudio] No PulseAudio monitor source was found for computer audio capture.')
    return null
  }

  return selectedSource
}

type ComputerAudioCaptureConfig =
  | {
      supported: true
      backend: ComputerAudioBackend
      input: string
      inputFormat?: 's16le' | 's24le' | 's32le' | 'f32le' | 'f64le'
      inputSampleRate?: number
      inputChannels?: number
      deviceId?: string
    }
  | {
      supported: false
      backend: ComputerAudioBackend | null
      reason: string
    }

type SupportedComputerAudioCaptureConfig = Extract<ComputerAudioCaptureConfig, { supported: true }>

function resolveComputerAudioCaptureConfig(deviceId?: string): ComputerAudioCaptureConfig {
  if (process.platform === 'win32') {
    const helperProbe = probeWindowsSystemAudioHelper(deviceId)
    if (!helperProbe.supported) {
      return {
        supported: false,
        backend: 'windows-helper',
        reason: helperProbe.reason || `Windows system-audio helper is unavailable: ${WINDOWS_SYSTEM_AUDIO_HELPER_PATH}`,
      }
    }

    return {
      supported: true,
      backend: 'windows-helper',
      input: WINDOWS_SYSTEM_AUDIO_HELPER_PATH,
      inputFormat: helperProbe.probe.sampleFormat,
      inputSampleRate: helperProbe.probe.sampleRate,
      inputChannels: helperProbe.probe.channels,
      deviceId,
    }
  }

  if (process.platform === 'linux') {
    if (!hasFFmpegDemuxer('pulse')) {
      return {
        supported: false,
        backend: 'pulse',
        reason: `Current FFmpeg binary does not support PulseAudio system audio capture: ${FFMPEG_PATH}`,
      }
    }

    const input = resolveLinuxSystemAudioSource()
    if (!input) {
      return {
        supported: false,
        backend: 'pulse',
        reason:
          'No PulseAudio monitor source was found. Start a desktop session with a default output sink or make a monitor source available.',
      }
    }

    if (!probeLinuxPulseSource(input)) {
      return {
        supported: false,
        backend: 'pulse',
        reason: `FFmpeg could not open the PulseAudio monitor source "${input}".`,
      }
    }

    return { supported: true, backend: 'pulse', input }
  }

  return {
    supported: false,
    backend: null,
    reason: 'Computer audio capture is not implemented on macOS yet.',
  }
}

export function getComputerAudioSupport(): { supported: boolean; reason?: string; backend?: ComputerAudioBackend | null } {
  const support = resolveComputerAudioCaptureConfig()
  if (support.supported) {
    return { supported: true, backend: support.backend }
  }

  return { supported: false, backend: support.backend, reason: support.reason }
}

async function requestRecorderWebcamRelease(): Promise<void> {
  const recorderWindow = appState.recorderWin
  if (!recorderWindow || recorderWindow.isDestroyed()) {
    return
  }

  return new Promise((resolve) => {
    let settled = false

    const cleanup = () => {
      ipcMain.removeListener('recorder:webcam-released', handleReleased)
      clearTimeout(timeoutId)
    }

    const resolveOnce = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const handleReleased = () => {
      log.info('[RecordingManager] Recorder window confirmed webcam release.')
      resolveOnce()
    }

    const timeoutId = setTimeout(() => {
      log.warn('[RecordingManager] Timed out waiting for recorder window to release webcam preview.')
      resolveOnce()
    }, WEBCAM_RELEASE_REQUEST_TIMEOUT_MS)

    ipcMain.once('recorder:webcam-released', handleReleased)
    log.info('[RecordingManager] Requesting recorder window to release webcam preview before recording.')
    recorderWindow.webContents.send('recorder:release-webcam')
  })
}

async function listLinuxAlsaCaptureInputs(): Promise<string[]> {
  const candidates = new Set<string>()
  const overrideInput = process.env.RECORDSAAS_LINUX_MIC_INPUT?.trim()

  if (overrideInput) {
    candidates.add(overrideInput)
  }

  try {
    const pcmEntries = await fsPromises.readFile('/proc/asound/pcm', 'utf-8')
    for (const line of pcmEntries.split('\n')) {
      if (!line.includes('capture')) continue

      const match = line.match(/^(\d+)-(\d+):/)
      if (!match) continue

      const [, cardIndex, deviceIndex] = match
      candidates.add(`hw:${cardIndex},${deviceIndex}`)
      candidates.add(`plughw:${cardIndex},${deviceIndex}`)
    }
  } catch (error) {
    log.warn('[LinuxMic] Failed to read /proc/asound/pcm for capture devices:', error)
  }

  ;['default', 'pipewire', 'hw:0,0', 'plughw:0,0'].forEach((candidate) => candidates.add(candidate))

  return Array.from(candidates)
}

function probeLinuxAlsaInput(inputName: string): boolean {
  const probeArgs = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'alsa',
    '-t',
    LINUX_MIC_PROBE_DURATION_SECONDS,
    '-i',
    inputName,
    '-f',
    'null',
    '-',
  ]

  const probeResult = spawnSync(FFMPEG_PATH, probeArgs, {
    encoding: 'utf-8',
    timeout: 4000,
  })

  if (probeResult.error) {
    log.warn(`[LinuxMic] Probe failed for ALSA input "${inputName}":`, probeResult.error)
    return false
  }

  if (probeResult.status === 0) {
    log.info(`[LinuxMic] Using ALSA input "${inputName}" for microphone capture.`)
    return true
  }

  const probeError = probeResult.stderr || probeResult.stdout || `exit code ${probeResult.status}`
  log.warn(`[LinuxMic] ALSA input "${inputName}" is unavailable: ${probeError}`)
  return false
}

async function resolveLinuxMicrophoneInput(): Promise<string | null> {
  const candidates = await listLinuxAlsaCaptureInputs()

  for (const candidate of candidates) {
    if (probeLinuxAlsaInput(candidate)) {
      return candidate
    }
  }

  return null
}

function probeLinuxWebcamInput(devicePath: string): { available: boolean; busy: boolean; detail: string } {
  const probeArgs = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'v4l2',
    '-t',
    LINUX_WEBCAM_PROBE_DURATION_SECONDS,
    '-i',
    devicePath,
    '-f',
    'null',
    '-',
  ]

  const probeResult = spawnSync(FFMPEG_PATH, probeArgs, {
    encoding: 'utf-8',
    timeout: 4000,
  })

  if (probeResult.error) {
    const detail = probeResult.error.message || String(probeResult.error)
    return { available: false, busy: false, detail }
  }

  if (probeResult.status === 0) {
    return { available: true, busy: false, detail: '' }
  }

  const detail = (probeResult.stderr || probeResult.stdout || `exit code ${probeResult.status}`).trim()
  return {
    available: false,
    busy: /Device or resource busy/i.test(detail),
    detail,
  }
}

async function waitForLinuxWebcamRelease(devicePath: string): Promise<{ available: boolean; detail?: string }> {
  const startedAt = Date.now()
  let attempts = 0

  while (Date.now() - startedAt < LINUX_WEBCAM_RELEASE_PROBE_TIMEOUT_MS) {
    attempts += 1
    const probe = probeLinuxWebcamInput(devicePath)

    if (probe.available) {
      log.info(
        `[LinuxWebcam] ${devicePath} became available after ${attempts} attempt(s) in ${Date.now() - startedAt}ms.`,
      )
      return { available: true }
    }

    if (!probe.busy) {
      log.error(`[LinuxWebcam] ${devicePath} probe failed with a non-busy error: ${probe.detail}`)
      return { available: false, detail: probe.detail || `Failed to probe ${devicePath}.` }
    }

    log.warn(`[LinuxWebcam] ${devicePath} is still busy (attempt ${attempts}).`)
    await wait(LINUX_WEBCAM_RELEASE_PROBE_INTERVAL_MS)
  }

  const finalProbe = probeLinuxWebcamInput(devicePath)
  const detail = finalProbe.detail || `${devicePath} remained busy after ${LINUX_WEBCAM_RELEASE_PROBE_TIMEOUT_MS}ms.`
  log.error(`[LinuxWebcam] Timed out waiting for ${devicePath} to become available: ${detail}`)
  return { available: false, detail }
}

function hasOwnField<K extends keyof ImportedProjectPayload>(payload: ImportedProjectPayload, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key)
}

function getProjectFirstField<K extends keyof ImportedProjectPayload>(
  projectData: ImportedProjectPayload,
  canonicalMetadata: ImportedProjectPayload | null,
  key: K,
): ImportedProjectPayload[K] | undefined {
  if (hasOwnField(projectData, key)) {
    return projectData[key]
  }
  return canonicalMetadata?.[key]
}

function normalizeTimelineLanes(
  lanes: ImportedProjectPayload['timelineLanes'],
): NonNullable<ImportedProjectPayload['timelineLanes']> {
  if (!Array.isArray(lanes) || lanes.length === 0) {
    return [
      {
        id: DEFAULT_TIMELINE_LANE_ID,
        name: DEFAULT_TIMELINE_LANE_NAME,
        order: 0,
        visible: true,
        locked: false,
      },
    ]
  }

  return [...lanes]
    .map((lane, index) => ({
      id: typeof lane?.id === 'string' && lane.id.length > 0 ? lane.id : `${DEFAULT_TIMELINE_LANE_ID}-${index + 1}`,
      name:
        typeof lane?.name === 'string' && lane.name.trim().length > 0
          ? lane.name.trim()
          : `${DEFAULT_TIMELINE_LANE_NAME.split(' ')[0]} ${index + 1}`,
      order: typeof lane?.order === 'number' && Number.isFinite(lane.order) ? lane.order : index,
      visible: lane?.visible !== false,
      locked: lane?.locked === true,
    }))
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order))
    .map((lane, index) => ({ ...lane, order: index }))
}

function getFallbackTimelineLaneId(lanes: NonNullable<ImportedProjectPayload['timelineLanes']>): string {
  return lanes[0]?.id || DEFAULT_TIMELINE_LANE_ID
}

function resolveImportedLaneId(
  laneId: string | undefined,
  lanes: NonNullable<ImportedProjectPayload['timelineLanes']>,
  fallbackLaneId: string,
): string {
  if (laneId && lanes.some((lane) => lane.id === laneId)) {
    return laneId
  }
  return fallbackLaneId
}

/**
 * Uses ffprobe to get the precise creation time of the video file.
 * @param videoPath The path to the video file.
 * @returns A promise that resolves to the creation time as a UNIX timestamp (ms).
 */
async function getVideoStartTime(videoPath: string): Promise<number> {
  try {
    const stats = await fsPromises.stat(videoPath)
    return stats.birthtimeMs
  } catch (error) {
    log.error(`[getVideoStartTime] Error getting file stats for ${videoPath}:`, error)
    throw error
  }
}

/**
 * Validates the generated recording files to ensure they exist and are not empty.
 * @param session - The recording session containing file paths to validate.
 * @returns A promise that resolves to true if files are valid, false otherwise.
 */
async function validateRecordingFiles(session: RecordingSession): Promise<boolean> {
  log.info('[Validation] Validating recorded files...')
  const filesToValidate = [session.screenVideoPath]
  if (session.webcamVideoPath) {
    filesToValidate.push(session.webcamVideoPath)
  }
  if (session.audioPath) {
    filesToValidate.push(session.audioPath)
  }
  if (session.systemAudioPath) {
    filesToValidate.push(session.systemAudioPath)
  }
  if (session.mediaAudioPath) {
    filesToValidate.push(session.mediaAudioPath)
  }

  for (const filePath of filesToValidate) {
    try {
      const stats = await fsPromises.stat(filePath)
      if (stats.size === 0) {
        const errorMessage = `The recording produced an empty video file (${path.basename(filePath)}). This could be due to incorrect permissions, lack of disk space, or a hardware issue.`
        log.error(`[Validation] ${errorMessage}`)
        dialog.showErrorBox('Recording Validation Failed', errorMessage)
        return false
      }

      const probe = spawnSync(
        FFMPEG_PATH,
        ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', '0', '-t', '0.1', '-f', 'null', '-'],
        { encoding: 'utf-8', timeout: 15000, windowsHide: true },
      )
      if (probe.error || probe.status !== 0) {
        const detail = (probe.stderr || probe.error?.message || `FFmpeg exited with ${probe.status}`).trim()
        const errorMessage = `The recorded file is structurally invalid: ${path.basename(filePath)}.`
        log.error(`[Validation] ${errorMessage} ${detail}`)
        dialog.showErrorBox('Recording Validation Failed', errorMessage)
        return false
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const errorMessage = `The recording process failed to create the video file: ${path.basename(filePath)}.`
        log.error(`[Validation] ${errorMessage}`)
        dialog.showErrorBox('Recording Validation Failed', errorMessage)
      } else {
        const errorMessage = `Could not access the recorded file (${path.basename(filePath)}). Error: ${(error as Error).message}`
        log.error(`[Validation] ${errorMessage}`, error)
        dialog.showErrorBox('File Error', errorMessage)
      }
      return false
    }
  }

  log.info('[Validation] All recorded files exist, are non-empty, and can be parsed by FFmpeg.')
  return true
}

/**
 * Trims the audio file by removing the specified amount from the beginning.
 * @param audioPath - Path to the audio file to trim
 * @param trimMs - Amount to trim from the beginning in milliseconds (default 1000ms)
 * @returns Promise that resolves to the path of the trimmed audio file
 */
async function trimAudioFile(audioPath: string, trimMs: number = 1000): Promise<string> {
  const ext = path.extname(audioPath) || '.wav'
  const trimmedPath = audioPath.slice(0, -ext.length) + `-trimmed${ext}`
  const trimSeconds = trimMs / 1000

  log.info(`[AudioTrim] Trimming ${trimMs}ms from beginning of ${audioPath}`)

  return new Promise((resolve, reject) => {
    const codecArgs =
      ext.toLowerCase() === '.wav'
        ? ['-c:a', 'pcm_s16le']
        : ['-c:a', 'copy']
    const ffmpegArgs = ['-y', '-ss', trimSeconds.toString(), '-i', audioPath, ...codecArgs, trimmedPath]

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)

    ffmpeg.stderr.on('data', (data: any) => {
      log.info(`[AudioTrim FFmpeg]: ${data.toString()}`)
    })

    ffmpeg.on('close', async (code: any) => {
      if (code === 0) {
        log.info(`[AudioTrim] Successfully trimmed audio, replacing original file`)
        try {
          // Replace original file with trimmed version
          await fsPromises.unlink(audioPath)
          await fsPromises.rename(trimmedPath, audioPath)
          resolve(audioPath)
        } catch (error) {
          log.error(`[AudioTrim] Error replacing audio file:`, error)
          reject(error)
        }
      } else {
        log.error(`[AudioTrim] FFmpeg exited with code ${code}`)
        reject(new Error(`Audio trim failed with code ${code}`))
      }
    })

    ffmpeg.on('error', (error: any) => {
      log.error(`[AudioTrim] FFmpeg error:`, error)
      reject(error)
    })
  })
}

async function finalizeSystemAudioCapture(session: RecordingSession, trimMs: number = 1000): Promise<void> {
  if (!session.systemAudioPath) return

  if (!session.systemAudioTempPath) {
    await trimAudioFile(session.systemAudioPath, trimMs)
    return
  }

  const tempPath = session.systemAudioTempPath
  const finalPath = session.systemAudioPath
  const config: RecordingAudioOutputConfig = {
    audioCodec: normalizeRecordingAudioCodec(session.recordingAudioCodec, 'aac'),
    audioBitrateKbps: normalizeRecordingAudioBitrate(session.recordingAudioBitrateKbps, 192),
    audioSampleRate: normalizeRecordingAudioSampleRate(session.recordingAudioSampleRate, 48000),
  }
  const trimSeconds = trimMs / 1000

  log.info(
    `[SystemAudioFinalize] Encoding helper capture ${tempPath} -> ${finalPath} (${config.audioCodec}/${config.audioBitrateKbps}k/${config.audioSampleRate}Hz)`,
  )

  await new Promise<void>((resolve, reject) => {
    const ffmpegArgs = [
      '-y',
      '-ss',
      trimSeconds.toString(),
      '-i',
      tempPath,
      '-vn',
      ...getRecordedAudioCodecArgs(config),
      finalPath,
    ]
    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)

    ffmpeg.stderr.on('data', (data: any) => {
      log.info(`[SystemAudioFinalize FFmpeg]: ${data.toString()}`)
    })

    ffmpeg.on('close', (code: any) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`System audio finalization failed with code ${code}`))
    })

    ffmpeg.on('error', (error: any) => {
      reject(error)
    })
  })

  try {
    await fsPromises.unlink(tempPath)
  } catch (error) {
    log.warn(`[SystemAudioFinalize] Failed to delete helper temp WAV: ${tempPath}`, error)
  }

  session.systemAudioTempPath = undefined
}

/**
 * The core function that spawns FFmpeg and the mouse tracker to begin recording.
 * @param inputArgs - Platform-specific FFmpeg input arguments.
 * @param hasWebcam - Flag indicating if webcam recording is enabled.
 * @param hasMic - Flag indicating if microphone recording is enabled.
 * @param recordingGeometry - Capture bounds in the same coordinate space used by mouse events.
 * @param scaleFactor - Linux display scale. Windows capture geometry is already physical.
 */
async function startActualRecording(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  recordingGeometry: RecordingGeometry,
  scaleFactor: number = 1,
  outputOptions: RecordingOutputOptions = {},
  splitInputArgs?: SplitRecordingInputArgs,
  recordSystemAudio: boolean = false,
  systemAudioCapture?: SupportedComputerAudioCaptureConfig,
  audioConfig: RecordingAudioOutputConfig = { audioCodec: 'aac', audioBitrateKbps: 192, audioSampleRate: 48000 },
) {
  const recordingProcessPriorityMode = normalizeRecordingProcessPriorityMode(
    store.get(RECORDING_PROCESS_PRIORITY_SETTING_KEY, DEFAULT_RECORDING_PROCESS_PRIORITY_MODE),
  )
  const recordingProcessPriorities = normalizeRecordingProcessPriorities(
    store.get(RECORDING_PROCESS_PRIORITIES_SETTING_KEY, DEFAULT_RECORDING_PROCESS_PRIORITIES),
  )
  const recordingDir = await createRecordingSessionDir()
  const baseName = `RecordSaaS-recording-${Date.now()}`
  const audioExtension = getRecordedAudioFileExtension(audioConfig.audioCodec)

  const screenVideoPath = path.join(recordingDir, `${baseName}-screen.mp4`)
  const webcamVideoPath = hasWebcam ? path.join(recordingDir, `${baseName}-webcam.mp4`) : undefined
  const audioPath = hasMic ? path.join(recordingDir, `${baseName}-audio${audioExtension}`) : undefined
  const systemAudioPath = recordSystemAudio
    ? path.join(recordingDir, `${baseName}-system-audio${audioExtension}`)
    : undefined
  const metadataPath = path.join(recordingDir, `${baseName}.json`)

  // Store recordingGeometry and scaleFactor in the session
  appState.currentRecordingSession = {
    screenVideoPath,
    webcamVideoPath,
    audioPath,
    systemAudioPath,
    metadataPath,
    recordingGeometry,
    scaleFactor,
    screenCaptureBackend: outputOptions.screenCaptureBackend,
    requestedScreenFps: outputOptions.screenFps,
    recordingAudioCodec: audioConfig.audioCodec,
    recordingAudioBitrateKbps: audioConfig.audioBitrateKbps,
    recordingAudioSampleRate: audioConfig.audioSampleRate,
  }
  appState.recorderWin?.minimize()

  // Reset state for the new session
  appState.recordingStartTime = Date.now()
  appState.recordedMouseEvents = []
  appState.runtimeCursorImageMap = new Map()
  appState.mouseTracker = createMouseTracker()

  if (appState.mouseTracker) {
    appState.mouseTracker.on('data', (data: any) => {
      let normalizedX = data.x
      let normalizedY = data.y

      if (process.platform === 'win32') {
        normalizedX = data.x / scaleFactor
        normalizedY = data.y / scaleFactor
      } else if (shouldApplyLinuxDisplayScale(scaleFactor)) {
        normalizedX = data.x / scaleFactor
        normalizedY = data.y / scaleFactor
      }

      // Check if the mouse event is within the recording geometry bounds
      if (
        normalizedX >= recordingGeometry.x &&
        normalizedX <= recordingGeometry.x + recordingGeometry.width &&
        normalizedY >= recordingGeometry.y &&
        normalizedY <= recordingGeometry.y + recordingGeometry.height
      ) {
        const absoluteEvent = {
          ...data,
          x: normalizedX - recordingGeometry.x,
          y: normalizedY - recordingGeometry.y,
          timestamp: data.timestamp,
        }
        appState.recordedMouseEvents.push(absoluteEvent)
      }
    })
    // Check if tracker started successfully
    const trackerStarted = await appState.mouseTracker.start(appState.runtimeCursorImageMap)
    if (!trackerStarted) {
      log.error('[RecordingManager] Mouse tracker failed to start, likely due to permissions. Aborting recording.')
      appState.recorderWin?.show()
      await cleanupAndDiscard()
      return { canceled: true }
    }
  }

  const shouldSplitWin32WebcamProcess = Boolean(
    process.platform === 'win32' && hasWebcam && webcamVideoPath && splitInputArgs,
  )
  const ffmpegSpecs: FfmpegProcessSpec[] =
    shouldSplitWin32WebcamProcess && splitInputArgs && webcamVideoPath
      ? buildWin32SplitWebcamFfmpegSpecs(
          splitInputArgs,
          hasMic,
          screenVideoPath,
          webcamVideoPath,
          audioPath,
          outputOptions,
          audioConfig,
        )
      : [
          {
            role: 'main' as const,
            args: buildFfmpegArgs(
              inputArgs,
              hasWebcam,
              hasMic,
              screenVideoPath,
              webcamVideoPath,
              audioPath,
              outputOptions,
              audioConfig,
            ),
          },
        ]

  const systemAudioEncoderArgs =
    systemAudioPath && systemAudioCapture?.backend === 'windows-helper' && systemAudioCapture.inputFormat
      ? buildWindowsHelperSystemAudioFfmpegArgs(
          systemAudioPath,
          systemAudioCapture.inputFormat,
          systemAudioCapture.inputSampleRate || 48000,
          systemAudioCapture.inputChannels || 2,
          audioConfig,
        )
      : null

  if (systemAudioPath && systemAudioCapture?.backend === 'pulse') {
    ffmpegSpecs.push({
      role: 'system-audio',
      args: buildSystemAudioFfmpegArgs(systemAudioPath, systemAudioCapture.input, audioConfig),
    })
  }

  if (systemAudioEncoderArgs) {
    ffmpegSpecs.push({
      role: 'system-audio',
      args: systemAudioEncoderArgs,
    })
  }

  if (shouldSplitWin32WebcamProcess) {
    log.info('[FFMPEG] Windows webcam capture will run in a separate FFmpeg process.')
  }

  const ffmpegRuns = ffmpegSpecs.map((spec) => {
    log.info(`[FFMPEG:${spec.role}] Starting FFmpeg with args: ${spec.args.join(' ')}`)
    const process = spawn(FFMPEG_PATH, spec.args)
    const processPriority = resolveRecordingProcessPriority(
      spec.role,
      recordingProcessPriorityMode,
      recordingProcessPriorities,
    )
    applyRecordingProcessPriority(process, processPriority, `ffmpeg:${spec.role}`)
    return { ...spec, process }
  })
  appState.ffmpegProcess = ffmpegRuns.find((run) => run.role === 'main')?.process || ffmpegRuns[0]?.process || null
  appState.ffmpegProcesses = ffmpegRuns.map((run) => run.process)
  const systemAudioEncoderRun =
    systemAudioEncoderArgs ? ffmpegRuns.find((run) => run.role === 'system-audio') || null : null

  let systemAudioHelperRun:
    | {
        role: 'system-audio'
        process: ChildProcessWithoutNullStreams
      }
    | null = null

  if (systemAudioPath && systemAudioCapture?.backend === 'windows-helper') {
    log.info('[SystemAudioHelper] Starting helper in stdout mode.')
    const helperArgs = ['--stdout']
    if (systemAudioCapture.deviceId) {
      helperArgs.push('--device-id', systemAudioCapture.deviceId)
    }
    const helperProcess = spawn(WINDOWS_SYSTEM_AUDIO_HELPER_PATH, helperArgs, { windowsHide: true })
    appState.systemAudioHelperProcess = helperProcess
    systemAudioHelperRun = {
      role: 'system-audio',
      process: helperProcess,
    }
  } else {
    appState.systemAudioHelperProcess = null
  }

  return new Promise((resolve) => {
    let startResolved = false
    let fatalStartupHandled = false
    let recordingReady = false
    const readyRoles = new Set<FfmpegProcessRole>()
    let startupErrorText = ''
    let startupTimeout: NodeJS.Timeout | null = setTimeout(() => {
      if (recordingReady || fatalStartupHandled) return
      log.error('[FFMPEG] Startup timed out before recording became ready.')
      dialog.showErrorBox(
        'Recording Failed',
        'FFmpeg did not finish initializing the recording in time. Please try again.',
      )
      cleanupFailedRecordingStart()
      resolveOnce({ canceled: true })
    }, FFMPEG_STARTUP_TIMEOUT_MS)

    const resolveOnce = (value: { canceled: boolean } & Partial<RecordingSession>) => {
      if (startResolved) return
      startResolved = true
      if (startupTimeout) {
        clearTimeout(startupTimeout)
        startupTimeout = null
      }
      resolve(value)
    }

    const expectedReadyCount =
      ffmpegRuns.length + (systemAudioHelperRun ? 1 : 0) - (systemAudioEncoderRun ? 1 : 0)

    const markRecordingReady = (role: FfmpegProcessRole) => {
      if (recordingReady) return
      readyRoles.add(role)
      log.info(
        `[FFMPEG] Ready signal from ${role}. count=${readyRoles.size}/${expectedReadyCount} roles=${Array.from(readyRoles).join(',')}`,
      )
      if (readyRoles.size < expectedReadyCount) return

      recordingReady = true
      const session = appState.currentRecordingSession
      if (!session) {
        resolveOnce({ canceled: true })
        return
      }

      log.info('[FFMPEG] Recording pipeline is ready.')
      appState.recorderWin?.webContents.send('recording-started')
      createTray()
      resolveOnce({ canceled: false, ...session })
    }

    const cleanupFailedRecordingStart = () => {
      if (fatalStartupHandled) return
      fatalStartupHandled = true
      if (startupTimeout) {
        clearTimeout(startupTimeout)
        startupTimeout = null
      }
      setTimeout(() => {
        cleanupAndDiscard()
          .then(() => {
            appState.recorderWin?.webContents.send('recording-finished', { canceled: true })
            appState.recorderWin?.show()
          })
          .catch((cleanupError) => {
            log.error('[FFMPEG] Failed to cleanup after fatal startup error:', cleanupError)
          })
      }, 100)
    }

    for (const run of ffmpegRuns) {
      const ffmpeg = run.process

      ffmpeg.once('spawn', () => {
        log.info(`[FFMPEG:${run.role}] Process spawned, waiting for recording pipeline to become ready...`)
      })

      ffmpeg.once('error', (error: NodeJS.ErrnoException) => {
        log.error(`[FFMPEG:${run.role}] Failed to start FFmpeg process:`, error)
        dialog.showErrorBox('Recording Failed', getFFmpegSpawnErrorMessage(error))
        setTimeout(() => {
          cleanupAndDiscard().catch((cleanupError) => {
            log.error('[FFMPEG] Failed to cleanup after spawn error:', cleanupError)
          })
        }, 0)
        resolveOnce({ canceled: true })
      })

      ffmpeg.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (recordingReady || fatalStartupHandled) {
          return
        }

        log.error(`[FFMPEG:${run.role}] Process exited before recording became ready. code=${code} signal=${signal}`)
        const startupDetail = startupErrorText.trim()
        const errorMessage = startupDetail.includes('Device or resource busy')
          ? `The selected recording device is busy.\n\n${startupDetail}\n\nClose any app that is using the webcam or microphone and try again.`
          : startupDetail.length > 0
            ? `FFmpeg exited before the recording could start.\n\n${startupDetail}`
            : `FFmpeg exited before the recording could start.\n\ncode=${code ?? 'null'} signal=${signal ?? 'none'}`
        dialog.showErrorBox('Recording Failed', errorMessage)
        cleanupFailedRecordingStart()
        resolveOnce({ canceled: true })
      })

      // Monitor FFmpeg's stderr for progress, errors, and sync timing
      ffmpeg.stderr.on('data', (data: any) => {
        const message = data.toString()
        startupErrorText = `[${run.role}] ${message}`
        log.warn(`[FFMPEG:${run.role} stderr]: ${message}`)

        if (!recordingReady && isFFmpegRecordingReadyMessage(message)) {
          markRecordingReady(run.role)
        }

        // Early detection of fatal errors to provide immediate feedback
        const fatalErrorKeywords = [
          'Cannot open display',
          'Invalid argument',
          'Device not found',
          'Unknown input format',
          'error opening device',
        ]
        if (fatalErrorKeywords.some((keyword) => message.toLowerCase().includes(keyword.toLowerCase()))) {
          log.error(`[FFMPEG:${run.role}] Fatal error detected: ${message}`)
          dialog.showErrorBox(
            'Recording Failed',
            `A critical error occurred while starting the recording process:\n\n${message}\n\nPlease check your device permissions and configurations.`,
          )
          cleanupFailedRecordingStart()
        }
      })
    }

    if (systemAudioHelperRun) {
      const helper = systemAudioHelperRun.process
      let helperStderrBuffer = ''

      helper.once('spawn', () => {
        log.info('[SystemAudioHelper] Process spawned, waiting for READY signal...')
      })

      helper.once('error', (error: NodeJS.ErrnoException) => {
        log.error('[SystemAudioHelper] Failed to start helper:', error)
        dialog.showErrorBox('Recording Failed', `Could not start system audio helper.\n\n${error.message}`)
        cleanupFailedRecordingStart()
        resolveOnce({ canceled: true })
      })

      helper.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (recordingReady || fatalStartupHandled) {
          return
        }

        log.error(`[SystemAudioHelper] Exited before recording became ready. code=${code} signal=${signal}`)
        const errorMessage =
          startupErrorText.trim() ||
          `System audio helper exited before the recording could start.\n\ncode=${code ?? 'null'} signal=${signal ?? 'none'}`
        dialog.showErrorBox('Recording Failed', errorMessage)
        cleanupFailedRecordingStart()
        resolveOnce({ canceled: true })
      })

      helper.stderr.on('data', (data: Buffer) => {
        helperStderrBuffer += data.toString()
        const helperStderrLines = helperStderrBuffer.split(/\r?\n/)
        helperStderrBuffer = helperStderrLines.pop() ?? ''

        for (const rawLine of helperStderrLines) {
          const message = rawLine.trim()
          if (!message) {
            continue
          }

          if (!recordingReady && message.includes('READY')) {
            markRecordingReady('system-audio')
          }

          startupErrorText = `[system-audio] ${message}`
          if (!message.includes('READY')) {
            log.warn(`[SystemAudioHelper stderr]: ${message}`)
          }
        }
      })

      if (systemAudioEncoderRun) {
        helper.stdout.pipe(systemAudioEncoderRun.process.stdin)
      } else {
        log.error('[SystemAudioHelper] Windows helper started without a matching FFmpeg encoder process.')
        cleanupFailedRecordingStart()
        resolveOnce({ canceled: true })
      }
    }
  })
}

/**
 * Constructs the final FFmpeg command arguments by mapping input streams to output files.
 */
function appendScreenOutputArgs(
  args: string[],
  screenIndex: number,
  screenOut: string,
  outputOptions: RecordingOutputOptions = {},
): void {
  const encoderDef = getScreenEncoderDefinition(outputOptions.screenEncoderStatus)

  if (encoderDef.prefixArgs && encoderDef.prefixArgs.length > 0) {
    args.unshift(...encoderDef.prefixArgs)
  }

  log.info(
    `[RecordingManager] Screen recording encode config: output=${screenOut} codecArgs=${encoderDef.codecArgs.join(' ')} fps=${outputOptions.screenFps ?? 'input'} fps_mode=cfr pix_fmt=yuv420p`,
  )
  args.push('-map', `${screenIndex}:v`, ...encoderDef.codecArgs)
  if (outputOptions.screenScale) {
    const screenFilters = outputOptions.screenNeedsHwDownload ? ['hwdownload', 'format=bgra'] : []
    screenFilters.push(`scale=${outputOptions.screenScale.width}:${outputOptions.screenScale.height}`)
    args.push('-vf', screenFilters.join(','))
  } else if (outputOptions.screenNeedsHwDownload) {
    args.push('-vf', 'hwdownload,format=bgra')
  }
  if (outputOptions.screenFps) {
    args.push('-r', String(outputOptions.screenFps), '-fps_mode', 'cfr')
  }
  args.push(screenOut)
}

function buildSystemAudioFfmpegArgs(
  audioOut: string,
  inputName: string,
  config: RecordingAudioOutputConfig,
): string[] {
  return ['-y', '-f', 'pulse', '-i', inputName, '-vn', ...getRecordedAudioCodecArgs(config), audioOut]
}

function buildWindowsHelperSystemAudioFfmpegArgs(
  audioOut: string,
  inputFormat: 's16le' | 's24le' | 's32le' | 'f32le' | 'f64le',
  inputSampleRate: number,
  inputChannels: number,
  config: RecordingAudioOutputConfig,
): string[] {
  return [
    '-y',
    '-f',
    inputFormat,
    '-ar',
    String(inputSampleRate),
    '-ac',
    String(inputChannels),
    '-i',
    'pipe:0',
    '-vn',
    '-af',
    'pan=stereo|c0=FL|c1=FR,aresample=async=1',
    ...getRecordedAudioCodecArgs(config),
    audioOut,
  ]
}

type RecordingAudioOutputConfig = Pick<
  RecordingProfileRuntime,
  'audioCodec' | 'audioBitrateKbps' | 'audioSampleRate'
>

function getRecordedAudioFileExtension(codec: RecordingAudioCodec): '.aac' | '.mp3' {
  return codec === 'mp3' ? '.mp3' : '.aac'
}

function getRecordedAudioCodecArgs(config: RecordingAudioOutputConfig): string[] {
  const codecArgs = config.audioCodec === 'mp3' ? ['-c:a', 'libmp3lame'] : ['-c:a', 'aac']
  return [...codecArgs, '-b:a', `${config.audioBitrateKbps}k`, '-ar', String(config.audioSampleRate), '-ac', '2']
}

function appendEncodedAudioOutputArgs(
  args: string[],
  inputSpecifier: string,
  audioOut: string,
  config: RecordingAudioOutputConfig,
): void {
  args.push('-map', inputSpecifier, ...getRecordedAudioCodecArgs(config), audioOut)
}

function stopSystemAudioHelperProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    const resolveOnce = () => {
      if (settled) return
      settled = true
      resolve()
    }

    process.once('close', () => resolveOnce())
    process.once('error', () => resolveOnce())

    try {
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.end()
      } else {
        process.kill('SIGINT')
      }
    } catch {
      try {
        process.kill('SIGKILL')
      } catch {
        resolveOnce()
      }
    }

    setTimeout(resolveOnce, FFMPEG_STOP_RESOLVE_PERIOD_MS)
  })
}

function appendWebcamOutputArgs(args: string[], webcamIndex: number, webcamOut: string): void {
  log.info(
    `[RecordingManager] Webcam recording encode config: output=${webcamOut} codec=${WEBCAM_RECORDING_ENCODING_CONFIG.codec} preset=${WEBCAM_RECORDING_ENCODING_CONFIG.preset} crf=${WEBCAM_RECORDING_ENCODING_CONFIG.crf} maxrate=${WEBCAM_RECORDING_ENCODING_CONFIG.maxrate} bufsize=${WEBCAM_RECORDING_ENCODING_CONFIG.bufsize} pix_fmt=${WEBCAM_RECORDING_ENCODING_CONFIG.pixFmt}`,
  )
  args.push(
    '-map',
    `${webcamIndex}:v`,
    '-c:v',
    WEBCAM_RECORDING_ENCODING_CONFIG.codec,
    '-preset',
    WEBCAM_RECORDING_ENCODING_CONFIG.preset,
    '-crf',
    WEBCAM_RECORDING_ENCODING_CONFIG.crf,
    '-maxrate',
    WEBCAM_RECORDING_ENCODING_CONFIG.maxrate,
    '-bufsize',
    WEBCAM_RECORDING_ENCODING_CONFIG.bufsize,
    '-pix_fmt',
    WEBCAM_RECORDING_ENCODING_CONFIG.pixFmt,
    webcamOut,
  )
}

function buildFfmpegArgs(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  screenOut: string,
  webcamOut?: string,
  audioOut?: string,
  outputOptions: RecordingOutputOptions = {},
  audioConfig: RecordingAudioOutputConfig = { audioCodec: 'aac', audioBitrateKbps: 192, audioSampleRate: 48000 },
): string[] {
  const finalArgs = [...inputArgs]
  const micIndex = hasMic ? 0 : -1
  const webcamIndex = hasMic ? (hasWebcam ? 1 : -1) : hasWebcam ? 0 : -1
  const screenIndex = (hasMic ? 1 : 0) + (hasWebcam ? 1 : 0)

  appendScreenOutputArgs(finalArgs, screenIndex, screenOut, outputOptions)
  if (hasMic && audioOut) appendEncodedAudioOutputArgs(finalArgs, `${micIndex}:a`, audioOut, audioConfig)
  if (hasWebcam && webcamOut) appendWebcamOutputArgs(finalArgs, webcamIndex, webcamOut)

  return finalArgs
}

function buildWin32SplitWebcamFfmpegSpecs(
  inputArgs: SplitRecordingInputArgs,
  hasMic: boolean,
  screenOut: string,
  webcamOut: string,
  audioOut: string | undefined,
  outputOptions: RecordingOutputOptions = {},
  audioConfig: RecordingAudioOutputConfig = { audioCodec: 'aac', audioBitrateKbps: 192, audioSampleRate: 48000 },
): FfmpegProcessSpec[] {
  const mainArgs = [...inputArgs.micInputArgs, ...inputArgs.screenInputArgs]
  appendScreenOutputArgs(mainArgs, hasMic ? 1 : 0, screenOut, outputOptions)
  if (hasMic && audioOut) appendEncodedAudioOutputArgs(mainArgs, '0:a', audioOut, audioConfig)

  const webcamArgs = [...inputArgs.webcamInputArgs]
  appendWebcamOutputArgs(webcamArgs, 0, webcamOut)

  return [
    { role: 'main', args: mainArgs },
    { role: 'webcam', args: webcamArgs },
  ]
}

/**
 * Creates the system tray icon and context menu for controlling an active recording.
 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(VITE_PUBLIC, 'recordsaas-appicon-tray.png'))
  appState.tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Stop Recording',
      click: async () => {
        await stopRecording()
      },
    },
    {
      label: 'Cancel Recording',
      click: async () => {
        await cancelRecording()
      },
    },
  ])
  appState.tray.setToolTip('RecordSaaS is recording...')
  appState.tray.setContextMenu(contextMenu)
}

/**
 * Orchestrates the start of a recording based on user options from the renderer.
 * @param options - The recording configuration selected by the user.
 */
export async function startRecording(options: any) {
  const { source, displayId, mic, webcam } = options
  const computerAudioEnabled = options.computerAudioEnabled === true
  const recordingProfile = normalizeRecordingProfile(options.recordingProfile)
  const audioConfig: RecordingAudioOutputConfig = {
    audioCodec: recordingProfile.audioCodec,
    audioBitrateKbps: recordingProfile.audioBitrateKbps,
    audioSampleRate: recordingProfile.audioSampleRate,
  }
  const screenFps = recordingProfile.screenFps
  const screenEncoderStatus = await getScreenEncoderStatus()
  const outputOptions: RecordingOutputOptions = { screenFps, screenEncoderStatus }
  log.info('[RecordingManager] Received start recording request with options:', options)
  log.info('[RecordingManager] Using recording profile:', recordingProfile)
  log.info('[RecordingManager] Resolved screen encoder:', screenEncoderStatus)

  const computerAudioCapture = computerAudioEnabled ? resolveComputerAudioCaptureConfig(options.computerAudioDeviceId) : null
  if (computerAudioEnabled && !computerAudioCapture?.supported) {
    dialog.showErrorBox(
      'Computer Audio Unavailable',
      `${computerAudioCapture?.reason || 'Computer audio capture is unavailable on this platform.'}\n\nBinary:\n${FFMPEG_PATH}`,
    )
    return { canceled: true }
  }

  if (webcam) {
    await requestRecorderWebcamRelease()
  }

  // macOS Permissions Check
  if (process.platform === 'darwin') {
    // 1. Check Screen Recording Permissions
    let screenAccess = systemPreferences.getMediaAccessStatus('screen')
    if (screenAccess === 'not-determined') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const iohook = require('iohook-macos')
        const permissions = iohook.checkAccessibilityPermissions()
        screenAccess = permissions.hasPermissions ? 'granted' : 'denied'
      } catch (e) {
        log.error('[MouseTracker] Failed to load macOS-specific modules. Mouse tracking on macOS will be disabled.', e)
      }
    }
    if (screenAccess !== 'granted') {
      dialog.showErrorBox(
        'Screen Recording Permission Required',
        'Accessibility permissions required. Please go to System Preferences > Security & Privacy > Privacy > Accessibility and enable this application.',
      )
      return { canceled: true }
    }

    // 2. Check Microphone Permissions (if requested)
    if (mic) {
      let micAccess = systemPreferences.getMediaAccessStatus('microphone')
      if (micAccess === 'not-determined') {
        micAccess = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
      }
      if (micAccess !== 'granted') {
        dialog.showErrorBox(
          'Microphone Permission Required',
          'Microphone permissions required. Please go to System Preferences > Security & Privacy > Privacy > Microphone and enable this application.',
        )
        return { canceled: true }
      }
    }
  }

  const display = process.env.DISPLAY || ':0.0'
  const micInputArgs: string[] = []
  const webcamInputArgs: string[] = []
  const screenInputArgs: string[] = []
  let recordingGeometry: RecordingGeometry
  let recordingScaleFactor = 1 // Default to 1 for non-Windows or 100% scaling
  let webcamInputContext: WebcamInputContext = {}

  if (source === 'fullscreen') {
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    const { width, height } = targetDisplay.bounds
    const scaleFactor = targetDisplay.scaleFactor || 1
    const windowsDisplayRect = process.platform === 'win32' ? getWindowsPhysicalDisplayRect(targetDisplay) : null
    webcamInputContext = {
      screenWidth: windowsDisplayRect?.width ?? getPlatformPhysicalDimension(width, scaleFactor),
      screenHeight: windowsDisplayRect?.height ?? getPlatformPhysicalDimension(height, scaleFactor),
    }
  } else if (source === 'area' && options.geometry) {
    const selectedGeometry = options.geometry
    const safeWidth = Math.floor(selectedGeometry.width / 2) * 2
    const safeHeight = Math.floor(selectedGeometry.height / 2) * 2
    const containingDisplay =
      screen.getAllDisplays().find((d) => {
        const b = d.bounds
        return (
          selectedGeometry.x >= b.x &&
          selectedGeometry.y >= b.y &&
          selectedGeometry.x + selectedGeometry.width <= b.x + b.width &&
          selectedGeometry.y + selectedGeometry.height <= b.y + b.height
        )
      }) || screen.getPrimaryDisplay()
    const scaleFactor = containingDisplay.scaleFactor || 1
    const windowsAreaRect =
      process.platform === 'win32'
        ? getWindowsPhysicalAreaRect(
            { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight },
            containingDisplay,
          )
        : null
    webcamInputContext = {
      screenWidth: windowsAreaRect?.width ?? getPlatformPhysicalDimension(safeWidth, scaleFactor),
      screenHeight: windowsAreaRect?.height ?? getPlatformPhysicalDimension(safeHeight, scaleFactor),
    }
  }

  // --- Add Microphone and Webcam inputs first ---
  if (mic) {
    switch (process.platform) {
      case 'linux':
        {
          const linuxMicInput = await resolveLinuxMicrophoneInput()
          if (!linuxMicInput) {
            dialog.showErrorBox(
              'Microphone Unavailable',
              'RecordSaaS could not find a Linux microphone input that FFmpeg can open.\n\nTry selecting "No microphone", or set RECORDSAAS_LINUX_MIC_INPUT to a working ALSA device such as hw:0,0.',
            )
            return { canceled: true }
          }
          micInputArgs.push('-f', 'alsa', '-i', linuxMicInput)
        }
        break
      case 'win32':
        micInputArgs.push('-f', 'dshow', '-i', `audio=${mic.deviceLabel}`)
        break
      case 'darwin':
        micInputArgs.push('-f', 'avfoundation', '-i', `:${mic.index}`)
        break
    }
  }
  if (webcam) {
    const webcamInputOptions = await resolveWebcamInputOptions(recordingProfile, webcamInputContext, webcam)
    switch (process.platform) {
      case 'linux':
        webcamInputArgs.push('-f', 'v4l2')
        appendWebcamInputOptions(webcamInputArgs, webcamInputOptions)
        webcamInputArgs.push('-i', `/dev/video${webcam.index}`)
        break
      case 'win32':
        webcamInputArgs.push('-f', 'dshow')
        appendWin32DshowWebcamBufferOptions(webcamInputArgs)
        appendWebcamInputOptions(webcamInputArgs, webcamInputOptions)
        webcamInputArgs.push('-i', `video=${webcam.deviceLabel}`)
        break
      case 'darwin':
        webcamInputArgs.push('-f', 'avfoundation')
        appendWebcamInputOptions(webcamInputArgs, webcamInputOptions)
        webcamInputArgs.push('-i', `${webcam.index}:none`)
        break
    }
  }

  // --- Add Screen input last ---
  if (source === 'fullscreen') {
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    const { x, y, width, height } = targetDisplay.bounds
    const scaleFactor = targetDisplay.scaleFactor || 1
    const windowsCaptureRect = process.platform === 'win32' ? getWindowsDdagrabDisplayRect(targetDisplay) : null
    recordingScaleFactor = scaleFactor // Store for metadata processing

    // For Windows, ddagrab captures physical pixels from a single display via Desktop Duplication.
    const physicalWidth = windowsCaptureRect?.width ?? getPlatformPhysicalDimension(width, scaleFactor)
    const physicalHeight = windowsCaptureRect?.height ?? getPlatformPhysicalDimension(height, scaleFactor)
    const physicalX = windowsCaptureRect?.x ?? getPlatformPhysicalOffset(x, scaleFactor)
    const physicalY = windowsCaptureRect?.y ?? getPlatformPhysicalOffset(y, scaleFactor)

    // Store the logical dimensions for mouse tracking
    const safeWidth = Math.floor(width / 2) * 2
    const safeHeight = Math.floor(height / 2) * 2
    recordingGeometry = { x, y, width: safeWidth, height: safeHeight }
    outputOptions.screenScale =
      resolveScaledDimensions(safeWidth, safeHeight, recordingProfile.screenResolution) || undefined

    switch (process.platform) {
      case 'linux':
        outputOptions.screenCaptureBackend = 'x11grab'
        screenInputArgs.push(
          '-f',
          'x11grab',
          '-framerate',
          String(screenFps),
          '-draw_mouse',
          '0',
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          `${display}+${physicalX},${physicalY}`,
        )
        break
      case 'win32': {
        const windowsPhysicalRect = getWindowsPhysicalDisplayRect(targetDisplay)
        const candidate = selectWindowsScreenCaptureCandidate(targetDisplay, windowsPhysicalRect, screenFps)
        outputOptions.screenNeedsHwDownload = candidate.needsHwDownload
        outputOptions.screenCaptureBackend = candidate.backend
        screenInputArgs.push(...candidate.inputArgs)
        break
      }
      case 'darwin':
        outputOptions.screenCaptureBackend = 'avfoundation'
        screenInputArgs.push(
          '-f',
          'avfoundation',
          '-framerate',
          String(screenFps),
          '-i',
          `${allDisplays.findIndex((d) => d.id === targetDisplay.id) || 0}:none`,
        )
        break
    }
  } else if (source === 'area') {
    const selectedGeometry = options.geometry || (await selectRecordingArea())
    if (!selectedGeometry) return { canceled: true }

    const safeWidth = Math.floor(selectedGeometry.width / 2) * 2
    const safeHeight = Math.floor(selectedGeometry.height / 2) * 2
    recordingGeometry = { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight }
    outputOptions.screenScale =
      resolveScaledDimensions(safeWidth, safeHeight, recordingProfile.screenResolution) || undefined

    // Get scale factor for the display containing the selection
    const allDisplays = screen.getAllDisplays()
    const containingDisplay =
      allDisplays.find((d) => {
        const b = d.bounds
        return (
          selectedGeometry.x >= b.x &&
          selectedGeometry.y >= b.y &&
          selectedGeometry.x + selectedGeometry.width <= b.x + b.width &&
          selectedGeometry.y + selectedGeometry.height <= b.y + b.height
        )
      }) || screen.getPrimaryDisplay()
    const scaleFactor = containingDisplay.scaleFactor || 1
    const windowsCaptureRect =
      process.platform === 'win32'
        ? getWindowsDdagrabAreaRect(
            { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight },
            containingDisplay,
          )
        : null
    recordingScaleFactor = scaleFactor // Store for metadata processing

    // For Windows, convert the selected area to physical pixels relative to the selected display.
    const physicalWidth = windowsCaptureRect?.width ?? getPlatformPhysicalDimension(safeWidth, scaleFactor)
    const physicalHeight = windowsCaptureRect?.height ?? getPlatformPhysicalDimension(safeHeight, scaleFactor)
    const physicalX = windowsCaptureRect?.x ?? getPlatformPhysicalOffset(selectedGeometry.x, scaleFactor)
    const physicalY = windowsCaptureRect?.y ?? getPlatformPhysicalOffset(selectedGeometry.y, scaleFactor)
    recordingGeometry =
      windowsCaptureRect || { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight }
    outputOptions.screenScale =
      resolveScaledDimensions(physicalWidth, physicalHeight, recordingProfile.screenResolution) || undefined
    const windowsDisplayRect =
      process.platform === 'win32' ? getWindowsPhysicalDisplayRect(containingDisplay) : null
    outputOptions.screenCaptureDisplay = {
      id: containingDisplay.id,
      label: containingDisplay.label || `Display ${allDisplays.findIndex((item) => item.id === containingDisplay.id) + 1}`,
      bounds: containingDisplay.bounds,
      scaleFactor,
      physicalBounds:
        windowsDisplayRect || { x: physicalX, y: physicalY, width: physicalWidth, height: physicalHeight },
    }

    switch (process.platform) {
      case 'linux':
        outputOptions.screenCaptureBackend = 'x11grab'
        screenInputArgs.push(
          '-f',
          'x11grab',
          '-framerate',
          String(screenFps),
          '-draw_mouse',
          '0',
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          `${display}+${physicalX},${physicalY}`,
        )
        break
      case 'win32': {
        const windowsPhysicalRect = getWindowsPhysicalAreaRect(
          { x: selectedGeometry.x, y: selectedGeometry.y, width: safeWidth, height: safeHeight },
          containingDisplay,
        )
        const candidate = selectWindowsScreenCaptureCandidate(containingDisplay, windowsPhysicalRect, screenFps)
        outputOptions.screenNeedsHwDownload = candidate.needsHwDownload
        outputOptions.screenCaptureBackend = candidate.backend
        screenInputArgs.push(...candidate.inputArgs)
        break
      }
      case 'darwin':
        // Note: macOS avfoundation doesn't support area capture like gdigrab/x11grab
        outputOptions.screenCaptureBackend = 'avfoundation'
        // Area selection on macOS would require a different approach
        log.warn('[RecordingManager] Area selection not supported on macOS')
        appState.recorderWin?.show()
        return { canceled: true }
    }
  } else {
    return { canceled: true }
  }

  // Only get/store original cursor scale on Linux
  if (process.platform === 'linux') {
    appState.originalCursorScale = await getCursorScale()
  }

  if (process.platform === 'linux' && webcam) {
    const webcamDevicePath = `/dev/video${webcam.index}`
    const webcamReleaseResult = await waitForLinuxWebcamRelease(webcamDevicePath)
    if (!webcamReleaseResult.available) {
      dialog.showErrorBox(
        'Webcam Unavailable',
        `RecordSaaS released the webcam preview but ${webcamDevicePath} did not become available for FFmpeg.\n\n${webcamReleaseResult.detail || 'The device is still busy.'}\n\nClose any app using the camera and try again.`,
      )
      return { canceled: true }
    }
  }

  const baseFfmpegArgs = [...micInputArgs, ...webcamInputArgs, ...screenInputArgs]
  const splitInputArgs =
    process.platform === 'win32' && webcam
      ? {
          micInputArgs,
          webcamInputArgs,
          screenInputArgs,
        }
      : undefined

  log.info('[RecordingManager] Starting actual recording with args:', baseFfmpegArgs)
  return startActualRecording(
    baseFfmpegArgs,
    !!webcam,
    !!mic,
    recordingGeometry,
    recordingScaleFactor,
    outputOptions,
    splitInputArgs,
    computerAudioEnabled,
    computerAudioCapture?.supported ? computerAudioCapture : undefined,
    audioConfig,
  )
}

export async function analyzeRecordingCapability(): Promise<{
  recommendedFps: 30 | 60
  canRecord60Fps: boolean
  reason: string
  measuredFps?: number
}> {
  const targetDisplay = screen.getPrimaryDisplay()
  const scaleFactor = targetDisplay.scaleFactor || 1
  const { x, y, width, height } = targetDisplay.bounds
  const windowsCaptureRect = process.platform === 'win32' ? getWindowsPhysicalDisplayRect(targetDisplay) : null
  const physicalWidth = windowsCaptureRect?.width ?? getPlatformPhysicalDimension(width, scaleFactor)
  const physicalHeight = windowsCaptureRect?.height ?? getPlatformPhysicalDimension(height, scaleFactor)
  const physicalX = windowsCaptureRect?.x ?? getPlatformPhysicalOffset(x, scaleFactor)
  const physicalY = windowsCaptureRect?.y ?? getPlatformPhysicalOffset(y, scaleFactor)

  const probes: Array<{ backend: RecordingCapabilityProbeBackend; args: string[] }> =
    process.platform === 'win32'
      ? getWindowsScreenCaptureCandidates(targetDisplay, windowsCaptureRect!, 60).map((candidate) => ({
          backend: candidate.backend,
          args: [
            '-hide_banner',
            ...candidate.inputArgs,
            '-t',
            String(RECORDING_CAPABILITY_PROBE_SECONDS),
            ...(candidate.needsHwDownload ? ['-vf', 'hwdownload,format=bgra'] : []),
            '-f',
            'null',
            '-',
          ],
        }))
      : process.platform === 'linux'
        ? [
            {
              backend: 'x11grab',
              args: [
                '-hide_banner',
                '-f',
                'x11grab',
                '-framerate',
                '60',
                '-draw_mouse',
                '0',
                '-video_size',
                `${physicalWidth}x${physicalHeight}`,
                '-t',
                String(RECORDING_CAPABILITY_PROBE_SECONDS),
                '-i',
                `${process.env.DISPLAY || ':0.0'}+${physicalX},${physicalY}`,
                '-f',
                'null',
                '-',
              ],
            },
          ]
        : []

  if (probes.length === 0) {
    const likelyCanRecord60 = (cpus()?.length || 0) >= 8
    return {
      recommendedFps: likelyCanRecord60 ? 60 : 30,
      canRecord60Fps: likelyCanRecord60,
      reason: likelyCanRecord60
        ? 'Platform probe is not available; CPU core count suggests 60fps should be acceptable.'
        : 'Platform probe is not available; CPU core count suggests 30fps is safer.',
    }
  }

  let lastResult: RecordingCapabilityProbeResult | null = null
  for (const probe of probes) {
    const result = await runRecordingCapabilityProbe(probe.backend, probe.args)
    lastResult = result
    log.info(
      `[RecordingManager] ${result.backend} capability probe result: ok=${result.ok} measuredFps=${result.measuredFps?.toFixed(1) || 'unknown'}`,
    )
    if (result.ok) break
  }

  if (!lastResult?.ok) {
    return {
      recommendedFps: 30,
      canRecord60Fps: false,
      reason: 'The 60fps probe could not start. Native profile will use the safer 30fps setting.',
    }
  }

  const measuredFps = lastResult.measuredFps
  const canRecord60Fps = Boolean(measuredFps && measuredFps >= 54)
  const backendLabel =
    lastResult.backend === 'ddagrab' ? 'Desktop Duplication' : lastResult.backend === 'gdigrab' ? 'GDI' : 'X11'
  return {
    recommendedFps: canRecord60Fps ? 60 : 30,
    canRecord60Fps,
    measuredFps: measuredFps || undefined,
    reason: canRecord60Fps
      ? `The 5-second ${backendLabel} screen capture probe sustained enough throughput for native 60fps recording.`
      : `The 5-second ${backendLabel} screen capture probe did not sustain enough throughput; native recording will use 30fps.`,
  }
}

export async function selectRecordingArea() {
  appState.recorderWin?.hide()
  createSelectionWindow()
  const selectedGeometry = await new Promise<any | undefined>((resolve) => {
    ipcMain.once('selection:complete', (_e, geo) => {
      appState.selectionWin?.close()
      if (appState.recorderWin && !appState.recorderWin.isDestroyed()) {
        appState.recorderWin.show()
        appState.recorderWin.focus()
      }
      resolve(geo)
    })
    ipcMain.once('selection:cancel', () => {
      appState.selectionWin?.close()
      appState.recorderWin?.show()
      resolve(undefined)
    })
  })
  return selectedGeometry
}

/**
 * Handles the graceful stop of a recording, saves files, validates them, and opens the editor.
 */
export async function stopRecording() {
  restoreOriginalCursorScale()
  log.info('Stopping recording, preparing to save...')
  appState.tray?.destroy()
  appState.tray = null
  createSavingWindow()

  // Step 1: Wait for FFmpeg and tracker to finish
  await cleanupAndSave()
  log.info('FFmpeg process finished and file is finalized.')

  const session = appState.currentRecordingSession
  if (!session) {
    log.error('[StopRecord] No recording session found after cleanup. Aborting.')
    appState.savingWin?.close()
    appState.recorderWin?.show()
    return
  }

  // Notify recorder window that the recording has finished, allowing it to reset its UI
  appState.recorderWin?.webContents.send('recording-finished', { canceled: false, ...session })

  // Step 2: Trim audio file if present
  if (session.audioPath) {
    try {
      log.info('[StopRecord] Trimming audio file by 1000ms...')
      await trimAudioFile(session.audioPath, 1000)
      log.info('[StopRecord] Audio file trimmed successfully.')
    } catch (error) {
      log.error('[StopRecord] Failed to trim audio file:', error)
      // Continue anyway - audio is trimmed but not critical
    }
  }

  if (session.systemAudioPath) {
    try {
      log.info('[StopRecord] Finalizing computer audio file...')
      await finalizeSystemAudioCapture(session, 1000)
      log.info('[StopRecord] Computer audio file finalized successfully.')
    } catch (error) {
      log.error('[StopRecord] Failed to finalize computer audio file:', error)

      if (session.systemAudioTempPath) {
        try {
          await fsPromises.unlink(session.systemAudioPath).catch(() => undefined)
          session.systemAudioPath = session.systemAudioTempPath
          session.systemAudioTempPath = undefined
          await trimAudioFile(session.systemAudioPath, 1000)
          log.warn('[StopRecord] Falling back to raw helper WAV for computer audio.')
        } catch (fallbackError) {
          log.error('[StopRecord] Failed to recover raw helper WAV after finalize error:', fallbackError)
        }
      }
    }
  }

  // Step 3: Process and save metadata (after video file is complete)
  await processAndSaveMetadata(session)

  // Step 4: Validate file
  const isValid = await validateRecordingFiles(session)
  if (!isValid) {
    log.error('[StopRecord] Recording validation failed. Discarding files.')
    await cleanupEditorFiles(session)
    appState.currentRecordingSession = null
    appState.savingWin?.close()
    resetCursorScale()
    appState.recorderWin?.show()
    return
  }

  await new Promise((resolve) => setTimeout(resolve, 500))
  appState.savingWin?.close()
  resetCursorScale()

  appState.currentRecordingSession = null
  if (session) {
    createEditorWindow(
      session.screenVideoPath,
      session.metadataPath,
      session.recordingGeometry,
      session.webcamVideoPath,
      session.audioPath,
      session.systemAudioPath,
      session.mediaAudioPath,
      session.scaleFactor,
    )
  }
  appState.recorderWin?.close()
}

/**
 * Cancels the recording and discards all associated files and processes.
 */
export async function cancelRecording() {
  log.info('Cancelling recording and deleting files...')
  await cleanupAndDiscard()
  appState.recorderWin?.webContents.send('recording-finished', { canceled: true })
  appState.recorderWin?.show()
}

/**
 * Stops trackers, writes metadata, and gracefully shuts down FFmpeg.
 */
function takeFfmpegProcesses(): ChildProcessWithoutNullStreams[] {
  const processes = [...appState.ffmpegProcesses]
  if (appState.ffmpegProcess && !processes.includes(appState.ffmpegProcess)) {
    processes.unshift(appState.ffmpegProcess)
  }
  appState.ffmpegProcess = null
  appState.ffmpegProcesses = []
  return processes
}

function takeSystemAudioHelperProcess(): ChildProcessWithoutNullStreams | null {
  const process = appState.systemAudioHelperProcess
  appState.systemAudioHelperProcess = null
  return process
}

function stopFfmpegProcess(ffmpeg: ChildProcessWithoutNullStreams, label: string): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false
    let gracefulKillTimer: NodeJS.Timeout | null = null
    let forceKillTimer: NodeJS.Timeout | null = null
    let forceResolveTimer: NodeJS.Timeout | null = null

    const resolveOnce = () => {
      if (resolved) return
      resolved = true
      if (gracefulKillTimer) clearTimeout(gracefulKillTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (forceResolveTimer) clearTimeout(forceResolveTimer)
      resolve()
    }

    if (ffmpeg.exitCode !== null || ffmpeg.signalCode !== null) {
      log.info(
        `[StopRecord:${label}] FFmpeg had already exited. exitCode=${ffmpeg.exitCode} signal=${ffmpeg.signalCode}`,
      )
      resolveOnce()
      return
    }

    ffmpeg.once('close', (code: any, signal: any) => {
      log.info(`[StopRecord:${label}] FFmpeg process exited with code ${code} signal ${signal ?? 'none'}`)
      resolveOnce()
    })

    ffmpeg.once('error', (error: any) => {
      log.error(`[StopRecord:${label}] FFmpeg process emitted an error during shutdown:`, error)
      resolveOnce()
    })

    if (ffmpeg.stdin) {
      ffmpeg.stdin.once('error', (error: any) => {
        log.warn(`[StopRecord:${label}] FFmpeg stdin error during shutdown:`, error)
      })
    }

    try {
      if (ffmpeg.stdin && !ffmpeg.stdin.destroyed && ffmpeg.stdin.writable) {
        log.info(`[StopRecord:${label}] Requesting graceful FFmpeg shutdown via stdin.`)
        ffmpeg.stdin.write('q')
        ffmpeg.stdin.end()
      } else {
        log.warn(`[StopRecord:${label}] FFmpeg stdin is not writable; falling back to signals.`)
        ffmpeg.kill('SIGINT')
      }
    } catch (error) {
      log.warn(`[StopRecord:${label}] Failed to request graceful FFmpeg shutdown, sending SIGINT instead:`, error)
      try {
        ffmpeg.kill('SIGINT')
      } catch (killError) {
        log.error(`[StopRecord:${label}] Failed to send SIGINT to FFmpeg:`, killError)
      }
    }

    gracefulKillTimer = setTimeout(() => {
      if (resolved) return
      log.warn(`[StopRecord:${label}] FFmpeg did not exit after graceful request; sending SIGINT.`)
      try {
        ffmpeg.kill('SIGINT')
      } catch (error) {
        log.error(`[StopRecord:${label}] Failed to send SIGINT to FFmpeg after grace period:`, error)
      }
    }, FFMPEG_STOP_GRACE_PERIOD_MS)

    forceKillTimer = setTimeout(() => {
      if (resolved) return
      log.error(`[StopRecord:${label}] FFmpeg is still running; sending SIGKILL.`)
      try {
        ffmpeg.kill('SIGKILL')
      } catch (error) {
        log.error(`[StopRecord:${label}] Failed to send SIGKILL to FFmpeg:`, error)
      }
    }, FFMPEG_STOP_FORCE_PERIOD_MS)

    forceResolveTimer = setTimeout(() => {
      if (resolved) return
      log.error(`[StopRecord:${label}] FFmpeg shutdown timed out. Continuing cleanup to avoid blocking the UI.`)
      resolveOnce()
    }, FFMPEG_STOP_RESOLVE_PERIOD_MS)
  })
}

async function cleanupAndSave(): Promise<void> {
  if (appState.mouseTracker) {
    appState.mouseTracker.stop()
    appState.mouseTracker = null
  }

  const systemAudioHelper = takeSystemAudioHelperProcess()
  if (systemAudioHelper) {
    await stopSystemAudioHelperProcess(systemAudioHelper)
  }

  const processes = takeFfmpegProcesses()
  await Promise.all(
    processes.map((process, index) => stopFfmpegProcess(process, index === 0 ? 'main' : `aux-${index}`)),
  )
}

/**
 * Processes mouse events against the final video start time and saves the metadata file.
 * @param session The current recording session.
 * @returns A promise that resolves to true on success, false on failure.
 */
/**
 * Linux may still need metadata scaling. Windows geometry is physical from capture startup.
 */
function getScaledGeometry(geometry: RecordingGeometry, scaleFactor: number): RecordingGeometry {
  if (!shouldApplyLinuxDisplayScale(scaleFactor)) {
    return geometry
  }
  return {
    x: Math.floor(geometry.x * scaleFactor),
    y: Math.floor(geometry.y * scaleFactor),
    width: Math.floor(geometry.width * scaleFactor),
    height: Math.floor(geometry.height * scaleFactor),
  }
}

/**
 * Processes mouse events against the final video start time and saves the metadata file.
 * @param session The current recording session.
 * @returns A promise that resolves to true on success, false on failure.
 */
async function processAndSaveMetadata(session: RecordingSession): Promise<boolean> {
  try {
    const videoStartTime = await getVideoStartTime(session.screenVideoPath)
    log.info(`[SYNC] Precise video start time from ffprobe: ${new Date(videoStartTime).toISOString()}`)

    const scaleFactor = session.scaleFactor || 1
    const finalEvents = appState.recordedMouseEvents.map((event) => {
      const shouldScaleLinuxEvent = shouldApplyLinuxDisplayScale(scaleFactor)
      const scaledX = shouldScaleLinuxEvent ? event.x * scaleFactor : event.x
      const scaledY = shouldScaleLinuxEvent ? event.y * scaleFactor : event.y
      return {
        ...event,
        x: scaledX,
        y: scaledY,
        timestamp: Math.max(0, event.timestamp - videoStartTime),
      }
    })

    const scaledGeometry = getScaledGeometry(session.recordingGeometry, scaleFactor)

    const primaryDisplay = screen.getPrimaryDisplay()
    const finalMetadata = {
      platform: process.platform,
      screenSize: primaryDisplay.size,
      geometry: scaledGeometry,
      screenCaptureBackend: session.screenCaptureBackend,
      requestedScreenFps: session.requestedScreenFps,
      ffmpegVersion: getFFmpegVersionLine(),
      syncOffset: 0,
      cursorImages: Object.fromEntries(appState.runtimeCursorImageMap || []),
      events: finalEvents,
    }

    await fsPromises.writeFile(session.metadataPath, JSON.stringify(finalMetadata))
    log.info(`[SYNC] Metadata saved to ${session.metadataPath}`)
    return true
  } catch (err) {
    log.error(`Failed to process and save metadata: ${err}`)
    // Write an empty metadata file to avoid Editor crash
    const scaledGeometry = getScaledGeometry(session.recordingGeometry, session.scaleFactor || 1)
    const errorMetadata = {
      platform: process.platform,
      events: [],
      cursorImages: {},
      geometry: scaledGeometry,
      screenSize: screen.getPrimaryDisplay().size,
      screenCaptureBackend: session.screenCaptureBackend,
      requestedScreenFps: session.requestedScreenFps,
      ffmpegVersion: getFFmpegVersionLine(),
      syncOffset: 0,
    }
    await fsPromises.writeFile(session.metadataPath, JSON.stringify(errorMetadata))
    return false
  }
}

/**
 * Forcefully terminates all recording processes and deletes any temporary files.
 */
export async function cleanupAndDiscard() {
  if (!appState.currentRecordingSession) return
  log.warn('[Cleanup] Discarding current recording session.')
  const sessionToDiscard = { ...appState.currentRecordingSession }
  appState.currentRecordingSession = null

  const systemAudioHelper = takeSystemAudioHelperProcess()
  if (systemAudioHelper) {
    try {
      systemAudioHelper.kill('SIGKILL')
    } catch {
      // ignore helper cleanup failures during discard
    }
  }

  for (const ffmpegProcess of takeFfmpegProcesses()) {
    ffmpegProcess.kill('SIGKILL')
  }

  appState.mouseTracker?.stop()
  appState.mouseTracker = null

  appState.recordedMouseEvents = []
  appState.runtimeCursorImageMap = new Map()

  restoreOriginalCursorScale()
  appState.tray?.destroy()
  appState.tray = null

  // Asynchronously delete files to not block the UI
  setTimeout(async () => {
    await cleanupEditorFiles(sessionToDiscard)
  }, 200)
}

/**
 * Scans the recording directory for leftover files from crashed sessions and deletes them.
 */
export async function cleanupOrphanedRecordings() {
  log.info('[Cleanup] Starting orphaned recording cleanup...')
  const recordingDir = getRecordingRootDir()
  const protectedFiles = new Set<string>()

  // Protect files from the currently active editor or recording session
  if (appState.currentEditorSessionFiles) {
    Object.values(appState.currentEditorSessionFiles).forEach((file) => file && protectedFiles.add(file))
  }
  if (appState.currentRecordingSession) {
    Object.values(appState.currentRecordingSession).forEach((file) => file && protectedFiles.add(String(file)))
  }

  try {
    const allFiles = await fsPromises.readdir(recordingDir)
    const filePattern =
      /^RecordSaaS-recording-\d+(-screen\.mp4|-webcam\.mp4|-audio\.(aac|mp3)|-system-audio(?:-raw)?\.(aac|mp3|wav)|\.json)$/
    const filesToDelete = allFiles
      .filter((file) => filePattern.test(file))
      .map((file) => path.join(recordingDir, file))
      .filter((fullPath) => !protectedFiles.has(fullPath))

    if (filesToDelete.length === 0) {
      log.info('[Cleanup] No orphaned files found.')
      return
    }
    log.warn(`[Cleanup] Found ${filesToDelete.length} orphaned files to delete.`)
    for (const filePath of filesToDelete) {
      try {
        await fsPromises.unlink(filePath)
        log.info(`[Cleanup] Deleted orphaned file: ${filePath}`)
      } catch (unlinkError) {
        log.error(`[Cleanup] Failed to delete orphaned file: ${filePath}`, unlinkError)
      }
    }
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error('[Cleanup] Error during orphaned file cleanup:', error)
    }
  }
}

/**
 * Event handler for application quit, ensuring recordings are cleaned up before exit.
 */
export async function onAppQuit(event: Electron.Event) {
  if (appState.currentRecordingSession && !appState.isCleanupInProgress) {
    log.warn('[AppQuit] Active session detected. Cleaning up before exit...')
    event.preventDefault()
    appState.isCleanupInProgress = true
    try {
      await cleanupAndDiscard()
      log.info('[AppQuit] Cleanup finished.')
    } catch (error) {
      log.error('[AppQuit] Error during cleanup:', error)
    } finally {
      app.quit()
    }
  }
}

/**
 * Opens a file dialog to allow the user to import an existing video file for editing.
 */
export async function loadVideoFromFile() {
  log.info('[RecordingManager] Received load video from file request.')
  const recorderWindow = appState.recorderWin
  if (!recorderWindow) return { canceled: true }

  const { canceled, filePaths } = await dialog.showOpenDialog(recorderWindow, {
    title: 'Select a video file to edit',
    properties: ['openFile'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
  })

  if (canceled || filePaths.length === 0) return { canceled: true }

  const sourceVideoPath = filePaths[0]
  log.info(`[RecordingManager] User selected video file: ${sourceVideoPath}`)
  recorderWindow.hide()
  createSavingWindow()

  try {
    const recordingDir = await createRecordingSessionDir()
    const baseName = `RecordSaaS-recording-${Date.now()}`
    const screenVideoPath = path.join(recordingDir, `${baseName}-screen.mp4`)
    const metadataPath = path.join(recordingDir, `${baseName}.json`)

    await fsPromises.copyFile(sourceVideoPath, screenVideoPath)
    await fsPromises.writeFile(
      metadataPath,
      JSON.stringify({
        platform: process.platform,
        events: [],
        cursorImages: {},
        syncOffset: 0,
      }),
      'utf-8',
    )

    // A "fake" geometry is needed for imported videos. It will match the video dimensions.
    const session: RecordingSession = {
      screenVideoPath,
      metadataPath,
      webcamVideoPath: undefined,
      recordingGeometry: { x: 0, y: 0, width: 0, height: 0 },
      scaleFactor: 1, // No scaling for imported videos
    }
    const isValid = await validateRecordingFiles(session)
    if (!isValid) {
      await cleanupEditorFiles(session)
      appState.savingWin?.close()
      recorderWindow.show()
      return { canceled: true }
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    appState.savingWin?.close()
    createEditorWindow(
      screenVideoPath,
      metadataPath,
      session.recordingGeometry,
      undefined,
      undefined,
      undefined,
      undefined,
      session.scaleFactor,
    )
    recorderWindow.close()
    return { canceled: false, filePath: screenVideoPath }
  } catch (error) {
    log.error('[RecordingManager] Error loading video from file:', error)
    dialog.showErrorBox('Error Loading Video', `An error occurred while loading the video: ${(error as Error).message}`)
    appState.savingWin?.close()
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.show()
    }
    return { canceled: true }
  }
}

/**
 * Opens a file dialog to allow the user to import an existing RecordSaaS project.
 */
export async function importProjectFromFile() {
  log.info('[RecordingManager] Received import project from file request.')
  const recorderWindow = appState.recorderWin
  if (!recorderWindow) return { canceled: true }

  const { canceled, filePaths } = await dialog.showOpenDialog(recorderWindow, {
    title: 'Select a RecordSaaS Project to import',
    properties: ['openFile'],
    filters: [{ name: 'RecordSaaS Project', extensions: ['rsproj'] }],
  })

  if (canceled || filePaths.length === 0) return { canceled: true }

  return importProjectFromPath(filePaths[0])
}

export async function importProjectFromPath(sourceProjectPath: string) {
  log.info('[RecordingManager] Received import project path request.')
  const recorderWindow = appState.recorderWin
  if (!recorderWindow) return { canceled: true }

  if (typeof sourceProjectPath !== 'string' || sourceProjectPath.trim().length === 0) {
    dialog.showErrorBox('Invalid Project File', 'Please select a valid .rsproj file.')
    return { canceled: true }
  }

  const normalizedSourceProjectPath = normalizeMediaPath(sourceProjectPath) || sourceProjectPath
  if (path.extname(normalizedSourceProjectPath).toLowerCase() !== '.rsproj') {
    dialog.showErrorBox('Invalid Project File', 'Please select a valid .rsproj file.')
    return { canceled: true }
  }
  log.info(`[RecordingManager] User selected project file: ${normalizedSourceProjectPath}`)
  const sourceProjectDir = path.dirname(normalizedSourceProjectPath)

  recorderWindow.hide()
  createSavingWindow()

  try {
    const recordingDir = await createRecordingSessionDir()

    // Read project configuration
    const rawData = await fsPromises.readFile(normalizedSourceProjectPath, 'utf-8')
    const projectData = JSON.parse(rawData) as ImportedProjectPayload

    const baseName = `RecordSaaS-recording-${Date.now()}`
    const metadataPath = path.join(recordingDir, `${baseName}.json`)

    const resolveExistingSourcePath = async (originalPath: string | null | undefined): Promise<string | null> => {
      if (!originalPath) return null
      const normalized = normalizeMediaPath(originalPath)
      if (!normalized) return null
      const candidates = path.isAbsolute(normalized)
        ? [normalized, path.join(sourceProjectDir, path.basename(normalized))]
        : [path.join(sourceProjectDir, normalized), path.join(sourceProjectDir, path.basename(normalized))]

      for (const candidate of new Set(candidates)) {
        try {
          await fsPromises.access(candidate)
          return candidate
        } catch {
          // Try next candidate
        }
      }
      return null
    }

    // Copy any referenced media file into the secure runtime directory.
    const importMediaFile = async (
      originalPath: string | null | undefined,
      label: string,
    ): Promise<string | undefined> => {
      const sourcePath = await resolveExistingSourcePath(originalPath)
      if (!sourcePath) {
        if (originalPath) {
          log.error(`[RecordingManager] Failed to resolve imported ${label} path: ${originalPath}`)
        }
        return undefined
      }

      const targetPath = path.join(recordingDir, path.basename(sourcePath))
      try {
        await fsPromises.copyFile(sourcePath, targetPath)
        return targetPath
      } catch (err) {
        log.error(`[RecordingManager] Failed to copy imported ${label} from ${sourcePath}:`, err)
        return undefined
      }
    }

    // Import media assets.
    const screenVideoPath = await importMediaFile(projectData.videoPath, 'main video')
    if (!screenVideoPath) {
      throw new Error('Could not import the main video file referenced by the selected project.')
    }
    const webcamVideoPath = await importMediaFile(projectData.webcamVideoPath, 'webcam video')
    const audioPath = await importMediaFile(projectData.audioPath, 'audio track')
    const systemAudioPath = await importMediaFile(
      getProjectFirstField(projectData, null, 'systemAudioPath') || null,
      'computer audio track',
    )

    // Copy canonical metadata if available; this is the source of cursor/mouse events.
    let hasCanonicalMetadataFile = false
    const canonicalMetadataSource = await resolveExistingSourcePath(projectData.metadataPath)
    if (canonicalMetadataSource) {
      try {
        await fsPromises.copyFile(canonicalMetadataSource, metadataPath)
        hasCanonicalMetadataFile = true
      } catch (err) {
        log.error(`[RecordingManager] Failed to copy imported metadata from ${canonicalMetadataSource}:`, err)
      }
    } else {
      log.warn('[RecordingManager] Import project metadata file was not found. Falling back to project JSON fields.')
    }

    let canonicalMetadata: ImportedProjectPayload | null = null
    if (hasCanonicalMetadataFile) {
      try {
        const canonicalRaw = await fsPromises.readFile(metadataPath, 'utf-8')
        canonicalMetadata = JSON.parse(canonicalRaw) as ImportedProjectPayload
      } catch (err) {
        log.error('[RecordingManager] Failed to parse canonical metadata. Falling back to project JSON fields.', err)
      }
    }

    const rawTimelineLanes = getProjectFirstField(projectData, canonicalMetadata, 'timelineLanes')
    const normalizedTimelineLanes = normalizeTimelineLanes(rawTimelineLanes)
    const fallbackTimelineLaneId = getFallbackTimelineLaneId(normalizedTimelineLanes)

    const rawMediaAudioClip = getProjectFirstField(projectData, canonicalMetadata, 'mediaAudioClip') || null
    const importedMediaAudioPath = await importMediaFile(rawMediaAudioClip?.path || null, 'media audio clip')

    const fallbackEvents = Array.isArray(projectData.events)
      ? projectData.events
      : Array.isArray(projectData.metadata)
        ? projectData.metadata
        : []
    const mergedEvents = Array.isArray(canonicalMetadata?.events) ? canonicalMetadata.events : fallbackEvents

    const fallbackCursorImages =
      projectData.cursorImages && typeof projectData.cursorImages === 'object' ? projectData.cursorImages : {}
    const mergedCursorImages =
      canonicalMetadata?.cursorImages && typeof canonicalMetadata.cursorImages === 'object'
        ? canonicalMetadata.cursorImages
        : fallbackCursorImages

    const mergedGeometry = canonicalMetadata?.recordingGeometry ||
      canonicalMetadata?.geometry ||
      projectData.recordingGeometry ||
      projectData.geometry || { x: 0, y: 0, width: 0, height: 0 }

    const mergedRuntimeMetadata: RuntimeProjectMetadata = {
      ...projectData,
      platform: (canonicalMetadata?.platform || projectData.platform || process.platform) as NodeJS.Platform,
      screenSize: canonicalMetadata?.screenSize || projectData.screenSize || null,
      syncOffset:
        typeof canonicalMetadata?.syncOffset === 'number'
          ? canonicalMetadata.syncOffset
          : typeof projectData.syncOffset === 'number'
            ? projectData.syncOffset
            : 0,
      events: Array.isArray(mergedEvents) ? mergedEvents : [],
      cursorImages: mergedCursorImages,
      geometry: mergedGeometry,
      recordingGeometry: mergedGeometry,
      timelineLanes: normalizedTimelineLanes,
      systemAudioPath: systemAudioPath || undefined,
    }

    if (rawMediaAudioClip && importedMediaAudioPath) {
      mergedRuntimeMetadata.mediaAudioClip = {
        ...rawMediaAudioClip,
        id: rawMediaAudioClip.id || `media-audio-${Date.now()}`,
        path: importedMediaAudioPath,
        url: toMediaUrl(importedMediaAudioPath) || '',
        name: rawMediaAudioClip.name || path.basename(importedMediaAudioPath),
        duration:
          typeof rawMediaAudioClip.duration === 'number' && Number.isFinite(rawMediaAudioClip.duration)
            ? Math.max(0, rawMediaAudioClip.duration)
            : 0,
        startTime:
          typeof rawMediaAudioClip.startTime === 'number' && Number.isFinite(rawMediaAudioClip.startTime)
            ? Math.max(0, rawMediaAudioClip.startTime)
            : 0,
      }
    } else {
      mergedRuntimeMetadata.mediaAudioClip = null
    }

    const rawMediaAudioRegions = getProjectFirstField(projectData, canonicalMetadata, 'mediaAudioRegions') || {}
    const normalizedMediaAudioRegions: ImportedProjectPayload['mediaAudioRegions'] = {}
    if (mergedRuntimeMetadata.mediaAudioClip && rawMediaAudioRegions && typeof rawMediaAudioRegions === 'object') {
      const clipDuration = Math.max(0, mergedRuntimeMetadata.mediaAudioClip.duration || 0)

      for (const [regionId, rawRegion] of Object.entries(rawMediaAudioRegions)) {
        if (!rawRegion || typeof rawRegion !== 'object') continue

        const startTime =
          typeof rawRegion.startTime === 'number' && Number.isFinite(rawRegion.startTime)
            ? Math.max(0, rawRegion.startTime)
            : 0
        const sourceStart =
          typeof rawRegion.sourceStart === 'number' && Number.isFinite(rawRegion.sourceStart)
            ? Math.max(0, rawRegion.sourceStart)
            : 0
        const availableDuration = clipDuration > 0 ? Math.max(0.1, clipDuration - sourceStart) : 1
        const duration =
          typeof rawRegion.duration === 'number' && Number.isFinite(rawRegion.duration)
            ? Math.max(0.1, Math.min(rawRegion.duration, availableDuration))
            : availableDuration
        const fadeInDuration =
          typeof rawRegion.fadeInDuration === 'number' && Number.isFinite(rawRegion.fadeInDuration)
            ? Math.max(0, Math.min(rawRegion.fadeInDuration, duration))
            : 0
        const fadeOutDuration =
          typeof rawRegion.fadeOutDuration === 'number' && Number.isFinite(rawRegion.fadeOutDuration)
            ? Math.max(0, Math.min(rawRegion.fadeOutDuration, duration))
            : 0
        const volume =
          typeof rawRegion.volume === 'number' && Number.isFinite(rawRegion.volume)
            ? Math.max(0, Math.min(rawRegion.volume, 1))
            : 1

        normalizedMediaAudioRegions[regionId] = {
          id: regionId || rawRegion.id || `media-audio-${Date.now()}`,
          type: 'media-audio',
          laneId: resolveImportedLaneId(rawRegion.laneId, normalizedTimelineLanes, fallbackTimelineLaneId),
          startTime,
          duration,
          sourceStart,
          isMuted: rawRegion.isMuted === true,
          volume,
          fadeInDuration,
          fadeOutDuration,
          zIndex: typeof rawRegion.zIndex === 'number' && Number.isFinite(rawRegion.zIndex) ? rawRegion.zIndex : 0,
        }
      }

      if (Object.keys(normalizedMediaAudioRegions).length === 0) {
        const legacyDuration =
          mergedRuntimeMetadata.mediaAudioClip.duration && mergedRuntimeMetadata.mediaAudioClip.duration > 0
            ? mergedRuntimeMetadata.mediaAudioClip.duration
            : 1
        const regionId = `media-audio-${Date.now()}`
        normalizedMediaAudioRegions[regionId] = {
          id: regionId,
          type: 'media-audio',
          laneId: fallbackTimelineLaneId,
          startTime: mergedRuntimeMetadata.mediaAudioClip.startTime || 0,
          duration: legacyDuration,
          sourceStart: 0,
          isMuted: false,
          volume: 1,
          fadeInDuration: 0,
          fadeOutDuration: 0,
          zIndex: 0,
        }
      }
    }
    mergedRuntimeMetadata.mediaAudioRegions = normalizedMediaAudioRegions

    const rawChangeSoundRegions = getProjectFirstField(projectData, canonicalMetadata, 'changeSoundRegions') || {}
    const normalizedChangeSoundRegions: ImportedProjectPayload['changeSoundRegions'] = {}
    if (rawChangeSoundRegions && typeof rawChangeSoundRegions === 'object') {
      for (const [regionId, rawRegion] of Object.entries(rawChangeSoundRegions)) {
        if (!rawRegion || typeof rawRegion !== 'object') continue

        const startTime =
          typeof rawRegion.startTime === 'number' && Number.isFinite(rawRegion.startTime)
            ? Math.max(0, rawRegion.startTime)
            : 0
        const duration =
          typeof rawRegion.duration === 'number' && Number.isFinite(rawRegion.duration)
            ? Math.max(0.1, rawRegion.duration)
            : 1
        const volume =
          typeof rawRegion.volume === 'number' && Number.isFinite(rawRegion.volume)
            ? Math.max(0, Math.min(rawRegion.volume, 1))
            : 1
        const fadeInDuration =
          typeof rawRegion.fadeInDuration === 'number' && Number.isFinite(rawRegion.fadeInDuration)
            ? Math.max(0, Math.min(rawRegion.fadeInDuration, duration))
            : 0
        const fadeOutDuration =
          typeof rawRegion.fadeOutDuration === 'number' && Number.isFinite(rawRegion.fadeOutDuration)
            ? Math.max(0, Math.min(rawRegion.fadeOutDuration, duration))
            : 0

        normalizedChangeSoundRegions[regionId] = {
          id: regionId || rawRegion.id || `change-sound-${Date.now()}`,
          type: 'change-sound',
          laneId: resolveImportedLaneId(rawRegion.laneId, normalizedTimelineLanes, fallbackTimelineLaneId),
          startTime,
          duration,
          sourceKey: 'recording-mic',
          isMuted: rawRegion.isMuted === true,
          volume,
          fadeInDuration,
          fadeOutDuration,
          zIndex: typeof rawRegion.zIndex === 'number' && Number.isFinite(rawRegion.zIndex) ? rawRegion.zIndex : 0,
        }
      }
    }
    mergedRuntimeMetadata.changeSoundRegions = normalizedChangeSoundRegions

    if (mergedRuntimeMetadata.events.length === 0) {
      log.warn('[RecordingManager] Imported project contains no mouse events after metadata merge.')
    }

    // Persist merged runtime metadata consumed by the editor.
    await fsPromises.writeFile(metadataPath, JSON.stringify(mergedRuntimeMetadata), 'utf-8')

    // Prepare session validation
    const session: RecordingSession = {
      screenVideoPath,
      metadataPath,
      webcamVideoPath,
      audioPath,
      systemAudioPath,
      mediaAudioPath: importedMediaAudioPath,
      recordingGeometry: mergedGeometry,
      scaleFactor: typeof projectData.scaleFactor === 'number' ? projectData.scaleFactor : 1,
      originalProjectPath: sourceProjectDir,
    }

    const isValid = await validateRecordingFiles(session)
    if (!isValid) {
      await cleanupEditorFiles(session)
      appState.savingWin?.close()
      recorderWindow.show()
      return { canceled: true }
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
    appState.savingWin?.close()

    createEditorWindow(
      session.screenVideoPath,
      session.metadataPath,
      session.recordingGeometry,
      session.webcamVideoPath,
      session.audioPath,
      session.systemAudioPath,
      session.mediaAudioPath,
      session.scaleFactor,
      sourceProjectDir, // Pass the original directory path
    )

    recorderWindow.close()
    return { canceled: false, filePath: session.screenVideoPath }
  } catch (error) {
    log.error('[RecordingManager] Error loading project from file:', error)
    dialog.showErrorBox(
      'Error Loading Project',
      `An error occurred while loading the project: ${(error as Error).message}`,
    )
    appState.savingWin?.close()
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.show()
    }
    return { canceled: true }
  }
}
