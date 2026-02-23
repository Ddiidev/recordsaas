// Settings panel for editing timeline regions (zoom, cut, and blur)
import { useState, useEffect } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { TimelineRegion, ZoomRegion, BlurRegion, BlurRegionStyle, SpeedRegion, CameraSwapRegion } from '../../types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Camera, Scissors, Pointer, Video, Trash, Search, PlayerTrackNext, Refresh } from 'tabler-icons-react'
import { FocusPointPicker } from './sidepanel/FocusPointPicker'
import { AnimationSettings } from './sidepanel/AnimationSettings'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { BLUR_REGION } from '../../lib/constants'
import { Switch } from '../ui/switch'

interface RegionSettingsPanelProps {
  region: TimelineRegion
}

function ZoomSettings({ region }: { region: ZoomRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  const [activeTab, setActiveTab] = useState(region.mode)

  const handleModeChange = (newMode: 'auto' | 'fixed') => {
    setActiveTab(newMode)
    updateRegion(region.id, { mode: newMode })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-sidebar-foreground mb-3 tracking-tight">Zoom Type</h3>
        <div className="grid grid-cols-2 gap-2 p-1 bg-muted/50 rounded-lg">
          <Button
            variant={activeTab === 'auto' ? 'secondary' : 'ghost'}
            onClick={() => handleModeChange('auto')}
            className="h-auto py-2.5 flex items-center justify-center gap-2 transition-all duration-200"
          >
            <Pointer className="w-4 h-4" />
            <span className="font-medium">Auto</span>
          </Button>
          <Button
            variant={activeTab === 'fixed' ? 'secondary' : 'ghost'}
            onClick={() => handleModeChange('fixed')}
            className="h-auto py-2.5 flex items-center justify-center gap-2 transition-all duration-200"
          >
            <Video className="w-4 h-4" />
            <span className="font-medium">Fixed</span>
          </Button>
        </div>
      </div>

      {activeTab === 'auto' && (
        <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-3">
            <Pointer className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Auto Tracking</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Zoom will automatically follow the mouse cursor in this area.
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'fixed' && (
        <FocusPointPicker
          regionId={region.id}
          targetX={region.targetX}
          targetY={region.targetY}
          startTime={region.startTime}
          onTargetChange={({ x, y }) => updateRegion(region.id, { targetX: x, targetY: y })}
        />
      )}

      <AnimationSettings region={region} />

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

function BlurSettings({ region }: { region: BlurRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  const updateBlurRect = (updates: Partial<Pick<BlurRegion, 'x' | 'y' | 'width' | 'height'>>) => {
    const width = clamp(updates.width ?? region.width, BLUR_REGION.WIDTH.min, BLUR_REGION.WIDTH.max)
    const height = clamp(updates.height ?? region.height, BLUR_REGION.HEIGHT.min, BLUR_REGION.HEIGHT.max)
    const x = clamp(updates.x ?? region.x, BLUR_REGION.X.min, BLUR_REGION.X.max - width)
    const y = clamp(updates.y ?? region.y, BLUR_REGION.Y.min, BLUR_REGION.Y.max - height)

    updateRegion(region.id, { x, y, width, height })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Style</span>
        <Select
          value={region.style}
          onValueChange={(value) => updateRegion(region.id, { style: value as BlurRegionStyle })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blur">Blur</SelectItem>
            <SelectItem value="pixelated">Pixelated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Intensity</span>
          <span className="text-xs font-semibold text-primary tabular-nums">{region.intensity}</span>
        </div>
        <Slider
          min={BLUR_REGION.INTENSITY.min}
          max={BLUR_REGION.INTENSITY.max}
          step={BLUR_REGION.INTENSITY.step}
          value={region.intensity}
          onChange={(value) => updateRegion(region.id, { intensity: value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Position X</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.x * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.X.min}
            max={BLUR_REGION.X.max}
            step={BLUR_REGION.X.step}
            value={region.x}
            onChange={(value) => updateBlurRect({ x: value })}
          />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Position Y</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.y * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.Y.min}
            max={BLUR_REGION.Y.max}
            step={BLUR_REGION.Y.step}
            value={region.y}
            onChange={(value) => updateBlurRect({ y: value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Width</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.width * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.WIDTH.min}
            max={BLUR_REGION.WIDTH.max}
            step={BLUR_REGION.WIDTH.step}
            value={region.width}
            onChange={(value) => updateBlurRect({ width: value })}
          />
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Height</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{Math.round(region.height * 100)}%</span>
          </div>
          <Slider
            min={BLUR_REGION.HEIGHT.min}
            max={BLUR_REGION.HEIGHT.max}
            step={BLUR_REGION.HEIGHT.step}
            value={region.height}
            onChange={(value) => updateBlurRect({ height: value })}
          />
        </div>
      </div>

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

const SPEED_OPTIONS = [1, 1.2, 1.4, 1.5, 1.6, 2, 3, 4, 8, 16]

function SpeedSettings({ region }: { region: SpeedRegion }) {
  const { updateRegion, deleteRegion, applySpeedToAll } = useEditorStore.getState()

  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Playback Speed</span>
        <Select
          value={String(region.speed)}
          onValueChange={(value) => updateRegion(region.id, { speed: Number(value) })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEED_OPTIONS.map((speed) => (
              <SelectItem key={speed} value={String(speed)}>
                {speed}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="pt-2 space-y-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => applySpeedToAll(region.speed)}
          className="w-full h-10 border-border hover:bg-accent hover:text-accent-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <span>Apply {region.speed}x to all</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

function SwapSettings({ region }: { region: CameraSwapRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()
  const [durationText, setDurationText] = useState((region.transitionDuration ?? 0.3).toFixed(1))

  useEffect(() => {
    setDurationText((region.transitionDuration ?? 0.3).toFixed(1))
  }, [region.transitionDuration])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <span className="text-sm font-medium text-sidebar-foreground block">Show Desktop Overlay</span>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Keep the screen visible in a smaller window
          </p>
        </div>
        <Switch
          checked={region.showDesktopOverlay}
          onCheckedChange={(checked) => updateRegion(region.id, { showDesktopOverlay: checked })}
        />
      </div>

      <div className="space-y-2.5">
        <span className="text-sm font-medium text-sidebar-foreground">Transition Animation</span>
        <Select
          value={region.transition}
          onValueChange={(value) => updateRegion(region.id, { transition: value as CameraSwapRegion['transition'] })}
        >
          <SelectTrigger className="h-10 text-sm border-border bg-card shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (Instant)</SelectItem>
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="slide">Slide</SelectItem>
            <SelectItem value="scale">Scale</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {region.transition !== 'none' && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-sidebar-foreground">Transition Duration (s)</span>
            <input
              type="text"
              inputMode="decimal"
              value={durationText}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.')
                setDurationText(raw)
                const val = parseFloat(raw)
                if (!isNaN(val) && val >= 0.1 && val <= 2.0) {
                  updateRegion(region.id, { transitionDuration: Number(val.toFixed(1)) })
                }
              }}
              onBlur={() => {
                const val = parseFloat(durationText.replace(',', '.'))
                const clamped = isNaN(val) ? 0.3 : Math.max(0.1, Math.min(2.0, val))
                const rounded = Number(clamped.toFixed(1))
                setDurationText(rounded.toFixed(1))
                updateRegion(region.id, { transitionDuration: rounded })
              }}
              className="w-16 h-8 px-2 text-xs font-semibold text-primary tabular-nums bg-transparent border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-right"
            />
          </div>
          <Slider
            min={0.1}
            max={2.0}
            step={0.1}
            value={region.transitionDuration ?? 0.3}
            onChange={(value) => updateRegion(region.id, { transitionDuration: Number(value.toFixed(1)) })}
          />
        </div>
      )}

      <div className="pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteRegion(region.id)}
          className="w-full h-10 bg-destructive/10 hover:bg-destructive text-destructive hover:text-destructive-foreground transition-all duration-200 flex items-center gap-2 justify-center font-medium"
        >
          <Trash className="w-4 h-4" />
          <span>Delete Region</span>
        </Button>
      </div>
    </div>
  )
}

export function RegionSettingsPanel({ region }: RegionSettingsPanelProps) {
  const RegionIcon = region.type === 'zoom' ? Camera : region.type === 'cut' ? Scissors : region.type === 'speed' ? PlayerTrackNext : region.type === 'swap' ? Refresh : Search
  const regionColor =
    region.type === 'zoom' ? 'text-primary' : region.type === 'cut' ? 'text-destructive' : region.type === 'speed' ? 'text-speed-accent' : region.type === 'swap' ? 'text-orange-500' : 'text-amber-500'
  const regionBg =
    region.type === 'zoom' ? 'bg-primary/10' : region.type === 'cut' ? 'bg-destructive/10' : region.type === 'speed' ? 'bg-speed-accent/10' : region.type === 'swap' ? 'bg-orange-500/10' : 'bg-amber-500/10'

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', regionBg)}>
            <RegionIcon className={cn('w-5 h-5', regionColor)} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground capitalize">{region.type} Region</h2>
            <p className="text-sm text-muted-foreground">
              {region.type === 'zoom'
                ? 'Zoom and pan controls'
                : region.type === 'cut'
                  ? 'Cut segment settings'
                  : region.type === 'speed'
                    ? 'Playback speed controls'
                    : region.type === 'swap'
                      ? 'Camera swap settings'
                      : 'Blur asset controls'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* Zoom-specific Controls */}
        {region.type === 'zoom' && <ZoomSettings region={region} />}

        {/* Blur-specific Controls */}
        {region.type === 'blur' && <BlurSettings region={region} />}

        {/* Speed-specific Controls */}
        {region.type === 'speed' && <SpeedSettings region={region as SpeedRegion} />}

        {/* Swap-specific Controls */}
        {region.type === 'swap' && <SwapSettings region={region} />}

        {/* Cut Region Info */}
        {region.type === 'cut' && (
          <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
            <div className="flex items-start gap-3">
              <Scissors className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Cut Segment</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This portion will be removed from the final video
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
