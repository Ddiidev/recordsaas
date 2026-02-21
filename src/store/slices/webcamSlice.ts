import { DEFAULTS } from '../../lib/constants'
import type { WebcamState, WebcamActions, WebcamPosition, WebcamStyles, Slice } from '../../types'

export const initialWebcamState: WebcamState = {
  webcamVideoPath: null,
  webcamVideoUrl: null,
  isWebcamVisible: false,
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
  },
}

export const createWebcamSlice: Slice<WebcamState, WebcamActions> = (set, get) => ({
  ...initialWebcamState,
  setWebcamPosition: (position: WebcamPosition) => {
    set((state) => {
      state.webcamPosition = position
    })
    get()._ensureActivePresetIsWritable()
  },
  setWebcamVisibility: (isVisible: boolean) => {
    set((state) => {
      state.isWebcamVisible = isVisible
    })
    get()._ensureActivePresetIsWritable()
  },
  updateWebcamStyle: (style: Partial<WebcamStyles>) => {
    set((state) => {
      Object.assign(state.webcamStyles, style)
    })
    get()._ensureActivePresetIsWritable()
  },
})
