// Logic to create temporary windows like countdown, saving, selection.

import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { appState } from '../state'
import { VITE_DEV_SERVER_URL, RENDERER_DIST, OVERLAY_PRELOAD_SCRIPT } from '../lib/constants'

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
      preload: OVERLAY_PRELOAD_SCRIPT,
      sandbox: false,
    },
  })

  const url = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, `public/${htmlPath}`)
    : path.join(RENDERER_DIST, htmlPath)

  win.loadFile(url)
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

  appState.exportProgressWin.once('ready-to-show', () => {
    appState.exportProgressWin?.setAlwaysOnTop(true, 'screen-saver')
    appState.exportProgressWin?.show()
    appState.exportProgressWin?.focus()
  })

  appState.exportProgressWin.on('closed', () => {
    appState.exportProgressWin = null
  })

  return appState.exportProgressWin
}
