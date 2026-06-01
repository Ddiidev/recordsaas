import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exportManagerPath = path.join(rootDir, 'electron', 'main', 'features', 'export-manager.ts')
const source = fs.readFileSync(exportManagerPath, 'utf-8')

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

if (source.includes('spawnSync')) {
  fail('export-manager.ts must not use blocking spawnSync during export startup/audio preparation')
}

const registerCancel = indexOf("ipcMain.once('export:cancel', cancellationHandler)")
const firstProgress = indexOf("sendProgressUpdate(0, 'Authorizing export...', true")
const outputDirectoryPreparation = indexOf("const outputDir = path.dirname(outputPath)")
const authorizeExport = indexOf('await authorizeDesktopExport')
const prepareAudioProgress = indexOf("sendProgressUpdate(2, 'Preparing audio...', true")
const reuseOriginalAudio = indexOf('Reusing original recording audio; no recording audio edits detected.')
const processRecordingAudio = indexOf('await renderProcessedAudioFile(recordingPath, recordingSegments, runAuxiliaryFFmpeg)')
const mainFfmpegSpawn = indexOf('ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs)')
const renderReadyRegistration = indexOf("ipcMain.once('render:ready', renderReadyListener)")
const workerLoad = lastIndexOf('createAndLoadRenderWorker()')

assertBefore('cancel registration', registerCancel, 'first progress event', firstProgress)
assertBefore('first progress event', firstProgress, 'output directory preparation', outputDirectoryPreparation)
assertBefore('first progress event', firstProgress, 'authorization', authorizeExport)
assertBefore('authorization', authorizeExport, 'audio preparation', prepareAudioProgress)
assertBefore('audio preparation', prepareAudioProgress, 'main FFmpeg spawn', mainFfmpegSpawn)
assertBefore('recording audio fast path', reuseOriginalAudio, 'recording audio processing fallback', processRecordingAudio)
assertBefore('render:ready listener registration', renderReadyRegistration, 'worker loading', workerLoad)

console.log('[verify-export-startup] Export startup invariants verified.')
