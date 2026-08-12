import { Eye } from '@icons'
import { useEffect, useRef, useState } from 'react'
import { SimpleTooltip } from '../../ui/tooltip'

export const AUDIO_WAVEFORM_TRACK_HEIGHT = 48
export const AUDIO_WAVEFORM_TRACK_COLLAPSED_HEIGHT = 28

type WaveformData = { peaks: number[]; peaksPerSecond: number }

type AudioWaveformTrackProps = {
  audioPath: string
  label: string
  sourceOffsetMs: number
  visible: boolean
  onVisibilityChange: (visible: boolean) => void
  pixelsPerSecond: number
  timelineStartOffsetPx: number
  timelineScrollLeft: number
  viewportWidth: number
  duration: number
}

export function AudioWaveformTrack({
  audioPath,
  label,
  sourceOffsetMs,
  visible,
  onVisibilityChange,
  pixelsPerSecond,
  timelineStartOffsetPx,
  timelineScrollLeft,
  viewportWidth,
  duration,
}: AudioWaveformTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setWaveform(null)
    setLoadError(null)

    window.electronAPI
      .getAudioWaveform(audioPath)
      .then((result) => {
        if (!cancelled) setWaveform(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Waveform unavailable.')
      })

    return () => {
      cancelled = true
    }
  }, [audioPath])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visible || !waveform || viewportWidth <= 0 || pixelsPerSecond <= 0) return

    const height = AUDIO_WAVEFORM_TRACK_HEIGHT
    const pixelRatio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.floor(viewportWidth))
    canvas.width = Math.floor(width * pixelRatio)
    canvas.height = Math.floor(height * pixelRatio)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(168, 85, 247, 0.56)'

    const sourceOffsetSeconds = Math.max(0, sourceOffsetMs) / 1000
    const drawStartX = Math.max(0, timelineStartOffsetPx - timelineScrollLeft)
    const drawEndX = Math.min(width, timelineStartOffsetPx + duration * pixelsPerSecond - timelineScrollLeft)
    for (let x = Math.floor(drawStartX); x < drawEndX; x += 1) {
      const timelineTime = (timelineScrollLeft + x - timelineStartOffsetPx) / pixelsPerSecond
      const peakIndex = Math.floor((timelineTime + sourceOffsetSeconds) * waveform.peaksPerSecond)
      const peak = waveform.peaks[peakIndex] ?? 0
      const barHeight = Math.max(1, Math.min(height - 8, peak * (height - 8)))
      context.fillRect(x, height - barHeight, 1, barHeight)
    }
  }, [
    duration,
    pixelsPerSecond,
    sourceOffsetMs,
    timelineScrollLeft,
    timelineStartOffsetPx,
    viewportWidth,
    visible,
    waveform,
  ])

  const height = visible ? AUDIO_WAVEFORM_TRACK_HEIGHT : AUDIO_WAVEFORM_TRACK_COLLAPSED_HEIGHT
  const status = loadError ? 'Waveform indisponível' : waveform ? null : 'Lendo áudio…'

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border/40 bg-muted/30"
      style={{ height: `${height}px` }}
    >
      {visible && (
        <canvas
          ref={canvasRef}
          aria-label={`Forma de onda: ${label}`}
          className="pointer-events-none absolute top-0"
          style={{ left: `${timelineScrollLeft}px` }}
        />
      )}
      <div
        className="absolute inset-y-0 left-0 z-10 flex items-center gap-1.5 border-r border-border/50 bg-card/95 pl-2 pr-1.5 text-[10px] font-medium text-muted-foreground shadow-[10px_0_14px_rgba(0,0,0,0.10)]"
        style={{ transform: `translateX(${timelineScrollLeft}px)` }}
      >
        <span>{label}</span>
        <SimpleTooltip
          content={
            visible
              ? `Ocultar forma de onda de ${label.toLowerCase()}`
              : `Mostrar forma de onda de ${label.toLowerCase()}`
          }
        >
          <button
            type="button"
            data-lane-control
            aria-label={visible ? `Hide ${label} waveform` : `Show ${label} waveform`}
            aria-pressed={visible}
            onClick={() => onVisibilityChange(!visible)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Eye className={visible ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 opacity-45'} />
          </button>
        </SimpleTooltip>
      </div>
      {visible && status && (
        <span
          className="absolute top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/80"
          style={{ left: `${timelineStartOffsetPx + 8 + timelineScrollLeft}px` }}
          title={loadError || undefined}
        >
          {status}
        </span>
      )}
    </div>
  )
}
