import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { CursorImage, CursorImageBitmap, CutRegion, SpeedRegion, TimelineLane } from '../types'
import { buildTimelineSegments } from './timeline-lanes'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats seconds into a time string.
 * @param seconds - The total number of seconds.
 * @param showMilliseconds - Whether to include milliseconds in the output.
 * @returns A string in MM:SS or MM:SS.ms format.
 */
export function formatTime(seconds: number, showMilliseconds = false): string {
  if (isNaN(seconds) || seconds < 0) {
    return showMilliseconds ? '00:00.00' : '00:00'
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  const formattedMinutes = minutes.toString().padStart(2, '0')

  if (showMilliseconds) {
    // toFixed(2) handles rounding and padding for milliseconds
    const formattedSecondsWithMs = remainingSeconds.toFixed(2).padStart(5, '0')
    return `${formattedMinutes}:${formattedSecondsWithMs}`
  }

  // Original behavior: round down and pad
  const formattedSecondsInt = Math.floor(remainingSeconds).toString().padStart(2, '0')
  return `${formattedMinutes}:${formattedSecondsInt}`
}

/**
 * Converts an RGBA string to a HEX color and an alpha value.
 * @param rgba - e.g., "rgba(255, 128, 0, 0.5)"
 * @returns An object with hex color and alpha value, e.g., { hex: '#ff8000', alpha: 0.5 }
 */
export const rgbaToHexAlpha = (rgba: string): { hex: string; alpha: number } => {
  const result = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(rgba)
  if (!result) return { hex: '#000000', alpha: 1 }

  const r = parseInt(result[1], 10)
  const g = parseInt(result[2], 10)
  const b = parseInt(result[3], 10)
  const alpha = result[4] !== undefined ? parseFloat(result[4]) : 1

  const toHex = (c: number) => ('0' + c.toString(16)).slice(-2)

  return { hex: `#${toHex(r)}${toHex(g)}${toHex(b)}`, alpha }
}

/**
 * Converts a HEX color string to an RGB object.
 * @param hex - e.g., "#ff8000"
 * @returns An object with r, g, b values, e.g., { r: 255, g: 128, b: 0 }
 */
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}

/**
 * Calculates ruler intervals based on zoom level (pixelsPerSecond).
 * This ensures the ruler is always readable and dynamically adjusts subdivisions.
 * @param pixelsPerSecond The current zoom level represented as pixels per second.
 * @returns An object with major and minor interval times in seconds.
 */
export const calculateRulerInterval = (pixelsPerSecond: number): { major: number; minor: number } => {
  // Define "nice" time intervals for the ruler (in seconds)
  const niceIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const minMajorPixelSpacing = 90 // Target minimum pixel distance between major ticks

  // 1. Find the best major interval
  const major =
    niceIntervals.find((interval) => interval * pixelsPerSecond > minMajorPixelSpacing) ||
    niceIntervals[niceIntervals.length - 1]

  // 2. Find the best number of subdivisions for minor ticks
  const minMinorPixelSpacing = 10 // Ticks closer than this are hard to see
  const possibleSubdivisions = [10, 5, 4, 2] // In order of preference (most to least dense)

  for (const sub of possibleSubdivisions) {
    const minor = major / sub
    if (minor * pixelsPerSecond > minMinorPixelSpacing) {
      // This subdivision is readable, so we use it and exit
      return { major, minor }
    }
  }

  // Fallback if no subdivision is readable (very zoomed out)
  return { major, minor: major / 2 }
}

export const prepareCursorBitmaps = async (
  cursorImages: Record<string, CursorImage>,
): Promise<Map<string, CursorImageBitmap>> => {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const promises = []

  for (const key in cursorImages) {
    const cursor = cursorImages[key]
    if (cursor.image && cursor.width > 0 && cursor.height > 0) {
      const promise = (async () => {
        try {
          const buffer = new Uint8ClampedArray(cursor.image)
          const imageData = new ImageData(buffer, cursor.width, cursor.height)
          const bitmap = await createImageBitmap(imageData)
          bitmapMap.set(key, { ...cursor, imageBitmap: bitmap })
        } catch (e) {
          //
        }
      })()
      promises.push(promise)
    }
  }

  await Promise.all(promises)
  return bitmapMap
}

/**
 * Maps a timestamp from the exported video timeline to the corresponding timestamp in the source video.
 * This is crucial for seek-driven rendering, as it accounts for cut regions and speed modifications.
 * @param exportTime The time in seconds in the final exported video.
 * @param duration The total duration of the source video.
 * @param cutRegions A record of regions to be removed from the video.
 * @param speedRegions A record of regions where playback speed is altered.
 * @returns The corresponding time in seconds in the source video.
 */
export const mapExportTimeToSourceTime = (
  exportTime: number,
  duration: number,
  cutRegions: Record<string, CutRegion>,
  speedRegions: Record<string, SpeedRegion>,
  timelineLanes: TimelineLane[] = [],
): number => {
  const segments = buildTimelineSegments(duration, cutRegions, speedRegions, timelineLanes)
  const normalizedExportTime = Math.max(0, exportTime)
  let accumulatedExportTime = 0
  let sourceTime = 0

  for (const segment of segments) {
    if (segment.isCut) {
      sourceTime = segment.end
      continue
    }

    const endOfSegmentExportTime = accumulatedExportTime + segment.exportDuration

    if (normalizedExportTime <= endOfSegmentExportTime) {
      const timeIntoSegmentExport = normalizedExportTime - accumulatedExportTime
      const timeIntoSegmentSource = timeIntoSegmentExport * segment.speed
      return segment.start + timeIntoSegmentSource
    }

    accumulatedExportTime = endOfSegmentExportTime
    sourceTime = segment.end
  }

  return sourceTime
}

export const calculateExportDuration = (
  duration: number,
  cutRegions: Record<string, CutRegion>,
  speedRegions: Record<string, SpeedRegion>,
  timelineLanes: TimelineLane[] = [],
): number =>
  buildTimelineSegments(duration, cutRegions, speedRegions, timelineLanes).reduce(
    (total, segment) => total + segment.exportDuration,
    0,
  )
