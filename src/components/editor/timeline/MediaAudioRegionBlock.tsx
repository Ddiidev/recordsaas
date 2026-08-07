import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Music, Scissors, Trash } from '@icons'
import type { MediaAudioRegion, TimelineRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { useEditorStore } from '../../../store/editorStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider, ContextMenuLabel } from '../../ui/context-menu'
import { RegionResizeHandles } from './RegionResizeHandles'

interface MediaAudioRegionBlockProps {
  region: MediaAudioRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

export const MediaAudioRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: MediaAudioRegionBlockProps) => {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const [mediaNameOverflowPx, setMediaNameOverflowPx] = useState(0)
    const currentTime = useEditorStore((state) => state.currentTime)
    const mediaAudioName = useEditorStore((state) => state.mediaAudioClip?.name || 'Imported audio')
    const { splitMediaAudioRegion, deleteRegion } = useEditorStore.getState()
    const mediaNameContainerRef = useRef<HTMLDivElement>(null)
    const mediaNameTextRef = useRef<HTMLSpanElement>(null)

    const canSplitAtPlayhead = useMemo(() => {
      const localOffset = currentTime - region.startTime
      return localOffset > 0.1 && localOffset < region.duration - 0.1
    }, [currentTime, region.duration, region.startTime])
    const shouldMarqueeMediaName = mediaNameOverflowPx > 0.5
    const marqueeDurationSeconds = useMemo(() => Math.max(5, mediaNameOverflowPx / 24), [mediaNameOverflowPx])

    useEffect(() => {
      const container = mediaNameContainerRef.current
      const text = mediaNameTextRef.current
      if (!container || !text) return

      const measureOverflow = () => {
        const overflow = Math.max(0, text.scrollWidth - container.clientWidth)
        setMediaNameOverflowPx((previous) => (Math.abs(previous - overflow) < 0.5 ? previous : overflow))
      }

      measureOverflow()

      const observer = new ResizeObserver(() => {
        measureOverflow()
      })
      observer.observe(container)
      observer.observe(text)

      return () => {
        observer.disconnect()
      }
    }, [mediaAudioName, region.duration])

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setMenuPosition({ x: e.clientX, y: e.clientY })
      setMenuOpen(true)
    }

    const handleSplit = () => {
      splitMediaAudioRegion(region.id, currentTime)
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
            'group/region absolute w-full h-12 top-0 rounded-xl cursor-grab border-2 backdrop-blur-sm',
            !isBeingDragged && 'transition-all duration-200 ease-out',
            isSelected
              ? 'bg-card/90 border-emerald-500 transform -translate-y-[2px] shadow-sm shadow-emerald-500/20'
              : 'bg-card/70 border-emerald-500/60 hover:border-emerald-500 hover:bg-card/80 hover:shadow-md hover:shadow-emerald-500/10',
          )}
          style={{ willChange: 'transform, width' }}
          onMouseDown={(e) => onMouseDown(e, region, 'move')}
          onContextMenu={handleContextMenu}
        >
          <RegionResizeHandles
            isSelected={isSelected}
            indicatorClassName="bg-emerald-500/60 group-hover/resize-handle:bg-emerald-500"
            onMouseDown={(event, side) => {
              event.stopPropagation()
              onMouseDown(event, region, side)
            }}
          />

          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
            <div className="flex w-full flex-col items-center overflow-hidden">
              <div className="flex items-center gap-2 overflow-hidden">
                <Music
                  className={cn('w-4 h-4 shrink-0 transition-colors text-emerald-500', !isSelected && 'opacity-70')}
                />
                <span
                  className={cn(
                    'text-sm font-bold tracking-wide select-none whitespace-nowrap transition-colors text-emerald-500',
                    !isSelected && 'opacity-70',
                  )}
                >
                  MEDIA AUDIO
                </span>
              </div>

              <div ref={mediaNameContainerRef} className="mt-0.5 w-full overflow-hidden">
                <span
                  ref={mediaNameTextRef}
                  className={cn(
                    'block whitespace-nowrap text-[10px] font-medium tracking-wide text-emerald-600/90',
                    !isSelected && 'opacity-70',
                    shouldMarqueeMediaName && 'media-name-marquee-ltr',
                  )}
                  style={
                    shouldMarqueeMediaName
                      ? ({
                          '--marquee-from': `${-mediaNameOverflowPx}px`,
                          '--marquee-to': '0px',
                          animationDuration: `${marqueeDurationSeconds.toFixed(2)}s`,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  {mediaAudioName}
                </span>
              </div>
            </div>
          </div>

        </div>

        <ContextMenu
          isOpen={isMenuOpen}
          onClose={() => setMenuOpen(false)}
          position={menuPosition}
          className="min-w-[180px]"
        >
          <ContextMenuLabel>Audio Clip</ContextMenuLabel>
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

MediaAudioRegionBlock.displayName = 'MediaAudioRegionBlock'
