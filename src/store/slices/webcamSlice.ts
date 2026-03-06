import { DEFAULTS } from '../../lib/constants'
import type { WebcamState, WebcamActions, WebcamLayout, WebcamPosition, WebcamStyles, Slice } from '../../types'
import { getDefaultWebcamCrop, normalizeWebcamCrop } from '../../lib/webcam'

const DEFAULT_WEBCAM_LAYOUT: WebcamLayout = {
  mode: DEFAULTS.CAMERA.LAYOUT.MODE.defaultValue,
  side: DEFAULTS.CAMERA.LAYOUT.SIDE.defaultValue,
  webcamWidthPercent: DEFAULTS.CAMERA.LAYOUT.WIDTH_PERCENT.defaultValue,
}

export const initialWebcamState: WebcamState = {
  webcamVideoPath: null,
  webcamVideoUrl: null,
  isWebcamVisible: false,
  webcamLayout: DEFAULT_WEBCAM_LAYOUT,
  webcamPosition: { pos: 'bottom-right' },
  webcamStyles: {
    shape: 'square',
    borderRadius: 35,
    size: 30,
    sizeOnZoom: DEFAULTS.CAMERA.PLACEMENT.SIZE_ON_ZOOM.defaultValue,
    shadowBlur: 20,
    shadowOffsetX: 0,
    shadowOffsetY: 10,
    shadowColor: 'rgba(0, 0, 0, 0.4)',
    isFlipped: false,
    scaleOnZoom: DEFAULTS.CAMERA.STYLE.SCALE_ON_ZOOM.defaultValue,
    smartPosition: DEFAULTS.CAMERA.SMART_POSITION.ENABLED.defaultValue,
    border: DEFAULTS.CAMERA.STYLE.BORDER.ENABLED.defaultValue,
    borderWidth: DEFAULTS.CAMERA.STYLE.BORDER.WIDTH.defaultValue,
    borderColor: DEFAULTS.CAMERA.STYLE.BORDER.DEFAULT_COLOR_RGBA,
    crop: getDefaultWebcamCrop(),
  },
}

export const createWebcamSlice: Slice<WebcamState, WebcamActions> = (set, get) => ({
  ...initialWebcamState,
  updateWebcamLayout: (layout) => {
    set((state) => {
      state.webcamLayout = {
        ...state.webcamLayout,
        ...layout,
      }
    })
    get()._ensureActivePresetIsWritable()
    get().updateActivePreset()
  },
  setWebcamPosition: (position: WebcamPosition) => {
    set((state) => {
      state.webcamPosition = position
    })
    get()._ensureActivePresetIsWritable()
    get().updateActivePreset()
  },
  setWebcamVisibility: (isVisible: boolean) => {
    set((state) => {
      state.isWebcamVisible = isVisible
    })
    get()._ensureActivePresetIsWritable()
    get().updateActivePreset()
  },
  updateWebcamStyle: (style: Partial<WebcamStyles>) => {
    set((state) => {
      const nextStyle = { ...style }
      if (style.crop) {
        nextStyle.crop = normalizeWebcamCrop(style.crop, state.webcamStyles.crop)
      }
      Object.assign(state.webcamStyles, nextStyle)
    })
    get()._ensureActivePresetIsWritable()
    get().updateActivePreset()
  },
})
