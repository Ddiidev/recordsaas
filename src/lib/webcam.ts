import { DEFAULTS } from './constants'
import type { WebcamCrop, WebcamLayoutMode, WebcamShape } from '../types'

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const normalizeCropAxis = (start: number, end: number): [number, number] => {
  const maxTotal = 1 - DEFAULTS.CAMERA.CROP.MIN_VISIBLE_PORTION
  const total = start + end

  if (total <= maxTotal || total <= 0) {
    return [start, end]
  }

  const scale = maxTotal / total
  return [start * scale, end * scale]
}

export const getDefaultWebcamCrop = (): WebcamCrop => ({
  top: DEFAULTS.CAMERA.CROP.TOP.defaultValue,
  right: DEFAULTS.CAMERA.CROP.RIGHT.defaultValue,
  bottom: DEFAULTS.CAMERA.CROP.BOTTOM.defaultValue,
  left: DEFAULTS.CAMERA.CROP.LEFT.defaultValue,
})

export const normalizeWebcamCrop = (
  crop: Partial<WebcamCrop> | null | undefined,
  baseCrop: WebcamCrop = getDefaultWebcamCrop(),
): WebcamCrop => {
  const nextCrop: WebcamCrop = {
    top:
      typeof crop?.top === 'number' && Number.isFinite(crop.top)
        ? clamp(crop.top, DEFAULTS.CAMERA.CROP.TOP.min, DEFAULTS.CAMERA.CROP.TOP.max)
        : baseCrop.top,
    right:
      typeof crop?.right === 'number' && Number.isFinite(crop.right)
        ? clamp(crop.right, DEFAULTS.CAMERA.CROP.RIGHT.min, DEFAULTS.CAMERA.CROP.RIGHT.max)
        : baseCrop.right,
    bottom:
      typeof crop?.bottom === 'number' && Number.isFinite(crop.bottom)
        ? clamp(crop.bottom, DEFAULTS.CAMERA.CROP.BOTTOM.min, DEFAULTS.CAMERA.CROP.BOTTOM.max)
        : baseCrop.bottom,
    left:
      typeof crop?.left === 'number' && Number.isFinite(crop.left)
        ? clamp(crop.left, DEFAULTS.CAMERA.CROP.LEFT.min, DEFAULTS.CAMERA.CROP.LEFT.max)
        : baseCrop.left,
  }

  ;[nextCrop.left, nextCrop.right] = normalizeCropAxis(nextCrop.left, nextCrop.right)
  ;[nextCrop.top, nextCrop.bottom] = normalizeCropAxis(nextCrop.top, nextCrop.bottom)

  return nextCrop
}

export const normalizeWebcamLayoutMode = (mode: unknown): WebcamLayoutMode =>
  mode === 'side-by-side' || mode === 'floating-sidebar' ? 'side-by-side' : 'overlay'

export const isWebcamShape = (shape: unknown): shape is WebcamShape =>
  shape === 'circle' || shape === 'square' || shape === 'rectangle' || shape === 'phone'

export const getWebcamAspectRatio = (shape: WebcamShape): number => {
  switch (shape) {
    case 'rectangle':
      return 16 / 9
    case 'phone':
      return 9 / 16
    default:
      return 1
  }
}

export const getWebcamCssAspectRatio = (shape: WebcamShape): string => {
  switch (shape) {
    case 'rectangle':
      return '16 / 9'
    case 'phone':
      return '9 / 16'
    default:
      return '1 / 1'
  }
}

export const getWebcamCssBorderRadius = (shape: WebcamShape, borderRadius: number): string =>
  shape === 'circle' ? '50%' : `${borderRadius}%`

export const getWebcamRadius = (shape: WebcamShape, width: number, height: number, borderRadius: number): number => {
  const maxRadius = Math.min(width, height) / 2
  return shape === 'circle' ? maxRadius : maxRadius * (borderRadius / 50)
}
