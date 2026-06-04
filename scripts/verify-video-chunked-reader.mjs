import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as MP4BoxModule from 'mp4box'

const TWO_GIB_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
const PROGRESS_INTERVAL_CHUNKS = 32
const READY_TIMEOUT_MS = 5000

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[verify-video-chunked-reader] ${message}`)
  process.exit(1)
}

function formatBytes(bytes) {
  return `${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)`
}

function getNextBufferOffset(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (value && typeof value === 'object') {
    const offset = value.offset
    if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
      return offset
    }
  }
  return null
}

function parseArgs(argv) {
  const args = [...argv]
  const allowSmall = args.includes('--allow-small')
  const filteredArgs = args.filter((arg) => arg !== '--allow-small')
  return {
    videoPath: filteredArgs[0] ? path.resolve(rootDir, filteredArgs[0]) : null,
    allowSmall,
  }
}

const { videoPath, allowSmall } = parseArgs(process.argv.slice(2))

if (!videoPath) {
  console.log('[verify-video-chunked-reader] Skipped. Pass a local MP4 path to validate chunked MP4 parsing.')
  process.exit(0)
}

const MP4Box = MP4BoxModule.default ?? MP4BoxModule
if (!MP4Box?.createFile) {
  fail('MP4Box.createFile is unavailable.')
}

const stat = await fs.stat(videoPath).catch((error) => {
  fail(`Unable to stat video file: ${error instanceof Error ? error.message : String(error)}`)
})

if (!stat.isFile()) {
  fail(`Path is not a file: ${videoPath}`)
}

if (!allowSmall && stat.size <= TWO_GIB_BYTES) {
  fail(`Expected a video larger than 2GiB; got ${formatBytes(stat.size)}.`)
}

const mp4boxfile = MP4Box.createFile()
let readyTrack = null
let sampleCount = 0
let syncSampleCount = 0
let firstSample = null
let pendingExtractionSeekOffset = null

const ready = new Promise((resolve, reject) => {
  mp4boxfile.onReady = (info) => {
    const track = info.videoTracks?.[0]
    if (!track) {
      reject(new Error('No video track found in MP4.'))
      return
    }

    readyTrack = {
      id: track.id,
      codec: track.codec,
      width: track.video?.width ?? null,
      height: track.video?.height ?? null,
      duration: track.duration,
      timescale: track.timescale,
      samples: track.nb_samples,
    }
    console.log(`[verify-video-chunked-reader] MP4Box onReady ${JSON.stringify(readyTrack)}`)
    mp4boxfile.setExtractionOptions(track.id, null, { nbSamples: 1000 })
    mp4boxfile.start()
    if (typeof mp4boxfile.seek === 'function') {
      const seekResult = mp4boxfile.seek(0, true)
      pendingExtractionSeekOffset = getNextBufferOffset(seekResult)
      console.log(`[verify-video-chunked-reader] MP4Box seek ${JSON.stringify(seekResult)}`)
    }
    resolve()
  }
  mp4boxfile.onError = (error) => {
    reject(error)
  }
  mp4boxfile.onSamples = (_id, _user, samples) => {
    sampleCount += samples.length
    for (const sample of samples) {
      if (sample.is_sync || sample.is_rap) {
        syncSampleCount += 1
      }
      if (!firstSample) {
        firstSample = {
          number: sample.number,
          is_sync: sample.is_sync,
          is_rap: sample.is_rap,
          cts: sample.cts,
          dts: sample.dts,
          duration: sample.duration,
          size: sample.size,
          dataBytes: sample.data?.byteLength ?? null,
        }
      }
    }
  }
})

function withTimeout(promise, timeoutMs, message) {
  let timeout
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout)
  })
}

let offset = 0
let chunks = 0
let bytesFetched = 0
const file = await fs.open(videoPath, 'r')

console.log(
  `[verify-video-chunked-reader] Start path=${videoPath} size=${formatBytes(stat.size)} chunkSize=${formatBytes(DEFAULT_CHUNK_SIZE_BYTES)}`,
)

try {
  while (offset < stat.size) {
    const length = Math.min(DEFAULT_CHUNK_SIZE_BYTES, stat.size - offset)
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await file.read(buffer, 0, length, offset)

    if (bytesRead <= 0) {
      break
    }

    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead)
    arrayBuffer.fileStart = offset
    const requestedNextOffset = getNextBufferOffset(mp4boxfile.appendBuffer(arrayBuffer))
    const fallbackNextOffset = offset + bytesRead
    const nextOffset = requestedNextOffset ?? pendingExtractionSeekOffset ?? fallbackNextOffset
    pendingExtractionSeekOffset = null

    bytesFetched += bytesRead
    chunks += 1

    if (chunks === 1 || nextOffset >= stat.size || chunks % PROGRESS_INTERVAL_CHUNKS === 0) {
      console.log(
        `[verify-video-chunked-reader] Progress bytesFetched=${formatBytes(bytesFetched)} chunks=${chunks} nextOffset=${formatBytes(nextOffset)}`,
      )
    }

    offset = nextOffset === offset ? fallbackNextOffset : nextOffset
  }
} finally {
  await file.close()
}

mp4boxfile.flush()
await withTimeout(ready, READY_TIMEOUT_MS, 'Timed out waiting for MP4Box onReady.')

if (!readyTrack) {
  fail('MP4Box did not report a video track.')
}

if (sampleCount <= 0) {
  fail('MP4Box did not extract any video samples.')
}

if (offset !== stat.size) {
  fail(`Chunk pump did not reach EOF. Read ${formatBytes(offset)} of ${formatBytes(stat.size)}.`)
}

if (chunks < 2) {
  fail(`Expected multiple chunks; read ${chunks}.`)
}

console.log(
  `[verify-video-chunked-reader] Success finalOffset=${formatBytes(offset)} bytesFetched=${formatBytes(bytesFetched)} chunks=${chunks} samples=${sampleCount} syncSamples=${syncSampleCount} firstSample=${JSON.stringify(firstSample)}`,
)
