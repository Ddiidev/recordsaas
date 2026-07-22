import type {
  ProjectState,
  ProjectActions,
  Slice,
  CameraSwapRegion,
  WebcamLayout,
  WebcamPosition,
  WebcamStyles,
  RecordingGeometry,
  VideoDimensions,
  CursorTheme,
  CursorImageBitmap,
  MediaAudioClip,
  MediaAudioRegion,
  ChangeSoundRegion,
  FloatingMonitor,
  FloatingMonitorRegion,
  AssetTimelineState,
  SwapParticipant,
} from '../../types'
import type { MetaDataItem, ZoomRegion, CursorFrame } from '../../types'
import { BLUR_REGION, DEFAULTS, SWAP_REGION, ZOOM } from '../../lib/constants'
import { initialFrameState, recalculateCanvasDimensions } from './frameSlice'
import { initialWebcamState } from './webcamSlice'
import { prepareCursorBitmaps } from '../../lib/utils'
import { createDefaultTimelineLane, getFallbackLaneId } from '../../lib/timeline-lanes'
import { isWebcamShape, normalizeWebcamCrop, normalizeWebcamLayoutMode } from '../../lib/webcam'
import { normalizeMediaPath, toMediaUrl } from '../../lib/media-url'

export const initialProjectState: ProjectState = {
  videoPath: null,
  metadataPath: null,
  videoUrl: null,
  audioPath: null,
  audioUrl: null,
  systemAudioPath: null,
  systemAudioUrl: null,
  systemAudioVolume: 1,
  systemAudioMuted: false,
  mediaAudioClip: null,
  floatingMonitors: {},
  assetTimelineEditing: null,
  videoDimensions: { width: 0, height: 0 },
  recordingGeometry: null,
  screenSize: null,
  canvasDimensions: { width: 0, height: 0 },
  metadata: [],
  duration: 0,
  cursorImages: {},
  cursorBitmapsToRender: new Map<string, CursorImageBitmap>(),
  syncOffset: 0,
  platform: null,
  cursorTheme: null,
  hasAudioTrack: false,
}

const clampToNonNegative = (value: number): number => Math.max(0, value)

const clampStartTime = (value: number, duration: number): number => {
  if (!Number.isFinite(duration) || duration <= 0) return clampToNonNegative(value)
  return Math.max(0, Math.min(value, duration))
}

const fallbackNameFromPath = (filePath: string): string => {
  const chunks = filePath.split(/[\\/]/).filter(Boolean)
  return chunks[chunks.length - 1] || 'audio'
}

const clampAudioVolume = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 1

const cloneSerializable = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const createAssetTimeline = (
  duration = 0,
  videoDimensions: VideoDimensions = { width: 0, height: 0 },
): AssetTimelineState => ({
  duration,
  videoDimensions,
  frameStyles: cloneSerializable(initialFrameState.frameStyles),
  aspectRatio: initialFrameState.aspectRatio,
  timelineLanes: [createDefaultTimelineLane()],
  zoomRegions: {},
  cutRegions: {},
  speedRegions: {},
  blurRegions: {},
  swapRegions: {},
  floatingMonitorRegions: {},
  blurDefaults: {
    duration: BLUR_REGION.DEFAULT_DURATION,
    style: BLUR_REGION.STYLE.DEFAULT,
    intensity: BLUR_REGION.INTENSITY.defaultValue,
    x: BLUR_REGION.X.defaultValue,
    y: BLUR_REGION.Y.defaultValue,
    width: BLUR_REGION.WIDTH.defaultValue,
    height: BLUR_REGION.HEIGHT.defaultValue,
  },
  swapDefaults: {
    duration: SWAP_REGION.DEFAULT_DURATION,
    origin: { kind: 'main-screen' },
    target: { kind: 'webcam' },
    transition: SWAP_REGION.TRANSITION.DEFAULT,
    transitionDuration: SWAP_REGION.TRANSITION_DURATION.defaultValue,
  },
  selectedRegionId: null,
})

const cloneSwapParticipant = (participant: SwapParticipant): SwapParticipant =>
  participant.kind === 'floating-monitor-region'
    ? { kind: participant.kind, regionId: participant.regionId }
    : { kind: participant.kind }

const sameSwapParticipant = (left: SwapParticipant, right: SwapParticipant): boolean =>
  left.kind === right.kind &&
  (left.kind !== 'floating-monitor-region' ||
    right.kind !== 'floating-monitor-region' ||
    left.regionId === right.regionId)

const parseSwapParticipant = (value: unknown): SwapParticipant | null => {
  if (!value || typeof value !== 'object') return null
  const participant = value as Partial<SwapParticipant>
  if (participant.kind === 'main-screen' || participant.kind === 'webcam') {
    return { kind: participant.kind }
  }
  if (participant.kind === 'floating-monitor-region') {
    return {
      kind: 'floating-monitor-region',
      regionId: typeof participant.regionId === 'string' ? participant.regionId : '',
    }
  }
  return null
}

const findLegacyMonitorRegionId = (regions: unknown, monitorId: unknown): string => {
  if (!regions || typeof regions !== 'object' || typeof monitorId !== 'string') return ''
  const matches = Object.entries(regions as Record<string, unknown>).filter(([, rawRegion]) => {
    if (!rawRegion || typeof rawRegion !== 'object') return false
    return (rawRegion as Partial<FloatingMonitorRegion>).monitorId === monitorId
  })
  return matches.length === 1 ? matches[0][0] : ''
}

const parseAssetTimeline = (
  value: unknown,
  duration: number,
  videoDimensions: VideoDimensions = { width: 0, height: 0 },
): AssetTimelineState => {
  const fallback = createAssetTimeline(duration, videoDimensions)
  if (!value || typeof value !== 'object') return fallback
  const timeline = value as Partial<AssetTimelineState>
  return {
    ...fallback,
    duration:
      typeof timeline.duration === 'number' && Number.isFinite(timeline.duration)
        ? Math.max(0, timeline.duration)
        : duration,
    videoDimensions:
      timeline.videoDimensions &&
      typeof timeline.videoDimensions.width === 'number' &&
      typeof timeline.videoDimensions.height === 'number'
        ? timeline.videoDimensions
        : videoDimensions,
    frameStyles: timeline.frameStyles || fallback.frameStyles,
    aspectRatio: timeline.aspectRatio || fallback.aspectRatio,
    timelineLanes:
      Array.isArray(timeline.timelineLanes) && timeline.timelineLanes.length > 0
        ? timeline.timelineLanes
        : fallback.timelineLanes,
    zoomRegions: timeline.zoomRegions || {},
    cutRegions: timeline.cutRegions || {},
    speedRegions: timeline.speedRegions || {},
    blurRegions: timeline.blurRegions || {},
    swapRegions: parseSwapRegions(
      timeline.swapRegions,
      fallback.timelineLanes[0]?.id || createDefaultTimelineLane().id,
      timeline.floatingMonitorRegions,
    ),
    floatingMonitorRegions: timeline.floatingMonitorRegions || {},
    blurDefaults: timeline.blurDefaults || fallback.blurDefaults,
    swapDefaults: timeline.swapDefaults || fallback.swapDefaults,
    cursorStyles: timeline.cursorStyles,
    selectedRegionId: typeof timeline.selectedRegionId === 'string' ? timeline.selectedRegionId : null,
  }
}

const parseMediaAudioClip = (value: unknown): MediaAudioClip | null => {
  if (!value || typeof value !== 'object') return null
  const clip = value as Partial<MediaAudioClip>
  if (!clip.path || typeof clip.path !== 'string') return null
  const normalizedPath = normalizeMediaPath(clip.path)

  const duration =
    typeof clip.duration === 'number' && Number.isFinite(clip.duration) ? clampToNonNegative(clip.duration) : 0
  const startTime =
    typeof clip.startTime === 'number' && Number.isFinite(clip.startTime) ? clampToNonNegative(clip.startTime) : 0

  return {
    id: typeof clip.id === 'string' && clip.id.length > 0 ? clip.id : `media-audio-${Date.now()}`,
    path: normalizedPath,
    url: toMediaUrl(normalizedPath) || '',
    name: typeof clip.name === 'string' && clip.name.length > 0 ? clip.name : fallbackNameFromPath(normalizedPath),
    duration,
    startTime,
  }
}

const parseFloatingMonitors = (value: unknown): Record<string, FloatingMonitor> => {
  if (!value || typeof value !== 'object') return {}

  const monitors = Object.entries(value as Record<string, unknown>).reduce(
    (monitors, [monitorId, rawMonitor]) => {
      if (!rawMonitor || typeof rawMonitor !== 'object') return monitors
      const monitor = rawMonitor as Partial<FloatingMonitor>
      if (typeof monitor.path !== 'string' || monitor.path.length === 0) return monitors

      const path = normalizeMediaPath(monitor.path)
      const kind = monitor.kind === 'image' ? 'image' : 'video'
      const duration =
        typeof monitor.duration === 'number' && Number.isFinite(monitor.duration)
          ? clampToNonNegative(monitor.duration)
          : kind === 'image'
            ? 5
            : 0
      const timelineStart =
        typeof monitor.timelineStart === 'number' && Number.isFinite(monitor.timelineStart)
          ? kind === 'image'
            ? Math.max(0, monitor.timelineStart)
            : Math.min(Math.max(0, monitor.timelineStart), duration)
          : 0
      const timelineDuration =
        typeof monitor.timelineDuration === 'number' && Number.isFinite(monitor.timelineDuration)
          ? kind === 'image'
            ? Math.max(0, monitor.timelineDuration)
            : Math.max(0, Math.min(monitor.timelineDuration, Math.max(0, duration - timelineStart)))
          : Math.max(0, duration - timelineStart)
      const id =
        typeof monitor.id === 'string' && monitor.id.length > 0
          ? monitor.id
          : monitorId || `floating-monitor-${Date.now()}`
      const name =
        typeof monitor.name === 'string' && monitor.name.length > 0 ? monitor.name : fallbackNameFromPath(path)
      const originalName =
        typeof monitor.originalName === 'string' && monitor.originalName.length > 0 ? monitor.originalName : name

      monitors[id] = {
        id,
        kind,
        path,
        url: toMediaUrl(path) || '',
        name,
        originalName,
        isEditedCopy: monitor.isEditedCopy === true || name !== originalName,
        duration,
        timelineStart,
        timelineDuration,
        x: typeof monitor.x === 'number' && Number.isFinite(monitor.x) ? Math.max(0, Math.min(monitor.x, 1)) : 0.68,
        y: typeof monitor.y === 'number' && Number.isFinite(monitor.y) ? Math.max(0, Math.min(monitor.y, 1)) : 0.68,
        width:
          typeof monitor.width === 'number' && Number.isFinite(monitor.width)
            ? Math.max(0.1, Math.min(monitor.width, 1))
            : 0.28,
        height:
          typeof monitor.height === 'number' && Number.isFinite(monitor.height)
            ? Math.max(0.1, Math.min(monitor.height, 1))
            : 0.28,
        timeline: parseAssetTimeline(monitor.timeline, duration),
      }
      return monitors
    },
    {} as Record<string, FloatingMonitor>,
  )

  Object.values(monitors).forEach((monitor) => {
    if (!monitor.timeline) return
    const fallbackLaneId = getFallbackLaneId(monitor.timeline.timelineLanes)
    const rawFloatingMonitorRegions = monitor.timeline.floatingMonitorRegions
    monitor.timeline.swapRegions = parseSwapRegions(
      monitor.timeline.swapRegions,
      fallbackLaneId,
      rawFloatingMonitorRegions,
    )
    monitor.timeline.floatingMonitorRegions = parseFloatingMonitorRegions(
      rawFloatingMonitorRegions,
      monitors,
      fallbackLaneId,
    )
  })

  return monitors
}

const parseFloatingMonitorRegions = (
  value: unknown,
  monitors: Record<string, FloatingMonitor>,
  fallbackLaneId: string,
): Record<string, FloatingMonitorRegion> => {
  if (!value || typeof value !== 'object') return {}

  return Object.entries(value as Record<string, unknown>).reduce(
    (regions, [regionId, rawRegion]) => {
      if (!rawRegion || typeof rawRegion !== 'object') return regions
      const region = rawRegion as Partial<FloatingMonitorRegion>
      if (typeof region.monitorId !== 'string' || !monitors[region.monitorId]) return regions
      const startTime =
        typeof region.startTime === 'number' && Number.isFinite(region.startTime)
          ? clampToNonNegative(region.startTime)
          : 0
      const sourceStart =
        typeof region.sourceStart === 'number' && Number.isFinite(region.sourceStart)
          ? clampToNonNegative(region.sourceStart)
          : 0
      const duration =
        typeof region.duration === 'number' && Number.isFinite(region.duration) ? Math.max(0.1, region.duration) : 0.1
      const id =
        typeof region.id === 'string' && region.id.length > 0
          ? region.id
          : regionId || `floating-monitor-region-${Date.now()}`
      regions[id] = {
        id,
        type: 'floating-monitor',
        monitorId: region.monitorId,
        laneId: typeof region.laneId === 'string' && region.laneId.length > 0 ? region.laneId : fallbackLaneId,
        startTime,
        duration,
        sourceStart,
        x:
          typeof region.x === 'number' && Number.isFinite(region.x)
            ? Math.max(0, Math.min(region.x, 1))
            : monitors[region.monitorId].x,
        y:
          typeof region.y === 'number' && Number.isFinite(region.y)
            ? Math.max(0, Math.min(region.y, 1))
            : monitors[region.monitorId].y,
        width:
          typeof region.width === 'number' && Number.isFinite(region.width)
            ? Math.max(0.1, Math.min(region.width, 1))
            : monitors[region.monitorId].width,
        height:
          typeof region.height === 'number' && Number.isFinite(region.height)
            ? Math.max(0.1, Math.min(region.height, 1))
            : monitors[region.monitorId].height,
        crop: normalizeWebcamCrop(region.crop),
        borderRadius:
          typeof region.borderRadius === 'number' && Number.isFinite(region.borderRadius)
            ? Math.max(
                DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.min,
                Math.min(region.borderRadius, DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.max),
              )
            : DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.defaultValue,
        isFlipped: region.isFlipped === true,
        border:
          typeof region.border === 'boolean'
            ? region.border
            : DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.ENABLED.defaultValue,
        borderWidth:
          typeof region.borderWidth === 'number' && Number.isFinite(region.borderWidth)
            ? Math.max(
                DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.min,
                Math.min(region.borderWidth, DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.max),
              )
            : DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.defaultValue,
        borderColor:
          typeof region.borderColor === 'string' && region.borderColor.length > 0
            ? region.borderColor
            : DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.DEFAULT_COLOR_RGBA,
        shadowBlur:
          typeof region.shadowBlur === 'number' && Number.isFinite(region.shadowBlur)
            ? Math.max(
                DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.min,
                Math.min(region.shadowBlur, DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.max),
              )
            : DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.defaultValue,
        shadowOffsetX:
          typeof region.shadowOffsetX === 'number' && Number.isFinite(region.shadowOffsetX)
            ? Math.max(
                DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.min,
                Math.min(region.shadowOffsetX, DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.max),
              )
            : DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.defaultValue,
        shadowOffsetY:
          typeof region.shadowOffsetY === 'number' && Number.isFinite(region.shadowOffsetY)
            ? Math.max(
                DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.min,
                Math.min(region.shadowOffsetY, DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.max),
              )
            : DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.defaultValue,
        shadowColor:
          typeof region.shadowColor === 'string' && region.shadowColor.length > 0
            ? region.shadowColor
            : DEFAULTS.FLOATING_MONITOR.EFFECTS.DEFAULT_COLOR_RGBA,
        zIndex: typeof region.zIndex === 'number' && Number.isFinite(region.zIndex) ? region.zIndex : 0,
      }
      return regions
    },
    {} as Record<string, FloatingMonitorRegion>,
  )
}

const parseMediaAudioRegion = (
  value: unknown,
  fallbackLaneId: string,
  clipDuration: number,
): MediaAudioRegion | null => {
  if (!value || typeof value !== 'object') return null
  const region = value as Partial<MediaAudioRegion>

  const startTime =
    typeof region.startTime === 'number' && Number.isFinite(region.startTime) ? clampToNonNegative(region.startTime) : 0
  const duration =
    typeof region.duration === 'number' && Number.isFinite(region.duration)
      ? Math.max(0.1, clampToNonNegative(region.duration))
      : clipDuration > 0
        ? clipDuration
        : 1
  const sourceStart =
    typeof region.sourceStart === 'number' && Number.isFinite(region.sourceStart)
      ? clampToNonNegative(region.sourceStart)
      : 0

  const maxDurationFromSource = clipDuration > 0 ? Math.max(0.1, clipDuration - sourceStart) : duration
  const safeDuration = Math.max(0.1, Math.min(duration, maxDurationFromSource))

  const fadeInDuration =
    typeof region.fadeInDuration === 'number' && Number.isFinite(region.fadeInDuration)
      ? Math.max(0, Math.min(region.fadeInDuration, safeDuration))
      : 0
  const fadeOutDuration =
    typeof region.fadeOutDuration === 'number' && Number.isFinite(region.fadeOutDuration)
      ? Math.max(0, Math.min(region.fadeOutDuration, safeDuration))
      : 0
  const volume =
    typeof region.volume === 'number' && Number.isFinite(region.volume) ? Math.max(0, Math.min(region.volume, 1)) : 1

  return {
    id: typeof region.id === 'string' && region.id.length > 0 ? region.id : `media-audio-${Date.now()}`,
    type: 'media-audio',
    laneId: typeof region.laneId === 'string' && region.laneId.length > 0 ? region.laneId : fallbackLaneId,
    startTime,
    duration: safeDuration,
    sourceStart,
    isMuted: region.isMuted === true,
    volume,
    fadeInDuration,
    fadeOutDuration,
    zIndex: typeof region.zIndex === 'number' && Number.isFinite(region.zIndex) ? region.zIndex : 0,
  }
}

const parseMediaAudioRegions = (
  value: unknown,
  fallbackLaneId: string,
  clip: MediaAudioClip | null,
): Record<string, MediaAudioRegion> => {
  const clipDuration = clip?.duration ?? 0

  if (value && typeof value === 'object') {
    const parsed = Object.entries(value as Record<string, unknown>).reduce(
      (acc, [regionId, rawValue]) => {
        const parsedRegion = parseMediaAudioRegion(rawValue, fallbackLaneId, clipDuration)
        if (!parsedRegion) return acc
        parsedRegion.id = regionId || parsedRegion.id
        acc[parsedRegion.id] = parsedRegion
        return acc
      },
      {} as Record<string, MediaAudioRegion>,
    )

    if (Object.keys(parsed).length > 0) {
      return parsed
    }
  }

  if (!clip) {
    return {}
  }

  const legacyDuration = clip.duration > 0 ? clip.duration : 1
  const legacyRegion: MediaAudioRegion = {
    id: `media-audio-${Date.now()}`,
    type: 'media-audio',
    laneId: fallbackLaneId,
    startTime: clampToNonNegative(clip.startTime),
    duration: Math.max(0.1, legacyDuration),
    sourceStart: 0,
    isMuted: false,
    volume: 1,
    fadeInDuration: 0,
    fadeOutDuration: 0,
    zIndex: 0,
  }

  return { [legacyRegion.id]: legacyRegion }
}

const parseChangeSoundRegion = (value: unknown, fallbackLaneId: string): ChangeSoundRegion | null => {
  if (!value || typeof value !== 'object') return null
  const region = value as Partial<ChangeSoundRegion>

  const startTime =
    typeof region.startTime === 'number' && Number.isFinite(region.startTime) ? clampToNonNegative(region.startTime) : 0
  const duration =
    typeof region.duration === 'number' && Number.isFinite(region.duration)
      ? Math.max(0.1, clampToNonNegative(region.duration))
      : 1
  const sourceKey = region.sourceKey === 'system-audio' ? 'system-audio' : 'recording-mic'
  const isMuted = region.isMuted === true
  const volume =
    typeof region.volume === 'number' && Number.isFinite(region.volume) ? Math.max(0, Math.min(region.volume, 1)) : 1
  const fadeInDuration =
    typeof region.fadeInDuration === 'number' && Number.isFinite(region.fadeInDuration)
      ? Math.max(0, Math.min(region.fadeInDuration, duration))
      : 0
  const fadeOutDuration =
    typeof region.fadeOutDuration === 'number' && Number.isFinite(region.fadeOutDuration)
      ? Math.max(0, Math.min(region.fadeOutDuration, duration))
      : 0

  return {
    id: typeof region.id === 'string' && region.id.length > 0 ? region.id : `change-sound-${Date.now()}`,
    type: 'change-sound',
    laneId: typeof region.laneId === 'string' && region.laneId.length > 0 ? region.laneId : fallbackLaneId,
    startTime,
    duration,
    sourceKey,
    isMuted,
    volume,
    fadeInDuration,
    fadeOutDuration,
    zIndex: typeof region.zIndex === 'number' && Number.isFinite(region.zIndex) ? region.zIndex : 0,
  }
}

const parseChangeSoundRegions = (value: unknown, fallbackLaneId: string): Record<string, ChangeSoundRegion> => {
  if (!value || typeof value !== 'object') return {}

  return Object.entries(value as Record<string, unknown>).reduce(
    (acc, [regionId, rawValue]) => {
      const parsedRegion = parseChangeSoundRegion(rawValue, fallbackLaneId)
      if (!parsedRegion) return acc
      parsedRegion.id = regionId || parsedRegion.id
      acc[parsedRegion.id] = parsedRegion
      return acc
    },
    {} as Record<string, ChangeSoundRegion>,
  )
}

const VALID_WEBCAM_POSITIONS: WebcamPosition['pos'][] = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

const parseWebcamLayout = (value: unknown): WebcamLayout => {
  const layout = value && typeof value === 'object' ? (value as Partial<WebcamLayout>) : {}
  const mode = normalizeWebcamLayoutMode(layout.mode)
  const side = DEFAULTS.CAMERA.LAYOUT.SIDE.values.includes(layout.side as WebcamLayout['side'])
    ? (layout.side as WebcamLayout['side'])
    : DEFAULTS.CAMERA.LAYOUT.SIDE.defaultValue
  const webcamWidthPercent =
    typeof layout.webcamWidthPercent === 'number' && Number.isFinite(layout.webcamWidthPercent)
      ? Math.max(
          DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.min,
          Math.min(DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.max, layout.webcamWidthPercent),
        )
      : DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.defaultValue

  return {
    mode,
    side,
    webcamWidthPercent,
  }
}

const parseWebcamPosition = (value: unknown): WebcamPosition => {
  const pos = value && typeof value === 'object' ? (value as Partial<WebcamPosition>).pos : undefined
  return {
    pos: VALID_WEBCAM_POSITIONS.includes(pos as WebcamPosition['pos'])
      ? (pos as WebcamPosition['pos'])
      : initialWebcamState.webcamPosition.pos,
  }
}

const parseWebcamStyles = (value: unknown): WebcamStyles => {
  const styles = value && typeof value === 'object' ? (value as Partial<WebcamStyles>) : {}
  const nextStyles: WebcamStyles = JSON.parse(JSON.stringify(initialWebcamState.webcamStyles))

  if (isWebcamShape(styles.shape)) {
    nextStyles.shape = styles.shape
  }
  if (typeof styles.borderRadius === 'number' && Number.isFinite(styles.borderRadius)) {
    nextStyles.borderRadius = Math.max(0, Math.min(50, styles.borderRadius))
  }
  if (typeof styles.size === 'number' && Number.isFinite(styles.size)) {
    nextStyles.size = Math.max(
      DEFAULTS.CAMERA.PLACEMENT.SIZE.min,
      Math.min(DEFAULTS.CAMERA.PLACEMENT.SIZE.max, styles.size),
    )
  }
  if (typeof styles.sizeOnZoom === 'number' && Number.isFinite(styles.sizeOnZoom)) {
    nextStyles.sizeOnZoom = Math.max(
      DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.min,
      Math.min(DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.max, styles.sizeOnZoom),
    )
  }
  if (typeof styles.shadowBlur === 'number' && Number.isFinite(styles.shadowBlur)) {
    nextStyles.shadowBlur = styles.shadowBlur
  }
  if (typeof styles.shadowOffsetX === 'number' && Number.isFinite(styles.shadowOffsetX)) {
    nextStyles.shadowOffsetX = styles.shadowOffsetX
  }
  if (typeof styles.shadowOffsetY === 'number' && Number.isFinite(styles.shadowOffsetY)) {
    nextStyles.shadowOffsetY = styles.shadowOffsetY
  }
  if (typeof styles.shadowColor === 'string' && styles.shadowColor.length > 0) {
    nextStyles.shadowColor = styles.shadowColor
  }
  if (typeof styles.isFlipped === 'boolean') {
    nextStyles.isFlipped = styles.isFlipped
  }
  if (typeof styles.scaleOnZoom === 'boolean') {
    nextStyles.scaleOnZoom = styles.scaleOnZoom
  }
  if (typeof styles.smartPosition === 'boolean') {
    nextStyles.smartPosition = styles.smartPosition
  }
  if (typeof styles.border === 'boolean') {
    nextStyles.border = styles.border
  }
  if (typeof styles.borderWidth === 'number' && Number.isFinite(styles.borderWidth)) {
    nextStyles.borderWidth = Math.max(
      DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.min,
      Math.min(DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.max, styles.borderWidth),
    )
  }
  if (typeof styles.borderColor === 'string' && styles.borderColor.length > 0) {
    nextStyles.borderColor = styles.borderColor
  }
  nextStyles.crop = normalizeWebcamCrop(styles.crop, nextStyles.crop)

  return nextStyles
}

const parseSwapRegion = (
  value: unknown,
  fallbackLaneId: string,
  floatingMonitorRegions?: unknown,
): CameraSwapRegion | null => {
  if (!value || typeof value !== 'object') return null
  const region = value as Omit<Partial<CameraSwapRegion>, 'target'> & {
    target?: unknown
    targetMonitorId?: unknown
  }

  const startTime =
    typeof region.startTime === 'number' && Number.isFinite(region.startTime) ? clampToNonNegative(region.startTime) : 0
  const duration =
    typeof region.duration === 'number' && Number.isFinite(region.duration)
      ? Math.max(0.1, clampToNonNegative(region.duration))
      : SWAP_REGION.DEFAULT_DURATION
  const transition =
    region.transition === 'none' ||
    region.transition === 'fade' ||
    region.transition === 'slide' ||
    region.transition === 'scale'
      ? region.transition
      : SWAP_REGION.TRANSITION.DEFAULT
  const transitionDuration =
    typeof region.transitionDuration === 'number' && Number.isFinite(region.transitionDuration)
      ? Math.max(
          SWAP_REGION.TRANSITION_DURATION.min,
          Math.min(SWAP_REGION.TRANSITION_DURATION.max, region.transitionDuration),
        )
      : SWAP_REGION.TRANSITION_DURATION.defaultValue

  const parsedOrigin = parseSwapParticipant(region.origin) || { kind: 'main-screen' as const }
  const parsedTarget = parseSwapParticipant(region.target)
  const legacyTarget =
    region.target === 'floating-monitor'
      ? {
          kind: 'floating-monitor-region' as const,
          regionId: findLegacyMonitorRegionId(floatingMonitorRegions, region.targetMonitorId),
        }
      : { kind: 'webcam' as const }
  const target = parsedTarget || legacyTarget

  return {
    id: typeof region.id === 'string' && region.id.length > 0 ? region.id : `swap-${Date.now()}`,
    type: 'swap',
    laneId: typeof region.laneId === 'string' && region.laneId.length > 0 ? region.laneId : fallbackLaneId,
    startTime,
    duration,
    origin: cloneSwapParticipant(parsedOrigin),
    target: sameSwapParticipant(parsedOrigin, target)
      ? { kind: 'floating-monitor-region', regionId: '' }
      : cloneSwapParticipant(target),
    transition,
    transitionDuration,
    zIndex: typeof region.zIndex === 'number' && Number.isFinite(region.zIndex) ? region.zIndex : 0,
  }
}

const parseSwapRegions = (
  value: unknown,
  fallbackLaneId: string,
  floatingMonitorRegions?: unknown,
): Record<string, CameraSwapRegion> => {
  if (!value || typeof value !== 'object') return {}

  return Object.entries(value as Record<string, unknown>).reduce(
    (acc, [regionId, rawValue]) => {
      const parsedRegion = parseSwapRegion(rawValue, fallbackLaneId, floatingMonitorRegions)
      if (!parsedRegion) return acc
      parsedRegion.id = regionId || parsedRegion.id
      acc[parsedRegion.id] = parsedRegion
      return acc
    },
    {} as Record<string, CameraSwapRegion>,
  )
}

const extractProjectEvents = (parsedData: Record<string, unknown>): MetaDataItem[] => {
  const events = parsedData.events
  if (Array.isArray(events)) {
    return events as MetaDataItem[]
  }

  const legacyMetadata = parsedData.metadata
  if (Array.isArray(legacyMetadata)) {
    return legacyMetadata as MetaDataItem[]
  }

  return []
}

const normalizeProjectEventTimestamps = (events: MetaDataItem[]): MetaDataItem[] => {
  if (events.length === 0) return []

  const maxTimestamp = events.reduce((max, item) => {
    const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : 0
    return Math.max(max, timestamp)
  }, 0)

  // Heuristic: metadata from recorder/import is in ms, editor timeline is in seconds.
  const shouldConvertFromMs = maxTimestamp > 1000

  return events.map((item) => {
    const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : 0
    return {
      ...item,
      timestamp: shouldConvertFromMs ? timestamp / 1000 : timestamp,
    }
  })
}

/**
 * Generates automatic zoom regions based on click events from metadata.
 * @param metadata - The array of mouse events.
 * @param videoDimensions - The dimensions of the video.
 * @returns A record of new ZoomRegion objects.
 */
function generateAutoZoomRegions(
  metadata: MetaDataItem[],
  recordingGeometry: RecordingGeometry,
  videoDimensions: VideoDimensions,
  laneId: string,
): Record<string, ZoomRegion> {
  const clicks = metadata.filter((item) => item.type === 'click' && item.pressed)
  if (clicks.length === 0) return {}

  const mergedClickGroups: MetaDataItem[][] = []
  if (clicks.length > 0) {
    let currentGroup = [clicks[0]]
    for (let i = 1; i < clicks.length; i++) {
      if (clicks[i].timestamp - currentGroup[currentGroup.length - 1].timestamp < ZOOM.AUTO_ZOOM_MIN_DURATION) {
        currentGroup.push(clicks[i])
      } else {
        mergedClickGroups.push(currentGroup)
        currentGroup = [clicks[i]]
      }
    }
    mergedClickGroups.push(currentGroup)
  }

  const geometry = recordingGeometry || videoDimensions

  return mergedClickGroups.reduce(
    (acc, group, index) => {
      const firstClick = group[0]
      const lastClick = group[group.length - 1]

      const startTime = Math.max(0, firstClick.timestamp - ZOOM.AUTO_ZOOM_PRE_CLICK_OFFSET)
      const endTime = lastClick.timestamp + ZOOM.AUTO_ZOOM_POST_CLICK_PADDING
      let duration = endTime - startTime
      if (duration < ZOOM.AUTO_ZOOM_MIN_DURATION) {
        duration = ZOOM.AUTO_ZOOM_MIN_DURATION
      }

      const id = `auto-zoom-${Date.now()}-${index}`
      acc[id] = {
        id,
        type: 'zoom',
        laneId,
        startTime,
        duration,
        zoomLevel: ZOOM.DEFAULT_LEVEL,
        easing: ZOOM.DEFAULT_EASING,
        transitionDuration: ZOOM.SPEED_OPTIONS[ZOOM.DEFAULT_SPEED as keyof typeof ZOOM.SPEED_OPTIONS],
        targetX: firstClick.x / geometry.width - 0.5,
        targetY: firstClick.y / geometry.height - 0.5,
        mode: 'auto',
        zIndex: 0,
      }
      return acc
    },
    {} as Record<string, ZoomRegion>,
  )
}

async function prepareWindowsCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    console.warn(`[prepareWindowsCursorBitmaps] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }

  const processingPromises: Promise<void>[] = []

  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]

    processingPromises.push(
      (async () => {
        const idcName = await window.electronAPI.mapCursorNameToIDC(cursorThemeName)
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame // Cast to fix Buffer type issue
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              // The data from main process is an object, not a Buffer. Convert it.
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${idcName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              console.error(`Failed to create bitmap for ${idcName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }

  await Promise.all(processingPromises)
  return bitmapMap
}

async function prepareMacOSCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    console.warn(`[prepareMacOSCursorBitmaps] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }

  const processingPromises: Promise<void>[] = []

  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]

    processingPromises.push(
      (async () => {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              // On macOS, the key format is simpler, matching the tracker's output.
              const key = `${cursorThemeName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              console.error(`Failed to create bitmap for ${cursorThemeName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }

  await Promise.all(processingPromises)
  return bitmapMap
}

export const createProjectSlice: Slice<ProjectState, ProjectActions> = (set, get) => ({
  ...initialProjectState,
  loadProject: async ({
    videoPath,
    metadataPath,
    webcamVideoPath,
    audioPath,
    systemAudioPath,
    originalProjectPath,
  }) => {
    // Always use media:// protocol for video, webcam, and audio URLs (revert to original logic)
    const videoUrl = toMediaUrl(videoPath)
    const webcamVideoUrl = toMediaUrl(webcamVideoPath)
    const audioUrl = toMediaUrl(audioPath)
    const systemAudioUrl = toMediaUrl(systemAudioPath)

    get().resetProjectState() // Clear previous project data first

    const activePresetId = get().activePresetId
    const presets = get().presets
    const presetToApply = (activePresetId && presets[activePresetId]) || Object.values(presets).find((p) => p.isDefault)

    set((state) => {
      if (presetToApply) {
        state.frameStyles = JSON.parse(JSON.stringify(presetToApply.styles))
        state.aspectRatio = presetToApply.aspectRatio
      } else {
        state.frameStyles = JSON.parse(JSON.stringify(initialFrameState.frameStyles))
      }
      state.webcamLayout = presetToApply?.webcamLayout
        ? JSON.parse(JSON.stringify(presetToApply.webcamLayout))
        : JSON.parse(JSON.stringify(initialWebcamState.webcamLayout))
      state.webcamPosition = presetToApply?.webcamPosition
        ? JSON.parse(JSON.stringify(presetToApply.webcamPosition))
        : JSON.parse(JSON.stringify(initialWebcamState.webcamPosition))
      state.webcamStyles = presetToApply?.webcamStyles
        ? JSON.parse(JSON.stringify(presetToApply.webcamStyles))
        : JSON.parse(JSON.stringify(initialWebcamState.webcamStyles))
      state.videoPath = videoPath
      state.metadataPath = metadataPath
      state.videoUrl = videoUrl
      state.webcamVideoPath = webcamVideoPath || null
      state.webcamVideoUrl = webcamVideoUrl
      state.isWebcamVisible = webcamVideoUrl ? (presetToApply?.isWebcamVisible ?? true) : false
      state.audioPath = audioPath || null
      state.audioUrl = audioUrl
      state.systemAudioPath = systemAudioPath || null
      state.systemAudioUrl = systemAudioUrl
      state.systemAudioVolume = 1
      state.systemAudioMuted = false
      state.hasAudioTrack = !!audioUrl || !!systemAudioUrl
      state.mediaAudioClip = null
      state.mediaAudioRegions = {}
      state.changeSoundRegions = {}
      state.originalProjectPath = originalProjectPath
    })

    try {
      const metadataContent = await window.electronAPI.readFile(metadataPath)
      const parsedData = JSON.parse(metadataContent) as Record<string, unknown>
      const rawEvents = extractProjectEvents(parsedData)
      if (rawEvents.length === 0) {
        console.warn('[ProjectSlice] No events found in metadata payload (events/metadata).')
      }
      const processedMetadata = normalizeProjectEventTimestamps(rawEvents)
      if (processedMetadata.length === 0) {
        console.warn('[ProjectSlice] Processed metadata is empty after loading project.')
      }

      const laneId = getFallbackLaneId(get().timelineLanes)
      const fallbackGeometry: RecordingGeometry = {
        x: 0,
        y: 0,
        width: get().videoDimensions.width,
        height: get().videoDimensions.height,
      }
      const recordingGeometry = (parsedData.recordingGeometry ||
        parsedData.geometry ||
        fallbackGeometry) as RecordingGeometry
      const parsedMediaAudioClip = parseMediaAudioClip(parsedData.mediaAudioClip)
      const parsedFloatingMonitors = parseFloatingMonitors(parsedData.floatingMonitors)
      const newZoomRegions = generateAutoZoomRegions(
        processedMetadata,
        recordingGeometry,
        get().videoDimensions,
        laneId,
      )

      const platform = (parsedData.platform as NodeJS.Platform | undefined) || (await window.electronAPI.getPlatform())
      set((state) => {
        state.platform = platform
        state.metadata = processedMetadata
        state.recordingGeometry = recordingGeometry
        state.screenSize = (parsedData.screenSize as typeof state.screenSize) || null
        state.syncOffset = typeof parsedData.syncOffset === 'number' ? parsedData.syncOffset : 0
        state.zoomRegions = (parsedData.zoomRegions as typeof state.zoomRegions) || newZoomRegions
        state.cutRegions = (parsedData.cutRegions as typeof state.cutRegions) || {}
        state.speedRegions = (parsedData.speedRegions as typeof state.speedRegions) || {}
        state.blurRegions = (parsedData.blurRegions as typeof state.blurRegions) || {}
        state.timelineLanes = (parsedData.timelineLanes as typeof state.timelineLanes) || [createDefaultTimelineLane()]
        const fallbackTimelineLaneId = getFallbackLaneId(state.timelineLanes)
        state.swapRegions = parseSwapRegions(
          parsedData.swapRegions,
          fallbackTimelineLaneId,
          parsedData.floatingMonitorRegions,
        )
        state.mediaAudioClip = parsedMediaAudioClip
        state.floatingMonitors = parsedFloatingMonitors
        if (
          typeof parsedData.systemAudioPath === 'string' &&
          parsedData.systemAudioPath.length > 0 &&
          !state.systemAudioPath
        ) {
          const normalizedSystemAudioPath = normalizeMediaPath(parsedData.systemAudioPath)
          state.systemAudioPath = normalizedSystemAudioPath
          state.systemAudioUrl = toMediaUrl(normalizedSystemAudioPath)
        }
        state.systemAudioVolume = clampAudioVolume(parsedData.systemAudioVolume)
        state.systemAudioMuted = parsedData.systemAudioMuted === true
        state.hasAudioTrack = !!state.audioUrl || !!state.systemAudioUrl || !!state.mediaAudioClip
        const fallbackMediaLaneId = fallbackTimelineLaneId
        state.mediaAudioRegions = parseMediaAudioRegions(
          parsedData.mediaAudioRegions,
          fallbackMediaLaneId,
          parsedMediaAudioClip,
        )
        state.floatingMonitorRegions = parseFloatingMonitorRegions(
          parsedData.floatingMonitorRegions,
          parsedFloatingMonitors,
          fallbackTimelineLaneId,
        )
        state.changeSoundRegions = parseChangeSoundRegions(parsedData.changeSoundRegions, fallbackMediaLaneId)
        if ('webcamLayout' in parsedData) {
          state.webcamLayout = parseWebcamLayout(parsedData.webcamLayout)
        }
        if ('webcamPosition' in parsedData) {
          state.webcamPosition = parseWebcamPosition(parsedData.webcamPosition)
        }
        if ('webcamStyles' in parsedData) {
          state.webcamStyles = parseWebcamStyles(parsedData.webcamStyles)
        }
        const hasWebcamAsset = !!state.webcamVideoUrl
        if (hasWebcamAsset) {
          state.isWebcamVisible =
            typeof parsedData.isWebcamVisible === 'boolean'
              ? parsedData.isWebcamVisible
              : (presetToApply?.isWebcamVisible ?? true)
        } else {
          state.isWebcamVisible = false
        }
        Object.values(state.swapRegions).forEach((region) => {
          if (!state.timelineLanes.some((lane) => lane.id === region.laneId)) {
            region.laneId = fallbackTimelineLaneId
          }
          region.startTime = clampStartTime(region.startTime, state.duration)
          region.transitionDuration = Math.max(
            SWAP_REGION.TRANSITION_DURATION.min,
            Math.min(
              SWAP_REGION.TRANSITION_DURATION.max,
              region.transitionDuration ?? SWAP_REGION.TRANSITION_DURATION.defaultValue,
            ),
          )
        })
        Object.values(state.mediaAudioRegions).forEach((region) => {
          if (!state.timelineLanes.some((lane) => lane.id === region.laneId)) {
            region.laneId = fallbackMediaLaneId
          }
          region.startTime = clampStartTime(region.startTime, state.duration)
          region.volume = Math.max(0, Math.min(region.volume, 1))
          region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
          region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
        })
        Object.values(state.changeSoundRegions).forEach((region) => {
          if (!state.timelineLanes.some((lane) => lane.id === region.laneId)) {
            region.laneId = fallbackMediaLaneId
          }
          region.startTime = clampStartTime(region.startTime, state.duration)
          region.volume = Math.max(0, Math.min(region.volume, 1))
          region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
          region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
        })
        Object.values(state.floatingMonitorRegions).forEach((region) => {
          if (!state.timelineLanes.some((lane) => lane.id === region.laneId)) {
            region.laneId = fallbackMediaLaneId
          }
          region.startTime = clampStartTime(region.startTime, state.duration)
          if (region.startTime + region.duration > state.duration) {
            region.duration = Math.max(0.1, state.duration - region.startTime)
          }
          const monitor = state.floatingMonitors[region.monitorId]
          if (!monitor) {
            delete state.floatingMonitorRegions[region.id]
          } else if (monitor.kind !== 'image') {
            region.sourceStart = Math.max(0, Math.min(region.sourceStart, monitor.duration))
            region.duration = Math.min(region.duration, Math.max(0.1, monitor.duration - region.sourceStart))
          }
        })
        if (state.mediaAudioClip) {
          state.mediaAudioClip.startTime = clampStartTime(state.mediaAudioClip.startTime, state.duration)
        }

        const frameStyles = parsedData.frameStyles as typeof state.frameStyles | undefined
        if (frameStyles) {
          state.frameStyles = frameStyles
        }
        const aspectRatio = parsedData.aspectRatio as typeof state.aspectRatio | undefined
        if (aspectRatio) {
          state.aspectRatio = aspectRatio
        }

        recalculateCanvasDimensions(state)
      })

      const themeNameToLoad = get().cursorThemeName || 'default'

      if (platform === 'win32') {
        const cursorTheme = await window.electronAPI.loadCursorTheme(themeNameToLoad)
        if (cursorTheme) {
          const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
          const bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
          if (processedMetadata.length > 0 && bitmaps.size === 0) {
            console.warn('[ProjectSlice] Cursor bitmap map is empty on Windows for a project with mouse events.')
          }
          set((state) => {
            state.cursorTheme = cursorTheme
            state.cursorBitmapsToRender = bitmaps
          })
        } else if (processedMetadata.length > 0) {
          console.warn('[ProjectSlice] Failed to load Windows cursor theme while metadata contains mouse events.')
        }
      } else if (platform === 'darwin') {
        const cursorTheme = await window.electronAPI.loadCursorTheme(themeNameToLoad)
        if (cursorTheme) {
          const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
          const bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
          if (processedMetadata.length > 0 && bitmaps.size === 0) {
            console.warn('[ProjectSlice] Cursor bitmap map is empty on macOS for a project with mouse events.')
          }
          set((state) => {
            state.cursorTheme = cursorTheme
            state.cursorBitmapsToRender = bitmaps
          })
        } else if (processedMetadata.length > 0) {
          console.warn('[ProjectSlice] Failed to load macOS cursor theme while metadata contains mouse events.')
        }
      } else {
        // Linux
        const cursorImages = (parsedData.cursorImages || {}) as ProjectState['cursorImages']
        const bitmaps = await prepareCursorBitmaps(cursorImages)
        if (processedMetadata.length > 0 && bitmaps.size === 0) {
          console.warn('[ProjectSlice] Cursor bitmap map is empty on Linux for a project with mouse events.')
        }
        set((state) => {
          state.cursorImages = cursorImages
          state.cursorBitmapsToRender = bitmaps
        })
      }
    } catch (error) {
      console.error('Failed to process metadata file:', error)
    }
  },
  setVideoDimensions: (dims) =>
    set((state) => {
      state.videoDimensions = dims
      if (state.assetTimelineEditing) {
        const monitor = state.floatingMonitors[state.assetTimelineEditing.monitorId]
        if (monitor) {
          monitor.timeline = monitor.timeline || createAssetTimeline(state.duration, dims)
          monitor.timeline.videoDimensions = cloneSerializable(dims)
        }
      }
      if (!state.recordingGeometry) {
        state.recordingGeometry = { x: 0, y: 0, width: dims.width, height: dims.height }
      }
      if (!state.screenSize) {
        state.screenSize = { width: dims.width, height: dims.height }
      }
      recalculateCanvasDimensions(state)
    }),
  setDuration: (duration) =>
    set((state) => {
      state.duration = duration
      if (state.assetTimelineEditing) {
        const monitor = state.floatingMonitors[state.assetTimelineEditing.monitorId]
        if (monitor) {
          monitor.duration = Math.max(0, duration)
          monitor.timelineStart = 0
          monitor.timelineDuration = Math.max(0, duration)
          monitor.timeline = monitor.timeline || createAssetTimeline(duration, state.videoDimensions)
          monitor.timeline.duration = Math.max(0, duration)
        }
        return
      }
      Object.values({
        ...state.zoomRegions,
        ...state.cutRegions,
        ...state.speedRegions,
        ...state.blurRegions,
        ...state.swapRegions,
        ...state.changeSoundRegions,
      }).forEach((region) => {
        if (region.startTime + region.duration > duration) {
          region.duration = Math.max(0.1, duration - region.startTime)
        }
      })
      Object.values(state.mediaAudioRegions).forEach((region) => {
        region.startTime = clampStartTime(region.startTime, duration)
        if (region.startTime + region.duration > duration) {
          region.duration = Math.max(0.1, duration - region.startTime)
        }

        if (state.mediaAudioClip?.duration && state.mediaAudioClip.duration > 0) {
          const maxDurationFromSource = Math.max(0.1, state.mediaAudioClip.duration - region.sourceStart)
          region.duration = Math.min(region.duration, maxDurationFromSource)
        }

        region.volume = Math.max(0, Math.min(region.volume, 1))
        region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
        region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
      })
      Object.values(state.changeSoundRegions).forEach((region) => {
        region.startTime = clampStartTime(region.startTime, duration)
        if (region.startTime + region.duration > duration) {
          region.duration = Math.max(0.1, duration - region.startTime)
        }
        region.volume = Math.max(0, Math.min(region.volume, 1))
        region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
        region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
      })
      Object.values(state.floatingMonitorRegions).forEach((region) => {
        region.startTime = clampStartTime(region.startTime, duration)
        if (region.startTime + region.duration > duration) {
          region.duration = Math.max(0.1, duration - region.startTime)
        }
        const monitor = state.floatingMonitors[region.monitorId]
        if (monitor?.kind !== 'image' && monitor?.duration) {
          region.sourceStart = Math.max(0, Math.min(region.sourceStart, monitor.duration))
          region.duration = Math.min(region.duration, Math.max(0.1, monitor.duration - region.sourceStart))
        }
      })
      if (state.mediaAudioClip) {
        state.mediaAudioClip.startTime = clampStartTime(state.mediaAudioClip.startTime, duration)
      }
    }),
  resetProjectState: () => {
    set((state) => {
      Object.assign(state, initialProjectState)
      state.zoomRegions = {}
      state.cutRegions = {}
      state.speedRegions = {}
      state.blurRegions = {}
      state.swapRegions = {}
      state.mediaAudioRegions = {}
      state.changeSoundRegions = {}
      state.timelineLanes = [createDefaultTimelineLane()]
      state.selectedRegionId = null
      state.activeZoomRegionId = null
      state.isCurrentlyCut = false
      state.currentTime = 0
      state.isPlaying = false
    })
  },
  reloadCursorTheme: async (themeName: string) => {
    const { platform } = get()
    if (platform !== 'win32' && platform !== 'darwin') return

    set((state) => {
      state.cursorBitmapsToRender = new Map() // Clear old bitmaps
    })

    const cursorTheme = await window.electronAPI.loadCursorTheme(themeName)
    if (cursorTheme) {
      const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
      let bitmaps: Map<string, CursorImageBitmap>
      if (platform === 'win32') {
        bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
      } else {
        bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
      }
      set((state) => {
        state.cursorTheme = cursorTheme
        state.cursorBitmapsToRender = bitmaps
      })
    }
  },
  setPostProcessingCursorScale: async (scale) => {
    const { platform, cursorTheme } = get()
    if (!cursorTheme || (platform !== 'win32' && platform !== 'darwin')) return

    set((state) => {
      state.cursorBitmapsToRender = new Map()
    })
    window.electronAPI.setSetting('recorder.cursorScale', scale)

    let bitmaps: Map<string, CursorImageBitmap>
    if (platform === 'win32') {
      bitmaps = await prepareWindowsCursorBitmaps(cursorTheme, scale)
    } else {
      // darwin
      bitmaps = await prepareMacOSCursorBitmaps(cursorTheme, scale)
    }

    set((state) => {
      state.cursorBitmapsToRender = bitmaps
    })
  },
  setHasAudioTrack: (hasAudio) => {
    set((state) => {
      state.hasAudioTrack = hasAudio
    })
  },
  updateSystemAudioSettings: ({ volume, isMuted }) => {
    set((state) => {
      if (state.assetTimelineEditing) return
      if (typeof volume === 'number' && Number.isFinite(volume)) {
        state.systemAudioVolume = Math.max(0, Math.min(volume, 1))
      }
      if (typeof isMuted === 'boolean') {
        state.systemAudioMuted = isMuted
      }
    })
  },
  setMediaAudioClip: ({ path, name, startTime = 0, duration = 0 }) => {
    set((state) => {
      if (state.assetTimelineEditing) return
      const normalizedPath = normalizeMediaPath(path)
      const resolvedStartTime = clampStartTime(startTime, state.duration)
      state.mediaAudioClip = {
        id: `media-audio-${Date.now()}`,
        path: normalizedPath,
        url: toMediaUrl(normalizedPath) || '',
        name: name.trim() || fallbackNameFromPath(normalizedPath),
        duration: clampToNonNegative(duration),
        startTime: resolvedStartTime,
      }
    })
  },
  setMediaAudioStartTime: (startTime) => {
    set((state) => {
      if (state.assetTimelineEditing) return
      if (!state.mediaAudioClip) return
      const resolvedStart = clampStartTime(startTime, state.duration)
      state.mediaAudioClip.startTime = resolvedStart

      const selectedRegion = state.selectedRegionId ? state.mediaAudioRegions[state.selectedRegionId] : null
      const firstRegion = Object.values(state.mediaAudioRegions)[0]
      const targetRegion = selectedRegion || firstRegion
      if (targetRegion) {
        targetRegion.startTime = resolvedStart
      }
    })
  },
  setMediaAudioDuration: (duration) => {
    set((state) => {
      if (state.assetTimelineEditing) return
      if (!state.mediaAudioClip) return
      const safeDuration = clampToNonNegative(duration)
      state.mediaAudioClip.duration = safeDuration

      if (safeDuration <= 0) return

      Object.values(state.mediaAudioRegions).forEach((region) => {
        const maxDurationFromSource = Math.max(0.1, safeDuration - region.sourceStart)
        if (region.duration <= 0 || region.duration > maxDurationFromSource) {
          region.duration = maxDurationFromSource
        }
        region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
        region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
      })
    })
  },
  clearMediaAudioClip: () => {
    set((state) => {
      if (state.assetTimelineEditing) return
      const selectedRegionId = state.selectedRegionId
      const shouldClearSelection = selectedRegionId ? !!state.mediaAudioRegions[selectedRegionId] : false
      state.mediaAudioClip = null
      state.mediaAudioRegions = {}
      if (shouldClearSelection) {
        state.selectedRegionId = null
      }
    })
  },
  addFloatingMonitor: ({ path, name, kind = 'video' }) => {
    set((state) => {
      const normalizedPath = normalizeMediaPath(path)
      const id = `floating-monitor-${Date.now()}`
      state.floatingMonitors[id] = {
        id,
        kind,
        path: normalizedPath,
        url: toMediaUrl(normalizedPath) || '',
        name: name.trim() || fallbackNameFromPath(normalizedPath),
        originalName: name.trim() || fallbackNameFromPath(normalizedPath),
        isEditedCopy: false,
        duration: kind === 'image' ? 5 : 0,
        timelineStart: 0,
        timelineDuration: kind === 'image' ? 5 : 0,
        x: 0.68,
        y: 0.68,
        width: 0.28,
        height: 0.28,
        timeline: createAssetTimeline(kind === 'image' ? 5 : 0),
      }
    })
  },
  updateFloatingMonitor: (id, updates) => {
    set((state) => {
      const monitor = state.floatingMonitors[id]
      if (!monitor) return
      Object.assign(monitor, updates)
      monitor.duration = clampToNonNegative(monitor.duration)
      monitor.timelineStart =
        monitor.kind === 'image'
          ? Math.max(0, monitor.timelineStart)
          : Math.max(0, Math.min(monitor.timelineStart, monitor.duration))
      monitor.timelineDuration = Math.max(
        0,
        monitor.kind === 'image'
          ? monitor.timelineDuration
          : Math.min(monitor.timelineDuration, monitor.duration - monitor.timelineStart),
      )
      monitor.x = Math.max(0, Math.min(monitor.x, 1))
      monitor.y = Math.max(0, Math.min(monitor.y, 1))
      monitor.width = Math.max(0.1, Math.min(monitor.width, 1))
      monitor.height = Math.max(0.1, Math.min(monitor.height, 1))
    })
  },
  removeFloatingMonitor: (id) => {
    set((state) => {
      const removedRegionIds = new Set<string>()
      const timelines = [
        { floatingMonitorRegions: state.floatingMonitorRegions, swapRegions: state.swapRegions },
        ...Object.values(state.floatingMonitors)
          .filter((monitor) => monitor.id !== id && monitor.timeline)
          .map((monitor) => monitor.timeline!),
      ]

      timelines.forEach(({ floatingMonitorRegions }) => {
        Object.values(floatingMonitorRegions).forEach((region) => {
          if (region.monitorId === id) {
            removedRegionIds.add(region.id)
            delete floatingMonitorRegions[region.id]
          }
        })
      })
      timelines.forEach(({ swapRegions }) => {
        Object.values(swapRegions).forEach((region) => {
          const referencesRemovedRegion = [region.origin, region.target].some(
            (participant) =>
              participant.kind === 'floating-monitor-region' && removedRegionIds.has(participant.regionId),
          )
          if (referencesRemovedRegion) delete swapRegions[region.id]
        })
      })

      const shouldClearSelection = !!state.selectedRegionId && removedRegionIds.has(state.selectedRegionId)
      delete state.floatingMonitors[id]
      if (shouldClearSelection) {
        state.selectedRegionId = null
      }
    })
  },
  beginAssetTimelineEdit: (id) => {
    set((state) => {
      if (state.assetTimelineEditing) return
      const sourceMonitor = state.floatingMonitors[id]
      if (!sourceMonitor) return

      let monitor = sourceMonitor
      if (!sourceMonitor.isEditedCopy) {
        const cloneId = `floating-monitor-${Date.now()}`
        const originalName = sourceMonitor.originalName || sourceMonitor.name
        monitor = {
          ...cloneSerializable(sourceMonitor),
          id: cloneId,
          name: `${originalName} Edit`,
          originalName,
          isEditedCopy: true,
          timeline: cloneSerializable(sourceMonitor.timeline),
        }
        state.floatingMonitors[cloneId] = monitor
      }

      const inheritedDuration = monitor.path === state.videoPath ? state.duration : 0
      const sourceDuration = monitor.duration || inheritedDuration
      if (sourceDuration > 0 && monitor.duration !== sourceDuration) {
        monitor.duration = sourceDuration
        monitor.timelineDuration = sourceDuration
      }
      const assetTimeline = cloneSerializable(
        monitor.timeline?.duration ? monitor.timeline : createAssetTimeline(sourceDuration, state.videoDimensions),
      )
      const assetCursorStyles = cloneSerializable(
        assetTimeline.cursorStyles || {
          ...state.cursorStyles,
          showCursor: false,
        },
      )
      state.assetTimelineEditing = {
        monitorId: monitor.id,
        blurDefaults: cloneSerializable(assetTimeline.blurDefaults),
        swapDefaults: cloneSerializable(assetTimeline.swapDefaults),
        mainProject: {
          videoPath: state.videoPath,
          videoUrl: state.videoUrl,
          audioPath: state.audioPath,
          audioUrl: state.audioUrl,
          systemAudioPath: state.systemAudioPath,
          systemAudioUrl: state.systemAudioUrl,
          systemAudioVolume: state.systemAudioVolume,
          systemAudioMuted: state.systemAudioMuted,
          volume: state.volume,
          isMuted: state.isMuted,
          mediaAudioClip: cloneSerializable(state.mediaAudioClip),
          mediaAudioRegions: cloneSerializable(state.mediaAudioRegions),
          changeSoundRegions: cloneSerializable(state.changeSoundRegions),
          webcamVideoPath: state.webcamVideoPath,
          webcamVideoUrl: state.webcamVideoUrl,
          webcamLayout: cloneSerializable(state.webcamLayout),
          webcamPosition: cloneSerializable(state.webcamPosition),
          webcamStyles: cloneSerializable(state.webcamStyles),
          hasAudioTrack: state.hasAudioTrack,
          duration: state.duration,
          videoDimensions: cloneSerializable(state.videoDimensions),
          frameStyles: cloneSerializable(state.frameStyles),
          aspectRatio: state.aspectRatio,
          timelineLanes: cloneSerializable(state.timelineLanes),
          zoomRegions: cloneSerializable(state.zoomRegions),
          cutRegions: cloneSerializable(state.cutRegions),
          speedRegions: cloneSerializable(state.speedRegions),
          blurRegions: cloneSerializable(state.blurRegions),
          swapRegions: cloneSerializable(state.swapRegions),
          floatingMonitorRegions: cloneSerializable(state.floatingMonitorRegions),
          cursorStyles: cloneSerializable(state.cursorStyles),
          isWebcamVisible: state.isWebcamVisible,
          selectedRegionId: state.selectedRegionId,
          currentTime: state.currentTime,
          isPlaying: state.isPlaying,
        },
      }

      state.videoPath = monitor.path
      state.videoUrl = monitor.url
      state.audioPath = null
      state.audioUrl = null
      state.systemAudioPath = null
      state.systemAudioUrl = null
      state.systemAudioVolume = 1
      state.systemAudioMuted = false
      state.volume = 1
      state.isMuted = false
      state.mediaAudioClip = null
      state.webcamVideoPath = null
      state.webcamVideoUrl = null
      state.duration = assetTimeline.duration || monitor.duration
      state.videoDimensions = assetTimeline.videoDimensions
      state.frameStyles = assetTimeline.frameStyles
      state.aspectRatio = assetTimeline.aspectRatio
      state.timelineLanes = assetTimeline.timelineLanes
      state.zoomRegions = assetTimeline.zoomRegions
      state.cutRegions = assetTimeline.cutRegions
      state.speedRegions = assetTimeline.speedRegions
      state.blurRegions = assetTimeline.blurRegions
      state.swapRegions = assetTimeline.swapRegions
      state.floatingMonitorRegions = assetTimeline.floatingMonitorRegions
      state.cursorStyles = assetCursorStyles
      state.mediaAudioRegions = {}
      state.changeSoundRegions = {}
      state.hasAudioTrack = false
      state.isWebcamVisible = false
      state.selectedRegionId = assetTimeline.selectedRegionId
      state.currentTime = 0
      state.isPlaying = false
    })
  },
  finishAssetTimelineEdit: () => {
    set((state) => {
      const editing = state.assetTimelineEditing
      if (!editing) return
      const monitor = state.floatingMonitors[editing.monitorId]
      if (monitor) {
        monitor.duration = Math.max(monitor.duration, state.duration)
        monitor.timelineStart = 0
        monitor.timelineDuration = state.duration
        monitor.timeline = {
          duration: state.duration,
          videoDimensions: cloneSerializable(state.videoDimensions),
          frameStyles: cloneSerializable(state.frameStyles),
          aspectRatio: state.aspectRatio,
          timelineLanes: cloneSerializable(state.timelineLanes),
          zoomRegions: cloneSerializable(state.zoomRegions),
          cutRegions: cloneSerializable(state.cutRegions),
          speedRegions: cloneSerializable(state.speedRegions),
          blurRegions: cloneSerializable(state.blurRegions),
          swapRegions: cloneSerializable(state.swapRegions),
          floatingMonitorRegions: cloneSerializable(state.floatingMonitorRegions),
          blurDefaults: cloneSerializable(editing.blurDefaults),
          swapDefaults: cloneSerializable(editing.swapDefaults),
          cursorStyles: cloneSerializable(state.cursorStyles),
          selectedRegionId: state.selectedRegionId,
        }
      }

      const main = editing.mainProject
      state.videoPath = main.videoPath
      state.videoUrl = main.videoUrl
      state.audioPath = main.audioPath
      state.audioUrl = main.audioUrl
      state.systemAudioPath = main.systemAudioPath
      state.systemAudioUrl = main.systemAudioUrl
      state.systemAudioVolume = main.systemAudioVolume
      state.systemAudioMuted = main.systemAudioMuted
      state.volume = main.volume
      state.isMuted = main.isMuted
      state.mediaAudioClip = main.mediaAudioClip
      state.mediaAudioRegions = main.mediaAudioRegions
      state.changeSoundRegions = main.changeSoundRegions
      state.webcamVideoPath = main.webcamVideoPath
      state.webcamVideoUrl = main.webcamVideoUrl
      state.webcamLayout = main.webcamLayout
      state.webcamPosition = main.webcamPosition
      state.webcamStyles = main.webcamStyles
      state.hasAudioTrack = main.hasAudioTrack
      state.duration = main.duration
      state.videoDimensions = main.videoDimensions
      state.frameStyles = main.frameStyles
      state.aspectRatio = main.aspectRatio
      state.timelineLanes = main.timelineLanes
      state.zoomRegions = main.zoomRegions
      state.cutRegions = main.cutRegions
      state.speedRegions = main.speedRegions
      state.blurRegions = main.blurRegions
      state.swapRegions = main.swapRegions
      state.floatingMonitorRegions = main.floatingMonitorRegions
      state.cursorStyles = main.cursorStyles
      state.isWebcamVisible = main.isWebcamVisible
      state.selectedRegionId = main.selectedRegionId
      state.currentTime = main.currentTime
      state.isPlaying = main.isPlaying
      state.assetTimelineEditing = null
    })
  },
  setOriginalProjectPath: (path) => {
    set((state) => {
      state.originalProjectPath = path
    })
  },
})
