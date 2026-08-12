import type { MouseEvent } from 'react'
import { cn } from '../../../lib/utils'

type ResizeSide = 'resize-left' | 'resize-right'

interface RegionResizeHandlesProps {
  isSelected: boolean
  indicatorClassName: string
  onMouseDown: (event: MouseEvent<HTMLDivElement>, side: ResizeSide) => void
  canResizeLeft?: boolean
  canResizeRight?: boolean
}

export function RegionResizeHandles({
  isSelected,
  indicatorClassName,
  onMouseDown,
  canResizeLeft = true,
  canResizeRight = true,
}: RegionResizeHandlesProps) {
  const visibilityClassName = isSelected
    ? 'pointer-events-auto opacity-100'
    : 'pointer-events-none opacity-0 group-hover/region:pointer-events-auto group-hover/region:opacity-100'

  const renderHandle = (side: ResizeSide) => (
    <div
      className={cn(
        'group/resize-handle absolute inset-y-0 z-20 flex w-6 cursor-ew-resize items-center justify-center transition-opacity duration-150',
        side === 'resize-left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2',
        visibilityClassName,
      )}
      onMouseDown={(event) => onMouseDown(event, side)}
    >
      <div
        className={cn(
          'h-7 w-1 rounded-full transition-[height,background-color] duration-150 group-hover/resize-handle:h-9',
          indicatorClassName,
        )}
      />
    </div>
  )

  return (
    <>
      {canResizeLeft && renderHandle('resize-left')}
      {canResizeRight && renderHandle('resize-right')}
    </>
  )
}
