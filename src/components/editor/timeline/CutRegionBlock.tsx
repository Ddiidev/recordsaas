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
          'group/region absolute inset-y-0 left-0 w-full flex items-center justify-center rounded-md border-2 backdrop-blur-sm',
          !isBeingDragged && 'transition-all duration-200 ease-out',
          canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          isSelected
            ? 'bg-card/90 border-destructive shadow-sm shadow-destructive/20'
            : 'bg-card/70 border-destructive/60 hover:border-destructive/80 hover:bg-card/80 hover:shadow-md hover:shadow-destructive/10',
        )}
        style={{ willChange: 'transform, width' }}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        <RegionResizeHandles
          isSelected={isSelected}
          canResizeLeft={canResizeLeft}
          canResizeRight={canResizeRight}
          indicatorClassName="bg-destructive/50 group-hover/resize-handle:bg-destructive"
          onMouseDown={handleMouseDown}
        />

        <div className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-2">
          <Scissors
            className={cn('h-3.5 w-3.5 shrink-0 transition-colors', isSelected ? 'text-destructive' : 'text-destructive/70')}
          />
          <span
            className={cn(
              'overflow-hidden text-ellipsis text-[10px] font-semibold tracking-wide transition-colors',
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
