const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const MP4BoxModule = require('mp4box')

const DEFAULT_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
const MAX_DECODE_SAMPLES = 8

const MP4Box = MP4BoxModule.default ?? MP4BoxModule

function fail(message) {
  console.error(`[verify-webcodecs-decode] ${message}`)
  process.exitCode = 1
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

function buildAvcCRecord(avcC) {
  if (!avcC) return null
  const spsList = Array.isArray(avcC.SPS) ? avcC.SPS : []
  const ppsList = Array.isArray(avcC.PPS) ? avcC.PPS : []
  const ext = avcC.ext instanceof Uint8Array ? avcC.ext : undefined

  let size = 6 + 1
  for (const sps of spsList) size += 2 + (sps?.data?.length || 0)
  size += 1
  for (const pps of ppsList) size += 2 + (pps?.data?.length || 0)
  if (ext) size += ext.length

  const out = new Uint8Array(size)
  let offset = 0
  out[offset++] = avcC.configurationVersion ?? 1
  out[offset++] = avcC.AVCProfileIndication ?? 0
  out[offset++] = avcC.profile_compatibility ?? 0
  out[offset++] = avcC.AVCLevelIndication ?? 0
  out[offset++] = 0xfc | (avcC.lengthSizeMinusOne ?? 3)
  out[offset++] = 0xe0 | (avcC.nb_SPS_nalus ?? spsList.length)
  for (const sps of spsList) {
    const data = sps?.data || new Uint8Array()
    out[offset++] = (data.length >> 8) & 0xff
    out[offset++] = data.length & 0xff
    out.set(data, offset)
    offset += data.length
  }
  out[offset++] = avcC.nb_PPS_nalus ?? ppsList.length
  for (const pps of ppsList) {
    const data = pps?.data || new Uint8Array()
    out[offset++] = (data.length >> 8) & 0xff
    out[offset++] = data.length & 0xff
    out.set(data, offset)
    offset += data.length
  }
  if (ext) {
    out.set(ext, offset)
  }
  return out
}

function getDecoderDescription(track, mp4boxfile) {
  const desc =
    track?.avcC ||
    track?.hvcC ||
    track?.description ||
    track?.decoderConfig?.description ||
    track?.sampleDescriptions?.[0]?.avcC ||
    track?.sampleDescriptions?.[0]?.hvcC

  if (desc instanceof Uint8Array) return desc
  if (desc instanceof ArrayBuffer) return new Uint8Array(desc)
  if (desc?.buffer instanceof ArrayBuffer) return new Uint8Array(desc.buffer)
  if (ArrayBuffer.isView(desc)) return new Uint8Array(desc.buffer)
  if (typeof desc?.data?.length === 'number') return new Uint8Array(desc.data)

  const trak = mp4boxfile?.getTrackById?.(track?.id)
  const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]
  if (entry?.avcC) return buildAvcCRecord(entry.avcC)
  if (entry?.hvcC?.data) return new Uint8Array(entry.hvcC.data)
  return null
}

function parseArgs(argv) {
  const filteredArgs = argv.filter((arg) => arg !== '--allow-small')
  return {
    videoPath: filteredArgs[0] ? path.resolve(filteredArgs[0]) : null,
  }
}

async function extractDecodePayload(videoPath) {
  const stat = await fs.stat(videoPath)
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${videoPath}`)
  }

  const mp4boxfile = MP4Box.createFile()
  let pendingExtractionSeekOffset = null
  let readyTrack = null
  let description = null
  let hasKeyframe = false
  const samples = []

  const ready = new Promise((resolve, reject) => {
    mp4boxfile.onReady = (info) => {
      const track = info.videoTracks?.[0]
      if (!track) {
        reject(new Error('No video track found in MP4.'))
        return
      }

      description = getDecoderDescription(track, mp4boxfile)
      if (!description) {
        reject(new Error(`Missing decoder description for codec=${track.codec}.`))
        return
      }

      readyTrack = {
        id: track.id,
        codec: track.codec,
        width: track.video?.width ?? null,
        height: track.video?.height ?? null,
        duration: track.duration,
        timescale: track.timescale,
        sampleCount: track.nb_samples,
      }

      mp4boxfile.setExtractionOptions(track.id, null, { nbSamples: MAX_DECODE_SAMPLES })
      mp4boxfile.start()
      pendingExtractionSeekOffset = getNextBufferOffset(mp4boxfile.seek(0, true))
      resolve()
    }
    mp4boxfile.onError = reject
    mp4boxfile.onSamples = (_id, _user, extractedSamples) => {
      for (const sample of extractedSamples) {
        if (!hasKeyframe) {
          if (!sample.is_sync && !sample.is_rap) continue
          hasKeyframe = true
        }
        if (samples.length >= MAX_DECODE_SAMPLES) break
        samples.push({
          type: sample.is_sync || sample.is_rap ? 'key' : 'delta',
          timestamp: Math.round((sample.cts * 1e6) / sample.timescale),
          duration: Math.round((sample.duration * 1e6) / sample.timescale),
          data: Buffer.from(sample.data).toString('base64'),
        })
      }
    }
  })

  const file = await fs.open(videoPath, 'r')
  let offset = 0
  let chunks = 0
  let bytesFetched = 0

  try {
    while (offset < stat.size && samples.length < MAX_DECODE_SAMPLES) {
      const length = Math.min(DEFAULT_CHUNK_SIZE_BYTES, stat.size - offset)
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      if (bytesRead <= 0) break

      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead)
      arrayBuffer.fileStart = offset
      const requestedNextOffset = getNextBufferOffset(mp4boxfile.appendBuffer(arrayBuffer))
      const fallbackNextOffset = offset + bytesRead
      const nextOffset = requestedNextOffset ?? pendingExtractionSeekOffset ?? fallbackNextOffset
      pendingExtractionSeekOffset = null

      chunks += 1
      bytesFetched += bytesRead
      offset = nextOffset === offset ? fallbackNextOffset : nextOffset
    }
  } finally {
    await file.close()
  }

  await ready
  if (samples.length <= 0) {
    throw new Error('MP4Box did not extract any samples for WebCodecs.')
  }

  return {
    videoPath,
    fileSize: stat.size,
    chunks,
    bytesFetched,
    track: readyTrack,
    description: Buffer.from(description).toString('base64'),
    samples,
  }
}

async function createDecodePage() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><title>RecordSaaS WebCodecs Decode Check</title><body>decode-check</body>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const window = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  await window.loadURL(`http://127.0.0.1:${server.address().port}/`)
  return { server, window }
}

async function decodeInRenderer(window, payload) {
  const script = `
    (async () => {
      const payload = ${JSON.stringify(payload)};
      const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
      const result = {
        secureContext: window.isSecureContext,
        hasVideoDecoder: 'VideoDecoder' in window,
        hasEncodedVideoChunk: 'EncodedVideoChunk' in window,
        frames: [],
        decoderErrors: [],
        support: null,
      };

      if (!result.hasVideoDecoder || !result.hasEncodedVideoChunk) {
        return result;
      }

      const config = {
        codec: payload.track.codec,
        codedWidth: payload.track.width,
        codedHeight: payload.track.height,
        description: fromBase64(payload.description),
        hardwareAcceleration: 'prefer-hardware',
      };

      if (typeof VideoDecoder.isConfigSupported === 'function') {
        result.support = await VideoDecoder.isConfigSupported(config);
        if (!result.support?.supported) {
          return result;
        }
      }

      const decoder = new VideoDecoder({
        output: (frame) => {
          result.frames.push({
            timestamp: frame.timestamp,
            codedWidth: frame.codedWidth,
            codedHeight: frame.codedHeight,
            displayWidth: frame.displayWidth,
            displayHeight: frame.displayHeight,
          });
          frame.close();
        },
        error: (error) => {
          result.decoderErrors.push(error?.message || String(error));
        },
      });

      decoder.configure(config);
      for (const sample of payload.samples) {
        decoder.decode(new EncodedVideoChunk({
          type: sample.type,
          timestamp: sample.timestamp,
          duration: sample.duration,
          data: fromBase64(sample.data),
        }));
      }
      await decoder.flush();
      decoder.close();
      return result;
    })()
  `
  return window.webContents.executeJavaScript(script, true)
}

async function main() {
  const { videoPath } = parseArgs(process.argv.slice(2))
  if (!videoPath) {
    console.log('[verify-webcodecs-decode] Skipped. Pass a local MP4 path to validate WebCodecs decoding.')
    return
  }

  const payload = await extractDecodePayload(videoPath)
  console.log(
    `[verify-webcodecs-decode] MP4 samples ready path=${payload.videoPath} size=${formatBytes(payload.fileSize)} chunks=${payload.chunks} bytesFetched=${formatBytes(payload.bytesFetched)} samples=${payload.samples.length} codec=${payload.track.codec}`,
  )

  await app.whenReady()
  const { server, window } = await createDecodePage()
  try {
    const result = await decodeInRenderer(window, payload)
    console.log(`[verify-webcodecs-decode] Decode result ${JSON.stringify(result)}`)

    if (!result.secureContext || !result.hasVideoDecoder || !result.hasEncodedVideoChunk) {
      throw new Error('WebCodecs is unavailable in the Electron renderer verification window.')
    }
    if (result.support && !result.support.supported) {
      throw new Error(`VideoDecoder config is unsupported: ${JSON.stringify(result.support)}`)
    }
    if (result.decoderErrors.length > 0) {
      throw new Error(`VideoDecoder reported errors: ${result.decoderErrors.join('; ')}`)
    }
    if (result.frames.length <= 0) {
      throw new Error('VideoDecoder did not output any frames.')
    }

    const firstFrame = result.frames[0]
    console.log(
      `[verify-webcodecs-decode] Success frames=${result.frames.length} firstFrame=${JSON.stringify(firstFrame)}`,
    )
  } finally {
    window.destroy()
    server.close()
  }
}

main()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error))
  })
  .finally(() => {
    app.quit()
  })
