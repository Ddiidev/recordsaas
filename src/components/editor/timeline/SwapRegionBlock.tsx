import React, { useMemo } from 'react'
import type { CameraSwapRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Refresh } from '@icons'
import { RegionResizeHandles } from './RegionResizeHandles'

interface SwapRegionBlockProps {
  region: CameraSwapRegion
  isSelected: boolean
  isBeingDragged?: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: CameraSwapRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef?: (el: HTMLDivElement | null) => void
}

export const SwapRegionBlock = React.memo(function SwapRegionBlock({
  region,
  isSelected,
  isBeingDragged,
  onMouseDown,
  setRef,
}: SwapRegionBlockProps) {
  const isShortDuration = region.duration < 0.5

  const transitionLabel = useMemo(() => {
    switch (region.transition) {
      case 'none':
        return 'No Trans.'
      case 'fade':
        return 'Fade'
      case 'slide':
        return 'Slide'
      case 'scale':
        return 'Scale'
      default:
        return 'Swap'
    }
  }, [region.transition])

  return (
    <div
      ref={setRef}
      data-region-id={region.id}
      className={cn(
        'group/region absolute w-full h-12 top-0 rounded-xl cursor-grab border-2 backdrop-blur-sm',
        !isBeingDragged && 'transition-all duration-200 ease-out',
        isSelected
          ? 'bg-card/90 border-purple-500 transform -translate-y-[2px] shadow-sm shadow-purple-500/20'
          : 'bg-card/70 border-purple-500/60 hover:border-purple-500 hover:bg-card/80 hover:shadow-md hover:shadow-purple-500/10',
      )}
      style={{ willChange: 'transform, width' }}
      onMouseDown={(e) => onMouseDown(e, region, 'move')}
    >
      <RegionResizeHandles
        isSelected={isSelected}
        indicatorClassName="bg-purple-500/60 group-hover/resize-handle:bg-purple-500"
        onMouseDown={(event, side) => {
          event.stopPropagation()
          onMouseDown(event, region, side)
        }}
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-3">
        <div className="flex items-center gap-2 overflow-hidden">
          <Refresh className={cn('w-4 h-4 shrink-0 transition-colors text-purple-500', !isSelected && 'opacity-70')} />
          <span
            className={cn(
              'text-sm font-bold tracking-wide select-none whitespace-nowrap transition-colors text-purple-500',
              !isSelected && 'opacity-70',
            )}
          >
            SWAP {!isShortDuration && `(${transitionLabel})`}
          </span>
        </div>
      </div>

    </div>
  )
})
