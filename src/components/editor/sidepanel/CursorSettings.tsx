import { Pointer, Shadow, HandClick } from 'tabler-icons-react'
import { SparklesIcon } from '../../ui/icons'
import { Collapse } from '../../ui/collapse'
import { cn } from '../../../lib/utils'
import { useEffect, useState, useMemo } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Slider } from '../../ui/slider'
import { ColorPicker } from '../../ui/color-picker'
import { rgbaToHexAlpha, hexToRgb } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'
import { EASING_MAP } from '../../../lib/easing'
import { Switch } from '../../ui/switch'
import { ControlGroup } from './ControlGroup'

const POST_PROCESSING_SCALES = [
  { value: 3, label: '3x' },
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
]

const easingOptions = Object.keys(EASING_MAP)

export function CursorSettings() {
  const {
    platform,
    setPostProcessingCursorScale,
    cursorThemeName,
    setCursorThemeName,
    cursorStyles,
    updateCursorStyle,
  } = useEditorStore(
    useShallow((state) => ({
      platform: state.platform,
      setPostProcessingCursorScale: state.setPostProcessingCursorScale,
      cursorThemeName: state.cursorThemeName,
      setCursorThemeName: state.setCursorThemeName,
      cursorStyles: state.cursorStyles,
      updateCursorStyle: state.updateCursorStyle,
    })),
  )
  const { reloadCursorTheme } = useEditorStore.getState()
  const [cursorScale, setCursorScale] = useState<number>(DEFAULTS.CURSOR.SCALE.defaultValue)
  const [availableThemes, setAvailableThemes] = useState<string[]>([DEFAULTS.CURSOR.THEME.defaultValue])

  const isCustomizationSupported = useMemo(() => platform === 'win32' || platform === 'darwin', [platform])

  useEffect(() => {
    if (isCustomizationSupported) {
      window.electronAPI.getCursorThemes().then((themes) => {
        if (themes && themes.length > 0) {
          setAvailableThemes(themes)
        }
      })

      window.electronAPI.getSetting<number>('recorder.cursorScale').then((savedScale) => {
        if (savedScale && POST_PROCESSING_SCALES.some((s) => s.value === savedScale)) {
          setCursorScale(savedScale)
        }
      })
    }
  }, [isCustomizationSupported])

  const handleCursorScaleChange = (value: number) => {
    setCursorScale(value)
    setPostProcessingCursorScale(value)
  }

  const handleThemeChange = (themeName: string) => {
    setCursorThemeName(themeName)
    reloadCursorTheme(themeName)
  }

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(cursorStyles.shadowColor),
    [cursorStyles.shadowColor],
  )
  const { hex: rippleHex, alpha: rippleAlpha } = useMemo(
    () => rgbaToHexAlpha(cursorStyles.clickRippleColor),
    [cursorStyles.clickRippleColor],
  )

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateCursorStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateCursorStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleRippleColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rippleAlpha})`
      updateCursorStyle({ clickRippleColor: newRgbaColor })
    }
  }

  const handleRippleOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(rippleHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateCursorStyle({ clickRippleColor: newRgbaColor })
    }
  }

  const handleResetTheme = () => {
    if (isCustomizationSupported) handleThemeChange(DEFAULTS.CURSOR.THEME.defaultValue)
  }

  const handleResetSize = () => {
    if (isCustomizationSupported) handleCursorScaleChange(DEFAULTS.CURSOR.SCALE.defaultValue)
  }

  const handleResetShadow = () => {
    updateCursorStyle({
      shadowBlur: DEFAULTS.CURSOR.SHADOW.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.CURSOR.SHADOW.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.CURSOR.SHADOW.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.CURSOR.SHADOW.DEFAULT_COLOR_RGBA,
    })
  }

  const handleResetClickEffects = () => {
    updateCursorStyle({
      clickRippleEffect: DEFAULTS.CURSOR.CLICK_RIPPLE.ENABLED.defaultValue,
      clickRippleColor: DEFAULTS.CURSOR.CLICK_RIPPLE.COLOR.defaultValue,
      clickRippleSize: DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.defaultValue,
      clickRippleDuration: DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.defaultValue,
      clickScaleEffect: DEFAULTS.CURSOR.CLICK_SCALE.ENABLED.defaultValue,
      clickScaleAmount: DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.defaultValue,
      clickScaleDuration: DEFAULTS.CURSOR.CLICK_SCALE.DURATION.defaultValue,
      clickScaleEasing: DEFAULTS.CURSOR.CLICK_SCALE.EASING.defaultValue,
    })
  }

  return (
    <div className="h-full flex flex-col relative">
      <div className="p-6 border-b border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Pointer className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-sidebar-foreground">Cursor Settings</h2>
            <p className="text-sm text-muted-foreground">Adjust the rendered cursor appearance</p>
          </div>
        </div>
      </div>
      <div className="flex-1 p-6 space-y-6 overflow-y-auto stable-scrollbar">
        <ControlGroup label="Visibility">
          <div className="flex items-center justify-between p-3 rounded-lg bg-sidebar-accent/30 border border-sidebar-border">
            <span className="text-sm font-medium text-sidebar-foreground">Show Cursor</span>
            <Switch
              checked={cursorStyles.showCursor}
              onCheckedChange={(v) => updateCursorStyle({ showCursor: v })}
              className="data-[state=on]:bg-primary"
            />
          </div>
        </ControlGroup>
        <Collapse
          title="Cursor Theme"
          description="Change the cursor style in the video"
          icon={<Pointer className="w-4 h-4 text-primary" />}
          defaultOpen={true}
          onReset={isCustomizationSupported ? handleResetTheme : undefined}
        >
          <div className="space-y-3">
            <label className="text-sm font-medium text-sidebar-foreground flex items-center gap-2">Theme</label>
            <Select
              value={isCustomizationSupported ? cursorThemeName : 'Default'}
              onValueChange={handleThemeChange}
              disabled={!isCustomizationSupported}
            >
              <SelectTrigger className="h-10 bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableThemes.map((theme) => (
                  <SelectItem key={theme} value={theme} className="capitalize">
                    {theme}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isCustomizationSupported && (
              <p className="text-xs text-muted-foreground pt-1">Cursor themes are available on Windows and macOS.</p>
            )}
          </div>
        </Collapse>
        <Collapse
          title="Cursor Size"
          description="Change the cursor size in the final video"
          icon={<Pointer className="w-4 h-4 text-primary" />}
          defaultOpen={true}
          onReset={isCustomizationSupported ? handleResetSize : undefined}
        >
          <div className="space-y-3">
            <label className="text-sm font-medium text-sidebar-foreground flex items-center gap-2">Scale</label>
            <div
              className={cn(
                'grid grid-cols-4 gap-1 p-1 rounded-lg',
                !isCustomizationSupported ? 'opacity-50 cursor-not-allowed' : 'bg-muted/50',
              )}
            >
              {POST_PROCESSING_SCALES.map((scale) => (
                <button
                  key={scale.value}
                  onClick={!isCustomizationSupported ? undefined : () => handleCursorScaleChange(scale.value)}
                  disabled={!isCustomizationSupported}
                  className={cn(
                    'py-2 text-sm font-medium rounded-md transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    cursorScale === scale.value
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    !isCustomizationSupported && 'cursor-not-allowed hover:text-muted-foreground',
                  )}
                >
                  {scale.label}
                </button>
              ))}
            </div>
            {!isCustomizationSupported && (
              <p className="text-xs text-muted-foreground pt-1">
                Virtual cursor sizing is available on Windows and macOS.
              </p>
            )}
          </div>
        </Collapse>
        <Collapse
          title="Click Effects"
          description="Add visual feedback for mouse clicks"
          icon={<HandClick className="w-4 h-4 text-primary" />}
          defaultOpen={false}
          onReset={handleResetClickEffects}
        >
          <div className="space-y-6">
            <ControlGroup
              label="Click Ripple"
              icon={<SparklesIcon className="w-4 h-4 text-primary/80" />}
              description="An expanding circle effect on click."
            >
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between w-full">
                  <label
                    htmlFor="click-ripple-effect"
                    className={`text-sm font-medium ${!cursorStyles.clickRippleEffect ? 'text-muted-foreground' : 'text-foreground/80'}`}
                  >
                    Visibility
                  </label>
                  <Switch
                    id="click-ripple-effect"
                    checked={cursorStyles.clickRippleEffect}
                    onCheckedChange={(v) => updateCursorStyle({ clickRippleEffect: v })}
                  />
                </div>
                <div className={`space-y-4 ${!cursorStyles.clickRippleEffect ? 'opacity-70' : ''}`}>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Size (Radius)</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {cursorStyles.clickRippleSize}px
                      </span>
                    </div>
                    <Slider
                      disabled={!cursorStyles.clickRippleEffect}
                      min={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.min}
                      max={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.max}
                      step={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.step}
                      value={cursorStyles.clickRippleSize}
                      onChange={(v) => updateCursorStyle({ clickRippleSize: v })}
                    />
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duration</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {cursorStyles.clickRippleDuration.toFixed(2)}s
                      </span>
                    </div>
                    <Slider
                      disabled={!cursorStyles.clickRippleEffect}
                      min={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.min}
                      max={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.max}
                      step={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.step}
                      value={cursorStyles.clickRippleDuration}
                      onChange={(v) => updateCursorStyle({ clickRippleDuration: v })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <ColorPicker
                        label="Color"
                        value={rippleHex}
                        onChange={handleRippleColorChange}
                        disabled={!cursorStyles.clickRippleEffect}
                      />
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Opacity</span>
                        <span className="text-xs font-semibold text-primary tabular-nums">
                          {Math.round(rippleAlpha * 100)}%
                        </span>
                      </div>
                      <Slider
                        disabled={!cursorStyles.clickRippleEffect}
                        min={0}
                        max={1}
                        step={0.01}
                        value={rippleAlpha}
                        onChange={handleRippleOpacityChange}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </ControlGroup>
            <ControlGroup
              label="Click Scale"
              icon={<Pointer className="w-4 h-4 text-primary/80" />}
              description="A subtle scaling animation on click."
            >
              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between w-full">
                  <label
                    htmlFor="click-scale-effect"
                    className={`text-sm font-medium ${!cursorStyles.clickScaleEffect ? 'text-muted-foreground' : 'text-foreground/80'}`}
                  >
                    Visibility
                  </label>
                  <Switch
                    id="click-scale-effect"
                    checked={cursorStyles.clickScaleEffect}
                    onCheckedChange={(v) => updateCursorStyle({ clickScaleEffect: v })}
                  />
                </div>
                <div className={`space-y-4 ${!cursorStyles.clickScaleEffect ? 'opacity-70' : ''}`}>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Scale Amount</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {cursorStyles.clickScaleAmount.toFixed(2)}x
                      </span>
                    </div>
                    <Slider
                      disabled={!cursorStyles.clickScaleEffect}
                      min={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.min}
                      max={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.max}
                      step={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.step}
                      value={cursorStyles.clickScaleAmount}
                      onChange={(v) => updateCursorStyle({ clickScaleAmount: v })}
                    />
                  </div>
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Duration</span>
                      <span className="text-xs font-semibold text-primary tabular-nums">
                        {cursorStyles.clickScaleDuration.toFixed(2)}s
                      </span>
                    </div>
                    <Slider
                      disabled={!cursorStyles.clickScaleEffect}
                      min={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.min}
                      max={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.max}
                      step={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.step}
                      value={cursorStyles.clickScaleDuration}
                      onChange={(v) => updateCursorStyle({ clickScaleDuration: v })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      className={cn(
                        'text-sm',
                        !cursorStyles.clickScaleEffect ? 'text-muted-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      Easing Style
                    </label>
                    <Select
                      disabled={!cursorStyles.clickScaleEffect}
                      value={cursorStyles.clickScaleEasing}
                      onValueChange={(v) => updateCursorStyle({ clickScaleEasing: v })}
                    >
                      <SelectTrigger
                        className={cn('h-10', !cursorStyles.clickScaleEffect ? 'bg-background/30' : 'bg-background/50')}
                      >
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
                </div>
              </div>
            </ControlGroup>
          </div>
        </Collapse>
        <Collapse
          title="Cursor Shadow"
          description="Add a drop shadow for better visibility"
          icon={<Shadow className="w-4 h-4 text-primary" />}
          defaultOpen={false}
          onReset={handleResetShadow}
        >
          <div className="space-y-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Blur</span>
                <span className="text-xs font-semibold text-primary tabular-nums">{cursorStyles.shadowBlur}px</span>
              </div>
              <Slider
                disabled={!cursorStyles.showCursor}
                min={DEFAULTS.CURSOR.SHADOW.BLUR.min}
                max={DEFAULTS.CURSOR.SHADOW.BLUR.max}
                step={DEFAULTS.CURSOR.SHADOW.BLUR.step}
                value={cursorStyles.shadowBlur}
                onChange={(v) => updateCursorStyle({ shadowBlur: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Offset X</span>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {cursorStyles.shadowOffsetX}px
                  </span>
                </div>
                <Slider
                  disabled={!cursorStyles.showCursor}
                  min={DEFAULTS.CURSOR.SHADOW.OFFSET_X.min}
                  max={DEFAULTS.CURSOR.SHADOW.OFFSET_X.max}
                  step={DEFAULTS.CURSOR.SHADOW.OFFSET_X.step}
                  value={cursorStyles.shadowOffsetX}
                  onChange={(v) => updateCursorStyle({ shadowOffsetX: v })}
                />
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Offset Y</span>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {cursorStyles.shadowOffsetY}px
                  </span>
                </div>
                <Slider
                  disabled={!cursorStyles.showCursor}
                  min={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.min}
                  max={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.max}
                  step={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.step}
                  value={cursorStyles.shadowOffsetY}
                  onChange={(v) => updateCursorStyle({ shadowOffsetY: v })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <ColorPicker
                  label="Color"
                  value={shadowHex}
                  onChange={handleShadowColorChange}
                  disabled={!cursorStyles.showCursor}
                />
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Opacity</span>
                  <span className="text-xs font-semibold text-primary tabular-nums">
                    {Math.round(shadowAlpha * 100)}%
                  </span>
                </div>
                <Slider
                  disabled={!cursorStyles.showCursor}
                  min={DEFAULTS.CURSOR.SHADOW.OPACITY.min}
                  max={DEFAULTS.CURSOR.SHADOW.OPACITY.max}
                  step={DEFAULTS.CURSOR.SHADOW.OPACITY.step}
                  value={shadowAlpha}
                  onChange={handleShadowOpacityChange}
                />
              </div>
            </div>
          </div>
        </Collapse>
      </div>
    </div>
  )
}
