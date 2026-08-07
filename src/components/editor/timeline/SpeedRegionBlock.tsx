import { memo, useState } from 'react'
import { TimelineRegion, SpeedRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { PlayerTrackNext, Check } from '@icons'
import { useEditorStore } from '../../../store/editorStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider, ContextMenuLabel } from '../../ui/context-menu'
import { RegionResizeHandles } from './RegionResizeHandles'

interface SpeedRegionBlockProps {
  region: SpeedRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

const SPEED_OPTIONS = [1, 1.2, 1.4, 1.5, 1.6, 2, 3, 4, 8, 16]

export const SpeedRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: SpeedRegionBlockProps) => {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const { updateRegion, applySpeedToAll } = useEditorStore.getState()

    const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'resize-left' | 'resize-right') => {
      // Move stopPropagation inside the check to allow right-clicks
      if (e.button === 0) {
        e.stopPropagation()
        onMouseDown(e, region, type)
      }
    }

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setMenuPosition({ x: e.clientX, y: e.clientY })
      setMenuOpen(true)
    }

    const handleSpeedSelect = (speed: number) => {
      updateRegion(region.id, { speed })
      setMenuOpen(false)
    }

    const handleApplyToAll = () => {
      applySpeedToAll(region.speed)
      setMenuOpen(false)
    }

    return (
      <>
        <div
          ref={setRef}
          data-region-id={region.id}
          className={cn(
          'group/region absolute w-full h-12 top-0 rounded-xl cursor-grab border-2 backdrop-blur-sm',
            !isBeingDragged && 'transition-all duration-200 ease-out',
            isSelected
              ? 'bg-card/90 border-speed-accent transform -translate-y-[2px] shadow-sm shadow-speed-accent/20'
              : 'bg-card/70 border-border/60 hover:border-speed-accent/80 hover:bg-card/80 hover:shadow-md hover:shadow-speed-accent/10',
          )}
          style={{ willChange: 'transform, width' }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation()
              onMouseDown(e, region, 'move')
            }
          }}
          onContextMenu={handleContextMenu}
        >
          <RegionResizeHandles
            isSelected={isSelected}
            indicatorClassName="bg-speed-accent/50 group-hover/resize-handle:bg-speed-accent"
            onMouseDown={handleResizeMouseDown}
          />

          {/* Content */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <PlayerTrackNext
                className={cn('w-4 h-4 shrink-0 transition-colors text-speed-accent', !isSelected && 'opacity-70')}
              />
              <span
                className={cn(
                  'text-sm font-bold tracking-wide select-none whitespace-nowrap transition-colors text-speed-accent',
                  !isSelected && 'opacity-70',
                )}
              >
                {region.speed}x
              </span>
            </div>
          </div>
        </div>

        {/* Context Menu */}
        <ContextMenu
          isOpen={isMenuOpen}
          onClose={() => setMenuOpen(false)}
          position={menuPosition}
          className="min-w-[120px]"
        >
          <ContextMenuLabel>Speed</ContextMenuLabel>
          {SPEED_OPTIONS.map((speed) => (
            <ContextMenuItem key={speed} onClick={() => handleSpeedSelect(speed)}>
              <span className="flex-1">{speed}x</span>
              {region.speed === speed && <Check className="w-4 h-4" />}
            </ContextMenuItem>
          ))}
          <ContextMenuDivider />
          <ContextMenuItem onClick={handleApplyToAll}>Apply to all</ContextMenuItem>
        </ContextMenu>
      </>
    )
  },
)

SpeedRegionBlock.displayName = 'SpeedRegionBlock'
