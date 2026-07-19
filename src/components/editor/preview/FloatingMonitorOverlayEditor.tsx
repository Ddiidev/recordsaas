import { useEffect, useState, type RefObject } from 'react'
import type { FloatingMonitorRegion, TimelineLane } from '../../../types'
import { isRegionActiveAtTime } from '../../../lib/timeline-lanes'

type CanvasBox = { left: number; top: number; width: number; height: number }
type DragMode = 'move' | 'resize'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function FloatingMonitorOverlayEditor({
  canvasRef,
  regions,
  currentTime,
  timelineLanes,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  regions: Record<string, FloatingMonitorRegion>
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

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>, region: FloatingMonitorRegion, mode: DragMode) => {
    event.preventDefault()
    event.stopPropagation()
    onSelectRegion(region.id)
    const start = { clientX: event.clientX, clientY: event.clientY, x: region.x, y: region.y, width: region.width, height: region.height }
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
      onUpdateRegion(region.id, {
        width: clamp(start.width + dx, 0.1, 1 - start.x),
        height: clamp(start.height + dy, 0.1, 1 - start.y),
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
        return (
          <div
            key={region.id}
            role="button"
            tabIndex={0}
            aria-label="Move floating monitor"
            onPointerDown={(event) => beginDrag(event, region, 'move')}
            className={`fixed z-40 cursor-move border-2 ${isSelected ? 'border-violet-400 shadow-lg shadow-violet-500/30' : 'border-violet-300/70'}`}
            style={{ left: box.left + box.width * region.x, top: box.top + box.height * region.y, width: box.width * region.width, height: box.height * region.height }}
          >
            <span className="absolute -top-6 left-0 rounded bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">Monitor</span>
            <div
              aria-label="Resize floating monitor"
              onPointerDown={(event) => beginDrag(event, region, 'resize')}
              className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-violet-600"
            />
          </div>
        )
      })}
    </>
  )
}
