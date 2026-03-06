import { APP, DEFAULTS } from '../../lib/constants'
import type { PresetState, PresetActions, Slice } from '../../types'
import type { Preset, FrameStyles, WebcamLayout, WebcamStyles, WebcamPosition } from '../../types'
import { initialFrameState } from './frameSlice'
import { initialWebcamState } from './webcamSlice'
import { normalizeWebcamCrop, normalizeWebcamLayoutMode } from '../../lib/webcam'

const DEFAULT_PRESET_ID = 'default-preset-v1'

const DEFAULT_PRESET_STYLES: FrameStyles = initialFrameState.frameStyles
const DEFAULT_WEBCAM_LAYOUT: WebcamLayout = initialWebcamState.webcamLayout
const DEFAULT_WEBCAM_STYLES: WebcamStyles = initialWebcamState.webcamStyles
const DEFAULT_WEBCAM_POSITION: WebcamPosition = initialWebcamState.webcamPosition

const DEFAULT_PRESET_TEMPLATE: Omit<Preset, 'id' | 'name'> = {
  styles: DEFAULT_PRESET_STYLES,
  aspectRatio: '16:9',
  isDefault: true,
  webcamLayout: DEFAULT_WEBCAM_LAYOUT,
  webcamStyles: DEFAULT_WEBCAM_STYLES,
  webcamPosition: DEFAULT_WEBCAM_POSITION,
  isWebcamVisible: false,
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
        state.frameStyles = JSON.parse(JSON.stringify(preset.styles))
        state.aspectRatio = preset.aspectRatio
        state.activePresetId = id
        if (preset.webcamLayout) state.webcamLayout = JSON.parse(JSON.stringify(preset.webcamLayout))
        if (preset.webcamStyles) state.webcamStyles = JSON.parse(JSON.stringify(preset.webcamStyles))
        if (preset.webcamPosition) state.webcamPosition = JSON.parse(JSON.stringify(preset.webcamPosition))
        if (preset.isWebcamVisible !== undefined) state.isWebcamVisible = preset.isWebcamVisible
      })
      localStorage.setItem(APP.LAST_PRESET_ID_KEY, id)
    }
  },
  resetPreset: (id) => {
    set((state) => {
      const presetToReset = state.presets[id]
      if (presetToReset?.isDefault) {
        presetToReset.styles = JSON.parse(JSON.stringify(DEFAULT_PRESET_TEMPLATE.styles))
        presetToReset.aspectRatio = DEFAULT_PRESET_TEMPLATE.aspectRatio
        presetToReset.webcamLayout = JSON.parse(JSON.stringify(DEFAULT_PRESET_TEMPLATE.webcamLayout))
        presetToReset.webcamStyles = JSON.parse(JSON.stringify(DEFAULT_PRESET_TEMPLATE.webcamStyles))
        presetToReset.webcamPosition = JSON.parse(JSON.stringify(DEFAULT_PRESET_TEMPLATE.webcamPosition))
        presetToReset.isWebcamVisible = DEFAULT_PRESET_TEMPLATE.isWebcamVisible
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
        ...JSON.parse(JSON.stringify(presets[activePresetId])),
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
    get().updateActivePreset()
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
    const { frameStyles, aspectRatio, webcamLayout, webcamPosition, webcamStyles, isWebcamVisible } = get()
    const newPreset: Preset = {
      id,
      name,
      styles: JSON.parse(JSON.stringify(frameStyles)),
      aspectRatio,
      isDefault: false,
      webcamLayout: JSON.parse(JSON.stringify(webcamLayout)),
      webcamPosition: JSON.parse(JSON.stringify(webcamPosition)),
      webcamStyles: JSON.parse(JSON.stringify(webcamStyles)),
      isWebcamVisible,
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
        active.styles = JSON.parse(JSON.stringify(frameStyles))
        active.aspectRatio = aspectRatio
        active.webcamLayout = JSON.parse(JSON.stringify(webcamLayout))
        active.webcamPosition = JSON.parse(JSON.stringify(webcamPosition))
        active.webcamStyles = JSON.parse(JSON.stringify(webcamStyles))
        active.isWebcamVisible = isWebcamVisible
      })
      get()._persistPresets(get().presets)
    }
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
