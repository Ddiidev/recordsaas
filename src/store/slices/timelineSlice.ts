import { BLUR_REGION, TIMELINE, ZOOM } from '../../lib/constants'
import type { TimelineState, TimelineActions, Slice } from '../../types'
import type { BlurRegion, CutRegion, ZoomRegion, SpeedRegion, TimelineLane, TimelineRegion } from '../../types'
import {
  normalizeTimelineLanes,
  createDefaultTimelineLane,
  getFallbackLaneId,
  sortTimelineLanes,
} from '../../lib/timeline-lanes'

export const initialTimelineState: TimelineState = {
  timelineLanes: [createDefaultTimelineLane()],
  zoomRegions: {},
  cutRegions: {},
  speedRegions: {},
  blurRegions: {},
  previewCutRegion: null,
  selectedRegionId: null,
  activeZoomRegionId: null,
  isCurrentlyCut: false,
  timelineZoom: 1,
}

const getAllRegions = (state: {
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
}): TimelineRegion[] => [
  ...Object.values(state.zoomRegions),
  ...Object.values(state.cutRegions),
  ...Object.values(state.speedRegions),
  ...Object.values(state.blurRegions),
]

const getRegionById = (
  state: {
    zoomRegions: Record<string, ZoomRegion>
    cutRegions: Record<string, CutRegion>
    speedRegions: Record<string, SpeedRegion>
    blurRegions: Record<string, BlurRegion>
  },
  id: string,
): TimelineRegion | null =>
  state.zoomRegions[id] || state.cutRegions[id] || state.speedRegions[id] || state.blurRegions[id] || null

const ensureRegionLaneIds = (state: {
  timelineLanes: TimelineLane[]
  zoomRegions: Record<string, ZoomRegion>
  cutRegions: Record<string, CutRegion>
  speedRegions: Record<string, SpeedRegion>
  blurRegions: Record<string, BlurRegion>
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
      if (normalizedLanes.length <= 1 || !normalizedLanes.some((lane) => lane.id === laneId)) return

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

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= sorted.length) return

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
      if (!state.timelineLanes.some((lane) => lane.id === laneId)) return
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
        allRegs.some((r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime)

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
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false }
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

    const fallbackLaneId = getFallbackLaneId(get().timelineLanes)
    const selectedRegion = get().selectedRegionId ? getRegionById(get(), get().selectedRegionId!) : null
    const preferredLaneId = selectedRegion?.laneId || fallbackLaneId

    const id = `cut-${Date.now()}`
    const newRegion: CutRegion = {
      id,
      type: 'cut',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: 2,
      zIndex: 0,
      ...regionData,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
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
        allRegs.some((r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime)

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
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false }
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

    const id = `blur-${Date.now()}`
    const newRegion: BlurRegion = {
      id,
      type: 'blur',
      laneId: preferredLaneId,
      startTime: currentTime,
      duration: BLUR_REGION.DEFAULT_DURATION,
      style: BLUR_REGION.STYLE.DEFAULT,
      intensity: BLUR_REGION.INTENSITY.defaultValue,
      x: BLUR_REGION.X.defaultValue,
      y: BLUR_REGION.Y.defaultValue,
      width: BLUR_REGION.WIDTH.defaultValue,
      height: BLUR_REGION.HEIGHT.defaultValue,
      zIndex: 0,
    }

    if (newRegion.startTime + newRegion.duration > duration) {
      newRegion.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, duration - newRegion.startTime)
    }

    set((state) => {
      const allRegs = getAllRegions(state)
      const endTime = newRegion.startTime + newRegion.duration
      const isOccupied = (laneId: string) => 
        allRegs.some((r) => r.laneId === laneId && r.startTime < endTime && r.startTime + r.duration > newRegion.startTime)

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
            { id: resolvedLaneId, name: `Lane ${nextOrder + 1}`, order: nextOrder, visible: true, locked: false }
          ]
        }
      }
      newRegion.laneId = resolvedLaneId

      state.blurRegions[id] = newRegion
      state.selectedRegionId = id
      recalculateZIndices(state)
    })
  },
  updateRegion: (id, updates) => {
    set((state) => {
      const region = state.zoomRegions[id] || state.cutRegions[id] || state.speedRegions[id] || state.blurRegions[id]
      if (region) {
        const oldDuration = region.duration
        const oldLaneId = region.laneId
        Object.assign(region, updates)
        if (oldDuration !== region.duration || oldLaneId !== region.laneId) {
          recalculateZIndices(state)
        }
      }
    })
  },
  deleteRegion: (id) => {
    set((state) => {
      delete state.zoomRegions[id]
      delete state.cutRegions[id]
      delete state.speedRegions[id]
      delete state.blurRegions[id]
      if (state.selectedRegionId === id) {
        state.selectedRegionId = null
      }
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
      state.timelineZoom = zoom
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
