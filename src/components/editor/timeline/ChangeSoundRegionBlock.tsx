import { memo, useMemo, useState } from 'react'
import { AdjustmentsHorizontal, Scissors, Trash } from '@icons'
import type { ChangeSoundRegion, TimelineRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { useEditorStore } from '../../../store/editorStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider, ContextMenuLabel } from '../../ui/context-menu'
import { RegionResizeHandles } from './RegionResizeHandles'

interface ChangeSoundRegionBlockProps {
  region: ChangeSoundRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

export const ChangeSoundRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: ChangeSoundRegionBlockProps) => {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const currentTime = useEditorStore((state) => state.currentTime)
    const { splitChangeSoundRegion, deleteRegion } = useEditorStore.getState()

    const canSplitAtPlayhead = useMemo(() => {
      const localOffset = currentTime - region.startTime
      return localOffset > 0.1 && localOffset < region.duration - 0.1
    }, [currentTime, region.duration, region.startTime])

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setMenuPosition({ x: e.clientX, y: e.clientY })
      setMenuOpen(true)
    }

    const handleSplit = () => {
      splitChangeSoundRegion(region.id, currentTime)
      setMenuOpen(false)
    }

    const handleDelete = () => {
      deleteRegion(region.id)
      setMenuOpen(false)
    }

    return (
      <>
        <div
          ref={setRef}
          data-region-id={region.id}
          className={cn(
            'group/region absolute inset-y-0 left-0 w-full flex items-center justify-center rounded-md cursor-grab border-2 backdrop-blur-sm',
            !isBeingDragged && 'transition-all duration-200 ease-out',
            isSelected
              ? 'bg-card/90 border-sky-500 shadow-sm shadow-sky-500/20'
              : 'bg-card/70 border-sky-500/60 hover:border-sky-500 hover:bg-card/80 hover:shadow-md hover:shadow-sky-500/10',
          )}
          style={{ willChange: 'transform, width' }}
          onMouseDown={(e) => onMouseDown(e, region, 'move')}
          onContextMenu={handleContextMenu}
        >
          <RegionResizeHandles
            isSelected={isSelected}
            indicatorClassName="bg-sky-500/60 group-hover/resize-handle:bg-sky-500"
            onMouseDown={(event, side) => {
              event.stopPropagation()
              onMouseDown(event, region, side)
            }}
          />

          <div className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-2">
            <AdjustmentsHorizontal
              className={cn('h-3.5 w-3.5 shrink-0 transition-colors text-sky-500', !isSelected && 'opacity-70')}
            />
            <span
              className={cn(
                'text-[10px] font-bold tracking-wide select-none whitespace-nowrap transition-colors text-sky-500',
                !isSelected && 'opacity-70',
              )}
            >
              CHANGE SOUND
            </span>
          </div>

        </div>

        <ContextMenu
          isOpen={isMenuOpen}
          onClose={() => setMenuOpen(false)}
          position={menuPosition}
          className="min-w-[180px]"
        >
          <ContextMenuLabel>Change Sound</ContextMenuLabel>
          <ContextMenuItem
            disabled={!canSplitAtPlayhead}
            onClick={handleSplit}
            className="text-foreground hover:bg-accent/80 hover:text-foreground"
          >
            <Scissors className="w-4 h-4" />
            <span>Split at playhead</span>
          </ContextMenuItem>
          <ContextMenuDivider />
          <ContextMenuItem
            onClick={handleDelete}
            className="text-destructive hover:bg-destructive/20 hover:text-destructive"
          >
            <Trash className="w-4 h-4" />
            <span>Delete clip</span>
          </ContextMenuItem>
        </ContextMenu>
      </>
    )
  },
)

ChangeSoundRegionBlock.displayName = 'ChangeSoundRegionBlock'
