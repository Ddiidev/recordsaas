import React from 'react'
import { Scissors, ZoomIn, Trash, ArrowBackUp, ArrowForwardUp, PlayerTrackNext, Search } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import type { AspectRatio } from '../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { cn } from '../../lib/utils'

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'icon'
  children: React.ReactNode
}

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ variant = 'default', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-40',
          variant === 'icon' ? 'h-10 w-10 rounded-xl' : 'h-10 px-4 rounded-xl text-sm gap-2',
          disabled
            ? 'bg-card/80 text-muted-foreground/50 border border-border/20 shadow-sm'
            : 'bg-card/90 text-foreground border border-border/40 shadow-sm hover:bg-accent hover:text-accent-foreground hover:border-border/60 hover:shadow-md',
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  },
)
ToolbarButton.displayName = 'ToolbarButton'

export function PreviewControls() {
  const {
    addZoomRegion,
    addCutRegion,
    addSpeedRegion,
    addBlurRegion,
    timelineZoom,
    setTimelineZoom,
    selectedRegionId,
    deleteRegion,
    aspectRatio,
    setAspectRatio,
  } = useEditorStore()

  const { undo, redo, pastStates, futureStates } = useEditorStore.temporal.getState()

  const handleDelete = () => {
    if (selectedRegionId) {
      deleteRegion(selectedRegionId)
    }
  }

  return (
    <div className="h-18 bg-card/95 backdrop-blur-xl border-t border-border/60 flex items-center justify-between px-6 shadow-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ToolbarButton title="Add Zoom Region" onClick={() => addZoomRegion()} disabled={!!selectedRegionId}>
            <ZoomIn className="w-4 h-4" />
            <span>Zoom</span>
          </ToolbarButton>
          <ToolbarButton title="Add Cut Region" onClick={() => addCutRegion()} disabled={!!selectedRegionId}>
            <Scissors className="w-4 h-4" />
            <span>Trim</span>
          </ToolbarButton>
          <ToolbarButton title="Add Speed Region" onClick={() => addSpeedRegion()} disabled={!!selectedRegionId}>
            <PlayerTrackNext className="w-4 h-4" />
            <span>Speed</span>
          </ToolbarButton>
          <ToolbarButton title="Add Blur Region" onClick={() => addBlurRegion()} disabled={!!selectedRegionId}>
            <Search className="w-4 h-4" />
            <span>Blur</span>
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            title="Delete Selected Region"
            onClick={handleDelete}
            disabled={!selectedRegionId}
          >
            <Trash className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-2">
          <ToolbarButton variant="icon" title="Undo (Ctrl+Z)" onClick={() => undo()} disabled={pastStates.length === 0}>
            <ArrowBackUp className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            title="Redo (Ctrl+Y)"
            onClick={() => redo()}
            disabled={futureStates.length === 0}
          >
            <ArrowForwardUp className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-4 ml-2">
          <ZoomIn className="w-4 h-4 text-muted-foreground" />
          <div className="w-24">
            <Slider min={1} max={4} step={0.5} value={timelineZoom} onChange={setTimelineZoom} />
          </div>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-muted-foreground">Aspect:</span>
        <div className="w-40">
          <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}>
            <SelectTrigger className="h-10 text-sm border-border bg-card shadow-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16:9">16:9 Landscape</SelectItem>
              <SelectItem value="9:16">9:16 Portrait</SelectItem>
              <SelectItem value="4:3">4:3 Standard</SelectItem>
              <SelectItem value="3:4">3:4 Tall</SelectItem>
              <SelectItem value="1:1">1:1 Square</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
