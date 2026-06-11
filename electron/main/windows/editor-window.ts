// Logic to create and manage the editor window.

import log from 'electron-log/main'
import { BrowserWindow, IpcMainEvent, ipcMain, nativeTheme } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import Store from 'electron-store'
import { format as formatUrl } from 'node:url'
import { appState } from '../state'
import { cleanupOrphanedRecordings } from '../features/recording-manager'
import { checkForUpdates } from '../features/update-checker'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, PRELOAD_SCRIPT } from '../lib/constants'
import { createEditorMenu, clearMenu } from '../features/app-menu'
import { RecordingGeometry } from '../state'

const store = new Store() // Can be configured with schema if needed

type ProjectOpenPayload = {
  videoPath: string
  metadataPath: string
  webcamVideoPath?: string
  audioPath?: string
  originalProjectPath?: string
}

export function createEditorWindow(
  videoPath: string,
  metadataPath: string,
  recordingGeometry: RecordingGeometry,
  webcamVideoPath?: string,
  audioPath?: string,
  mediaAudioPath?: string,
  scaleFactor: number = 1,
  originalProjectPath?: string
) {
  const bounds = store.get('windowBounds', { width: 1280, height: 800 }) as {
    x?: number
    y?: number
    width: number
    height: number
  }

  appState.currentEditorSessionFiles = {
    screenVideoPath: videoPath,
    metadataPath,
    recordingGeometry,
    webcamVideoPath,
    audioPath,
    mediaAudioPath,
    scaleFactor,
    originalProjectPath,
  }
  log.info('[EditorWindow] Stored session files for cleanup:', appState.currentEditorSessionFiles)

  const projectPayload: ProjectOpenPayload = {
    videoPath,
    metadataPath,
    webcamVideoPath,
    audioPath,
    originalProjectPath: appState.currentEditorSessionFiles.originalProjectPath,
  }

  const isWindows = process.platform === 'win32'
  let titleBarOptions = {}

  if (isWindows) {
    const appearance = store.get('appearance') as { mode?: 'light' | 'dark' | 'auto' } | undefined
    const isDarkMode = appearance?.mode === 'dark' || (appearance?.mode === 'auto' && nativeTheme.shouldUseDarkColors)

    titleBarOptions = {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: isDarkMode ? '#1D2025' : '#F9FAFB', // Matches dark/light card/sidebar background
        symbolColor: isDarkMode ? '#EEEEEE' : '#333333',
        height: 48, // h-12 in Tailwind
      },
    }
  }

  appState.editorWin = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, 'recordsaas-appicon.png'),
    autoHideMenuBar: true,
    ...bounds,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden', // Keep hidden for all platforms
    ...titleBarOptions, // Apply Windows-specific overlay
    show: false,
    webPreferences: {
      preload: PRELOAD_SCRIPT,
      webSecurity: !VITE_DEV_SERVER_URL,
    },
  })

  const sendProjectPayload = (reason: string) => {
    const editorWin = appState.editorWin
    if (!editorWin || editorWin.isDestroyed()) return
    log.info(`[EditorWindow] Sending project data (${reason}).`, projectPayload)
    editorWin.webContents.send('project:open', projectPayload)
  }

  const handleEditorReadyForProject = (event: IpcMainEvent) => {
    if (event.sender !== appState.editorWin?.webContents) return
    log.info('[EditorWindow] Received editor:ready-for-project.')
    sendProjectPayload('renderer-ready')
  }

  ipcMain.on('editor:ready-for-project', handleEditorReadyForProject)

  appState.editorWin.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() === 'w' && (input.control || input.meta)) {
      event.preventDefault()
    }
  })

  appState.editorWin.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`[EditorWindow] Preload failed: ${preloadPath}`, error)
  })

  appState.editorWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`[EditorWindow] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })

  appState.editorWin.webContents.on('render-process-gone', (_event, details) => {
    log.error('[EditorWindow] Render process gone:', details)
  })

  appState.editorWin.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2 && !message.startsWith('[Editor') && !message.startsWith('[Preview]')) return

    const logMessage = `[EditorWindow] Renderer console (${sourceId}:${line}): ${message}`
    if (level >= 3) {
      log.error(logMessage)
    } else if (level >= 2) {
      log.warn(logMessage)
    } else {
      log.info(logMessage)
    }
  })

  // Set the application menu for the editor window
  createEditorMenu()

  // Add listeners for maximize/unmaximize
  appState.editorWin.on('maximize', () => {
    appState.editorWin?.webContents.send('window:state-changed', { isMaximized: true })
  })
  appState.editorWin.on('unmaximize', () => {
    appState.editorWin?.webContents.send('window:state-changed', { isMaximized: false })
  })

  appState.editorWin.maximize()

  // Cleanup orphaned recordings
  cleanupOrphanedRecordings()

  // Save bounds logic
  let resizeTimeout: NodeJS.Timeout
  const saveBounds = () => {
    if (appState.editorWin && !appState.editorWin.isDestroyed() && !appState.editorWin.isMaximized()) {
      store.set('windowBounds', appState.editorWin.getBounds())
    }
  }
  const debouncedSaveBounds = () => {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(saveBounds, 500)
  }
  appState.editorWin.on('resize', debouncedSaveBounds)
  appState.editorWin.on('move', debouncedSaveBounds)
  appState.editorWin.on('close', saveBounds)

  // if (process.env.NODE_ENV === 'development') {
  //   editorWin.webContents.openDevTools();
  // }

  appState.editorWin.on('closed', () => {
    ipcMain.removeListener('editor:ready-for-project', handleEditorReadyForProject)
    // Clear the application menu when the editor window is closed
    clearMenu()
    if (appState.currentEditorSessionFiles) {
      cleanupEditorFiles(appState.currentEditorSessionFiles)
      appState.currentEditorSessionFiles = null
    }
    appState.editorWin = null
  })

  appState.editorWin.show()

  const editorUrl = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#editor`
    : formatUrl({ pathname: path.join(RENDERER_DIST, 'index.html'), protocol: 'file:', slashes: true, hash: 'editor' })

  log.info(`[EditorWindow] Loading URL: ${editorUrl}`)
  appState.editorWin.loadURL(editorUrl)

  appState.editorWin.webContents.on('did-finish-load', () => {
    log.info('[EditorWindow] Finished loading. Waiting for renderer project-ready handshake.')
    checkForUpdates(appState.editorWin)
  })
}

export async function cleanupEditorFiles(files: {
  screenVideoPath: string
  metadataPath: string
  webcamVideoPath?: string
  audioPath?: string
  mediaAudioPath?: string
  originalProjectPath?: string
}) {
  log.info('[EditorWindow] Cleaning up session files:', files)
  const unlinkPromises = [files.screenVideoPath, files.webcamVideoPath, files.audioPath, files.mediaAudioPath, files.metadataPath]
    .filter(Boolean)
    .map((filePath) => (fsSync.existsSync(filePath!) ? fs.unlink(filePath!) : Promise.resolve()))
  try {
    await Promise.all(unlinkPromises)
    log.info('[EditorWindow] Session files deleted successfully.')
  } catch (error) {
    log.error('[EditorWindow] Could not delete session files:', error)
  }
}
