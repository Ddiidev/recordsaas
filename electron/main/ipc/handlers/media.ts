import { IpcMainInvokeEvent, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { appState } from '../../state'
import { ensureDirectoryExists } from '../../lib/utils'

type MediaImportResult = {
  canceled: boolean
  asset?: {
    path: string
    name: string
  }
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

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

export async function handleImportMediaImage(_event: IpcMainInvokeEvent): Promise<MediaImportResult> {
  return importMediaAsset('Import Image Asset', IMAGE_EXTENSIONS)
}
