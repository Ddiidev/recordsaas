import { useState, useEffect, useCallback, useRef, RefObject, MouseEvent as ReactMouseEvent } from 'react'
import { useEditorStore } from '../store/editorStore'
import { TimelineRegion, CutRegion } from '../types'
import { TIMELINE } from '../lib/constants'
import { getTopRegionByPredicate } from '../lib/timeline-lanes'

interface UseTimelineInteractionProps {
  timelineRef: RefObject<HTMLDivElement>
  regionRefs: RefObject<Map<string, HTMLDivElement | null>>
  pxToTime: (px: number) => number
  timeToPx: (time: number) => number
  updateVideoTime: (time: number) => void
  duration: number
  defaultLaneId: string
  resolveLaneIdFromClientY: (clientY: number) => string | null
}

type DragMovePreview = {
  regionId: string
  laneId: string
  sourceLaneId: string
  startTime: number
  duration: number
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
}: UseTimelineInteractionProps) => {
  const { addCutRegion, deleteRegion, setPreviewCutRegion, updateRegion, setCurrentTime, setSelectedRegionId } =
    useEditorStore()
  const draggedLaneIdRef = useRef<string | null>(null)

  const [draggingRegion, setDraggingRegion] = useState<{
    id: string
    type: 'move' | 'resize-left' | 'resize-right'
    initialX: number
    initialStartTime: number
    initialDuration: number
    initialLaneId: string
    isCut: boolean
  } | null>(null)
  const [activeDropLaneId, setActiveDropLaneId] = useState<string | null>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
  const [isDraggingLeftStrip, setIsDraggingLeftStrip] = useState(false)
  const [isDraggingRightStrip, setIsDraggingRightStrip] = useState(false)
  const [isRegionHidden, setIsRegionHidden] = useState(false)
  const [dragMovePreview, setDragMovePreview] = useState<DragMovePreview | null>(null)

  const handleRegionMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, region: TimelineRegion, type: 'move' | 'resize-left' | 'resize-right') => {
      e.stopPropagation()
      setIsRegionHidden(false)
      setSelectedRegionId(region.id)

      if (type === 'resize-left') {
        updateVideoTime(region.startTime)
      } else if (type === 'resize-right') {
        updateVideoTime(region.startTime + region.duration)
      }

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
        type,
        initialX: e.clientX,
        initialStartTime: region.startTime,
        initialDuration: region.duration,
        initialLaneId,
        isCut: region.type === 'cut',
      })
      setDragMovePreview(null)
    },
    [setSelectedRegionId, updateVideoTime, defaultLaneId],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingPlayhead && timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect()
        updateVideoTime(pxToTime(e.clientX - rect.left))
        return
      }

      if (draggingRegion) {
        const element = regionRefs.current?.get(draggingRegion.id)
        if (!element) return
        const deltaTime = pxToTime(e.clientX - draggingRegion.initialX)

        const calcMovedRegion = (dragRegion: any, dTime: number, clientY: number | null) => {
          const maxStartTime = duration - dragRegion.initialDuration
          const intendedStartTime = dragRegion.initialStartTime + dTime
          let targetLaneId = clientY !== null ? (resolveLaneIdFromClientY(clientY) || dragRegion.initialLaneId) : (draggedLaneIdRef.current || dragRegion.initialLaneId)
          let newStartTime = Math.max(0, Math.min(intendedStartTime, maxStartTime))

          if (!dragRegion.isCut) {
            const state = useEditorStore.getState()
            const getObstacles = (lane: string) => [
              ...Object.values(state.zoomRegions),
              ...Object.values(state.speedRegions),
              ...Object.values(state.blurRegions)
            ].filter(r => r.id !== dragRegion.id && r.laneId === lane)
            
            const findValid = (lane: string) => {
              const obs = getObstacles(lane).sort((a, b) => a.startTime - b.startTime)
              const gaps: {start: number, end: number}[] = []
              let lastEnd = 0
              for (const o of obs) {
                if (o.startTime > lastEnd + 0.001) gaps.push({start: lastEnd, end: o.startTime})
                lastEnd = Math.max(lastEnd, o.startTime + o.duration)
              }
              if (duration > lastEnd + 0.001) gaps.push({start: lastEnd, end: duration})
              
              const validGaps = gaps.filter(g => g.end - g.start >= dragRegion.initialDuration - 0.001)
              if (!validGaps.length) return null
              
              let best = intendedStartTime
              let minDist = Infinity
              for (const g of validGaps) {
                const c = Math.max(g.start, Math.min(intendedStartTime, g.end - dragRegion.initialDuration))
                const d = Math.abs(c - intendedStartTime)
                if (d < minDist) { minDist = d; best = c }
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

        const calcResizeRight = (dragRegion: any, dTime: number) => {
          let maxDuration = duration - dragRegion.initialStartTime
          if (!dragRegion.isCut) {
            const state = useEditorStore.getState()
            const obstacles = [
              ...Object.values(state.zoomRegions),
              ...Object.values(state.speedRegions),
              ...Object.values(state.blurRegions)
            ].filter(r => r.id !== dragRegion.id && r.laneId === dragRegion.initialLaneId && r.startTime >= dragRegion.initialStartTime + dragRegion.initialDuration - 0.001)
            if (obstacles.length > 0) {
              const nextObs = obstacles.reduce((min, o) => o.startTime < min.startTime ? o : min, obstacles[0])
              maxDuration = Math.min(maxDuration, nextObs.startTime - dragRegion.initialStartTime)
            }
          }
          const intendedDuration = dragRegion.initialDuration + dTime
          return { intendedDuration, maxDuration }
        }

        const calcResizeLeft = (dragRegion: any, dTime: number) => {
          const initialEndTime = dragRegion.initialStartTime + dragRegion.initialDuration
          let minStartTime = 0
          if (!dragRegion.isCut) {
            const state = useEditorStore.getState()
            const obstacles = [
              ...Object.values(state.zoomRegions),
              ...Object.values(state.speedRegions),
              ...Object.values(state.blurRegions)
            ].filter(r => r.id !== dragRegion.id && r.laneId === dragRegion.initialLaneId && r.startTime + r.duration <= dragRegion.initialStartTime + 0.001)
            if (obstacles.length > 0) {
              const prevObs = obstacles.reduce((max, o) => (o.startTime + o.duration) > (max.startTime + max.duration) ? o : max, obstacles[0])
              minStartTime = prevObs.startTime + prevObs.duration
            }
          }
          const tentativeStartTime = Math.max(minStartTime, Math.min(dragRegion.initialStartTime + dTime, initialEndTime))
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
            updateVideoTime(draggingRegion.initialStartTime)
          } else {
            const newDuration = Math.min(intendedDuration, maxDuration)
            element.style.display = 'block'
            setIsRegionHidden(false)
            element.style.width = `${timeToPx(newDuration)}px`
            updateVideoTime(draggingRegion.initialStartTime + newDuration)
          }
        } else if (draggingRegion.type === 'resize-left') {
          const { newStartTime, newDuration } = calcResizeLeft(draggingRegion, deltaTime)
          if (newDuration < TIMELINE.REGION_DELETE_THRESHOLD) {
            element.style.display = 'none'
            setIsRegionHidden(true)
            updateVideoTime(draggingRegion.initialStartTime + draggingRegion.initialDuration)
          } else {
            element.style.display = 'block'
            setIsRegionHidden(false)
            element.style.width = `${timeToPx(newDuration)}px`
            element.style.transform = `translateX(${timeToPx(newStartTime - draggingRegion.initialStartTime)}px)`
            updateVideoTime(newStartTime)
          }
        }
      }

      if ((isDraggingLeftStrip || isDraggingRightStrip) && timelineRef.current) {
        document.body.style.cursor = 'grabbing'
        const rect = timelineRef.current.getBoundingClientRect()
        const timeAtMouse = pxToTime(Math.max(0, e.clientX - rect.left))
        let newPreview: CutRegion | null = null
        if (isDraggingLeftStrip) {
          const duration = Math.min(timeAtMouse, useEditorStore.getState().duration)
          newPreview = {
            id: 'preview-cut-left',
            type: 'cut',
            laneId: defaultLaneId,
            startTime: 0,
            duration,
            trimType: 'start',
            zIndex: 0,
          }
        } else {
          const startTime = Math.max(0, timeAtMouse)
          const duration = useEditorStore.getState().duration - startTime
          newPreview = {
            id: 'preview-cut-right',
            type: 'cut',
            laneId: defaultLaneId,
            startTime,
            duration,
            trimType: 'end',
            zIndex: 0,
          }
        }
        setPreviewCutRegion(newPreview.duration >= TIMELINE.MINIMUM_REGION_DURATION ? newPreview : null)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      document.body.style.cursor = 'default'
      setIsDraggingPlayhead(false)

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
          const finalUpdates: Partial<TimelineRegion> = {}
          
          const calcMovedRegion = (dragRegion: any, dTime: number, clientY: number | null) => {
            const maxStartTime = duration - dragRegion.initialDuration
            const intendedStartTime = dragRegion.initialStartTime + dTime
            let targetLaneId = clientY !== null ? (resolveLaneIdFromClientY(clientY) || dragRegion.initialLaneId) : (draggedLaneIdRef.current || dragRegion.initialLaneId)
            let newStartTime = Math.max(0, Math.min(intendedStartTime, maxStartTime))

            if (!dragRegion.isCut) {
              const state = useEditorStore.getState()
              const getObstacles = (lane: string) => [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions)
              ].filter(r => r.id !== dragRegion.id && r.laneId === lane)
              
              const findValid = (lane: string) => {
                const obs = getObstacles(lane).sort((a, b) => a.startTime - b.startTime)
                const gaps: {start: number, end: number}[] = []
                let lastEnd = 0
                for (const o of obs) {
                  if (o.startTime > lastEnd + 0.001) gaps.push({start: lastEnd, end: o.startTime})
                  lastEnd = Math.max(lastEnd, o.startTime + o.duration)
                }
                if (duration > lastEnd + 0.001) gaps.push({start: lastEnd, end: duration})
                
                const validGaps = gaps.filter(g => g.end - g.start >= dragRegion.initialDuration - 0.001)
                if (!validGaps.length) return null
                
                let best = intendedStartTime
                let minDist = Infinity
                for (const g of validGaps) {
                  const c = Math.max(g.start, Math.min(intendedStartTime, g.end - dragRegion.initialDuration))
                  const d = Math.abs(c - intendedStartTime)
                  if (d < minDist) { minDist = d; best = c }
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

          const calcResizeRight = (dragRegion: any, dTime: number) => {
            let maxDuration = duration - dragRegion.initialStartTime
            if (!dragRegion.isCut) {
              const state = useEditorStore.getState()
              const obstacles = [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions)
              ].filter(r => r.id !== dragRegion.id && r.laneId === dragRegion.initialLaneId && r.startTime >= dragRegion.initialStartTime + dragRegion.initialDuration - 0.001)
              if (obstacles.length > 0) {
                const nextObs = obstacles.reduce((min, o) => o.startTime < min.startTime ? o : min, obstacles[0])
                maxDuration = Math.min(maxDuration, nextObs.startTime - dragRegion.initialStartTime)
              }
            }
            const intendedDuration = dragRegion.initialDuration + dTime
            return { intendedDuration, maxDuration }
          }

          const calcResizeLeft = (dragRegion: any, dTime: number) => {
            const initialEndTime = dragRegion.initialStartTime + dragRegion.initialDuration
            let minStartTime = 0
            if (!dragRegion.isCut) {
              const state = useEditorStore.getState()
              const obstacles = [
                ...Object.values(state.zoomRegions),
                ...Object.values(state.speedRegions),
                ...Object.values(state.blurRegions)
              ].filter(r => r.id !== dragRegion.id && r.laneId === dragRegion.initialLaneId && r.startTime + r.duration <= dragRegion.initialStartTime + 0.001)
              if (obstacles.length > 0) {
                const prevObs = obstacles.reduce((max, o) => (o.startTime + o.duration) > (max.startTime + max.duration) ? o : max, obstacles[0])
                minStartTime = prevObs.startTime + prevObs.duration
              }
            }
            const tentativeStartTime = Math.max(minStartTime, Math.min(dragRegion.initialStartTime + dTime, initialEndTime))
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

      if (isDraggingLeftStrip || isDraggingRightStrip) {
        const finalPreview = useEditorStore.getState().previewCutRegion
        if (finalPreview) {
          addCutRegion({
            startTime: finalPreview.startTime,
            duration: finalPreview.duration,
            laneId: defaultLaneId,
            trimType: isDraggingLeftStrip ? 'start' : 'end',
          })
        }
      }

      setIsDraggingLeftStrip(false)
      setIsDraggingRightStrip(false)
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
    isDraggingLeftStrip,
    isDraggingRightStrip,
    pxToTime,
    timeToPx,
    updateVideoTime,
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
  ])

  return {
    draggingRegionId: draggingRegion?.id ?? null,
    dragMovePreview,
    activeDropLaneId,
    isDraggingPlayhead,
    handleRegionMouseDown,
    handlePlayheadMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      setIsDraggingPlayhead(true)
      document.body.style.cursor = 'grabbing'
    },
    handleLeftStripMouseDown: () => {
      const state = useEditorStore.getState()
      const existingTrim = getTopRegionByPredicate(
        Object.values(state.cutRegions),
        state.timelineLanes,
        (r) => r.trimType === 'start',
      )
      if (existingTrim) deleteRegion(existingTrim.id)
      setIsDraggingLeftStrip(true)
    },
    handleRightStripMouseDown: () => {
      const state = useEditorStore.getState()
      const existingTrim = getTopRegionByPredicate(
        Object.values(state.cutRegions),
        state.timelineLanes,
        (r) => r.trimType === 'end',
      )
      if (existingTrim) deleteRegion(existingTrim.id)
      setIsDraggingRightStrip(true)
    },
  }
}
