/* eslint-disable @typescript-eslint/no-explicit-any */
// Contains core business logic for recording, stopping, and cleanup.

import log from 'electron-log/main'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import fsPromises from 'node:fs/promises'
import { cpus } from 'node:os'
import { app, Menu, Tray, nativeImage, screen, ipcMain, dialog, systemPreferences } from 'electron'
import { appState } from '../state'
import { getFFmpegPath, ensureDirectoryExists, getFFmpegSpawnErrorMessage } from '../lib/utils'
import { VITE_PUBLIC } from '../lib/constants'
import { normalizeMediaPath, toMediaUrl } from '../lib/media-url'
import { createMouseTracker } from './mouse-tracker'
import { getCursorScale, restoreOriginalCursorScale, resetCursorScale } from './cursor-manager'
import { createEditorWindow, cleanupEditorFiles } from '../windows/editor-window'
import { createSavingWindow, createSelectionWindow } from '../windows/temporary-windows'
import type { RecordingSession, RecordingGeometry } from '../state'

const FFMPEG_PATH = getFFmpegPath()

type ImportedProjectPayload = {
  videoPath?: string | null
  metadataPath?: string | null
  webcamVideoPath?: string | null
  audioPath?: string | null
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
type RecordingProfile = {
  id?: string
  name?: string
  isNative?: boolean
  screenResolution?: RecordingResolution
  screenFps?: RecordingScreenFps
  webcamResolution?: RecordingResolution
  webcamFps?: RecordingWebcamFps
}
type RecordingProfileRuntime = {
  isNative: boolean
  screenResolution: RecordingResolution
  screenFps: RecordingScreenFps
  webcamResolution: RecordingResolution
  webcamFps: RecordingWebcamFps
}
type RecordingOutputOptions = {
  screenScale?: { width: number; height: number }
  screenFps?: RecordingScreenFps
}
type RecordingCapabilityProbeBackend = 'ddagrab' | 'gdigrab' | 'x11grab'
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

const normalizeRecordingFps = (value: unknown, fallback: RecordingScreenFps): RecordingScreenFps => {
  if (value === 30 || value === 60 || value === 120) return value
  return fallback
}

const normalizeWebcamFps = (value: unknown, fallback: RecordingWebcamFps): RecordingWebcamFps => {
  if (value === 'synced' || value === 30 || value === 60) return value
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
      screenFps: normalizeRecordingFps(value?.screenFps, 60) === 120 ? 60 : normalizeRecordingFps(value?.screenFps, 60),
      webcamResolution: 'native',
      webcamFps: 30,
    }
  }

  return {
    isNative: false,
    screenResolution: normalizeRecordingResolution(value?.screenResolution, 'native'),
    screenFps: normalizeRecordingFps(value?.screenFps, 60),
    webcamResolution: normalizeRecordingResolution(value?.webcamResolution, 'native'),
    webcamFps: normalizeWebcamFps(value?.webcamFps, 'synced'),
  }
}

const resolveScaledDimensions = (width: number, height: number, resolution: RecordingResolution): { width: number; height: number } | null => {
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
  const webcamSize = profile.isNative && context.screenWidth && context.screenHeight
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

const probeWin32DshowWebcamInput = (
  deviceLabel: string,
  fps: 30 | 60,
  size: { width: number; height: number } | undefined,
): Promise<boolean> =>
  new Promise((resolve) => {
    const args = ['-hide_banner', '-f', 'dshow', '-framerate', String(fps)]
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

  for (const candidate of getWin32WebcamFallbackSizes(desiredSize)) {
    const canOpen = await probeWin32DshowWebcamInput(webcam.deviceLabel, fps, candidate)
    if (canOpen) {
      if (!isSameWebcamSize(candidate, desiredSize)) {
        log.warn(
          `[RecordingManager] Webcam rejected requested capture size ${desiredSize ? `${desiredSize.width}x${desiredSize.height}` : 'native/default'}; using ${
            candidate ? `${candidate.width}x${candidate.height}` : 'device default'
          } instead.`,
        )
      }
      return { fps, size: candidate }
    }
  }

  log.warn('[RecordingManager] Webcam probe failed for all explicit sizes; falling back to DShow device default.')
  return { fps }
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
  const frameDerivedFps =
    frameCount && durationSeconds && durationSeconds > 0
      ? frameCount / durationSeconds
      : null

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
  return process.platform === 'linux' && Number.isFinite(scaleFactor) && scaleFactor > 0 && Math.abs(scaleFactor - 1) > 0.001
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

function isFFmpegRecordingReadyMessage(message: string): boolean {
  return (
    message.includes('Press [q] to stop') ||
    message.includes('Output #0,') ||
    message.includes('frame=')
  )
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
  const detail =
    finalProbe.detail || `${devicePath} remained busy after ${LINUX_WEBCAM_RELEASE_PROBE_TIMEOUT_MS}ms.`
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

  log.info('[Validation] All recorded files appear valid (exist and are not empty).')
  return true
}

/**
 * Trims the audio file by removing the specified amount from the beginning.
 * @param audioPath - Path to the audio file to trim
 * @param trimMs - Amount to trim from the beginning in milliseconds (default 1000ms)
 * @returns Promise that resolves to the path of the trimmed audio file
 */
async function trimAudioFile(audioPath: string, trimMs: number = 1000): Promise<string> {
  const trimmedPath = audioPath.replace(/\.aac$/, '-trimmed.aac')
  const trimSeconds = trimMs / 1000

  log.info(`[AudioTrim] Trimming ${trimMs}ms from beginning of ${audioPath}`)

  return new Promise((resolve, reject) => {
    const ffmpegArgs = [
      '-y',
      '-ss',
      trimSeconds.toString(),
      '-i',
      audioPath,
      '-c:a',
      'copy',
      trimmedPath,
    ]

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

/**
 * The core function that spawns FFmpeg and the mouse tracker to begin recording.
 * @param inputArgs - Platform-specific FFmpeg input arguments.
 * @param hasWebcam - Flag indicating if webcam recording is enabled.
 * @param hasMic - Flag indicating if microphone recording is enabled.
 * @param recordingGeometry - The logical dimensions and position of the recording area.
 * @param scaleFactor - The display scale factor (for Windows DPI scaling).
 */
async function startActualRecording(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  recordingGeometry: RecordingGeometry,
  scaleFactor: number = 1,
  outputOptions: RecordingOutputOptions = {},
) {
  const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.recordsaas')
  await ensureDirectoryExists(recordingDir)
  const baseName = `RecordSaaS-recording-${Date.now()}`

  const screenVideoPath = path.join(recordingDir, `${baseName}-screen.mp4`)
  const webcamVideoPath = hasWebcam ? path.join(recordingDir, `${baseName}-webcam.mp4`) : undefined
  const audioPath = hasMic ? path.join(recordingDir, `${baseName}-audio.aac`) : undefined
  const metadataPath = path.join(recordingDir, `${baseName}.json`)

  // Store recordingGeometry and scaleFactor in the session
  appState.currentRecordingSession = { screenVideoPath, webcamVideoPath, audioPath, metadataPath, recordingGeometry, scaleFactor }
  appState.recorderWin?.minimize()

  // Reset state for the new session
  appState.recordingStartTime = Date.now()
  appState.recordedMouseEvents = []
  appState.runtimeCursorImageMap = new Map()
  appState.mouseTracker = createMouseTracker()

  if (appState.mouseTracker) {
    appState.mouseTracker.on('data', (data: any) => {
      // Normalize mouse coordinates based on platform
      // On Windows, mouse events come in physical pixels (with DPI scaling)
      // On other platforms, they're in logical pixels
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

  const finalArgs = buildFfmpegArgs(inputArgs, hasWebcam, hasMic, screenVideoPath, webcamVideoPath, audioPath, outputOptions)
  log.info(`[FFMPEG] Starting FFmpeg with args: ${finalArgs.join(' ')}`)
  const ffmpeg = spawn(FFMPEG_PATH, finalArgs)
  appState.ffmpegProcess = ffmpeg

  return new Promise((resolve) => {
    let startResolved = false
    let fatalStartupHandled = false
    let recordingReady = false
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

    const markRecordingReady = () => {
      if (recordingReady) return
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

    ffmpeg.once('spawn', () => {
      log.info('[FFMPEG] Process spawned, waiting for recording pipeline to become ready...')
    })

    ffmpeg.once('error', (error: NodeJS.ErrnoException) => {
      appState.ffmpegProcess = null
      log.error('[FFMPEG] Failed to start FFmpeg process:', error)
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

      log.error(`[FFMPEG] Process exited before recording became ready. code=${code} signal=${signal}`)
      const startupDetail = startupErrorText.trim()
      const errorMessage = startupDetail.includes('Device or resource busy')
        ? `The selected recording device is busy.\n\n${startupDetail}\n\nClose any app that is using the webcam or microphone and try again.`
        : startupDetail.length > 0
          ? `FFmpeg exited before the recording could start.\n\n${startupDetail}`
          : `FFmpeg exited before the recording could start.\n\ncode=${code ?? 'null'} signal=${signal ?? 'none'}`
      dialog.showErrorBox(
        'Recording Failed',
        errorMessage,
      )
      cleanupFailedRecordingStart()
      resolveOnce({ canceled: true })
    })

    // Monitor FFmpeg's stderr for progress, errors, and sync timing
    ffmpeg.stderr.on('data', (data: any) => {
      const message = data.toString()
      startupErrorText = message
      log.warn(`[FFMPEG stderr]: ${message}`)

      if (!recordingReady && isFFmpegRecordingReadyMessage(message)) {
        markRecordingReady()
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
        log.error(`[FFMPEG] Fatal error detected: ${message}`)
        dialog.showErrorBox(
          'Recording Failed',
          `A critical error occurred while starting the recording process:\n\n${message}\n\nPlease check your device permissions and configurations.`,
        )
        cleanupFailedRecordingStart()
      }
    })
  })
}

/**
 * Constructs the final FFmpeg command arguments by mapping input streams to output files.
 */
function buildFfmpegArgs(
  inputArgs: string[],
  hasWebcam: boolean,
  hasMic: boolean,
  screenOut: string,
  webcamOut?: string,
  audioOut?: string,
  outputOptions: RecordingOutputOptions = {},
): string[] {
  const finalArgs = [...inputArgs]
  // Determine the index of each input stream (mic, webcam, screen)
  const micIndex = hasMic ? 0 : -1
  const webcamIndex = hasMic ? (hasWebcam ? 1 : -1) : hasWebcam ? 0 : -1
  const screenIndex = (hasMic ? 1 : 0) + (hasWebcam ? 1 : 0)

  // Map screen video stream (video only, no audio)
  log.info(
    `[RecordingManager] Screen recording encode config: output=${screenOut} codec=libx264 preset=ultrafast crf=18 fps=${outputOptions.screenFps ?? 'input'} fps_mode=cfr pix_fmt=yuv420p`,
  )
  finalArgs.push(
    '-map',
    `${screenIndex}:v`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast', // Lowest CPU usage
    '-crf', '18', // Good quality
    '-tune', 'zerolatency', // Optimize for real-time
    '-profile:v',
    'high',
    '-level',
    '5.1',
    '-pix_fmt',
    'yuv420p',
  )
  if (outputOptions.screenScale) {
    finalArgs.push('-vf', `scale=${outputOptions.screenScale.width}:${outputOptions.screenScale.height}`)
  }
  if (outputOptions.screenFps) {
    finalArgs.push('-r', String(outputOptions.screenFps), '-fps_mode', 'cfr')
  }
  finalArgs.push(screenOut)

  // Map audio stream to separate file if present
  if (hasMic && audioOut) {
    finalArgs.push('-map', `${micIndex}:a`, '-c:a', 'aac', '-b:a', '192k', audioOut)
  }

  // Map webcam video stream if present
  if (hasWebcam && webcamOut) {
    log.info(
      `[RecordingManager] Webcam recording encode config: output=${webcamOut} codec=${WEBCAM_RECORDING_ENCODING_CONFIG.codec} preset=${WEBCAM_RECORDING_ENCODING_CONFIG.preset} crf=${WEBCAM_RECORDING_ENCODING_CONFIG.crf} maxrate=${WEBCAM_RECORDING_ENCODING_CONFIG.maxrate} bufsize=${WEBCAM_RECORDING_ENCODING_CONFIG.bufsize} pix_fmt=${WEBCAM_RECORDING_ENCODING_CONFIG.pixFmt}`,
    )
    finalArgs.push(
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

  return finalArgs
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
  const recordingProfile = normalizeRecordingProfile(options.recordingProfile)
  const screenFps = recordingProfile.screenFps
  const outputOptions: RecordingOutputOptions = { screenFps }
  log.info('[RecordingManager] Received start recording request with options:', options)
  log.info('[RecordingManager] Using recording profile:', recordingProfile)

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
  const baseFfmpegArgs: string[] = []
  let recordingGeometry: RecordingGeometry
  let recordingScaleFactor = 1  // Default to 1 for non-Windows or 100% scaling
  let webcamInputContext: WebcamInputContext = {}

  if (source === 'fullscreen') {
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    const { width, height } = targetDisplay.bounds
    const scaleFactor = targetDisplay.scaleFactor || 1
    webcamInputContext = {
      screenWidth:
        process.platform === 'win32'
          ? Math.floor((width * scaleFactor) / 2) * 2
          : process.platform === 'linux'
            ? getLinuxScaledDimension(width, scaleFactor)
            : Math.floor(width / 2) * 2,
      screenHeight:
        process.platform === 'win32'
          ? Math.floor((height * scaleFactor) / 2) * 2
          : process.platform === 'linux'
            ? getLinuxScaledDimension(height, scaleFactor)
            : Math.floor(height / 2) * 2,
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
    webcamInputContext = {
      screenWidth:
        process.platform === 'win32'
          ? Math.floor((safeWidth * scaleFactor) / 2) * 2
          : process.platform === 'linux'
            ? getLinuxScaledDimension(safeWidth, scaleFactor)
            : safeWidth,
      screenHeight:
        process.platform === 'win32'
          ? Math.floor((safeHeight * scaleFactor) / 2) * 2
          : process.platform === 'linux'
            ? getLinuxScaledDimension(safeHeight, scaleFactor)
            : safeHeight,
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
          baseFfmpegArgs.push('-f', 'alsa', '-i', linuxMicInput)
        }
        break
      case 'win32':
        baseFfmpegArgs.push('-f', 'dshow', '-i', `audio=${mic.deviceLabel}`)
        break
      case 'darwin':
        baseFfmpegArgs.push('-f', 'avfoundation', '-i', `:${mic.index}`)
        break
    }
  }
  if (webcam) {
    const webcamInputOptions = await resolveWebcamInputOptions(recordingProfile, webcamInputContext, webcam)
    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push('-f', 'v4l2')
        appendWebcamInputOptions(baseFfmpegArgs, webcamInputOptions)
        baseFfmpegArgs.push('-i', `/dev/video${webcam.index}`)
        break
      case 'win32':
        baseFfmpegArgs.push('-f', 'dshow')
        appendWebcamInputOptions(baseFfmpegArgs, webcamInputOptions)
        baseFfmpegArgs.push('-i', `video=${webcam.deviceLabel}`)
        break
      case 'darwin':
        baseFfmpegArgs.push('-f', 'avfoundation')
        appendWebcamInputOptions(baseFfmpegArgs, webcamInputOptions)
        baseFfmpegArgs.push('-i', `${webcam.index}:none`)
        break
    }
  }

  // --- Add Screen input last ---
  if (source === 'fullscreen') {
    const allDisplays = screen.getAllDisplays()
    const targetDisplay = allDisplays.find((d) => d.id === displayId) || screen.getPrimaryDisplay()
    const { x, y, width, height } = targetDisplay.bounds
    const scaleFactor = targetDisplay.scaleFactor || 1
    recordingScaleFactor = scaleFactor  // Store for metadata processing
    
    // For Windows, we need to use physical pixels for gdigrab
    const physicalWidth =
      process.platform === 'win32'
        ? Math.floor((width * scaleFactor) / 2) * 2
        : process.platform === 'linux'
          ? getLinuxScaledDimension(width, scaleFactor)
          : Math.floor(width / 2) * 2
    const physicalHeight =
      process.platform === 'win32'
        ? Math.floor((height * scaleFactor) / 2) * 2
        : process.platform === 'linux'
          ? getLinuxScaledDimension(height, scaleFactor)
          : Math.floor(height / 2) * 2
    const physicalX =
      process.platform === 'win32' ? Math.floor(x * scaleFactor) : process.platform === 'linux' ? getLinuxScaledOffset(x, scaleFactor) : x
    const physicalY =
      process.platform === 'win32' ? Math.floor(y * scaleFactor) : process.platform === 'linux' ? getLinuxScaledOffset(y, scaleFactor) : y
    
    // Store the logical dimensions for mouse tracking
    const safeWidth = Math.floor(width / 2) * 2
    const safeHeight = Math.floor(height / 2) * 2
    recordingGeometry = { x, y, width: safeWidth, height: safeHeight }
    outputOptions.screenScale = resolveScaledDimensions(safeWidth, safeHeight, recordingProfile.screenResolution) || undefined
    
    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push(
          '-f',
          'x11grab',
          '-framerate', String(screenFps),
          '-draw_mouse',
          '0',
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          `${display}+${physicalX},${physicalY}`,
        )
        break
      case 'win32':
        baseFfmpegArgs.push(
          '-f',
          'gdigrab',
          '-framerate', String(screenFps),
          '-draw_mouse',
          '0',
          '-offset_x',
          physicalX.toString(),
          '-offset_y',
          physicalY.toString(),
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          'desktop',
        )
        break
      case 'darwin':
        baseFfmpegArgs.push(
          '-f',
          'avfoundation',
          '-framerate', String(screenFps),
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
    outputOptions.screenScale = resolveScaledDimensions(safeWidth, safeHeight, recordingProfile.screenResolution) || undefined

    // Get scale factor for the display containing the selection
    const allDisplays = screen.getAllDisplays()
    const containingDisplay = allDisplays.find((d) => {
      const b = d.bounds
      return selectedGeometry.x >= b.x && selectedGeometry.y >= b.y &&
             selectedGeometry.x + selectedGeometry.width <= b.x + b.width &&
             selectedGeometry.y + selectedGeometry.height <= b.y + b.height
    }) || screen.getPrimaryDisplay()
    const scaleFactor = containingDisplay.scaleFactor || 1
    recordingScaleFactor = scaleFactor  // Store for metadata processing

    // For Windows, convert to physical pixels
    const physicalWidth =
      process.platform === 'win32'
        ? Math.floor((safeWidth * scaleFactor) / 2) * 2
        : process.platform === 'linux'
          ? getLinuxScaledDimension(safeWidth, scaleFactor)
          : safeWidth
    const physicalHeight =
      process.platform === 'win32'
        ? Math.floor((safeHeight * scaleFactor) / 2) * 2
        : process.platform === 'linux'
          ? getLinuxScaledDimension(safeHeight, scaleFactor)
          : safeHeight
    const physicalX =
      process.platform === 'win32'
        ? Math.floor(selectedGeometry.x * scaleFactor)
        : process.platform === 'linux'
          ? getLinuxScaledOffset(selectedGeometry.x, scaleFactor)
          : selectedGeometry.x
    const physicalY =
      process.platform === 'win32'
        ? Math.floor(selectedGeometry.y * scaleFactor)
        : process.platform === 'linux'
          ? getLinuxScaledOffset(selectedGeometry.y, scaleFactor)
          : selectedGeometry.y

    switch (process.platform) {
      case 'linux':
        baseFfmpegArgs.push(
          '-f',
          'x11grab',
          '-framerate', String(screenFps),
          '-draw_mouse',
          '0',
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          `${display}+${physicalX},${physicalY}`,
        )
        break
      case 'win32':
        baseFfmpegArgs.push(
          '-f',
          'gdigrab',
          '-framerate', String(screenFps),
          '-draw_mouse',
          '0',
          '-offset_x',
          physicalX.toString(),
          '-offset_y',
          physicalY.toString(),
          '-video_size',
          `${physicalWidth}x${physicalHeight}`,
          '-i',
          'desktop',
        )
        break
      case 'darwin':
        // Note: macOS avfoundation doesn't support area capture like gdigrab/x11grab
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

  log.info('[RecordingManager] Starting actual recording with args:', baseFfmpegArgs)
  return startActualRecording(baseFfmpegArgs, !!webcam, !!mic, recordingGeometry, recordingScaleFactor, outputOptions)
}

export async function analyzeRecordingCapability(): Promise<{
  recommendedFps: 30 | 60
  canRecord60Fps: boolean
  reason: string
  measuredFps?: number
}> {
  const allDisplays = screen.getAllDisplays()
  const targetDisplay = screen.getPrimaryDisplay()
  const targetDisplayIndex = Math.max(0, allDisplays.findIndex((display) => display.id === targetDisplay.id))
  const scaleFactor = targetDisplay.scaleFactor || 1
  const { x, y, width, height } = targetDisplay.bounds
  const physicalWidth =
    process.platform === 'win32'
      ? Math.floor((width * scaleFactor) / 2) * 2
      : process.platform === 'linux'
        ? getLinuxScaledDimension(width, scaleFactor)
        : Math.floor(width / 2) * 2
  const physicalHeight =
    process.platform === 'win32'
      ? Math.floor((height * scaleFactor) / 2) * 2
      : process.platform === 'linux'
        ? getLinuxScaledDimension(height, scaleFactor)
        : Math.floor(height / 2) * 2
  const physicalX =
    process.platform === 'win32' ? Math.floor(x * scaleFactor) : process.platform === 'linux' ? getLinuxScaledOffset(x, scaleFactor) : x
  const physicalY =
    process.platform === 'win32' ? Math.floor(y * scaleFactor) : process.platform === 'linux' ? getLinuxScaledOffset(y, scaleFactor) : y

  const ddagrabInput = [
    `ddagrab=output_idx=${targetDisplayIndex}`,
    'framerate=60',
    'draw_mouse=0',
    `video_size=${physicalWidth}x${physicalHeight}`,
    'offset_x=0',
    'offset_y=0',
    'dup_frames=1',
  ].join(':')
  const probes: Array<{ backend: RecordingCapabilityProbeBackend; args: string[] }> =
    process.platform === 'win32'
      ? [
          {
            backend: 'ddagrab',
            args: [
              '-hide_banner',
              '-f',
              'lavfi',
              '-i',
              ddagrabInput,
              '-t',
              String(RECORDING_CAPABILITY_PROBE_SECONDS),
              '-f',
              'null',
              '-',
            ],
          },
          {
            backend: 'gdigrab',
            args: [
              '-hide_banner',
              '-f',
              'gdigrab',
              '-framerate',
              '60',
              '-draw_mouse',
              '0',
              '-offset_x',
              String(physicalX),
              '-offset_y',
              String(physicalY),
              '-video_size',
              `${physicalWidth}x${physicalHeight}`,
              '-t',
              String(RECORDING_CAPABILITY_PROBE_SECONDS),
              '-i',
              'desktop',
              '-f',
              'null',
              '-',
            ],
          },
        ]
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
    lastResult.backend === 'ddagrab'
      ? 'Desktop Duplication'
      : lastResult.backend === 'gdigrab'
        ? 'GDI'
        : 'X11'
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
async function cleanupAndSave(): Promise<void> {
  if (appState.mouseTracker) {
    appState.mouseTracker.stop()
    appState.mouseTracker = null
  }

  return new Promise((resolve) => {
    if (appState.ffmpegProcess) {
      const ffmpeg = appState.ffmpegProcess
      appState.ffmpegProcess = null
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
        log.info(`[StopRecord] FFmpeg had already exited. exitCode=${ffmpeg.exitCode} signal=${ffmpeg.signalCode}`)
        resolveOnce()
        return
      }

      ffmpeg.once('close', (code: any, signal: any) => {
        log.info(`[StopRecord] FFmpeg process exited with code ${code} signal ${signal ?? 'none'}`)
        resolveOnce()
      })

      ffmpeg.once('error', (error: any) => {
        log.error('[StopRecord] FFmpeg process emitted an error during shutdown:', error)
        resolveOnce()
      })

      if (ffmpeg.stdin) {
        ffmpeg.stdin.once('error', (error: any) => {
          log.warn('[StopRecord] FFmpeg stdin error during shutdown:', error)
        })
      }

      try {
        if (ffmpeg.stdin && !ffmpeg.stdin.destroyed && ffmpeg.stdin.writable) {
          log.info('[StopRecord] Requesting graceful FFmpeg shutdown via stdin.')
          ffmpeg.stdin.write('q')
          ffmpeg.stdin.end()
        } else {
          log.warn('[StopRecord] FFmpeg stdin is not writable; falling back to signals.')
          ffmpeg.kill('SIGINT')
        }
      } catch (error) {
        log.warn('[StopRecord] Failed to request graceful FFmpeg shutdown, sending SIGINT instead:', error)
        try {
          ffmpeg.kill('SIGINT')
        } catch (killError) {
          log.error('[StopRecord] Failed to send SIGINT to FFmpeg:', killError)
        }
      }

      gracefulKillTimer = setTimeout(() => {
        if (resolved) return
        log.warn('[StopRecord] FFmpeg did not exit after graceful request; sending SIGINT.')
        try {
          ffmpeg.kill('SIGINT')
        } catch (error) {
          log.error('[StopRecord] Failed to send SIGINT to FFmpeg after grace period:', error)
        }
      }, FFMPEG_STOP_GRACE_PERIOD_MS)

      forceKillTimer = setTimeout(() => {
        if (resolved) return
        log.error('[StopRecord] FFmpeg is still running; sending SIGKILL.')
        try {
          ffmpeg.kill('SIGKILL')
        } catch (error) {
          log.error('[StopRecord] Failed to send SIGKILL to FFmpeg:', error)
        }
      }, FFMPEG_STOP_FORCE_PERIOD_MS)

      forceResolveTimer = setTimeout(() => {
        if (resolved) return
        log.error('[StopRecord] FFmpeg shutdown timed out. Continuing cleanup to avoid blocking the UI.')
        resolveOnce()
      }, FFMPEG_STOP_RESOLVE_PERIOD_MS)
    } else {
      resolve()
    }
  })
}

/**
 * Processes mouse events against the final video start time and saves the metadata file.
 * @param session The current recording session.
 * @returns A promise that resolves to true on success, false on failure.
 */
/**
 * Helper function to scale recording geometry for display backends that capture in physical pixels
 */
function getScaledGeometry(geometry: RecordingGeometry, scaleFactor: number): RecordingGeometry {
  const shouldScaleForMetadata =
    (process.platform === 'win32' && scaleFactor !== 1) || shouldApplyLinuxDisplayScale(scaleFactor)
  if (!shouldScaleForMetadata) {
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

    // On Windows, scale mouse coordinates to match physical video dimensions
    const scaleFactor = session.scaleFactor || 1
    const finalEvents = appState.recordedMouseEvents.map((event) => {
      const shouldScaleLinuxEvent = shouldApplyLinuxDisplayScale(scaleFactor)
      const scaledX = process.platform === 'win32' || shouldScaleLinuxEvent ? event.x * scaleFactor : event.x
      const scaledY = process.platform === 'win32' || shouldScaleLinuxEvent ? event.y * scaleFactor : event.y
      return {
        ...event,
        x: scaledX,
        y: scaledY,
        timestamp: Math.max(0, event.timestamp - videoStartTime),
      }
    })

    // On Windows, also scale the recording geometry to match video dimensions
    const scaledGeometry = getScaledGeometry(session.recordingGeometry, scaleFactor)

    const primaryDisplay = screen.getPrimaryDisplay()
    const finalMetadata = {
      platform: process.platform,
      screenSize: primaryDisplay.size,
      geometry: scaledGeometry,
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

  appState.ffmpegProcess?.kill('SIGKILL')
  appState.ffmpegProcess = null

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
  const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.recordsaas')
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
    const filePattern = /^RecordSaaS-recording-\d+(-screen\.mp4|-webcam\.mp4|\.json)$/
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
    const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.recordsaas')
    await ensureDirectoryExists(recordingDir)
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
      scaleFactor: 1,  // No scaling for imported videos
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
    createEditorWindow(screenVideoPath, metadataPath, session.recordingGeometry, undefined, undefined, undefined, session.scaleFactor)
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

  const sourceProjectPath = filePaths[0]
  if (path.extname(sourceProjectPath).toLowerCase() !== '.rsproj') {
    dialog.showErrorBox('Invalid Project File', 'Please select a valid .rsproj file.')
    return { canceled: true }
  }
  log.info(`[RecordingManager] User selected project file: ${sourceProjectPath}`)
  const sourceProjectDir = path.dirname(sourceProjectPath)

  recorderWindow.hide()
  createSavingWindow()

  try {
    const recordingDir = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.recordsaas')
    await ensureDirectoryExists(recordingDir)

    // Read project configuration
    const rawData = await fsPromises.readFile(sourceProjectPath, 'utf-8')
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
    const importMediaFile = async (originalPath: string | null | undefined, label: string): Promise<string | undefined> => {
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

    const mergedGeometry =
      canonicalMetadata?.recordingGeometry ||
      canonicalMetadata?.geometry ||
      projectData.recordingGeometry ||
      projectData.geometry || { x: 0, y: 0, width: 0, height: 0 }

    const mergedRuntimeMetadata: RuntimeProjectMetadata = {
      ...projectData,
      platform: (canonicalMetadata?.platform || projectData.platform || process.platform) as NodeJS.Platform,
      screenSize: canonicalMetadata?.screenSize || projectData.screenSize || null,
      syncOffset: typeof canonicalMetadata?.syncOffset === 'number'
        ? canonicalMetadata.syncOffset
        : typeof projectData.syncOffset === 'number'
          ? projectData.syncOffset
          : 0,
      events: Array.isArray(mergedEvents) ? mergedEvents : [],
      cursorImages: mergedCursorImages,
      geometry: mergedGeometry,
      recordingGeometry: mergedGeometry,
      timelineLanes: normalizedTimelineLanes,
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
          zIndex:
            typeof rawRegion.zIndex === 'number' && Number.isFinite(rawRegion.zIndex)
              ? rawRegion.zIndex
              : 0,
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
          zIndex:
            typeof rawRegion.zIndex === 'number' && Number.isFinite(rawRegion.zIndex)
              ? rawRegion.zIndex
              : 0,
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
      mediaAudioPath: importedMediaAudioPath,
      recordingGeometry: mergedGeometry,
      scaleFactor: typeof projectData.scaleFactor === 'number' ? projectData.scaleFactor : 1,
      originalProjectPath: sourceProjectDir
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
      session.mediaAudioPath,
      session.scaleFactor,
      sourceProjectDir // Pass the original directory path
    )
    
    recorderWindow.close()
    return { canceled: false, filePath: session.screenVideoPath }
  } catch (error) {
    log.error('[RecordingManager] Error loading project from file:', error)
    dialog.showErrorBox('Error Loading Project', `An error occurred while loading the project: ${(error as Error).message}`)
    appState.savingWin?.close()
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.show()
    }
    return { canceled: true }
  }
}
