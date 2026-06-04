// Contains business logic for video export.

import log from 'electron-log/main'
import { app, BrowserWindow, IpcMainInvokeEvent, ipcMain, Menu, Tray, nativeImage, shell, powerSaveBlocker } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { constants as osConstants, getPriority, setPriority } from 'node:os'
import Store from 'electron-store'
import { appState } from '../state'
import { getFFmpegPath, calculateExportDimensions, getFFmpegSpawnErrorMessage } from '../lib/utils'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT, VITE_PUBLIC } from '../lib/constants'
import { normalizeMediaPath } from '../lib/media-url'
import { createExportProgressWindow } from '../windows/temporary-windows'
import { authorizeDesktopExport, type ExportSelectionRequest } from './auth-manager'

const FFMPEG_PATH = getFFmpegPath()
const EXPORT_PROGRESS_INTERVAL_MS = 300
const EXPORT_PROGRESS_STEP_PERCENT = 2
const MAX_SUPPORTED_EXPORT_FPS = 60
const POSIX_PRIORITY_CANDIDATES = [-10, -5]
const WINDOWS_PRIORITY_CANDIDATES = [
  osConstants.priority.PRIORITY_HIGH,
  osConstants.priority.PRIORITY_ABOVE_NORMAL,
]
const WINDOWS_NORMAL_PRIORITY = osConstants.priority.PRIORITY_NORMAL
const store = new Store()

type LaneLike = { id: string; order: number }
type CutLike = { startTime: number; duration: number; laneId?: string; zIndex?: number }
type SpeedLike = { startTime: number; duration: number; speed: number; laneId?: string; zIndex?: number }
type ExportQuality = 'low' | 'medium' | 'high' | 'ultra high'
type NormalizedExportSettings = ExportSelectionRequest & {
  quality: ExportQuality
  adaptiveRender: boolean
  effectiveWidth?: number
  effectiveHeight?: number
  effectiveFps?: number
}
export type SourceVideoInfo = {
  width: number
  height: number
  fps: number | null
  averageFps: number | null
  nominalFps: number | null
}
type TimelineAudioSegment = { start: number; duration: number; speed: number }
type ExportAudioSegment = {
  kind: 'audio' | 'silence'
  sourceStart: number
  sourceDuration: number
  speed: number
  outputDuration: number
  volumeMultiplier?: number
  fadeInDuration?: number
  fadeOutDuration?: number
  regionDuration?: number
  regionLocalStart?: number
}
type MediaAudioClipLike = {
  path?: string | null
  startTime?: number
  duration?: number
}
type MediaAudioRegionLike = {
  id: string
  laneId?: string
  startTime: number
  duration: number
  sourceStart: number
  isMuted: boolean
  volume: number
  fadeInDuration: number
  fadeOutDuration: number
  zIndex?: number
}
type ChangeSoundRegionLike = {
  id: string
  laneId?: string
  startTime: number
  duration: number
  sourceKey: 'recording-mic'
  isMuted: boolean
  volume: number
  fadeInDuration: number
  fadeOutDuration: number
  zIndex?: number
}
type RunFFmpeg = (args: string[], label: string) => Promise<void>

const MIN_AUDIO_SEGMENT_DURATION = 0.01
const AUDIO_SEGMENT_SAMPLE_RATE = 48000

const sanitizeFrameRate = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.min(120, value))
}

const sanitizeExportFrameRate = (value: unknown): number | null => {
  const fps = sanitizeFrameRate(value)
  if (!fps) return null
  return Math.min(MAX_SUPPORTED_EXPORT_FPS, fps)
}

const sanitizeNominalFrameRate = (value: unknown): number | null => {
  const fps = sanitizeFrameRate(value)
  if (!fps || fps < 24 || fps > 120) return null
  return fps
}

const mapHeightToExportResolution = (height: number): ExportSelectionRequest['resolution'] => {
  if (height <= 480) return '480p'
  if (height <= 576) return '576p'
  if (height <= 720) return '720p'
  if (height <= 1080) return '1080p'
  return '2k'
}

const mapFpsToExportTier = (fps: number | null, fallback: ExportSelectionRequest['fps']): ExportSelectionRequest['fps'] => {
  if (!fps) return fallback
  return fps > 30.5 ? 60 : 30
}

const readSourceVideoInfo = async (videoPath: string | null | undefined): Promise<SourceVideoInfo | null> => {
  const normalizedPath = normalizeMediaPath(videoPath)
  if (!normalizedPath) return null

  return await new Promise<SourceVideoInfo | null>((resolve) => {
    const probe = spawn(FFMPEG_PATH, ['-hide_banner', '-i', normalizedPath])
    let stderr = ''

    probe.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    probe.on('error', (error) => {
      log.warn('[ExportManager] Failed to probe adaptive source video info. Falling back to manual export settings.', error)
      resolve(null)
    })
    probe.on('close', () => {
      const videoLine = stderr.split(/\r?\n/).find((line) => line.includes('Video:'))
      if (!videoLine) {
        log.warn('[ExportManager] Adaptive source probe did not return a video stream line.')
        resolve(null)
        return
      }

      const dimensionsMatch = videoLine.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|,)/)
      const fpsMatch = videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*fps(?:\s|,)/)
      const tbrMatch = videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr(?:\s|,)/)
      const width = dimensionsMatch ? Number(dimensionsMatch[1]) : 0
      const height = dimensionsMatch ? Number(dimensionsMatch[2]) : 0
      const averageFps = sanitizeFrameRate(fpsMatch ? Number(fpsMatch[1]) : null)
      const nominalFps = sanitizeNominalFrameRate(tbrMatch ? Number(tbrMatch[1]) : null)
      const shouldUseNominalFps = Boolean(averageFps && averageFps < 10 && nominalFps)
      const fps = shouldUseNominalFps ? nominalFps : averageFps ?? nominalFps

      if (!width || !height) {
        log.warn(`[ExportManager] Adaptive source probe could not parse dimensions from: ${videoLine}`)
        resolve(null)
        return
      }

      if (shouldUseNominalFps) {
        log.warn(
          `[ExportManager] Adaptive source probe detected low average fps (${averageFps?.toFixed(3)}) with nominal tbr ${nominalFps?.toFixed(3)}. Using nominal tbr for export FPS.`,
        )
      }

      resolve({ width, height, fps, averageFps, nominalFps })
    })
  })
}

export const probeSourceVideoInfo = async (videoPath: string | null | undefined): Promise<SourceVideoInfo | null> =>
  await readSourceVideoInfo(videoPath)

const sortLanesForPrecedence = (lanes: LaneLike[] | undefined): LaneLike[] => {
  const source = Array.isArray(lanes) && lanes.length > 0 ? lanes : [{ id: 'lane-1', order: 0 }]
  return [...source]
    .sort((a, b) => (a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order))
    .map((lane, index) => ({ ...lane, order: index }))
}

const regionOverlapsTime = (region: { startTime: number; duration: number }, time: number): boolean =>
  time >= region.startTime && time < region.startTime + region.duration

const chooseTopActiveRegion = <T extends { laneId?: string; zIndex?: number; duration: number; startTime: number }>(
  regions: T[],
  time: number,
  laneIndexMap: Map<string, number>,
  laneCount: number,
): T | null => {
  const active = regions.filter((region) => regionOverlapsTime(region, time))
  if (active.length === 0) return null

  active.sort((a, b) => {
    const laneA = a.laneId ? (laneIndexMap.get(a.laneId) ?? laneCount + 1) : laneCount + 1
    const laneB = b.laneId ? (laneIndexMap.get(b.laneId) ?? laneCount + 1) : laneCount + 1
    if (laneA !== laneB) return laneA - laneB

    const zDiff = (b.zIndex ?? 0) - (a.zIndex ?? 0)
    if (zDiff !== 0) return zDiff

    const durationDiff = a.duration - b.duration
    if (durationDiff !== 0) return durationDiff

    return b.startTime - a.startTime
  })

  return active[0]
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const buildAudioTimelineSegments = (
  duration: number,
  cutRegions: CutLike[],
  speedRegions: SpeedLike[],
  lanes: LaneLike[] | undefined,
  extraBoundaries: number[] = [],
): TimelineAudioSegment[] => {
  if (duration <= 0) return []

  const sortedLanes = sortLanesForPrecedence(lanes)
  const laneIndexMap = new Map(sortedLanes.map((lane, index) => [lane.id, index]))
  const boundaries = new Set<number>([0, duration])

  cutRegions.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })
  speedRegions.forEach((region) => {
    boundaries.add(clamp(region.startTime, 0, duration))
    boundaries.add(clamp(region.startTime + region.duration, 0, duration))
  })
  extraBoundaries.forEach((boundary) => {
    boundaries.add(clamp(boundary, 0, duration))
  })

  const sortedBoundaries = Array.from(boundaries)
    .sort((a, b) => a - b)
    .filter((time, index, arr) => index === 0 || time !== arr[index - 1])

  const segments: TimelineAudioSegment[] = []

  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const start = sortedBoundaries[i]
    const end = sortedBoundaries[i + 1]
    const sourceDuration = end - start
    if (sourceDuration <= 0) continue

    const midpoint = start + sourceDuration / 2
    const activeCut = chooseTopActiveRegion(cutRegions, midpoint, laneIndexMap, sortedLanes.length)
    if (activeCut) continue

    const activeSpeed = chooseTopActiveRegion(speedRegions, midpoint, laneIndexMap, sortedLanes.length)
    const speed = activeSpeed && activeSpeed.speed > 0 ? activeSpeed.speed : 1
    segments.push({ start, duration: sourceDuration, speed })
  }

  return segments
}

const pushExportSegment = (
  output: ExportAudioSegment[],
  segment: Omit<ExportAudioSegment, 'outputDuration'>,
) => {
  if (!Number.isFinite(segment.sourceDuration) || segment.sourceDuration <= MIN_AUDIO_SEGMENT_DURATION) {
    return
  }
  const speed = segment.speed > 0 ? segment.speed : 1
  const outputDuration = segment.sourceDuration / speed
  if (!Number.isFinite(outputDuration) || outputDuration <= MIN_AUDIO_SEGMENT_DURATION) {
    return
  }

  output.push({
    ...segment,
    speed,
    outputDuration,
  })
}

const parseMediaAudioRegionsFromState = (
  projectState: Record<string, unknown>,
  mediaClip: MediaAudioClipLike | null,
): MediaAudioRegionLike[] => {
  const rawRegions = projectState.mediaAudioRegions
  const clipDuration =
    mediaClip && typeof mediaClip.duration === 'number' && Number.isFinite(mediaClip.duration)
      ? Math.max(0, mediaClip.duration)
      : 0

  if (rawRegions && typeof rawRegions === 'object') {
    const normalized = Object.entries(rawRegions as Record<string, unknown>).reduce((acc, [id, rawRegion]) => {
      if (!rawRegion || typeof rawRegion !== 'object') return acc
      const parsed = rawRegion as Partial<MediaAudioRegionLike>

      const startTime =
        typeof parsed.startTime === 'number' && Number.isFinite(parsed.startTime) ? Math.max(0, parsed.startTime) : 0
      const sourceStart =
        typeof parsed.sourceStart === 'number' && Number.isFinite(parsed.sourceStart)
          ? Math.max(0, parsed.sourceStart)
          : 0
      const availableDuration = clipDuration > 0 ? Math.max(0.1, clipDuration - sourceStart) : Number.POSITIVE_INFINITY
      const duration =
        typeof parsed.duration === 'number' && Number.isFinite(parsed.duration)
          ? Math.max(0.1, Math.min(parsed.duration, availableDuration))
          : clipDuration > 0
            ? availableDuration
            : 0

      if (!Number.isFinite(duration) || duration <= 0) return acc

      const fadeInDuration =
        typeof parsed.fadeInDuration === 'number' && Number.isFinite(parsed.fadeInDuration)
          ? Math.max(0, Math.min(parsed.fadeInDuration, duration))
          : 0
      const fadeOutDuration =
        typeof parsed.fadeOutDuration === 'number' && Number.isFinite(parsed.fadeOutDuration)
          ? Math.max(0, Math.min(parsed.fadeOutDuration, duration))
          : 0
      const volume =
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(parsed.volume, 1)) : 1

      acc.push({
        id: id || parsed.id || `media-audio-${Date.now()}`,
        laneId: parsed.laneId,
        startTime,
        duration,
        sourceStart,
        isMuted: parsed.isMuted === true,
        volume,
        fadeInDuration,
        fadeOutDuration,
        zIndex:
          typeof parsed.zIndex === 'number' && Number.isFinite(parsed.zIndex)
            ? parsed.zIndex
            : 0,
      })
      return acc
    }, [] as MediaAudioRegionLike[])

    if (normalized.length > 0) {
      return normalized
    }
  }

  if (!mediaClip) return []

  const legacyStart =
    typeof mediaClip.startTime === 'number' && Number.isFinite(mediaClip.startTime) ? Math.max(0, mediaClip.startTime) : 0
  const legacyDuration = clipDuration > 0 ? clipDuration : 0
  if (legacyDuration <= 0) return []

  return [
    {
      id: `media-audio-${Date.now()}`,
      laneId: 'lane-1',
      startTime: legacyStart,
      duration: legacyDuration,
      sourceStart: 0,
      isMuted: false,
      volume: 1,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      zIndex: 0,
    },
  ]
}

const parseChangeSoundRegionsFromState = (projectState: Record<string, unknown>): ChangeSoundRegionLike[] => {
  const rawRegions = projectState.changeSoundRegions
  if (!rawRegions || typeof rawRegions !== 'object') return []

  return Object.entries(rawRegions as Record<string, unknown>).reduce((acc, [id, rawRegion]) => {
    if (!rawRegion || typeof rawRegion !== 'object') return acc
    const parsed = rawRegion as Partial<ChangeSoundRegionLike>

    const startTime =
      typeof parsed.startTime === 'number' && Number.isFinite(parsed.startTime) ? Math.max(0, parsed.startTime) : 0
    const duration =
      typeof parsed.duration === 'number' && Number.isFinite(parsed.duration) ? Math.max(0.1, parsed.duration) : 1
    const volume =
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume) ? Math.max(0, Math.min(parsed.volume, 1)) : 1
    const fadeInDuration =
      typeof parsed.fadeInDuration === 'number' && Number.isFinite(parsed.fadeInDuration)
        ? Math.max(0, Math.min(parsed.fadeInDuration, duration))
        : 0
    const fadeOutDuration =
      typeof parsed.fadeOutDuration === 'number' && Number.isFinite(parsed.fadeOutDuration)
        ? Math.max(0, Math.min(parsed.fadeOutDuration, duration))
        : 0

    acc.push({
      id: id || parsed.id || `change-sound-${Date.now()}`,
      laneId: parsed.laneId,
      startTime,
      duration,
      sourceKey: 'recording-mic',
      isMuted: parsed.isMuted === true,
      volume,
      fadeInDuration,
      fadeOutDuration,
      zIndex: typeof parsed.zIndex === 'number' && Number.isFinite(parsed.zIndex) ? parsed.zIndex : 0,
    })
    return acc
  }, [] as ChangeSoundRegionLike[])
}

const collectMediaAudioBoundaries = (regions: MediaAudioRegionLike[], duration: number): number[] => {
  if (duration <= 0) return []

  const boundaries: number[] = []
  regions.forEach((region) => {
    const start = clamp(region.startTime, 0, duration)
    const end = clamp(region.startTime + region.duration, 0, duration)
    boundaries.push(start, end)

    if (region.fadeInDuration > 0) {
      boundaries.push(clamp(region.startTime + region.fadeInDuration, 0, duration))
    }
    if (region.fadeOutDuration > 0) {
      boundaries.push(clamp(region.startTime + region.duration - region.fadeOutDuration, 0, duration))
    }
  })

  return boundaries
}

const collectChangeSoundBoundaries = (regions: ChangeSoundRegionLike[], duration: number): number[] => {
  if (duration <= 0) return []

  const boundaries: number[] = []
  regions.forEach((region) => {
    const start = clamp(region.startTime, 0, duration)
    const end = clamp(region.startTime + region.duration, 0, duration)
    boundaries.push(start, end)

    if (region.fadeInDuration > 0) {
      boundaries.push(clamp(region.startTime + region.fadeInDuration, 0, duration))
    }
    if (region.fadeOutDuration > 0) {
      boundaries.push(clamp(region.startTime + region.duration - region.fadeOutDuration, 0, duration))
    }
  })

  return boundaries
}

const buildRecordingExportAudioSegments = (
  timelineSegments: TimelineAudioSegment[],
  regions: ChangeSoundRegionLike[],
  lanes: LaneLike[],
): ExportAudioSegment[] => {
  const outputSegments: ExportAudioSegment[] = []
  const sortedLanes = sortLanesForPrecedence(lanes)
  const laneIndexMap = new Map(sortedLanes.map((lane, index) => [lane.id, index]))

  timelineSegments.forEach((segment) => {
    const midpoint = segment.start + segment.duration / 2
    const activeRegion = chooseTopActiveRegion(regions, midpoint, laneIndexMap, sortedLanes.length)

    if (!activeRegion) {
      pushExportSegment(outputSegments, {
        kind: 'audio',
        sourceStart: segment.start,
        sourceDuration: segment.duration,
        speed: segment.speed,
        volumeMultiplier: 1,
      })
      return
    }

    const regionLocalStart = Math.max(0, segment.start - activeRegion.startTime)
    const safeDuration = Math.max(0.001, activeRegion.duration)
    const timeFromStart = Math.min(regionLocalStart, safeDuration)
    const timeToEnd = Math.max(0, safeDuration - timeFromStart)
    const fadeInGain =
      activeRegion.fadeInDuration > 0 ? Math.max(0, Math.min(1, timeFromStart / activeRegion.fadeInDuration)) : 1
    const fadeOutGain =
      activeRegion.fadeOutDuration > 0 ? Math.max(0, Math.min(1, timeToEnd / activeRegion.fadeOutDuration)) : 1
    const baseGain = activeRegion.isMuted ? 0 : Math.max(0, Math.min(1, activeRegion.volume))

    pushExportSegment(outputSegments, {
      kind: 'audio',
      sourceStart: segment.start,
      sourceDuration: segment.duration,
      speed: segment.speed,
      volumeMultiplier: Math.max(0, Math.min(1, baseGain * Math.min(fadeInGain, fadeOutGain))),
    })
  })

  return outputSegments
}

const buildMediaExportAudioSegments = (
  timelineSegments: TimelineAudioSegment[],
  regions: MediaAudioRegionLike[],
  lanes: LaneLike[],
): ExportAudioSegment[] => {
  const outputSegments: ExportAudioSegment[] = []
  const sortedLanes = sortLanesForPrecedence(lanes)
  const laneIndexMap = new Map(sortedLanes.map((lane, index) => [lane.id, index]))

  timelineSegments.forEach((segment) => {
    const midpoint = segment.start + segment.duration / 2
    const activeRegion = chooseTopActiveRegion(regions, midpoint, laneIndexMap, sortedLanes.length)

    if (!activeRegion) {
      pushExportSegment(outputSegments, {
        kind: 'silence',
        sourceStart: 0,
        sourceDuration: segment.duration,
        speed: segment.speed,
      })
      return
    }

    const regionLocalStart = Math.max(0, segment.start - activeRegion.startTime)
    const baseGain = activeRegion.isMuted ? 0 : Math.max(0, Math.min(1, activeRegion.volume))
    pushExportSegment(outputSegments, {
      kind: 'audio',
      sourceStart: Math.max(0, activeRegion.sourceStart + regionLocalStart),
      sourceDuration: segment.duration,
      speed: segment.speed,
      volumeMultiplier: baseGain,
      fadeInDuration: activeRegion.fadeInDuration,
      fadeOutDuration: activeRegion.fadeOutDuration,
      regionDuration: activeRegion.duration,
      regionLocalStart,
    })
  })

  return outputSegments
}

const buildAtempoFilter = (factor: number): string | null => {
  if (Math.abs(factor - 1) < 0.01) return null

  const filters: number[] = []
  let remaining = factor

  while (remaining > 2.0) {
    filters.push(2.0)
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    filters.push(0.5)
    remaining /= 0.5
  }

  filters.push(remaining)
  return filters.map((value) => `atempo=${value}`).join(',')
}

const buildFadeVolumeFilter = (segment: ExportAudioSegment): string | null => {
  if (segment.kind !== 'audio') return null

  const baseVolume =
    typeof segment.volumeMultiplier === 'number' && Number.isFinite(segment.volumeMultiplier)
      ? Math.max(0, Math.min(1, segment.volumeMultiplier))
      : 1
  const fadeInDuration = segment.fadeInDuration ?? 0
  const fadeOutDuration = segment.fadeOutDuration ?? 0
  const regionDuration = segment.regionDuration ?? 0
  const regionLocalStart = segment.regionLocalStart ?? 0
  if (fadeInDuration <= 0 && fadeOutDuration <= 0) {
    return baseVolume < 0.999 ? `volume='${baseVolume.toFixed(6)}'` : null
  }

  const speed = segment.speed > 0 ? segment.speed : 1
  const localTimeExpr = `${regionLocalStart.toFixed(6)}+t*${speed.toFixed(6)}`
  const fadeInExpr =
    fadeInDuration > 0
      ? `min(1,max(0,(${localTimeExpr})/${fadeInDuration.toFixed(6)}))`
      : '1'
  const fadeOutExpr =
    fadeOutDuration > 0
      ? `min(1,max(0,(${regionDuration.toFixed(6)}-(${localTimeExpr}))/(${fadeOutDuration.toFixed(6)})))`
      : '1'

  return `volume='${baseVolume.toFixed(6)}*min(${fadeInExpr},${fadeOutExpr})'`
}

const escapeFilterValue = (value: string): string => value.replace(/\\/g, '/').replace(/'/g, "\\'")

const buildAudioFilterChain = (segment: ExportAudioSegment, inputLabel: string, outputLabel: string): string => {
  const filters: string[] = []

  if (segment.kind === 'silence') {
    filters.push(
      `anullsrc=channel_layout=stereo:sample_rate=${AUDIO_SEGMENT_SAMPLE_RATE}`,
      `atrim=start=0:duration=${segment.outputDuration.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
    )
  } else {
    filters.push(
      `${inputLabel}atrim=start=${segment.sourceStart.toFixed(6)}:duration=${segment.sourceDuration.toFixed(6)}`,
      'asetpts=PTS-STARTPTS',
    )

    const atempo = buildAtempoFilter(segment.speed)
    if (atempo) {
      filters.push(atempo)
    }

    const fadeVolume = buildFadeVolumeFilter(segment)
    if (fadeVolume) {
      filters.push(fadeVolume)
    }
  }

  filters.push(`aresample=${AUDIO_SEGMENT_SAMPLE_RATE}`, `aformat=sample_rates=${AUDIO_SEGMENT_SAMPLE_RATE}:channel_layouts=stereo`)

  return `${filters.join(',')}[${outputLabel}]`
}

const renderProcessedAudioFile = async (
  sourcePath: string,
  segments: ExportAudioSegment[],
  runFFmpeg: RunFFmpeg,
): Promise<string | null> => {
  if (segments.length === 0) return null

  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'recordsaas-audio-'))
  const finalOut = path.join(tmpDir, 'processed.m4a')

  try {
    const filterScriptPath = path.join(tmpDir, 'audio-filter.txt')
    const segmentLabels = segments.map((_, index) => `seg${index}`)
    const filterLines = segments.map((segment, index) => {
      log.info(
        `[ExportManager] Preparing audio segment ${index}: kind=${segment.kind}, sourceStart=${segment.sourceStart.toFixed(3)}, sourceDuration=${segment.sourceDuration.toFixed(3)}, speed=${segment.speed.toFixed(3)}`,
      )
      return buildAudioFilterChain(segment, '[0:a]', segmentLabels[index])
    })
    filterLines.push(`${segmentLabels.map((label) => `[${label}]`).join('')}concat=n=${segments.length}:v=0:a=1[aout]`)
    fs.writeFileSync(filterScriptPath, filterLines.join(';\n'), 'utf-8')

    await runFFmpeg(
      [
        '-y',
        '-i',
        sourcePath,
        '-filter_complex_script',
        filterScriptPath,
        '-map',
        '[aout]',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        finalOut,
      ],
      `audio-process:${escapeFilterValue(path.basename(sourcePath))}`,
    )

    return finalOut
  } catch (error) {
    log.error('[ExportManager] Failed to render processed audio:', error)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
    return null
  }
}

const mixAudioTracks = async (
  recordingTrackPath: string,
  mediaTrackPath: string,
  runFFmpeg: RunFFmpeg,
): Promise<string | null> => {
  const tmpDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'recordsaas-audio-mix-'))
  const outPath = path.join(tmpDir, 'mixed.m4a')
  const args = [
    '-y',
    '-i',
    recordingTrackPath,
    '-i',
    mediaTrackPath,
    '-filter_complex',
    'amix=inputs=2:dropout_transition=0',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    outPath,
  ]

  try {
    await runFFmpeg(args, 'audio-mix')
    return outPath
  } catch (error) {
    log.error('[ExportManager] Failed to mix recording/media tracks:', error)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
    return null
  }
}

const getTargetPriorityCandidates = () =>
  process.platform === 'win32' ? WINDOWS_PRIORITY_CANDIDATES : POSIX_PRIORITY_CANDIDATES

const getNormalPriority = () => (process.platform === 'win32' ? WINDOWS_NORMAL_PRIORITY : 0)

const trySetProcessPriority = (pid: number, priority: number, label: string) => {
  try {
    setPriority(pid, priority)
    log.info(`[ExportManager] Priority set for ${label}: pid=${pid}, priority=${priority}`)
    return true
  } catch (error) {
    log.warn(`[ExportManager] Failed to set priority for ${label}:`, error)
    return false
  }
}

const trySetProcessPriorityWithFallback = (pid: number, priorities: number[], label: string) => {
  for (const priority of priorities) {
    if (trySetProcessPriority(pid, priority, label)) {
      return true
    }
  }

  return false
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function startExport(event: IpcMainInvokeEvent, { projectState, exportSettings, outputPath }: any) {
  const exportStartTime = Date.now()
  const exportSessionId = `export-${exportStartTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const sessionLogPrefix = `[ExportManager][${exportSessionId}]`
  log.info(`${sessionLogPrefix} Starting export process...`)
  const getElapsedDurationSeconds = () => (Date.now() - exportStartTime) / 1000

  const editorWindow = BrowserWindow.fromWebContents(event.sender)
  if (!editorWindow) return
  const playExportCompletionSound = Boolean(store.get('general.playExportCompletionSound', true))
  const wasEditorVisibleBeforeExport = editorWindow.isVisible()
  const wasEditorMinimizedBeforeExport = editorWindow.isMinimized()
  const wasEditorSkipTaskbarBeforeExport =
    (editorWindow as unknown as { isSkipTaskbar?: () => boolean }).isSkipTaskbar?.() ?? false
  const targetPriorityCandidates = getTargetPriorityCandidates()
  const normalPriorityFallback = getNormalPriority()
  let originalMainProcessPriority = normalPriorityFallback
  let mainPriorityBoostApplied = false
  let ffmpegClosed = false
  let exportCompleted = false
  let uiCleanedUp = false
  let powerSaveBlockerId: number | null = null
  let lastProgressBroadcastAt = 0
  let lastProgressBroadcast = -1
  let latestProgressPayload: { progress: number; stage: string; exportSessionId: string } | null = null
  let lastProgressBroadcastLogBucket = -1
  let lastRendererProgressLogBucket = -1
  let lastFrameProgressLogBucket = -1
  let cancellationHandler: () => void = () => {}
  let renderReadyListener: (() => void) | null = null
  let ffmpeg: ChildProcessWithoutNullStreams | null = null
  let cleanupProcessedAudio: () => void = () => {}
  let cleanupListeners: () => void = () => {
    ipcMain.removeListener('export:cancel', cancellationHandler)
    if (renderReadyListener) {
      ipcMain.removeListener('render:ready', renderReadyListener)
      renderReadyListener = null
    }
  }
  const processedAudioTempRoots = new Set<string>()
  const auxiliaryFFmpegProcesses = new Set<ChildProcessWithoutNullStreams>()

  const safeExportSettings = exportSettings && typeof exportSettings === 'object' ? exportSettings : {}
  const requestedExportSettings: NormalizedExportSettings = {
    format: safeExportSettings.format === 'gif' ? 'gif' : 'mp4',
    resolution:
      safeExportSettings.resolution === '480p' ||
      safeExportSettings.resolution === '576p' ||
      safeExportSettings.resolution === '720p' ||
      safeExportSettings.resolution === '1080p' ||
      safeExportSettings.resolution === '2k'
        ? safeExportSettings.resolution
        : '720p',
    fps: safeExportSettings.fps === 60 ? 60 : 30,
    quality:
      safeExportSettings.quality === 'low' ||
      safeExportSettings.quality === 'medium' ||
      safeExportSettings.quality === 'high' ||
      safeExportSettings.quality === 'ultra high'
        ? safeExportSettings.quality
        : 'medium',
    adaptiveRender: safeExportSettings.adaptiveRender !== false,
  }

  const playCompletionSound = (completionType: 'success' | 'error' | 'cancelled') => {
    if (!playExportCompletionSound || completionType === 'cancelled') return
    try {
      shell.beep()
    } catch (error) {
      log.warn('[ExportManager] Failed to play export completion sound:', error)
    }
  }

  const getProgressLogBucket = (progress: number) => Math.floor(clamp(progress, 0, 100) / 5)

  const shouldLogProgressBucket = (progress: number, lastBucket: number, force = false) => {
    const bucket = getProgressLogBucket(progress)
    return {
      bucket,
      shouldLog: force || bucket !== lastBucket,
    }
  }

  const describeProgressWindow = () => {
    const exportProgressWindow = appState.exportProgressWin
    if (!exportProgressWindow || exportProgressWindow.isDestroyed()) return 'missing'
    return `alive visible=${exportProgressWindow.isVisible()} loading=${exportProgressWindow.webContents.isLoading()}`
  }

  const syncProgressWindowDom = (
    progressWindow: BrowserWindow,
    payload: { progress: number; stage: string; exportSessionId?: string },
    source: string,
    shouldLog: boolean,
  ) => {
    if (progressWindow.isDestroyed() || progressWindow.webContents.isLoading()) return

    const safeProgress = clamp(payload.progress, 0, 100)
    const stageText = payload.stage.trim().length > 0 ? payload.stage.trim() : 'Rendering...'
    const script = `
      (() => {
        const progress = ${JSON.stringify(safeProgress)};
        const stage = ${JSON.stringify(stageText)};
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-inline-text');
        const track = document.querySelector('.progress-track');
        const previous = Number(window.__recordsaasLastProgress || 0);
        const next = Math.max(previous, Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0)));
        window.__recordsaasLastProgress = next;
        if (fill) fill.style.transform = 'scaleX(' + (next / 100) + ')';
        if (text) text.textContent = stage + ' ' + Math.round(next) + '%';
        if (track) track.setAttribute('aria-valuenow', String(Math.round(next)));
        return {
          progress: next,
          text: text ? text.textContent : null,
          fillTransform: fill ? fill.style.transform : null,
          readyState: document.readyState,
          hasTempAPI: Boolean(window.tempAPI)
        };
      })()
    `

    progressWindow.webContents
      .executeJavaScript(script, true)
      .then((result) => {
        if (shouldLog) {
          log.info('[ExportManager][Progress] Synced progress window DOM directly.', {
            source,
            result,
          })
        }
      })
      .catch((error) => {
        log.warn('[ExportManager][Progress] Failed to sync progress window DOM directly:', error)
      })
  }

  const sendExportComplete = (
    payload: { success: boolean; outputPath?: string; error?: string; duration?: number },
    completionType: 'success' | 'error' | 'cancelled',
  ) => {
    log.info('[ExportManager][Progress] Sending export:complete.', {
      completionType,
      success: payload.success,
      duration: payload.duration,
      progressWindow: describeProgressWindow(),
    })

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:complete', payload)
    } else {
      log.warn('[ExportManager] Editor window was destroyed. Could not send export:complete message.')
    }

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.webContents.send('export:complete', payload)
    }

    playCompletionSound(completionType)
  }

  const updateExportTrayTooltip = (progress: number) => {
    if (!appState.exportTray) return
    try {
      appState.exportTray.setToolTip(`Exporting... ${Math.round(progress)}%`)
    } catch (error) {
      log.warn('[ExportManager] Failed to update export tray tooltip:', error)
    }
  }

  const sendProgressUpdate = (progress: number, stage: string, force: boolean = false, source = 'main') => {
    const safeProgress = clamp(progress, 0, 100)
    const now = Date.now()
    const elapsed = now - lastProgressBroadcastAt
    const progressDelta = Math.abs(safeProgress - lastProgressBroadcast)

    const shouldSend =
      force ||
      lastProgressBroadcast < 0 ||
      elapsed >= EXPORT_PROGRESS_INTERVAL_MS ||
      progressDelta >= EXPORT_PROGRESS_STEP_PERCENT ||
      safeProgress >= 100

    if (!shouldSend) return

    lastProgressBroadcastAt = now
    lastProgressBroadcast = safeProgress

    const payload = { progress: safeProgress, stage, exportSessionId }
    latestProgressPayload = payload
    appState.currentExportProgress = payload

    const progressLog = shouldLogProgressBucket(safeProgress, lastProgressBroadcastLogBucket, force)
    if (progressLog.shouldLog) {
      lastProgressBroadcastLogBucket = progressLog.bucket
      log.info(`${sessionLogPrefix}[Progress] Broadcasting progress update.`, {
        source,
        progress: Number(safeProgress.toFixed(2)),
        stage,
        force,
        elapsedMs: now - exportStartTime,
        editorWindow: editorWindow && !editorWindow.isDestroyed() ? 'alive' : 'missing',
        progressWindow: describeProgressWindow(),
      })
    }

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.webContents.send('export:progress', payload)
    }

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.webContents.send('export:progress', payload)
      syncProgressWindowDom(exportProgressWindow, payload, source, progressLog.shouldLog)
    }

    updateExportTrayTooltip(safeProgress)
  }

  const handleProgressWindowClose = (closeEvent: Electron.Event) => {
    if (exportCompleted) return
    closeEvent.preventDefault()
    cancellationHandler()
  }

  const showExportProgressWindow = () => {
    const progressWindow = createExportProgressWindow()
    progressWindow.removeListener('close', handleProgressWindowClose)
    progressWindow.on('close', handleProgressWindowClose)
    const sendLatestProgressToWindow = () => {
      if (latestProgressPayload && !progressWindow.isDestroyed()) {
        log.info(`${sessionLogPrefix}[Progress] Sending latest progress to progress window after load/show.`, latestProgressPayload)
        progressWindow.webContents.send('export:progress', latestProgressPayload)
        syncProgressWindowDom(progressWindow, latestProgressPayload, 'latest-progress-window-load', true)
      } else {
        log.info(`${sessionLogPrefix}[Progress] No latest progress payload available for progress window yet.`)
      }
    }
    if (progressWindow.webContents.isLoading()) {
      log.info(`${sessionLogPrefix}[Progress] Progress window is still loading. Deferring latest progress send.`)
      progressWindow.webContents.once('did-finish-load', sendLatestProgressToWindow)
    } else {
      sendLatestProgressToWindow()
    }
    if (!progressWindow.isVisible()) {
      progressWindow.show()
    }
    progressWindow.focus()
    return progressWindow
  }

  const createExportTray = () => {
    if (appState.exportTray) return

    try {
      const iconPath = path.join(VITE_PUBLIC, 'recordsaas-appicon-tray.png')
      const icon = nativeImage.createFromPath(iconPath)
      if (icon.isEmpty()) {
        throw new Error(`Tray icon not found or invalid: ${iconPath}`)
      }

      const tray = new Tray(icon)
      appState.exportTray = tray
      tray.setToolTip('Exporting... 0%')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: 'Show Export Progress',
            click: () => {
              showExportProgressWindow()
            },
          },
          { type: 'separator' },
          {
            label: 'Cancel Export',
            click: () => {
              cancellationHandler()
            },
          },
        ]),
      )
      tray.on('click', () => {
        showExportProgressWindow()
      })
    } catch (error) {
      log.warn('[ExportManager] Failed to create export tray, continuing without tray:', error)
      appState.exportTray = null
    }
  }

  const cleanupExportUi = () => {
    if (uiCleanedUp) return
    uiCleanedUp = true

    const exportProgressWindow = appState.exportProgressWin
    if (exportProgressWindow && !exportProgressWindow.isDestroyed()) {
      exportProgressWindow.removeListener('close', handleProgressWindowClose)
      exportProgressWindow.close()
    }

    if (appState.exportTray) {
      try {
        appState.exportTray.destroy()
      } catch (error) {
        log.warn('[ExportManager] Failed to destroy export tray:', error)
      }
      appState.exportTray = null
    }

    if (editorWindow && !editorWindow.isDestroyed()) {
      editorWindow.setSkipTaskbar(wasEditorSkipTaskbarBeforeExport)

      if (wasEditorVisibleBeforeExport) {
        editorWindow.show()
      }

      if (wasEditorMinimizedBeforeExport) {
        editorWindow.minimize()
      } else if (wasEditorVisibleBeforeExport) {
        if (editorWindow.isMinimized()) {
          editorWindow.restore()
        }
        editorWindow.focus()
      }
    }

    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
      log.info(`[ExportManager] Stopped powerSaveBlocker id=${powerSaveBlockerId}`)
      powerSaveBlockerId = null
    }

    if (mainPriorityBoostApplied) {
      trySetProcessPriority(process.pid, originalMainProcessPriority, 'main-process-restore')
      mainPriorityBoostApplied = false
    }
  }

  const killAuxiliaryFFmpegProcesses = () => {
    auxiliaryFFmpegProcesses.forEach((child) => {
      if (!child.killed) {
        child.kill('SIGKILL')
      }
    })
    auxiliaryFFmpegProcesses.clear()
  }

  const closeRenderWorker = () => {
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.close()
    }
    appState.renderWorker = null
  }

  const runAuxiliaryFFmpeg: RunFFmpeg = (args, label) =>
    new Promise((resolve, reject) => {
      if (exportCompleted) {
        reject(new Error('Export cancelled.'))
        return
      }

      log.info(`[ExportManager] Spawning auxiliary FFmpeg (${label}) with args:`, args.join(' '))
      const child = spawn(FFMPEG_PATH, args)
      auxiliaryFFmpegProcesses.add(child)

      if (typeof child.pid === 'number') {
        trySetProcessPriorityWithFallback(child.pid, targetPriorityCandidates, `ffmpeg:${label}`)
      }

      child.stderr.on('data', (data) => log.info(`[FFmpeg ${label} stderr]: ${data.toString()}`))
      child.on('error', (error) => {
        auxiliaryFFmpegProcesses.delete(child)
        reject(error)
      })
      child.on('close', (code) => {
        auxiliaryFFmpegProcesses.delete(child)
        if (exportCompleted) {
          reject(new Error('Export cancelled.'))
          return
        }
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(`FFmpeg ${label} exited with code ${code}`))
      })
    })

  const failExportStartup = (errorMessage: string) => {
    if (exportCompleted) return

    exportCompleted = true

    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    killAuxiliaryFFmpegProcesses()
    closeRenderWorker()

    sendExportComplete({ success: false, error: errorMessage, duration: getElapsedDurationSeconds() }, 'error')
    cleanupExportUi()
    cleanupProcessedAudio()
    cleanupListeners()

    if (fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete failed export file:', err))
    }
  }

  cancellationHandler = () => {
    if (exportCompleted) return

    log.warn('[ExportManager] Received "export:cancel". Terminating export.')
    exportCompleted = true

    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    killAuxiliaryFFmpegProcesses()
    closeRenderWorker()

    sendExportComplete({ success: false, error: 'Export cancelled.', duration: getElapsedDurationSeconds() }, 'cancelled')
    cleanupExportUi()

    if (fs.existsSync(outputPath)) {
      fsPromises.unlink(outputPath).catch((err) => log.error('Failed to delete cancelled export file:', err))
    }

    cleanupProcessedAudio()
    cleanupListeners()
  }

  ipcMain.once('export:cancel', cancellationHandler)

  try {
    originalMainProcessPriority = getPriority(process.pid)
  } catch (error) {
    log.warn('[ExportManager] Could not read current main process priority. Using fallback restore value.', error)
    originalMainProcessPriority = normalPriorityFallback
  }

  mainPriorityBoostApplied = trySetProcessPriorityWithFallback(process.pid, targetPriorityCandidates, 'main-process')

  try {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
    log.info(`[ExportManager] Started powerSaveBlocker id=${powerSaveBlockerId}`)
  } catch (error) {
    log.warn('[ExportManager] Failed to start powerSaveBlocker:', error)
    powerSaveBlockerId = null
  }

  showExportProgressWindow()
  createExportTray()
  appState.currentExportProgress = { progress: 0, stage: 'Authorizing export...', exportSessionId }
  log.info(`${sessionLogPrefix}[Progress] Initialized current export progress state.`, appState.currentExportProgress)
  sendProgressUpdate(0, 'Authorizing export...', true, 'startup')
  if (!editorWindow.isDestroyed()) {
    editorWindow.setSkipTaskbar(true)
    editorWindow.hide()
  }
  log.info(`${sessionLogPrefix} Export startup UI initialized in ${getElapsedDurationSeconds().toFixed(2)} seconds.`)

  const outputDir = path.dirname(outputPath)
  try {
    if (!fs.existsSync(outputDir)) {
      log.info(`[ExportManager] Creating missing directory: ${outputDir}`)
      fs.mkdirSync(outputDir, { recursive: true })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown output directory error'
    failExportStartup(`Failed to prepare output directory: ${message}`)
    return
  }

  let adaptiveSourceInfo: SourceVideoInfo | null = null
  if (requestedExportSettings.adaptiveRender) {
    sendProgressUpdate(1, 'Reading source media...', true, 'adaptive-source')
    adaptiveSourceInfo = await readSourceVideoInfo(projectState.videoPath)
    if (adaptiveSourceInfo?.width && adaptiveSourceInfo.height) {
      requestedExportSettings.effectiveWidth = adaptiveSourceInfo.width
      requestedExportSettings.effectiveHeight = adaptiveSourceInfo.height
    }
    const cappedAdaptiveFps = sanitizeExportFrameRate(adaptiveSourceInfo?.fps)
    if (cappedAdaptiveFps) {
      requestedExportSettings.effectiveFps = cappedAdaptiveFps
      if (adaptiveSourceInfo?.fps && cappedAdaptiveFps < adaptiveSourceInfo.fps) {
        log.warn(
          `[ExportManager] Adaptive source fps ${adaptiveSourceInfo.fps.toFixed(3)} exceeds supported export max ${MAX_SUPPORTED_EXPORT_FPS}. Exporting at ${cappedAdaptiveFps.toFixed(3)}fps.`,
        )
      }
    }
    const fpsLog = adaptiveSourceInfo?.fps ? adaptiveSourceInfo.fps.toFixed(3) : 'unknown'
    const averageFpsLog = adaptiveSourceInfo?.averageFps ? adaptiveSourceInfo.averageFps.toFixed(3) : 'unknown'
    const nominalFpsLog = adaptiveSourceInfo?.nominalFps ? adaptiveSourceInfo.nominalFps.toFixed(3) : 'unknown'
    log.info(
      `[ExportManager] Adaptive export source info: ${adaptiveSourceInfo?.width || 'unknown'}x${adaptiveSourceInfo?.height || 'unknown'} @ ${fpsLog}fps (average=${averageFpsLog}, nominal=${nominalFpsLog})`,
    )
  }

  let normalizedExportSettings: NormalizedExportSettings = requestedExportSettings
  try {
    const authorizationSelection: ExportSelectionRequest = requestedExportSettings.adaptiveRender
      ? {
          format: requestedExportSettings.format,
          resolution: mapHeightToExportResolution(
            requestedExportSettings.effectiveHeight || projectState.videoDimensions?.height || 720,
          ),
          fps: mapFpsToExportTier(requestedExportSettings.effectiveFps ?? null, requestedExportSettings.fps),
        }
      : {
          format: requestedExportSettings.format,
          resolution: requestedExportSettings.resolution,
          fps: requestedExportSettings.fps,
        }
    const authorizedExport = await authorizeDesktopExport({
      format: authorizationSelection.format,
      resolution: authorizationSelection.resolution,
      fps: authorizationSelection.fps,
    })

    if (exportCompleted) return

    normalizedExportSettings = {
      ...requestedExportSettings,
      format: authorizedExport.approved.format,
      resolution: requestedExportSettings.adaptiveRender
        ? requestedExportSettings.resolution
        : authorizedExport.approved.resolution,
      fps: requestedExportSettings.adaptiveRender
        ? requestedExportSettings.fps
        : authorizedExport.approved.fps,
    }
  } catch (error) {
    if (exportCompleted) return
    cleanupExportUi()
    cleanupListeners()
    throw error
  }

  const createAndLoadRenderWorker = () => {
    closeRenderWorker()
    appState.renderWorker = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        preload: PRELOAD_SCRIPT,
        offscreen: false,
        webSecurity: false,
        backgroundThrottling: false,
      },
    })

    appState.renderWorker.webContents.on('preload-error', (_event, preloadPath, error) => {
      log.error(`[ExportManager][RenderWorker] Preload failed: ${preloadPath}`, error)
    })
    appState.renderWorker.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      log.error(`[ExportManager][RenderWorker] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
    })
    appState.renderWorker.webContents.on('did-finish-load', () => {
      log.info(`${sessionLogPrefix}[RenderWorker] Finished loading renderer worker.`)
    })
    appState.renderWorker.webContents.on('render-process-gone', (_event, details) => {
      log.error('[ExportManager][RenderWorker] Render process gone:', details)
    })
    appState.renderWorker.webContents.on('console-message', (event, ...legacyArgs) => {
      const eventDetails = event as unknown as {
        level?: number
        message?: string
        lineNumber?: number
        sourceId?: string
      }
      const legacyLevel = legacyArgs[0]
      const legacyMessage = legacyArgs[1]
      const legacyLineNumber = legacyArgs[2]
      const legacySourceId = legacyArgs[3]
      const messageDetails =
        typeof legacyLevel === 'number'
          ? {
              level: legacyLevel,
              message: typeof legacyMessage === 'string' ? legacyMessage : '',
              lineNumber: typeof legacyLineNumber === 'number' ? legacyLineNumber : 0,
              sourceId: typeof legacySourceId === 'string' ? legacySourceId : 'unknown',
            }
          : eventDetails
      const level = typeof messageDetails.level === 'number' ? messageDetails.level : 0
      const message = String(messageDetails.message ?? '')
      if (level < 2 && !message.startsWith('[Preload][Progress]') && !message.startsWith('[RendererPage]')) return

      const sourceId = messageDetails.sourceId || 'unknown'
      const lineNumber = messageDetails.lineNumber ?? 0
      const logMessage = `${sessionLogPrefix}[RenderWorker] Renderer console (${sourceId}:${lineNumber}): ${message}`
      if (level >= 3) {
        log.error(logMessage)
      } else if (level >= 2) {
        log.warn(logMessage)
      } else {
        log.info(logMessage)
      }
    })

    if (VITE_DEV_SERVER_URL) {
      const renderUrl = `${VITE_DEV_SERVER_URL}#renderer`
      appState.renderWorker.loadURL(renderUrl)
      log.info(`${sessionLogPrefix} Loading render worker URL (Dev): ${renderUrl}`)
    } else {
      const renderPath = path.join(RENDERER_DIST, 'index.html')
      appState.renderWorker.loadFile(renderPath, { hash: 'renderer' })
      log.info(`${sessionLogPrefix} Loading render worker file (Prod): ${renderPath}#renderer`)
    }
  }

  const { format, resolution } = normalizedExportSettings
  const presetDimensions = calculateExportDimensions(resolution, projectState.aspectRatio)
  const outputWidth =
    normalizedExportSettings.adaptiveRender && normalizedExportSettings.effectiveWidth
      ? normalizedExportSettings.effectiveWidth + (normalizedExportSettings.effectiveWidth % 2)
      : presetDimensions.width
  const outputHeight =
    normalizedExportSettings.adaptiveRender && normalizedExportSettings.effectiveHeight
      ? normalizedExportSettings.effectiveHeight + (normalizedExportSettings.effectiveHeight % 2)
      : presetDimensions.height
  const fps = sanitizeExportFrameRate(normalizedExportSettings.effectiveFps) || normalizedExportSettings.fps
  log.info(
    `${sessionLogPrefix} Effective export settings: adaptive=${normalizedExportSettings.adaptiveRender ? 'yes' : 'no'}, output=${outputWidth}x${outputHeight}, fps=${fps.toFixed(3)}`,
  )


  // Determine input format based on output format
  // If MP4, we receive H.264 stream from Renderer (WebCodecs)
  // If other (GIF), we receive raw RGBA frames
  const isMp4 = format === 'mp4'
  const canCopyAudioForMp4 = (audioPath: string) => {
    const ext = path.extname(audioPath).toLowerCase()
    return ext === '.aac' || ext === '.m4a' || ext === '.mp4'
  }

  const ffmpegArgs = ['-y']
  
  if (isMp4) {
    // Input is raw H.264 Byte Stream (Annex B)
    // We specify framerate here so FFmpeg knows how to interpret the stream timing
    ffmpegArgs.push(
       '-thread_queue_size', '1024',
       '-f', 'h264', 
       '-r', fps.toString(), 
       '-i', '-'
    )
  } else {
    ffmpegArgs.push(
      '-f', 'rawvideo',
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${outputWidth}x${outputHeight}`,
      '-r', fps.toString(),
      '-i', '-'
    )
  }

  // Prepare final audio for export:
  // - recording track (modulated by change-sound regions)
  // - media track (independent media regions)
  // - optional mix of both tracks
  let resolvedAudioInputPath: string | null = null

  const projectStateRecord = projectState as Record<string, unknown>
  try {
    sendProgressUpdate(2, 'Preparing audio...', true, 'audio-prep')
    const recordingPath = normalizeMediaPath(projectStateRecord.audioPath)
    const mediaClip = (projectStateRecord.mediaAudioClip || null) as MediaAudioClipLike | null
    const mediaPath = normalizeMediaPath(mediaClip?.path)
    const timelineLanes = Array.isArray(projectStateRecord.timelineLanes)
      ? (projectStateRecord.timelineLanes as LaneLike[])
      : [{ id: 'lane-1', order: 0 }]
    const mediaRegions = parseMediaAudioRegionsFromState(projectStateRecord, mediaClip)
    const changeSoundRegions = parseChangeSoundRegionsFromState(projectStateRecord)
    const duration =
      typeof projectState.duration === 'number' && Number.isFinite(projectState.duration)
        ? Math.max(0, projectState.duration)
        : 0
    const cutRegions = Object.values(projectState.cutRegions || {}) as CutLike[]
    const speedRegions = Object.values(projectState.speedRegions || {}) as SpeedLike[]
    const recordingTimelineSegments = buildAudioTimelineSegments(
      duration,
      cutRegions,
      speedRegions,
      timelineLanes,
      collectChangeSoundBoundaries(changeSoundRegions, duration),
    )
    const mediaTimelineSegments = buildAudioTimelineSegments(
      duration,
      cutRegions,
      speedRegions,
      timelineLanes,
      collectMediaAudioBoundaries(mediaRegions, duration),
    )
    const recordingHasNoTransform =
      recordingTimelineSegments.length === 1 &&
      Math.abs(recordingTimelineSegments[0].start) < 0.001 &&
      Math.abs(recordingTimelineSegments[0].duration - duration) < 0.001 &&
      Math.abs(recordingTimelineSegments[0].speed - 1) < 0.01 &&
      changeSoundRegions.length === 0

    let recordingTrackPath: string | null = null
    let mediaTrackPath: string | null = null

    if (recordingPath) {
      const recordingSegments = buildRecordingExportAudioSegments(recordingTimelineSegments, changeSoundRegions, timelineLanes)
      if (recordingSegments.length > 0) {
        if (recordingHasNoTransform) {
          log.info('[ExportManager] Reusing original recording audio; no recording audio edits detected.')
          recordingTrackPath = recordingPath
        } else {
          const processedRecordingPath = await renderProcessedAudioFile(recordingPath, recordingSegments, runAuxiliaryFFmpeg)
          if (!processedRecordingPath) {
            throw new Error('Failed to process recording audio track')
          }
          recordingTrackPath = processedRecordingPath
          processedAudioTempRoots.add(path.dirname(processedRecordingPath))
        }
      }
    }

    if (mediaPath && mediaRegions.length > 0) {
      const mediaSegments = buildMediaExportAudioSegments(mediaTimelineSegments, mediaRegions, timelineLanes)
      if (mediaSegments.length > 0) {
        const processedMediaPath = await renderProcessedAudioFile(mediaPath, mediaSegments, runAuxiliaryFFmpeg)
        if (!processedMediaPath) {
          throw new Error('Failed to process media audio track')
        }
        mediaTrackPath = processedMediaPath
        processedAudioTempRoots.add(path.dirname(processedMediaPath))
      }
    }

    if (recordingTrackPath && mediaTrackPath) {
      const mixedTrackPath = await mixAudioTracks(recordingTrackPath, mediaTrackPath, runAuxiliaryFFmpeg)
      if (!mixedTrackPath) {
        throw new Error('Failed to mix recording and media audio tracks')
      }
      resolvedAudioInputPath = mixedTrackPath
      processedAudioTempRoots.add(path.dirname(mixedTrackPath))
    } else {
      resolvedAudioInputPath = recordingTrackPath || mediaTrackPath
    }
  } catch (error) {
    log.error('[ExportManager] Error while preparing export audio input:', error)
    const message = error instanceof Error ? error.message : 'Unknown audio preparation error'
    failExportStartup(`Failed to prepare export audio: ${message}`)
    return
  }

  if (resolvedAudioInputPath) {
    ffmpegArgs.push('-i', resolvedAudioInputPath)
  }

  // --- Hardware acceleration auto-detect with real encoder check ---
  // --- Detect GPU type for encoder selection (Windows only) ---
  if (isMp4) {
    // Renderer already encoded the video to H.264 using hardware acceleration (WebCodecs)
    // We just copy the video stream and mux it with audio.
    // Use setts bitstream filter to generate monotonic timestamps (PTS=DTS=N) since raw stream lacks them
    ffmpegArgs.push('-c:v', 'copy', '-bsf:v', 'setts=dts=N:pts=N')
    log.info('[ExportManager] Using video stream copy (Renderer pre-encoded)')

    // If audio present
    if (resolvedAudioInputPath) {
      // Use input #1 (audio) which is either processed or original
      const audioCodecArgs = canCopyAudioForMp4(resolvedAudioInputPath) ? ['-c:a', 'copy'] : ['-c:a', 'aac']
      log.info('[ExportManager] Using audio stream mode for final mux.', {
        audioInput: resolvedAudioInputPath,
        codecArgs: audioCodecArgs.join(' '),
      })
      ffmpegArgs.push('-map', '0:v:0', '-map', '1:a:0', ...audioCodecArgs, '-shortest')
    }
  } else {
    ffmpegArgs.push('-vf', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse')
  }
  ffmpegArgs.push(outputPath)

  sendProgressUpdate(4, 'Starting renderer...', true, 'main')
  log.info(`${sessionLogPrefix} Spawning FFmpeg with args:`, ffmpegArgs.join(' '))
  ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)
  const activeFFmpeg = ffmpeg
  if (typeof activeFFmpeg.pid === 'number') {
    trySetProcessPriorityWithFallback(activeFFmpeg.pid, targetPriorityCandidates, 'ffmpeg')
  }

  activeFFmpeg.stderr.on('data', (data) => log.info(`[FFmpeg stderr]: ${data.toString()}`))

  cleanupProcessedAudio = () => {
    try {
      processedAudioTempRoots.forEach((tmpDir) => {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
      })
      processedAudioTempRoots.clear()
    } catch (err) {
      log.error('[ExportManager] Failed to cleanup processed audio temp:', err)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frameListener = (_e: any, { frame, progress }: { frame: Buffer; progress: number }) => {
    if (!ffmpegClosed && activeFFmpeg.stdin.writable) activeFFmpeg.stdin.write(frame)
    const frameProgressLog = shouldLogProgressBucket(progress, lastFrameProgressLogBucket)
    if (frameProgressLog.shouldLog) {
      lastFrameProgressLogBucket = frameProgressLog.bucket
      log.info(`${sessionLogPrefix}[Progress] Received export:frame-data progress.`, {
        progress: Number(clamp(progress, 0, 100).toFixed(2)),
        frameBytes: frame.byteLength,
      })
    }
    sendProgressUpdate(progress, 'Rendering...', false, 'frame-data')
  }

  const renderProgressListener = (_e: unknown, { progress }: { progress: number }) => {
    const renderProgressLog = shouldLogProgressBucket(progress, lastRendererProgressLogBucket)
    if (renderProgressLog.shouldLog) {
      lastRendererProgressLogBucket = renderProgressLog.bucket
      log.info(`${sessionLogPrefix}[Progress] Received export:render-progress from renderer.`, {
        progress: Number(clamp(progress, 0, 100).toFixed(2)),
      })
    }
    sendProgressUpdate(progress, 'Rendering...', false, 'render-progress')
  }

  const finishListener = () => {
    log.info(`${sessionLogPrefix} Render finished. Closing FFmpeg stdin.`)
    const finalizingProgress = lastProgressBroadcast < 0 ? 0 : Math.max(lastProgressBroadcast, 99)
    sendProgressUpdate(finalizingProgress, 'Finalizing export...', true, 'render-finished')
    if (!ffmpegClosed && activeFFmpeg.stdin.writable) {
      activeFFmpeg.stdin.end()
    }
  }

  cleanupListeners = () => {
    ipcMain.removeListener('export:frame-data', frameListener)
    ipcMain.removeListener('export:render-progress', renderProgressListener)
    ipcMain.removeListener('export:render-finished', finishListener)
    ipcMain.removeListener('export:cancel', cancellationHandler)
    ipcMain.removeListener('export:render-error', renderErrorListener)
    if (renderReadyListener) {
      ipcMain.removeListener('render:ready', renderReadyListener)
      renderReadyListener = null
    }
  }

  const renderErrorListener = (_e: unknown, { error }: { error: string }) => {
    if (exportCompleted) return

    log.error(`${sessionLogPrefix} Render error:`, error)
    exportCompleted = true
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill('SIGKILL')
    }
    killAuxiliaryFFmpegProcesses()
    closeRenderWorker()

    sendExportComplete({ success: false, error, duration: getElapsedDurationSeconds() }, 'error')
    cleanupExportUi()
    cleanupProcessedAudio()
    cleanupListeners()
  }

  ipcMain.on('export:frame-data', frameListener)
  ipcMain.on('export:render-progress', renderProgressListener)
  ipcMain.on('export:render-finished', finishListener)
  ipcMain.on('export:render-error', renderErrorListener)

  activeFFmpeg.on('error', (error) => {
    ffmpegClosed = true
    log.error('[ExportManager] Failed to start FFmpeg process:', error)
    failExportStartup(getFFmpegSpawnErrorMessage(error))
  })

  activeFFmpeg.on('close', (code) => {
    ffmpegClosed = true
    log.info(`${sessionLogPrefix} FFmpeg process exited with code ${code}.`)

    cleanupProcessedAudio()

    closeRenderWorker()

    if (!exportCompleted) {
      exportCompleted = true
      const renderDuration = getElapsedDurationSeconds()
      if (code === null) {
        sendExportComplete({ success: false, error: 'Export cancelled.', duration: renderDuration }, 'cancelled')
      } else if (code === 0) {
        log.info(`${sessionLogPrefix} Export completed successfully in ${renderDuration.toFixed(2)} seconds.`)
        sendProgressUpdate(100, 'Export completed', true, 'ffmpeg-close')
        sendExportComplete({ success: true, outputPath, duration: renderDuration }, 'success')
      } else {
        sendExportComplete({ success: false, error: `FFmpeg exited with code ${code}`, duration: renderDuration }, 'error')
      }
    }

    cleanupExportUi()
    cleanupListeners()
  })

  const staleRenderReadyListeners = ipcMain.listenerCount('render:ready')
  if (staleRenderReadyListeners > 0) {
    log.warn(`[ExportManager] Removing ${staleRenderReadyListeners} stale render:ready listener(s) before export.`)
    ipcMain.removeAllListeners('render:ready')
  }

  renderReadyListener = () => {
    renderReadyListener = null
    log.info(`${sessionLogPrefix} Worker ready. Sending project state.`)
    sendProgressUpdate(5, 'Rendering...', true, 'render-ready')
    if (appState.renderWorker && !appState.renderWorker.isDestroyed()) {
      appState.renderWorker.webContents.send('render:start', {
        projectState,
        exportSettings: normalizedExportSettings,
        exportSessionId,
      })
    }
  }
  ipcMain.once('render:ready', renderReadyListener)
  try {
    createAndLoadRenderWorker()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown renderer startup error'
    failExportStartup(`Failed to start renderer worker: ${message}`)
  }
}
