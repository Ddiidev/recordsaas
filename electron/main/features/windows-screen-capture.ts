import log from 'electron-log/main'
import { spawnSync } from 'node:child_process'
import { screen, type Display, type Rectangle } from 'electron'
import { getFFmpegPath } from '../lib/utils'

export type WindowsScreenCaptureBackend = 'gfxcapture' | 'gdigrab'

export type PhysicalCaptureRect = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowsScreenCaptureCandidate = {
  backend: WindowsScreenCaptureBackend
  inputArgs: string[]
  needsHwDownload: boolean
  probeArgs: string[]
}

const FFMPEG_PATH = getFFmpegPath()
const GFXCAPTURE_PROBE_TIMEOUT_MS = 5000
let hasGfxCaptureFilterCache: boolean | null = null

const toEvenDimension = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)

const normalizePhysicalRect = (rect: Rectangle): PhysicalCaptureRect => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: toEvenDimension(rect.width),
  height: toEvenDimension(rect.height),
})

export function getWindowsPhysicalDisplayRect(display: Display): PhysicalCaptureRect {
  return normalizePhysicalRect(screen.dipToScreenRect(null, display.bounds))
}

export function getWindowsPhysicalAreaRect(logicalArea: Rectangle, containingDisplay: Display): PhysicalCaptureRect {
  const displayRect = getWindowsPhysicalDisplayRect(containingDisplay)
  const convertedArea = normalizePhysicalRect(screen.dipToScreenRect(null, logicalArea))
  const left = Math.max(displayRect.x, convertedArea.x)
  const top = Math.max(displayRect.y, convertedArea.y)
  const right = Math.min(displayRect.x + displayRect.width, convertedArea.x + convertedArea.width)
  const bottom = Math.min(displayRect.y + displayRect.height, convertedArea.y + convertedArea.height)

  return {
    x: left,
    y: top,
    width: toEvenDimension(Math.max(2, right - left)),
    height: toEvenDimension(Math.max(2, bottom - top)),
  }
}

function hasGfxCaptureFilter(): boolean {
  if (hasGfxCaptureFilterCache !== null) return hasGfxCaptureFilterCache

  const result = spawnSync(FFMPEG_PATH, ['-hide_banner', '-h', 'filter=gfxcapture'], {
    encoding: 'utf-8',
    timeout: 4000,
    windowsHide: true,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  hasGfxCaptureFilterCache =
    !result.error && result.status === 0 && output.includes('Filter gfxcapture') && !output.includes('Unknown filter')
  return hasGfxCaptureFilterCache
}

function resolveWindowsMonitorHandle(displayRect: PhysicalCaptureRect): string | null {
  const centerX = Math.round(displayRect.x + displayRect.width / 2)
  const centerY = Math.round(displayRect.y + displayRect.height / 2)
  const command = `
$source = @'
using System;
using System.Runtime.InteropServices;
public static class RecordSaaSMonitorResolver {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr MonitorFromPoint(POINT point, uint flags);
}
'@
Add-Type -TypeDefinition $source
$point = New-Object RecordSaaSMonitorResolver+POINT
$point.X = ${centerX}
$point.Y = ${centerY}
$handle = [RecordSaaSMonitorResolver]::MonitorFromPoint($point, 2)
[Console]::Out.Write($handle.ToInt64())
`.trim()

  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf-8',
    timeout: 4000,
    windowsHide: true,
  })

  if (result.error || result.status !== 0) {
    log.warn(
      `[WindowsCapture] Failed to resolve HMONITOR for rect ${JSON.stringify(displayRect)}: ${
        result.error?.message || result.stderr || `exit ${result.status}`
      }`,
    )
    return null
  }

  const handle = (result.stdout || '').trim()
  return /^\d+$/.test(handle) && handle !== '0' ? handle : null
}

function buildGfxCaptureInput(
  monitorHandle: string,
  fps: number,
  displayRect: PhysicalCaptureRect,
  captureRect: PhysicalCaptureRect,
): string {
  const cropLeft = Math.max(0, captureRect.x - displayRect.x)
  const cropTop = Math.max(0, captureRect.y - displayRect.y)
  const cropRight = Math.max(0, displayRect.width - cropLeft - captureRect.width)
  const cropBottom = Math.max(0, displayRect.height - cropTop - captureRect.height)

  return [
    `gfxcapture=hmonitor=${monitorHandle}`,
    'capture_cursor=0',
    'capture_border=0',
    'display_border=0',
    `max_framerate=${fps}`,
    `crop_left=${cropLeft}`,
    `crop_top=${cropTop}`,
    `crop_right=${cropRight}`,
    `crop_bottom=${cropBottom}`,
  ].join(':')
}

function buildGdigrabInputArgs(fps: number, captureRect: PhysicalCaptureRect): string[] {
  return [
    '-f',
    'gdigrab',
    '-framerate',
    String(fps),
    '-draw_mouse',
    '0',
    '-offset_x',
    String(captureRect.x),
    '-offset_y',
    String(captureRect.y),
    '-video_size',
    `${captureRect.width}x${captureRect.height}`,
    '-i',
    'desktop',
  ]
}

export function getWindowsScreenCaptureCandidates(
  display: Display,
  captureRect: PhysicalCaptureRect,
  fps: number,
): WindowsScreenCaptureCandidate[] {
  const displayRect = getWindowsPhysicalDisplayRect(display)
  const candidates: WindowsScreenCaptureCandidate[] = []

  if (hasGfxCaptureFilter()) {
    const monitorHandle = resolveWindowsMonitorHandle(displayRect)
    if (monitorHandle) {
      const gfxInput = buildGfxCaptureInput(monitorHandle, fps, displayRect, captureRect)
      candidates.push({
        backend: 'gfxcapture',
        inputArgs: ['-f', 'lavfi', '-i', gfxInput],
        needsHwDownload: true,
        probeArgs: [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          gfxInput,
          '-frames:v',
          '1',
          '-vf',
          'hwdownload,format=bgra',
          '-f',
          'null',
          '-',
        ],
      })
    }
  }

  const gdigrabInputArgs = buildGdigrabInputArgs(fps, captureRect)
  candidates.push({
    backend: 'gdigrab',
    inputArgs: gdigrabInputArgs,
    needsHwDownload: false,
    probeArgs: ['-hide_banner', '-loglevel', 'error', ...gdigrabInputArgs, '-frames:v', '1', '-f', 'null', '-'],
  })

  return candidates
}

export function selectWindowsScreenCaptureCandidate(
  display: Display,
  captureRect: PhysicalCaptureRect,
  fps: number,
): WindowsScreenCaptureCandidate {
  const candidates = getWindowsScreenCaptureCandidates(display, captureRect, fps)

  for (const candidate of candidates) {
    if (candidate.backend === 'gdigrab') return candidate

    const probe = spawnSync(FFMPEG_PATH, candidate.probeArgs, {
      encoding: 'utf-8',
      timeout: GFXCAPTURE_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    if (!probe.error && probe.status === 0) {
      return candidate
    }

    log.warn(
      `[WindowsCapture] ${candidate.backend} probe failed; falling back to gdigrab. ${
        probe.error?.message || probe.stderr || `exit ${probe.status}`
      }`,
    )
  }

  return candidates[candidates.length - 1]
}
