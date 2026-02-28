import type {
  ProjectState,
  ProjectActions,
  Slice,
  RecordingGeometry,
  VideoDimensions,
  CursorTheme,
  CursorImageBitmap,
} from '../../types'
import type { MetaDataItem, ZoomRegion, CursorFrame } from '../../types'
import { ZOOM } from '../../lib/constants'
import { initialFrameState, recalculateCanvasDimensions } from './frameSlice'
import { prepareCursorBitmaps } from '../../lib/utils'
import { normalizeBackgroundMediaFields, toMediaUrl } from '../../lib/media'
import { createDefaultTimelineLane, getFallbackLaneId } from '../../lib/timeline-lanes'

export const initialProjectState: ProjectState = {
  videoPath: null,
  metadataPath: null,
  videoUrl: null,
  micAudioPath: null,
  micAudioUrl: null,
  systemAudioPath: null,
  systemAudioUrl: null,
  audioPath: null,
  audioUrl: null,
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
  hasMicAudioTrack: false,
  hasSystemAudioTrack: false,
  hasAnyAudioTrack: false,
  hasAudioTrack: false,
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
    micAudioPath,
    systemAudioPath,
    audioPath,
    originalProjectPath,
  }) => {
    const toUrl = (path: string | null | undefined) => toMediaUrl(path)
    const videoUrl = toUrl(videoPath)
    const webcamVideoUrl = toUrl(webcamVideoPath)
    const resolvedMicAudioPath = micAudioPath || audioPath || null
    const resolvedSystemAudioPath = systemAudioPath || null
    const micAudioUrl = toUrl(resolvedMicAudioPath)
    const systemAudioUrl = toUrl(resolvedSystemAudioPath)
    const audioUrl = micAudioUrl || toUrl(audioPath)

    get().resetProjectState() // Clear previous project data first

    const activePresetId = get().activePresetId
    const presets = get().presets
    const presetToApply = (activePresetId && presets[activePresetId]) || Object.values(presets).find((p) => p.isDefault)

    set((state) => {
      if (presetToApply) {
        state.frameStyles = JSON.parse(JSON.stringify(presetToApply.styles))
        state.aspectRatio = presetToApply.aspectRatio
      } else {
        state.frameStyles = initialFrameState.frameStyles
      }
      state.videoPath = videoPath
      state.metadataPath = metadataPath
      state.videoUrl = videoUrl
      state.webcamVideoPath = webcamVideoPath || null
      state.webcamVideoUrl = webcamVideoUrl
      state.isWebcamVisible = !!webcamVideoUrl
      state.micAudioPath = resolvedMicAudioPath
      state.micAudioUrl = micAudioUrl
      state.systemAudioPath = resolvedSystemAudioPath
      state.systemAudioUrl = systemAudioUrl
      state.audioPath = resolvedMicAudioPath
      state.audioUrl = audioUrl
      state.hasMicAudioTrack = !!micAudioUrl
      state.hasSystemAudioTrack = !!systemAudioUrl
      state.hasAnyAudioTrack = !!(micAudioUrl || systemAudioUrl)
      state.hasAudioTrack = state.hasAnyAudioTrack
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
      const recordingGeometry = (parsedData.recordingGeometry || parsedData.geometry || fallbackGeometry) as RecordingGeometry
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

        const frameStyles = parsedData.frameStyles as typeof state.frameStyles | undefined
        if (frameStyles) {
          const { background } = normalizeBackgroundMediaFields(frameStyles.background)
          state.frameStyles = { ...frameStyles, background }
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
      Object.values({ ...state.zoomRegions, ...state.cutRegions, ...state.speedRegions, ...state.blurRegions }).forEach(
        (region) => {
          if (region.startTime + region.duration > duration) {
            region.duration = Math.max(0.1, duration - region.startTime)
          }
        },
      )
    }),
  resetProjectState: () => {
    set((state) => {
      Object.assign(state, initialProjectState)
      state.zoomRegions = {}
      state.cutRegions = {}
      state.speedRegions = {}
      state.blurRegions = {}
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
      state.hasAnyAudioTrack = hasAudio
      state.hasAudioTrack = hasAudio
    })
  },
  setOriginalProjectPath: (path) => {
    set((state) => {
      state.originalProjectPath = path
    })
  },
})
