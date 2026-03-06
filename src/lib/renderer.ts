import { calculateZoomTransform, findLastMetadataIndex } from './transform'
import { EASING_MAP } from './easing'
import { DEFAULTS } from './constants'
import {
  createLanePrecedenceContext,
  getTopActiveRegionAtTime,
  isRegionActiveAtTime,
  sortRegionsByLanePrecedence,
} from './timeline-lanes'
import { getWebcamAspectRatio, getWebcamRadius } from './webcam'
import type { EditorState, RenderableState, WebcamLayout, WebcamPosition, WebcamStyles } from '../types'

type Rect = { x: number; y: number; width: number; height: number }
type MediaRectConfig = Rect & {
  radius: number
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  shadowColor: string
  borderWidth: number
  borderColor: string
  zIndex: number
}
type ResolvedLayout = {
  mode: WebcamLayout['mode']
  desktopConfig: MediaRectConfig
  cameraConfig: MediaRectConfig | null
  cameraFlip: boolean
}
type WindowWithScreenCache = Window & {
  __screenCacheCanvas?: HTMLCanvasElement
  __screenCacheCtx?: CanvasRenderingContext2D | null
}

let blurSampleCanvas: HTMLCanvasElement | null = null
let blurSampleCtx: CanvasRenderingContext2D | null = null
let blurPixelCanvas: HTMLCanvasElement | null = null
let blurPixelCtx: CanvasRenderingContext2D | null = null

const getOrCreateCanvas = (
  kind: 'sample' | 'pixel' | 'screen',
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null => {
  const roundedWidth = Math.max(1, Math.round(width))
  const roundedHeight = Math.max(1, Math.round(height))

  if (kind === 'sample') {
    if (!blurSampleCanvas) {
      blurSampleCanvas = document.createElement('canvas')
      blurSampleCtx = blurSampleCanvas.getContext('2d')
    }
    if (!blurSampleCanvas || !blurSampleCtx) return null
    if (blurSampleCanvas.width !== roundedWidth) blurSampleCanvas.width = roundedWidth
    if (blurSampleCanvas.height !== roundedHeight) blurSampleCanvas.height = roundedHeight
    return { canvas: blurSampleCanvas, ctx: blurSampleCtx }
  }

  if (kind === 'screen') {
    const cacheWindow = window as WindowWithScreenCache
    if (!cacheWindow.__screenCacheCanvas) {
      cacheWindow.__screenCacheCanvas = document.createElement('canvas')
      cacheWindow.__screenCacheCtx = cacheWindow.__screenCacheCanvas.getContext('2d')
    }
    const canvas = cacheWindow.__screenCacheCanvas
    const ctx = cacheWindow.__screenCacheCtx
    if (!canvas || !ctx) return null
    if (canvas.width !== roundedWidth) canvas.width = roundedWidth
    if (canvas.height !== roundedHeight) canvas.height = roundedHeight
    return { canvas, ctx }
  }

  if (!blurPixelCanvas) {
    blurPixelCanvas = document.createElement('canvas')
    blurPixelCtx = blurPixelCanvas.getContext('2d')
  }
  if (!blurPixelCanvas || !blurPixelCtx) return null
  if (blurPixelCanvas.width !== roundedWidth) blurPixelCanvas.width = roundedWidth
  if (blurPixelCanvas.height !== roundedHeight) blurPixelCanvas.height = roundedHeight
  return { canvas: blurPixelCanvas, ctx: blurPixelCtx }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const resolveBlurRect = (
  region: RenderableState['blurRegions'][string],
  frameX: number,
  frameY: number,
  frameWidth: number,
  frameHeight: number,
): Rect | null => {
  if (frameWidth <= 0 || frameHeight <= 0) return null

  const normalizedWidth = clamp(region.width, 0.01, 1)
  const normalizedHeight = clamp(region.height, 0.01, 1)
  const normalizedX = clamp(region.x, 0, 1 - normalizedWidth)
  const normalizedY = clamp(region.y, 0, 1 - normalizedHeight)

  const x = frameX + normalizedX * frameWidth
  const y = frameY + normalizedY * frameHeight
  const maxWidth = frameX + frameWidth - x
  const maxHeight = frameY + frameHeight - y
  const width = Math.max(1, Math.round(Math.min(normalizedWidth * frameWidth, maxWidth)))
  const height = Math.max(1, Math.round(Math.min(normalizedHeight * frameHeight, maxHeight)))

  if (width <= 0 || height <= 0) return null

  return {
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
  }
}

const applyBlurToRect = (ctx: CanvasRenderingContext2D, rect: Rect, intensity: number) => {
  const blurRadius = Math.max(0, intensity)
  if (blurRadius <= 0 || rect.width <= 0 || rect.height <= 0) return

  const sourceCanvas = ctx.canvas as CanvasImageSource
  const padding = Math.ceil(blurRadius * 2)
  const sampleX = Math.max(0, rect.x - padding)
  const sampleY = Math.max(0, rect.y - padding)
  const sampleWidth = Math.min(ctx.canvas.width - sampleX, rect.width + padding * 2)
  const sampleHeight = Math.min(ctx.canvas.height - sampleY, rect.height + padding * 2)
  if (sampleWidth <= 0 || sampleHeight <= 0) return

  const sample = getOrCreateCanvas('sample', sampleWidth, sampleHeight)
  if (!sample) return

  sample.ctx.clearRect(0, 0, sampleWidth, sampleHeight)
  sample.ctx.drawImage(sourceCanvas, sampleX, sampleY, sampleWidth, sampleHeight, 0, 0, sampleWidth, sampleHeight)

  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.filter = `blur(${blurRadius}px)`
  ctx.drawImage(sample.canvas, sampleX, sampleY, sampleWidth, sampleHeight)
  ctx.restore()
}

const applyPixelationToRect = (ctx: CanvasRenderingContext2D, rect: Rect, intensity: number) => {
  const pixelSize = Math.max(1, Math.round(intensity))
  if (rect.width <= 0 || rect.height <= 0) return

  const sourceCanvas = ctx.canvas as CanvasImageSource
  const scaledWidth = Math.max(1, Math.floor(rect.width / pixelSize))
  const scaledHeight = Math.max(1, Math.floor(rect.height / pixelSize))
  const pixelCanvas = getOrCreateCanvas('pixel', scaledWidth, scaledHeight)
  if (!pixelCanvas) return

  pixelCanvas.ctx.imageSmoothingEnabled = true
  pixelCanvas.ctx.clearRect(0, 0, scaledWidth, scaledHeight)
  pixelCanvas.ctx.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, scaledWidth, scaledHeight)

  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(pixelCanvas.canvas, 0, 0, scaledWidth, scaledHeight, rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

function getWebcamRectForPosition(
  pos: WebcamPosition['pos'],
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): Rect {
  const baseSize = Math.min(outputWidth, outputHeight)
  const edgePadding = baseSize * 0.02

  switch (pos) {
    case 'top-left':
      return { x: edgePadding, y: edgePadding, width, height }
    case 'top-center':
      return { x: (outputWidth - width) / 2, y: edgePadding, width, height }
    case 'top-right':
      return { x: outputWidth - width - edgePadding, y: edgePadding, width, height }
    case 'left-center':
      return { x: edgePadding, y: (outputHeight - height) / 2, width, height }
    case 'right-center':
      return { x: outputWidth - width - edgePadding, y: (outputHeight - height) / 2, width, height }
    case 'bottom-left':
      return { x: edgePadding, y: outputHeight - height - edgePadding, width, height }
    case 'bottom-center':
      return { x: (outputWidth - width) / 2, y: outputHeight - height - edgePadding, width, height }
    default:
      return { x: outputWidth - width - edgePadding, y: outputHeight - height - edgePadding, width, height }
  }
}

function lerp(start: number, end: number, t: number): number {
  return start * (1 - t) + end * t
}

const insetRect = (rect: Rect, insetX: number, insetY: number): Rect => ({
  x: rect.x + insetX,
  y: rect.y + insetY,
  width: Math.max(1, rect.width - insetX * 2),
  height: Math.max(1, rect.height - insetY * 2),
})

const fitRectWithinBounds = (bounds: Rect, aspectRatio: number): Rect => {
  if (bounds.width <= 0 || bounds.height <= 0) return bounds

  const safeAspectRatio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1
  let width = bounds.width
  let height = width / safeAspectRatio

  if (height > bounds.height) {
    height = bounds.height
    width = height * safeAspectRatio
  }

  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  }
}

const createFrameConfig = (rect: Rect, frameStyles: RenderableState['frameStyles'], zIndex: number): MediaRectConfig => ({
  ...rect,
  radius: frameStyles.borderRadius,
  shadowBlur: frameStyles.shadowBlur,
  shadowOffsetX: frameStyles.shadowOffsetX,
  shadowOffsetY: frameStyles.shadowOffsetY,
  shadowColor: frameStyles.shadowColor,
  borderWidth: frameStyles.borderWidth,
  borderColor: frameStyles.borderColor,
  zIndex,
})

const createStyledCameraConfig = (rect: Rect, webcamStyles: WebcamStyles, zIndex: number): MediaRectConfig => ({
  ...rect,
  radius: getWebcamRadius(webcamStyles.shape, rect.width, rect.height, webcamStyles.borderRadius),
  shadowBlur: webcamStyles.shadowBlur,
  shadowOffsetX: webcamStyles.shadowOffsetX,
  shadowOffsetY: webcamStyles.shadowOffsetY,
  shadowColor: webcamStyles.shadowColor,
  borderWidth: webcamStyles.border ? webcamStyles.borderWidth : 0,
  borderColor: webcamStyles.borderColor || 'rgba(0,0,0,0)',
  zIndex,
})

const buildOverlayCameraConfig = ({
  webcamPosition,
  webcamStyles,
  activeZoomRegion,
  currentTime,
  outputWidth,
  outputHeight,
}: {
  webcamPosition: WebcamPosition
  webcamStyles: WebcamStyles
  activeZoomRegion: RenderableState['zoomRegions'][string] | null
  currentTime: number
  outputWidth: number
  outputHeight: number
}): MediaRectConfig => {
  let finalWebcamScale = 1

  if (webcamStyles.scaleOnZoom && activeZoomRegion) {
    const { startTime, duration, transitionDuration } = activeZoomRegion
    const zoomInEndTime = startTime + transitionDuration
    const zoomOutStartTime = startTime + duration - transitionDuration
    const easingFn = EASING_MAP[activeZoomRegion.easing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
    if (currentTime < zoomInEndTime) {
      finalWebcamScale = lerp(1, DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, easingFn((currentTime - startTime) / transitionDuration))
    } else if (currentTime >= zoomOutStartTime) {
      finalWebcamScale = lerp(DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, 1, easingFn((currentTime - zoomOutStartTime) / transitionDuration))
    } else {
      finalWebcamScale = DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT
    }
  }

  const baseSize = Math.min(outputWidth, outputHeight)
  const edgePadding = baseSize * 0.02
  const aspectRatio = getWebcamAspectRatio(webcamStyles.shape)
  let startSize = webcamStyles.size
  let targetSize = webcamStyles.sizeOnZoom
  let t = 0

  if (webcamStyles.scaleOnZoom && activeZoomRegion) {
    const { startTime, duration, transitionDuration } = activeZoomRegion
    const zoomInEndTime = startTime + transitionDuration
    const zoomOutStartTime = startTime + duration - transitionDuration
    const easingFn = EASING_MAP[activeZoomRegion.easing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
    if (currentTime < zoomInEndTime) {
      t = easingFn((currentTime - startTime) / transitionDuration)
    } else if (currentTime >= zoomOutStartTime) {
      t = easingFn((currentTime - zoomOutStartTime) / transitionDuration)
      ;[startSize, targetSize] = [targetSize, startSize]
    } else {
      startSize = targetSize
      t = 1
    }
  }

  const desiredWebcamWidth = baseSize * (lerp(startSize, targetSize, t) / 100)
  const maxWebcamWidth = Math.min(outputWidth - edgePadding * 2, (outputHeight - edgePadding * 2) * aspectRatio)
  const webcamWidth = Math.min(desiredWebcamWidth, maxWebcamWidth / finalWebcamScale)
  const webcamHeight = webcamWidth / aspectRatio
  const webcamRect = getWebcamRectForPosition(webcamPosition.pos, webcamWidth, webcamHeight, outputWidth, outputHeight)
  const scaledWebcamWidth = webcamRect.width * finalWebcamScale
  const scaledWebcamHeight = webcamRect.height * finalWebcamScale

  return createStyledCameraConfig(
    {
      x: webcamStyles.isFlipped ? outputWidth - webcamRect.x - scaledWebcamWidth : webcamRect.x,
      y: webcamRect.y,
      width: scaledWebcamWidth,
      height: scaledWebcamHeight,
    },
    webcamStyles,
    1,
  )
}

const resolveLayoutConfig = ({
  state,
  frameConfig,
  activeZoomRegion,
  currentTime,
  outputWidth,
  outputHeight,
  availableWidth,
  availableHeight,
}: {
  state: RenderableState
  frameConfig: MediaRectConfig
  activeZoomRegion: RenderableState['zoomRegions'][string] | null
  currentTime: number
  outputWidth: number
  outputHeight: number
  availableWidth: number
  availableHeight: number
}): ResolvedLayout => {
  const { webcamLayout, webcamPosition, webcamStyles } = state
  const baseInset = Math.min(outputWidth, outputHeight) * 0.02
  const sidebarWidth = availableWidth * (webcamLayout.webcamWidthPercent / 100)
  const gap = baseInset
  const sidebarOnLeft = webcamLayout.side === 'left'
  const availableArea: Rect = {
    x: outputWidth * (state.frameStyles.padding / 100),
    y: outputHeight * (state.frameStyles.padding / 100),
    width: availableWidth,
    height: availableHeight,
  }

  if (webcamLayout.mode === 'overlay') {
    return {
      mode: 'overlay',
      desktopConfig: frameConfig,
      cameraConfig: buildOverlayCameraConfig({
        webcamPosition,
        webcamStyles,
        activeZoomRegion,
        currentTime,
        outputWidth,
        outputHeight,
      }),
      cameraFlip: webcamStyles.isFlipped,
    }
  }

  const desktopAreaWidth = Math.max(1, availableArea.width - sidebarWidth - gap)
  const sidebarArea: Rect = sidebarOnLeft
    ? {
        x: availableArea.x,
        y: availableArea.y,
        width: sidebarWidth,
        height: availableArea.height,
      }
    : {
        x: availableArea.x + desktopAreaWidth + gap,
        y: availableArea.y,
        width: sidebarWidth,
        height: availableArea.height,
      }
  const desktopArea: Rect = sidebarOnLeft
    ? {
        x: availableArea.x + sidebarWidth + gap,
        y: availableArea.y,
        width: desktopAreaWidth,
        height: availableArea.height,
      }
    : {
        x: availableArea.x,
        y: availableArea.y,
        width: desktopAreaWidth,
        height: availableArea.height,
      }

  const desktopRect = fitRectWithinBounds(desktopArea, state.videoDimensions.width / state.videoDimensions.height)

  if (webcamLayout.mode === 'side-by-side') {
    const cameraBounds = insetRect(sidebarArea, baseInset * 0.75, baseInset * 0.75)
    const cameraRect = fitRectWithinBounds(cameraBounds, getWebcamAspectRatio(webcamStyles.shape))
    return {
      mode: 'side-by-side',
      desktopConfig: createFrameConfig(desktopRect, state.frameStyles, 0),
      cameraConfig: createStyledCameraConfig(cameraRect, webcamStyles, 1),
      cameraFlip: webcamStyles.isFlipped,
    }
  }

  return {
    mode: 'overlay',
    desktopConfig: frameConfig,
    cameraConfig: null,
    cameraFlip: webcamStyles.isFlipped,
  }
}

/**
 * Draws the background with optimized rendering
 */
const drawBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  backgroundState: EditorState['frameStyles']['background'],
  preloadedImage: HTMLImageElement | null,
): void => {
  ctx.clearRect(0, 0, width, height)

  switch (backgroundState.type) {
    case 'color':
      ctx.fillStyle = backgroundState.color || '#000000'
      ctx.fillRect(0, 0, width, height)
      break
    case 'gradient': {
      const start = backgroundState.gradientStart || '#000000'
      const end = backgroundState.gradientEnd || '#ffffff'
      const direction = backgroundState.gradientDirection || 'to right'
      let gradient

      if (direction.startsWith('circle')) {
        gradient = ctx.createRadialGradient(
          width / 2,
          height / 2,
          0,
          width / 2,
          height / 2,
          Math.max(width, height) / 2,
        )
        if (direction === 'circle-in') {
          gradient.addColorStop(0, end)
          gradient.addColorStop(1, start)
        } else {
          gradient.addColorStop(0, start)
          gradient.addColorStop(1, end)
        }
      } else {
        const getCoords = (dir: string) => {
          switch (dir) {
            case 'to bottom':
              return [0, 0, 0, height]
            case 'to top':
              return [0, height, 0, 0]
            case 'to right':
              return [0, 0, width, 0]
            case 'to left':
              return [width, 0, 0, 0]
            case 'to bottom right':
              return [0, 0, width, height]
            case 'to bottom left':
              return [width, 0, 0, height]
            case 'to top right':
              return [0, height, width, 0]
            case 'to top left':
              return [width, height, 0, 0]
            default:
              return [0, 0, width, 0]
          }
        }
        const coords = getCoords(direction)
        gradient = ctx.createLinearGradient(coords[0], coords[1], coords[2], coords[3])
        gradient.addColorStop(0, start)
        gradient.addColorStop(1, end)
      }

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      break
    }
    case 'image':
    case 'wallpaper': {
      if (preloadedImage && preloadedImage.complete) {
        const img = preloadedImage
        const imgRatio = img.width / img.height
        const canvasRatio = width / height
        let sx, sy, sWidth, sHeight

        if (imgRatio > canvasRatio) {
          sHeight = img.height
          sWidth = sHeight * canvasRatio
          sx = (img.width - sWidth) / 2
          sy = 0
        } else {
          sWidth = img.width
          sHeight = sWidth / canvasRatio
          sx = 0
          sy = (img.height - sHeight) / 2
        }
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, width, height)
      } else {
        ctx.fillStyle = 'oklch(0.2077 0.0398 265.7549)'
        ctx.fillRect(0, 0, width, height)
      }
      break
    }
    default:
      ctx.fillStyle = 'oklch(0.2077 0.0398 265.7549)'
      ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Main rendering function with enhanced visuals
 */
export const drawScene = (
  ctx: CanvasRenderingContext2D,
  state: RenderableState,
  videoElement: CanvasImageSource,
  webcamVideoElement: CanvasImageSource | null,
  currentTime: number,
  outputWidth: number,
  outputHeight: number,
  preloadedBgImage: HTMLImageElement | null,
  webcamDimensions?: { width: number; height: number },
  exportQuality?: string,
): void => {
  if (!state.videoDimensions.width || !state.videoDimensions.height) return

  const laneContext = createLanePrecedenceContext(state.timelineLanes)
  const swapRegions = Object.values(state.swapRegions || {})
  const zoomRegions = Object.values(state.zoomRegions)
  const blurRegions = Object.values(state.blurRegions)
  const activeBlurRegions = sortRegionsByLanePrecedence(
    blurRegions.filter((region) => isRegionActiveAtTime(region, currentTime)),
    laneContext,
  ).reverse()

  // Enable rendering - 'ultra high' uses bicubic interpolation, otherwise bilinear (faster)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = exportQuality === 'ultra high' ? 'high' : 'medium'

  // --- 1. Draw Background ---
  drawBackground(ctx, outputWidth, outputHeight, state.frameStyles.background, preloadedBgImage)

  // --- 2. Calculate Frame and Content Dimensions ---
  const { frameStyles, videoDimensions } = state
  const paddingPercent = frameStyles.padding / 100
  const availableWidth = outputWidth * (1 - 2 * paddingPercent)
  const availableHeight = outputHeight * (1 - 2 * paddingPercent)
  const videoAspectRatio = videoDimensions.width / videoDimensions.height

  let frameContentWidth, frameContentHeight
  if (availableWidth / availableHeight > videoAspectRatio) {
    frameContentHeight = availableHeight
    frameContentWidth = frameContentHeight * videoAspectRatio
  } else {
    frameContentWidth = availableWidth
    frameContentHeight = frameContentWidth / videoAspectRatio
  }

  const frameX = (outputWidth - frameContentWidth) / 2
  const frameY = (outputHeight - frameContentHeight) / 2

  // --- 3. Determine Swap Region and Transitions ---
  const activeSwapRegion = getTopActiveRegionAtTime(swapRegions, currentTime, laneContext)

  let isSwapped = false
  let swapProgress = 0

  if (activeSwapRegion) {
    const TRANSITION_DURATION = activeSwapRegion.transitionDuration ?? 0.3
    isSwapped = true
    swapProgress = 1
    if (activeSwapRegion.transition !== 'none') {
      const timeIn = currentTime - activeSwapRegion.startTime
      const timeOut = activeSwapRegion.startTime + activeSwapRegion.duration - currentTime
      if (timeIn < TRANSITION_DURATION) {
        swapProgress = timeIn / TRANSITION_DURATION
      } else if (timeOut < TRANSITION_DURATION) {
        swapProgress = timeOut / TRANSITION_DURATION
      }
    }
  }

  // --- 4. Prepare Screen Canvas (Video + Clicks + Cursor + Zoom) ---
  const screenCache = getOrCreateCanvas('screen', frameContentWidth, frameContentHeight)
  if (screenCache) {
    const sCtx = screenCache.ctx
    sCtx.imageSmoothingEnabled = true
    sCtx.imageSmoothingQuality = ctx.imageSmoothingQuality
    sCtx.clearRect(0, 0, frameContentWidth, frameContentHeight)

    sCtx.save()
    const { scale, translateX, translateY, transformOrigin } = calculateZoomTransform(
      currentTime,
      zoomRegions,
      laneContext,
      state.metadata,
      state.recordingGeometry || state.videoDimensions,
      { width: frameContentWidth, height: frameContentHeight },
    )
    const [originXStr, originYStr] = transformOrigin.split(' ')
    const originPxX = (parseFloat(originXStr) / 100) * frameContentWidth
    const originPxY = (parseFloat(originYStr) / 100) * frameContentHeight

    sCtx.translate(originPxX, originPxY)
    sCtx.scale(scale, scale)
    sCtx.translate(translateX, translateY)
    sCtx.translate(-originPxX, -originPxY)

    sCtx.drawImage(videoElement, 0, 0, frameContentWidth, frameContentHeight)

    if (state.cursorStyles.clickRippleEffect && state.recordingGeometry) {
      const { clickRippleDuration, clickRippleSize, clickRippleColor } = state.cursorStyles
      const recentRippleClicks = []
      const startIndex = findLastMetadataIndex(state.metadata, currentTime)
      if (startIndex > -1) {
        for (let i = startIndex; i >= 0; i--) {
          const event = state.metadata[i]
          if (currentTime - event.timestamp >= clickRippleDuration) break
          if (event.type === 'click' && event.pressed && currentTime >= event.timestamp) {
            recentRippleClicks.push(event)
          }
        }
      }
      for (const click of recentRippleClicks) {
        const progress = (currentTime - click.timestamp) / clickRippleDuration
        const easedProgress = EASING_MAP.Balanced(progress)
        const currentRadius = easedProgress * clickRippleSize
        const currentOpacity = 1 - easedProgress

        const cursorX = (click.x / state.recordingGeometry.width) * frameContentWidth
        const cursorY = (click.y / state.recordingGeometry.height) * frameContentHeight
        const colorResult = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(clickRippleColor)
        if (colorResult) {
          const [r, g, b, baseAlpha] = colorResult.slice(1).map(Number)
          sCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha * currentOpacity})`
        }

        sCtx.beginPath()
        sCtx.arc(cursorX, cursorY, currentRadius, 0, 2 * Math.PI)
        sCtx.fill()
      }
    }

    const lastEventIndex = findLastMetadataIndex(state.metadata, currentTime)
    if (state.cursorStyles.showCursor && lastEventIndex > -1 && state.recordingGeometry) {
      const event = state.metadata[lastEventIndex]
      if (event && currentTime - event.timestamp < 0.1) {
        let cursorData = event.cursorImageKey ? state.cursorBitmapsToRender.get(event.cursorImageKey) : undefined
        if (!cursorData) {
          if (state.platform === 'win32') {
            cursorData = state.cursorBitmapsToRender.get('IDC_ARROW-0')
          } else if (state.platform === 'darwin') {
            cursorData = state.cursorBitmapsToRender.get('arrow-0')
          }
          if (!cursorData) {
            cursorData = state.cursorBitmapsToRender.values().next().value
          }
        }
        if (cursorData && cursorData.imageBitmap && cursorData.width > 0) {
          const cursorX = (event.x / state.recordingGeometry.width) * frameContentWidth
          const cursorY = (event.y / state.recordingGeometry.height) * frameContentHeight
          const drawX = Math.round(cursorX - cursorData.xhot)
          const drawY = Math.round(cursorY - cursorData.yhot)

          sCtx.save()
          let cursorScale = 1
          if (state.cursorStyles.clickScaleEffect) {
            const { clickScaleDuration, clickScaleAmount, clickScaleEasing } = state.cursorStyles
            let mostRecentClick = undefined
            if (lastEventIndex > -1) {
              for (let i = lastEventIndex; i >= 0; i--) {
                const e = state.metadata[i]
                if (currentTime - e.timestamp >= clickScaleDuration) break
                if (e.type === 'click' && e.pressed && e.timestamp <= currentTime) {
                  mostRecentClick = e
                  break
                }
              }
            }
            if (mostRecentClick) {
              const progress = (currentTime - mostRecentClick.timestamp) / clickScaleDuration
              const easingFn = EASING_MAP[clickScaleEasing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
              cursorScale = 1 - (1 - clickScaleAmount) * Math.sin(easingFn(progress) * Math.PI)
            }
          }

          const { shadowBlur, shadowOffsetX, shadowOffsetY, shadowColor } = state.cursorStyles
          if (shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0) {
            sCtx.filter = `drop-shadow(${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${shadowColor})`
          }

          if (cursorScale !== 1) {
            const scaleCenterX = drawX + cursorData.xhot
            const scaleCenterY = drawY + cursorData.yhot
            sCtx.translate(scaleCenterX, scaleCenterY)
            sCtx.scale(cursorScale, cursorScale)
            sCtx.translate(-scaleCenterX, -scaleCenterY)
          }

          sCtx.drawImage(cursorData.imageBitmap, drawX, drawY)
          sCtx.restore()
        }
      }
    }
    sCtx.restore()

    for (const region of activeBlurRegions) {
      const rect = resolveBlurRect(region, 0, 0, frameContentWidth, frameContentHeight)
      if (!rect) continue
      if (region.style === 'pixelated') {
        applyPixelationToRect(sCtx, rect, region.intensity)
      } else {
        applyBlurToRect(sCtx, rect, region.intensity)
      }
    }
  }

  // --- 5. Resolve Layouts and Swapping ---
  const mainRectConfig = createFrameConfig(
    {
      x: frameX,
      y: frameY,
      width: frameContentWidth,
      height: frameContentHeight,
    },
    frameStyles,
    0,
  )

  const { isWebcamVisible } = state
  const activeZoomRegion = getTopActiveRegionAtTime(zoomRegions, currentTime, laneContext)
  const webcamDims = (() => {
    if (webcamDimensions) return webcamDimensions
    if (!webcamVideoElement) return null
    const anyWebcam = webcamVideoElement as unknown as Record<string, number>
    if (typeof anyWebcam.videoWidth === 'number' && typeof anyWebcam.videoHeight === 'number') {
      return { width: anyWebcam.videoWidth, height: anyWebcam.videoHeight }
    }
    if (typeof anyWebcam.displayWidth === 'number' && typeof anyWebcam.displayHeight === 'number') {
      return { width: anyWebcam.displayWidth, height: anyWebcam.displayHeight }
    }
    if (typeof anyWebcam.codedWidth === 'number' && typeof anyWebcam.codedHeight === 'number') {
      return { width: anyWebcam.codedWidth, height: anyWebcam.codedHeight }
    }
    return null
  })()

  const webcamIsRenderable = Boolean(isWebcamVisible && webcamVideoElement && webcamDims && webcamDims.width > 0)
  const resolvedLayout = webcamIsRenderable
    ? resolveLayoutConfig({
        state,
        frameConfig: mainRectConfig,
        activeZoomRegion,
        currentTime,
        outputWidth,
        outputHeight,
        availableWidth,
        availableHeight,
      })
    : {
        mode: 'overlay' as const,
        desktopConfig: mainRectConfig,
        cameraConfig: null,
        cameraFlip: false,
      }

  const effectiveShowDesktopOverlay =
    activeSwapRegion && resolvedLayout.mode === 'overlay' ? activeSwapRegion.showDesktopOverlay : false

  // --- 6. Draw Media Helper and Transitions ---
  const lerpConfig = (a: MediaRectConfig, b: MediaRectConfig, p: number): MediaRectConfig => ({
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    width: lerp(a.width, b.width, p),
    height: lerp(a.height, b.height, p),
    radius: lerp(a.radius, b.radius, p),
    shadowBlur: lerp(a.shadowBlur, b.shadowBlur, p),
    shadowOffsetX: lerp(a.shadowOffsetX, b.shadowOffsetX, p),
    shadowOffsetY: lerp(a.shadowOffsetY, b.shadowOffsetY, p),
    borderWidth: lerp(a.borderWidth, b.borderWidth, p),
    shadowColor: p > 0.5 ? b.shadowColor : a.shadowColor,
    borderColor: p > 0.5 ? b.borderColor : a.borderColor,
    zIndex: p > 0.5 ? b.zIndex : a.zIndex,
  })

  const drawMediaToConfig = (
    config: MediaRectConfig,
    source: CanvasImageSource,
    sW: number,
    sH: number,
    isFlipped: boolean = false,
    globalAlpha: number = 1,
    crop: RenderableState['webcamStyles']['crop'] | null = null,
  ) => {
    if (config.width <= 0 || config.height <= 0 || sW <= 0 || sH <= 0 || globalAlpha <= 0) return
    ctx.save()
    ctx.globalAlpha = globalAlpha

    if (config.shadowBlur > 0) {
      ctx.save()
      ctx.shadowColor = config.shadowColor
      ctx.shadowBlur = config.shadowBlur
      ctx.shadowOffsetX = config.shadowOffsetX
      ctx.shadowOffsetY = config.shadowOffsetY
      const shadowPath = new Path2D()
      shadowPath.roundRect(config.x, config.y, config.width, config.height, config.radius)
      // Use fill for shadow rendering to apply exactly behind the clip area
      ctx.fillStyle = 'black'
      ctx.fill(shadowPath)
      ctx.restore()
    }

    ctx.save()
    const clipPath = new Path2D()
    clipPath.roundRect(config.x, config.y, config.width, config.height, config.radius)
    ctx.clip(clipPath)

    const targetAR = config.width / config.height
    const sourceX = crop ? sW * crop.left : 0
    const sourceY = crop ? sH * crop.top : 0
    const sourceWidth = crop ? sW * (1 - crop.left - crop.right) : sW
    const sourceHeight = crop ? sH * (1 - crop.top - crop.bottom) : sH
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      ctx.restore()
      ctx.restore()
      return
    }

    const sourceAR = sourceWidth / sourceHeight
    let sx = sourceX, sy = sourceY, drawW = sourceWidth, drawH = sourceHeight

    if (sourceAR > targetAR) {
      drawW = sourceHeight * targetAR
      sx = sourceX + (sourceWidth - drawW) / 2
    } else {
      drawH = sourceWidth / targetAR
      sy = sourceY + (sourceHeight - drawH) / 2
    }

    if (isFlipped) {
      ctx.translate(config.x * 2 + config.width, 0)
      ctx.scale(-1, 1)
    }

    ctx.drawImage(source, sx, sy, drawW, drawH, config.x, config.y, config.width, config.height)
    ctx.restore()

    if (config.borderWidth > 0) {
      ctx.save()
      const borderPath = new Path2D()
      borderPath.roundRect(config.x, config.y, config.width, config.height, config.radius)
      ctx.strokeStyle = config.borderColor
      ctx.lineWidth = config.borderWidth * 2
      ctx.stroke(borderPath)
      ctx.restore()
    }
    ctx.restore()
  }

  // --- 7. Resolve Final Compositions ---
  const draws: { zIndex: number; draw: () => void }[] = []
  
  // Base states
  const desktopSource = screenCache?.canvas
  const desktopDims = { width: frameContentWidth, height: frameContentHeight }
  const desktopFlipped = false

  const cameraSource = webcamVideoElement
  const cameraDims = webcamDims
  const cameraCrop = webcamIsRenderable ? state.webcamStyles.crop : null
  const normalDesktopConfig = resolvedLayout.desktopConfig
  const normalCameraConfig = resolvedLayout.cameraConfig
  const canSwapCamera = Boolean(cameraSource && cameraDims && normalCameraConfig)
  const transitionType = activeSwapRegion?.transition || 'none'
  const isAnimatedTransition = canSwapCamera && swapProgress > 0 && swapProgress < 1 && transitionType !== 'none'
  const progressAnim = transitionType === 'slide' ? EASING_MAP.Balanced(swapProgress) :
                       transitionType === 'scale' ? EASING_MAP.Balanced(swapProgress) : swapProgress

  if (!isSwapped || !canSwapCamera) {
    if (desktopSource) {
      draws.push({
        zIndex: normalDesktopConfig.zIndex,
        draw: () => drawMediaToConfig(normalDesktopConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped),
      })
    }
    if (normalCameraConfig && cameraSource && cameraDims) {
      draws.push({
        zIndex: normalCameraConfig.zIndex,
        draw: () =>
          drawMediaToConfig(
            normalCameraConfig,
            cameraSource,
            cameraDims.width,
            cameraDims.height,
            resolvedLayout.cameraFlip,
            1,
            cameraCrop,
          ),
      })
    }
  } else if (!isAnimatedTransition) {
    if (desktopSource && effectiveShowDesktopOverlay && normalCameraConfig) {
      draws.push({
        zIndex: normalCameraConfig.zIndex,
        draw: () => drawMediaToConfig(normalCameraConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped),
      })
    }
    if (cameraSource && cameraDims) {
      draws.push({
        zIndex: mainRectConfig.zIndex,
        draw: () =>
          drawMediaToConfig(
            mainRectConfig,
            cameraSource,
            cameraDims.width,
            cameraDims.height,
            resolvedLayout.cameraFlip,
            1,
            cameraCrop,
          ),
      })
    }
  } else if (normalCameraConfig && cameraSource && cameraDims) {
    if (resolvedLayout.mode !== 'overlay') {
      if (transitionType === 'fade') {
        const tSwapped = progressAnim
        const tNormal = 1 - progressAnim

        if (desktopSource) {
          draws.push({
            zIndex: normalDesktopConfig.zIndex - 0.1,
            draw: () => drawMediaToConfig(normalDesktopConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped, tNormal),
          })
        }
        draws.push({
          zIndex: normalCameraConfig.zIndex - 0.1,
          draw: () =>
            drawMediaToConfig(
              normalCameraConfig,
              cameraSource,
              cameraDims.width,
              cameraDims.height,
              resolvedLayout.cameraFlip,
              tNormal,
              cameraCrop,
            ),
        })
        draws.push({
          zIndex: mainRectConfig.zIndex + 0.1,
          draw: () =>
            drawMediaToConfig(
              mainRectConfig,
              cameraSource,
              cameraDims.width,
              cameraDims.height,
              resolvedLayout.cameraFlip,
              tSwapped,
              cameraCrop,
            ),
        })
      } else {
        const currentCameraConfig = lerpConfig(normalCameraConfig, mainRectConfig, progressAnim)
        if (desktopSource) {
          draws.push({
            zIndex: normalDesktopConfig.zIndex,
            draw: () => drawMediaToConfig(normalDesktopConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped, 1 - progressAnim),
          })
        }
        draws.push({
          zIndex: currentCameraConfig.zIndex,
          draw: () =>
            drawMediaToConfig(
              currentCameraConfig,
              cameraSource,
              cameraDims.width,
              cameraDims.height,
              resolvedLayout.cameraFlip,
              1,
              cameraCrop,
            ),
        })
      }
    } else if (transitionType === 'fade') {
      const tSwapped = progressAnim
      const tNormal = 1 - progressAnim

      if (desktopSource) {
        draws.push({
          zIndex: normalDesktopConfig.zIndex - 0.1,
          draw: () => drawMediaToConfig(normalDesktopConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped, tNormal),
        })
      }
      draws.push({
        zIndex: normalCameraConfig.zIndex - 0.1,
        draw: () =>
          drawMediaToConfig(
            normalCameraConfig,
            cameraSource,
            cameraDims.width,
            cameraDims.height,
            resolvedLayout.cameraFlip,
            tNormal,
            cameraCrop,
          ),
      })

      if (desktopSource && effectiveShowDesktopOverlay) {
        draws.push({
          zIndex: normalCameraConfig.zIndex + 0.1,
          draw: () => drawMediaToConfig(normalCameraConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped, tSwapped),
        })
      }
      draws.push({
        zIndex: mainRectConfig.zIndex + 0.1,
        draw: () =>
          drawMediaToConfig(
            mainRectConfig,
            cameraSource,
            cameraDims.width,
            cameraDims.height,
            resolvedLayout.cameraFlip,
            tSwapped,
            cameraCrop,
          ),
      })
    } else {
      let currentDesktopConfig = normalDesktopConfig
      let currentCameraConfig = normalCameraConfig

      if (swapProgress > 0) {
        currentDesktopConfig = lerpConfig(normalDesktopConfig, normalCameraConfig, progressAnim)
        currentCameraConfig = lerpConfig(normalCameraConfig, mainRectConfig, progressAnim)
      }

      if (desktopSource && (effectiveShowDesktopOverlay || progressAnim < 1)) {
        const alpha = !effectiveShowDesktopOverlay ? 1 - progressAnim : 1
        draws.push({
          zIndex: currentDesktopConfig.zIndex,
          draw: () => drawMediaToConfig(currentDesktopConfig, desktopSource, desktopDims.width, desktopDims.height, desktopFlipped, alpha),
        })
      }
      draws.push({
        zIndex: currentCameraConfig.zIndex,
        draw: () =>
          drawMediaToConfig(
            currentCameraConfig,
            cameraSource,
            cameraDims.width,
            cameraDims.height,
            resolvedLayout.cameraFlip,
            1,
            cameraCrop,
          ),
      })
    }
  }

  // Draw layers sorted by zIndex
  draws.sort((a,b) => a.zIndex - b.zIndex).forEach(d => d.draw())
}
