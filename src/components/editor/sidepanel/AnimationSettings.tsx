import { useEditorStore } from '../../../store/editorStore'
import type { ZoomRegion } from '../../../types'
import { Collapse } from '../../ui/collapse'
import { Route } from 'tabler-icons-react'
import { ZOOM, DEFAULTS } from '../../../lib/constants'
import { EASING_MAP } from '../../../lib/easing'
import { cn } from '../../../lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Slider } from '../../ui/slider'

const speedOptions = Object.keys(ZOOM.SPEED_OPTIONS)
const easingOptions = Object.keys(EASING_MAP)

interface AnimationSettingsProps {
  region: ZoomRegion
}

export function AnimationSettings({ region }: AnimationSettingsProps) {
  const { updateRegion } = useEditorStore.getState()

  const handleSpeedChange = (speed: string) => {
    const duration = ZOOM.SPEED_OPTIONS[speed as keyof typeof ZOOM.SPEED_OPTIONS]
    updateRegion(region.id, { transitionDuration: duration })
  }

  const handleEasingChange = (easing: string) => {
    updateRegion(region.id, { easing })
  }

  const handleZoomLevelChange = (value: number) => {
    updateRegion(region.id, { zoomLevel: value })
  }

  const handleResetAnimation = () => {
    updateRegion(region.id, {
      transitionDuration: ZOOM.SPEED_OPTIONS[DEFAULTS.ANIMATION.SPEED.defaultValue as keyof typeof ZOOM.SPEED_OPTIONS],
      easing: DEFAULTS.ANIMATION.EASING.defaultValue,
      zoomLevel: DEFAULTS.ANIMATION.ZOOM_LEVEL.defaultValue,
    })
  }

  const currentSpeed =
    speedOptions.find(
      (speed) => ZOOM.SPEED_OPTIONS[speed as keyof typeof ZOOM.SPEED_OPTIONS] === region.transitionDuration,
    ) || ZOOM.DEFAULT_SPEED

  return (
    <Collapse
      title="Animation & Level"
      description="Adjust transition and zoom level"
      icon={<Route className="w-4 h-4 text-primary" />}
      defaultOpen={true}
      onReset={handleResetAnimation}
    >
      <div className="space-y-6">
        {/* Speed Selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-sidebar-foreground">Speed</label>
          <div className="grid grid-cols-4 gap-1 p-1 bg-muted/50 rounded-lg">
            {speedOptions.map((speed) => (
              <button
                key={speed}
                onClick={() => handleSpeedChange(speed)}
                className={cn(
                  'py-2 text-sm font-medium rounded-md transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  currentSpeed === speed
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {speed}
              </button>
            ))}
          </div>
        </div>

        {/* Easing Selector */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-sidebar-foreground">Style (Easing)</label>
          <Select value={region.easing} onValueChange={handleEasingChange}>
            <SelectTrigger className="h-10 bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {easingOptions.map((easing) => (
                <SelectItem key={easing} value={easing}>
                  {easing}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Zoom Level */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-sidebar-foreground">Zoom Level</label>
            <span className="text-xs font-semibold text-primary tabular-nums">{region.zoomLevel.toFixed(1)}x</span>
          </div>
          <Slider
            min={DEFAULTS.ANIMATION.ZOOM_LEVEL.min}
            max={DEFAULTS.ANIMATION.ZOOM_LEVEL.max}
            step={DEFAULTS.ANIMATION.ZOOM_LEVEL.step}
            value={region.zoomLevel}
            onChange={handleZoomLevelChange}
          />
        </div>
      </div>
    </Collapse>
  )
}
