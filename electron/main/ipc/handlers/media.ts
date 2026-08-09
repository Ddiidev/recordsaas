import { IpcMainEvent, IpcMainInvokeEvent, dialog } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { appState } from '../../state'
import { ensureDirectoryExists, getFFmpegPath } from '../../lib/utils'

type MediaImportResult = {
  canceled: boolean
  asset?: {
    path: string
    name: string
    duration?: number
    hasAudioTrack?: boolean
    isSeekableProxy?: boolean
    originalPath?: string
  }
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']
const activeTakePreparations = new Map<string, ChildProcessWithoutNullStreams>()
const canceledTakePreparations = new Set<string>()

type VideoProbe = { duration: number; fps: number; hasAudioTrack: boolean }

const parseClock = (value: string): number => {
  const match = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  if (!match) return 0
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

const probeVideo = (assetPath: string): Promise<VideoProbe> =>
  new Promise((resolve, reject) => {
    const process = spawn(getFFmpegPath(), ['-hide_banner', '-i', assetPath], { windowsHide: true })
    let stderr = ''
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    process.once('error', reject)
    process.once('close', () => {
      const duration = parseClock(stderr.match(/Duration:\s*([^,]+)/)?.[1] || '')
      const videoLine = stderr.split(/\r?\n/).find((line) => /Stream #.*Video:/.test(line))
      const fps = Number(videoLine?.match(/(\d+(?:\.\d+)?)\s*fps/)?.[1] || 30)
      const hasAudioTrack = /Stream #.*Audio:/.test(stderr)
      if (!videoLine || duration <= 0) {
        reject(new Error('FFmpeg could not read the selected video metadata.'))
        return
      }
      resolve({ duration, fps: Math.max(1, Math.min(60, fps)), hasAudioTrack })
    })
  })

const getRuntimeMediaDir = (): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
  return path.join(homeDir, '.recordsaas', 'media-assets')
}

const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

const importMediaAsset = async (title: string, extensions: string[]): Promise<MediaImportResult> => {
  const ownerWindow = appState.editorWin || appState.recorderWin
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return { canceled: true }
  }

  const selection = await dialog.showOpenDialog(ownerWindow, {
    title,
    properties: ['openFile'],
    filters: [{ name: title.replace('Import ', ''), extensions }],
  })

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true }
  }

  const sourcePath = selection.filePaths[0]
  const sourceName = path.basename(sourcePath)

  try {
    const runtimeMediaDir = getRuntimeMediaDir()
    await ensureDirectoryExists(runtimeMediaDir)

    const parsed = path.parse(sourceName)
    const timestamp = Date.now()
    const safeBaseName = sanitizeFileName(parsed.name || 'media')
    const safeExtension = (parsed.ext || '.media').toLowerCase()
    const targetPath = path.join(runtimeMediaDir, `${safeBaseName}-${timestamp}${safeExtension}`)

    await fs.copyFile(sourcePath, targetPath)

    return {
      canceled: false,
      asset: {
        path: targetPath,
        name: sourceName,
      },
    }
  } catch (error) {
    log.error('[MediaIPC] Failed to import media asset:', error)
    return { canceled: true }
  }
}

export async function handleImportMediaAudio(_event: IpcMainInvokeEvent): Promise<MediaImportResult> {
  const previousMediaAudioPath = appState.currentEditorSessionFiles?.mediaAudioPath
  const result = await importMediaAsset('Import Audio Asset', AUDIO_EXTENSIONS)
  if (result.asset && appState.currentEditorSessionFiles) {
    if (previousMediaAudioPath && previousMediaAudioPath !== result.asset.path) {
      try {
        await fs.unlink(previousMediaAudioPath)
      } catch (cleanupError) {
        log.warn('[MediaIPC] Failed to cleanup previous imported media audio:', cleanupError)
      }
    }
    appState.currentEditorSessionFiles.mediaAudioPath = result.asset.path
  }
  return result
}

export async function handleImportMediaVideo(_event: IpcMainInvokeEvent): Promise<MediaImportResult> {
  return importMediaAsset('Import Video Asset', VIDEO_EXTENSIONS)
}

export async function handlePrepareTakeVideo(
  event: IpcMainInvokeEvent,
  payload: { assetPath?: string; requestId?: string },
): Promise<MediaImportResult> {
  const assetPath = typeof payload?.assetPath === 'string' ? payload.assetPath : ''
  const requestId = typeof payload?.requestId === 'string' ? payload.requestId : ''
  if (!assetPath || !requestId || activeTakePreparations.has(requestId)) return { canceled: true }

  let proxyPath = ''
  try {
    const probe = await probeVideo(assetPath)
    event.sender.send('media:prepare-take-video-progress', {
      requestId,
      progress: 0,
      stage: 'Preparing seekable proxy',
    })
    const runtimeMediaDir = getRuntimeMediaDir()
    await ensureDirectoryExists(runtimeMediaDir)
    const parsed = path.parse(assetPath)
    proxyPath = path.join(runtimeMediaDir, `${sanitizeFileName(parsed.name)}-${Date.now()}-take-proxy.mp4`)
    const fps = Math.max(24, Math.round(probe.fps))
    const args = [
      '-y',
      '-hide_banner',
      '-i',
      assetPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      `fps=${fps}`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-g',
      String(fps * 2),
      '-keyint_min',
      String(fps * 2),
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      ...(probe.hasAudioTrack ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:2',
      '-stats_period',
      '0.25',
      proxyPath,
    ]

    await new Promise<void>((resolve, reject) => {
      const process = spawn(getFFmpegPath(), args, { windowsHide: true })
      activeTakePreparations.set(requestId, process)
      let stderr = ''
      process.stderr.on('data', (chunk) => {
        const message: string = chunk.toString()
        stderr = `${stderr}${message}`.slice(-12000)
        const matches = Array.from(message.matchAll(/out_time_us=(\d+)/g))
        const latest = matches[matches.length - 1]
        if (latest) {
          const seconds = Number(latest[1]) / 1_000_000
          event.sender.send('media:prepare-take-video-progress', {
            requestId,
            progress: Math.max(0, Math.min(100, (seconds / probe.duration) * 100)),
            stage: 'Preparing seekable proxy',
          })
        }
      })
      process.once('error', reject)
      process.once('close', (code, signal) => {
        activeTakePreparations.delete(requestId)
        if (code === 0 && !canceledTakePreparations.has(requestId)) resolve()
        else reject(new Error(signal ? 'Take video preparation canceled.' : `FFmpeg proxy failed (${code}). ${stderr}`))
      })
    })

    canceledTakePreparations.delete(requestId)
    event.sender.send('media:prepare-take-video-progress', { requestId, progress: 100, stage: 'Ready' })
    return {
      canceled: false,
      asset: {
        path: proxyPath,
        name: path.basename(assetPath),
        duration: probe.duration,
        hasAudioTrack: probe.hasAudioTrack,
        isSeekableProxy: true,
        originalPath: assetPath,
      },
    }
  } catch (error) {
    activeTakePreparations.delete(requestId)
    canceledTakePreparations.delete(requestId)
    if (proxyPath) await fs.rm(proxyPath, { force: true }).catch(() => undefined)
    log.error('[MediaIPC] Failed to prepare take video:', error)
    return { canceled: true }
  }
}

export function handleCancelPrepareTakeVideo(_event: IpcMainEvent, requestId: string): void {
  const process = activeTakePreparations.get(requestId)
  if (!process) return
  canceledTakePreparations.add(requestId)
  activeTakePreparations.delete(requestId)
  process.kill('SIGINT')
}

export async function handleImportMediaImage(_event: IpcMainInvokeEvent): Promise<MediaImportResult> {
  return importMediaAsset('Import Image Asset', IMAGE_EXTENSIONS)
}
