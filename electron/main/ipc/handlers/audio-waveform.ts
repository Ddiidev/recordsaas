import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { getFFmpegPath } from '../../lib/utils'
import { normalizeMediaPath } from '../../lib/media-url'

const WAVEFORM_SAMPLE_RATE = 1200
const SAMPLES_PER_PEAK = 100
const MAX_PEAKS = 36_000

export type AudioWaveformResult = {
  peaks: number[]
  peaksPerSecond: number
}

export async function handleBuildAudioWaveform(
  _event: unknown,
  filePath: string | null | undefined,
): Promise<AudioWaveformResult> {
  const normalizedPath = normalizeMediaPath(filePath)
  if (!normalizedPath) throw new Error('Audio source path is required.')

  const stats = await fs.stat(normalizedPath)
  if (!stats.isFile()) throw new Error('Audio source is not a file.')

  return new Promise((resolve, reject) => {
    const peaks: number[] = []
    let peak = 0
    let samplesInPeak = 0
    let trailing: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr = ''
    const ffmpeg = spawn(
      getFFmpegPath(),
      [
        '-v',
        'error',
        '-i',
        normalizedPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(WAVEFORM_SAMPLE_RATE),
        '-f',
        'f32le',
        'pipe:1',
      ],
      { windowsHide: true },
    )

    const appendPeak = () => {
      if (samplesInPeak === 0 || peaks.length >= MAX_PEAKS) return
      peaks.push(Math.max(0, Math.min(1, peak)))
      peak = 0
      samplesInPeak = 0
    }

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      const data = trailing.length > 0 ? Buffer.concat([trailing, chunk]) : chunk
      const completeLength = data.length - (data.length % 4)
      for (let offset = 0; offset < completeLength && peaks.length < MAX_PEAKS; offset += 4) {
        peak = Math.max(peak, Math.abs(data.readFloatLE(offset)))
        samplesInPeak += 1
        if (samplesInPeak === SAMPLES_PER_PEAK) appendPeak()
      }
      trailing = completeLength === data.length ? Buffer.alloc(0) : data.subarray(completeLength)
    })
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_000)
    })
    ffmpeg.once('error', reject)
    ffmpeg.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `FFmpeg waveform extraction exited with code ${code ?? 'unknown'}.`))
        return
      }
      appendPeak()
      resolve({ peaks, peaksPerSecond: WAVEFORM_SAMPLE_RATE / SAMPLES_PER_PEAK })
    })
  })
}
