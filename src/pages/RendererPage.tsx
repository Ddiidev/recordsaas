/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { EditorState, EditorActions, CursorTheme, CursorFrame, CursorImageBitmap } from '../types'
import { ExportSettings } from '../components/editor/ExportModal'
import { RESOLUTIONS } from '../lib/constants'
import { drawScene } from '../lib/renderer'
import { prepareCursorBitmaps, mapExportTimeToSourceTime, calculateExportDuration } from '../lib/utils'
import { normalizeMediaPath, toMediaUrl } from '../lib/media-url'
import {
  getTakeScopedZoomRegions,
  mapCompositionTimeToTake,
  mapTakeMetadataToComposition,
  positionTakes,
} from '../lib/takes'
import type { TakeSourceTime } from '../lib/takes'
import type { TakeClip } from '../types'

let rendererReadySignalSent = false

const log = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
}

const RENDER_PROGRESS_IPC_INTERVAL_MS = 250
const RENDER_PROGRESS_IPC_STEP_PERCENT = 0.5
const RENDER_PERF_LOG_INTERVAL_MS = 10_000
const VIDEO_FILE_PUMP_PROGRESS_INTERVAL_CHUNKS = 32
const EXPORT_MEMORY_LIMIT_SETTING_KEY = 'export.memoryLimitPercent'
const DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT = 50
const EXPORT_MEMORY_HARD_CAP_FRACTION = 0.6
const DEFAULT_VIDEO_FILE_CHUNK_SIZE_BYTES = 16 * 1024 * 1024
const MIN_VIDEO_FILE_CHUNK_SIZE_BYTES = 4 * 1024 * 1024
const DEFAULT_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES = 90
const MIN_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES = 4
const DEFAULT_VIDEO_ENCODER_MAX_QUEUE_SIZE = 12
const MIN_VIDEO_ENCODER_MAX_QUEUE_SIZE = 2
const EXPORT_MEMORY_PRESSURE_CHECK_INTERVAL_MS = 500
const EXPORT_MEMORY_PRESSURE_RETRY_MS = 250
const EXPORT_MEMORY_PRESSURE_MAX_WAIT_MS = 15_000
const EXPORT_MEMORY_PRESSURE_PAUSE_FRACTION = 0.98
const EXPORT_MEMORY_PRESSURE_RESUME_FRACTION = 0.9

type RenderStartPayload = {
  projectState: Omit<EditorState, keyof EditorActions>
  exportSettings: ExportSettings
  exportSessionId?: string
}

type VideoFrameProvider = {
  width: number
  height: number
  fps: number | null
  // Returns a caller-owned snapshot. The provider keeps its decode candidates
  // private so another source can advance without invalidating this frame.
  getFrameForTime: (timeSec: number) => Promise<VideoFrame | null>
  close: () => void
}

type ExportBackgroundImage = ImageBitmap
type ExportMemoryBudget = {
  totalMemoryBytes: number | null
  limitPercent: number
  maxBytes: number | null
  chunkSizeBytes: number
  maxBufferedFramesPerProvider: number
  maxDecodeQueueSize: number
  maxEncoderQueueSize: number
}
type ExportMemoryController = {
  waitForBudget: (phase: string) => Promise<void>
}

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const sanitizeExportMemoryLimitPercent = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_EXPORT_MEMORY_LIMIT_PERCENT
  return clampNumber(Math.round(parsed), 10, 100)
}

const estimateFrameBytes = (width: number, height: number): number =>
  Math.max(1, Math.ceil(Math.max(1, width) * Math.max(1, height) * 4))

const formatMemoryBytes = (bytes: number | null): string => {
  if (!bytes || !Number.isFinite(bytes)) return 'unknown'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

const resolveExportMemoryBudget = async (
  outputWidth: number,
  outputHeight: number,
  providerCount: number,
): Promise<ExportMemoryBudget> => {
  const [savedLimitPercent, systemMemoryInfo] = await Promise.all([
    window.electronAPI.getSetting<number>(EXPORT_MEMORY_LIMIT_SETTING_KEY),
    window.electronAPI.getSystemMemoryInfo(),
  ])
  const limitPercent = sanitizeExportMemoryLimitPercent(savedLimitPercent)
  const totalMemoryBytes =
    systemMemoryInfo?.totalMemoryBytes && Number.isFinite(systemMemoryInfo.totalMemoryBytes)
      ? systemMemoryInfo.totalMemoryBytes
      : null

  if (!totalMemoryBytes) {
    return {
      totalMemoryBytes: null,
      limitPercent,
      maxBytes: null,
      chunkSizeBytes: DEFAULT_VIDEO_FILE_CHUNK_SIZE_BYTES,
      maxBufferedFramesPerProvider: DEFAULT_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES,
      maxDecodeQueueSize: DEFAULT_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES,
      maxEncoderQueueSize: DEFAULT_VIDEO_ENCODER_MAX_QUEUE_SIZE,
    }
  }

  const maxBytes = Math.floor(totalMemoryBytes * EXPORT_MEMORY_HARD_CAP_FRACTION * (limitPercent / 100))
  const safeProviderCount = Math.max(1, providerCount)
  const frameBytes = estimateFrameBytes(outputWidth, outputHeight)
  const frameQueueBytes = Math.max(
    frameBytes * safeProviderCount * MIN_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES,
    maxBytes * 0.35,
  )
  const maxBufferedFramesPerProvider = clampNumber(
    Math.floor(frameQueueBytes / (frameBytes * safeProviderCount)),
    MIN_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES,
    DEFAULT_VIDEO_FRAME_PROVIDER_MAX_BUFFERED_FRAMES,
  )
  const encoderQueueBytes = Math.max(frameBytes * MIN_VIDEO_ENCODER_MAX_QUEUE_SIZE, maxBytes * 0.1)
  const maxEncoderQueueSize = clampNumber(
    Math.floor(encoderQueueBytes / frameBytes),
    MIN_VIDEO_ENCODER_MAX_QUEUE_SIZE,
    DEFAULT_VIDEO_ENCODER_MAX_QUEUE_SIZE,
  )
  const chunkSizeBytes = clampNumber(
    Math.floor(maxBytes / 512),
    MIN_VIDEO_FILE_CHUNK_SIZE_BYTES,
    DEFAULT_VIDEO_FILE_CHUNK_SIZE_BYTES,
  )

  return {
    totalMemoryBytes,
    limitPercent,
    maxBytes,
    chunkSizeBytes,
    maxBufferedFramesPerProvider,
    maxDecodeQueueSize: maxBufferedFramesPerProvider,
    maxEncoderQueueSize,
  }
}

const createExportMemoryController = (memoryBudget: ExportMemoryBudget): ExportMemoryController => {
  let lastCheckedAt = 0
  let lastResidentBytes: number | null = null
  let lastPressureLogAt = 0

  const readCurrentResidentBytes = async (force = false): Promise<number | null> => {
    if (!memoryBudget.maxBytes) return null

    const now = performance.now()
    if (!force && lastResidentBytes !== null && now - lastCheckedAt < EXPORT_MEMORY_PRESSURE_CHECK_INTERVAL_MS) {
      return lastResidentBytes
    }

    lastCheckedAt = now
    try {
      const current = await window.electronAPI.getCurrentProcessMemoryInfo()
      const residentKilobytes =
        typeof current?.residentSet === 'number' && current.residentSet > 0 ? current.residentSet : current?.private
      lastResidentBytes =
        typeof residentKilobytes === 'number' && Number.isFinite(residentKilobytes) ? residentKilobytes * 1024 : null
      return lastResidentBytes
    } catch (error) {
      log.warn('[RendererPage] Failed to read renderer process memory info:', error)
      return null
    }
  }

  const waitForBudget = async (phase: string) => {
    if (!memoryBudget.maxBytes) return

    const pauseAtBytes = memoryBudget.maxBytes * EXPORT_MEMORY_PRESSURE_PAUSE_FRACTION
    const resumeAtBytes = memoryBudget.maxBytes * EXPORT_MEMORY_PRESSURE_RESUME_FRACTION
    let currentBytes = await readCurrentResidentBytes()
    if (!currentBytes || currentBytes <= pauseAtBytes) return

    const waitStartedAt = performance.now()
    while (currentBytes > resumeAtBytes) {
      const now = performance.now()
      if (now - lastPressureLogAt >= RENDER_PERF_LOG_INTERVAL_MS) {
        lastPressureLogAt = now
        log.warn(
          `[RendererPage] Export memory pressure phase=${phase} current=${formatMemoryBytes(currentBytes)} budget=${formatMemoryBytes(memoryBudget.maxBytes)} waiting=true`,
        )
      }

      if (now - waitStartedAt >= EXPORT_MEMORY_PRESSURE_MAX_WAIT_MS) {
        throw new Error(
          `Export memory budget exceeded during ${phase}: current=${formatMemoryBytes(currentBytes)}, budget=${formatMemoryBytes(memoryBudget.maxBytes)}. Increase Settings > General > Export RAM Budget or lower export resolution/FPS.`,
        )
      }

      await new Promise((resolve) => setTimeout(resolve, EXPORT_MEMORY_PRESSURE_RETRY_MS))
      currentBytes = await readCurrentResidentBytes(true)
      if (!currentBytes) return
    }
  }

  return { waitForBudget }
}

async function createVideoFrameProvider(
  videoPath: string,
  memoryBudget: ExportMemoryBudget,
  memoryController: ExportMemoryController,
): Promise<VideoFrameProvider> {
  if (!('VideoDecoder' in window)) {
    throw new Error('VideoDecoder is not available in this context.')
  }

  let MP4Box: any
  try {
    const mod: any = await import('mp4box')
    MP4Box = mod?.default ?? mod
  } catch (e) {
    throw new Error('Failed to import mp4box module.')
  }

  if (!MP4Box?.createFile) {
    throw new Error('MP4Box.createFile is unavailable.')
  }

  const mp4boxfile = MP4Box.createFile()
  const normalizedVideoPath = normalizeMediaPath(videoPath)
  const fileStat = await window.electronAPI.statFile(normalizedVideoPath)
  if (!fileStat.isFile) {
    throw new Error(`Video path is not a file: ${normalizedVideoPath}`)
  }

  const fileSize = fileStat.size
  const chunkSize = memoryBudget.chunkSizeBytes
  if (fileSize <= 0) {
    throw new Error(`Video file is empty: ${normalizedVideoPath}`)
  }
  const frameQueue: VideoFrame[] = []
  const waiters: Array<(frame: VideoFrame | null) => void> = []
  const frameDrainWaiters: Array<() => void> = []
  let decoder: any = null
  let timescale = 1
  let sourceWidth = 0
  let sourceHeight = 0
  let sourceFps: number | null = null
  let closed = false
  let pumpError: unknown = null
  let pendingExtractionSeekOffset: number | null = null
  let lastFrame: VideoFrame | null = null
  let nextFrame: VideoFrame | null = null

  const formatBytes = (bytes: number): string => `${bytes} bytes (${(bytes / 1024 / 1024).toFixed(2)} MiB)`

  const toStandaloneArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const arrayBuffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(arrayBuffer).set(bytes)
    return arrayBuffer
  }

  const notifyFrameDrain = () => {
    while (frameDrainWaiters.length > 0) {
      const waiter = frameDrainWaiters.shift()
      if (waiter) waiter()
    }
  }

  const resolvePendingFrameWaiters = () => {
    while (waiters.length > 0) {
      const waiter = waiters.shift()
      if (waiter) waiter(null)
    }
  }

  const asPumpError = (): Error =>
    pumpError instanceof Error ? pumpError : new Error(`MP4 chunk pump failed for ${normalizedVideoPath}.`)

  const throwIfPumpFailed = () => {
    if (pumpError) throw asPumpError()
  }

  const getNextBufferOffset = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value
    }
    if (value && typeof value === 'object') {
      const offset = (value as { offset?: unknown }).offset
      if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
        return offset
      }
    }
    return null
  }

  const buildAvcCRecord = (avcC: any): Uint8Array | undefined => {
    if (!avcC) return undefined
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

  const extractDescriptionFromIsoFile = (isoFile: any, trackId: number): Uint8Array | undefined => {
    try {
      const trak = isoFile?.getTrackById?.(trackId)
      const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]
      if (entry?.avcC) return buildAvcCRecord(entry.avcC)
      if (entry?.hvcC?.data) return new Uint8Array(entry.hvcC.data)
    } catch (e) {
      log.warn('[RendererPage] Failed to extract decoder description from ISOFile:', e)
    }
    return undefined
  }

  const getDecoderDescription = (track: any, isoFile: any): Uint8Array | undefined => {
    const isAvc = typeof track?.codec === 'string' && (track.codec.startsWith('avc1') || track.codec.startsWith('avc3'))
    const isHevc =
      typeof track?.codec === 'string' && (track.codec.startsWith('hvc1') || track.codec.startsWith('hev1'))
    if (!isAvc && !isHevc) return undefined

    const desc =
      track?.avcC ||
      track?.hvcC ||
      track?.description ||
      track?.decoderConfig?.description ||
      track?.sampleDescriptions?.[0]?.avcC ||
      track?.sampleDescriptions?.[0]?.hvcC

    if (!desc) {
      return extractDescriptionFromIsoFile(isoFile, track?.id)
    }

    if (desc instanceof Uint8Array) return desc
    if (desc instanceof ArrayBuffer) return new Uint8Array(desc)
    if (desc?.buffer instanceof ArrayBuffer) return new Uint8Array(desc.buffer)
    if (ArrayBuffer.isView(desc)) return new Uint8Array(desc.buffer)
    if (typeof desc?.data?.length === 'number') return new Uint8Array(desc.data)
    return undefined
  }

  const pushFrame = (frame: VideoFrame) => {
    if (closed) {
      frame.close()
      return
    }

    if (waiters.length > 0) {
      const waiter = waiters.shift()
      if (waiter) waiter(frame)
    } else {
      frameQueue.push(frame)
    }
    notifyFrameDrain()
  }

  const pullFrame = async (): Promise<VideoFrame | null> => {
    throwIfPumpFailed()

    if (frameQueue.length > 0) {
      const frame = frameQueue.shift()!
      notifyFrameDrain()
      return frame
    }

    if (closed) return null

    const frame = await new Promise<VideoFrame | null>((resolve) => {
      waiters.push(resolve)
    })
    throwIfPumpFailed()
    return frame
  }

  let rejectReady: ((reason?: unknown) => void) | null = null
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject
    mp4boxfile.onReady = (info: any) => {
      try {
        const track = info.videoTracks?.[0]
        if (!track) throw new Error('No video track found in MP4')
        timescale = track.timescale || 1
        sourceWidth = track.video?.width || 0
        sourceHeight = track.video?.height || 0
        const durationSeconds = track.duration && track.timescale ? track.duration / track.timescale : 0
        const sampleCount = typeof track.nb_samples === 'number' ? track.nb_samples : 0
        sourceFps = durationSeconds > 0 && sampleCount > 0 ? sampleCount / durationSeconds : null
        log.info(
          `[RendererPage] MP4Box onReady path=${normalizedVideoPath} fileSize=${formatBytes(fileSize)} trackId=${track.id} codec=${track.codec} source=${sourceWidth}x${sourceHeight} fps=${sourceFps ? sourceFps.toFixed(2) : 'unknown'}`,
        )

        decoder = new VideoDecoder({
          output: (frame: VideoFrame) => pushFrame(frame),
          error: (err) => log.error('[RendererPage] VideoDecoder error:', err),
        })

        const description = getDecoderDescription(track, mp4boxfile)
        const isAvc =
          typeof track?.codec === 'string' && (track.codec.startsWith('avc1') || track.codec.startsWith('avc3'))
        const isHevc =
          typeof track?.codec === 'string' && (track.codec.startsWith('hvc1') || track.codec.startsWith('hev1'))
        if ((isAvc || isHevc) && !description) {
          const trackKeys = Object.keys(track || {})
          const sampleDescKeys = Object.keys(track?.sampleDescriptions?.[0] || {})
          throw new Error(
            `Missing codec description (avcC/hvcC). codec=${track.codec}, trackKeys=${trackKeys.join(',')}, sampleDescriptionKeys=${sampleDescKeys.join(',')}`,
          )
        }
        decoder.configure({
          codec: track.codec,
          codedWidth: track.video?.width,
          codedHeight: track.video?.height,
          description,
          hardwareAcceleration: 'prefer-hardware',
        })

        mp4boxfile.setExtractionOptions(track.id, null, { nbSamples: 1 })
        mp4boxfile.start()
        if (typeof mp4boxfile.seek === 'function') {
          const seekResult = mp4boxfile.seek(0, true)
          const seekOffset = getNextBufferOffset(seekResult)
          pendingExtractionSeekOffset = seekOffset
          log.info(
            `[RendererPage] MP4Box extraction seek path=${normalizedVideoPath} offset=${seekOffset ?? 'unknown'} result=${JSON.stringify(seekResult)}`,
          )
        }
        resolve()
      } catch (err) {
        reject(err)
      }
    }

    mp4boxfile.onError = (err: any) => {
      pumpError = err
      reject(err)
    }

    let hasKeyframe = false
    mp4boxfile.onSamples = (id: any, _user: any, samples: any[]) => {
      if (!decoder) return
      let lastReleasedSampleNumber: number | null = null
      for (const sample of samples) {
        if (!hasKeyframe) {
          if (!sample.is_sync) continue
          hasKeyframe = true
        }
        const timestamp = Math.round((sample.cts * 1e6) / timescale)
        const duration = Math.round((sample.duration * 1e6) / timescale)
        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp,
          duration,
          data: sample.data,
        })
        decoder.decode(chunk)
        if (typeof sample.number === 'number' && Number.isFinite(sample.number)) {
          lastReleasedSampleNumber = sample.number
        }
      }
      if (lastReleasedSampleNumber !== null && typeof mp4boxfile.releaseUsedSamples === 'function') {
        mp4boxfile.releaseUsedSamples(id, lastReleasedSampleNumber)
      }
    }
  })

  const waitForDecodeBackpressure = async () => {
    while (
      !closed &&
      (frameQueue.length >= memoryBudget.maxBufferedFramesPerProvider ||
        (decoder?.decodeQueueSize ?? 0) >= memoryBudget.maxDecodeQueueSize)
    ) {
      await new Promise<void>((resolve) => {
        frameDrainWaiters.push(resolve)
      })
    }
  }

  const pumpChunks = async () => {
    let offset = 0
    let chunkCount = 0
    let bytesFetched = 0
    let stoppedByClose = false

    log.info(
      `[RendererPage] MP4 chunk pump started path=${normalizedVideoPath} fileSize=${formatBytes(fileSize)} chunkSize=${formatBytes(chunkSize)}`,
    )

    try {
      while (offset < fileSize && !closed) {
        await memoryController.waitForBudget('mp4-pump')
        await waitForDecodeBackpressure()
        if (closed) break

        const length = Math.min(chunkSize, fileSize - offset)
        const chunk = await window.electronAPI.readFileChunk({
          filePath: normalizedVideoPath,
          offset,
          length,
        })
        if (closed) break
        if (chunk.byteLength === 0) {
          log.warn(
            `[RendererPage] MP4 chunk pump received an empty chunk at offset=${offset} for ${normalizedVideoPath}.`,
          )
          break
        }

        const arrayBuffer = toStandaloneArrayBuffer(chunk)
        ;(arrayBuffer as any).fileStart = offset
        const requestedNextOffset = getNextBufferOffset(mp4boxfile.appendBuffer(arrayBuffer))
        const fallbackNextOffset = offset + chunk.byteLength
        const nextOffset = requestedNextOffset ?? pendingExtractionSeekOffset ?? fallbackNextOffset
        pendingExtractionSeekOffset = null

        bytesFetched += chunk.byteLength
        chunkCount += 1

        if (chunkCount === 1 || nextOffset >= fileSize || chunkCount % VIDEO_FILE_PUMP_PROGRESS_INTERVAL_CHUNKS === 0) {
          log.info(
            `[RendererPage] MP4 chunk pump progress path=${normalizedVideoPath} bytesFetched=${formatBytes(bytesFetched)} chunks=${chunkCount} nextOffset=${formatBytes(nextOffset)}`,
          )
        }

        offset = nextOffset === offset ? fallbackNextOffset : nextOffset
      }

      stoppedByClose = closed

      if (!closed) {
        log.info(
          `[RendererPage] MP4 chunk pump reached EOF path=${normalizedVideoPath} finalOffset=${formatBytes(offset)} bytesFetched=${formatBytes(bytesFetched)} chunks=${chunkCount}`,
        )
        mp4boxfile.flush()
        if (!decoder) {
          throw new Error(`MP4Box did not report a decodable video track before EOF for ${normalizedVideoPath}.`)
        }
        if (decoder && decoder.state !== 'closed') {
          await decoder.flush()
        }
      }
    } catch (error) {
      pumpError = error
      rejectReady?.(error)
      log.warn('[RendererPage] MP4 chunk pump failed:', error)
    } finally {
      closed = true
      resolvePendingFrameWaiters()
      notifyFrameDrain()
      log.info(
        `[RendererPage] MP4 chunk pump finished path=${normalizedVideoPath} finalOffset=${formatBytes(offset)} bytesFetched=${formatBytes(bytesFetched)} chunks=${chunkCount} stoppedByClose=${stoppedByClose} failed=${pumpError ? 'true' : 'false'}`,
      )
    }
  }

  try {
    void pumpChunks()
    await ready
  } catch (e) {
    log.warn('[RendererPage] Failed to initialize MP4Box/VideoDecoder:', e)
    closed = true
    resolvePendingFrameWaiters()
    notifyFrameDrain()
    try {
      decoder?.close()
    } catch {
      /* ignore */
    }
    throw e instanceof Error ? e : new Error('Failed to initialize MP4Box/VideoDecoder.')
  }

  const getFrameForTime = async (timeSec: number): Promise<VideoFrame | null> => {
    throwIfPumpFailed()
    const targetUs = Math.round(timeSec * 1e6)

    if (!nextFrame) {
      nextFrame = await pullFrame()
      throwIfPumpFailed()
    }

    while (nextFrame && (nextFrame.timestamp ?? 0) < targetUs) {
      if (lastFrame && lastFrame !== nextFrame) lastFrame.close()
      lastFrame = nextFrame
      nextFrame = await pullFrame()
      throwIfPumpFailed()
    }

    const cloneFrame = (frame: VideoFrame | null): VideoFrame | null => (frame ? new VideoFrame(frame) : null)

    if (!lastFrame) return cloneFrame(nextFrame)
    if (!nextFrame) return cloneFrame(lastFrame)

    const lastTs = lastFrame.timestamp ?? 0
    const nextTs = nextFrame.timestamp ?? 0
    return cloneFrame(targetUs - lastTs <= nextTs - targetUs ? lastFrame : nextFrame)
  }

  const close = () => {
    closed = true
    while (frameQueue.length > 0) {
      const frame = frameQueue.shift()
      frame?.close()
    }
    resolvePendingFrameWaiters()
    notifyFrameDrain()
    if (lastFrame) lastFrame.close()
    if (nextFrame && nextFrame !== lastFrame) nextFrame.close()
    if (decoder && decoder.state !== 'closed') decoder.close()
    if (typeof mp4boxfile.stop === 'function') mp4boxfile.stop()
  }

  return { width: sourceWidth, height: sourceHeight, fps: sourceFps, getFrameForTime, close }
}

// These are needed to regenerate bitmaps within the renderer worker context.
async function prepareWindowsCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    log.warn(`[RendererPage] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }
  const processingPromises: Promise<void>[] = []
  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]
    processingPromises.push(
      (async () => {
        const idcName = await window.electronAPI.mapCursorNameToIDC(cursorThemeName)
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${idcName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              log.error(`[RendererPage] Failed to create bitmap for ${idcName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }
  await Promise.all(processingPromises)
  return bitmapMap
}

async function prepareMacOSCursorBitmaps(theme: CursorTheme, scale: number): Promise<Map<string, CursorImageBitmap>> {
  const bitmapMap = new Map<string, CursorImageBitmap>()
  const cursorSet = theme[scale]
  if (!cursorSet) {
    log.warn(`[RendererPage] No cursor set found for scale ${scale}x`)
    return bitmapMap
  }
  const processingPromises: Promise<void>[] = []
  for (const cursorThemeName in cursorSet) {
    const frames = cursorSet[cursorThemeName]
    processingPromises.push(
      (async () => {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i] as CursorFrame
          if (frame.rgba && frame.width > 0 && frame.height > 0) {
            try {
              const buffer = new Uint8ClampedArray(Object.values(frame.rgba))
              const imageData = new ImageData(buffer, frame.width, frame.height)
              const bitmap = await createImageBitmap(imageData)
              const key = `${cursorThemeName}-${i}`
              bitmapMap.set(key, { ...frame, imageBitmap: bitmap })
            } catch (e) {
              log.error(`[RendererPage] Failed to create bitmap for ${cursorThemeName}-${i}`, e)
            }
          }
        }
      })(),
    )
  }
  await Promise.all(processingPromises)
  return bitmapMap
}

const shouldFetchUrlAsIs = (url: string) => /^(blob:|data:|https?:|file:)/i.test(url)

// Helper to pre-load an origin-clean image for the renderer worker.
const loadBackgroundImage = async (
  background: EditorState['frameStyles']['background'],
): Promise<ExportBackgroundImage | null> => {
  if ((background.type !== 'image' && background.type !== 'wallpaper') || !background.imageUrl) {
    return null
  }

  if (!('createImageBitmap' in window)) {
    log.warn('[RendererPage] createImageBitmap is unavailable; skipping image background during export.')
    return null
  }

  const finalUrl = shouldFetchUrlAsIs(background.imageUrl) ? background.imageUrl : toMediaUrl(background.imageUrl)
  if (!finalUrl) return null

  try {
    const response = await fetch(finalUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    log.info(`[RendererPage] Loaded origin-clean background image for export: ${finalUrl}`)
    return bitmap
  } catch (error) {
    log.error(`[RendererPage] Failed to load background image for export: ${finalUrl}`, error)
    return null
  }
}

const loadMediaImage = async (path: string): Promise<ImageBitmap | null> => {
  const url = toMediaUrl(path)
  if (!url || !('createImageBitmap' in window)) return null
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return createImageBitmap(await response.blob())
  } catch (error) {
    log.error(`[RendererPage] Failed to load monitor image: ${url}`, error)
    return null
  }
}

export function RendererPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const webcamVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    log.info('[RendererPage] Component mounted. Setting up listeners.')

    const cleanup = window.electronAPI.onRenderStart(
      async ({ projectState, exportSettings, exportSessionId }: RenderStartPayload) => {
        const renderLogPrefix = exportSessionId ? `[RendererPage][${exportSessionId}]` : '[RendererPage]'
        const canvas = canvasRef.current
        const video = videoRef.current
        const webcamVideo = webcamVideoRef.current
        let frameProvider: VideoFrameProvider | null = null
        let webcamFrameProvider: VideoFrameProvider | null = null
        const floatingMonitorFrameProviders = new Map<string, VideoFrameProvider>()
        const takeFrameProviders = new Map<string, Promise<VideoFrameProvider>>()
        const floatingMonitorImages = new Map<string, ImageBitmap>()
        let bgImage: ExportBackgroundImage | null = null

        try {
          log.info(`${renderLogPrefix} Received "render:start" event.`, { exportSettings })
          if (!canvas || !video) throw new Error('Canvas or Video ref is not available.')

          // --- 1. SETUP CANVAS AND CONTEXT ---
          const { resolution } = exportSettings
          const [ratioW, ratioH] = projectState.aspectRatio.split(':').map(Number)
          const baseHeight = RESOLUTIONS[resolution as keyof typeof RESOLUTIONS].height
          let outputWidth = Math.round(baseHeight * (ratioW / ratioH))
          outputWidth = outputWidth % 2 === 0 ? outputWidth : outputWidth + 1
          let outputHeight = baseHeight

          if (exportSettings.adaptiveRender) {
            const adaptiveWidth = exportSettings.effectiveWidth || projectState.videoDimensions.width
            const adaptiveHeight = exportSettings.effectiveHeight || projectState.videoDimensions.height
            if (adaptiveWidth > 0 && adaptiveHeight > 0) {
              outputWidth = adaptiveWidth % 2 === 0 ? adaptiveWidth : adaptiveWidth + 1
              outputHeight = adaptiveHeight % 2 === 0 ? adaptiveHeight : adaptiveHeight + 1
            }
          }

          canvas.width = outputWidth
          canvas.height = outputHeight
          const ctx = canvas.getContext('2d', {
            alpha: false,
            desynchronized: true,
          })
          if (!ctx) throw new Error('Failed to get 2D context from canvas.')

          // --- 2. PREPARE STATE AND ASSETS ---
          useEditorStore.setState(projectState)
          let finalCursorBitmaps = new Map<string, CursorImageBitmap>()
          if (projectState.platform === 'win32' || projectState.platform === 'darwin') {
            if (projectState.cursorTheme) {
              const scale = (await window.electronAPI.getSetting<number>('recorder.cursorScale')) || 2
              log.info(`[RendererPage] Regenerating bitmaps for ${projectState.platform} at scale ${scale}x`)
              if (projectState.platform === 'win32') {
                finalCursorBitmaps = await prepareWindowsCursorBitmaps(projectState.cursorTheme, scale)
              } else {
                finalCursorBitmaps = await prepareMacOSCursorBitmaps(projectState.cursorTheme, scale)
              }
            }
          } else {
            log.info('[RendererPage] Preparing Linux bitmaps from project state.')
            finalCursorBitmaps = await prepareCursorBitmaps(projectState.cursorImages)
          }
          const projectStateWithCursorBitmaps = { ...projectState, cursorBitmapsToRender: finalCursorBitmaps }
          const captureOffsets = projectState.captureSourceOffsetsMs || {
            screen: 0,
            webcam: 0,
            recording: 0,
            systemAudio: 0,
          }
          const sourceOffsetSeconds = (source: 'screen' | 'webcam'): number => {
            const value = captureOffsets[source]
            return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) / 1000 : 0
          }
          const toRecordingSourceTime = (time: number, source: 'screen' | 'webcam') =>
            Math.max(0, time + sourceOffsetSeconds(source))
          const isTakeMode = projectState.takeModeEnabled === true && projectState.takes.length > 0
          const takePositionsById = new Map(
            (isTakeMode ? positionTakes(projectState.takes, projectState.takeTransitions) : []).map((item) => [
              item.take.id,
              item,
            ]),
          )
          bgImage = await loadBackgroundImage(projectState.frameStyles.background)

          // --- 2.5 SETUP VIDEO DECODER (Optimization) ---
          frameProvider = null
          webcamFrameProvider = null
          const isSecure = typeof window !== 'undefined' ? window.isSecureContext : false
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
          const hasVideoDecoder = 'VideoDecoder' in window
          const hasVideoEncoder = 'VideoEncoder' in window
          log.info('[RendererPage] WebCodecs availability', {
            isSecure,
            hasVideoDecoder,
            hasVideoEncoder,
            ua,
          })
          if (!hasVideoDecoder) {
            throw new Error(
              `WebCodecs VideoDecoder is unavailable (secureContext=${isSecure}, hasVideoDecoder=${hasVideoDecoder}, hasVideoEncoder=${hasVideoEncoder}, ua=${ua}). Export requires decoder-only mode.`,
            )
          }
          const hasWebcam = Boolean(
            projectStateWithCursorBitmaps.webcamVideoPath &&
            typeof projectStateWithCursorBitmaps.webcamVideoPath === 'string',
          )
          const floatingMonitorPaths = Object.entries(projectStateWithCursorBitmaps.floatingMonitors || {}).filter(
            ([, monitor]) => typeof monitor.path === 'string' && monitor.path.length > 0 && monitor.kind !== 'image',
          )
          const floatingMonitorImagePaths = Object.entries(projectStateWithCursorBitmaps.floatingMonitors || {}).filter(
            ([, monitor]) => typeof monitor.path === 'string' && monitor.path.length > 0 && monitor.kind === 'image',
          )
          const memoryBudget = await resolveExportMemoryBudget(
            outputWidth,
            outputHeight,
            (isTakeMode ? 2 : 1 + (hasWebcam ? 1 : 0)) + floatingMonitorPaths.length,
          )
          const memoryController = createExportMemoryController(memoryBudget)
          const getTakeProvider = (key: string, mediaPath: string): Promise<VideoFrameProvider> => {
            const existing = takeFrameProviders.get(key)
            if (existing) return existing
            const pending = createVideoFrameProvider(mediaPath, memoryBudget, memoryController)
            takeFrameProviders.set(key, pending)
            return pending
          }
          const resolveTakePath = (take: TakeClip): string => {
            if (take.source.kind === 'recording-screen') return projectStateWithCursorBitmaps.videoPath || ''
            if (take.source.kind === 'recording-webcam') return projectStateWithCursorBitmaps.webcamVideoPath || ''
            return projectStateWithCursorBitmaps.floatingMonitors[take.source.assetId]?.path || ''
          }
          log.info(
            `${renderLogPrefix} Export memory budget: limit=${memoryBudget.limitPercent}% total=${formatMemoryBytes(memoryBudget.totalMemoryBytes)} max=${formatMemoryBytes(memoryBudget.maxBytes)} chunk=${formatMemoryBytes(memoryBudget.chunkSizeBytes)} bufferedFrames=${memoryBudget.maxBufferedFramesPerProvider} decodeQueue=${memoryBudget.maxDecodeQueueSize} encoderQueue=${memoryBudget.maxEncoderQueueSize}`,
          )
          try {
            if (!isTakeMode && projectStateWithCursorBitmaps.videoPath) {
              frameProvider = await createVideoFrameProvider(
                projectStateWithCursorBitmaps.videoPath,
                memoryBudget,
                memoryController,
              )
              if (frameProvider) log.info('[RendererPage] Using WebCodecs VideoDecoder for main video.')
            }
            if (!isTakeMode && hasWebcam) {
              webcamFrameProvider = await createVideoFrameProvider(
                projectStateWithCursorBitmaps.webcamVideoPath!,
                memoryBudget,
                memoryController,
              )
              if (webcamFrameProvider) log.info('[RendererPage] Using WebCodecs VideoDecoder for webcam video.')
            }
            for (const [monitorId, monitor] of floatingMonitorPaths) {
              const provider = await createVideoFrameProvider(monitor.path, memoryBudget, memoryController)
              floatingMonitorFrameProviders.set(monitorId, provider)
            }
            for (const [monitorId, monitor] of floatingMonitorImagePaths) {
              const image = await loadMediaImage(monitor.path)
              if (image) floatingMonitorImages.set(monitorId, image)
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : 'Unknown decoder initialization error'
            throw new Error(
              `Decoder initialization failed (secureContext=${isSecure}, hasVideoDecoder=${hasVideoDecoder}, ua=${ua}): ${msg}`,
            )
          }
          const useDecoder = isTakeMode || Boolean(frameProvider)
          const useWebcamDecoder = Boolean(webcamFrameProvider)
          if (!useDecoder) {
            throw new Error(
              `WebCodecs VideoDecoder is unavailable (secureContext=${isSecure}, hasVideoDecoder=${hasVideoDecoder}, ua=${ua}). Export requires decoder-only mode.`,
            )
          }
          const fps = Math.max(
            1,
            Math.min(
              120,
              Number.isFinite(exportSettings.effectiveFps)
                ? Number(exportSettings.effectiveFps)
                : exportSettings.adaptiveRender && frameProvider?.fps
                  ? frameProvider.fps
                  : exportSettings.fps,
            ),
          )
          log.info(
            `${renderLogPrefix} Effective export settings: adaptive=${exportSettings.adaptiveRender ? 'yes' : 'no'}, output=${outputWidth}x${outputHeight}, fps=${fps.toFixed(3)}`,
          )

          // --- 3. LOAD VIDEO SOURCES ---
          const loadVideo = (videoElement: HTMLVideoElement, source: string, path: string): Promise<void> =>
            new Promise((resolve, reject) => {
              videoElement.onloadedmetadata = () => {
                log.info(`[RendererPage] ${source} metadata loaded.`)
                resolve()
              }
              videoElement.onerror = (e) => reject(new Error(`Failed to load ${source}: ${e}`))
              const mediaUrl = toMediaUrl(path)
              if (!mediaUrl) {
                reject(new Error(`Failed to resolve ${source} media URL from path: ${path}`))
                return
              }
              videoElement.src = mediaUrl
              videoElement.muted = true
              videoElement.load()
            })

          const loadPromises: Promise<void>[] = [
            loadVideo(video, 'Main video', projectStateWithCursorBitmaps.videoPath!),
          ]
          if (hasWebcam && webcamVideo) {
            loadPromises.push(loadVideo(webcamVideo, 'Webcam video', projectStateWithCursorBitmaps.webcamVideoPath!))
          }
          await Promise.all(loadPromises)

          const mainDuration = video.duration || projectState.duration
          const webcamDuration = hasWebcam && webcamVideo ? webcamVideo.duration : 0
          if (hasWebcam) {
            log.info('[RendererPage] Webcam timing sync', {
              mainDuration,
              webcamDuration,
              durationDelta: Math.abs(webcamDuration - mainDuration),
              alignedToSourceTimeline: true,
            })
          }

          // --- 4. CALCULATE EXPORT DURATION AND FRAMES ---
          const effectiveDuration = isTakeMode ? projectState.duration : mainDuration || projectState.duration
          const exportDuration = Math.max(
            0,
            calculateExportDuration(
              effectiveDuration,
              projectState.cutRegions,
              projectState.speedRegions,
              projectState.timelineLanes || [],
            ),
          )
          const totalFrames = Math.floor(exportDuration * fps)
          log.info(
            `[RendererPage] Starting seek-driven rendering. Total frames: ${totalFrames}, Export duration: ${exportDuration.toFixed(2)}s`,
          )
          window.electronAPI.sendRenderDiagnostics({
            event: 'renderer-started',
            exportSessionId,
            metrics: {
              outputWidth,
              outputHeight,
              fps,
              exportDuration: Number(exportDuration.toFixed(3)),
              totalFrames,
              isTakeMode,
              takeCount: projectState.takes.length,
              metadataEventCount: projectState.metadata.length,
              zoomRegionCount: Object.keys(projectState.zoomRegions || {}).length,
              webcamEnabled: hasWebcam,
              webCodecsDecoder: hasVideoDecoder,
              webCodecsEncoder: hasVideoEncoder,
            },
          })

          // --- SETUP ENCODER (Optimization) ---
          let videoEncoder: any = null
          let lastProgress = 0
          let lastProgressLogBucket = -1
          let lastProgressIpcAt = 0
          let lastProgressIpcValue = -1
          const emitRenderProgress = (progress: number, force = false) => {
            const safeProgress = Math.max(0, Math.min(99, Number.isFinite(progress) ? progress : 0))
            const bucket = Math.floor(safeProgress / 5)
            if (bucket !== lastProgressLogBucket || force) {
              lastProgressLogBucket = bucket
              log.info(`${renderLogPrefix}[Progress] Sending export:render-progress ${safeProgress.toFixed(2)}%.`)
            }
            const now = performance.now()
            const shouldSend =
              force ||
              lastProgressIpcAt === 0 ||
              now - lastProgressIpcAt >= RENDER_PROGRESS_IPC_INTERVAL_MS ||
              Math.abs(safeProgress - lastProgressIpcValue) >= RENDER_PROGRESS_IPC_STEP_PERCENT
            if (!shouldSend) return
            lastProgressIpcAt = now
            lastProgressIpcValue = safeProgress
            window.electronAPI.sendRenderProgress({ progress: safeProgress })
          }
          const useHardwareEncoding = exportSettings.format === 'mp4' && 'VideoEncoder' in window

          if (useHardwareEncoding) {
            log.info('[RendererPage] Initializing hardware encoder (VideoEncoder)')

            const calculateBitrate = (res: string, qual: string, f: number, profile: 'high' | 'baseline') => {
              const baseBitrates: Record<string, number> = {
                '720p': 5_000_000,
                '1080p': 8_000_000,
                '2k': 14_000_000,
              }
              const qualityMultipliers: Record<string, number> = {
                low: 0.6,
                medium: 1.0,
                high: 2.0, // Significant boost for high quality
                'ultra high': 2.0, // Same bitrate as high, difference is in imageSmoothingQuality
              }
              const fpsMultiplier = f >= 60 ? 1.4 : 1.0 // Higher FPS needs more data
              const codecPenalty = profile === 'baseline' ? 1.3 : 1.0 // Baseline needs more bitrate than High profile

              const base = baseBitrates[res] || 8_000_000
              const qualMult = qualityMultipliers[qual] || 1.0

              return Math.floor(base * qualMult * fpsMultiplier * codecPenalty)
            }

            const bitrateResolution =
              outputHeight > 1080
                ? '2k'
                : outputHeight > 720
                  ? '1080p'
                  : outputHeight > 576
                    ? '720p'
                    : outputHeight > 480
                      ? '576p'
                      : '480p'
            const highProfileBitrate = calculateBitrate(bitrateResolution, exportSettings.quality, fps, 'high')
            const baselineBitrate = calculateBitrate(bitrateResolution, exportSettings.quality, fps, 'baseline')
            const encoderConfigCandidates = [
              {
                codec: 'avc1.420033', // H.264 Baseline Profile Level 5.1
                width: outputWidth,
                height: outputHeight,
                bitrate: baselineBitrate,
                framerate: fps,
                avc: { format: 'annexb' },
                hardwareAcceleration: 'prefer-hardware',
              },
              {
                codec: 'avc1.640033', // H.264 High Profile Level 5.1
                width: outputWidth,
                height: outputHeight,
                bitrate: highProfileBitrate,
                framerate: fps,
                avc: { format: 'annexb' },
                hardwareAcceleration: 'prefer-hardware',
              },
            ]
            let selectedEncoderConfig = encoderConfigCandidates[encoderConfigCandidates.length - 1]
            for (const candidate of encoderConfigCandidates) {
              const support =
                typeof (window as any).VideoEncoder.isConfigSupported === 'function'
                  ? await (window as any).VideoEncoder.isConfigSupported(candidate)
                  : { supported: true }
              if (support?.supported) {
                selectedEncoderConfig = support.config ?? candidate
                break
              }
            }
            log.info(
              `[RendererPage] Configured encoder: codec=${selectedEncoderConfig.codec}, bitrate=${(selectedEncoderConfig.bitrate / 1_000_000).toFixed(2)} Mbps`,
            )

            videoEncoder = new (window as any).VideoEncoder({
              output: (chunk: any) => {
                const buffer = new ArrayBuffer(chunk.byteLength)
                chunk.copyTo(buffer)
                window.electronAPI.sendFrameToMain({ frame: Buffer.from(buffer), progress: lastProgress })
              },
              error: (e: any) => log.error('[RendererPage] Encoder error:', e),
            })

            videoEncoder.configure(selectedEncoderConfig)
          }
          const keyFrameIntervalFrames = Math.max(1, Math.round(fps * 2))

          const perfStats = {
            startedAt: performance.now(),
            lastLoggedAt: performance.now(),
            frames: 0,
            waitMs: 0,
            mainDecodeMs: 0,
            webcamDecodeMs: 0,
            drawMs: 0,
            encodeMs: 0,
            totalMs: 0,
          }

          for (let frame = 0; frame < totalFrames; frame++) {
            const frameStartedAt = performance.now()
            await memoryController.waitForBudget('render-loop')
            // Backpressure handling using MessageChannel for sub-millisecond polling
            // (setTimeout has ~15ms minimum resolution on Windows)
            if (videoEncoder && videoEncoder.encodeQueueSize > memoryBudget.maxEncoderQueueSize) {
              const waitStartedAt = performance.now()
              await new Promise<void>((resolve) => {
                const ch = new MessageChannel()
                ch.port1.onmessage = () => {
                  if (videoEncoder.encodeQueueSize <= memoryBudget.maxEncoderQueueSize) {
                    ch.port1.close()
                    resolve()
                  } else {
                    ch.port2.postMessage(null)
                  }
                }
                ch.port2.postMessage(null)
              })
              perfStats.waitMs += performance.now() - waitStartedAt
            }

            lastProgress = Math.min(99, ((frame + 1) / totalFrames) * 100)
            emitRenderProgress(lastProgress, frame + 1 === totalFrames)
            const exportTimestamp = frame / fps
            const sourceTimestamp = mapExportTimeToSourceTime(
              exportTimestamp,
              effectiveDuration,
              projectState.cutRegions,
              projectState.speedRegions,
              projectState.timelineLanes || [],
            )

            let mainFrame: VideoFrame | null = null
            let webcamFrame: VideoFrame | null = null
            const floatingMonitorFrames: Record<string, { source: CanvasImageSource; width: number; height: number }> =
              {}

            const takeMapping = isTakeMode
              ? mapCompositionTimeToTake(sourceTimestamp, projectState.takes, projectState.takeTransitions)
              : null

            if (!isTakeMode && useDecoder && frameProvider) {
              const mainDecodeStartedAt = performance.now()
              mainFrame = await frameProvider.getFrameForTime(toRecordingSourceTime(sourceTimestamp, 'screen'))
              perfStats.mainDecodeMs += performance.now() - mainDecodeStartedAt
            } else if (!isTakeMode) {
              throw new Error('Decoder-only mode: main video decoder not available.')
            }

            if (!isTakeMode && hasWebcam && webcamVideo) {
              const webcamTimestamp = toRecordingSourceTime(sourceTimestamp, 'webcam')
              if (useWebcamDecoder && webcamFrameProvider) {
                const webcamDecodeStartedAt = performance.now()
                webcamFrame = await webcamFrameProvider.getFrameForTime(webcamTimestamp)
                perfStats.webcamDecodeMs += performance.now() - webcamDecodeStartedAt
              } else {
                throw new Error('Decoder-only mode: webcam decoder not available.')
              }
            }

            const activeFloatingMonitorSources = new Map<string, { monitorId: string; time: number }>()
            const collectActiveFloatingMonitorSources = (
              regions: typeof projectStateWithCursorBitmaps.floatingMonitorRegions,
              playbackTime: number,
              ancestry = new Set<string>(),
              sourcePath = 'main',
            ) => {
              Object.values(regions || {}).forEach((region) => {
                if (playbackTime < region.startTime || playbackTime >= region.startTime + region.duration) return
                const monitor = projectStateWithCursorBitmaps.floatingMonitors[region.monitorId]
                if (!monitor || ancestry.has(monitor.id)) return
                const monitorTime = Math.max(0, region.sourceStart + playbackTime - region.startTime)
                const sourceKey = `${sourcePath}/${region.id}`
                activeFloatingMonitorSources.set(sourceKey, { monitorId: region.monitorId, time: monitorTime })
                if (monitor.timeline?.floatingMonitorRegions) {
                  const nextAncestry = new Set(ancestry)
                  nextAncestry.add(monitor.id)
                  collectActiveFloatingMonitorSources(
                    monitor.timeline.floatingMonitorRegions,
                    monitorTime,
                    nextAncestry,
                    sourceKey,
                  )
                }
              })
            }
            collectActiveFloatingMonitorSources(projectStateWithCursorBitmaps.floatingMonitorRegions, sourceTimestamp)
            for (const [regionId, sourceInstance] of activeFloatingMonitorSources.entries()) {
              const { monitorId, time: monitorTime } = sourceInstance
              const image = floatingMonitorImages.get(monitorId)
              if (image) {
                floatingMonitorFrames[regionId] = { source: image, width: image.width, height: image.height }
                return
              }
              const provider = floatingMonitorFrameProviders.get(monitorId)
              if (!provider || floatingMonitorFrames[regionId]) return
              const monitorFrame = await provider.getFrameForTime(monitorTime)
              if (!monitorFrame) return
              floatingMonitorFrames[regionId] = {
                source: monitorFrame,
                width: monitorFrame.displayWidth || monitorFrame.codedWidth,
                height: monitorFrame.displayHeight || monitorFrame.codedHeight,
              }
            }

            if (!isTakeMode && !mainFrame) {
              throw new Error('No decoded frame available for main video.')
            }

            const webcamFrameToUse = webcamFrame

            // Now that videos are at the correct time, draw the scene
            const drawStartedAt = performance.now()
            const webcamFrameDimensions = webcamFrame
              ? {
                  width: (webcamFrame as any).displayWidth || (webcamFrame as any).codedWidth,
                  height: (webcamFrame as any).displayHeight || (webcamFrame as any).codedHeight,
                }
              : undefined

            if (isTakeMode) {
              if (!takeMapping) throw new Error('Take composition has no active source.')
              const renderTakeSource = async (source: TakeSourceTime): Promise<HTMLCanvasElement> => {
                const takePath = resolveTakePath(source.take)
                if (!takePath) throw new Error(`Missing media source for take ${source.take.id}.`)
                const provider = await getTakeProvider(`take:${source.take.id}`, takePath)
                const takeSourceTime =
                  source.take.source.kind === 'recording-screen'
                    ? toRecordingSourceTime(source.sourceTime, 'screen')
                    : source.take.source.kind === 'recording-webcam'
                      ? toRecordingSourceTime(source.sourceTime, 'webcam')
                      : source.sourceTime
                const webcamProvider =
                  source.take.source.kind === 'recording-screen' && hasWebcam
                    ? await getTakeProvider(
                        `take:${source.take.id}:webcam`,
                        projectStateWithCursorBitmaps.webcamVideoPath!,
                      )
                    : null
                const webcamSourceTime = toRecordingSourceTime(source.sourceTime, 'webcam')
                const [takeFrame, takeWebcamFrame] = await Promise.all([
                  provider.getFrameForTime(takeSourceTime),
                  webcamProvider?.getFrameForTime(webcamSourceTime) ?? Promise.resolve(null),
                ])
                if (!takeFrame) throw new Error(`No decoded frame available for take ${source.take.id}.`)
                const takeCanvas = document.createElement('canvas')
                takeCanvas.width = outputWidth
                takeCanvas.height = outputHeight
                const takeContext = takeCanvas.getContext('2d', { alpha: false })
                if (!takeContext) throw new Error('Failed to create take transition canvas.')
                const isFullFrame = source.take.source.kind !== 'recording-screen'
                const takePosition = takePositionsById.get(source.take.id)
                const takeEffects = takePosition
                  ? {
                      zoomRegions: getTakeScopedZoomRegions(projectStateWithCursorBitmaps.zoomRegions, source.take.id),
                      metadata: mapTakeMetadataToComposition(
                        projectStateWithCursorBitmaps.metadata,
                        source.take,
                        takePosition.start,
                      ),
                    }
                  : { zoomRegions: projectStateWithCursorBitmaps.zoomRegions, metadata: [] }
                const takeState = isFullFrame
                  ? {
                      ...projectStateWithCursorBitmaps,
                      ...takeEffects,
                      cursorRegions: {},
                      webcamRegions: {},
                      swapRegions: {},
                      cursorStyles: {
                        ...projectStateWithCursorBitmaps.cursorStyles,
                        showCursor: false,
                        clickRippleEffect: false,
                        clickScaleEffect: false,
                      },
                    }
                  : { ...projectStateWithCursorBitmaps, ...takeEffects }
                try {
                  await drawScene(
                    takeContext,
                    takeState,
                    takeFrame,
                    takeWebcamFrame,
                    sourceTimestamp,
                    outputWidth,
                    outputHeight,
                    bgImage,
                    takeWebcamFrame
                      ? {
                          width: takeWebcamFrame.displayWidth || takeWebcamFrame.codedWidth,
                          height: takeWebcamFrame.displayHeight || takeWebcamFrame.codedHeight,
                        }
                      : undefined,
                    exportSettings.quality,
                    floatingMonitorFrames,
                  )
                } finally {
                  takeFrame.close()
                  takeWebcamFrame?.close()
                }
                return takeCanvas
              }
              const primaryCanvas = await renderTakeSource(takeMapping.primary)
              if (!takeMapping.secondary || !takeMapping.transition) {
                ctx.drawImage(primaryCanvas, 0, 0)
              } else {
                const secondaryCanvas = await renderTakeSource(takeMapping.secondary)
                const progress = takeMapping.transitionProgress
                ctx.save()
                if (takeMapping.transition.type === 'dip-black') {
                  ctx.drawImage(progress < 0.5 ? primaryCanvas : secondaryCanvas, 0, 0)
                  ctx.fillStyle = `rgba(0,0,0,${1 - Math.abs(progress * 2 - 1)})`
                  ctx.fillRect(0, 0, outputWidth, outputHeight)
                } else if (
                  takeMapping.transition.type === 'slide-left' ||
                  takeMapping.transition.type === 'slide-right'
                ) {
                  const direction = takeMapping.transition.type === 'slide-left' ? -1 : 1
                  ctx.drawImage(primaryCanvas, direction * progress * outputWidth, 0)
                  ctx.drawImage(secondaryCanvas, direction * (progress - 1) * outputWidth, 0)
                } else if (takeMapping.transition.type === 'zoom') {
                  ctx.drawImage(primaryCanvas, 0, 0)
                  const scale = 0.85 + progress * 0.15
                  const width = outputWidth * scale
                  const height = outputHeight * scale
                  ctx.globalAlpha = progress
                  ctx.drawImage(secondaryCanvas, (outputWidth - width) / 2, (outputHeight - height) / 2, width, height)
                } else {
                  ctx.drawImage(primaryCanvas, 0, 0)
                  ctx.globalAlpha = progress
                  ctx.drawImage(secondaryCanvas, 0, 0)
                }
                ctx.restore()
              }
            } else {
              await drawScene(
                ctx,
                projectStateWithCursorBitmaps,
                mainFrame!,
                webcamFrameToUse,
                sourceTimestamp,
                outputWidth,
                outputHeight,
                bgImage,
                webcamFrameDimensions,
                exportSettings.quality,
                floatingMonitorFrames,
              )
            }
            mainFrame?.close()
            webcamFrame?.close()
            Object.values(floatingMonitorFrames).forEach(({ source }) => {
              if (source instanceof VideoFrame) source.close()
            })
            perfStats.drawMs += performance.now() - drawStartedAt

            if (videoEncoder) {
              const encodeStartedAt = performance.now()
              const timestamp = (frame / fps) * 1e6
              const vFrame = new VideoFrame(canvas, { timestamp })
              const keyFrame = frame % keyFrameIntervalFrames === 0
              videoEncoder.encode(vFrame, { keyFrame })
              vFrame.close()
              perfStats.encodeMs += performance.now() - encodeStartedAt
            } else {
              // Send the rendered frame to the main process
              const encodeStartedAt = performance.now()
              const imageData = ctx.getImageData(0, 0, outputWidth, outputHeight)
              const frameBuffer = Buffer.from(imageData.data.buffer)
              const progress = Math.min(99, ((frame + 1) / totalFrames) * 100)
              window.electronAPI.sendFrameToMain({ frame: frameBuffer, progress })
              perfStats.encodeMs += performance.now() - encodeStartedAt
            }

            perfStats.frames += 1
            const now = performance.now()
            perfStats.totalMs += now - frameStartedAt
            if (now - perfStats.lastLoggedAt >= RENDER_PERF_LOG_INTERVAL_MS || frame + 1 === totalFrames) {
              const elapsedSec = Math.max(0.001, (now - perfStats.startedAt) / 1000)
              const frames = Math.max(1, perfStats.frames)
              const perfPayload = {
                frame: frame + 1,
                totalFrames,
                fps: Number((perfStats.frames / elapsedSec).toFixed(2)),
                progress: Number(lastProgress.toFixed(2)),
                avgMs: {
                  backpressure: Number((perfStats.waitMs / frames).toFixed(3)),
                  mainDecode: Number((perfStats.mainDecodeMs / frames).toFixed(3)),
                  webcamDecode: Number((perfStats.webcamDecodeMs / frames).toFixed(3)),
                  draw: Number((perfStats.drawMs / frames).toFixed(3)),
                  encode: Number((perfStats.encodeMs / frames).toFixed(3)),
                  totalLoop: Number((perfStats.totalMs / frames).toFixed(3)),
                },
                encodeQueueSize: videoEncoder?.encodeQueueSize ?? 0,
              }
              log.info(`${renderLogPrefix}[Perf] Render loop metrics: ${JSON.stringify(perfPayload)}`)
              window.electronAPI.sendRenderDiagnostics({
                event: 'renderer-perf',
                exportSessionId,
                metrics: perfPayload,
              })
              perfStats.lastLoggedAt = now
            }
          }

          if (videoEncoder) {
            await videoEncoder.flush()
          }

          window.electronAPI.sendRenderDiagnostics({
            event: 'renderer-finished',
            exportSessionId,
            metrics: {
              elapsedMs: Number((performance.now() - perfStats.startedAt).toFixed(3)),
              renderedFrames: perfStats.frames,
              totalFrames,
            },
          })

          // --- 6. FINISH ---
          log.info('[RendererPage] Render loop finished. Sending "finishRender" signal.')
          window.electronAPI.finishRender()
          bgImage?.close()
          if (frameProvider) frameProvider.close()
          if (webcamFrameProvider) webcamFrameProvider.close()
          for (const provider of await Promise.all(takeFrameProviders.values())) provider.close()
          floatingMonitorFrameProviders.forEach((provider) => provider.close())
          floatingMonitorImages.forEach((image) => image.close())
        } catch (error) {
          log.error('[RendererPage] CRITICAL ERROR during render process:', error)
          bgImage?.close()
          if (frameProvider) frameProvider.close()
          if (webcamFrameProvider) webcamFrameProvider.close()
          for (const provider of await Promise.allSettled(takeFrameProviders.values())) {
            if (provider.status === 'fulfilled') provider.value.close()
          }
          floatingMonitorFrameProviders.forEach((provider) => provider.close())
          floatingMonitorImages.forEach((image) => image.close())
          const message = error instanceof Error ? error.message : 'Unknown render error'
          window.electronAPI.sendRenderDiagnostics({
            event: 'renderer-error',
            exportSessionId,
            metrics: { error: message },
          })
          window.electronAPI.sendRenderError({ error: message })
        }
      },
    )

    if (!rendererReadySignalSent) {
      rendererReadySignalSent = true
      log.info('[RendererPage] Sending "render:ready" signal to main process.')
      window.electronAPI.rendererReady()
    } else {
      log.info('[RendererPage] render:ready signal already sent for this worker.')
    }

    return () => {
      log.info('[RendererPage] Component unmounted. Cleaning up listener.')
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  return (
    <div>
      <h1>Renderer Worker</h1>
      <p>This page is hidden and used for video exporting.</p>
      <canvas ref={canvasRef}></canvas>
      <video ref={videoRef} style={{ display: 'none' }}></video>
      <video ref={webcamVideoRef} style={{ display: 'none' }}></video>
    </div>
  )
}
