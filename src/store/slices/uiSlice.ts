import type { UIState, UIActions, Slice, CursorStyles, SidePanelTab, AppearanceMode } from '../../types'
import { DEFAULTS } from '../../lib/constants'

const initialCursorStyles: CursorStyles = {
  showCursor: DEFAULTS.CURSOR.SHOW_CURSOR.defaultValue,
  shadowBlur: DEFAULTS.CURSOR.SHADOW.BLUR.defaultValue,
  shadowOffsetX: DEFAULTS.CURSOR.SHADOW.OFFSET_X.defaultValue,
  shadowOffsetY: DEFAULTS.CURSOR.SHADOW.OFFSET_Y.defaultValue,
  shadowColor: DEFAULTS.CURSOR.SHADOW.DEFAULT_COLOR_RGBA,
  clickRippleEffect: DEFAULTS.CURSOR.CLICK_RIPPLE.ENABLED.defaultValue,
  clickRippleColor: DEFAULTS.CURSOR.CLICK_RIPPLE.COLOR.defaultValue,
  clickRippleSize: DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.defaultValue,
  clickRippleDuration: DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.defaultValue,
  clickScaleEffect: DEFAULTS.CURSOR.CLICK_SCALE.ENABLED.defaultValue,
  clickScaleAmount: DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.defaultValue,
  clickScaleDuration: DEFAULTS.CURSOR.CLICK_SCALE.DURATION.defaultValue,
  clickScaleEasing: DEFAULTS.CURSOR.CLICK_SCALE.EASING.defaultValue,
}

const isAppearanceMode = (mode: unknown): mode is AppearanceMode =>
  mode === 'light' || mode === 'dark' || mode === 'auto'

const resolveMode = (mode: AppearanceMode): 'light' | 'dark' => {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const initialUIState: UIState = {
  mode: 'light',
  isPreviewFullScreen: false,
  cursorThemeName: 'default',
  cursorStyles: initialCursorStyles,
  activeSidePanelTab: 'general',
}

const updateWindowsTitleBar = (mode: AppearanceMode, platform: NodeJS.Platform | null) => {
  if (platform !== 'win32') return

  const effectiveMode = resolveMode(mode)

  const options =
    effectiveMode === 'dark'
      ? { color: '#1D2025', symbolColor: '#EEEEEE' } // Matches dark card/sidebar
      : { color: '#F9FAFB', symbolColor: '#333333' } // Matches light card/sidebar
  window.electronAPI.updateTitleBarOverlay(options)
}

export const createUISlice: Slice<UIState, UIActions> = (set, get) => ({
  ...initialUIState,
  setMode: (mode: AppearanceMode) => {
    set((state) => {
      state.mode = mode
    })
    window.electronAPI.setSetting('appearance.mode', mode)
    updateWindowsTitleBar(mode, get().platform)
  },
  initializeSettings: async () => {
    try {
      const appearance = await window.electronAPI.getSetting<{
        mode: AppearanceMode
        cursorThemeName: string
        cursorStyles: Partial<CursorStyles>
      }>('appearance')

      let finalMode: AppearanceMode = 'light'

      if (isAppearanceMode(appearance?.mode)) {
        finalMode = appearance.mode
        set((state) => {
          state.mode = appearance.mode
        })
      }
      if (appearance?.cursorThemeName) {
        set((state) => {
          state.cursorThemeName = appearance.cursorThemeName
        })
      }
      if (appearance?.cursorStyles) {
        set((state) => {
          state.cursorStyles = { ...initialCursorStyles, ...appearance.cursorStyles }
        })
      }
      updateWindowsTitleBar(finalMode, get().platform)
    } catch (error) {
      console.error('Could not load app settings:', error)
    }
  },
  togglePreviewFullScreen: () =>
    set((state) => {
      state.isPreviewFullScreen = !state.isPreviewFullScreen
    }),
  setCursorThemeName: (themeName: string) => {
    set((state) => {
      state.cursorThemeName = themeName
    })
    window.electronAPI.setSetting('appearance.cursorThemeName', themeName)
  },
  updateCursorStyle: (style: Partial<CursorStyles>) => {
    set((state) => {
      Object.assign(state.cursorStyles, style)
    })
    window.electronAPI.setSetting('appearance.cursorStyles', get().cursorStyles)
  },
  setActiveSidePanelTab: (tab: SidePanelTab) => {
    set((state) => {
      state.activeSidePanelTab = tab
    })
  },
})
