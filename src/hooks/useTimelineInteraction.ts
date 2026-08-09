import { useState, useEffect, useCallback, useRef, RefObject, MouseEvent as ReactMouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../store/editorStore'
import { TimelineRegion, CutRegion } from '../types'
import { TIMELINE } from '../lib/constants'

interface UseTimelineInteractionProps {
  timelineRef: RefObject<HTMLDivElement>
  regionRefs: RefObject<Map<string, HTMLDivElement | null>>
  pxToTime: (px: number) => number
  timeToPx: (time: number) => number
  updateVideoTime: (time: number) => void
  duration: number
  defaultLaneId: string
  resolveLaneIdFromClientY: (clientY: number) => string | null
  timelineStartOffsetPx: number
  onScrubStateChange?: (isScrubbing: boolean) => void
  onScrubStart?: () => void
  onScrubEnd?: () => void
}

type DragMovePreview = {
  regionId: string
  laneId: string
  sourceLaneId: string
  startTime: number
  duration: number
}

type DraggingRegionState = {
  id: string
  regionType: TimelineRegion['type']
  type: 'move' | 'resize-left' | 'resize-right'
  initialX: number
  initialStartTime: number
  initialDuration: number
  initialSourceStart: number | null
  initialLaneId: string
  isCut: boolean
}

/**
 * Custom hook to manage complex timeline interactions like dragging the playhead,
 * moving/resizing regions, and handling trim areas.
 * This encapsulates all mouse event listeners and dragging logic.
 */
export const useTimelineInteraction = ({
  timelineRef,
  regionRefs,
  pxToTime,
  timeToPx,
  updateVideoTime,
  duration,
  defaultLaneId,
  resolveLaneIdFromClientY,
  timelineStartOffsetPx,
  onScrubStateChange,
  onScrubStart,
  onScrubEnd,
}: UseTimelineInteractionProps) => {
  const {
    addCutRegion,
    deleteRegion,
    setPreviewCutRegion,
    updateRegion,
    setCurrentTime,
    setPlaying,
    setSelectedRegionId,
  } = useEditorStore(
    useShallow((state) => ({
      addCutRegion: state.addCutRegion,
      deleteRegion: state.deleteRegion,
      setPreviewCutRegion: state.setPreviewCutRegion,
      updateRegion: state.updateRegion,
      setCurrentTime: state.setCurrentTime,
      setPlaying: state.setPlaying,
      setSelectedRegionId: state.setSelectedRegionId,
    })),
  )
  const draggedLaneIdRef = useRef<string | null>(null)
  const playheadAnimationFrameRef = useRef<number | null>(null)
  const pendingPlayheadTimeRef = useRef<number | null>(null)
  const isPlayheadScrubbingRef = useRef(false)
  const cleanupPlayheadScrubListenersRef = useRef<(() => void) | null>(null)

  const [draggingRegion, setDraggingRegion] = useState<DraggingRegionState | null>(null)
  const [activeDropLaneId, setActiveDropLaneId] = useState<string | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [isRegionHidden, setIsRegionHidden] = useState(false)
  const [dragMovePreview, setDragMovePreview] = useState<DragMovePreview | null>(null)

  const handleRegionMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, region: TimelineRegion, type: 'move' | 'resize-left' | 'resize-right') => {
      e.stopPropagation()
      setIsRegionHidden(false)
      setSelectedRegionId(region.id)

      const isTrimRegion = (region as CutRegion).trimType !== undefined
      if (isTrimRegion && type === 'move') {
        return
      }

      document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize'
      const initialLaneId = region.laneId || defaultLaneId
      draggedLaneIdRef.current = initialLaneId
      setActiveDropLaneId(type === 'move' ? initialLaneId : null)
      setDraggingRegion({
        id: region.id,
        regionType: region.type,
        type,
        initialX: e.clientX,
        initialStartTime: region.startTime,
        initialDuration: region.duration,
        initialSourceStart:
          region.type === 'media-audio' ||
          (region.type === 'floating-monitor' &&
            useEditorStore.getState().floatingMonitors[region.monitorId]?.kind !== 'image')
            ? region.sourceStart
            : null,
        initialLaneId,
        isCut: region.type === 'cut',
      })
      setDragMovePreview(null)
    },
    [setSelectedRegionId, defaultLaneId],
  )

  const queuePlayheadTime = useCallback(
    (time: number) => {
      pendingPlayheadTimeRef.current = time
      if (playheadAnimationFrameRef.current !== null) return

      playheadAnimationFrameRef.current = window.requestAnimationFrame(() => {
        playheadAnimationFrameRef.current = null
        const pendingTime = pendingPlayheadTimeRef.current
        pendingPlayheadTimeRef.current = null
        if (pendingTime !== null) updateVideoTime(pendingTime)
      })
    },
    [updateVideoTime],
  )

  const flushPlayheadTime = useCallback(
    (time: number) => {
      if (playheadAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playheadAnimationFrameRef.current)
        playheadAnimationFrameRef.current = null
      }
      pendingPlayheadTimeRef.current = null
      updateVideoTime(time)
    },
    [updateVideoTime],
  )

  const finishPlayheadScrub = useCallback(
    (clientX: number) => {
      if (!isPlayheadScrubbingRef.current) return

      isPlayheadScrubbingRef.current = false
      cleanupPlayheadScrubListenersRef.current?.()
      cleanupPlayheadScrubListenersRef.current = null
      document.body.style.cursor = 'default'

      const rect = timelineRef.current?.getBoundingClientRect()
      const finalTime = rect ? pxToTime(Math.max(0, clientX - rect.left - timelineStartOffsetPx)) : null
      onScrubEnd?.()
      if (finalTime !== null) flushPlayheadTime(finalTime)
      setIsDraggingPlayhead(false)
    },
    [flushPlayheadTime, onScrubEnd, pxToTime, timelineRef, timelineStartOffsetPx],
  )

  const startPlayheadScrubListeners = useCallback(() => {
    cleanupPlayheadScrubListenersRef.current?.()
    isPlayheadScrubbingRef.current = true

    const handleMouseMove = (event: MouseEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect()
      if (!rect) return
      queuePlayheadTime(pxToTime(Math.max(0, event.clientX - rect.left - timelineStartOffsetPx)))
    }
    const handleMouseUp = (event: MouseEvent) => {
      finishPlayheadScrub(event.clientX)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      if (cleanupPlayheadScrubListenersRef.current === cleanup) {
        cleanupPlayheadScrubListenersRef.current = null
      }
    }

    cleanupPlayheadScrubListenersRef.current = cleanup
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [finishPlayheadScrub, pxToTime, queuePlayheadTime, timelineRef, timelineStartOffsetPx])

  const handlePlayheadMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation()
      onScrubStart?.()
      setPlaying(false)
      onScrubStateChange?.(true)
      startPlayheadScrubListeners()
      setIsDraggingPlayhead(true)
      document.body.style.cursor = 'ew-resize'
    },
    [onScrubStart, onScrubStateChange, setPlaying, startPlayheadScrubListeners],
  )

  useEffect(() => {
    return () => {
      if (playheadAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(playheadAnimationFrameRef.current)
      }
      cleanupPlayheadScrubListenersRef.current?.()
      isPlayheadScrubbingRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRegion) {
        const element = regionRefs.current?.get(draggingRegion.id)
        if (!element) return
        const deltaTime = pxToTime(e.clientX - draggingRegion.initialX)

        const calcMovedRegion = (dragRegion: DraggingRegionState, dTime: number, clientY: number | null) => {
          const maxStartTime = duration - dragRegion.initialDuration
          const intendedStartTime = dragRegion.initialStartTime + dTime
          let targetLaneId =
            clientY !== null
              ? resolveLaneIdFromClientY(clientY) || dragRegion.initialLaneId
              : draggedLaneIdRef.current || dragRegion.initialLaneId
          let newStartTime = Math.max(0, Math.min(intendedStartTime, maxStartTime))

          if (!dragRegion.isCut) {
            const state = useEditorStore.getState()
            const getObstacles = (lane: string) =>
              [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions),
                ...Object.values(state.swapRegions),
                ...Object.values(state.mediaAudioRegions),
                ...Object.values(state.changeSoundRegions),
              ].filter((r) => r.id !== dragRegion.id && r.laneId === lane)

            const findValid = (lane: string) => {
              const obs = getObstacles(lane).sort((a, b) => a.startTime - b.startTime)
              const gaps: { start: number; end: number }[] = []
              let lastEnd = 0
              for (const o of obs) {
                if (o.startTime > lastEnd + 0.001) gaps.push({ start: lastEnd, end: o.startTime })
                lastEnd = Math.max(lastEnd, o.startTime + o.duration)
              }
              if (duration > lastEnd + 0.001) gaps.push({ start: lastEnd, end: duration })

              const validGaps = gaps.filter((g) => g.end - g.start >= dragRegion.initialDuration - 0.001)
              if (!validGaps.length) return null

              let best = intendedStartTime
              let minDist = Infinity
              for (const g of validGaps) {
                const c = Math.max(g.start, Math.min(intendedStartTime, g.end - dragRegion.initialDuration))
                const d = Math.abs(c - intendedStartTime)
                if (d < minDist) {
                  minDist = d
                  best = c
                }
              }
              return best
            }

            let validMove = findValid(targetLaneId)
            if (validMove === null) {
              targetLaneId = dragRegion.initialLaneId
              validMove = findValid(targetLaneId)
            }
            if (validMove !== null) {
              newStartTime = validMove
            } else {
              newStartTime = dragRegion.initialStartTime
            }
          }
          return { newStartTime, targetLaneId }
        }

        const calcResizeRight = (dragRegion: DraggingRegionState, dTime: number) => {
          const state = useEditorStore.getState()
          let maxDuration = duration - dragRegion.initialStartTime
          if (!dragRegion.isCut) {
            const obstacles = [
              ...Object.values(state.zoomRegions),
              ...Object.values(state.speedRegions),
              ...Object.values(state.blurRegions),
              ...Object.values(state.swapRegions),
              ...Object.values(state.mediaAudioRegions),
              ...Object.values(state.changeSoundRegions),
            ].filter(
              (r) =>
                r.id !== dragRegion.id &&
                r.laneId === dragRegion.initialLaneId &&
                r.startTime >= dragRegion.initialStartTime + dragRegion.initialDuration - 0.001,
            )
            if (obstacles.length > 0) {
              const nextObs = obstacles.reduce((min, o) => (o.startTime < min.startTime ? o : min), obstacles[0])
              maxDuration = Math.min(maxDuration, nextObs.startTime - dragRegion.initialStartTime)
            }
          }
          if (dragRegion.regionType === 'media-audio') {
            const sourceClipDuration = state.mediaAudioClip?.duration || 0
            if (sourceClipDuration > 0 && dragRegion.initialSourceStart !== null) {
              maxDuration = Math.min(
                maxDuration,
                Math.max(TIMELINE.MINIMUM_REGION_DURATION, sourceClipDuration - dragRegion.initialSourceStart),
              )
            }
          }
          const intendedDuration = dragRegion.initialDuration + dTime
          return { intendedDuration, maxDuration }
        }

        const calcResizeLeft = (dragRegion: DraggingRegionState, dTime: number) => {
          const initialEndTime = dragRegion.initialStartTime + dragRegion.initialDuration
          let minStartTime = 0
          if (!dragRegion.isCut) {
            const state = useEditorStore.getState()
            const obstacles = [
              ...Object.values(state.zoomRegions),
              ...Object.values(state.speedRegions),
              ...Object.values(state.blurRegions),
              ...Object.values(state.swapRegions),
              ...Object.values(state.mediaAudioRegions),
              ...Object.values(state.changeSoundRegions),
            ].filter(
              (r) =>
                r.id !== dragRegion.id &&
                r.laneId === dragRegion.initialLaneId &&
                r.startTime + r.duration <= dragRegion.initialStartTime + 0.001,
            )
            if (obstacles.length > 0) {
              const prevObs = obstacles.reduce(
                (max, o) => (o.startTime + o.duration > max.startTime + max.duration ? o : max),
                obstacles[0],
              )
              minStartTime = prevObs.startTime + prevObs.duration
            }
          }
          if (dragRegion.regionType === 'media-audio' && dragRegion.initialSourceStart !== null) {
            const sourceBoundStart = dragRegion.initialStartTime - dragRegion.initialSourceStart
            minStartTime = Math.max(minStartTime, sourceBoundStart)
          }
          const tentativeStartTime = Math.max(
            minStartTime,
            Math.min(dragRegion.initialStartTime + dTime, initialEndTime),
          )
          const newDuration = initialEndTime - tentativeStartTime
          return { newStartTime: tentativeStartTime, newDuration }
        }

        if (draggingRegion.type === 'move') {
          const { newStartTime, targetLaneId } = calcMovedRegion(draggingRegion, deltaTime, e.clientY)

          if (draggedLaneIdRef.current !== targetLaneId) {
            draggedLaneIdRef.current = targetLaneId
            setActiveDropLaneId(targetLaneId)
          }

          if (targetLaneId !== draggingRegion.initialLaneId) {
            const nextPreview: DragMovePreview = {
              regionId: draggingRegion.id,
              laneId: targetLaneId,
              sourceLaneId: draggingRegion.initialLaneId,
              startTime: newStartTime,
              duration: draggingRegion.initialDuration,
            }
            setDragMovePreview((previous) => {
              if (
                previous &&
                previous.regionId === nextPreview.regionId &&
                previous.laneId === nextPreview.laneId &&
                previous.sourceLaneId === nextPreview.sourceLaneId &&
                Math.abs(previous.startTime - nextPreview.startTime) < 0.0001 &&
                Math.abs(previous.duration - nextPreview.duration) < 0.0001
              ) {
                return previous
              }
              return nextPreview
            })
            element.style.transform = 'translateX(0px)'
          } else {
            setDragMovePreview((previous) => (previous ? null : previous))
            element.style.transform = `translateX(${timeToPx(newStartTime - draggingRegion.initialStartTime)}px)`
          }
        } else if (draggingRegion.type === 'resize-right') {
          const { intendedDuration, maxDuration } = calcResizeRight(draggingRegion, deltaTime)
          if (intendedDuration < TIMELINE.REGION_DELETE_THRESHOLD) {
            element.style.display = 'none'
            setIsRegionHidden(true)
          } else {
            const newDuration = Math.min(intendedDuration, maxDuration)
            element.style.display = 'block'
            setIsRegionHidden(false)
            element.style.width = `${timeToPx(newDuration)}px`
          }
        } else if (draggingRegion.type === 'resize-left') {
          const { newStartTime, newDuration } = calcResizeLeft(draggingRegion, deltaTime)
          if (newDuration < TIMELINE.REGION_DELETE_THRESHOLD) {
            element.style.display = 'none'
            setIsRegionHidden(true)
          } else {
            element.style.display = 'block'
            setIsRegionHidden(false)
            element.style.width = `${timeToPx(newDuration)}px`
            element.style.transform = `translateX(${timeToPx(newStartTime - draggingRegion.initialStartTime)}px)`
          }
        }
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      document.body.style.cursor = 'default'
      if (isPlayheadScrubbingRef.current) {
        finishPlayheadScrub(e.clientX)
      } else if (isDraggingPlayhead) {
        setIsDraggingPlayhead(false)
      }

      if (draggingRegion) {
        const element = regionRefs.current?.get(draggingRegion.id)
        if (element) {
          element.style.transform = 'translateX(0px)'
          element.style.width = ''
          element.style.display = 'block'
          element.style.opacity = ''
        }
        if (isRegionHidden) {
          deleteRegion(draggingRegion.id)
        } else {
          const deltaTime = pxToTime(e.clientX - draggingRegion.initialX)
          const finalUpdates: Partial<TimelineRegion> & { sourceStart?: number } = {}

          const calcMovedRegion = (dragRegion: DraggingRegionState, dTime: number, clientY: number | null) => {
            const maxStartTime = duration - dragRegion.initialDuration
            const intendedStartTime = dragRegion.initialStartTime + dTime
            let targetLaneId =
              clientY !== null
                ? resolveLaneIdFromClientY(clientY) || dragRegion.initialLaneId
                : draggedLaneIdRef.current || dragRegion.initialLaneId
            let newStartTime = Math.max(0, Math.min(intendedStartTime, maxStartTime))

            if (!dragRegion.isCut) {
              const state = useEditorStore.getState()
              const getObstacles = (lane: string) =>
                [
                  ...Object.values(state.zoomRegions),
                  ...Object.values(state.speedRegions),
                  ...Object.values(state.blurRegions),
                  ...Object.values(state.swapRegions),
                  ...Object.values(state.mediaAudioRegions),
                  ...Object.values(state.changeSoundRegions),
                ].filter((r) => r.id !== dragRegion.id && r.laneId === lane)

              const findValid = (lane: string) => {
                const obs = getObstacles(lane).sort((a, b) => a.startTime - b.startTime)
                const gaps: { start: number; end: number }[] = []
                let lastEnd = 0
                for (const o of obs) {
                  if (o.startTime > lastEnd + 0.001) gaps.push({ start: lastEnd, end: o.startTime })
                  lastEnd = Math.max(lastEnd, o.startTime + o.duration)
                }
                if (duration > lastEnd + 0.001) gaps.push({ start: lastEnd, end: duration })

                const validGaps = gaps.filter((g) => g.end - g.start >= dragRegion.initialDuration - 0.001)
                if (!validGaps.length) return null

                let best = intendedStartTime
                let minDist = Infinity
                for (const g of validGaps) {
                  const c = Math.max(g.start, Math.min(intendedStartTime, g.end - dragRegion.initialDuration))
                  const d = Math.abs(c - intendedStartTime)
                  if (d < minDist) {
                    minDist = d
                    best = c
                  }
                }
                return best
              }

              let validMove = findValid(targetLaneId)
              if (validMove === null) {
                targetLaneId = dragRegion.initialLaneId
                validMove = findValid(targetLaneId)
              }
              if (validMove !== null) {
                newStartTime = validMove
              } else {
                newStartTime = dragRegion.initialStartTime
              }
            }
            return { newStartTime, targetLaneId }
          }

          const calcResizeRight = (dragRegion: DraggingRegionState, dTime: number) => {
            const state = useEditorStore.getState()
            let maxDuration = duration - dragRegion.initialStartTime
            if (!dragRegion.isCut) {
              const obstacles = [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions),
                ...Object.values(state.swapRegions),
                ...Object.values(state.mediaAudioRegions),
                ...Object.values(state.changeSoundRegions),
              ].filter(
                (r) =>
                  r.id !== dragRegion.id &&
                  r.laneId === dragRegion.initialLaneId &&
                  r.startTime >= dragRegion.initialStartTime + dragRegion.initialDuration - 0.001,
              )
              if (obstacles.length > 0) {
                const nextObs = obstacles.reduce((min, o) => (o.startTime < min.startTime ? o : min), obstacles[0])
                maxDuration = Math.min(maxDuration, nextObs.startTime - dragRegion.initialStartTime)
              }
            }
            if (dragRegion.regionType === 'media-audio') {
              const sourceClipDuration = state.mediaAudioClip?.duration || 0
              if (sourceClipDuration > 0 && dragRegion.initialSourceStart !== null) {
                maxDuration = Math.min(
                  maxDuration,
                  Math.max(TIMELINE.MINIMUM_REGION_DURATION, sourceClipDuration - dragRegion.initialSourceStart),
                )
              }
            }
            if (dragRegion.regionType === 'floating-monitor' && dragRegion.initialSourceStart !== null) {
              const monitor = state.floatingMonitors[state.floatingMonitorRegions[dragRegion.id]?.monitorId]
              if (monitor?.kind !== 'image' && monitor?.duration) {
                maxDuration = Math.min(
                  maxDuration,
                  Math.max(TIMELINE.MINIMUM_REGION_DURATION, monitor.duration - dragRegion.initialSourceStart),
                )
              }
            }
            const intendedDuration = dragRegion.initialDuration + dTime
            return { intendedDuration, maxDuration }
          }

          const calcResizeLeft = (dragRegion: DraggingRegionState, dTime: number) => {
            const initialEndTime = dragRegion.initialStartTime + dragRegion.initialDuration
            let minStartTime = 0
            if (!dragRegion.isCut) {
              const state = useEditorStore.getState()
              const obstacles = [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions),
                ...Object.values(state.swapRegions),
                ...Object.values(state.mediaAudioRegions),
                ...Object.values(state.changeSoundRegions),
              ].filter(
                (r) =>
                  r.id !== dragRegion.id &&
                  r.laneId === dragRegion.initialLaneId &&
                  r.startTime + r.duration <= dragRegion.initialStartTime + 0.001,
              )
              if (obstacles.length > 0) {
                const prevObs = obstacles.reduce(
                  (max, o) => (o.startTime + o.duration > max.startTime + max.duration ? o : max),
                  obstacles[0],
                )
                minStartTime = prevObs.startTime + prevObs.duration
              }
            }
            if (
              (dragRegion.regionType === 'media-audio' || dragRegion.regionType === 'floating-monitor') &&
              dragRegion.initialSourceStart !== null
            ) {
              const sourceBoundStart = dragRegion.initialStartTime - dragRegion.initialSourceStart
              minStartTime = Math.max(minStartTime, sourceBoundStart)
            }
            const tentativeStartTime = Math.max(
              minStartTime,
              Math.min(dragRegion.initialStartTime + dTime, initialEndTime),
            )
            const newDuration = initialEndTime - tentativeStartTime
            return { newStartTime: tentativeStartTime, newDuration }
          }

          if (draggingRegion.type === 'move') {
            const { newStartTime, targetLaneId } = calcMovedRegion(draggingRegion, deltaTime, null)
            finalUpdates.startTime = newStartTime
            if (targetLaneId !== draggingRegion.initialLaneId) {
              finalUpdates.laneId = targetLaneId
            }
          } else if (draggingRegion.type === 'resize-right') {
            finalUpdates.startTime = draggingRegion.initialStartTime
            const { intendedDuration, maxDuration } = calcResizeRight(draggingRegion, deltaTime)
            finalUpdates.duration = Math.max(TIMELINE.MINIMUM_REGION_DURATION, Math.min(intendedDuration, maxDuration))
          } else {
            const initialEndTime = draggingRegion.initialStartTime + draggingRegion.initialDuration
            let { newStartTime, newDuration } = calcResizeLeft(draggingRegion, deltaTime)

            if (newDuration < TIMELINE.MINIMUM_REGION_DURATION) {
              newDuration = TIMELINE.MINIMUM_REGION_DURATION
              newStartTime = Math.min(newStartTime, initialEndTime - TIMELINE.MINIMUM_REGION_DURATION)
            }
            finalUpdates.duration = newDuration
            finalUpdates.startTime = newStartTime
            if (
              (draggingRegion.regionType === 'media-audio' || draggingRegion.regionType === 'floating-monitor') &&
              draggingRegion.initialSourceStart !== null
            ) {
              const sourceDelta = newStartTime - draggingRegion.initialStartTime
              finalUpdates.sourceStart = Math.max(0, draggingRegion.initialSourceStart + sourceDelta)
            }
          }

          if (draggingRegion.type !== 'move' && finalUpdates.duration! < TIMELINE.REGION_DELETE_THRESHOLD) {
            deleteRegion(draggingRegion.id)
          } else {
            updateRegion(draggingRegion.id, finalUpdates)
          }
        }
        setCurrentTime(useEditorStore.getState().currentTime)
        draggedLaneIdRef.current = null
        setActiveDropLaneId(null)
        setDragMovePreview(null)
        setDraggingRegion(null)
        setIsRegionHidden(false)
      }

      setActiveDropLaneId(null)
      setDragMovePreview(null)
      setPreviewCutRegion(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    draggingRegion,
    isDraggingPlayhead,
    pxToTime,
    timeToPx,
    updateVideoTime,
    flushPlayheadTime,
    finishPlayheadScrub,
    updateRegion,
    addCutRegion,
    setPreviewCutRegion,
    deleteRegion,
    setCurrentTime,
    duration,
    regionRefs,
    timelineRef,
    isRegionHidden,
    defaultLaneId,
    resolveLaneIdFromClientY,
    timelineStartOffsetPx,
  ])

  return {
    draggingRegionId: draggingRegion?.id ?? null,
    dragMovePreview,
    activeDropLaneId,
    isDraggingPlayhead,
    handleRegionMouseDown,
    handlePlayheadMouseDown,
  }
}
