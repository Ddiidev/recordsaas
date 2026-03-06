import { IpcMainInvokeEvent, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { appState } from '../../state'
import { ensureDirectoryExists } from '../../lib/utils'

type MediaAudioImportResult = {
  canceled: boolean
  asset?: {
    path: string
    name: string
  }
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']

const getRuntimeMediaDir = (): string => {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.'
  return path.join(homeDir, '.recordsaas', 'media-assets')
}

const sanitizeFileName = (fileName: string): string => fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

export async function handleImportMediaAudio(_event: IpcMainInvokeEvent): Promise<MediaAudioImportResult> {
  const ownerWindow = appState.editorWin || appState.recorderWin
  if (!ownerWindow || ownerWindow.isDestroyed()) {
    return { canceled: true }
  }

  const selection = await dialog.showOpenDialog(ownerWindow, {
    title: 'Import Audio Asset',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
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
    const safeBaseName = sanitizeFileName(parsed.name || 'audio')
    const safeExtension = (parsed.ext || '.audio').toLowerCase()
    const targetPath = path.join(runtimeMediaDir, `${safeBaseName}-${timestamp}${safeExtension}`)

    await fs.copyFile(sourcePath, targetPath)

    const previousMediaAudioPath = appState.currentEditorSessionFiles?.mediaAudioPath
    if (previousMediaAudioPath && previousMediaAudioPath !== targetPath) {
      try {
        await fs.unlink(previousMediaAudioPath)
      } catch (cleanupError) {
        log.warn('[MediaIPC] Failed to cleanup previous imported media audio:', cleanupError)
      }
    }

    if (appState.currentEditorSessionFiles) {
      appState.currentEditorSessionFiles.mediaAudioPath = targetPath
    }

    return {
      canceled: false,
      asset: {
        path: targetPath,
        name: sourceName,
      },
    }
  } catch (error) {
    log.error('[MediaIPC] Failed to import media audio asset:', error)
    return { canceled: true }
  }
}
