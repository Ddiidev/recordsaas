import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore, useAllRegions } from '../../store/editorStore'
import { ZoomRegionBlock } from './timeline/ZoomRegionBlock'
import { CutRegionBlock } from './timeline/CutRegionBlock'
import { SpeedRegionBlock } from './timeline/SpeedRegionBlock'
import { BlurRegionBlock } from './timeline/BlurRegionBlock'
import { SwapRegionBlock } from './timeline/SwapRegionBlock'
import { MediaAudioRegionBlock } from './timeline/MediaAudioRegionBlock'
import { ChangeSoundRegionBlock } from './timeline/ChangeSoundRegionBlock'
import { FloatingMonitorRegionBlock } from './timeline/FloatingMonitorRegionBlock'
import { Playhead } from './timeline/Playhead'
import { cn } from '../../lib/utils'
import { ChevronUp, ChevronDown, Trash, DotsVertical, Plus } from '@icons'
import { formatTime, calculateRulerInterval } from '../../lib/utils'
import { TIMELINE } from '../../lib/constants'
import { useTimelineInteraction } from '../../hooks/useTimelineInteraction'
import { sortTimelineLanes, getFallbackLaneId } from '../../lib/timeline-lanes'
import { ContextMenu, ContextMenuItem } from '../ui/context-menu'
import { SimpleTooltip } from '../ui/tooltip'
import type { TimelineRegion } from '../../types'
import { CHANGE_SOUND_DRAG_TYPE, MEDIA_AUDIO_DRAG_TYPE } from '../../lib/media-assets'
import { TakeTrack, TAKE_TRACK_HEIGHT } from './timeline/TakeTrack'
import {
  AudioWaveformTrack,
  AUDIO_WAVEFORM_TRACK_COLLAPSED_HEIGHT,
  AUDIO_WAVEFORM_TRACK_HEIGHT,
} from './timeline/AudioWaveformTrack'

const LANE_HEIGHT_PX = 72
const CONTENT_ROOT_LANE_HEIGHT_PX = 30
const LANE_GAP_PX = 8
const TIMELINE_END_BUFFER_SECONDS = 20
const RULER_HEIGHT_PX = 48
const TIMELINE_MIN_VISIBLE_LANES = 2
const TIMELINE_MAX_VISIBLE_LANES = 3
const LANE_ACTION_STRIP_WIDTH_PX = 28
const LANE_ACTION_GUTTER_PX = 10
const SCRUB_RESUME_FALLBACK_MS = 1500

const Ruler = memo(
  ({
    ticks,
    timeToPx,
    formatTime: formatTimeFunc,
    onMouseDown,
    topOffset,
  }: {
    ticks: { time: number; type: string }[]
    timeToPx: (time: number) => number
    formatTime: (seconds: number) => string
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
    topOffset: number
  }) => (
    <div
      className="sticky left-0 right-0 z-[300] h-12 cursor-ew-resize overflow-hidden border-b border-border/30 bg-card/95 backdrop-blur-md"
      style={{ top: topOffset }}
      onMouseDown={onMouseDown}
    >
      <div className="relative h-full pt-2">
        {ticks.map(({ time, type }) => (
          <div key={`${type}-${time}`} className="absolute top-2 h-full" style={{ left: `${timeToPx(time)}px` }}>
            <div
              className={cn(
                'timeline-tick absolute top-0 left-1/2 -translate-x-1/2 w-px',
                type === 'major' ? 'h-5 opacity-60' : 'h-2.5 opacity-30',
              )}
            />
            {type === 'major' && (
              <span className="absolute top-3.5 left-1 text-[10px] text-foreground/70 font-mono font-medium tracking-tight">
                {formatTimeFunc(time)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  ),
)
Ruler.displayName = 'Ruler'

const TimelinePlayhead = memo(
  ({
    duration,
    timeToTrackPx,
    videoRef,
    timelineRef,
    isDragging,
    onMouseDown,
  }: {
    duration: number
    timeToTrackPx: (time: number) => number
    videoRef: React.RefObject<HTMLVideoElement>
    timelineRef: React.RefObject<HTMLDivElement>
    isDragging: boolean
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  }) => {
    const { currentTime, isPlaying } = useEditorStore(
      useShallow((state) => ({ currentTime: state.currentTime, isPlaying: state.isPlaying })),
    )
    const playheadRef = useRef<HTMLDivElement>(null)
    const animationFrameRef = useRef<number>()

    useEffect(() => {
      const animate = () => {
        if (playheadRef.current) {
          playheadRef.current.style.transform = `translateX(${timeToTrackPx(useEditorStore.getState().currentTime)}px)`
        }
        animationFrameRef.current = requestAnimationFrame(animate)
      }
      if (isPlaying) animationFrameRef.current = requestAnimationFrame(animate)
      return () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      }
    }, [isPlaying, timeToTrackPx, videoRef])

    useEffect(() => {
      if (!isPlaying && playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${timeToTrackPx(currentTime)}px)`
      }
    }, [currentTime, isPlaying, timeToTrackPx])

    if (duration <= 0) return null
    return (
      <div
        ref={playheadRef}
        data-playhead
        className="absolute top-0 bottom-0 pointer-events-auto cursor-ew-resize"
        style={{ zIndex: 9999, transform: `translateX(${timeToTrackPx(currentTime)}px)` }}
      >
        <Playhead
          height={Math.max(80, Math.floor((timelineRef.current?.clientHeight ?? 0) * 0.9))}
          isDragging={isDragging}
          onMouseDown={onMouseDown}
        />
      </div>
    )
  },
)
TimelinePlayhead.displayName = 'TimelinePlayhead'

export function Timeline({
  videoRef,
  onScrubStateChange,
}: {
  videoRef: React.RefObject<HTMLVideoElement>
  onScrubStateChange?: (isScrubbing: boolean) => void
}) {
  const {
    duration,
    timelineZoom,
    previewCutRegion,
    selectedRegionId,
    timelineLanes,
    mediaAudioClip,
    takeModeEnabled,
    assetTimelineEditing,
    captureSourceOffsetsMs,
    audioPath,
    systemAudioPath,
    audioWaveformVisibility,
  } = useEditorStore(
    useShallow((state) => ({
      duration: state.duration,
      timelineZoom: state.timelineZoom,
      previewCutRegion: state.previewCutRegion,
      selectedRegionId: state.selectedRegionId,
      timelineLanes: state.timelineLanes,
      mediaAudioClip: state.mediaAudioClip,
      takeModeEnabled: state.takeModeEnabled,
      assetTimelineEditing: state.assetTimelineEditing,
      captureSourceOffsetsMs: state.captureSourceOffsetsMs,
      audioPath: state.audioPath,
      systemAudioPath: state.systemAudioPath,
      audioWaveformVisibility: state.audioWaveformVisibility,
    })),
  )

  const {
    setCurrentTime,
    setPlaying,
    setSelectedRegionId,
    selectTake,
    addTimelineLane,
    moveTimelineLane,
    removeTimelineLane,
    addMediaAudioRegion,
    addChangeSoundRegion,
    setAudioWaveformVisible,
  } = useEditorStore(
    useShallow((state) => ({
      setCurrentTime: state.setCurrentTime,
      setPlaying: state.setPlaying,
      setSelectedRegionId: state.setSelectedRegionId,
      selectTake: state.selectTake,
      addTimelineLane: state.addTimelineLane,
      moveTimelineLane: state.moveTimelineLane,
      removeTimelineLane: state.removeTimelineLane,
      addMediaAudioRegion: state.addMediaAudioRegion,
      addChangeSoundRegion: state.addChangeSoundRegion,
      setAudioWaveformVisible: state.setAudioWaveformVisible,
    })),
  )

  const sortedLanes = useMemo(() => sortTimelineLanes(timelineLanes), [timelineLanes])
  const fallbackLaneId = useMemo(() => getFallbackLaneId(timelineLanes), [timelineLanes])
  const showLaneActionButtons = sortedLanes.length > 1
  const timelineStartOffsetPx = LANE_ACTION_STRIP_WIDTH_PX + LANE_ACTION_GUTTER_PX
  const takeTrackHeight = takeModeEnabled && !assetTimelineEditing ? TAKE_TRACK_HEIGHT : 0
  const screenCaptureOffsetSeconds = Math.max(0, captureSourceOffsetsMs?.screen || 0) / 1000
  const audioWaveformTracks = useMemo(
    () =>
      [
        audioPath
          ? {
              id: 'recording' as const,
              audioPath,
              label: 'Microfone',
              sourceOffsetMs: captureSourceOffsetsMs?.recording || 0,
              visible: audioWaveformVisibility?.recording !== false,
            }
          : null,
        systemAudioPath
          ? {
              id: 'systemAudio' as const,
              audioPath: systemAudioPath,
              label: 'Áudio do sistema',
              sourceOffsetMs: captureSourceOffsetsMs?.systemAudio || 0,
              visible: audioWaveformVisibility?.systemAudio !== false,
            }
          : null,
      ].filter((track): track is NonNullable<typeof track> => track !== null),
    [audioPath, audioWaveformVisibility, captureSourceOffsetsMs, systemAudioPath],
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const lanesContainerRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const regionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const rulerAnimationFrameRef = useRef<number | null>(null)
  const pendingRulerClientXRef = useRef<number | null>(null)
  const pendingVideoSeekTimeRef = useRef<number | null>(null)
  const isVideoSeekInFlightRef = useRef(false)
  const cleanupVideoSeekRef = useRef<(() => void) | null>(null)
  const videoSeekFallbackTimerRef = useRef<number | null>(null)
  const resumePlaybackAfterScrubRef = useRef(false)
  const scrubGenerationRef = useRef(0)
  const cancelPendingScrubReleaseRef = useRef<(() => void) | null>(null)
  const isRulerScrubbingRef = useRef(false)
  const cleanupRulerScrubListenersRef = useRef<(() => void) | null>(null)
  const previousTimelineZoomRef = useRef(timelineZoom)
  const previousPixelsPerSecondRef = useRef(0)

  const [containerWidth, setContainerWidth] = useState(0)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  const [laneActionMenu, setLaneActionMenu] = useState<{
    laneId: string
    position: { x: number; y: number }
  } | null>(null)
  const [mediaAssetDropLaneId, setMediaAssetDropLaneId] = useState<string | null>(null)

  useEffect(() => {
    const containerEl = containerRef.current
    let widthObserver: ResizeObserver | null = null

    if (containerEl) {
      setContainerWidth(containerEl.clientWidth)
      widthObserver = new ResizeObserver((entries) => {
        if (entries[0]) setContainerWidth(entries[0].contentRect.width)
      })
      widthObserver.observe(containerEl)
    }

    return () => {
      if (widthObserver && containerEl) widthObserver.unobserve(containerEl)
    }
  }, [])

  const pixelsPerSecond = useMemo(() => {
    if (duration === 0 || containerWidth === 0) return 200
    return (containerWidth / duration) * timelineZoom
  }, [duration, containerWidth, timelineZoom])

  const timeToPx = useCallback((time: number) => time * pixelsPerSecond, [pixelsPerSecond])
  const pxToTime = useCallback((px: number) => px / pixelsPerSecond, [pixelsPerSecond])
  const timeToTrackPx = useCallback(
    (time: number) => timelineStartOffsetPx + timeToPx(time),
    [timelineStartOffsetPx, timeToPx],
  )
  const trackPxToTime = useCallback(
    (px: number) => pxToTime(Math.max(0, px - timelineStartOffsetPx)),
    [pxToTime, timelineStartOffsetPx],
  )

  useLayoutEffect(() => {
    const container = containerRef.current
    const previousPixelsPerSecond = previousPixelsPerSecondRef.current
    const didZoomChange = previousTimelineZoomRef.current !== timelineZoom

    if (container && didZoomChange && previousPixelsPerSecond > 0 && pixelsPerSecond > 0) {
      const editorState = useEditorStore.getState()
      const playheadTime = editorState.takeModeEnabled
        ? editorState.currentTime
        : editorState.isPlaying
          ? Math.max(0, (videoRef.current?.currentTime ?? editorState.currentTime) - screenCaptureOffsetSeconds)
          : editorState.currentTime
      const previousPlayheadViewportX =
        timelineStartOffsetPx + playheadTime * previousPixelsPerSecond - container.scrollLeft
      const playheadViewportX =
        previousPlayheadViewportX >= 0 && previousPlayheadViewportX <= container.clientWidth
          ? previousPlayheadViewportX
          : container.clientWidth / 2
      const nextScrollLeft = timelineStartOffsetPx + playheadTime * pixelsPerSecond - playheadViewportX
      const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)

      container.scrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft))
      setTimelineScrollLeft(container.scrollLeft)
    }

    previousTimelineZoomRef.current = timelineZoom
    previousPixelsPerSecondRef.current = pixelsPerSecond
  }, [pixelsPerSecond, screenCaptureOffsetSeconds, timelineStartOffsetPx, timelineZoom, videoRef])

  const updateVideoTime = useCallback(
    (time: number) => {
      const clampedTime = Math.max(0, Math.min(time, duration))
      setCurrentTime(clampedTime)
      if (takeModeEnabled) {
        pendingVideoSeekTimeRef.current = null
        return
      }
      const video = videoRef.current
      if (!video) {
        pendingVideoSeekTimeRef.current = null
        return
      }

      pendingVideoSeekTimeRef.current = clampedTime
      if (isVideoSeekInFlightRef.current) return

      const drainPendingSeek = () => {
        const nextTime = pendingVideoSeekTimeRef.current
        pendingVideoSeekTimeRef.current = null
        if (nextTime === null) return
        if (useEditorStore.getState().currentTime !== nextTime) {
          setCurrentTime(nextTime)
        }

        if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
          video.currentTime = nextTime + screenCaptureOffsetSeconds
          return
        }

        const nextSourceTime = nextTime + screenCaptureOffsetSeconds
        if (!video.seeking && Math.abs(video.currentTime - nextSourceTime) < 0.001) {
          drainPendingSeek()
          return
        }

        isVideoSeekInFlightRef.current = true
        const clearInFlightSeek = () => {
          video.removeEventListener('seeked', handleSeeked)
          video.removeEventListener('error', handleSeekFailure)
          if (videoSeekFallbackTimerRef.current !== null) {
            window.clearTimeout(videoSeekFallbackTimerRef.current)
            videoSeekFallbackTimerRef.current = null
          }
          cleanupVideoSeekRef.current = null
          isVideoSeekInFlightRef.current = false
        }
        const handleSeeked = () => {
          clearInFlightSeek()
          drainPendingSeek()
        }
        const handleSeekFailure = () => {
          const nextPendingTime = pendingVideoSeekTimeRef.current
          clearInFlightSeek()
          // Não drenar próximo seek enquanto decoder ainda busca frame anterior
          if (nextPendingTime !== null && Math.abs(nextPendingTime - nextTime) >= 0.001 && !video.seeking) {
            requestAnimationFrame(drainPendingSeek)
          }
        }
        cleanupVideoSeekRef.current = clearInFlightSeek
        video.addEventListener('seeked', handleSeeked)
        video.addEventListener('error', handleSeekFailure, { once: true })
        videoSeekFallbackTimerRef.current = window.setTimeout(handleSeekFailure, 1500)
        try {
          video.currentTime = nextSourceTime
        } catch {
          handleSeekFailure()
        }
      }

      drainPendingSeek()
    },
    [duration, screenCaptureOffsetSeconds, setCurrentTime, takeModeEnabled, videoRef],
  )

  const applyRulerTime = useCallback(
    (clientX: number) => {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      updateVideoTime(trackPxToTime(clientX - rect.left))
    },
    [trackPxToTime, updateVideoTime],
  )

  const updateRulerTime = useCallback(
    (clientX: number) => {
      pendingRulerClientXRef.current = clientX
      if (rulerAnimationFrameRef.current !== null) return

      rulerAnimationFrameRef.current = requestAnimationFrame(() => {
        rulerAnimationFrameRef.current = null
        const pendingClientX = pendingRulerClientXRef.current
        pendingRulerClientXRef.current = null
        if (pendingClientX !== null) applyRulerTime(pendingClientX)
      })
    },
    [applyRulerTime],
  )

  const flushRulerTime = useCallback(
    (clientX: number) => {
      if (rulerAnimationFrameRef.current !== null) {
        cancelAnimationFrame(rulerAnimationFrameRef.current)
        rulerAnimationFrameRef.current = null
      }
      pendingRulerClientXRef.current = null
      applyRulerTime(clientX)
    },
    [applyRulerTime],
  )

  const releaseScrubAfterSeek = useCallback(() => {
    const video = videoRef.current
    const scrubGeneration = scrubGenerationRef.current
    if (!video) {
      const shouldResumePlayback = resumePlaybackAfterScrubRef.current
      resumePlaybackAfterScrubRef.current = false
      onScrubStateChange?.(false)
      if (shouldResumePlayback) setPlaying(true)
      return
    }

    let released = false
    let releaseFrame: number | null = null
    let initialFallbackTimer: number | null = null
    let hardFallbackTimer: number | null = null

    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked)
      if (releaseFrame !== null) window.cancelAnimationFrame(releaseFrame)
      if (initialFallbackTimer !== null) window.clearTimeout(initialFallbackTimer)
      if (hardFallbackTimer !== null) window.clearTimeout(hardFallbackTimer)
      if (cancelPendingScrubReleaseRef.current === cancel) {
        cancelPendingScrubReleaseRef.current = null
      }
    }

    const release = () => {
      if (released) return
      released = true
      cleanup()
      if (scrubGeneration !== scrubGenerationRef.current) return

      const shouldResumePlayback = resumePlaybackAfterScrubRef.current
      resumePlaybackAfterScrubRef.current = false
      onScrubStateChange?.(false)
      // Não retomar playback enquanto vídeo principal ainda busca frame
      if (shouldResumePlayback && !video.seeking) setPlaying(true)
    }

    const cancel = () => {
      if (released) return
      released = true
      cleanup()
    }

    const waitForSeekQueueToSettle = () => {
      if (released || releaseFrame !== null) return
      releaseFrame = window.requestAnimationFrame(() => {
        releaseFrame = null
        if (isVideoSeekInFlightRef.current || pendingVideoSeekTimeRef.current !== null || video.seeking) {
          waitForSeekQueueToSettle()
          return
        }
        release()
      })
    }

    const handleSeeked = () => waitForSeekQueueToSettle()

    video.addEventListener('seeked', handleSeeked)
    initialFallbackTimer = window.setTimeout(waitForSeekQueueToSettle, 32)
    hardFallbackTimer = window.setTimeout(release, SCRUB_RESUME_FALLBACK_MS)
    cancelPendingScrubReleaseRef.current = cancel
  }, [onScrubStateChange, setPlaying, videoRef])

  const finishRulerScrub = useCallback(
    (clientX: number) => {
      if (!isRulerScrubbingRef.current) return
      isRulerScrubbingRef.current = false
      cleanupRulerScrubListenersRef.current?.()
      cleanupRulerScrubListenersRef.current = null
      releaseScrubAfterSeek()
      flushRulerTime(clientX)
    },
    [flushRulerTime, releaseScrubAfterSeek],
  )

  const startRulerScrubListeners = useCallback(() => {
    cleanupRulerScrubListenersRef.current?.()
    isRulerScrubbingRef.current = true

    const handleMouseMove = (event: MouseEvent) => {
      updateRulerTime(event.clientX)
    }
    const handleMouseUp = (event: MouseEvent) => {
      finishRulerScrub(event.clientX)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (cleanupRulerScrubListenersRef.current === cleanup) {
        cleanupRulerScrubListenersRef.current = null
      }
    }

    cleanupRulerScrubListenersRef.current = cleanup
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [finishRulerScrub, updateRulerTime])

  const capturePlaybackForScrub = useCallback(() => {
    cancelPendingScrubReleaseRef.current?.()
    cancelPendingScrubReleaseRef.current = null
    resumePlaybackAfterScrubRef.current ||= useEditorStore.getState().isPlaying
    scrubGenerationRef.current += 1
  }, [])

  useEffect(() => {
    return () => {
      if (rulerAnimationFrameRef.current !== null) {
        cancelAnimationFrame(rulerAnimationFrameRef.current)
      }
      cleanupRulerScrubListenersRef.current?.()
      cancelPendingScrubReleaseRef.current?.()
      cleanupVideoSeekRef.current?.()
      if (videoSeekFallbackTimerRef.current !== null) {
        window.clearTimeout(videoSeekFallbackTimerRef.current)
      }
      pendingVideoSeekTimeRef.current = null
      isVideoSeekInFlightRef.current = false
    }
  }, [])

  const resolveLaneIdFromClientY = useCallback(
    (clientY: number): string | null => {
      if (sortedLanes.length === 0) return null

      let closestLaneId = sortedLanes[0]?.id ?? null
      let closestDistance = Number.POSITIVE_INFINITY

      for (const lane of sortedLanes) {
        const laneElement = laneRefs.current.get(lane.id)
        if (!laneElement) continue

        const rect = laneElement.getBoundingClientRect()
        if (clientY >= rect.top && clientY <= rect.bottom) {
          return lane.id
        }

        const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom
        if (distance < closestDistance) {
          closestDistance = distance
          closestLaneId = lane.id
        }
      }

      return closestLaneId
    },
    [sortedLanes],
  )

  const {
    draggingRegionId,
    dragMovePreview,
    activeDropLaneId,
    isDraggingPlayhead,
    handleRegionMouseDown,
    handlePlayheadMouseDown,
  } = useTimelineInteraction({
    timelineRef,
    regionRefs,
    pxToTime,
    timeToPx,
    updateVideoTime,
    duration,
    defaultLaneId: fallbackLaneId,
    resolveLaneIdFromClientY,
    timelineStartOffsetPx,
    onScrubStateChange,
    onScrubStart: capturePlaybackForScrub,
    onScrubEnd: releaseScrubAfterSeek,
  })

  const rulerTicks = useMemo(() => {
    if (duration <= 0 || pixelsPerSecond <= 0) return []
    const { major, minor } = calculateRulerInterval(pixelsPerSecond)
    const ticks = []
    for (let time = 0; time <= duration; time += major) {
      ticks.push({ time: parseFloat(time.toPrecision(10)), type: 'major' })
    }
    for (let time = 0; time <= duration; time += minor) {
      const preciseTime = parseFloat(time.toPrecision(10))
      if (preciseTime % major !== 0) {
        ticks.push({ time: preciseTime, type: 'minor' })
      }
    }
    return ticks
  }, [duration, pixelsPerSecond])

  useEffect(() => {
    if (!laneActionMenu) return

    const hasLane = sortedLanes.some((lane) => lane.id === laneActionMenu.laneId)
    if (!hasLane || sortedLanes.length <= 1) {
      setLaneActionMenu(null)
    }
  }, [laneActionMenu, sortedLanes])

  const {
    zoomRegions,
    cutRegions,
    speedRegions,
    blurRegions,
    swapRegions,
    mediaAudioRegions,
    changeSoundRegions,
    floatingMonitorRegions,
  } = useAllRegions()
  const floatingMonitors = useEditorStore((state) => state.floatingMonitors)

  const allRegionsToRender = useMemo(() => {
    const combined = [
      ...Object.values(zoomRegions),
      ...Object.values(cutRegions),
      ...Object.values(speedRegions),
      ...Object.values(blurRegions),
      ...Object.values(swapRegions),
      ...Object.values(mediaAudioRegions),
      ...Object.values(changeSoundRegions),
      ...Object.values(floatingMonitorRegions),
    ]
    if (previewCutRegion) {
      combined.push({ ...previewCutRegion, laneId: previewCutRegion.laneId || fallbackLaneId })
    }
    return combined
  }, [
    zoomRegions,
    cutRegions,
    speedRegions,
    blurRegions,
    swapRegions,
    mediaAudioRegions,
    changeSoundRegions,
    floatingMonitorRegions,
    previewCutRegion,
    fallbackLaneId,
  ])

  const maxRegionEnd = useMemo(() => {
    let maxEnd = 0
    const maps = [
      zoomRegions,
      cutRegions,
      speedRegions,
      blurRegions,
      swapRegions,
      mediaAudioRegions,
      changeSoundRegions,
      floatingMonitorRegions,
    ]
    for (const map of maps) {
      for (const region of Object.values(map)) {
        maxEnd = Math.max(maxEnd, region.startTime + region.duration)
      }
    }
    return maxEnd
  }, [
    zoomRegions,
    cutRegions,
    speedRegions,
    blurRegions,
    swapRegions,
    mediaAudioRegions,
    changeSoundRegions,
    floatingMonitorRegions,
  ])

  const trackDuration = Math.max(duration + TIMELINE_END_BUFFER_SECONDS, maxRegionEnd)

  const movePreviewRegion = useMemo(() => {
    if (!dragMovePreview || dragMovePreview.laneId === dragMovePreview.sourceLaneId) return null

    const sourceRegion =
      zoomRegions[dragMovePreview.regionId] ||
      cutRegions[dragMovePreview.regionId] ||
      speedRegions[dragMovePreview.regionId] ||
      blurRegions[dragMovePreview.regionId] ||
      swapRegions[dragMovePreview.regionId] ||
      mediaAudioRegions[dragMovePreview.regionId] ||
      changeSoundRegions[dragMovePreview.regionId] ||
      floatingMonitorRegions[dragMovePreview.regionId]

    if (!sourceRegion) return null

    return {
      ...sourceRegion,
      laneId: dragMovePreview.laneId,
      startTime: dragMovePreview.startTime,
      duration: dragMovePreview.duration,
    } as TimelineRegion
  }, [
    dragMovePreview,
    zoomRegions,
    cutRegions,
    speedRegions,
    blurRegions,
    swapRegions,
    mediaAudioRegions,
    changeSoundRegions,
    floatingMonitorRegions,
  ])

  const noopRegionMouseDown = useCallback(
    (
      _e: React.MouseEvent<HTMLDivElement>,
      _region: TimelineRegion,
      _type: 'move' | 'resize-left' | 'resize-right',
    ) => {},
    [],
  )

  const noopSetRegionRef = useCallback((_el: HTMLDivElement | null) => {}, [])

  const regionsByLane = useMemo(() => {
    const map = new Map<string, typeof allRegionsToRender>()
    sortedLanes.forEach((lane) => map.set(lane.id, []))

    for (const region of allRegionsToRender) {
      const laneId = map.has(region.laneId) ? region.laneId : fallbackLaneId
      map.get(laneId)?.push(region)
    }

    return map
  }, [allRegionsToRender, sortedLanes, fallbackLaneId])

  const visibleSortedLanes = useMemo(
    () => sortedLanes.filter((lane) => !lane.isContentRootLane || (regionsByLane.get(lane.id)?.length ?? 0) > 0),
    [sortedLanes, regionsByLane],
  )

  const waveformInsertAfterLaneIndex = useMemo(() => {
    const lastSpecialLaneIndex = visibleSortedLanes.reduce(
      (lastIndex, lane, index) =>
        lane.isContentRootLane || lane.isCutLane || lane.isChangeSoundLane ? index : lastIndex,
      -1,
    )
    return lastSpecialLaneIndex
  }, [visibleSortedLanes])

  const audioWaveformContentHeight = useMemo(
    () =>
      audioWaveformTracks.reduce(
        (total, track) => total + (track.visible ? AUDIO_WAVEFORM_TRACK_HEIGHT : AUDIO_WAVEFORM_TRACK_COLLAPSED_HEIGHT),
        0,
      ),
    [audioWaveformTracks],
  )

  const lanesContentHeight = useMemo(
    () =>
      visibleSortedLanes.reduce(
        (total, lane) => total + (lane.isContentRootLane ? CONTENT_ROOT_LANE_HEIGHT_PX : LANE_HEIGHT_PX),
        0,
      ) +
      audioWaveformContentHeight +
      Math.max(0, visibleSortedLanes.length + audioWaveformTracks.length - 1) * LANE_GAP_PX,
    [audioWaveformContentHeight, audioWaveformTracks.length, visibleSortedLanes],
  )
  const timelineContentHeight = takeTrackHeight + RULER_HEIGHT_PX + lanesContentHeight
  const minTimelineViewportHeight =
    takeTrackHeight +
    RULER_HEIGHT_PX +
    CONTENT_ROOT_LANE_HEIGHT_PX +
    TIMELINE_MIN_VISIBLE_LANES * LANE_HEIGHT_PX +
    TIMELINE_MIN_VISIBLE_LANES * LANE_GAP_PX
  const maxTimelineViewportHeight =
    takeTrackHeight +
    RULER_HEIGHT_PX +
    CONTENT_ROOT_LANE_HEIGHT_PX +
    TIMELINE_MAX_VISIBLE_LANES * LANE_HEIGHT_PX +
    TIMELINE_MAX_VISIBLE_LANES * LANE_GAP_PX
  const timelineViewportHeight =
    Math.min(maxTimelineViewportHeight, Math.max(minTimelineViewportHeight, timelineContentHeight)) + 14 // Adds buffer for horizontal scrollbar to prevent vertical scrolling for 2 lanes
  const laneActionMenuLaneIndex = laneActionMenu
    ? sortedLanes.findIndex((lane) => lane.id === laneActionMenu.laneId)
    : -1
  const laneActionCanMoveUp = laneActionMenuLaneIndex > 0
  const laneActionCanMoveDown = laneActionMenuLaneIndex >= 0 && laneActionMenuLaneIndex < sortedLanes.length - 1

  const closeLaneActionMenu = useCallback(() => {
    setLaneActionMenu(null)
  }, [])

  const openLaneActionMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, laneId: string) => {
    e.stopPropagation()

    const triggerRect = e.currentTarget.getBoundingClientRect()

    setLaneActionMenu({
      laneId,
      position: {
        x: triggerRect.left,
        y: triggerRect.bottom + 6,
      },
    })
  }, [])

  const handleLaneAction = useCallback(
    (laneId: string, action: 'up' | 'down' | 'remove') => {
      if (action === 'remove') {
        removeTimelineLane(laneId)
      } else {
        moveTimelineLane(laneId, action)
      }

      closeLaneActionMenu()
    },
    [closeLaneActionMenu, moveTimelineLane, removeTimelineLane],
  )

  const handleMediaAssetDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, laneId: string, allowChangeSoundOnly = false) => {
      const isMediaAudioDrag = event.dataTransfer.types.includes(MEDIA_AUDIO_DRAG_TYPE)
      const isChangeSoundDrag = event.dataTransfer.types.includes(CHANGE_SOUND_DRAG_TYPE)
      if (isMediaAudioDrag && !mediaAudioClip) return
      if (!isMediaAudioDrag && !isChangeSoundDrag) return
      if (allowChangeSoundOnly && (isMediaAudioDrag || !isChangeSoundDrag)) return
      event.preventDefault()
      setMediaAssetDropLaneId(laneId)
    },
    [mediaAudioClip],
  )

  const handleMediaAssetDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, laneId: string, allowChangeSoundOnly = false) => {
      const laneRect = event.currentTarget.getBoundingClientRect()
      const dropX = event.clientX - laneRect.left
      const dropTime = trackPxToTime(Math.max(0, dropX))
      const clipId = event.dataTransfer.getData(MEDIA_AUDIO_DRAG_TYPE)
      const isChangeSoundDrag = event.dataTransfer.types.includes(CHANGE_SOUND_DRAG_TYPE)

      if (clipId && mediaAudioClip && clipId === mediaAudioClip.id && !allowChangeSoundOnly) {
        event.preventDefault()
        addMediaAudioRegion({ startTime: dropTime, laneId })
      } else if (isChangeSoundDrag) {
        event.preventDefault()
        addChangeSoundRegion({ startTime: dropTime, laneId })
      }

      setMediaAssetDropLaneId(null)
    },
    [addChangeSoundRegion, addMediaAudioRegion, mediaAudioClip, trackPxToTime],
  )

  const handleRulerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (duration === 0 || !timelineRef.current) return

      capturePlaybackForScrub()
      setPlaying(false)
      onScrubStateChange?.(true)
      startRulerScrubListeners()
      updateRulerTime(event.clientX)
      setSelectedRegionId(null)
    },
    [
      capturePlaybackForScrub,
      duration,
      onScrubStateChange,
      setPlaying,
      setSelectedRegionId,
      startRulerScrubListeners,
      updateRulerTime,
    ],
  )

  const audioWaveformNodes = audioWaveformTracks.map((track, index) => (
    <div
      key={track.id}
      style={{
        marginBottom:
          index === audioWaveformTracks.length - 1 && waveformInsertAfterLaneIndex >= visibleSortedLanes.length - 1
            ? 0
            : `${LANE_GAP_PX}px`,
      }}
    >
      <AudioWaveformTrack
        audioPath={track.audioPath}
        label={track.label}
        sourceOffsetMs={track.sourceOffsetMs}
        visible={track.visible}
        onVisibilityChange={(visible) => setAudioWaveformVisible(track.id, visible)}
        pixelsPerSecond={pixelsPerSecond}
        timelineStartOffsetPx={timelineStartOffsetPx}
        timelineScrollLeft={timelineScrollLeft}
        viewportWidth={containerWidth}
        duration={duration}
      />
    </div>
  ))

  return (
    <div className="flex flex-col bg-background/50 px-3 pb-3 pt-1 transition-all duration-300 ease-in-out">
      <div
        className="flex flex-row overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        style={{ height: `${timelineViewportHeight}px`, maxHeight: '40vh' }}
      >
        <div
          className="flex shrink-0 flex-col items-center border-r border-border/60 bg-card/95"
          style={{ width: `${LANE_ACTION_STRIP_WIDTH_PX + LANE_ACTION_GUTTER_PX}px` }}
        >
          <SimpleTooltip content="Add new lane">
            <button
              type="button"
              data-lane-control
              aria-label="Add new lane"
              onClick={(e) => {
                e.stopPropagation()
                addTimelineLane()
              }}
              className="mt-2 flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
          </SimpleTooltip>
        </div>
        <div
          ref={containerRef}
          className="timeline-scrollbar stable-scrollbar flex-1 overflow-x-auto overflow-y-auto bg-gradient-to-b from-background/30 to-background/10"
          onScroll={(e) => {
            setTimelineScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft)
          }}
          onWheel={(e) => {
            if (!e.ctrlKey) return
            e.preventDefault()
            const delta = -e.deltaY
            const step = delta > 0 ? TIMELINE.VIEW_ZOOM.STEP : -TIMELINE.VIEW_ZOOM.STEP
            const next = Math.max(
              TIMELINE.VIEW_ZOOM.MIN,
              Math.min(TIMELINE.VIEW_ZOOM.MAX, useEditorStore.getState().timelineZoom + step),
            )
            useEditorStore.getState().setTimelineZoom(next)
          }}
          onMouseDown={(e) => {
            if (
              (e.target as HTMLElement).closest('[data-region-id]') ||
              (e.target as HTMLElement).closest('[data-lane-control]') ||
              (e.target as HTMLElement).closest('[data-take-control]') ||
              (e.target as HTMLElement).closest('[data-playhead]')
            ) {
              return
            }
            setSelectedRegionId(null)
            selectTake(null)
          }}
        >
          <div
            ref={timelineRef}
            className="relative min-w-full overflow-visible"
            style={{
              width: `${timelineStartOffsetPx + timeToPx(trackDuration)}px`,
              height: `${timelineContentHeight}px`,
            }}
          >
            <Ruler
              ticks={rulerTicks}
              timeToPx={timeToTrackPx}
              formatTime={formatTime}
              onMouseDown={handleRulerMouseDown}
              topOffset={0}
            />
            {takeTrackHeight > 0 && (
              <TakeTrack timeToTrackPx={timeToTrackPx} pixelsPerSecond={pixelsPerSecond} topOffset={RULER_HEIGHT_PX} />
            )}

            <div
              ref={lanesContainerRef}
              className="absolute left-0 w-full"
              style={{ top: `${RULER_HEIGHT_PX + takeTrackHeight}px`, height: `${lanesContentHeight}px` }}
            >
              {waveformInsertAfterLaneIndex < 0 && audioWaveformNodes}
              {visibleSortedLanes.map((lane, laneIndex) => {
                const isContentRootLane = !!lane.isContentRootLane
                const isLegacySpecialLane = !!lane.isCutLane || !!lane.isChangeSoundLane
                const isSpecialLane = isContentRootLane || isLegacySpecialLane
                const laneHeightPx = isContentRootLane ? CONTENT_ROOT_LANE_HEIGHT_PX : LANE_HEIGHT_PX
                const laneRegions = regionsByLane.get(lane.id) ?? []
                const laneMovePreviewRegion =
                  movePreviewRegion && movePreviewRegion.laneId === lane.id ? movePreviewRegion : null

                const appendWaveformsAfterLane = laneIndex === waveformInsertAfterLaneIndex

                return (
                  <React.Fragment key={lane.id}>
                    <div
                      ref={(el) => laneRefs.current.set(lane.id, el)}
                      className={cn(
                        'relative overflow-hidden rounded-lg border bg-background/20',
                        !isSpecialLane &&
                          ((activeDropLaneId === lane.id && draggingRegionId) || mediaAssetDropLaneId === lane.id
                            ? 'border-primary/70 bg-primary/10'
                            : 'border-border/40'),
                        isContentRootLane && 'border-border/40 bg-muted dark:bg-white/10',
                        isLegacySpecialLane && !isContentRootLane && 'border-border/40',
                      )}
                      style={{
                        height: `${laneHeightPx}px`,
                        marginBottom:
                          laneIndex === visibleSortedLanes.length - 1 && !appendWaveformsAfterLane
                            ? 0
                            : `${LANE_GAP_PX}px`,
                      }}
                      onDragOver={
                        isSpecialLane
                          ? (event) => handleMediaAssetDragOver(event, lane.id, true)
                          : (event) => handleMediaAssetDragOver(event, lane.id)
                      }
                      onDragLeave={
                        isSpecialLane
                          ? undefined
                          : () => {
                              if (mediaAssetDropLaneId === lane.id) {
                                setMediaAssetDropLaneId(null)
                              }
                            }
                      }
                      onDrop={
                        isSpecialLane
                          ? (event) => handleMediaAssetDrop(event, lane.id, true)
                          : (event) => handleMediaAssetDrop(event, lane.id)
                      }
                    >
                      {showLaneActionButtons && !isSpecialLane && (
                        <div
                          className="pointer-events-none absolute top-0 z-[130] h-full border-r border-border/60 bg-gradient-to-r from-card/95 to-card/65"
                          style={{
                            left: 0,
                            width: `${LANE_ACTION_STRIP_WIDTH_PX}px`,
                            transform: `translateX(${timelineScrollLeft}px)`,
                          }}
                        >
                          <button
                            type="button"
                            data-lane-control
                            aria-label={`Open actions menu for ${lane.name}`}
                            onClick={(e) => openLaneActionMenu(e, lane.id)}
                            className="pointer-events-auto absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-border/60 bg-card/90 text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
                          >
                            <DotsVertical className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      <div
                        className={cn(
                          'absolute top-1 z-0 rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70',
                          'left-[34px]',
                        )}
                      >
                        {lane.name}
                      </div>

                      {laneRegions.map((region) => {
                        const isSelected = selectedRegionId === region.id
                        const zIndex = region.type === 'cut' ? 200 : isSelected ? 100 : (region.zIndex ?? 1)

                        const regionStyle: React.CSSProperties = {
                          left: `${timeToTrackPx(region.startTime)}px`,
                          width: `${timeToPx(region.duration)}px`,
                          zIndex,
                          opacity: movePreviewRegion && region.id === movePreviewRegion.id ? 0.18 : 1,
                        }
                        const onMouseDown = handleRegionMouseDown

                        if (region.type === 'zoom') {
                          return (
                            <div key={region.id} className="absolute inset-y-0" style={regionStyle}>
                              <ZoomRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'cut') {
                          return (
                            <div key={region.id} className="absolute inset-y-0" style={regionStyle}>
                              <CutRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isDraggable={region.id !== previewCutRegion?.id}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'speed') {
                          return (
                            <div key={region.id} className="absolute h-12 top-1/2 -translate-y-1/2" style={regionStyle}>
                              <SpeedRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'blur') {
                          return (
                            <div key={region.id} className="absolute h-12 top-1/2 -translate-y-1/2" style={regionStyle}>
                              <BlurRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'swap') {
                          return (
                            <div key={region.id} className="absolute h-12 top-1/2 -translate-y-1/2" style={regionStyle}>
                              <SwapRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'media-audio') {
                          return (
                            <div key={region.id} className="absolute h-12 top-1/2 -translate-y-1/2" style={regionStyle}>
                              <MediaAudioRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'change-sound') {
                          return (
                            <div key={region.id} className="absolute inset-y-0" style={regionStyle}>
                              <ChangeSoundRegionBlock
                                region={region}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        if (region.type === 'floating-monitor') {
                          return (
                            <div key={region.id} className="absolute h-12 top-1/2 -translate-y-1/2" style={regionStyle}>
                              <FloatingMonitorRegionBlock
                                region={region}
                                name={floatingMonitors[region.monitorId]?.name || 'Floating monitor'}
                                isSelected={isSelected}
                                isBeingDragged={draggingRegionId === region.id}
                                onMouseDown={onMouseDown}
                                setRef={(el) => regionRefs.current.set(region.id, el)}
                              />
                            </div>
                          )
                        }

                        return null
                      })}

                      {laneMovePreviewRegion &&
                        (() => {
                          const previewStyle: React.CSSProperties = {
                            left: `${timeToTrackPx(laneMovePreviewRegion.startTime)}px`,
                            width: `${timeToPx(laneMovePreviewRegion.duration)}px`,
                            zIndex: 180,
                            opacity: 0.96,
                            pointerEvents: 'none',
                          }

                          if (laneMovePreviewRegion.type === 'zoom') {
                            return (
                              <div className="absolute inset-y-0" style={previewStyle}>
                                <ZoomRegionBlock
                                  region={laneMovePreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'cut') {
                            return (
                              <div className="absolute inset-y-0" style={previewStyle}>
                                <CutRegionBlock
                                  region={laneMovePreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isDraggable={false}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'speed') {
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <SpeedRegionBlock
                                  region={laneMovePreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'blur') {
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <BlurRegionBlock
                                  region={laneMovePreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'swap') {
                            const swapPreviewRegion = laneMovePreviewRegion as Extract<TimelineRegion, { type: 'swap' }>
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <SwapRegionBlock
                                  region={swapPreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'media-audio') {
                            const mediaAudioPreviewRegion = laneMovePreviewRegion as Extract<
                              TimelineRegion,
                              { type: 'media-audio' }
                            >
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <MediaAudioRegionBlock
                                  region={mediaAudioPreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'change-sound') {
                            const changeSoundPreviewRegion = laneMovePreviewRegion as Extract<
                              TimelineRegion,
                              { type: 'change-sound' }
                            >
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <ChangeSoundRegionBlock
                                  region={changeSoundPreviewRegion}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          if (laneMovePreviewRegion.type === 'floating-monitor') {
                            return (
                              <div className="absolute h-12 top-1/2 -translate-y-1/2" style={previewStyle}>
                                <FloatingMonitorRegionBlock
                                  region={laneMovePreviewRegion}
                                  name={floatingMonitors[laneMovePreviewRegion.monitorId]?.name || 'Floating monitor'}
                                  isSelected={selectedRegionId === laneMovePreviewRegion.id}
                                  isBeingDragged
                                  onMouseDown={noopRegionMouseDown}
                                  setRef={noopSetRegionRef}
                                />
                              </div>
                            )
                          }

                          return null
                        })()}
                    </div>
                    {appendWaveformsAfterLane && audioWaveformNodes}
                  </React.Fragment>
                )
              })}
            </div>

            <TimelinePlayhead
              duration={duration}
              timeToTrackPx={timeToTrackPx}
              videoRef={videoRef}
              timelineRef={timelineRef}
              isDragging={isDraggingPlayhead}
              onMouseDown={handlePlayheadMouseDown}
            />
          </div>

          <ContextMenu
            isOpen={Boolean(laneActionMenu)}
            onClose={closeLaneActionMenu}
            position={laneActionMenu?.position ?? { x: 0, y: 0 }}
            className="min-w-[184px] rounded-xl border border-border/70 bg-card/95 shadow-2xl ring-1 ring-border/40"
          >
            <ContextMenuItem
              disabled={!laneActionCanMoveUp}
              className="text-foreground hover:bg-accent/70 hover:text-foreground active:bg-accent/90"
              onClick={() => laneActionMenu && handleLaneAction(laneActionMenu.laneId, 'up')}
            >
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
              <span>Move up</span>
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!laneActionCanMoveDown}
              className="text-foreground hover:bg-accent/70 hover:text-foreground active:bg-accent/90"
              onClick={() => laneActionMenu && handleLaneAction(laneActionMenu.laneId, 'down')}
            >
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
              <span>Move down</span>
            </ContextMenuItem>

            <div className="my-1 border-t border-border/70" />

            <ContextMenuItem
              className="text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20"
              onClick={() => laneActionMenu && handleLaneAction(laneActionMenu.laneId, 'remove')}
            >
              <Trash className="h-4 w-4" />
              <span>Remove lane</span>
            </ContextMenuItem>
          </ContextMenu>
        </div>
      </div>
    </div>
  )
}
