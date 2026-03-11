// Contains utility functions for the main process.

import log from 'electron-log/main'
import { app } from 'electron'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { ResolutionKey, RESOLUTIONS } from './constants'

export function getBinaryPath(name: string): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'

  if (app.isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'binaries', platform, name)
    log.info(`[Production] Using bundled binary at: ${binaryPath}`)
    return binaryPath
  } else {
    const binaryPath = path.join(process.env.APP_ROOT!, 'binaries', platform, name)
    log.info(`[Development] Using local binary at: ${binaryPath}`)
    return binaryPath
  }
}

function isExecutableAccessible(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findExecutableOnPath(candidateNames: string[]): string | null {
  const pathValue = process.env.PATH
  if (!pathValue) {
    return null
  }

  const searchDirectories = pathValue.split(path.delimiter).filter(Boolean)
  for (const directory of searchDirectories) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(directory, candidateName)
      if (isExecutableAccessible(candidatePath)) {
        return candidatePath
      }
    }
  }

  return null
}

function getBundledFFmpegBinaryName(): string {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'ffmpeg-arm64' : 'ffmpeg-x64'
  }

  if (process.platform === 'win32') {
    return 'ffmpeg.exe'
  }

  return 'ffmpeg'
}

export function getBundledFFmpegPath(): string {
  const binaryName = getBundledFFmpegBinaryName()

  if (process.platform === 'darwin') {
    log.info(`[FFmpeg] Selecting macOS binary for ${process.arch} architecture: ${binaryName}`)
  }

  return getBinaryPath(binaryName)
}

export function getFFmpegPath(): string {
  const bundledPath = getBundledFFmpegPath()
  if (isExecutableAccessible(bundledPath)) {
    return bundledPath
  }

  const systemFallback = findExecutableOnPath(process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'])
  if (systemFallback) {
    log.warn(`[FFmpeg] Bundled binary unavailable at ${bundledPath}. Falling back to PATH binary at: ${systemFallback}`)
    return systemFallback
  }

  log.error(`[FFmpeg] No executable binary found at ${bundledPath} and no PATH fallback is available.`)
  return bundledPath
}

export function getFFmpegSetupHint(): string {
  return `Expected FFmpeg at:\n${getBundledFFmpegPath()}\n\nRun "npm run setup:binaries" or install "ffmpeg" on your PATH.`
}

export function getFFmpegSpawnErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `RecordSaaS could not start FFmpeg.\n\n${detail}\n\n${getFFmpegSetupHint()}`
}

export async function ensureDirectoryExists(dirPath: string) {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true })
  } catch (error) {
    log.error('Error creating directory:', error)
    throw error
  }
}

export function getLinuxDE(): 'GNOME' | 'KDE' | 'XFCE' | 'Unknown' {
  const de = process.env.XDG_CURRENT_DESKTOP?.toUpperCase()
  if (de?.includes('GNOME') || de?.includes('UNITY')) return 'GNOME'
  if (de?.includes('KDE') || de?.includes('PLASMA')) return 'KDE'
  if (de?.includes('XFCE')) return 'XFCE'
  log.warn(`[Main] Unknown or unsupported desktop environment: ${de}`)
  return 'Unknown'
}

export function calculateExportDimensions(
  resolutionKey: ResolutionKey,
  aspectRatio: string,
): { width: number; height: number } {
  const safeResolutionKey =
    resolutionKey && Object.prototype.hasOwnProperty.call(RESOLUTIONS, resolutionKey)
      ? resolutionKey
      : '720p'
  const baseHeight = RESOLUTIONS[safeResolutionKey].height
  const safeAspectRatio = typeof aspectRatio === 'string' && aspectRatio.includes(':') ? aspectRatio : '16:9'
  const [ratioW, ratioH] = safeAspectRatio.split(':').map(Number)
  const safeRatioW = Number.isFinite(ratioW) && ratioW > 0 ? ratioW : 16
  const safeRatioH = Number.isFinite(ratioH) && ratioH > 0 ? ratioH : 9
  const width = Math.round(baseHeight * (safeRatioW / safeRatioH))
  const finalWidth = width % 2 === 0 ? width : width + 1
  return { width: finalWidth, height: baseHeight }
}
