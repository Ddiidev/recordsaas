// Entry point of the Electron application.

import { app, BrowserWindow, protocol, ProtocolRequest, ProtocolResponse, Menu, screen, dialog } from 'electron'
import log from 'electron-log/main'
import path from 'node:path'
import fsSync from 'node:fs'
import Store from 'electron-store'
import { VITE_PUBLIC } from './lib/constants'
import { setupLogging } from './lib/logging'
import { registerIpcHandlers } from './ipc'
import { createRecorderWindow } from './windows/recorder-window'
import { handleAuthDeepLinkUrl } from './features/auth-manager'
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

const store = new Store()
if (store.get('general.forceHighPerformanceGpu', false)) {
  app.commandLine.appendSwitch('force_high_performance_gpu', 'true')
}

function getDeepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith('recordsaas://')) || null
}

function registerCustomProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('recordsaas', process.execPath, [path.resolve(process.argv[1])])
    }
    return
  }

  app.setAsDefaultProtocolClient('recordsaas')
}

let pendingDeepLinkUrl: string | null = process.platform === 'darwin' ? null : getDeepLinkFromArgv(process.argv)

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const deepLinkUrl = getDeepLinkFromArgv(argv)
    if (deepLinkUrl) {
      void handleAuthDeepLinkUrl(deepLinkUrl)
    }

    if (appState.recorderWin && !appState.recorderWin.isDestroyed()) {
      if (appState.recorderWin.isMinimized()) {
        appState.recorderWin.restore()
      }
      appState.recorderWin.focus()
    } else {
      createRecorderWindow()
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (app.isReady()) {
    void handleAuthDeepLinkUrl(url)
    return
  }

  pendingDeepLinkUrl = url
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
  log.info('[App] Ready. Initializing...')
  registerCustomProtocolClient()

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
    app.dock.setMenu(dockMenu)
  }

  // Initialize platform-specific dependencies asynchronously
  initializeMouseTrackerDependencies()

  // Register custom protocol for media files
  protocol.registerFileProtocol(
    'media',
    (request: ProtocolRequest, callback: (response: string | ProtocolResponse) => void) => {
      const url = request.url.replace('media://', '')
      const decodedUrl = decodeURIComponent(url)
      const resourcePath = path.join(VITE_PUBLIC, decodedUrl)

      if (path.isAbsolute(decodedUrl) && fsSync.existsSync(decodedUrl)) {
        return callback(decodedUrl)
      }
      if (fsSync.existsSync(resourcePath)) {
        return callback(resourcePath)
      }
      log.error(`[Protocol] Could not find file: ${decodedUrl}`)
      return callback({ error: -6 }) // FILE_NOT_FOUND
    },
  )

  registerIpcHandlers()
  createRecorderWindow()

  if (pendingDeepLinkUrl) {
    const deepLinkUrl = pendingDeepLinkUrl
    pendingDeepLinkUrl = null
    void handleAuthDeepLinkUrl(deepLinkUrl)
  }
})
