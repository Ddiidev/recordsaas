import { useMemo, useRef, type CSSProperties } from 'react'
import { Video } from '@icons'
import { WALLPAPERS } from '../../lib/constants'
import { cn } from '../../lib/utils'
import { getWebcamCssAspectRatio, getWebcamCssBorderRadius } from '../../lib/webcam'
import type { AspectRatio, FrameStyles, WebcamLayout, WebcamPosition, WebcamStyles } from '../../types'

interface PresetPreviewProps {
  styles: FrameStyles
  aspectRatio: AspectRatio
  isWebcamVisible?: boolean
  webcamLayout?: WebcamLayout
  webcamPosition?: WebcamPosition
  webcamStyles?: WebcamStyles
}

const generateBackgroundStyle = (backgroundState: FrameStyles['background']) => {
  switch (backgroundState.type) {
    case 'color':
      return { background: backgroundState.color || '#ffffff' }
    case 'gradient': {
      const start = backgroundState.gradientStart || '#000000'
      const end = backgroundState.gradientEnd || '#ffffff'
      const direction = backgroundState.gradientDirection || 'to right'
      return { background: `linear-gradient(${direction}, ${start}, ${end})` }
    }
    case 'image':
    case 'wallpaper': {
      const imageUrl = backgroundState.imageUrl?.startsWith('blob:')
        ? backgroundState.imageUrl
        : `media://${backgroundState.imageUrl || WALLPAPERS[0].imageUrl}`
      return {
        backgroundImage: `url("${imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    }
    default:
      return { background: '#111' }
  }
}

const PreviewScreen = ({ borderRadius }: { borderRadius: number }) => (
  <div
    className="w-full h-full bg-muted/30"
    style={{
      borderRadius: `${borderRadius}px`,
    }}
  >
    <div className="p-4 opacity-50 space-y-2">
      <div className="w-1/2 h-2.5 bg-foreground/20 rounded-full" />
      <div className="w-3/4 h-2 bg-foreground/15 rounded-full" />
      <div className="w-2/3 h-2 bg-foreground/10 rounded-full" />
    </div>
  </div>
)

const PreviewWebcam = ({ className, style }: { className?: string; style?: CSSProperties }) => (
  <div className={cn('overflow-hidden bg-card flex items-center justify-center', className)} style={style}>
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card to-muted/70">
      <Video className="w-1/2 h-1/2 text-foreground/40" />
    </div>
  </div>
)

const buildWebcamStyle = (webcamStyles: WebcamStyles, width?: string): CSSProperties => {
  const cssStyles: CSSProperties = {
    aspectRatio: getWebcamCssAspectRatio(webcamStyles.shape),
    borderRadius: getWebcamCssBorderRadius(webcamStyles.shape, webcamStyles.borderRadius),
    filter: `drop-shadow(${webcamStyles.shadowOffsetX}px ${webcamStyles.shadowOffsetY}px ${webcamStyles.shadowBlur}px ${webcamStyles.shadowColor})`,
    border: webcamStyles.border ? `${webcamStyles.borderWidth}px solid ${webcamStyles.borderColor}` : 'none',
    maxWidth: '100%',
    maxHeight: '100%',
  }

  if (width) {
    cssStyles.width = width
  }

  if (webcamStyles.isFlipped) {
    cssStyles.transform = 'scaleX(-1)'
  }

  return cssStyles
}

export function PresetPreview({
  styles,
  aspectRatio,
  isWebcamVisible,
  webcamLayout,
  webcamPosition,
  webcamStyles,
}: PresetPreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null)

  const cssAspectRatio = useMemo(() => aspectRatio.replace(':', ' / '), [aspectRatio])
  const backgroundStyle = useMemo(() => generateBackgroundStyle(styles.background), [styles.background])

  const frameStyle = useMemo(() => {
    const shadowString =
      styles.shadowBlur > 0
        ? `${styles.shadowOffsetX}px ${styles.shadowOffsetY}px ${styles.shadowBlur}px ${styles.shadowColor}`
        : 'none'

    return {
      width: '100%',
      height: '100%',
      borderRadius: `${styles.borderRadius}px`,
      boxShadow: shadowString,
      border: `${styles.borderWidth}px solid ${styles.borderColor}`,
      boxSizing: 'border-box' as const,
    }
  }, [styles])

  const effectiveLayout = webcamLayout ?? {
    mode: 'overlay' as const,
    side: 'right' as const,
    webcamWidthPercent: 30,
  }

  const overlayWebcamStyle = useMemo(
    () => (webcamStyles ? buildWebcamStyle(webcamStyles, `${webcamStyles.size}%`) : {}),
    [webcamStyles],
  )

  const sideBySideWebcamStyle = useMemo(() => {
    if (!webcamStyles) return {}
    return buildWebcamStyle(webcamStyles, '100%')
  }, [webcamStyles])

  const overlayWebcamClasses = useMemo(() => {
    if (!webcamPosition) return ''
    return cn('absolute z-20 overflow-hidden transition-all duration-300 ease-in-out', {
      'top-4 left-4': webcamPosition.pos === 'top-left',
      'top-4 left-1/2 -translate-x-1/2': webcamPosition.pos === 'top-center',
      'top-4 right-4': webcamPosition.pos === 'top-right',
      'left-4 top-1/2 -translate-y-1/2': webcamPosition.pos === 'left-center',
      'right-4 top-1/2 -translate-y-1/2': webcamPosition.pos === 'right-center',
      'bottom-4 left-4': webcamPosition.pos === 'bottom-left',
      'bottom-4 left-1/2 -translate-x-1/2': webcamPosition.pos === 'bottom-center',
      'bottom-4 right-4': webcamPosition.pos === 'bottom-right',
    })
  }, [webcamPosition])

  const sidebarPercent = effectiveLayout.webcamWidthPercent
  const desktopPercent = 100 - sidebarPercent
  const sidebarOnLeft = effectiveLayout.side === 'left'
  const frameContentBorderRadius = Math.max(0, styles.borderRadius - styles.borderWidth)

  return (
    <div
      ref={previewRef}
      className="h-full rounded-xl flex items-center justify-center transition-all duration-300 ease-out max-w-full max-h-full shadow-md"
      style={{ ...backgroundStyle, aspectRatio: cssAspectRatio }}
    >
      <div className="w-full h-full" style={{ padding: `${styles.padding}%`, position: 'relative' }}>
        {effectiveLayout.mode === 'side-by-side' && isWebcamVisible && webcamStyles ? (
          <div className="flex h-full w-full items-center gap-3">
            {sidebarOnLeft && (
              <div className="flex h-full items-center justify-center" style={{ width: `${sidebarPercent}%` }}>
                <PreviewWebcam style={sideBySideWebcamStyle} />
              </div>
            )}
            <div className="h-full" style={{ width: `${desktopPercent}%` }}>
              <div className="h-full w-full" style={frameStyle}>
                <PreviewScreen borderRadius={frameContentBorderRadius} />
              </div>
            </div>
            {!sidebarOnLeft && (
              <div className="flex h-full items-center justify-center" style={{ width: `${sidebarPercent}%` }}>
                <PreviewWebcam style={sideBySideWebcamStyle} />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="w-full h-full" style={frameStyle}>
              <PreviewScreen borderRadius={frameContentBorderRadius} />
            </div>

            {isWebcamVisible && webcamStyles && webcamPosition && (
              <PreviewWebcam className={overlayWebcamClasses} style={overlayWebcamStyle} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
