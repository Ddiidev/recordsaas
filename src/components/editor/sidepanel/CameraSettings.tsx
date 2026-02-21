// Settings panel for webcam overlay (visibility, position, size, shadow)
import { useMemo } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { ControlGroup } from './ControlGroup'
import {
  DeviceComputerCamera,
  Eye,
  Photo,
  Circle,
  Square,
  Rectangle,
  Wand,
  BorderRadius,
  SquareToggle,
  DeviceComputerCameraOff,
  ZoomIn,
  ArrowsUpRight,
} from 'tabler-icons-react'
import { Button } from '../../ui/button'
import { Switch } from '../../ui/switch'
import { Slider } from '../../ui/slider'
import { ColorPicker } from '../../ui/color-picker'
import { rgbaToHexAlpha, hexToRgb } from '../../../lib/utils'
import { useShallow } from 'zustand/react/shallow'
import { Collapse } from '../../ui/collapse'
import { cn } from '../../../lib/utils'
import type { WebcamPosition } from '../../../types'
import { DEFAULTS } from '../../../lib/constants'
import { TransformPointBottomLeftIcon } from '../../ui/icons'

const DisabledPanelPlaceholder = ({
  icon,
  title,
  message,
}: {
  icon: React.ReactNode
  title: string
  message: string
}) => (
  <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-muted/30">
    <div className="w-16 h-16 rounded-full bg-background/60 flex items-center justify-center mb-4 border border-border">
      {icon}
    </div>
    <h3 className="font-semibold text-foreground">{title}</h3>
    <p className="text-sm text-muted-foreground mt-1 max-w-xs">{message}</p>
  </div>
)

export function CameraSettings() {
  const {
    webcamVideoUrl,
    isWebcamVisible,
    webcamPosition,
    webcamStyles,
    setWebcamVisibility,
    setWebcamPosition,
    updateWebcamStyle,
  } = useEditorStore(
    useShallow((state) => ({
      webcamVideoUrl: state.webcamVideoUrl,
      isWebcamVisible: state.isWebcamVisible,
      webcamPosition: state.webcamPosition,
      webcamStyles: state.webcamStyles,
      setWebcamVisibility: state.setWebcamVisibility,
      setWebcamPosition: state.setWebcamPosition,
      updateWebcamStyle: state.updateWebcamStyle,
    })),
  )

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(webcamStyles.shadowColor),
    [webcamStyles.shadowColor],
  )

  const { hex: borderHex, alpha: borderAlpha } = useMemo(
    () => rgbaToHexAlpha(webcamStyles.borderColor),
    [webcamStyles.borderColor],
  )

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateWebcamStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateWebcamStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleBorderColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${borderAlpha})`
      updateWebcamStyle({ borderColor: newRgbaColor })
    }
  }

  const handleBorderOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(borderHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateWebcamStyle({ borderColor: newRgbaColor })
    }
  }

  const handleResetStyle = () => {
    updateWebcamStyle({
      shape: DEFAULTS.CAMERA.STYLE.SHAPE.defaultValue,
      borderRadius: DEFAULTS.CAMERA.STYLE.RADIUS.defaultValue,
      isFlipped: DEFAULTS.CAMERA.STYLE.FLIP.defaultValue,
    })
  }

  const handleResetPlacement = () => {
    updateWebcamStyle({
      size: DEFAULTS.CAMERA.PLACEMENT.SIZE.defaultValue,
      scaleOnZoom: DEFAULTS.CAMERA.STYLE.SCALE_ON_ZOOM.defaultValue,
      smartPosition: DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue,
    })
    setWebcamPosition({ pos: DEFAULTS.CAMERA.PLACEMENT.POSITION.defaultValue as WebcamPosition['pos'] })
  }

  const handleResetEffects = () => {
    updateWebcamStyle({
      shadowBlur: DEFAULTS.CAMERA.EFFECTS.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.CAMERA.EFFECTS.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.CAMERA.EFFECTS.DEFAULT_COLOR_RGBA,
    })
  }

  const isCircle = webcamStyles.shape === 'circle'
  const positions: { pos: WebcamPosition['pos']; classes: string }[] = [
    { pos: 'top-left', classes: 'top-2 left-2' },
    { pos: 'top-center', classes: 'top-2 left-1/2 -translate-x-1/2' },
    { pos: 'top-right', classes: 'top-2 right-2' },
    { pos: 'left-center', classes: 'top-1/2 -translate-y-1/2 left-2' },
    { pos: 'right-center', classes: 'top-1/2 -translate-y-1/2 right-2' },
    { pos: 'bottom-left', classes: 'bottom-2 left-2' },
    { pos: 'bottom-center', classes: 'bottom-2 left-1/2 -translate-x-1/2' },
    { pos: 'bottom-right', classes: 'bottom-2 right-2' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <DeviceComputerCamera className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Camera Settings</h2>
            <p className="text-sm text-muted-foreground">Adjust your webcam overlay</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto stable-scrollbar">
        {!webcamVideoUrl ? (
          <DisabledPanelPlaceholder
            icon={<DeviceComputerCameraOff className="w-8 h-8 text-muted-foreground" />}
            title="No Webcam Recorded"
            message="These settings are unavailable because a webcam was not included in this recording."
          />
        ) : (
          <div className="p-6 space-y-6">
            <ControlGroup label="Visibility" icon={<Eye className="w-4 h-4 text-primary" />}>
              <div className="flex items-center justify-between p-3 rounded-lg bg-sidebar-accent/30 border border-sidebar-border">
                <span className="text-sm font-medium text-sidebar-foreground">
                  {isWebcamVisible ? 'Visible' : 'Hidden'}
                </span>
                <Switch
                  checked={isWebcamVisible}
                  onCheckedChange={setWebcamVisibility}
                  className="data-[state=on]:bg-primary"
                />
              </div>
            </ControlGroup>

            <Collapse
              title="Style"
              description="Change shape and orientation"
              icon={<Photo />}
              defaultOpen={false}
              onReset={handleResetStyle}
            >
              <div className="space-y-6">
                {/* Shape Selector */}
                <div className="space-y-3">
                  <label className="text-sm font-medium text-sidebar-foreground">Shape</label>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => updateWebcamStyle({ shape: 'rectangle' })}
                      className={cn(
                        "h-auto py-2.5 flex items-center justify-center gap-2 border transition-all",
                        webcamStyles.shape === 'rectangle' ? "border-primary bg-primary/10 text-primary dark:text-white hover:bg-primary/20" : "border-border/60 text-foreground dark:text-white/80 hover:border-border hover:bg-muted/50"
                      )}
                    >
                      <Rectangle className="w-5 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => updateWebcamStyle({ shape: 'square' })}
                      className={cn(
                        "h-auto py-2.5 flex items-center justify-center gap-2 border transition-all",
                        webcamStyles.shape === 'square' ? "border-primary bg-primary/10 text-primary dark:text-white hover:bg-primary/20" : "border-border/60 text-foreground dark:text-white/80 hover:border-border hover:bg-muted/50"
                      )}
                    >
                      <Square className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => updateWebcamStyle({ shape: 'circle' })}
                      className={cn(
                        "h-auto py-2.5 flex items-center justify-center gap-2 border transition-all",
                        webcamStyles.shape === 'circle' ? "border-primary bg-primary/10 text-primary dark:text-white hover:bg-primary/20" : "border-border/60 text-foreground dark:text-white/80 hover:border-border hover:bg-muted/50"
                      )}
                    >
                      <Circle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Border Radius Control */}
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 flex items-center justify-center text-primary">
                        {' '}
                        <BorderRadius className="w-4 h-4" />{' '}
                      </div>
                      <span className={isCircle ? 'text-muted-foreground' : ''}>Corner Radius</span>
                    </div>
                    {!isCircle && (
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {webcamStyles.borderRadius}%
                      </span>
                    )}
                  </label>
                  <Slider
                    min={DEFAULTS.CAMERA.STYLE.RADIUS.min}
                    max={DEFAULTS.CAMERA.STYLE.RADIUS.max}
                    step={DEFAULTS.CAMERA.STYLE.RADIUS.step}
                    value={isCircle ? 50 : webcamStyles.borderRadius}
                    onChange={(value) => updateWebcamStyle({ borderRadius: value })}
                    disabled={isCircle}
                  />
                </div>

                {/* Flip Horizontal Control */}
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 flex items-center justify-center text-primary">
                        <SquareToggle className="w-4 h-4" />
                      </div>
                      <span>Flip Horizontal</span>
                    </div>
                    <Switch
                      checked={webcamStyles.isFlipped}
                      onCheckedChange={(isChecked) => updateWebcamStyle({ isFlipped: isChecked })}
                    />
                  </label>
                </div>

                {/* Border Control */}
                <div className="space-y-4">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 flex items-center justify-center text-primary">
                        <Square className="w-4 h-4" />
                      </div>
                      <span>Border</span>
                    </div>
                    <Switch
                      checked={webcamStyles.border}
                      onCheckedChange={(isChecked) => updateWebcamStyle({ border: isChecked })}
                    />
                  </label>

                  {webcamStyles.border && (
                    <div className="pl-7 space-y-4 pt-2 pb-1">
                      {/* Border Width */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Thickness</span>
                          <span className="text-xs font-semibold text-primary tabular-nums">
                            {webcamStyles.borderWidth}px
                          </span>
                        </div>
                        <Slider
                          min={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.min}
                          max={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.max}
                          step={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.step}
                          value={webcamStyles.borderWidth}
                          onChange={(v) => updateWebcamStyle({ borderWidth: v })}
                        />
                      </div>

                      {/* Border Color */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <ColorPicker label="Color" value={borderHex} onChange={handleBorderColorChange} />
                        </div>
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Opacity</span>
                            <span className="text-xs font-semibold text-primary tabular-nums">
                              {Math.round(borderAlpha * 100)}%
                            </span>
                          </div>
                          <Slider
                            min={0}
                            max={1}
                            step={0.01}
                            value={borderAlpha}
                            onChange={handleBorderOpacityChange}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Collapse>

            <Collapse
              title="Placement"
              description="Adjust size and corner position"
              icon={<TransformPointBottomLeftIcon />}
              defaultOpen={false}
              onReset={handleResetPlacement}
            >
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <span>Size (Normal)</span>
                    <span className="text-xs font-semibold text-primary tabular-nums">{webcamStyles.size}%</span>
                  </label>
                  <Slider
                    min={DEFAULTS.CAMERA.PLACEMENT.SIZE.min}
                    max={DEFAULTS.CAMERA.PLACEMENT.SIZE.max}
                    step={DEFAULTS.CAMERA.PLACEMENT.SIZE.step}
                    value={webcamStyles.size}
                    onChange={(value) => updateWebcamStyle({ size: value })}
                  />
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <span>Size (Zoomed)</span>
                    <span className="text-xs font-semibold text-primary tabular-nums">{webcamStyles.sizeOnZoom}%</span>
                  </label>
                  <Slider
                    min={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.min}
                    max={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.max}
                    step={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.step}
                    value={webcamStyles.sizeOnZoom}
                    onChange={(value) => updateWebcamStyle({ sizeOnZoom: value })}
                  />
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 flex items-center justify-center text-primary">
                        <ZoomIn className="w-4 h-4" />
                      </div>
                      <span>Scale on Zoom</span>
                    </div>
                    <Switch
                      checked={webcamStyles.scaleOnZoom}
                      onCheckedChange={(isChecked) => updateWebcamStyle({ scaleOnZoom: isChecked })}
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <div className="flex items-center gap-2.5">
                      <div className="w-5 h-5 flex items-center justify-center text-primary">
                        <ArrowsUpRight className="w-4 h-4" />
                      </div>
                      <span>Smart Position</span>
                    </div>
                    <Switch
                      checked={webcamStyles.smartPosition}
                      onCheckedChange={(isChecked) => updateWebcamStyle({ smartPosition: isChecked })}
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-sidebar-foreground">Position</label>
                  <div className="relative aspect-video w-full bg-muted/50 rounded-lg p-2 border border-border">
                    {positions.map(({ pos, classes }) => {
                      const isActive = webcamPosition.pos === pos
                      return (
                        <button
                          key={pos}
                          onClick={() => setWebcamPosition({ pos })}
                          className={cn(
                            'absolute w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ring-offset-background group',
                            classes,
                          )}
                          aria-label={`Position ${pos.replace('-', ' ')}`}
                        >
                          <div
                            className={cn(
                              'w-4 h-4 rounded-md transition-all duration-200 border-2',
                              isActive
                                ? 'bg-primary border-primary'
                                : 'bg-transparent border-muted-foreground/50 group-hover:border-primary',
                            )}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </Collapse>

            <Collapse
              title="Effects"
              description="Add a drop shadow for depth"
              icon={<Wand />}
              defaultOpen={false}
              onReset={handleResetEffects}
            >
              <div className="space-y-4">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Blur</span>
                    <span className="text-xs font-semibold text-primary tabular-nums">{webcamStyles.shadowBlur}px</span>
                  </div>
                  <Slider
                    min={DEFAULTS.CAMERA.EFFECTS.BLUR.min}
                    max={DEFAULTS.CAMERA.EFFECTS.BLUR.max}
                    step={DEFAULTS.CAMERA.EFFECTS.BLUR.step}
                    value={webcamStyles.shadowBlur}
                    onChange={(v) => updateWebcamStyle({ shadowBlur: v })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Offset X</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {webcamStyles.shadowOffsetX}px
                      </span>
                    </div>
                    <Slider
                      min={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.min}
                      max={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.max}
                      step={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.step}
                      value={webcamStyles.shadowOffsetX}
                      onChange={(v) => updateWebcamStyle({ shadowOffsetX: v })}
                    />
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Offset Y</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {webcamStyles.shadowOffsetY}px
                      </span>
                    </div>
                    <Slider
                      min={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.min}
                      max={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.max}
                      step={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.step}
                      value={webcamStyles.shadowOffsetY}
                      onChange={(v) => updateWebcamStyle({ shadowOffsetY: v })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <ColorPicker label="Color" value={shadowHex} onChange={handleShadowColorChange} />
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Opacity</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {Math.round(shadowAlpha * 100)}%
                      </span>
                    </div>
                    <Slider
                      min={DEFAULTS.CAMERA.EFFECTS.OPACITY.min}
                      max={DEFAULTS.CAMERA.EFFECTS.OPACITY.max}
                      step={DEFAULTS.CAMERA.EFFECTS.OPACITY.step}
                      value={shadowAlpha}
                      onChange={handleShadowOpacityChange}
                    />
                  </div>
                </div>
              </div>
            </Collapse>
          </div>
        )}
      </div>
    </div>
  )
}
