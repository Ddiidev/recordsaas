import { memo } from 'react'
import { DeviceComputerCamera } from '@icons'
import type { FloatingMonitorRegion, TimelineRegion } from '../../../types'
import { cn } from '../../../lib/utils'

interface FloatingMonitorRegionBlockProps {
  region: FloatingMonitorRegion
  name: string
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    event: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (element: HTMLDivElement | null) => void
}

export const FloatingMonitorRegionBlock = memo(
  ({ region, name, isSelected, isBeingDragged, onMouseDown, setRef }: FloatingMonitorRegionBlockProps) => (
    <div
      ref={setRef}
      data-region-id={region.id}
      className={cn(
        'absolute h-12 w-full rounded-xl border-2 bg-card/75 backdrop-blur-sm',
        !isBeingDragged && 'transition-all duration-200 ease-out',
        isSelected
          ? 'border-violet-500 bg-card/95 shadow-sm shadow-violet-500/20'
          : 'border-border/60 hover:border-violet-500 hover:bg-card/90 hover:shadow-md hover:shadow-violet-500/10',
      )}
      onMouseDown={(event) => onMouseDown(event, region, 'move')}
    >
      <div
        className="absolute inset-y-0 left-0 z-10 flex w-5 cursor-ew-resize items-center justify-center rounded-l-xl"
        onMouseDown={(event) => {
          event.stopPropagation()
          onMouseDown(event, region, 'resize-left')
        }}
      >
        <div className="h-6 w-1 rounded-full bg-violet-500/60" />
      </div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 overflow-hidden px-6 text-violet-500">
        <DeviceComputerCamera className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-bold tracking-wide">{name}</span>
      </div>
      <div
        className="absolute inset-y-0 right-0 z-10 flex w-5 cursor-ew-resize items-center justify-center rounded-r-xl"
        onMouseDown={(event) => {
          event.stopPropagation()
          onMouseDown(event, region, 'resize-right')
        }}
      >
        <div className="h-6 w-1 rounded-full bg-violet-500/60" />
      </div>
    </div>
  ),
)

FloatingMonitorRegionBlock.displayName = 'FloatingMonitorRegionBlock'
