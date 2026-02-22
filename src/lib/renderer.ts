import { EditorState, RenderableState, WebcamPosition } from '../types'
import { calculateZoomTransform, findLastMetadataIndex } from './transform'
import { EASING_MAP } from './easing'
import { DEFAULTS } from './constants'
import { getTopActiveRegionAtTime, isRegionActiveAtTime, sortRegionsByLanePrecedence } from './timeline-lanes'

type Rect = { x: number; y: number; width: number; height: number }

let blurSampleCanvas: HTMLCanvasElement | null = null
let blurSampleCtx: CanvasRenderingContext2D | null = null
let blurPixelCanvas: HTMLCanvasElement | null = null
let blurPixelCtx: CanvasRenderingContext2D | null = null

const getOrCreateCanvas = (
  kind: 'sample' | 'pixel',
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

/**
 * Draws the background with optimized rendering
 */
const drawBackground = async (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  backgroundState: EditorState['frameStyles']['background'],
  preloadedImage: HTMLImageElement | null,
): Promise<void> => {
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
export const drawScene = async (
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
): Promise<void> => {
  if (!state.videoDimensions.width || !state.videoDimensions.height) return

  // Enable rendering - 'ultra high' uses bicubic interpolation, otherwise bilinear (faster)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = exportQuality === 'ultra high' ? 'high' : 'medium'

  // --- 1. Draw Background ---
  await drawBackground(ctx, outputWidth, outputHeight, state.frameStyles.background, preloadedBgImage)

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

  // --- 3. Main video frame transform and drawing ---
  const { shadowBlur, shadowOffsetX, shadowOffsetY, borderRadius, shadowColor, borderWidth, borderColor } = frameStyles

  // Draw shadow if needed (unscaled, unclipped)
  if (shadowBlur > 0) {
    ctx.save()
    ctx.translate(frameX, frameY)
    ctx.shadowColor = shadowColor
    ctx.shadowBlur = shadowBlur
    ctx.shadowOffsetX = shadowOffsetX
    ctx.shadowOffsetY = shadowOffsetY
    const shadowPath = new Path2D()
    shadowPath.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
    ctx.fillStyle = 'rgba(0,0,0,1)'
    ctx.fill(shadowPath)
    ctx.restore()
  }

  // Set up the clipping path for the frame content
  ctx.save()
  ctx.translate(frameX, frameY)
  const framePath = new Path2D()
  framePath.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
  ctx.clip(framePath)

  // Now apply the zoom transforms *inside* the clipped bounds
  const { scale, translateX, translateY, transformOrigin } = calculateZoomTransform(
    currentTime,
    state.zoomRegions,
    state.timelineLanes,
    state.metadata,
    state.recordingGeometry || state.videoDimensions,
    { width: frameContentWidth, height: frameContentHeight },
  )

  const [originXStr, originYStr] = transformOrigin.split(' ')
  const originXMul = parseFloat(originXStr) / 100
  const originYMul = parseFloat(originYStr) / 100
  const originPxX = originXMul * frameContentWidth
  const originPxY = originYMul * frameContentHeight

  ctx.translate(originPxX, originPxY)
  ctx.scale(scale, scale)
  ctx.translate(translateX, translateY)
  ctx.translate(-originPxX, -originPxY)

  // Draw the video
  ctx.drawImage(videoElement, 0, 0, frameContentWidth, frameContentHeight)

  // --- 4. Draw Click Animations ---
  if (state.cursorStyles.clickRippleEffect && state.recordingGeometry) {
    const { clickRippleDuration, clickRippleSize, clickRippleColor } = state.cursorStyles
    const rippleEasing = EASING_MAP.Balanced // Ripple uses a standard ease-out

    const recentRippleClicks = state.metadata.filter(
      (event) =>
        event.type === 'click' &&
        event.pressed &&
        currentTime >= event.timestamp &&
        currentTime < event.timestamp + clickRippleDuration,
    )

    for (const click of recentRippleClicks) {
      const progress = (currentTime - click.timestamp) / clickRippleDuration
      const easedProgress = rippleEasing(progress)
      const currentRadius = easedProgress * clickRippleSize
      const currentOpacity = 1 - easedProgress

      // Scale cursor position from original recording geometry to the current frame's content size
      const cursorX = (click.x / state.recordingGeometry.width) * frameContentWidth
      const cursorY = (click.y / state.recordingGeometry.height) * frameContentHeight

      const colorResult = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(clickRippleColor)
      if (colorResult) {
        const [r, g, b, baseAlpha] = colorResult.slice(1).map(Number)
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${baseAlpha * currentOpacity})`
      }

      ctx.beginPath()
      ctx.arc(cursorX, cursorY, currentRadius, 0, 2 * Math.PI)
      ctx.fill()
    }
  }

  // --- 5. Draw Cursor ---
  const lastEventIndex = findLastMetadataIndex(state.metadata, currentTime)

  if (state.cursorStyles.showCursor && lastEventIndex > -1 && state.recordingGeometry) {
    const event = state.metadata[lastEventIndex]
    if (event && currentTime - event.timestamp < 0.1) {
      const cursorData = state.cursorBitmapsToRender.get(event.cursorImageKey!)

      if (cursorData && cursorData.imageBitmap && cursorData.width > 0) {
        const cursorX = (event.x / state.recordingGeometry.width) * frameContentWidth
        const cursorY = (event.y / state.recordingGeometry.height) * frameContentHeight
        const drawX = Math.round(cursorX - cursorData.xhot)
        const drawY = Math.round(cursorY - cursorData.yhot)

        ctx.save()

        // Handle click scale animation
        let cursorScale = 1
        if (state.cursorStyles.clickScaleEffect) {
          const { clickScaleDuration, clickScaleAmount, clickScaleEasing } = state.cursorStyles
          const mostRecentClick = state.metadata
            .filter(
              (e) =>
                e.type === 'click' &&
                e.pressed &&
                e.timestamp <= currentTime &&
                e.timestamp > currentTime - clickScaleDuration,
            )
            .pop()

          if (mostRecentClick) {
            const progress = (currentTime - mostRecentClick.timestamp) / clickScaleDuration
            const easingFn = EASING_MAP[clickScaleEasing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
            const easedProgress = easingFn(progress)
            const scaleValue = 1 - (1 - clickScaleAmount) * Math.sin(easedProgress * Math.PI)
            cursorScale = scaleValue
          }
        }

        // Apply drop shadow
        const { shadowBlur, shadowOffsetX, shadowOffsetY, shadowColor } = state.cursorStyles
        if (shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0) {
          ctx.filter = `drop-shadow(${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${shadowColor})`
        }

        // Apply scale transform if needed
        if (cursorScale !== 1) {
          const scaleCenterX = drawX + cursorData.xhot
          const scaleCenterY = drawY + cursorData.yhot
          ctx.translate(scaleCenterX, scaleCenterY)
          ctx.scale(cursorScale, cursorScale)
          ctx.translate(-scaleCenterX, -scaleCenterY)
        }

        ctx.drawImage(cursorData.imageBitmap, drawX, drawY)
        ctx.restore()
      }
    }
  }

  ctx.restore() // Restore from zoom/clip transform
  
  // Draw border on top of the clipped frame
  if (borderWidth > 0) {
    ctx.save()
    ctx.translate(frameX, frameY)
    const borderPath = new Path2D()
    borderPath.roundRect(0, 0, frameContentWidth, frameContentHeight, borderRadius)
    ctx.strokeStyle = borderColor
    ctx.lineWidth = borderWidth * 2 // border is centered on the edge
    ctx.stroke(borderPath)
    ctx.restore()
  }

  // --- 6. Draw Webcam ---
  const { webcamPosition, webcamStyles, isWebcamVisible } = state
  const activeZoomRegion = getTopActiveRegionAtTime(Object.values(state.zoomRegions), currentTime, state.timelineLanes)
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

  if (isWebcamVisible && webcamVideoElement && webcamDims && webcamDims.width > 0 && state.recordingGeometry) {
    let finalWebcamScale = 1
    if (webcamStyles.scaleOnZoom) {
      if (activeZoomRegion) {
        const { startTime, duration, transitionDuration } = activeZoomRegion
        const zoomInEndTime = startTime + transitionDuration
        const zoomOutStartTime = startTime + duration - transitionDuration
        const easingFn = EASING_MAP[activeZoomRegion.easing as keyof typeof EASING_MAP] || EASING_MAP.Balanced

        if (currentTime < zoomInEndTime) {
          const progress = (currentTime - startTime) / transitionDuration
          finalWebcamScale = lerp(1, DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, easingFn(progress))
        } else if (currentTime >= zoomOutStartTime) {
          const progress = (currentTime - zoomOutStartTime) / transitionDuration
          finalWebcamScale = lerp(DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT, 1, easingFn(progress))
        } else {
          finalWebcamScale = DEFAULTS.CAMERA.SCALE_ON_ZOOM_AMOUNT
        }
      }
    }

    const baseSize = Math.min(outputWidth, outputHeight)
    // Interpolate both position and size between normal and zoomed states
    let startSize = webcamStyles.size
    let targetSize = webcamStyles.sizeOnZoom
    let t = 0
    // removed unused isZooming
    if (webcamStyles.scaleOnZoom) {
      if (activeZoomRegion) {
        const { startTime, duration, transitionDuration } = activeZoomRegion
        const zoomInEndTime = startTime + transitionDuration
        const zoomOutStartTime = startTime + duration - transitionDuration
        const easingFn = EASING_MAP[activeZoomRegion.easing as keyof typeof EASING_MAP] || EASING_MAP.Balanced
        if (currentTime < zoomInEndTime) {
          // Zooming in
          t = easingFn((currentTime - startTime) / transitionDuration)
        } else if (currentTime >= zoomOutStartTime) {
          // Zooming out
          t = easingFn((currentTime - zoomOutStartTime) / transitionDuration)
          // Swap start/target for reverse interpolation
          ;[startSize, targetSize] = [targetSize, startSize]
        } else {
          // Fully zoomed
          startSize = targetSize
          t = 1
        }
      }
    }

    // Only animate size, not position
    let webcamWidth, webcamHeight
    if (webcamStyles.shape === 'rectangle') {
      webcamWidth = baseSize * (lerp(startSize, targetSize, t) / 100)
      webcamHeight = webcamWidth * (9 / 16)
    } else {
      webcamWidth = baseSize * (lerp(startSize, targetSize, t) / 100)
      webcamHeight = webcamWidth
    }
    // Always use the selected position
    const webcamRect = getWebcamRectForPosition(
      webcamPosition.pos,
      webcamWidth,
      webcamHeight,
      outputWidth,
      outputHeight,
    )
    // Use fixed position from webcamRect, apply scale for drawing
    const webcamX = webcamRect.x
    const webcamY = webcamRect.y
    const scaledWebcamWidth = webcamRect.width * finalWebcamScale
    const scaledWebcamHeight = webcamRect.height * finalWebcamScale

    const maxRadius = Math.min(scaledWebcamWidth, scaledWebcamHeight) / 2
    let webcamRadius = 0
    if (webcamStyles.shape === 'circle') {
      webcamRadius = maxRadius
    } else {
      webcamRadius = maxRadius * (webcamStyles.borderRadius / 50)
    }

    if (webcamStyles.shadowBlur > 0) {
      ctx.save()
      ctx.shadowColor = webcamStyles.shadowColor
      ctx.shadowBlur = webcamStyles.shadowBlur
      ctx.shadowOffsetX = webcamStyles.shadowOffsetX
      ctx.shadowOffsetY = webcamStyles.shadowOffsetY
      const webcamShadowPath = new Path2D()
      webcamShadowPath.roundRect(webcamX, webcamY, scaledWebcamWidth, scaledWebcamHeight, webcamRadius)
      ctx.fillStyle = 'rgba(0,0,0,1)'
      ctx.fill(webcamShadowPath)
      ctx.restore()
    }

    const webcamAR = webcamDims.width / webcamDims.height
    const targetAR = webcamWidth / webcamHeight

    let sx = 0,
      sy = 0,
      sWidth = webcamDims.width,
      sHeight = webcamDims.height

    if (webcamAR > targetAR) {
      sWidth = webcamDims.height * targetAR
      sx = (webcamDims.width - sWidth) / 2
    } else {
      sHeight = webcamDims.width / targetAR
      sy = (webcamDims.height - sHeight) / 2
    }

    ctx.save()

    if (webcamStyles.isFlipped) {
      ctx.translate(outputWidth, 0)
      ctx.scale(-1, 1)
    }

    const drawX = webcamStyles.isFlipped ? outputWidth - webcamX - webcamWidth : webcamX
    const webcamPath = new Path2D()
    webcamPath.roundRect(drawX, webcamY, webcamWidth, webcamHeight, webcamRadius)

    if (webcamStyles.border && webcamStyles.borderWidth > 0) {
      ctx.save()
      ctx.lineWidth = webcamStyles.borderWidth * 2 // multiply by 2 because stroke is centered
      ctx.strokeStyle = webcamStyles.borderColor
      ctx.stroke(webcamPath)
      ctx.restore()
    }

    ctx.clip(webcamPath)
    ctx.drawImage(webcamVideoElement, sx, sy, sWidth, sHeight, drawX, webcamY, webcamWidth, webcamHeight)
    ctx.restore()
  }

  // --- 7. Draw Blur Assets ---
  const activeBlurRegions = sortRegionsByLanePrecedence(
    Object.values(state.blurRegions).filter((region) => isRegionActiveAtTime(region, currentTime)),
    state.timelineLanes,
  ).reverse()

  for (const region of activeBlurRegions) {
    const rect = resolveBlurRect(region, frameX, frameY, frameContentWidth, frameContentHeight)
    if (!rect) continue
    if (region.style === 'pixelated') {
      applyPixelationToRect(ctx, rect, region.intensity)
    } else {
      applyBlurToRect(ctx, rect, region.intensity)
    }
  }
}
