import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowsUpRight,
  Circle,
  DeviceComputerCamera,
  DeviceComputerCameraOff,
  Eye,
  Marquee2,
  OverlayLayout,
  Phone,
  Photo,
  Rectangle,
  SplitView,
  Square,
  SquareToggle,
  Wand,
  ZoomIn,
} from '@icons'
import type { WebcamLayoutMode, WebcamPosition } from '../../../types'
import { DEFAULTS } from '../../../lib/constants'
import { normalizeWebcamCrop } from '../../../lib/webcam'
import { cn, hexToRgb, rgbaToHexAlpha } from '../../../lib/utils'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { ColorPicker } from '../../ui/color-picker'
import { Collapse } from '../../ui/collapse'
import { TransformPointBottomLeftIcon } from '../../ui/icons'
import { Slider } from '../../ui/slider'
import { Switch } from '../../ui/switch'
import { ControlGroup } from './ControlGroup'
import { WebcamCropEditor } from '../preview/WebcamCropEditor'

const DisabledPanelPlaceholder = ({
  icon,
  title,
  message,
}: {
  icon: ReactNode
  title: string
  message: string
}) => (
  <div className="flex h-full flex-col items-center justify-center bg-muted/30 p-8 text-center">
    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background/60">
      {icon}
    </div>
    <h3 className="font-semibold text-foreground">{title}</h3>
    <p className="mt-1 max-w-xs text-sm text-muted-foreground">{message}</p>
  </div>
)

const layoutButtonClass = (isActive: boolean) =>
  cn(
    'h-auto min-h-[92px] whitespace-normal rounded-lg border px-3 py-3 text-left transition-all flex flex-col items-start justify-start',
    isActive
      ? 'border-primary bg-primary/10 text-primary dark:text-white hover:bg-primary/20'
      : 'border-border/60 text-foreground dark:text-white/80 hover:border-border hover:bg-muted/50',
  )

const shapeButtonClass = (isActive: boolean) =>
  cn(
    'h-auto whitespace-normal rounded-lg border px-3 py-2.5 transition-all flex items-center justify-center',
    isActive
      ? 'border-primary bg-primary/10 text-primary dark:text-white hover:bg-primary/20'
      : 'border-border/60 text-foreground dark:text-white/80 hover:border-border hover:bg-muted/50',
  )

const ValueSlider = ({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  suffix = '',
  onChange,
  disabled = false,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue?: string | number
  suffix?: string
  onChange: (value: number) => void
  disabled?: boolean
}) => (
  <div className="space-y-2.5">
    <div className="flex items-center justify-between">
      <span className={cn('text-sm', disabled ? 'text-muted-foreground/70' : 'text-muted-foreground')}>{label}</span>
      <span className="text-xs font-semibold tabular-nums text-primary">{displayValue ?? `${value}${suffix}`}</span>
    </div>
    <Slider min={min} max={max} step={step} value={value} onChange={onChange} disabled={disabled} />
  </div>
)

const layoutModes: Array<{
  mode: WebcamLayoutMode
  label: string
  description: string
  icon: ReactNode
}> = [
  {
    mode: 'overlay',
    label: 'Overlay',
    description: 'Webcam flutuando sobre a cena',
    icon: <OverlayLayout className="h-5 w-5" />,
  },
  {
    mode: 'side-by-side',
    label: 'Side by side',
    description: 'Tela e webcam dividem o frame',
    icon: <SplitView className="h-5 w-5" />,
  },
]

const shapeOptions = [
  { shape: 'rectangle' as const, label: 'Wide', icon: <Rectangle className="h-4 w-5" /> },
  { shape: 'square' as const, label: 'Square', icon: <Square className="h-4 w-4" /> },
  { shape: 'circle' as const, label: 'Circle', icon: <Circle className="h-4 w-4" /> },
  { shape: 'phone' as const, label: 'Phone', icon: <Phone className="h-5 w-4" /> },
]

export function CameraSettings() {
  const store = useEditorStore(
    useShallow((state) => ({
      webcamVideoUrl: state.webcamVideoUrl,
      currentTime: state.currentTime,
      isWebcamVisible: state.isWebcamVisible,
      webcamLayout: state.webcamLayout,
      webcamPosition: state.webcamPosition,
      webcamStyles: state.webcamStyles,
      setWebcamVisibility: state.setWebcamVisibility,
      updateWebcamLayout: state.updateWebcamLayout,
      setWebcamPosition: state.setWebcamPosition,
      updateWebcamStyle: state.updateWebcamStyle,
    })),
  )

  const {
    webcamVideoUrl,
    currentTime,
    isWebcamVisible,
    webcamLayout,
    webcamPosition,
    webcamStyles,
    setWebcamVisibility,
    updateWebcamLayout,
    setWebcamPosition,
    updateWebcamStyle,
  } = store

  const isOverlayLayout = webcamLayout.mode === 'overlay'
  const isCircle = webcamStyles.shape === 'circle'
  const screenWidthPercent = 100 - webcamLayout.webcamWidthPercent

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(webcamStyles.shadowColor),
    [webcamStyles.shadowColor],
  )
  const { hex: borderHex, alpha: borderAlpha } = useMemo(
    () => rgbaToHexAlpha(webcamStyles.borderColor),
    [webcamStyles.borderColor],
  )

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

  const updateCrop = (updates: Partial<typeof webcamStyles.crop>) =>
    updateWebcamStyle({ crop: normalizeWebcamCrop(updates, webcamStyles.crop) })

  const updateRgbaColor = (hex: string, alpha: number, field: 'shadowColor' | 'borderColor') => {
    const rgb = hexToRgb(hex)
    if (!rgb) return
    updateWebcamStyle({ [field]: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` })
  }

  const resetLayout = () =>
    updateWebcamLayout({
      mode: DEFAULTS.CAMERA.LAYOUT.MODE.defaultValue,
      side: DEFAULTS.CAMERA.LAYOUT.SIDE.defaultValue,
      webcamWidthPercent: DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.defaultValue,
    })

  const resetStyle = () =>
    updateWebcamStyle({
      shape: DEFAULTS.CAMERA.STYLE.SHAPE.defaultValue,
      borderRadius: DEFAULTS.CAMERA.STYLE.RADIUS.defaultValue,
      isFlipped: DEFAULTS.CAMERA.STYLE.FLIP.defaultValue,
      border: DEFAULTS.CAMERA.STYLE.BORDER.ENABLED.defaultValue,
      borderWidth: DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.defaultValue,
      borderColor: DEFAULTS.CAMERA.STYLE.BORDER.DEFAULT_COLOR_RGBA,
    })

  const resetPlacement = () => {
    updateWebcamStyle({
      size: DEFAULTS.CAMERA.PLACEMENT.SIZE.defaultValue,
      sizeOnZoom: DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.defaultValue,
      scaleOnZoom: DEFAULTS.CAMERA.STYLE.SCALE_ON_ZOOM.defaultValue,
      smartPosition: DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue,
    })
    setWebcamPosition({ pos: DEFAULTS.CAMERA.PLACEMENT.POSITION.defaultValue as WebcamPosition['pos'] })
  }

  const resetCrop = () => updateWebcamStyle({ crop: normalizeWebcamCrop(null) })
  const resetEffects = () =>
    updateWebcamStyle({
      shadowBlur: DEFAULTS.CAMERA.EFFECTS.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.CAMERA.EFFECTS.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.CAMERA.EFFECTS.DEFAULT_COLOR_RGBA,
    })

  if (!webcamVideoUrl) {
    return (
      <div className="h-full flex flex-col">
        <div className="border-b border-sidebar-border p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <DeviceComputerCamera className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-sidebar-foreground">Camera Settings</h2>
              <p className="text-sm text-muted-foreground">Adjust your webcam layout and style</p>
            </div>
          </div>
        </div>
        <DisabledPanelPlaceholder
          icon={<DeviceComputerCameraOff className="h-8 w-8 text-muted-foreground" />}
          title="No Webcam Recorded"
          message="These settings are unavailable because a webcam was not included in this recording."
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-sidebar-border p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <DeviceComputerCamera className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Camera Settings</h2>
            <p className="text-sm text-muted-foreground">Adjust your webcam layout and style</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6 stable-scrollbar">
        <ControlGroup label="Visibility" icon={<Eye className="h-4 w-4 text-primary" />}>
          <div className="flex items-center justify-between rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-3">
            <span className="text-sm font-medium text-sidebar-foreground">{isWebcamVisible ? 'Visible' : 'Hidden'}</span>
            <Switch checked={isWebcamVisible} onCheckedChange={setWebcamVisibility} className="data-[state=on]:bg-primary" />
          </div>
        </ControlGroup>

        <Collapse title="Layout" description="Choose how webcam and screen share the frame" icon={<Rectangle />} defaultOpen onReset={resetLayout}>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2">
              {layoutModes.map(({ mode, label, description, icon }) => (
                <Button key={mode} variant="ghost" onClick={() => updateWebcamLayout({ mode })} className={layoutButtonClass(webcamLayout.mode === mode)}>
                  <span className="flex w-full items-center gap-2 text-sm font-medium">{icon}{label}</span>
                  <span className="mt-1 block w-full text-xs leading-relaxed text-muted-foreground">{description}</span>
                </Button>
              ))}
            </div>

            {!isOverlayLayout && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {(['left', 'right'] as const).map((side) => (
                    <Button key={side} variant="ghost" onClick={() => updateWebcamLayout({ side })} className={layoutButtonClass(webcamLayout.side === side)}>
                      <span className="text-sm font-medium capitalize">{side}</span>
                    </Button>
                  ))}
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                    <span>Split</span>
                    <span className="text-xs font-semibold tabular-nums text-primary">{screenWidthPercent} / {webcamLayout.webcamWidthPercent}</span>
                  </label>
                  <Slider
                    min={DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.min}
                    max={DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.max}
                    step={DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.step}
                    value={webcamLayout.webcamWidthPercent}
                    onChange={(value) => updateWebcamLayout({ webcamWidthPercent: value })}
                  />
                </div>
              </>
            )}

            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              {isOverlayLayout
                ? 'Overlay keeps smart position, size, and zoom behavior.'
                : 'Side-by-side keeps style and effects active, and swap expands the webcam while hiding the screen.'}
            </div>
          </div>
        </Collapse>

        <Collapse title="Style" description="Change shape, border, and orientation" icon={<Photo />} onReset={resetStyle}>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2">
              {shapeOptions.map(({ shape, label, icon }) => (
                <Button key={shape} variant="ghost" onClick={() => updateWebcamStyle({ shape })} className={shapeButtonClass(webcamStyles.shape === shape)}>
                  <div className="flex flex-col items-center gap-2">
                    {icon}
                    <span className="text-xs font-medium">{label}</span>
                  </div>
                </Button>
              ))}
            </div>

            <ValueSlider
              label="Corner Radius"
              value={isCircle ? 50 : webcamStyles.borderRadius}
              min={DEFAULTS.CAMERA.STYLE.RADIUS.min}
              max={DEFAULTS.CAMERA.STYLE.RADIUS.max}
              step={DEFAULTS.CAMERA.STYLE.RADIUS.step}
              suffix="%"
              onChange={(value) => updateWebcamStyle({ borderRadius: value })}
              disabled={isCircle}
            />

            <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
              <span className="flex items-center gap-2.5"><SquareToggle className="h-4 w-4 text-primary" />Flip Horizontal</span>
              <Switch checked={webcamStyles.isFlipped} onCheckedChange={(value) => updateWebcamStyle({ isFlipped: value })} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                <span className="flex items-center gap-2.5"><Square className="h-4 w-4 text-primary" />Border</span>
                <Switch checked={webcamStyles.border} onCheckedChange={(value) => updateWebcamStyle({ border: value })} />
              </div>
              {webcamStyles.border && (
                <div className="space-y-4 pl-7">
                  <ValueSlider
                    label="Thickness"
                    value={webcamStyles.borderWidth}
                    min={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.min}
                    max={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.max}
                    step={DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.step}
                    suffix="px"
                    onChange={(value) => updateWebcamStyle({ borderWidth: value })}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <ColorPicker label="Color" value={borderHex} onChange={(value) => updateRgbaColor(value, borderAlpha, 'borderColor')} />
                    <ValueSlider label="Opacity" value={borderAlpha} min={0} max={1} step={0.01} displayValue={`${Math.round(borderAlpha * 100)}%`} onChange={(value) => updateRgbaColor(borderHex, value, 'borderColor')} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Collapse>

        <Collapse title="Placement" description="Adjust overlay size and position" icon={<TransformPointBottomLeftIcon />} onReset={resetPlacement}>
          {isOverlayLayout ? (
            <div className="space-y-6">
              <ValueSlider label="Size (Normal)" value={webcamStyles.size} min={DEFAULTS.CAMERA.PLACEMENT.SIZE.min} max={DEFAULTS.CAMERA.PLACEMENT.SIZE.max} step={DEFAULTS.CAMERA.PLACEMENT.SIZE.step} suffix="%" onChange={(value) => updateWebcamStyle({ size: value })} />
              <ValueSlider label="Size (Zoomed)" value={webcamStyles.sizeOnZoom} min={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.min} max={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.max} step={DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.step} suffix="%" onChange={(value) => updateWebcamStyle({ sizeOnZoom: value })} />
              <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                <span className="flex items-center gap-2.5"><ZoomIn className="h-4 w-4 text-primary" />Scale on Zoom</span>
                <Switch checked={webcamStyles.scaleOnZoom} onCheckedChange={(value) => updateWebcamStyle({ scaleOnZoom: value })} />
              </div>
              <div className="flex items-center justify-between text-sm font-medium text-sidebar-foreground">
                <span className="flex items-center gap-2.5"><ArrowsUpRight className="h-4 w-4 text-primary" />Smart Position</span>
                <Switch checked={webcamStyles.smartPosition} onCheckedChange={(value) => updateWebcamStyle({ smartPosition: value })} />
              </div>
              <div className="space-y-3">
                <label className="text-sm font-medium text-sidebar-foreground">Position</label>
                <div className="relative aspect-video w-full rounded-lg border border-border bg-muted/50 p-2">
                  {positions.map(({ pos, classes }) => (
                    <button key={pos} onClick={() => setWebcamPosition({ pos })} className={cn('absolute flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-accent', classes)} aria-label={pos}>
                      <div className={cn('h-4 w-4 rounded-md border-2', webcamPosition.pos === pos ? 'border-primary bg-primary' : 'border-muted-foreground/50 bg-transparent')} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              Side-by-side uses the selected split and side, so overlay size and smart position stay disabled here.
            </div>
          )}
        </Collapse>

        <Collapse title="Crop" description="Trim the webcam source with preview handles" icon={<Marquee2 />} onReset={resetCrop}>
          <div className="space-y-6">
            <WebcamCropEditor webcamVideoUrl={webcamVideoUrl} currentTime={currentTime} crop={webcamStyles.crop} onUpdateCrop={updateCrop} />
            <div className="grid grid-cols-2 gap-4">
              <ValueSlider label="Top" value={webcamStyles.crop.top} min={DEFAULTS.CAMERA.CROP.TOP.min} max={DEFAULTS.CAMERA.CROP.TOP.max} step={DEFAULTS.CAMERA.CROP.TOP.step} displayValue={`${Math.round(webcamStyles.crop.top * 100)}%`} onChange={(value) => updateCrop({ top: value })} />
              <ValueSlider label="Right" value={webcamStyles.crop.right} min={DEFAULTS.CAMERA.CROP.RIGHT.min} max={DEFAULTS.CAMERA.CROP.RIGHT.max} step={DEFAULTS.CAMERA.CROP.RIGHT.step} displayValue={`${Math.round(webcamStyles.crop.right * 100)}%`} onChange={(value) => updateCrop({ right: value })} />
              <ValueSlider label="Bottom" value={webcamStyles.crop.bottom} min={DEFAULTS.CAMERA.CROP.BOTTOM.min} max={DEFAULTS.CAMERA.CROP.BOTTOM.max} step={DEFAULTS.CAMERA.CROP.BOTTOM.step} displayValue={`${Math.round(webcamStyles.crop.bottom * 100)}%`} onChange={(value) => updateCrop({ bottom: value })} />
              <ValueSlider label="Left" value={webcamStyles.crop.left} min={DEFAULTS.CAMERA.CROP.LEFT.min} max={DEFAULTS.CAMERA.CROP.LEFT.max} step={DEFAULTS.CAMERA.CROP.LEFT.step} displayValue={`${Math.round(webcamStyles.crop.left * 100)}%`} onChange={(value) => updateCrop({ left: value })} />
            </div>
          </div>
        </Collapse>

        <Collapse title="Effects" description="Add depth to the webcam surface" icon={<Wand />} onReset={resetEffects}>
          <div className="space-y-4">
            <ValueSlider label="Blur" value={webcamStyles.shadowBlur} min={DEFAULTS.CAMERA.EFFECTS.BLUR.min} max={DEFAULTS.CAMERA.EFFECTS.BLUR.max} step={DEFAULTS.CAMERA.EFFECTS.BLUR.step} suffix="px" onChange={(value) => updateWebcamStyle({ shadowBlur: value })} />
            <div className="grid grid-cols-2 gap-4">
              <ValueSlider label="Offset X" value={webcamStyles.shadowOffsetX} min={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.min} max={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.max} step={DEFAULTS.CAMERA.EFFECTS.OFFSET_X.step} suffix="px" onChange={(value) => updateWebcamStyle({ shadowOffsetX: value })} />
              <ValueSlider label="Offset Y" value={webcamStyles.shadowOffsetY} min={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.min} max={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.max} step={DEFAULTS.CAMERA.EFFECTS.OFFSET_Y.step} suffix="px" onChange={(value) => updateWebcamStyle({ shadowOffsetY: value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ColorPicker label="Color" value={shadowHex} onChange={(value) => updateRgbaColor(value, shadowAlpha, 'shadowColor')} />
              <ValueSlider label="Opacity" value={shadowAlpha} min={0} max={1} step={0.01} displayValue={`${Math.round(shadowAlpha * 100)}%`} onChange={(value) => updateRgbaColor(shadowHex, value, 'shadowColor')} />
            </div>
          </div>
        </Collapse>
      </div>
    </div>
  )
}
