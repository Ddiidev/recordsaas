// Entry point of the Electron application.

import { app, BrowserWindow, protocol, Menu, screen, dialog } from 'electron'
import log from 'electron-log/main'
import path from 'node:path'
import fsSync from 'node:fs'
import Store from 'electron-store'
import { VITE_PUBLIC } from './lib/constants'
import { setupLogging } from './lib/logging'
import { normalizeMediaRequestPath } from './lib/media-path'
import { registerIpcHandlers } from './ipc'
import { handleAuthDeepLink, initializeAuthManager } from './features/auth-manager'
import { createRecorderWindow } from './windows/recorder-window'
import { onAppQuit, startRecording, loadVideoFromFile } from './features/recording-manager'
import { initializeMouseTrackerDependencies } from './features/mouse-tracker'
import { appState } from './state'

// --- Initialization ---
setupLogging()
app.setName('RecordSaaS')

// Enable WebCodecs in renderer/worker contexts
app.commandLine.appendSwitch('enable-features', 'WebCodecs,WebCodecsExperimental')
app.commandLine.appendSwitch('enable-blink-features', 'WebCodecs,WebCodecsExperimental')
app.commandLine.appendSwitch('disable-gpu-vsync')

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true },
  },
])

const store = new Store()
if (store.get('general.forceHighPerformanceGpu', false)) {
  app.commandLine.appendSwitch('force_high_performance_gpu', 'true')
}

const AUTH_PROTOCOL = 'recordsaas'
const pendingAuthDeepLinks: string[] = []

function extractDeepLink(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`)) || null
}

function registerAuthProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    return
  }

  app.setAsDefaultProtocolClient(AUTH_PROTOCOL)
}

function queueOrHandleAuthDeepLink(url: string) {
  if (app.isReady()) {
    void handleAuthDeepLink(url)
  } else {
    pendingAuthDeepLinks.push(url)
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, argv) => {
  const deepLink = extractDeepLink(argv)
  if (deepLink) {
    queueOrHandleAuthDeepLink(deepLink)
  }

  if (!app.isReady()) {
    return
  }

  if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
    createRecorderWindow()
  } else {
    appState.recorderWin.show()
    appState.recorderWin.focus()
  }
})

app.on('open-url', (event, url) => {
  event.preventDefault()
  queueOrHandleAuthDeepLink(url)
})

// --- App Lifecycle Events ---
app.on('window-all-closed', () => {
  log.info('[App] All windows closed. Quitting.')
  app.quit()
})

app.on('before-quit', onAppQuit)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createRecorderWindow()
  }
})

app.whenReady().then(async () => {
  log.info(`[App] Ready. v${app.getVersion()} on ${process.platform} (${process.arch}). Initializing...`)
  registerAuthProtocolClient()
  await initializeAuthManager()

  const initialDeepLink = extractDeepLink(process.argv)
  if (initialDeepLink) {
    pendingAuthDeepLinks.push(initialDeepLink)
  }

  // Set Dock Menu on macOS
  if (process.platform === 'darwin') {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'New Default Recording',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox(
              'Action Not Allowed',
              'Please close the current editor session to start a new recording.',
            )
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()

          const primaryDisplay = screen.getPrimaryDisplay()
          startRecording({
            source: 'fullscreen',
            displayId: primaryDisplay.id,
            mic: undefined,
            webcam: undefined,
          })
        },
      },
      {
        label: 'Import Video File...',
        click: () => {
          if (appState.editorWin && !appState.editorWin.isDestroyed()) {
            dialog.showErrorBox('Action Not Allowed', 'Please close the current editor session to import a new video.')
            appState.editorWin.focus()
            return
          }
          if (appState.currentRecordingSession) {
            dialog.showErrorBox('Recording in Progress', 'A recording is already in progress.')
            return
          }

          if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
            createRecorderWindow()
          }
          appState.recorderWin?.show()
          loadVideoFromFile()
        },
      },
    ])
    app.dock?.setMenu(dockMenu)
  }

  // Initialize platform-specific dependencies asynchronously
  initializeMouseTrackerDependencies()

  // Register custom protocol for media files
  protocol.registerFileProtocol('media', (request, callback) => {
    const normalizedPath = normalizeMediaRequestPath(request.url)
    const resourcePath = path.join(VITE_PUBLIC, normalizedPath)

    if (path.isAbsolute(normalizedPath) && fsSync.existsSync(normalizedPath)) {
      return callback(normalizedPath)
    }
    if (fsSync.existsSync(resourcePath)) {
      return callback(resourcePath)
    }
    log.error(`[Protocol] Could not find file. request="${request.url}" normalized="${normalizedPath}"`)
    return callback({ error: -6 }) // FILE_NOT_FOUND
  })

  registerIpcHandlers()
  createRecorderWindow()

  while (pendingAuthDeepLinks.length > 0) {
    const deepLink = pendingAuthDeepLinks.shift()
    if (deepLink) {
      void handleAuthDeepLink(deepLink)
    }
  }
})
