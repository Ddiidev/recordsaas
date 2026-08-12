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
const audioVolumePath = path.join(rootDir, 'src', 'lib', 'audio-volume.ts')
const previewAudioPath = path.join(rootDir, 'src', 'lib', 'preview-audio.ts')
const previewPath = path.join(rootDir, 'src', 'components', 'editor', 'Preview.tsx')
const ensureBinariesPath = path.join(rootDir, 'scripts', 'ensure-binaries.mjs')
const systemAudioProgramPath = path.join(rootDir, 'native', 'RecordSaaS.SystemAudio', 'Program.cs')
const systemAudioProjectPath = path.join(rootDir, 'native', 'RecordSaaS.SystemAudio', 'RecordSaaS.SystemAudio.csproj')
const releaseWorkflowPath = path.join(rootDir, '.github', 'workflows', 'release.yml')
const source = fs.readFileSync(exportManagerPath, 'utf-8')
const exportIpcHandlersSource = fs.readFileSync(exportIpcHandlersPath, 'utf-8')
const appIpcHandlersSource = fs.readFileSync(appIpcHandlersPath, 'utf-8')
const recordingSource = fs.readFileSync(recordingManagerPath, 'utf-8')
const rendererSource = fs.readFileSync(rendererPagePath, 'utf-8')
const exportModalSource = fs.readFileSync(exportModalPath, 'utf-8')
const preloadSource = fs.readFileSync(preloadPath, 'utf-8')
const ipcIndexSource = fs.readFileSync(ipcIndexPath, 'utf-8')
const exportProcessSource = fs.readFileSync(exportProcessPath, 'utf-8')
const audioVolumeSource = fs.readFileSync(audioVolumePath, 'utf-8')
const previewAudioSource = fs.readFileSync(previewAudioPath, 'utf-8')
const previewSource = fs.readFileSync(previewPath, 'utf-8')
const ensureBinariesSource = fs.readFileSync(ensureBinariesPath, 'utf-8')
const systemAudioProgramSource = fs.readFileSync(systemAudioProgramPath, 'utf-8')
const systemAudioProjectSource = fs.readFileSync(systemAudioProjectPath, 'utf-8')
const releaseWorkflowSource = fs.readFileSync(releaseWorkflowPath, 'utf-8')

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
const processRecordingAudio = indexOf('const processedRecordingPath = await renderProcessedAudioFile(')
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
assertIncludes('Microphone export volume payload', exportProcessSource, 'volume: fullState.volume')
assertIncludes('Microphone export mute payload', exportProcessSource, 'isMuted: fullState.isMuted')
assertIncludes('Amplified export volume curve', source, 'audioVolumeSettingToGain(recordingVolumeSetting)')
assertIncludes('Amplified export volume filter', source, 'Math.abs(baseVolume - 1) >= 0.001')
assertIncludes('Change Sound fade parity', source, 'fadeInDuration: activeRegion.fadeInDuration')
assertIncludes('Post-concat track limiter', source, 'concat=n=${segments.length}:v=0:a=1${limitPeaks ?')
assertIncludes('Strong audio boost range', audioVolumeSource, 'MAX_AUDIO_BOOST_DB = 24')
assertIncludes('Export peak limiter', source, 'AUDIO_LIMITER_FILTER')
assertIncludes('Export soft pre-limiter', source, 'AUDIO_PRE_LIMITER_FILTER')
assertIncludes('Export soft-knee compressor', source, 'acompressor=threshold=0.25:ratio=8')
assertIncludes('Export AAC headroom', source, 'alimiter=limit=0.562341')
assertIncludes('Lossless processed audio intermediate', source, "path.join(tmpDir, 'processed.flac')")
assertIncludes('Lossless sync audio intermediate', source, "path.join(tmpDir, 'sync.flac')")
assertIncludes('Lossless take audio intermediate', source, "path.join(tmpDir, 'take-composition.flac')")
assertIncludes(
  'Unnormalized single-pass audio mix',
  source,
  'amix=inputs=${trackPaths.length}:normalize=0:dropout_transition=0',
)
assertIncludes('Master mix limiter', source, 'normalize=0:dropout_transition=0,${AUDIO_LIMITER_FILTER}[aout]')
assertIncludes('Single-pass audio mix invocation', source, 'mixAudioTracks(audioTracksToMix, runAuxiliaryFFmpeg)')
assertIncludes('Preview master limiter', previewAudioSource, 'getPreviewMasterLimiter')
assertIncludes('Preview shared soft peak guard', previewAudioSource, 'createPreviewSoftPeakGuardCurve')
assertIncludes('Preview peak headroom', previewAudioSource, 'PREVIEW_AUDIO_PEAK_LIMIT_DB = -1.5')
assertIncludes('Preview peak oversampling', previewAudioSource, "peakGuard.oversample = '4x'")
assertIncludes('Early temporary audio cleanup', source, 'const cleanupProcessedAudio = () =>')
assertIncludes('Preview limiter activation', previewSource, 'shouldLimitPreviewAudio')
assertIncludes('Imported take CORS', previewSource, 'crossOrigin="anonymous"')
assertIncludes(
  'Windows helper .NET 11 target',
  systemAudioProjectSource,
  '<TargetFramework>net11.0-windows</TargetFramework>',
)
assertIncludes('Windows helper .NET SDK setup', releaseWorkflowSource, 'uses: actions/setup-dotnet@v5')
assertIncludes('Windows helper .NET preview channel', releaseWorkflowSource, "dotnet-version: '11.0.x'")
assertIncludes('Windows helper preview quality', releaseWorkflowSource, 'dotnet-quality: preview')
assertIncludes(
  'Windows helper headless-safe validation',
  systemAudioProgramSource,
  'string.Equals(args[0], "--version",',
)
assertIncludes(
  'Windows helper headless-safe validation',
  ensureBinariesSource,
  "probeBinary(windowsSystemAudioOutputPath, ['--version'])",
)
assertIncludes('Screen recording CFR output', recordingSource, "'-fps_mode'")
assertIncludes('Screen recording CFR output', recordingSource, "'cfr'")
assertIncludes('Screen recording CFR output', recordingSource, 'Screen recording encode config')

console.log('[verify-export-startup] Export startup invariants verified.')
