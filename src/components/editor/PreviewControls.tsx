import { Scissors, ZoomIn, Trash, ArrowBackUp, ArrowForwardUp, PlayerTrackNext, Search, Refresh } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import type { AspectRatio } from '../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { ToolbarButton } from './ToolbarButton'

export function PreviewControls() {
  const {
    addZoomRegion,
    addCutRegion,
    addSpeedRegion,
    addBlurRegion,
    addSwapRegion,
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
          <ToolbarButton tooltip="Add Zoom Region" onClick={() => addZoomRegion()} disabled={!!selectedRegionId}>
            <ZoomIn className="w-4 h-4" />
            <span>Zoom</span>
          </ToolbarButton>
          <ToolbarButton tooltip="Add Cut Region" onClick={() => addCutRegion()} disabled={!!selectedRegionId}>
            <Scissors className="w-4 h-4" />
            <span>Trim</span>
          </ToolbarButton>
          <ToolbarButton tooltip="Add Speed Region" onClick={() => addSpeedRegion()} disabled={!!selectedRegionId}>
            <PlayerTrackNext className="w-4 h-4" />
            <span>Speed</span>
          </ToolbarButton>
          <ToolbarButton tooltip="Add Blur Region" onClick={() => addBlurRegion()} disabled={!!selectedRegionId}>
            <Search className="w-4 h-4" />
            <span>Blur</span>
          </ToolbarButton>
          <ToolbarButton tooltip="Add Camera Swap" onClick={() => addSwapRegion()} disabled={!!selectedRegionId}>
            <Refresh className="w-4 h-4" />
            <span>Swap</span>
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            tooltip="Delete Selected Region"
            onClick={handleDelete}
            disabled={!selectedRegionId}
          >
            <Trash className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-2">
          <ToolbarButton variant="icon" tooltip="Undo (Ctrl+Z)" onClick={() => undo()} disabled={pastStates.length === 0}>
            <ArrowBackUp className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            tooltip="Redo (Ctrl+Y)"
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
            <SelectTrigger className="h-10 text-sm border-border bg-card">
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
