import { memo } from 'react'
import { DeviceComputerCamera } from '@icons'
import type { FloatingMonitorRegion, TimelineRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { RegionResizeHandles } from './RegionResizeHandles'

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
        'group/region absolute h-12 w-full rounded-xl border-2 bg-card/75 backdrop-blur-sm',
        !isBeingDragged && 'transition-all duration-200 ease-out',
        isSelected
          ? 'border-violet-500 bg-card/95 shadow-sm shadow-violet-500/20'
          : 'border-border/60 hover:border-violet-500 hover:bg-card/90 hover:shadow-md hover:shadow-violet-500/10',
      )}
      onMouseDown={(event) => onMouseDown(event, region, 'move')}
    >
      <RegionResizeHandles
        isSelected={isSelected}
        indicatorClassName="bg-violet-500/60 group-hover/resize-handle:bg-violet-500"
        onMouseDown={(event, side) => {
          event.stopPropagation()
          onMouseDown(event, region, side)
        }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 overflow-hidden px-6 text-violet-500 dark:text-violet-300">
        <DeviceComputerCamera className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-bold tracking-wide">{name}</span>
      </div>
    </div>
  ),
)

FloatingMonitorRegionBlock.displayName = 'FloatingMonitorRegionBlock'
