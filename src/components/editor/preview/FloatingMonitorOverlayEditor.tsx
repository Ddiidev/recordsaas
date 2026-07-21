import { useEffect, useState, type RefObject } from 'react'
import { ArrowsMove } from '@icons'
import type { FloatingMonitor, FloatingMonitorRegion, TimelineLane } from '../../../types'
import { isRegionActiveAtTime } from '../../../lib/timeline-lanes'

type CanvasBox = { left: number; top: number; width: number; height: number }
type DragMode = 'move' | 'resize'
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLE_CONFIG: Array<{ handle: ResizeHandle; left: string; top: string; cursor: string }> = [
  { handle: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
  { handle: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
  { handle: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
  { handle: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function FloatingMonitorOverlayEditor({
  canvasRef,
  regions,
  monitors,
  currentTime,
  timelineLanes,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  regions: Record<string, FloatingMonitorRegion>
  monitors: Record<string, FloatingMonitor>
  currentTime: number
  timelineLanes: TimelineLane[]
  selectedRegionId: string | null
  onSelectRegion: (id: string | null) => void
  onUpdateRegion: (id: string, updates: Partial<FloatingMonitorRegion>) => void
}) {
  const [box, setBox] = useState<CanvasBox | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const updateBox = () => {
      const rect = canvas.getBoundingClientRect()
      setBox({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    }
    updateBox()
    const observer = new ResizeObserver(updateBox)
    observer.observe(canvas)
    window.addEventListener('resize', updateBox)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBox)
    }
  }, [canvasRef])

  if (!box || box.width <= 0 || box.height <= 0) return null
  const activeRegions = Object.values(regions)
    .filter((region) => isRegionActiveAtTime(region, currentTime))
    .filter((region) => timelineLanes.some((lane) => lane.id === region.laneId && lane.visible))

  const beginDrag = (
    event: React.PointerEvent<HTMLDivElement | HTMLButtonElement>,
    region: FloatingMonitorRegion,
    mode: DragMode,
    handle?: ResizeHandle,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectRegion(region.id)
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    }
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.clientX) / box.width
      const dy = (moveEvent.clientY - start.clientY) / box.height
      if (mode === 'move') {
        onUpdateRegion(region.id, {
          x: clamp(start.x + dx, 0, 1 - start.width),
          y: clamp(start.y + dy, 0, 1 - start.height),
        })
        return
      }
      const pointerX = clamp(start.clientX + dx * box.width - box.left, 0, box.width)
      const pointerY = clamp(start.clientY + dy * box.height - box.top, 0, box.height)
      const minWidth = 0.1 * box.width
      const minHeight = 0.1 * box.height
      const startLeft = start.x * box.width
      const startTop = start.y * box.height
      const startRight = startLeft + start.width * box.width
      const startBottom = startTop + start.height * box.height
      let left = startLeft
      let top = startTop
      let right = startRight
      let bottom = startBottom

      if (handle?.includes('w')) left = clamp(pointerX, 0, right - minWidth)
      if (handle?.includes('e')) right = clamp(pointerX, left + minWidth, box.width)
      if (handle?.includes('n')) top = clamp(pointerY, 0, bottom - minHeight)
      if (handle?.includes('s')) bottom = clamp(pointerY, top + minHeight, box.height)
      onUpdateRegion(region.id, {
        x: left / box.width,
        y: top / box.height,
        width: (right - left) / box.width,
        height: (bottom - top) / box.height,
      })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <>
      {activeRegions.map((region) => {
        const isSelected = selectedRegionId === region.id
        const monitor = monitors[region.monitorId]
        const badgeName = monitor?.originalName || monitor?.name || 'Asset'
        return (
          <div
            key={region.id}
            role="button"
            tabIndex={0}
            aria-label="Move floating monitor"
            onPointerDown={(event) => beginDrag(event, region, 'move')}
            className={`fixed z-40 border-2 ${isSelected ? 'border-violet-400 shadow-lg shadow-violet-500/30' : 'cursor-move border-border/80 bg-transparent hover:border-primary/60'}`}
            style={{
              left: box.left + box.width * region.x,
              top: box.top + box.height * region.y,
              width: box.width * region.width,
              height: box.height * region.height,
            }}
          >
            {isSelected && (
              <>
                <span className="absolute -top-6 right-0 max-w-[calc(100%_-_8px)] truncate rounded bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                  {badgeName}
                </span>
                {HANDLE_CONFIG.map((item) => (
                  <button
                    key={item.handle}
                    type="button"
                    aria-label={`Resize floating monitor ${item.handle}`}
                    onPointerDown={(event) => beginDrag(event, region, 'resize', item.handle)}
                    className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card shadow-sm"
                    style={{ left: item.left, top: item.top, cursor: item.cursor }}
                  />
                ))}
                <button
                  type="button"
                  aria-label="Move floating monitor"
                  onPointerDown={(event) => beginDrag(event, region, 'move')}
                  className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-accent"
                  style={{ cursor: 'move' }}
                >
                  <ArrowsMove className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )
      })}
    </>
  )
}
