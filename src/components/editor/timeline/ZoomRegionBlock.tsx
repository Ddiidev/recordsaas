import { memo } from 'react'
import { TimelineRegion, ZoomRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Search } from '@icons'
import { RegionResizeHandles } from './RegionResizeHandles'

interface ZoomRegionBlockProps {
  region: ZoomRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

export const ZoomRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: ZoomRegionBlockProps) => {
    return (
      <div
        ref={setRef}
        data-region-id={region.id}
        className={cn(
          'group/region absolute w-full h-14 top-1/2 -translate-y-1/2 rounded-xl cursor-grab border-2 backdrop-blur-sm',
          !isBeingDragged && 'transition-all duration-200 ease-out',
          isSelected
            ? 'bg-card/90 border-primary -translate-y-[calc(50%+2px)] shadow-sm shadow-primary/20'
            : 'bg-card/70 border-border/60 hover:border-primary hover:bg-card/90 hover:shadow-md hover:shadow-primary/10',
        )}
        style={{ willChange: 'transform, width' }}
        onMouseDown={(e) => onMouseDown(e, region, 'move')}
      >
        <RegionResizeHandles
          isSelected={isSelected}
          indicatorClassName="bg-primary/60 group-hover/resize-handle:bg-primary"
          onMouseDown={(event, side) => {
            event.stopPropagation()
            onMouseDown(event, region, side)
          }}
        />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <Search className={cn('w-5 h-5 shrink-0 transition-colors', 'text-primary')} />
            <span
              className={cn(
                'text-xs font-semibold tracking-wide select-none whitespace-nowrap overflow-hidden text-ellipsis transition-colors',
                'text-primary',
              )}
            >
              ZOOM
            </span>
          </div>
        </div>

      </div>
    )
  },
)

ZoomRegionBlock.displayName = 'ZoomRegionBlock'
