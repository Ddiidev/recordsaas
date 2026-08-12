import { memo } from 'react'
import { TimelineRegion, BlurRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Search } from '@icons'
import { RegionResizeHandles } from './RegionResizeHandles'

interface BlurRegionBlockProps {
  region: BlurRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

export const BlurRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: BlurRegionBlockProps) => {
    return (
      <div
        ref={setRef}
        data-region-id={region.id}
        className={cn(
          'group/region absolute w-full h-12 top-0 rounded-xl cursor-grab border-2 backdrop-blur-sm',
          !isBeingDragged && 'transition-all duration-200 ease-out',
          isSelected
            ? 'bg-card/90 border-amber-500 transform -translate-y-[2px] shadow-sm shadow-amber-500/20'
            : 'bg-card/70 border-amber-500/60 hover:border-amber-500 hover:bg-card/80 hover:shadow-md hover:shadow-amber-500/10',
        )}
        style={{ willChange: 'transform, width' }}
        onMouseDown={(e) => onMouseDown(e, region, 'move')}
      >
        <RegionResizeHandles
          isSelected={isSelected}
          indicatorClassName="bg-amber-500/60 group-hover/resize-handle:bg-amber-500"
          onMouseDown={(event, side) => {
            event.stopPropagation()
            onMouseDown(event, region, side)
          }}
        />

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <Search className={cn('w-4 h-4 shrink-0 transition-colors text-amber-500', !isSelected && 'opacity-70')} />
            <span
              className={cn(
                'text-sm font-bold tracking-wide select-none whitespace-nowrap transition-colors text-amber-500',
                !isSelected && 'opacity-70',
              )}
            >
              BLUR
            </span>
          </div>
        </div>

      </div>
    )
  },
)

BlurRegionBlock.displayName = 'BlurRegionBlock'
