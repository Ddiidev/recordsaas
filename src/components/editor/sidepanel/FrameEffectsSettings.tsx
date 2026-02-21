import { useMemo } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { ColorPicker } from '../../ui/color-picker'
import { Slider } from '../../ui/slider'
import { Collapse } from '../../ui/collapse'
import { rgbaToHexAlpha, hexToRgb } from '../../../lib/utils'
import { BoxPadding, Shadow, BorderAll } from 'tabler-icons-react'
import { DEFAULTS } from '../../../lib/constants'

export function FrameEffectsSettings() {
  const { frameStyles, updateFrameStyle } = useEditorStore()

  const handleStyleChange = (name: string, value: string | number) => {
    updateFrameStyle({
      [name]: typeof value === 'string' ? Number.parseFloat(value) || 0 : value,
    })
  }

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(frameStyles.shadowColor),
    [frameStyles.shadowColor],
  )

  const { hex: borderHex } = useMemo(() => rgbaToHexAlpha(frameStyles.borderColor), [frameStyles.borderColor])

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateFrameStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateFrameStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleBorderColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`
      updateFrameStyle({ borderColor: newRgbaColor })
    }
  }

  // --- Reset Handlers ---
  const handleResetPadding = () => {
    updateFrameStyle({ padding: DEFAULTS.FRAME.PADDING.defaultValue })
  }

  const handleResetShadow = () => {
    updateFrameStyle({
      shadowBlur: DEFAULTS.FRAME.SHADOW.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.FRAME.SHADOW.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.FRAME.SHADOW.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.FRAME.SHADOW.DEFAULT_COLOR_RGBA,
    })
  }

  const handleResetBorder = () => {
    updateFrameStyle({
      borderRadius: DEFAULTS.FRAME.RADIUS.defaultValue,
      borderWidth: DEFAULTS.FRAME.BORDER.WIDTH.defaultValue,
      borderColor: DEFAULTS.FRAME.BORDER.DEFAULT_COLOR_RGBA,
    })
  }

  return (
    <div className="space-y-4">
      {/* Padding Section */}
      <Collapse
        title="Padding"
        description="Space around your video content"
        icon={<BoxPadding />}
        defaultOpen={true}
        onReset={handleResetPadding}
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Padding</span>
            <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.padding}%</span>
          </label>
          <Slider
            min={DEFAULTS.FRAME.PADDING.min}
            max={DEFAULTS.FRAME.PADDING.max}
            step={DEFAULTS.FRAME.PADDING.step}
            value={frameStyles.padding}
            onChange={(value) => handleStyleChange('padding', value)}
          />
        </div>
      </Collapse>

      {/* Shadow Section */}
      <Collapse
        title="Shadow"
        description="Add depth with drop shadows"
        icon={<Shadow />}
        defaultOpen={true}
        onReset={handleResetShadow}
      >
        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Blur</span>
              <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.shadowBlur}px</span>
            </div>
            <Slider
              min={DEFAULTS.FRAME.SHADOW.BLUR.min}
              max={DEFAULTS.FRAME.SHADOW.BLUR.max}
              step={DEFAULTS.FRAME.SHADOW.BLUR.step}
              value={frameStyles.shadowBlur}
              onChange={(v) => handleStyleChange('shadowBlur', v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Offset X</span>
                <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.shadowOffsetX}px</span>
              </div>
              <Slider
                min={DEFAULTS.FRAME.SHADOW.OFFSET_X.min}
                max={DEFAULTS.FRAME.SHADOW.OFFSET_X.max}
                step={DEFAULTS.FRAME.SHADOW.OFFSET_X.step}
                value={frameStyles.shadowOffsetX}
                onChange={(v) => handleStyleChange('shadowOffsetX', v)}
              />
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Offset Y</span>
                <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.shadowOffsetY}px</span>
              </div>
              <Slider
                min={DEFAULTS.FRAME.SHADOW.OFFSET_Y.min}
                max={DEFAULTS.FRAME.SHADOW.OFFSET_Y.max}
                step={DEFAULTS.FRAME.SHADOW.OFFSET_Y.step}
                value={frameStyles.shadowOffsetY}
                onChange={(v) => handleStyleChange('shadowOffsetY', v)}
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
                min={DEFAULTS.FRAME.SHADOW.OPACITY.min}
                max={DEFAULTS.FRAME.SHADOW.OPACITY.max}
                step={DEFAULTS.FRAME.SHADOW.OPACITY.step}
                value={shadowAlpha}
                onChange={handleShadowOpacityChange}
              />
            </div>
          </div>
        </div>
      </Collapse>

      {/* Border Section */}
      <Collapse
        title="Border"
        description="Frame your video with a border"
        icon={<BorderAll />}
        defaultOpen={false}
        onReset={handleResetBorder}
      >
        <div className="space-y-4">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Radius</span>
              <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.borderRadius}px</span>
            </div>

            <Slider
              min={DEFAULTS.FRAME.RADIUS.min}
              max={DEFAULTS.FRAME.RADIUS.max}
              step={DEFAULTS.FRAME.RADIUS.step}
              value={frameStyles.borderRadius}
              onChange={(value) => handleStyleChange('borderRadius', value)}
            />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Thickness</span>
              <span className="text-xs font-semibold text-primary tabular-nums">{frameStyles.borderWidth}px</span>
            </div>
            <Slider
              min={DEFAULTS.FRAME.BORDER.WIDTH.min}
              max={DEFAULTS.FRAME.BORDER.WIDTH.max}
              step={DEFAULTS.FRAME.BORDER.WIDTH.step}
              value={frameStyles.borderWidth}
              onChange={(v) => handleStyleChange('borderWidth', v)}
            />
          </div>
          <div>
            <ColorPicker label="Color" value={borderHex} onChange={handleBorderColorChange} />
          </div>
        </div>
      </Collapse>
    </div>
  )
}
