import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowsMove } from '@icons'
import type { BlurRegion, FrameStyles, TimelineLane, VideoDimensions } from '../../../types'
import { BLUR_REGION } from '../../../lib/constants'
import { isRegionActiveAtTime, sortRegionsByLanePrecedence } from '../../../lib/timeline-lanes'
import { cn } from '../../../lib/utils'

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type FrameRect = {
  x: number
  y: number
  width: number
  height: number
}

type NormalizedRect = {
  x: number
  y: number
  width: number
  height: number
}

type InteractionState = {
  mode: 'move' | 'resize'
  handle?: ResizeHandle
  regionId: string
  frameRect: FrameRect
  startPointerFrameX: number
  startPointerFrameY: number
  startRegion: NormalizedRect
}

interface BlurOverlayEditorProps {
  canvasRef: React.RefObject<HTMLCanvasElement>
  blurRegions: Record<string, BlurRegion>
  currentTime: number
  timelineLanes: TimelineLane[]
  frameStyles: FrameStyles
  videoDimensions: VideoDimensions
  selectedRegionId: string | null
  onSelectRegion: (id: string) => void
  onUpdateRegion: (id: string, updates: Partial<BlurRegion>) => void
}

const HANDLE_CONFIG: Array<{ handle: ResizeHandle; left: string; top: string; cursor: string }> = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { handle: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { handle: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { handle: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
  { handle: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
]

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const roundTo4 = (value: number): number => Math.round(value * 10000) / 10000

const normalizeRegion = (region: BlurRegion): NormalizedRect => {
  const width = clamp(region.width, BLUR_REGION.WIDTH.min, BLUR_REGION.WIDTH.max)
  const height = clamp(region.height, BLUR_REGION.HEIGHT.min, BLUR_REGION.HEIGHT.max)
  const x = clamp(region.x, BLUR_REGION.X.min, BLUR_REGION.X.max - width)
  const y = clamp(region.y, BLUR_REGION.Y.min, BLUR_REGION.Y.max - height)

  return { x, y, width, height }
}

const getFrameRect = (
  containerWidth: number,
  containerHeight: number,
  frameStyles: FrameStyles,
  videoDimensions: VideoDimensions,
): FrameRect | null => {
  if (containerWidth <= 0 || containerHeight <= 0 || videoDimensions.width <= 0 || videoDimensions.height <= 0) {
    return null
  }

  const paddingPercent = frameStyles.padding / 100
  const availableWidth = containerWidth * (1 - 2 * paddingPercent)
  const availableHeight = containerHeight * (1 - 2 * paddingPercent)
  if (availableWidth <= 0 || availableHeight <= 0) return null

  const videoAspectRatio = videoDimensions.width / videoDimensions.height

  let frameWidth: number
  let frameHeight: number

  if (availableWidth / availableHeight > videoAspectRatio) {
    frameHeight = availableHeight
    frameWidth = frameHeight * videoAspectRatio
  } else {
    frameWidth = availableWidth
    frameHeight = frameWidth / videoAspectRatio
  }

  return {
    x: (containerWidth - frameWidth) / 2,
    y: (containerHeight - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  }
}

const getHandleCursor = (handle: ResizeHandle): string =>
  HANDLE_CONFIG.find((item) => item.handle === handle)?.cursor || 'default'

export const BlurOverlayEditor = memo(
  ({
    canvasRef,
    blurRegions,
    currentTime,
    timelineLanes,
    frameStyles,
    videoDimensions,
    selectedRegionId,
    onSelectRegion,
    onUpdateRegion,
  }: BlurOverlayEditorProps) => {
    const overlayRef = useRef<HTMLDivElement>(null)
    const [canvasRect, setCanvasRect] = useState<FrameRect | null>(null)

    useEffect(() => {
      const updateCanvasRect = () => {
        const overlay = overlayRef.current
        const canvas = canvasRef.current
        if (!overlay || !canvas) {
          setCanvasRect((previous) => (previous ? null : previous))
          return
        }

        const overlayBounds = overlay.getBoundingClientRect()
        const canvasBounds = canvas.getBoundingClientRect()

        if (canvasBounds.width <= 0 || canvasBounds.height <= 0) {
          setCanvasRect((previous) => (previous ? null : previous))
          return
        }

        const nextRect: FrameRect = {
          x: canvasBounds.left - overlayBounds.left,
          y: canvasBounds.top - overlayBounds.top,
          width: canvasBounds.width,
          height: canvasBounds.height,
        }

        setCanvasRect((previous) => {
          if (
            previous &&
            Math.abs(previous.x - nextRect.x) < 0.5 &&
            Math.abs(previous.y - nextRect.y) < 0.5 &&
            Math.abs(previous.width - nextRect.width) < 0.5 &&
            Math.abs(previous.height - nextRect.height) < 0.5
          ) {
            return previous
          }
          return nextRect
        })
      }

      const overlay = overlayRef.current
      const canvas = canvasRef.current
      if (!overlay) return

      updateCanvasRect()

      const overlayObserver = new ResizeObserver(updateCanvasRect)
      overlayObserver.observe(overlay)

      let canvasObserver: ResizeObserver | null = null
      if (canvas) {
        canvasObserver = new ResizeObserver(updateCanvasRect)
        canvasObserver.observe(canvas)
      }

      window.addEventListener('resize', updateCanvasRect)

      return () => {
        overlayObserver.disconnect()
        canvasObserver?.disconnect()
        window.removeEventListener('resize', updateCanvasRect)
      }
    }, [canvasRef])

    useEffect(() => {
      const overlay = overlayRef.current
      const canvas = canvasRef.current
      if (!overlay || !canvas) return

      const overlayBounds = overlay.getBoundingClientRect()
      const canvasBounds = canvas.getBoundingClientRect()

      if (canvasBounds.width <= 0 || canvasBounds.height <= 0) {
        setCanvasRect((previous) => (previous ? null : previous))
        return
      }

      const nextRect: FrameRect = {
        x: canvasBounds.left - overlayBounds.left,
        y: canvasBounds.top - overlayBounds.top,
        width: canvasBounds.width,
        height: canvasBounds.height,
      }

      setCanvasRect((previous) => {
        if (
          previous &&
          Math.abs(previous.x - nextRect.x) < 0.5 &&
          Math.abs(previous.y - nextRect.y) < 0.5 &&
          Math.abs(previous.width - nextRect.width) < 0.5 &&
          Math.abs(previous.height - nextRect.height) < 0.5
        ) {
          return previous
        }
        return nextRect
      })
    }, [currentTime, frameStyles, videoDimensions, blurRegions, selectedRegionId, canvasRef])

    const frameRect = useMemo(() => {
      if (!canvasRect) return null
      const frameInsideCanvas = getFrameRect(canvasRect.width, canvasRect.height, frameStyles, videoDimensions)
      if (!frameInsideCanvas) return null

      return {
        x: canvasRect.x + frameInsideCanvas.x,
        y: canvasRect.y + frameInsideCanvas.y,
        width: frameInsideCanvas.width,
        height: frameInsideCanvas.height,
      }
    }, [canvasRect, frameStyles, videoDimensions])

    const activeRegionsTopFirst = useMemo(
      () =>
        sortRegionsByLanePrecedence(
          Object.values(blurRegions).filter((region) => isRegionActiveAtTime(region, currentTime)),
          timelineLanes,
        ),
      [blurRegions, currentTime, timelineLanes],
    )

    const regionsForRender = useMemo(() => {
      if (!frameRect) return []

      const bottomFirst = [...activeRegionsTopFirst].reverse()
      return bottomFirst.map((region, index) => {
        const normalized = normalizeRegion(region)
        return {
          region,
          normalized,
          left: frameRect.x + normalized.x * frameRect.width,
          top: frameRect.y + normalized.y * frameRect.height,
          width: normalized.width * frameRect.width,
          height: normalized.height * frameRect.height,
          zIndex: index + 1,
        }
      })
    }, [activeRegionsTopFirst, frameRect])

    const getPointerInFrame = (clientX: number, clientY: number, currentFrameRect: FrameRect) => {
      const overlay = overlayRef.current
      if (!overlay) return null

      const bounds = overlay.getBoundingClientRect()
      return {
        x: clientX - bounds.left - currentFrameRect.x,
        y: clientY - bounds.top - currentFrameRect.y,
      }
    }

    const startInteraction = (
      event: React.MouseEvent<HTMLButtonElement | HTMLDivElement>,
      mode: InteractionState['mode'],
      region: BlurRegion,
      handle?: ResizeHandle,
    ) => {
      if (!frameRect) return

      event.preventDefault()
      event.stopPropagation()

      onSelectRegion(region.id)

      const pointer = getPointerInFrame(event.clientX, event.clientY, frameRect)
      if (!pointer) return

      const normalized = normalizeRegion(region)

      const interaction: InteractionState = {
        mode,
        handle,
        regionId: region.id,
        frameRect,
        startPointerFrameX: pointer.x,
        startPointerFrameY: pointer.y,
        startRegion: normalized,
      }

      const dragCursor = mode === 'move' ? 'grabbing' : getHandleCursor(handle || 'e')
      document.body.style.cursor = dragCursor
      document.body.style.userSelect = 'none'

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const movePointer = getPointerInFrame(moveEvent.clientX, moveEvent.clientY, interaction.frameRect)
        if (!movePointer) return

        const frameWidth = interaction.frameRect.width
        const frameHeight = interaction.frameRect.height
        const startLeft = interaction.startRegion.x * frameWidth
        const startTop = interaction.startRegion.y * frameHeight
        const startWidth = interaction.startRegion.width * frameWidth
        const startHeight = interaction.startRegion.height * frameHeight
        const startRight = startLeft + startWidth
        const startBottom = startTop + startHeight
        const minWidth = BLUR_REGION.WIDTH.min * frameWidth
        const minHeight = BLUR_REGION.HEIGHT.min * frameHeight

        let nextLeft = startLeft
        let nextTop = startTop
        let nextRight = startRight
        let nextBottom = startBottom

        if (interaction.mode === 'move') {
          const deltaX = movePointer.x - interaction.startPointerFrameX
          const deltaY = movePointer.y - interaction.startPointerFrameY
          nextLeft = clamp(startLeft + deltaX, 0, frameWidth - startWidth)
          nextTop = clamp(startTop + deltaY, 0, frameHeight - startHeight)
          nextRight = nextLeft + startWidth
          nextBottom = nextTop + startHeight
        } else if (interaction.handle) {
          const pointerX = clamp(movePointer.x, 0, frameWidth)
          const pointerY = clamp(movePointer.y, 0, frameHeight)

          if (interaction.handle.includes('w')) {
            nextLeft = clamp(pointerX, 0, nextRight - minWidth)
          }
          if (interaction.handle.includes('e')) {
            nextRight = clamp(pointerX, nextLeft + minWidth, frameWidth)
          }
          if (interaction.handle.includes('n')) {
            nextTop = clamp(pointerY, 0, nextBottom - minHeight)
          }
          if (interaction.handle.includes('s')) {
            nextBottom = clamp(pointerY, nextTop + minHeight, frameHeight)
          }
        }

        const normalizedX = roundTo4(nextLeft / frameWidth)
        const normalizedY = roundTo4(nextTop / frameHeight)
        const normalizedWidth = roundTo4((nextRight - nextLeft) / frameWidth)
        const normalizedHeight = roundTo4((nextBottom - nextTop) / frameHeight)

        onUpdateRegion(interaction.regionId, {
          x: normalizedX,
          y: normalizedY,
          width: normalizedWidth,
          height: normalizedHeight,
        })
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    useEffect(() => {
      return () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }, [])

    if (!frameRect || regionsForRender.length === 0) {
      return <div ref={overlayRef} className="absolute inset-0 z-10 pointer-events-none" />
    }

    return (
      <div ref={overlayRef} className="absolute inset-0 z-10 pointer-events-none">
        {regionsForRender.map(({ region, left, top, width, height, zIndex }) => {
          const isSelected = region.id === selectedRegionId

          return (
            <div
              key={region.id}
              className={cn(
                'absolute pointer-events-auto rounded-sm transition-colors',
                isSelected
                  ? 'border-2 border-amber-400/90 bg-amber-500/5 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]'
                  : 'border border-white/70 bg-white/5 hover:border-amber-300/80',
              )}
              style={{ left, top, width, height, zIndex: isSelected ? 200 : 20 + zIndex }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onSelectRegion(region.id)
              }}
            >
              {isSelected && (
                <>
                  {HANDLE_CONFIG.map((item) => (
                    <button
                      key={item.handle}
                      type="button"
                      className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border border-slate-700 shadow-sm"
                      style={{ left: item.left, top: item.top, cursor: item.cursor }}
                      onMouseDown={(event) => startInteraction(event, 'resize', region, item.handle)}
                      aria-label={`Resize blur region ${item.handle}`}
                    />
                  ))}

                  <button
                    type="button"
                    className="absolute left-1/2 top-1/2 w-7 h-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border border-slate-700 shadow-md flex items-center justify-center text-slate-700 hover:bg-slate-50"
                    style={{ cursor: 'move' }}
                    onMouseDown={(event) => startInteraction(event, 'move', region)}
                    aria-label="Move blur region"
                  >
                    <ArrowsMove className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  },
)

BlurOverlayEditor.displayName = 'BlurOverlayEditor'
