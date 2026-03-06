import { APP, BLUR_REGION, DEFAULTS, SWAP_REGION, TIMELINE } from '../../lib/constants'
import type { PresetState, PresetActions, Slice } from '../../types'
import type {
  Preset,
  FrameStyles,
  WebcamLayout,
  WebcamStyles,
  WebcamPosition,
  BlurPresetDefaults,
  SwapPresetDefaults,
} from '../../types'
import { initialFrameState } from './frameSlice'
import { initialWebcamState } from './webcamSlice'
import { normalizeWebcamCrop, normalizeWebcamLayoutMode } from '../../lib/webcam'

const DEFAULT_PRESET_ID = 'default-preset-v1'

const cloneDeep = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const DEFAULT_PRESET_STYLES: FrameStyles = initialFrameState.frameStyles
const DEFAULT_WEBCAM_LAYOUT: WebcamLayout = initialWebcamState.webcamLayout
const DEFAULT_WEBCAM_STYLES: WebcamStyles = initialWebcamState.webcamStyles
const DEFAULT_WEBCAM_POSITION: WebcamPosition = initialWebcamState.webcamPosition
const DEFAULT_BLUR_PRESET_DEFAULTS: BlurPresetDefaults = {
  duration: BLUR_REGION.DEFAULT_DURATION,
  style: BLUR_REGION.STYLE.DEFAULT,
  intensity: BLUR_REGION.INTENSITY.defaultValue,
  x: BLUR_REGION.X.defaultValue,
  y: BLUR_REGION.Y.defaultValue,
  width: BLUR_REGION.WIDTH.defaultValue,
  height: BLUR_REGION.HEIGHT.defaultValue,
}
const DEFAULT_SWAP_PRESET_DEFAULTS: SwapPresetDefaults = {
  duration: SWAP_REGION.DEFAULT_DURATION,
  showDesktopOverlay: SWAP_REGION.SHOW_DESKTOP_OVERLAY,
  transition: SWAP_REGION.TRANSITION.DEFAULT,
  transitionDuration: SWAP_REGION.TRANSITION_DURATION.defaultValue,
}

const normalizeBlurPresetDefaults = (value: Partial<BlurPresetDefaults> | undefined): BlurPresetDefaults => {
  const width =
    typeof value?.width === 'number' && Number.isFinite(value.width)
      ? clamp(value.width, BLUR_REGION.WIDTH.min, BLUR_REGION.WIDTH.max)
      : DEFAULT_BLUR_PRESET_DEFAULTS.width
  const height =
    typeof value?.height === 'number' && Number.isFinite(value.height)
      ? clamp(value.height, BLUR_REGION.HEIGHT.min, BLUR_REGION.HEIGHT.max)
      : DEFAULT_BLUR_PRESET_DEFAULTS.height

  return {
    duration:
      typeof value?.duration === 'number' && Number.isFinite(value.duration)
        ? Math.max(TIMELINE.MINIMUM_REGION_DURATION, value.duration)
        : DEFAULT_BLUR_PRESET_DEFAULTS.duration,
    style: value?.style === 'pixelated' ? 'pixelated' : DEFAULT_BLUR_PRESET_DEFAULTS.style,
    intensity:
      typeof value?.intensity === 'number' && Number.isFinite(value.intensity)
        ? clamp(value.intensity, BLUR_REGION.INTENSITY.min, BLUR_REGION.INTENSITY.max)
        : DEFAULT_BLUR_PRESET_DEFAULTS.intensity,
    x:
      typeof value?.x === 'number' && Number.isFinite(value.x)
        ? clamp(value.x, BLUR_REGION.X.min, BLUR_REGION.X.max - width)
        : DEFAULT_BLUR_PRESET_DEFAULTS.x,
    y:
      typeof value?.y === 'number' && Number.isFinite(value.y)
        ? clamp(value.y, BLUR_REGION.Y.min, BLUR_REGION.Y.max - height)
        : DEFAULT_BLUR_PRESET_DEFAULTS.y,
    width,
    height,
  }
}

const normalizeSwapPresetDefaults = (value: Partial<SwapPresetDefaults> | undefined): SwapPresetDefaults => ({
  duration:
    typeof value?.duration === 'number' && Number.isFinite(value.duration)
      ? Math.max(TIMELINE.MINIMUM_REGION_DURATION, value.duration)
      : DEFAULT_SWAP_PRESET_DEFAULTS.duration,
  showDesktopOverlay:
    typeof value?.showDesktopOverlay === 'boolean'
      ? value.showDesktopOverlay
      : DEFAULT_SWAP_PRESET_DEFAULTS.showDesktopOverlay,
  transition:
    value?.transition && SWAP_REGION.TRANSITION.OPTIONS.includes(value.transition)
      ? value.transition
      : DEFAULT_SWAP_PRESET_DEFAULTS.transition,
  transitionDuration:
    typeof value?.transitionDuration === 'number' && Number.isFinite(value.transitionDuration)
      ? clamp(
          value.transitionDuration,
          SWAP_REGION.TRANSITION_DURATION.min,
          SWAP_REGION.TRANSITION_DURATION.max,
        )
      : DEFAULT_SWAP_PRESET_DEFAULTS.transitionDuration,
})

const syncPresetVisualState = (
  preset: Preset,
  source: {
    frameStyles: FrameStyles
    aspectRatio: Preset['aspectRatio']
    webcamLayout: WebcamLayout
    webcamPosition: WebcamPosition
    webcamStyles: WebcamStyles
    isWebcamVisible: boolean
  },
) => {
  preset.styles = cloneDeep(source.frameStyles)
  preset.aspectRatio = source.aspectRatio
  preset.webcamLayout = cloneDeep(source.webcamLayout)
  preset.webcamPosition = cloneDeep(source.webcamPosition)
  preset.webcamStyles = cloneDeep(source.webcamStyles)
  preset.isWebcamVisible = source.isWebcamVisible
}

const DEFAULT_PRESET_TEMPLATE: Omit<Preset, 'id' | 'name'> = {
  styles: DEFAULT_PRESET_STYLES,
  aspectRatio: '16:9',
  isDefault: true,
  webcamLayout: DEFAULT_WEBCAM_LAYOUT,
  webcamStyles: DEFAULT_WEBCAM_STYLES,
  webcamPosition: DEFAULT_WEBCAM_POSITION,
  isWebcamVisible: false,
  blurDefaults: DEFAULT_BLUR_PRESET_DEFAULTS,
  swapDefaults: DEFAULT_SWAP_PRESET_DEFAULTS,
}

export const initialPresetState: PresetState = {
  presets: {},
  activePresetId: null,
  presetSaveStatus: 'idle',
}

export const createPresetSlice: Slice<PresetState, PresetActions> = (set, get) => ({
  ...initialPresetState,
  initializePresets: async () => {
    try {
      const loadedPresets = (await window.electronAPI.getSetting<Record<string, Preset>>('presets')) || {}

      loadedPresets[DEFAULT_PRESET_ID] = {
        id: DEFAULT_PRESET_ID,
        name: 'Default',
        ...JSON.parse(JSON.stringify(DEFAULT_PRESET_TEMPLATE)),
      }

      let wasModified = false
      Object.values(loadedPresets).forEach((p) => {
        if (p.id !== DEFAULT_PRESET_ID && p.isDefault) {
          delete p.isDefault
          wasModified = true
        }
        if (p.styles && p.styles.borderColor === undefined) {
          p.styles.borderColor = DEFAULT_PRESET_STYLES.borderColor
          wasModified = true
        }
        if (p.webcamStyles && p.webcamStyles.shape === undefined) {
          p.webcamStyles.shape = 'circle'
          wasModified = true
        }
        if (p.webcamStyles && p.webcamStyles.borderRadius === undefined) {
          p.webcamStyles.borderRadius = 50
          wasModified = true
        }
        if (p.webcamStyles && p.webcamStyles.isFlipped === undefined) {
          p.webcamStyles.isFlipped = false
          wasModified = true
        }
        if (p.webcamStyles && p.webcamStyles.sizeOnZoom === undefined) {
          p.webcamStyles.sizeOnZoom = DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.defaultValue;
          wasModified = true;
        }
        if (p.webcamStyles && p.webcamStyles.smartPosition === undefined) {
          p.webcamStyles.smartPosition = DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue
          wasModified = true
        }
        if (p.webcamStyles) {
          const normalizedCrop = normalizeWebcamCrop(p.webcamStyles.crop, DEFAULT_WEBCAM_STYLES.crop)
          if (
            !p.webcamStyles.crop ||
            normalizedCrop.top !== p.webcamStyles.crop.top ||
            normalizedCrop.right !== p.webcamStyles.crop.right ||
            normalizedCrop.bottom !== p.webcamStyles.crop.bottom ||
            normalizedCrop.left !== p.webcamStyles.crop.left
          ) {
            p.webcamStyles.crop = normalizedCrop
            wasModified = true
          }
        }
        if (!p.webcamLayout) {
          p.webcamLayout = JSON.parse(JSON.stringify(DEFAULT_WEBCAM_LAYOUT))
          wasModified = true
        } else {
          const normalizedMode = normalizeWebcamLayoutMode(p.webcamLayout.mode)
          if (p.webcamLayout.mode !== normalizedMode) {
            p.webcamLayout.mode = normalizedMode
            wasModified = true
          }
          if (p.webcamLayout.side === undefined) {
            p.webcamLayout.side = DEFAULTS.CAMERA.LAYOUT.SIDE.defaultValue
            wasModified = true
          }
          if (p.webcamLayout.webcamWidthPercent === undefined) {
            p.webcamLayout.webcamWidthPercent = DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.defaultValue
            wasModified = true
          }
        }
        const normalizedBlurDefaults = normalizeBlurPresetDefaults(p.blurDefaults)
        if (!p.blurDefaults || JSON.stringify(p.blurDefaults) !== JSON.stringify(normalizedBlurDefaults)) {
          p.blurDefaults = normalizedBlurDefaults
          wasModified = true
        }
        const normalizedSwapDefaults = normalizeSwapPresetDefaults(p.swapDefaults)
        if (!p.swapDefaults || JSON.stringify(p.swapDefaults) !== JSON.stringify(normalizedSwapDefaults)) {
          p.swapDefaults = normalizedSwapDefaults
          wasModified = true
        }
      })

      if (wasModified) {
        await window.electronAPI.setSetting('presets', loadedPresets)
      }

      const lastId = localStorage.getItem(APP.LAST_PRESET_ID_KEY)
      const activeId = lastId && loadedPresets[lastId] ? lastId : DEFAULT_PRESET_ID

      set((state) => {
        state.presets = loadedPresets
        state.activePresetId = activeId
      })

      get().applyPreset(activeId)
    } catch (error) {
      console.error('Could not initialize presets:', error)
    }
  },
  applyPreset: (id) => {
    const preset = get().presets[id]
    if (preset) {
      set((state) => {
        state.frameStyles = cloneDeep(preset.styles)
        state.aspectRatio = preset.aspectRatio
        state.activePresetId = id
        if (preset.webcamLayout) state.webcamLayout = cloneDeep(preset.webcamLayout)
        if (preset.webcamStyles) state.webcamStyles = cloneDeep(preset.webcamStyles)
        if (preset.webcamPosition) state.webcamPosition = cloneDeep(preset.webcamPosition)
        if (preset.isWebcamVisible !== undefined) state.isWebcamVisible = preset.isWebcamVisible
      })
      localStorage.setItem(APP.LAST_PRESET_ID_KEY, id)
    }
  },
  resetPreset: (id) => {
    set((state) => {
      const presetToReset = state.presets[id]
      if (presetToReset?.isDefault) {
        presetToReset.styles = cloneDeep(DEFAULT_PRESET_TEMPLATE.styles)
        presetToReset.aspectRatio = DEFAULT_PRESET_TEMPLATE.aspectRatio
        presetToReset.webcamLayout = cloneDeep(DEFAULT_PRESET_TEMPLATE.webcamLayout)
        presetToReset.webcamStyles = cloneDeep(DEFAULT_PRESET_TEMPLATE.webcamStyles)
        presetToReset.webcamPosition = cloneDeep(DEFAULT_PRESET_TEMPLATE.webcamPosition)
        presetToReset.isWebcamVisible = DEFAULT_PRESET_TEMPLATE.isWebcamVisible
        presetToReset.blurDefaults = cloneDeep(DEFAULT_PRESET_TEMPLATE.blurDefaults)
        presetToReset.swapDefaults = cloneDeep(DEFAULT_PRESET_TEMPLATE.swapDefaults)
        if (state.activePresetId === id) get().applyPreset(id)
      }
    })
    get()._persistPresets(get().presets)
  },
  _ensureActivePresetIsWritable: () => {
    const { activePresetId, presets } = get()
    if (activePresetId && presets[activePresetId]?.isDefault) {
      const newId = `preset-${Date.now()}`
      const newPreset: Preset = {
        ...cloneDeep(presets[activePresetId]),
        id: newId,
        name: 'Custom Preset',
        isDefault: false,
      }
      set((state) => {
        state.presets[newId] = newPreset
        state.activePresetId = newId
      })
      localStorage.setItem(APP.LAST_PRESET_ID_KEY, newId)
    }
  },

  _persistPresets: async (presets: Record<string, Preset>) => {
    try {
      set((state) => {
        state.presetSaveStatus = 'saving'
      })
      await window.electronAPI.setSetting('presets', presets)
      set((state) => {
        state.presetSaveStatus = 'saved'
      })
      setTimeout(() => {
        if (get().presetSaveStatus === 'saved') {
          set((state) => {
            state.presetSaveStatus = 'idle'
          })
        }
      }, 1500)
    } catch (error) {
      console.error('Failed to save presets:', error)
      set((state) => {
        state.presetSaveStatus = 'idle'
      })
    }
  },

  updatePresetName: (id, name) => {
    set((state) => {
      const preset = state.presets[id]
      if (preset && !preset.isDefault) {
        preset.name = name
      }
    })
    get()._persistPresets(get().presets)
  },
  saveCurrentStyleAsPreset: (name) => {
    const id = `preset-${Date.now()}`
    const { frameStyles, aspectRatio, webcamLayout, webcamPosition, webcamStyles, isWebcamVisible, activePresetId, presets } = get()
    const activePreset = activePresetId ? presets[activePresetId] : null
    const newPreset: Preset = {
      id,
      name,
      styles: cloneDeep(frameStyles),
      aspectRatio,
      isDefault: false,
      webcamLayout: cloneDeep(webcamLayout),
      webcamPosition: cloneDeep(webcamPosition),
      webcamStyles: cloneDeep(webcamStyles),
      isWebcamVisible,
      blurDefaults: cloneDeep(normalizeBlurPresetDefaults(activePreset?.blurDefaults)),
      swapDefaults: cloneDeep(normalizeSwapPresetDefaults(activePreset?.swapDefaults)),
    }
    set((state) => {
      state.presets[id] = newPreset
      state.activePresetId = id
    })
    localStorage.setItem(APP.LAST_PRESET_ID_KEY, id)
    get()._persistPresets(get().presets)
  },
  updateActivePreset: () => {
    const { activePresetId, presets, frameStyles, aspectRatio, webcamLayout, webcamPosition, webcamStyles, isWebcamVisible } = get()
    if (activePresetId && presets[activePresetId]) {
      set((state) => {
        const active = state.presets[activePresetId]
        syncPresetVisualState(active, {
          frameStyles,
          aspectRatio,
          webcamLayout,
          webcamPosition,
          webcamStyles,
          isWebcamVisible,
        })
      })
      get()._persistPresets(get().presets)
    }
  },
  _updateActivePresetToolDefaults: (defaults) => {
    get()._ensureActivePresetIsWritable()

    const activePresetId = get().activePresetId
    if (!activePresetId || !get().presets[activePresetId]) return

    set((state) => {
      const active = state.presets[activePresetId]
      if (defaults.blurDefaults) {
        active.blurDefaults = cloneDeep(normalizeBlurPresetDefaults(defaults.blurDefaults))
      }
      if (defaults.swapDefaults) {
        active.swapDefaults = cloneDeep(normalizeSwapPresetDefaults(defaults.swapDefaults))
      }
    })

    get()._persistPresets(get().presets)
  },
  deletePreset: (id) => {
    if (get().presets[id]?.isDefault || id === DEFAULT_PRESET_ID) return
    set((state) => {
      delete state.presets[id]
      if (state.activePresetId === id) get().applyPreset(DEFAULT_PRESET_ID)
    })
    get()._persistPresets(get().presets)
  },
})
