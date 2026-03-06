import React, { useEffect, useRef, useMemo } from 'react'

interface PlayheadProps {
  height: number // canvas height (track area)
  isDragging: boolean // playhead drag state
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export const Playhead: React.FC<PlayheadProps> = React.memo(({ height, isDragging, onMouseDown }: PlayheadProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Memoize playhead styles
  const { triangleSize, lineColor, triangleColor } = useMemo(() => {
    return {
      triangleSize: { base: 10, height: 14 },
      lineColor: 'rgba(34,197,94,0.9)', // tailwind primary/green-500
      triangleColor: isDragging ? 'rgba(34,197,94,1)' : 'rgba(34,197,94,1)',
    }
  }, [isDragging])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // --- Draw line ---
    ctx.beginPath()
    ctx.moveTo(canvas.width / 2, 0)
    ctx.lineTo(canvas.width / 2, height)
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 2
    ctx.stroke()

    // --- Draw triangle at the top, pointing down ---
    const triW = triangleSize.base
    const triH = triangleSize.height
    const x = canvas.width / 2
    const y = 0 // Top position

    ctx.beginPath()
    ctx.moveTo(x, y + triH) // Bottom point
    ctx.lineTo(x - triW, y) // Top left
    ctx.lineTo(x + triW, y) // Top right
    ctx.closePath()
    ctx.fillStyle = triangleColor
    ctx.fill()
    ctx.shadowColor = 'rgba(0,0,0,0.2)'
    ctx.shadowBlur = isDragging ? 8 : 4
    ctx.shadowOffsetY = 2 // Add shadow for better appearance
  }, [height, triangleSize, lineColor, triangleColor, isDragging])

  return (
    <div
      style={{
        position: 'relative',
        width: '20px',
        height: '100%',
        marginLeft: '-10px',
        pointerEvents: 'auto',
        cursor: 'ew-resize',
      }}
      onMouseDown={onMouseDown}
    >
      <canvas
        ref={canvasRef}
        width={20}
        height={height}
        style={{
          display: 'block',
          pointerEvents: 'none',
          position: 'relative',
          zIndex: 1,
        }}
      />
    </div>
  )
})

Playhead.displayName = 'Playhead'
