import React, { useRef, useState, useEffect, useCallback, useMemo, memo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore, useAllRegions } from '../../store/editorStore'
import { ZoomRegionBlock } from './timeline/ZoomRegionBlock'
import { CutRegionBlock } from './timeline/CutRegionBlock'
import { SpeedRegionBlock } from './timeline/SpeedRegionBlock'
import { BlurRegionBlock } from './timeline/BlurRegionBlock'
import { Playhead } from './timeline/Playhead'
import { cn } from '../../lib/utils'
import { Scissors, ChevronUp, ChevronDown, Trash, DotsVertical } from 'tabler-icons-react'
import { formatTime, calculateRulerInterval } from '../../lib/utils'
import { useTimelineInteraction } from '../../hooks/useTimelineInteraction'
import { FlipScissorsIcon } from '../ui/icons'
import { sortTimelineLanes } from '../../lib/timeline-lanes'
import { ContextMenu, ContextMenuItem } from '../ui/context-menu'
import type { TimelineRegion } from '../../types'

const LANE_HEIGHT_PX = 64
const LANE_GAP_PX = 8
const RULER_HEIGHT_PX = 48
const TIMELINE_MIN_VISIBLE_LANES = 2
const TIMELINE_MAX_VISIBLE_LANES = 3
const LANE_ACTION_STRIP_WIDTH_PX = 28

const Ruler = memo(
  ({
    ticks,
    timeToPx,
    formatTime: formatTimeFunc,
  }: {
    ticks: { time: number; type: string }[]
    timeToPx: (time: number) => number
    formatTime: (seconds: number) => string
  }) => (
    <div className="sticky top-0 left-0 right-0 z-10 h-12 overflow-hidden border-b border-border/30 bg-card/60 backdrop-blur-md">
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

export function Timeline({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) {
  const { currentTime, duration, timelineZoom, previewCutRegion, selectedRegionId, isPlaying, timelineLanes } =
    useEditorStore(
      useShallow((state) => ({
        currentTime: state.currentTime,
        duration: state.duration,
        timelineZoom: state.timelineZoom,
        previewCutRegion: state.previewCutRegion,
        selectedRegionId: state.selectedRegionId,
        isPlaying: state.isPlaying,
        timelineLanes: state.timelineLanes,
      })),
    )

  const { setCurrentTime, setSelectedRegionId, addTimelineLane, moveTimelineLane, removeTimelineLane } =
    useEditorStore()

  const sortedLanes = useMemo(() => sortTimelineLanes(timelineLanes), [timelineLanes])
  const fallbackLaneId = sortedLanes[0]?.id ?? 'lane-1'

  const containerRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const lanesContainerRef = useRef<HTMLDivElement>(null)
  const laneRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const regionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const animationFrameRef = useRef<number>()

  const [containerWidth, setContainerWidth] = useState(0)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  const [laneActionMenu, setLaneActionMenu] = useState<{
    laneId: string
    position: { x: number; y: number }
  } | null>(null)

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

  const updateVideoTime = useCallback(
    (time: number) => {
      const clampedTime = Math.max(0, Math.min(time, duration))
      setCurrentTime(clampedTime)
      if (videoRef.current) videoRef.current.currentTime = clampedTime
    },
    [duration, setCurrentTime, videoRef],
  )

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
    handleRegionMouseDown,
    handlePlayheadMouseDown,
    handleLeftStripMouseDown,
    handleRightStripMouseDown,
  } = useTimelineInteraction({
    timelineRef,
    regionRefs,
    pxToTime,
    timeToPx,
    updateVideoTime,
    duration,
    defaultLaneId: fallbackLaneId,
    resolveLaneIdFromClientY,
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
    const animate = () => {
      if (videoRef.current && playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${timeToPx(videoRef.current.currentTime)}px)`
      }
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(animate)
    }
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    }
  }, [isPlaying, timeToPx, videoRef])

  useEffect(() => {
    if (!isPlaying && playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${timeToPx(currentTime)}px)`
    }
  }, [currentTime, isPlaying, timeToPx])

  useEffect(() => {
    if (!laneActionMenu) return

    const hasLane = sortedLanes.some((lane) => lane.id === laneActionMenu.laneId)
    if (!hasLane || sortedLanes.length <= 1) {
      setLaneActionMenu(null)
    }
  }, [laneActionMenu, sortedLanes])

  const { zoomRegions, cutRegions, speedRegions, blurRegions } = useAllRegions()

  const allRegionsToRender = useMemo(() => {
    const combined = [
      ...Object.values(zoomRegions),
      ...Object.values(cutRegions),
      ...Object.values(speedRegions),
      ...Object.values(blurRegions),
    ]
    if (previewCutRegion) {
      combined.push({ ...previewCutRegion, laneId: previewCutRegion.laneId || fallbackLaneId })
    }
    return combined
  }, [zoomRegions, cutRegions, speedRegions, blurRegions, previewCutRegion, fallbackLaneId])

  const movePreviewRegion = useMemo(() => {
    if (!dragMovePreview || dragMovePreview.laneId === dragMovePreview.sourceLaneId) return null

    const sourceRegion =
      zoomRegions[dragMovePreview.regionId] ||
      cutRegions[dragMovePreview.regionId] ||
      speedRegions[dragMovePreview.regionId] ||
      blurRegions[dragMovePreview.regionId]

    if (!sourceRegion) return null

    return {
      ...sourceRegion,
      laneId: dragMovePreview.laneId,
      startTime: dragMovePreview.startTime,
      duration: dragMovePreview.duration,
    } as TimelineRegion
  }, [dragMovePreview, zoomRegions, cutRegions, speedRegions, blurRegions])

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

  const lanesContentHeight = useMemo(
    () => sortedLanes.length * LANE_HEIGHT_PX + Math.max(0, sortedLanes.length - 1) * LANE_GAP_PX,
    [sortedLanes.length],
  )
  const timelineContentHeight = RULER_HEIGHT_PX + lanesContentHeight
  const minTimelineViewportHeight =
    RULER_HEIGHT_PX +
    TIMELINE_MIN_VISIBLE_LANES * LANE_HEIGHT_PX +
    Math.max(0, TIMELINE_MIN_VISIBLE_LANES - 1) * LANE_GAP_PX
  const maxTimelineViewportHeight =
    RULER_HEIGHT_PX +
    TIMELINE_MAX_VISIBLE_LANES * LANE_HEIGHT_PX +
    Math.max(0, TIMELINE_MAX_VISIBLE_LANES - 1) * LANE_GAP_PX
  const timelineViewportHeight = Math.min(
    maxTimelineViewportHeight,
    Math.max(minTimelineViewportHeight, timelineContentHeight),
  ) + 14 // Adds buffer for horizontal scrollbar to prevent vertical scrolling for 2 lanes
  const showLaneActionButtons = sortedLanes.length > 1
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

  return (
    <div className="flex flex-col bg-background/50 p-3 transition-all duration-300 ease-in-out">
      <div className="mb-2 flex items-center gap-3 px-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Timeline lanes</span>
        <button
          type="button"
          data-lane-control
          onClick={(e) => {
            e.stopPropagation()
            addTimelineLane()
          }}
          className="rounded-md border border-border/60 bg-card/80 px-2 py-1 text-xs text-foreground hover:bg-accent/50"
        >
          + lane
        </button>
      </div>

      <div
        className="flex flex-row overflow-hidden rounded-xl border border-border bg-card shadow-xl"
        style={{ height: `${timelineViewportHeight}px`, maxHeight: '40vh' }}
      >
        <div
          className="w-8 shrink-0 h-full bg-gradient-to-b from-card to-muted/30 flex items-center justify-center transition-all duration-200 cursor-ew-resize select-none border-r border-border hover:bg-accent/40 active:bg-accent/60 group"
          onMouseDown={handleLeftStripMouseDown}
        >
          <Scissors size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>

        <div
          ref={containerRef}
          className="timeline-scrollbar stable-scrollbar flex-1 overflow-x-auto overflow-y-auto bg-gradient-to-b from-background/30 to-background/10"
          onScroll={(e) => {
            setTimelineScrollLeft((e.currentTarget as HTMLDivElement).scrollLeft)
          }}
          onMouseDown={(e) => {
            if (
              duration === 0 ||
              (e.target as HTMLElement).closest('[data-region-id]') ||
              (e.target as HTMLElement).closest('[data-lane-control]')
            ) {
              return
            }
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const clickX = e.clientX - rect.left + (e.currentTarget as HTMLDivElement).scrollLeft
            updateVideoTime(pxToTime(clickX))
            setSelectedRegionId(null)
          }}
        >
          <div
            ref={timelineRef}
            className="relative min-w-full overflow-hidden"
            style={{ width: `${timeToPx(duration)}px`, height: `${timelineContentHeight}px` }}
          >
            <Ruler ticks={rulerTicks} timeToPx={timeToPx} formatTime={formatTime} />

            <div
              ref={lanesContainerRef}
              className="absolute left-0 w-full"
              style={{ top: `${RULER_HEIGHT_PX}px`, height: `${lanesContentHeight}px` }}
            >
              {sortedLanes.map((lane, laneIndex) => {
                const laneRegions = regionsByLane.get(lane.id) ?? []
                const laneMovePreviewRegion =
                  movePreviewRegion && movePreviewRegion.laneId === lane.id ? movePreviewRegion : null

                return (
                  <div
                    key={lane.id}
                    ref={(el) => laneRefs.current.set(lane.id, el)}
                    className={cn(
                      'relative overflow-hidden rounded-lg border bg-background/20',
                      activeDropLaneId === lane.id && draggingRegionId
                        ? 'border-primary/70 bg-primary/10'
                        : 'border-border/40',
                    )}
                    style={{
                      height: `${LANE_HEIGHT_PX}px`,
                      marginBottom: laneIndex === sortedLanes.length - 1 ? 0 : `${LANE_GAP_PX}px`,
                    }}
                  >
                    {showLaneActionButtons && (
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
                        'absolute top-1 z-[120] rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80',
                        showLaneActionButtons ? 'left-[34px]' : 'left-2',
                      )}
                    >
                      {lane.name}
                    </div>

                    {laneRegions.map((region) => {
                      const isSelected = selectedRegionId === region.id
                      const zIndex = isSelected ? 100 : (region.zIndex ?? 1)

                      const regionStyle: React.CSSProperties = {
                        left: `${timeToPx(region.startTime)}px`,
                        width: `${timeToPx(region.duration)}px`,
                        zIndex,
                        opacity: movePreviewRegion && region.id === movePreviewRegion.id ? 0.18 : 1,
                      }

                      if (region.type === 'zoom') {
                        return (
                          <div key={region.id} className="absolute inset-y-0" style={regionStyle}>
                            <ZoomRegionBlock
                              region={region}
                              isSelected={isSelected}
                              isBeingDragged={draggingRegionId === region.id}
                              onMouseDown={handleRegionMouseDown}
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
                              onMouseDown={handleRegionMouseDown}
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
                              onMouseDown={handleRegionMouseDown}
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
                              onMouseDown={handleRegionMouseDown}
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
                          left: `${timeToPx(laneMovePreviewRegion.startTime)}px`,
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

                        return null
                      })()}
                  </div>
                )
              })}
            </div>

            {duration > 0 && (
              <div
                ref={playheadRef}
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{ zIndex: 9999, transform: `translateX(${timeToPx(currentTime)}px)` }}
              >
                <Playhead
                  height={Math.max(80, Math.floor((timelineRef.current?.clientHeight ?? 0) * 0.9))}
                  isDragging={false}
                  onMouseDown={handlePlayheadMouseDown}
                />
              </div>
            )}
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

        <div
          className="w-8 shrink-0 h-full bg-gradient-to-b from-card to-muted/30 flex items-center justify-center transition-all duration-200 cursor-ew-resize select-none border-l border-border hover:bg-accent/40 active:bg-accent/60 group"
          onMouseDown={handleRightStripMouseDown}
        >
          <FlipScissorsIcon size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
      </div>
    </div>
  )
}
