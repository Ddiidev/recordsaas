import { BLUR_REGION, DEFAULTS, SWAP_REGION, TIMELINE, ZOOM } from '../../lib/constants'
import type { TimelineState, TimelineActions, Slice } from '../../types'
import type {
  BlurRegion,
  BlurPresetDefaults,
  CutRegion,
  ZoomRegion,
  SpeedRegion,
  CameraSwapRegion,
  SwapPresetDefaults,
  MediaAudioRegion,
  ChangeSoundRegion,
  FloatingMonitorRegion,
  TimelineLane,
  TimelineRegion,
  Preset,
} from '../../types'
import {
  normalizeTimelineLanes,
  createDefaultTimelineLane,
  getFallbackLaneId,
  sortTimelineLanes,
  ensureContentRootLane,
  removeContentRootLaneIfEmpty,
  CONTENT_ROOT_LANE_ID,
} from '../../lib/timeline-lanes'
import { resolveMonitorForAssetTimeline } from '../../lib/floating-monitor'
import { applyMediaAudioCutAdaptation } from '../../lib/media-audio-cuts'

export const initialTimelineState: TimelineState = {
  timelineLanes: [createDefaultTimelineLane()],
  zoomRegions: {},
  cutRegions: {},
  speedRegions: {},
  blurRegions: {},
  swapRegions: {},
  mediaAudioRegions: {},
  changeSoundRegions: {},
  floatingMonitorRegions: {},
  previewCutRegion: null,
  selectedRegionId: null,
  activeZoomRegionId: null,
  isCurrentlyCut: false,
  timelineZoom: 1,
}

const BLUR_DEFAULT_UPDATE_KEYS: Array<keyof BlurPresetDefaults> = [
  'duration',
  'style',
  'intensity',
  'x',
  'y',
  'width',
  'height',
]
const SWAP_DEFAULT_UPDATE_KEYS: Array<keyof SwapPresetDefaults> = [
  'duration',
  'origin',
  'target',
  'transition',
  'transitionDuration',
]

const getBlurDefaults = (
  preset: Preset | null | undefined,
  localDefaults?: BlurPresetDefaults,
): BlurPresetDefaults => ({
  duration: localDefaults?.duration ?? preset?.blurDefaults?.duration ?? BLUR_REGION.DEFAULT_DURATION,
  style: localDefaults?.style ?? preset?.blurDefaults?.style ?? BLUR_REGION.STYLE.DEFAULT,
  intensity: localDefaults?.intensity ?? preset?.blurDefaults?.intensity ?? BLUR_REGION.INTENSITY.defaultValue,
  x: localDefaults?.x ?? preset?.blurDefaults?.x ?? BLUR_REGION.X.defaultValue,
  y: localDefaults?.y ?? preset?.blurDefaults?.y ?? BLUR_REGION.Y.defaultValue,
  width: localDefaults?.width ?? preset?.blurDefaults?.width ?? BLUR_REGION.WIDTH.defaultValue,
  height: localDefaults?.height ?? preset?.blurDefaults?.height ?? BLUR_REGION.HEIGHT.defaultValue,
})

const getSwapDefaults = (
  preset: Preset | null | undefined,
  localDefaults?: SwapPresetDefaults,
): SwapPresetDefaults => ({
  duration: localDefaults?.duration ?? preset?.swapDefaults?.duration ?? SWAP_REGION.DEFAULT_DURATION,
  origin: localDefaults?.origin ?? preset?.swapDefaults?.origin ?? { kind: 'main-screen' },
  target: localDefaults?.target ?? preset?.swapDefaults?.target ?? { kind: 'webcam' },
  transition: localDefaults?.transition ?? preset?.swapDefaults?.transition ?? SWAP_REGION.TRANSITION.DEFAULT,
  transitionDuration:
    localDefaults?.transitionDuration ??
    preset?.swapDefaults?.transitionDuration ??
    SWAP_REGION.TRANSITION_DURATION.defaultValue,
})

const toBlurPresetDefaults = (region: BlurRegion): BlurPresetDefaults => ({
  duration: region.duration,
  style: region.style,
  intensity: region.intensity,
  x: region.x,
  y: region.y,
  width: region.width,
  height: region.height,
})

const toSwapPresetDefaults = (region: CameraSwapRegion): SwapPresetDefaults => ({
  duration: region.duration,
  origin: region.origin,
  target: region.target,
  transition: region.transition,
  transitionDuration: region.transitionDuration ?? SWAP_REGION.TRANSITION_DURATION.defaultValue,
})

const getAllRegions = (state: {
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
  swapRegions: Record<string, CameraSwapRegion>
  mediaAudioRegions: Record<string, MediaAudioRegion>
  changeSoundRegions: Record<string, ChangeSoundRegion>
  floatingMonitorRegions: Record<string, FloatingMonitorRegion>
}): TimelineRegion[] => [
  ...Object.values(state.zoomRegions),
  ...Object.values(state.cutRegions),
  ...Object.values(state.speedRegions),
  ...Object.values(state.blurRegions),
  ...Object.values(state.swapRegions),
  ...Object.values(state.mediaAudioRegions),
  ...Object.values(state.changeSoundRegions),
  ...Object.values(state.floatingMonitorRegions),
]

const nextContentRootRegionStart = (
  cutRegions: Record<string, CutRegion>,
  changeSoundRegions: Record<string, ChangeSoundRegion>,
  startTime: number,
): number => {
  let next = Number.POSITIVE_INFINITY
  for (const region of Object.values(cutRegions)) {
    if (region.startTime > startTime && region.startTime < next) next = region.startTime
  }
  for (const region of Object.values(changeSoundRegions)) {
    if (region.startTime > startTime && region.startTime < next) next = region.startTime
  }
  return next
}

const defaultContentRootDuration = (
  duration: number,
  startTime: number,
  nextRegionStart: number,
): number => {
  const maxEnd = Math.min(duration, nextRegionStart < Number.POSITIVE_INFINITY ? nextRegionStart : duration)
  return Math.max(
    TIMELINE.MINIMUM_REGION_DURATION,
    Math.min(duration * 0.1, Math.max(TIMELINE.MINIMUM_REGION_DURATION, maxEnd - startTime)),
  )
}

const getRegionById = (
  state: {
    zoomRegions: Record<string, ZoomRegion>
    cutRegions: Record<string, CutRegion>
    speedRegions: Record<string, SpeedRegion>
    blurRegions: Record<string, BlurRegion>
    swapRegions: Record<string, CameraSwapRegion>
    mediaAudioRegions: Record<string, MediaAudioRegion>
    changeSoundRegions: Record<string, ChangeSoundRegion>
    floatingMonitorRegions: Record<string, FloatingMonitorRegion>
  },
  id: string,
): TimelineRegion | null =>
  state.zoomRegions[id] ||
  state.cutRegions[id] ||
  state.speedRegions[id] ||
  state.blurRegions[id] ||
  state.swapRegions[id] ||
  state.mediaAudioRegions[id] ||
  state.changeSoundRegions[id] ||
  state.floatingMonitorRegions[id] ||
  null

const monitorWouldCreateCycle = (
  monitors: Record<string, { timeline?: { floatingMonitorRegions: Record<string, FloatingMonitorRegion> } }>,
  ownerMonitorId: string,
  candidateMonitorId: string,
): boolean => {
  const visited = new Set<string>()
  const visit = (monitorId: string): boolean => {
    if (monitorId === ownerMonitorId) return true
    if (visited.has(monitorId)) return false
    visited.add(monitorId)
    return Object.values(monitors[monitorId]?.timeline?.floatingMonitorRegions || {}).some((region) =>
      visit(region.monitorId),
    )
  }
  return visit(candidateMonitorId)
}

const getSwapParticipantBounds = (
  state: {
    duration: number
    webcamVideoUrl: string | null
    floatingMonitorRegions: Record<string, FloatingMonitorRegion>
  },
  participant: CameraSwapRegion['origin'],
): { start: number; end: number } | null => {
  if (participant.kind === 'main-screen') return { start: 0, end: state.duration }
  if (participant.kind === 'webcam') return state.webcamVideoUrl ? { start: 0, end: state.duration } : null
  const monitorRegion = state.floatingMonitorRegions[participant.regionId]
  return monitorRegion
    ? { start: monitorRegion.startTime, end: monitorRegion.startTime + monitorRegion.duration }
    : null
}

const sameSwapParticipant = (left: CameraSwapRegion['origin'], right: CameraSwapRegion['target']): boolean =>
  left.kind === right.kind &&
  (left.kind !== 'floating-monitor-region' ||
    right.kind !== 'floating-monitor-region' ||
    left.regionId === right.regionId)

const ensureRegionLaneIds = (state: {
  timelineLanes: TimelineLane[]
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
  swapRegions: Record<string, CameraSwapRegion>
  mediaAudioRegions: Record<string, MediaAudioRegion>
  changeSoundRegions: Record<string, ChangeSoundRegion>
  floatingMonitorRegions: Record<string, FloatingMonitorRegion>
}) => {
  const fallbackLaneId = getFallbackLaneId(state.timelineLanes)
  getAllRegions(state).forEach((region) => {
    if (!region.laneId || !state.timelineLanes.some((lane) => lane.id === region.laneId)) {
      region.laneId = fallbackLaneId
    }
  })
}

/**
 * Recalculates and assigns z-index values based on lane precedence and region duration.
 * Higher lanes always overlay lower lanes; inside a lane, shorter regions get priority.
 */
const recalculateZIndices = (state: {
  timelineLanes: TimelineLane[]
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
  swapRegions: Record<string, CameraSwapRegion>
  mediaAudioRegions: Record<string, MediaAudioRegion>
  changeSoundRegions: Record<string, ChangeSoundRegion>
  floatingMonitorRegions: Record<string, FloatingMonitorRegion>
}) => {
  state.timelineLanes = normalizeTimelineLanes(state.timelineLanes)
  ensureRegionLaneIds(state)

  const sortedLanes = sortTimelineLanes(state.timelineLanes)
  sortedLanes.forEach((lane, laneIndex) => {
    const laneRegions = getAllRegions(state)
      .filter((region) => region.laneId === lane.id)
      .sort((a, b) => a.duration - b.duration)

    const laneBase = (sortedLanes.length - laneIndex) * 1000
    laneRegions.forEach((region, index) => {
      const newZIndex = laneBase + (laneRegions.length - index)
      if (state.zoomRegions[region.id]) {
        state.zoomRegions[region.id].zIndex = newZIndex
      } else if (state.cutRegions[region.id]) {
        state.cutRegions[region.id].zIndex = newZIndex
      } else if (state.speedRegions[region.id]) {
        state.speedRegions[region.id].zIndex = newZIndex
      } else if (state.blurRegions[region.id]) {
        state.blurRegions[region.id].zIndex = newZIndex
      } else if (state.swapRegions[region.id]) {
        state.swapRegions[region.id].zIndex = newZIndex
      } else if (state.mediaAudioRegions[region.id]) {
        state.mediaAudioRegions[region.id].zIndex = newZIndex
      } else if (state.changeSoundRegions[region.id]) {
        state.changeSoundRegions[region.id].zIndex = newZIndex
      } else if (state.floatingMonitorRegions[region.id]) {
        state.floatingMonitorRegions[region.id].zIndex = newZIndex
      }
    })
  })
}

export const createTimelineSlice: Slice<TimelineState, TimelineActions> = (set, get) => ({
  ...initialTimelineState,
  addTimelineLane: () => {
    set((state) => {
      const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
      const nextOrder = normalizedLanes.length
      const laneId = `lane-${Date.now()}`
      state.timelineLanes = [
        ...normalizedLanes,
        {
          id: laneId,
          name: `Lane ${nextOrder + 1}`,
          order: nextOrder,
          visible: true,
          locked: false,
        },
      ]
      recalculateZIndices(state)
    })
  },
  removeTimelineLane: (laneId) => {
    set((state) => {
      const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
      const targetLane = normalizedLanes.find((lane) => lane.id === laneId)
      if (
        normalizedLanes.length <= 1 ||
        !targetLane ||
        targetLane.isContentRootLane ||
        targetLane.isCutLane ||
        targetLane.isChangeSoundLane
      ) {
        return
      }

      const laneIndex = normalizedLanes.findIndex((lane) => lane.id === laneId)
      const fallbackLane = normalizedLanes[laneIndex - 1] || normalizedLanes[laneIndex + 1]
      if (!fallbackLane) return

      getAllRegions(state).forEach((region) => {
        if (region.laneId === laneId) {
          region.laneId = fallbackLane.id
        }
      })

      state.timelineLanes = normalizeTimelineLanes(normalizedLanes.filter((lane) => lane.id !== laneId))
      recalculateZIndices(state)
    })
  },
  moveTimelineLane: (laneId, direction) => {
    set((state) => {
      const sorted = sortTimelineLanes(normalizeTimelineLanes(state.timelineLanes))
      const index = sorted.findIndex((lane) => lane.id === laneId)
      if (index === -1) return
      if (sorted[index].isContentRootLane || sorted[index].isCutLane || sorted[index].isChangeSoundLane) return

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return
      if (
        sorted[targetIndex].isContentRootLane ||
        sorted[targetIndex].isCutLane ||
        sorted[targetIndex].isChangeSoundLane
      )
        return

      const reordered = [...sorted]
      const [lane] = reordered.splice(index, 1)
      reordered.splice(targetIndex, 0, lane)
      state.timelineLanes = reordered.map((item, order) => ({ ...item, order }))
      recalculateZIndices(state)
    })
  },
  renameTimelineLane: (laneId, name) => {
    set((state) => {
      const lane = state.timelineLanes.find((item) => item.id === laneId)
      if (!lane) return
      lane.name = name.trim() || lane.name
    })
  },
  moveRegionToLane: (regionId, laneId) => {
    set((state) => {
      const targetLane = state.timelineLanes.find((lane) => lane.id === laneId)
      if (
        !targetLane ||
        targetLane.isContentRootLane ||
        targetLane.isCutLane ||
        targetLane.isChangeSoundLane
      )
        return
      const region = getRegionById(state, regionId)
      if (!region) return
      region.laneId = laneId
      recalculateZIndices(state)
    })
  },
  addZoomRegion: () => {
    const { metadata, currentTime, recordingGeometry, duration } = get()
    if (duration === 0) return

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const preferredLaneId = selectedRegion?.laneId || fallbackLaneId

    const lastMousePos = metadata
      .slice()
      .reverse()
      .find((m) => m.timestamp <= currentTime)
    const id = `zoom-${Date.now()}`

    const newRegion: ZoomRegion = {
      id,
      type: 'zoom',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: ZOOM.DEFAULT_DURATION,
      zoomLevel: ZOOM.DEFAULT_LEVEL,
      easing: ZOOM.DEFAULT_EASING,
      transitionDuration: ZOOM.SPEED_OPTIONS[ZOOM.DEFAULT_SPEED as keyof typeof ZOOM.SPEED_OPTIONS],
      targetX: lastMousePos && recordingGeometry ? lastMousePos.x / recordingGeometry.width - 0.5 : 0,
      targetY: lastMousePos && recordingGeometry ? lastMousePos.y / recordingGeometry.height - 0.5 : 0,
      mode: 'auto',
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) =>
        allRegs.some(
          (r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime,
        )

      let resolvedLaneId = newRegion.laneId
      if (isOccupied(resolvedLaneId)) {
        const freeLane = state.timelineLanes.find((l) => !isOccupied(l.id))
        if (freeLane) {
          resolvedLaneId = freeLane.id
        } else {
          const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
          const nextOrder = normalizedLanes.length
          resolvedLaneId = `lane-${Date.now()}`
          state.timelineLanes = [
            ...normalizedLanes,
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false },
          ]
        }
      }
      newRegion.laneId = resolvedLaneId

      state.zoomRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addCutRegion: (regionData) => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const startTime = currentTime
    const nextRegionStart = nextContentRootRegionStart(get().cutRegions, get().changeSoundRegions, startTime)
    const defaultDuration = defaultContentRootDuration(duration, startTime, nextRegionStart)

    const id = `cut-${Date.now()}`
    const newRegion: CutRegion = {
      id,
      type: 'cut',
      laneId: CONTENT_ROOT_LANE_ID,
      startTime,
      duration: defaultDuration,
      zIndex: 0,
      ...regionData,
    }

    const maxEnd = Math.min(duration, nextRegionStart < Number.POSITIVE_INFINITY ? nextRegionStart : duration)
    if (newRegion.startTime + newRegion.duration > maxEnd) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, maxEnd - newRegion.startTime)
    }

    set((state) => {
      state.timelineLanes = ensureContentRootLane(state.timelineLanes)
      state.cutRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addSpeedRegion: () => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const preferredLaneId = selectedRegion?.laneId || fallbackLaneId

    const id = `speed-${Date.now()}`
    const newRegion: SpeedRegion = {
      id,
      type: 'speed',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: 3.0, // default duration
      speed: 1.5, // default speed
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) =>
        allRegs.some(
          (r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime,
        )

      let resolvedLaneId = newRegion.laneId
      if (isOccupied(resolvedLaneId)) {
        const freeLane = state.timelineLanes.find((l) => !isOccupied(l.id))
        if (freeLane) {
          resolvedLaneId = freeLane.id
        } else {
          const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
          const nextOrder = normalizedLanes.length
          resolvedLaneId = `lane-${Date.now()}`
          state.timelineLanes = [
            ...normalizedLanes,
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false },
          ]
        }
      }
      newRegion.laneId = resolvedLaneId

      state.speedRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addBlurRegion: () => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const preferredLaneId = selectedRegion?.laneId || fallbackLaneId
    const activePresetId = get().activePresetId
    const activePreset = activePresetId ? get().presets[activePresetId] : null
    const blurDefaults = getBlurDefaults(activePreset, get().assetTimelineEditing?.blurDefaults)

    const id = `blur-${Date.now()}`
    const newRegion: BlurRegion = {
      id,
      type: 'blur',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: blurDefaults.duration,
      style: blurDefaults.style,
      intensity: blurDefaults.intensity,
      x: blurDefaults.x,
      y: blurDefaults.y,
      width: blurDefaults.width,
      height: blurDefaults.height,
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) =>
        allRegs.some(
          (r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime,
        )

      let resolvedLaneId = newRegion.laneId
      if (isOccupied(resolvedLaneId)) {
        const freeLane = state.timelineLanes.find((l) => !isOccupied(l.id))
        if (freeLane) {
          resolvedLaneId = freeLane.id
        } else {
          const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
          const nextOrder = normalizedLanes.length
          resolvedLaneId = `lane-${Date.now()}`
          state.timelineLanes = [
            ...normalizedLanes,
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false },
          ]
        }
      }
      newRegion.laneId = resolvedLaneId

      state.blurRegions[id] = newRegion
      if (state.assetTimelineEditing) {
        state.assetTimelineEditing.blurDefaults = toBlurPresetDefaults(newRegion)
      }
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addSwapRegion: () => {
    const { currentTime, duration } = get()
    if (duration === 0) return

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const preferredLaneId = selectedRegion?.laneId || fallbackLaneId
    const activePresetId = get().activePresetId
    const activePreset = activePresetId ? get().presets[activePresetId] : null
    const swapDefaults = getSwapDefaults(activePreset, get().assetTimelineEditing?.swapDefaults)

    const id = `swap-${Date.now()}`
    const newRegion: CameraSwapRegion = {
      id,
      type: 'swap',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: swapDefaults.duration,
      origin: swapDefaults.origin,
      target: swapDefaults.target,
      transition: swapDefaults.transition,
      transitionDuration: swapDefaults.transitionDuration,
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) =>
        allRegs.some(
          (r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime,
        )

      let resolvedLaneId = newRegion.laneId
      if (isOccupied(resolvedLaneId)) {
        const freeLane = state.timelineLanes.find((l) => !isOccupied(l.id))
        if (freeLane) {
          resolvedLaneId = freeLane.id
        } else {
          const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
          const nextOrder = normalizedLanes.length
          resolvedLaneId = `lane-${Date.now()}`
          state.timelineLanes = [
            ...normalizedLanes,
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false },
          ]
        }
      }
      newRegion.laneId = resolvedLaneId

      state.swapRegions[id] = newRegion
      if (state.assetTimelineEditing) {
        state.assetTimelineEditing.swapDefaults = toSwapPresetDefaults(newRegion)
      }
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addMediaAudioRegion: (params) => {
    const { mediaAudioClip, duration } = get()
    if (!mediaAudioClip || duration <= 0) return

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const selectedLane = selectedRegion
      ? get().timelineLanes.find((lane) => lane.id === selectedRegion.laneId)
      : null
    const preferredLaneId =
      params?.laneId ||
      (selectedLane && !selectedLane.isContentRootLane && !selectedLane.isCutLane && !selectedLane.isChangeSoundLane
        ? selectedLane.id
        : null) ||
      fallbackLaneId

    const requestedStart = params?.startTime ?? 0
    const sourceStart = Math.max(0, params?.sourceStart ?? 0)
    const availableSourceDuration =
      mediaAudioClip.duration > 0
        ? Math.max(TIMELINE.MINIMUM_REGION_DURATION, mediaAudioClip.duration - sourceStart)
        : duration
    const requestedDuration = params?.duration ?? availableSourceDuration

    const clampedStartTime = Math.max(0, Math.min(requestedStart, duration))
    const clampedDuration = Math.max(
      TIMELINE.MINIMUM_REGION_DURATION,
      Math.min(requestedDuration, availableSourceDuration),
    )

    const id = `media-audio-${Date.now()}`
    const newRegion: MediaAudioRegion = {
      id,
      type: 'media-audio',
      laneId: preferredLaneId,
      startTime: clampedStartTime,
      duration: clampedDuration,
      sourceStart,
      isMuted: false,
      volume: 1,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      zIndex: 0,
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) =>
        allRegs.some(
          (region) =>
            region.laneId === laneId &&
            region.startTime < endTime &&
            region.startTime + region.duration > newRegion.startTime,
        )

      let resolvedLaneId = newRegion.laneId
      if (isOccupied(resolvedLaneId)) {
        const freeLane = state.timelineLanes.find((lane) => !isOccupied(lane.id))
        if (freeLane) {
          resolvedLaneId = freeLane.id
        } else {
          const normalizedLanes = normalizeTimelineLanes(state.timelineLanes)
          const nextOrder = normalizedLanes.length
          resolvedLaneId = `lane-${Date.now()}`
          state.timelineLanes = [
            ...normalizedLanes,
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false },
          ]
        }
      }

      newRegion.laneId = resolvedLaneId
      state.mediaAudioRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addChangeSoundRegion: (params) => {
    if (get().assetTimelineEditing) return
    const { duration } = get()
    if (duration <= 0) return

    const requestedStart = params?.startTime ?? 0
    const clampedStartTime = Math.max(0, Math.min(requestedStart, duration))
    const nextRegionStart = nextContentRootRegionStart(get().cutRegions, get().changeSoundRegions, clampedStartTime)
    const maxEnd = Math.min(duration, nextRegionStart < Number.POSITIVE_INFINITY ? nextRegionStart : duration)
    const requestedDuration =
      params?.duration ?? defaultContentRootDuration(duration, clampedStartTime, nextRegionStart)

    const clampedDuration = Math.max(
      TIMELINE.MINIMUM_REGION_DURATION,
      Math.min(requestedDuration, Math.max(TIMELINE.MINIMUM_REGION_DURATION, maxEnd - clampedStartTime)),
    )

    const id = `change-sound-${Date.now()}`
    const newRegion: ChangeSoundRegion = {
      id,
      type: 'change-sound',
      laneId: CONTENT_ROOT_LANE_ID,
      startTime: clampedStartTime,
      duration: clampedDuration,
      sourceKey: 'recording-mic',
      isMuted: false,
      volume: 1,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      zIndex: 0,
    }

    set((state) => {
      state.timelineLanes = ensureContentRootLane(state.timelineLanes)
      state.changeSoundRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  addFloatingMonitorRegion: (monitorId, params) => {
    const { duration, floatingMonitors, assetTimelineEditing } = get()
    const monitor = assetTimelineEditing
      ? resolveMonitorForAssetTimeline(floatingMonitors, monitorId)
      : floatingMonitors[monitorId]
    if (!monitor || duration <= 0 || monitor.timelineDuration <= 0) return
    if (assetTimelineEditing && monitorWouldCreateCycle(floatingMonitors, assetTimelineEditing.monitorId, monitor.id)) {
      return
    }

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const selectedLane = selectedRegion
      ? get().timelineLanes.find((lane) => lane.id === selectedRegion.laneId)
      : null
    const preferredLaneId =
      params?.laneId ||
      (selectedLane && !selectedLane.isContentRootLane && !selectedLane.isCutLane && !selectedLane.isChangeSoundLane
        ? selectedLane.id
        : null) ||
      fallbackLaneId
    const startTime = Math.max(0, Math.min(params?.startTime ?? get().currentTime, duration))
    const regionDuration = Math.max(
      TIMELINE.MINIMUM_REGION_DURATION,
      Math.min(monitor.timelineDuration, Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - startTime)),
    )
    const id = `floating-monitor-region-${Date.now()}`

    set((state) => {
      state.floatingMonitorRegions[id] = {
        id,
        type: 'floating-monitor',
        monitorId: monitor.id,
        laneId: preferredLaneId,
        startTime,
        duration: regionDuration,
        sourceStart: monitor.timelineStart,
        x: monitor.x,
        y: monitor.y,
        width: monitor.width,
        height: monitor.height,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        borderRadius: DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.defaultValue,
        isFlipped: DEFAULTS.FLOATING_MONITOR.STYLE.FLIP.defaultValue,
        border: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.ENABLED.defaultValue,
        borderWidth: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.defaultValue,
        borderColor: DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.DEFAULT_COLOR_RGBA,
        shadowBlur: DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.defaultValue,
        shadowOffsetX: DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.defaultValue,
        shadowOffsetY: DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.defaultValue,
        shadowColor: DEFAULTS.FLOATING_MONITOR.EFFECTS.DEFAULT_COLOR_RGBA,
        zIndex: 0,
      }
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  splitMediaAudioRegion: (regionId, splitTime) => {
    set((state) => {
      const region = state.mediaAudioRegions[regionId]
      if (!region) return

      const regionStart = region.startTime
      const regionEnd = region.startTime + region.duration
      const clampedSplitTime = Math.max(regionStart, Math.min(splitTime, regionEnd))

      const firstDuration = clampedSplitTime - regionStart
      const secondDuration = regionEnd - clampedSplitTime
      if (firstDuration < TIMELINE.MINIMUM_REGION_DURATION || secondDuration < TIMELINE.MINIMUM_REGION_DURATION) {
        return
      }
      const previousFadeIn = region.fadeInDuration
      const previousFadeOut = region.fadeOutDuration

      region.duration = firstDuration
      region.fadeInDuration = Math.min(previousFadeIn, firstDuration)
      region.fadeOutDuration = 0

      const nextRegionId = `media-audio-${Date.now()}`
      state.mediaAudioRegions[nextRegionId] = {
        ...region,
        id: nextRegionId,
        startTime: clampedSplitTime,
        duration: secondDuration,
        sourceStart: region.sourceStart + firstDuration,
        fadeInDuration: 0,
        fadeOutDuration: Math.min(previousFadeOut, secondDuration),
      }

      state.selectedRegionId = nextRegionId
      recalculateZIndices(state)
    })
  },
  adaptMediaAudioToCuts: (regionId) => {
    set((state) => {
      if (!state.mediaAudioRegions[regionId]) return
      const firstRegionId = applyMediaAudioCutAdaptation(state.cutRegions, state.mediaAudioRegions)
      if (!firstRegionId) return
      state.selectedRegionId = firstRegionId
      recalculateZIndices(state)
    })
  },
  splitChangeSoundRegion: (regionId, splitTime) => {
    set((state) => {
      const region = state.changeSoundRegions[regionId]
      if (!region) return

      const regionStart = region.startTime
      const regionEnd = region.startTime + region.duration
      const clampedSplitTime = Math.max(regionStart, Math.min(splitTime, regionEnd))

      const firstDuration = clampedSplitTime - regionStart
      const secondDuration = regionEnd - clampedSplitTime
      if (firstDuration < TIMELINE.MINIMUM_REGION_DURATION || secondDuration < TIMELINE.MINIMUM_REGION_DURATION) {
        return
      }

      const previousFadeIn = region.fadeInDuration
      const previousFadeOut = region.fadeOutDuration

      region.duration = firstDuration
      region.fadeInDuration = Math.min(previousFadeIn, firstDuration)
      region.fadeOutDuration = 0

      const nextRegionId = `change-sound-${Date.now()}`
      state.changeSoundRegions[nextRegionId] = {
        ...region,
        id: nextRegionId,
        startTime: clampedSplitTime,
        duration: secondDuration,
        fadeInDuration: 0,
        fadeOutDuration: Math.min(previousFadeOut, secondDuration),
      }

      state.selectedRegionId = nextRegionId
      recalculateZIndices(state)
    })
  },
  splitFloatingMonitorRegion: (regionId, splitTime) => {
    set((state) => {
      const region = state.floatingMonitorRegions[regionId]
      if (!region) return

      const regionStart = region.startTime
      const regionEnd = region.startTime + region.duration
      const clampedSplitTime = Math.max(regionStart, Math.min(splitTime, regionEnd))

      const firstDuration = clampedSplitTime - regionStart
      const secondDuration = regionEnd - clampedSplitTime
      if (firstDuration < TIMELINE.MINIMUM_REGION_DURATION || secondDuration < TIMELINE.MINIMUM_REGION_DURATION) {
        return
      }

      region.duration = firstDuration

      const nextRegionId = `floating-monitor-${Date.now()}`
      state.floatingMonitorRegions[nextRegionId] = {
        ...region,
        id: nextRegionId,
        startTime: clampedSplitTime,
        duration: secondDuration,
        sourceStart: region.sourceStart + firstDuration,
      }

      state.selectedRegionId = nextRegionId
      recalculateZIndices(state)
    })
  },
  updateRegion: (id, updates) => {
    const shouldSyncBlurDefaults = BLUR_DEFAULT_UPDATE_KEYS.some((key) => key in updates)
    const shouldSyncSwapDefaults = SWAP_DEFAULT_UPDATE_KEYS.some((key) => key in updates)

    set((state) => {
      const region = getRegionById(state, id)
      if (region) {
        const oldDuration = region.duration
        const oldLaneId = region.laneId
        Object.assign(region, updates)
        if (region.type === 'media-audio') {
          region.sourceStart = Math.max(0, region.sourceStart)
          region.volume = Math.max(0, Math.min(region.volume, 1))
          const sourceClipDuration = get().mediaAudioClip?.duration || 0
          if (sourceClipDuration > 0) {
            const maxDurationFromSource = Math.max(
              TIMELINE.MINIMUM_REGION_DURATION,
              sourceClipDuration - region.sourceStart,
            )
            region.duration = Math.min(region.duration, maxDurationFromSource)
          }
          region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
          region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
        } else if (region.type === 'change-sound') {
          region.volume = Math.max(0, Math.min(region.volume, 1))
          region.fadeInDuration = Math.max(0, Math.min(region.fadeInDuration, region.duration))
          region.fadeOutDuration = Math.max(0, Math.min(region.fadeOutDuration, region.duration))
        } else if (region.type === 'floating-monitor') {
          region.sourceStart = Math.max(0, region.sourceStart)
          region.x = Math.max(0, Math.min(region.x, 1))
          region.y = Math.max(0, Math.min(region.y, 1))
          region.width = Math.max(0.1, Math.min(region.width, 1))
          region.height = Math.max(0.1, Math.min(region.height, 1))
          region.borderRadius = Math.max(
            DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.min,
            Math.min(region.borderRadius, DEFAULTS.FLOATING_MONITOR.STYLE.RADIUS.max),
          )
          region.borderWidth = Math.max(
            DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.min,
            Math.min(region.borderWidth, DEFAULTS.FLOATING_MONITOR.STYLE.BORDER.WIDTH.max),
          )
          region.shadowBlur = Math.max(
            DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.min,
            Math.min(region.shadowBlur, DEFAULTS.FLOATING_MONITOR.EFFECTS.BLUR.max),
          )
          region.shadowOffsetX = Math.max(
            DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.min,
            Math.min(region.shadowOffsetX, DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_X.max),
          )
          region.shadowOffsetY = Math.max(
            DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.min,
            Math.min(region.shadowOffsetY, DEFAULTS.FLOATING_MONITOR.EFFECTS.OFFSET_Y.max),
          )
          const monitor = state.floatingMonitors[region.monitorId]
          if (monitor?.kind === 'image') {
            region.sourceStart = 0
          } else if (monitor?.duration) {
            region.duration = Math.min(
              region.duration,
              Math.max(TIMELINE.MINIMUM_REGION_DURATION, monitor.duration - region.sourceStart),
            )
          }
        } else if (region.type === 'swap') {
          if (sameSwapParticipant(region.origin, region.target)) {
            region.target = { kind: 'floating-monitor-region', regionId: '' }
          }
          const originBounds = getSwapParticipantBounds(state, region.origin)
          const targetBounds = getSwapParticipantBounds(state, region.target)
          if (originBounds && targetBounds) {
            const validStart = Math.max(originBounds.start, targetBounds.start)
            const validEnd = Math.min(originBounds.end, targetBounds.end)
            if (validEnd - validStart >= TIMELINE.MINIMUM_REGION_DURATION) {
              region.startTime = Math.max(
                validStart,
                Math.min(region.startTime, validEnd - TIMELINE.MINIMUM_REGION_DURATION),
              )
              region.duration = Math.min(region.duration, validEnd - region.startTime)
            } else {
              region.target = { kind: 'floating-monitor-region', regionId: '' }
            }
          }
        }
        if (oldDuration !== region.duration || oldLaneId !== region.laneId) {
          recalculateZIndices(state)
        }
      }
    })

    if (shouldSyncBlurDefaults) {
      const updatedBlurRegion = get().blurRegions[id]
      if (updatedBlurRegion) {
        if (get().assetTimelineEditing) {
          set((state) => {
            if (state.assetTimelineEditing) {
              state.assetTimelineEditing.blurDefaults = toBlurPresetDefaults(updatedBlurRegion)
            }
          })
        } else {
          get()._updateActivePresetToolDefaults({ blurDefaults: toBlurPresetDefaults(updatedBlurRegion) })
        }
      }
    }

    if (shouldSyncSwapDefaults) {
      const updatedSwapRegion = get().swapRegions[id]
      if (updatedSwapRegion) {
        if (get().assetTimelineEditing) {
          set((state) => {
            if (state.assetTimelineEditing) {
              state.assetTimelineEditing.swapDefaults = toSwapPresetDefaults(updatedSwapRegion)
            }
          })
        } else {
          get()._updateActivePresetToolDefaults({ swapDefaults: toSwapPresetDefaults(updatedSwapRegion) })
        }
      }
    }
  },
  deleteRegion: (id) => {
    set((state) => {
      delete state.zoomRegions[id]
      delete state.cutRegions[id]
      delete state.speedRegions[id]
      delete state.blurRegions[id]
      delete state.swapRegions[id]
      delete state.mediaAudioRegions[id]
      delete state.changeSoundRegions[id]
      delete state.floatingMonitorRegions[id]
      if (state.selectedRegionId === id) {
        state.selectedRegionId = null
      }
      state.timelineLanes = removeContentRootLaneIfEmpty(
        state.timelineLanes,
        Object.keys(state.cutRegions).length > 0,
        Object.keys(state.changeSoundRegions).length > 0,
      )
      recalculateZIndices(state)
    })
  },
  setSelectedRegionId: (id) =>
    set((state) => {
      state.selectedRegionId = id
    }),
  setPreviewCutRegion: (region) =>
    set((state) => {
      state.previewCutRegion = region
    }),
  setTimelineZoom: (zoom) =>
    set((state) => {
      state.timelineZoom = Math.min(TIMELINE.VIEW_ZOOM.MAX, Math.max(TIMELINE.VIEW_ZOOM.MIN, zoom))
    }),
  applyAnimationSettingsToAll: ({ transitionDuration, easing, zoomLevel }) => {
    set((state) => {
      Object.values(state.zoomRegions).forEach((region) => {
        region.transitionDuration = transitionDuration
        region.easing = easing
        region.zoomLevel = zoomLevel
      })
    })
  },
  applySpeedToAll: (speed) => {
    set((state) => {
      Object.values(state.speedRegions).forEach((region) => {
        region.speed = speed
      })
    })
  },
})
