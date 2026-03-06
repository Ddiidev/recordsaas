import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULTS } from '../../../lib/constants'
import type { WebcamCrop } from '../../../types'

type CropHandle = 'top-left' | 'top' | 'right' | 'bottom-right' | 'bottom' | 'left'
type InteractionState = {
  handle: CropHandle
  bounds: DOMRect
  startCrop: WebcamCrop
}

interface WebcamCropEditorProps {
  webcamVideoUrl: string
  currentTime: number
  crop: WebcamCrop
  onUpdateCrop: (crop: Partial<WebcamCrop>) => void
}

const HANDLE_CONFIG: Array<{ handle: CropHandle; cursor: string; getPosition: (cropBox: CropBox) => { left: number; top: number } }> = [
  { handle: 'top-left', cursor: 'nwse-resize', getPosition: (cropBox) => ({ left: cropBox.x, top: cropBox.y }) },
  { handle: 'top', cursor: 'ns-resize', getPosition: (cropBox) => ({ left: cropBox.x + cropBox.width / 2, top: cropBox.y }) },
  { handle: 'right', cursor: 'ew-resize', getPosition: (cropBox) => ({ left: cropBox.x + cropBox.width, top: cropBox.y + cropBox.height / 2 }) },
  { handle: 'bottom-right', cursor: 'nwse-resize', getPosition: (cropBox) => ({ left: cropBox.x + cropBox.width, top: cropBox.y + cropBox.height }) },
  { handle: 'bottom', cursor: 'ns-resize', getPosition: (cropBox) => ({ left: cropBox.x + cropBox.width / 2, top: cropBox.y + cropBox.height }) },
  { handle: 'left', cursor: 'ew-resize', getPosition: (cropBox) => ({ left: cropBox.x, top: cropBox.y + cropBox.height / 2 }) },
]

type CropBox = { x: number; y: number; width: number; height: number }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
const roundTo4 = (value: number): number => Math.round(value * 10000) / 10000

export const WebcamCropEditor = memo(({ webcamVideoUrl, currentTime, crop, onUpdateCrop }: WebcamCropEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || video.videoWidth <= 0 || video.videoHeight <= 0) return

    if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
    if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setAspectRatio(video.videoWidth / video.videoHeight)
      }
      renderFrame()
    }

    const handleSeeked = () => renderFrame()

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadeddata', handleSeeked)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('loadeddata', handleSeeked)
    }
  }, [renderFrame])

  useEffect(() => {
    const video = videoRef.current
    if (!video || video.readyState < 1) return

    if (Math.abs(video.currentTime - currentTime) > 0.02) {
      video.currentTime = currentTime
      return
    }

    renderFrame()
  }, [currentTime, renderFrame])

  const cropBox = useMemo<CropBox>(
    () => ({
      x: crop.left * 100,
      y: crop.top * 100,
      width: (1 - crop.left - crop.right) * 100,
      height: (1 - crop.top - crop.bottom) * 100,
    }),
    [crop],
  )

  const startInteraction = (event: React.MouseEvent<HTMLButtonElement>, handle: CropHandle) => {
    const container = containerRef.current
    if (!container) return

    event.preventDefault()
    event.stopPropagation()

    const interaction: InteractionState = {
      handle,
      bounds: container.getBoundingClientRect(),
      startCrop: crop,
    }

    const move = (moveEvent: MouseEvent) => {
      const pointerX = clamp(moveEvent.clientX - interaction.bounds.left, 0, interaction.bounds.width)
      const pointerY = clamp(moveEvent.clientY - interaction.bounds.top, 0, interaction.bounds.height)
      const minWidth = interaction.bounds.width * DEFAULTS.CAMERA.CROP.MIN_VISIBLE_PORTION
      const minHeight = interaction.bounds.height * DEFAULTS.CAMERA.CROP.MIN_VISIBLE_PORTION

      let left = interaction.startCrop.left * interaction.bounds.width
      let top = interaction.startCrop.top * interaction.bounds.height
      let right = interaction.bounds.width - interaction.startCrop.right * interaction.bounds.width
      let bottom = interaction.bounds.height - interaction.startCrop.bottom * interaction.bounds.height

      if (handle === 'top-left' || handle === 'left') left = clamp(pointerX, 0, right - minWidth)
      if (handle === 'top-left' || handle === 'top') top = clamp(pointerY, 0, bottom - minHeight)
      if (handle === 'right' || handle === 'bottom-right') right = clamp(pointerX, left + minWidth, interaction.bounds.width)
      if (handle === 'bottom' || handle === 'bottom-right') bottom = clamp(pointerY, top + minHeight, interaction.bounds.height)

      onUpdateCrop({
        left: roundTo4(left / interaction.bounds.width),
        right: roundTo4((interaction.bounds.width - right) / interaction.bounds.width),
        top: roundTo4(top / interaction.bounds.height),
        bottom: roundTo4((interaction.bounds.height - bottom) / interaction.bounds.height),
      })
    }

    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = HANDLE_CONFIG.find((item) => item.handle === handle)?.cursor || 'default'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  useEffect(
    () => () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    },
    [],
  )

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
        Current webcam frame. Drag the 6 handles to crop the source image.
      </div>

      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-xl border border-border bg-black/80"
        style={{ aspectRatio }}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        <video ref={videoRef} src={webcamVideoUrl} muted playsInline preload="auto" className="hidden" />

        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 top-0 w-full bg-black/40" style={{ height: `${cropBox.y}%` }} />
          <div className="absolute bottom-0 left-0 w-full bg-black/40" style={{ height: `${100 - cropBox.y - cropBox.height}%` }} />
          <div className="absolute left-0 bg-black/40" style={{ top: `${cropBox.y}%`, width: `${cropBox.x}%`, height: `${cropBox.height}%` }} />
          <div className="absolute right-0 bg-black/40" style={{ top: `${cropBox.y}%`, width: `${100 - cropBox.x - cropBox.width}%`, height: `${cropBox.height}%` }} />

          <div
            className="absolute border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{ left: `${cropBox.x}%`, top: `${cropBox.y}%`, width: `${cropBox.width}%`, height: `${cropBox.height}%` }}
          />

          {HANDLE_CONFIG.map(({ handle, cursor, getPosition }) => {
            const position = getPosition(cropBox)
            return (
              <button
                key={handle}
                type="button"
                className="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-white shadow-sm"
                style={{ left: `${position.left}%`, top: `${position.top}%`, cursor }}
                onMouseDown={(event) => startInteraction(event, handle)}
                aria-label={`Adjust webcam crop ${handle}`}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
})

WebcamCropEditor.displayName = 'WebcamCropEditor'
