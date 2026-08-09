import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exportManagerPath = path.join(rootDir, 'electron', 'main', 'features', 'export-manager.ts')
const exportIpcHandlersPath = path.join(rootDir, 'electron', 'main', 'ipc', 'handlers', 'export.ts')
const appIpcHandlersPath = path.join(rootDir, 'electron', 'main', 'ipc', 'handlers', 'app.ts')
const recordingManagerPath = path.join(rootDir, 'electron', 'main', 'features', 'recording-manager.ts')
const rendererPagePath = path.join(rootDir, 'src', 'pages', 'RendererPage.tsx')
const exportModalPath = path.join(rootDir, 'src', 'components', 'editor', 'ExportModal.tsx')
const preloadPath = path.join(rootDir, 'electron', 'preload.ts')
const ipcIndexPath = path.join(rootDir, 'electron', 'main', 'ipc', 'index.ts')
const exportProcessPath = path.join(rootDir, 'src', 'hooks', 'useExportProcess.ts')
const source = fs.readFileSync(exportManagerPath, 'utf-8')
const exportIpcHandlersSource = fs.readFileSync(exportIpcHandlersPath, 'utf-8')
const appIpcHandlersSource = fs.readFileSync(appIpcHandlersPath, 'utf-8')
const recordingSource = fs.readFileSync(recordingManagerPath, 'utf-8')
const rendererSource = fs.readFileSync(rendererPagePath, 'utf-8')
const exportModalSource = fs.readFileSync(exportModalPath, 'utf-8')
const preloadSource = fs.readFileSync(preloadPath, 'utf-8')
const ipcIndexSource = fs.readFileSync(ipcIndexPath, 'utf-8')
const exportProcessSource = fs.readFileSync(exportProcessPath, 'utf-8')

function fail(message) {
  console.error(`[verify-export-startup] ${message}`)
  process.exit(1)
}

function indexOf(needle) {
  const index = source.indexOf(needle)
  if (index < 0) {
    fail(`Missing expected source marker: ${needle}`)
  }
  return index
}

function lastIndexOf(needle) {
  const index = source.lastIndexOf(needle)
  if (index < 0) {
    fail(`Missing expected source marker: ${needle}`)
  }
  return index
}

function assertBefore(leftLabel, leftIndex, rightLabel, rightIndex) {
  if (leftIndex >= rightIndex) {
    fail(`${leftLabel} must happen before ${rightLabel}`)
  }
}

function assertIncludes(label, haystack, needle) {
  if (!haystack.includes(needle)) {
    fail(`${label} missing expected source marker: ${needle}`)
  }
}

if (source.includes('spawnSync')) {
  fail('export-manager.ts must not use blocking spawnSync during export startup/audio preparation')
}

if (rendererSource.includes('readFileBuffer')) {
  fail('RendererPage.tsx must not load full video files through readFileBuffer during export')
}

const registerCancel = indexOf("ipcMain.once('export:cancel', cancellationHandler)")
const firstProgress = indexOf("sendProgressUpdate(0, 'Authorizing export...', true")
const outputDirectoryPreparation = indexOf('const outputDir = path.dirname(outputPath)')
const authorizeExport = indexOf('await authorizeDesktopExport')
const prepareAudioProgress = indexOf("sendProgressUpdate(2, 'Preparing audio...', true")
const reuseOriginalAudio = indexOf('Reusing original recording audio; no recording audio edits detected.')
const processRecordingAudio = indexOf(
  'const processedRecordingPath = await renderProcessedAudioFile(',
)
const mainFfmpegSpawn = indexOf('ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)')
const renderReadyRegistration = indexOf("ipcMain.once('render:ready', renderReadyListener)")
const workerLoad = lastIndexOf('createAndLoadRenderWorker()')

assertBefore('cancel registration', registerCancel, 'first progress event', firstProgress)
assertBefore('first progress event', firstProgress, 'output directory preparation', outputDirectoryPreparation)
assertBefore('first progress event', firstProgress, 'authorization', authorizeExport)
assertBefore('authorization', authorizeExport, 'audio preparation', prepareAudioProgress)
assertBefore('audio preparation', prepareAudioProgress, 'main FFmpeg spawn', mainFfmpegSpawn)
assertBefore(
  'recording audio fast path',
  reuseOriginalAudio,
  'recording audio processing fallback',
  processRecordingAudio,
)
assertBefore('render:ready listener registration', renderReadyRegistration, 'worker loading', workerLoad)

assertIncludes('Renderer video chunking', rendererSource, 'window.electronAPI.statFile(normalizedVideoPath)')
assertIncludes('Renderer video chunking', rendererSource, 'window.electronAPI.readFileChunk')
assertIncludes('Renderer video chunking', rendererSource, 'fileStart = offset')
assertIncludes('Renderer video chunking', rendererSource, 'getNextBufferOffset(mp4boxfile.appendBuffer(arrayBuffer))')
assertIncludes('Renderer video chunking', rendererSource, 'mp4boxfile.seek(0, true)')
assertIncludes('Renderer video chunking', rendererSource, 'mp4boxfile.releaseUsedSamples')
assertIncludes('Renderer memory budget', rendererSource, 'EXPORT_MEMORY_LIMIT_SETTING_KEY')
assertIncludes('Renderer memory budget', rendererSource, 'resolveExportMemoryBudget')
assertIncludes('Renderer memory budget', rendererSource, 'memoryBudget.maxBufferedFramesPerProvider')
assertIncludes('Renderer memory budget', rendererSource, 'memoryBudget.maxEncoderQueueSize')
assertIncludes('Renderer memory pressure throttle', rendererSource, 'createExportMemoryController')
assertIncludes('Renderer memory pressure throttle', rendererSource, "waitForBudget('mp4-pump')")
assertIncludes('Renderer memory pressure throttle', rendererSource, "waitForBudget('render-loop')")
assertIncludes('Export session correlation', source, 'exportSessionId')
assertIncludes('Export session correlation', source, 'sessionLogPrefix')
assertIncludes('Export session correlation', rendererSource, 'exportSessionId')
assertIncludes('Export session correlation', rendererSource, 'renderLogPrefix')
assertIncludes(
  'Filesystem IPC registration',
  ipcIndexSource,
  "ipcMain.handle('fs:statFile', fsHandlers.handleStatFile)",
)
assertIncludes(
  'Filesystem IPC registration',
  ipcIndexSource,
  "ipcMain.handle('fs:readFileChunk', fsHandlers.handleReadFileChunk)",
)
assertIncludes('System memory IPC handler', appIpcHandlersSource, 'totalmem()')
assertIncludes(
  'System memory IPC registration',
  ipcIndexSource,
  "ipcMain.handle('app:getSystemMemoryInfo', appHandlers.handleGetSystemMemoryInfo)",
)
assertIncludes('Current process memory preload', preloadSource, 'getCurrentProcessMemoryInfo')
assertIncludes('Current process memory preload', preloadSource, 'process.getProcessMemoryInfo()')
assertIncludes('Export source probe IPC', exportIpcHandlersSource, 'probeSourceVideoInfo')
assertIncludes(
  'Export source probe IPC',
  ipcIndexSource,
  "ipcMain.handle('export:probe-source-video-info', exportHandlers.handleProbeSourceVideoInfo)",
)
assertIncludes('Export modal source probe', exportModalSource, 'probeExportSourceVideoInfo(videoPath)')
assertIncludes('Adaptive low-fps fallback', source, 'sanitizeNominalFrameRate')
assertIncludes('Adaptive low-fps fallback', source, 'Using nominal tbr for export FPS')
assertIncludes('Adaptive export FPS cap', source, 'MAX_SUPPORTED_EXPORT_FPS = 60')
assertIncludes('Adaptive export FPS cap', source, 'sanitizeExportFrameRate')
assertIncludes('Take export payload', exportProcessSource, 'takeModeEnabled: fullState.takeModeEnabled')
assertIncludes('Take export payload', exportProcessSource, 'takes: fullState.takes')
assertIncludes('Take export payload', exportProcessSource, 'takeTransitions: fullState.takeTransitions')
assertIncludes('Take export payload', exportProcessSource, 'floatingMonitors: fullState.floatingMonitors')
assertIncludes('Screen recording CFR output', recordingSource, "'-fps_mode'")
assertIncludes('Screen recording CFR output', recordingSource, "'cfr'")
assertIncludes('Screen recording CFR output', recordingSource, 'Screen recording encode config')

console.log('[verify-export-startup] Export startup invariants verified.')
