// Entry point of the Electron application.

import { app, BrowserWindow, protocol, Menu, screen, dialog } from 'electron'
import log from 'electron-log/main'
import path from 'node:path'
import fsSync from 'node:fs'
import { Readable } from 'node:stream'
import Store from 'electron-store'
import { VITE_PUBLIC } from './lib/constants'
import { prepareExportExperimentLog } from './lib/export-experiment-log'
import { setupLogging } from './lib/logging'
import { resolveMediaRequestPath } from './lib/media-url'
import { registerIpcHandlers } from './ipc'
import { createRecorderWindow } from './windows/recorder-window'
import { handleAuthDeepLinkUrl } from './features/auth-manager'
import { onAppQuit, startRecording, loadVideoFromFile } from './features/recording-manager'
import { initializeMouseTrackerDependencies } from './features/mouse-tracker'
import { appState } from './state'

// --- Initialization ---
setupLogging()
app.setName('RecordSaaS')
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

// Enable WebCodecs and the Wayland global-shortcut portal before app readiness.
const enabledFeatures = ['WebCodecs', 'WebCodecsExperimental']
if (process.platform === 'linux') enabledFeatures.push('GlobalShortcutsPortal')
app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','))
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
const loggedMediaRequestPaths = new Set<string>()

type ByteRange = {
  start: number
  end: number
}

const getMediaContentType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.mp4':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.aac':
      return 'audio/aac'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.json':
      return 'application/json'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

const parseByteRange = (rangeHeader: string | null, fileSize: number): ByteRange | null => {
  if (!rangeHeader) return null

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : fileSize - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
    return null
  }

  return {
    start,
    end: Math.min(end, fileSize - 1),
  }
}

const createFileResponse = (request: Request, filePath: string): Response => {
  const stat = fsSync.statSync(filePath)
  const fileSize = stat.size
  const contentType = getMediaContentType(filePath)
  const range = parseByteRange(request.headers.get('range'), fileSize)

  if (request.headers.has('range') && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${fileSize}`,
      },
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, fileSize - 1)
  const contentLength = Math.max(0, end - start + 1)
  const body =
    request.method === 'HEAD'
      ? null
      : (Readable.toWeb(fsSync.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>)

  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(contentLength),
    'Content-Type': contentType,
  }

  if (range) {
    headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`
  }

  return new Response(body, {
    status: range ? 206 : 200,
    headers,
  })
}

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
      if (!appState.recorderWin.isVisible()) {
        appState.recorderWin.show()
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
  const exportExperimentLogPath = prepareExportExperimentLog()
  if (exportExperimentLogPath) {
    log.info(`[ExportExperiment] Fresh diagnostics log: ${exportExperimentLogPath}`)
  } else {
    log.warn('[ExportExperiment] Could not prepare diagnostics log.')
  }
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
    if (app.dock) {
      app.dock.setMenu(dockMenu)
    }
  }

  // Initialize platform-specific dependencies asynchronously
  initializeMouseTrackerDependencies()

  // Register custom protocol for media files
  protocol.handle('media', async (request) => {
    const resourcePath = resolveMediaRequestPath(request.url, VITE_PUBLIC)
    if (resourcePath && fsSync.existsSync(resourcePath)) {
      if (!loggedMediaRequestPaths.has(resourcePath)) {
        loggedMediaRequestPaths.add(resourcePath)
        log.info(
          `[Protocol] Serving media file: ${request.url} -> ${resourcePath} range=${request.headers.get('range') || 'none'}`,
        )
      }
      return createFileResponse(request, resourcePath)
    }

    log.error(`[Protocol] Could not find file for media request: ${request.url}`)
    return new Response('Media file not found.', { status: 404 })
  })

  registerIpcHandlers()
  createRecorderWindow()

  if (pendingDeepLinkUrl) {
    const deepLinkUrl = pendingDeepLinkUrl
    pendingDeepLinkUrl = null
    void handleAuthDeepLinkUrl(deepLinkUrl)
  }
})
