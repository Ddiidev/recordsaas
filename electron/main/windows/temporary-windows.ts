// Logic to create temporary windows like countdown, saving, selection.

import log from 'electron-log/main'
import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { appState } from '../state'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, TEMP_PRELOAD_SCRIPT } from '../lib/constants'

function getConsoleLevelName(level: number) {
  if (level >= 3) return 'error'
  if (level >= 2) return 'warn'
  return 'info'
}

function attachTemporaryWindowDiagnostics(win: BrowserWindow, label: string) {
  const prefix = `[TemporaryWindow:${label}]`

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error(`${prefix} Preload failed: ${preloadPath}`, error)
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error(`${prefix} Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`)
  })

  win.webContents.on('did-finish-load', () => {
    log.info(`${prefix} Finished loading.`)
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    log.error(`${prefix} Render process gone:`, details)
  })

  win.webContents.on('console-message', (event, ...legacyArgs) => {
    const eventDetails = event as unknown as {
      level?: number
      message?: string
      lineNumber?: number
      sourceId?: string
    }
    const legacyLevel = legacyArgs[0]
    const legacyMessage = legacyArgs[1]
    const legacyLineNumber = legacyArgs[2]
    const legacySourceId = legacyArgs[3]
    const messageDetails =
      typeof legacyLevel === 'number'
        ? {
            level: legacyLevel,
            message: typeof legacyMessage === 'string' ? legacyMessage : '',
            lineNumber: typeof legacyLineNumber === 'number' ? legacyLineNumber : 0,
            sourceId: typeof legacySourceId === 'string' ? legacySourceId : 'unknown',
          }
        : eventDetails
    const level = typeof messageDetails.level === 'number' ? messageDetails.level : 0
    const message = String(messageDetails.message ?? '')
    if (level < 2 && !message.startsWith('[ExportProgress]') && !message.startsWith('[TempPreload]')) return

    const sourceId = messageDetails.sourceId || 'unknown'
    const lineNumber = messageDetails.lineNumber ?? 0
    const logMessage = `${prefix} Renderer console ${getConsoleLevelName(level)} (${sourceId}:${lineNumber}): ${message}`

    if (level >= 3) {
      log.error(logMessage)
    } else if (level >= 2) {
      log.warn(logMessage)
    } else {
      log.info(logMessage)
    }
  })
}

function createTemporaryWindow(options: Electron.BrowserWindowConstructorOptions, htmlPath: string) {
  // Define the path to the icon, handling both development and production environments
  const iconPath = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, 'public/recordsaas-appicon.png')
    : path.join(RENDERER_DIST, 'recordsaas-appicon.png')

  const win = new BrowserWindow({
    ...options,
    icon: iconPath, // Set the window icon here
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: TEMP_PRELOAD_SCRIPT,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  attachTemporaryWindowDiagnostics(win, htmlPath)

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() === 'w' && (input.control || input.meta)) {
      event.preventDefault()
    }
  })

  const url = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, `public/${htmlPath}`)
    : path.join(RENDERER_DIST, htmlPath)

  win.loadFile(url)
  log.info(`[TemporaryWindow:${htmlPath}] Loading file: ${url}`)
  return win
}

export function createSavingWindow() {
  appState.savingWin = createTemporaryWindow({ width: 350, height: 200, show: false }, 'saving/index.html')

  // Only show the window once it's ready to avoid a white flash
  appState.savingWin.once('ready-to-show', () => {
    appState.savingWin?.show()
  })

  appState.savingWin.on('closed', () => {
    appState.savingWin = null
  })
}

export function createSelectionWindow() {
  appState.selectionWin = createTemporaryWindow({ fullscreen: true }, 'selection/index.html')

  appState.selectionWin.on('closed', () => {
    appState.selectionWin = null
  })
}

export function createExportProgressWindow() {
  if (appState.exportProgressWin && !appState.exportProgressWin.isDestroyed()) {
    log.info('[TemporaryWindow:export-progress/index.html] Reusing existing export progress window.')
    return appState.exportProgressWin
  }

  const { workArea } = screen.getPrimaryDisplay()
  const width = 220
  const height = 42
  const margin = 12
  const x = Math.round(workArea.x + workArea.width - width - margin)
  const y = Math.round(workArea.y + workArea.height - height - margin)

  appState.exportProgressWin = createTemporaryWindow(
    { width, height, x, y, show: false, minimizable: true, movable: true },
    'export-progress/index.html',
  )
  log.info(
    `[TemporaryWindow:export-progress/index.html] Created export progress window at ${x},${y} ${width}x${height}.`,
  )

  appState.exportProgressWin.once('ready-to-show', () => {
    log.info('[TemporaryWindow:export-progress/index.html] ready-to-show. Showing progress window.')
    appState.exportProgressWin?.setAlwaysOnTop(true, 'screen-saver')
    appState.exportProgressWin?.show()
    appState.exportProgressWin?.focus()
  })

  appState.exportProgressWin.on('closed', () => {
    log.info('[TemporaryWindow:export-progress/index.html] Closed.')
    appState.exportProgressWin = null
  })

  return appState.exportProgressWin
}
