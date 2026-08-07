import { memo } from 'react'
import { TimelineRegion, CutRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Scissors } from '@icons'
import { RegionResizeHandles } from './RegionResizeHandles'

interface CutRegionBlockProps {
  region: CutRegion
  isSelected: boolean
  isDraggable?: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

export const CutRegionBlock = memo(
  ({ region, isSelected, isDraggable = true, isBeingDragged, onMouseDown, setRef }: CutRegionBlockProps) => {
    const isTrimRegion = !!region.trimType
    const canMove = isDraggable && !isTrimRegion
    const canResizeLeft = isDraggable && region.trimType !== 'start'
    const canResizeRight = isDraggable && region.trimType !== 'end'

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'move' | 'resize-left' | 'resize-right') => {
      if (e.button !== 0) return
      e.stopPropagation()
      if (!isDraggable) return
      onMouseDown(e, region, type)
    }

    return (
      <div
        ref={setRef}
        data-region-id={region.id}
        className={cn(
          'group/region absolute w-full h-14 top-1/2 flex items-center justify-center rounded-xl border-2 backdrop-blur-sm',
          !isBeingDragged && 'transition-all duration-200 ease-out',
          canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          isSelected
            ? 'bg-card/90 border-destructive -translate-y-[calc(50%+2px)] shadow-sm shadow-destructive/20'
            : 'bg-card/70 border-destructive/60 -translate-y-1/2 hover:border-destructive/80 hover:bg-card/80 hover:shadow-md hover:shadow-destructive/10',
        )}
        style={{ willChange: 'transform, width' }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        <div className="absolute bottom-full left-0 h-[200px] w-full overflow-hidden rounded-t-lg pointer-events-none">
          <div className="absolute inset-0 bg-destructive/15" />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `repeating-linear-gradient(
              -45deg,
              transparent,
              transparent 8px,
              rgb(var(--destructive) / 0.15) 8px,
              rgb(var(--destructive) / 0.15) 16px
            )`,
            }}
          />
        </div>

        <RegionResizeHandles
          isSelected={isSelected}
          canResizeLeft={canResizeLeft}
          canResizeRight={canResizeRight}
          indicatorClassName="bg-destructive/50 group-hover/resize-handle:bg-destructive"
          onMouseDown={handleMouseDown}
        />

        <div className="pointer-events-none flex items-center gap-2.5 overflow-hidden px-3">
          <Scissors
            className={cn('h-5 w-5 transition-colors', isSelected ? 'text-destructive' : 'text-destructive/70')}
          />
          <span
            className={cn(
              'overflow-hidden text-ellipsis text-xs font-semibold tracking-wide transition-colors',
              isSelected ? 'text-destructive' : 'text-destructive/70',
            )}
          >
            CUT
          </span>
        </div>

      </div>
    )
  },
)
CutRegionBlock.displayName = 'CutRegionBlock'
