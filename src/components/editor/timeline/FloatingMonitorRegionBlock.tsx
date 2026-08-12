import { memo, useMemo, useState } from 'react'
import { DeviceComputerCamera, Scissors, Trash } from '@icons'
import type { FloatingMonitorRegion, TimelineRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { useEditorStore } from '../../../store/editorStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider, ContextMenuLabel } from '../../ui/context-menu'
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
  ({ region, name, isSelected, isBeingDragged, onMouseDown, setRef }: FloatingMonitorRegionBlockProps) => {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const currentTime = useEditorStore((state) => state.currentTime)
    const { splitFloatingMonitorRegion, deleteRegion } = useEditorStore.getState()

    const canSplitAtPlayhead = useMemo(() => {
      const localOffset = currentTime - region.startTime
      return localOffset > 0.1 && localOffset < region.duration - 0.1
    }, [currentTime, region.duration, region.startTime])

    const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setMenuPosition({ x: event.clientX, y: event.clientY })
      setMenuOpen(true)
    }

    const handleSplit = () => {
      splitFloatingMonitorRegion(region.id, currentTime)
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
            'group/region absolute h-12 w-full rounded-xl border-2 bg-card/75 backdrop-blur-sm overflow-hidden',
            !isBeingDragged && 'transition-all duration-200 ease-out',
            isSelected
              ? 'border-violet-500 bg-card/95 shadow-sm shadow-violet-500/20'
              : 'border-border/60 hover:border-violet-500 hover:bg-card/90 hover:shadow-md hover:shadow-violet-500/10',
          )}
          onMouseDown={(event) => onMouseDown(event, region, 'move')}
          onContextMenu={handleContextMenu}
        >
          <RegionResizeHandles
            isSelected={isSelected}
            indicatorClassName="bg-violet-500/60 group-hover/resize-handle:bg-violet-500"
            onMouseDown={(event, side) => {
              event.stopPropagation()
              onMouseDown(event, region, side)
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 overflow-hidden px-2 text-violet-500 dark:text-violet-300 min-w-0">
            <DeviceComputerCamera className="h-4 w-4 shrink-0" />
            <span className="truncate text-xs font-bold tracking-wide min-w-0">{name}</span>
          </div>
        </div>

        <ContextMenu
          isOpen={isMenuOpen}
          onClose={() => setMenuOpen(false)}
          position={menuPosition}
          className="min-w-[180px]"
        >
          <ContextMenuLabel>Floating Monitor</ContextMenuLabel>
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

FloatingMonitorRegionBlock.displayName = 'FloatingMonitorRegionBlock'