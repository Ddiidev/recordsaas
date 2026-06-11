import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const defaultLogPath = path.join(rootDir, 'recordsaas-main.log')
const logPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultLogPath

const readLog = () => {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`)
  }
  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/)
}

const parseTimestamp = (line) => {
  const match = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]/.exec(line)
  if (!match) return null
  return new Date(`${match[1].replace(' ', 'T')}-03:00`)
}

const secondsBetween = (from, to) => {
  if (!from || !to) return null
  return (to.getTime() - from.getTime()) / 1000
}

const formatSeconds = (seconds) => {
  if (seconds === null || !Number.isFinite(seconds)) return 'n/a'
  const sign = seconds < 0 ? '-' : ''
  const abs = Math.abs(seconds)
  const min = Math.floor(abs / 60)
  const sec = abs - min * 60
  return `${sign}${min}m ${sec.toFixed(2)}s`
}

const extractNumber = (line, pattern) => {
  const match = pattern.exec(line)
  return match ? Number(match[1]) : null
}

const parsePerfBlock = (lines, startIndex) => {
  const firstLine = lines[startIndex] || ''
  const jsonMatch = /Render loop metrics:\s*(\{.*\})/.exec(firstLine)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      return {
        frame: parsed.frame ?? null,
        totalFrames: parsed.totalFrames ?? null,
        fps: parsed.fps ?? null,
        progress: parsed.progress ?? null,
        backpressure: parsed.avgMs?.backpressure ?? null,
        mainDecode: parsed.avgMs?.mainDecode ?? null,
        webcamDecode: parsed.avgMs?.webcamDecode ?? null,
        draw: parsed.avgMs?.draw ?? null,
        encode: parsed.avgMs?.encode ?? null,
        totalLoop: parsed.avgMs?.totalLoop ?? null,
      }
    } catch {
      // Fall through to legacy multi-line parser.
    }
  }

  if (firstLine.includes('[object Object]')) {
    return {
      frame: null,
      totalFrames: null,
      fps: null,
      progress: null,
      backpressure: null,
      mainDecode: null,
      webcamDecode: null,
      draw: null,
      encode: null,
      totalLoop: null,
    }
  }

  const chunk = lines.slice(startIndex, Math.min(lines.length, startIndex + 18)).join('\n')
  const frame = extractNumber(chunk, /frame:\s*([0-9.]+)/)
  const totalFrames = extractNumber(chunk, /totalFrames:\s*([0-9.]+)/)
  const fps = extractNumber(chunk, /fps:\s*([0-9.]+)/)
  const progress = extractNumber(chunk, /progress:\s*([0-9.]+)/)
  const backpressure = extractNumber(chunk, /backpressure:\s*([0-9.]+)/)
  const mainDecode = extractNumber(chunk, /mainDecode:\s*([0-9.]+)/)
  const webcamDecode = extractNumber(chunk, /webcamDecode:\s*([0-9.]+)/)
  const draw = extractNumber(chunk, /draw:\s*([0-9.]+)/)
  const encode = extractNumber(chunk, /encode:\s*([0-9.]+)/)
  const totalLoop = extractNumber(chunk, /totalLoop:\s*([0-9.]+)/)

  if (fps === null && draw === null && encode === null) return null
  return { frame, totalFrames, fps, progress, backpressure, mainDecode, webcamDecode, draw, encode, totalLoop }
}

const average = (values) => {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

const summarizeExport = (exportRun, label) => {
  const startupSeconds = secondsBetween(exportRun.start, exportRun.startupReady)
  const workerStartupSeconds = secondsBetween(exportRun.start, exportRun.workerReady)
  const renderSeconds = secondsBetween(exportRun.workerReady, exportRun.renderFinished)
  const activeRenderSeconds =
    exportRun.workerReady && !exportRun.renderFinished ? secondsBetween(exportRun.workerReady, exportRun.lastTimestamp) : null
  const finalizingSeconds = secondsBetween(exportRun.renderFinished, exportRun.ffmpegClosed)
  const totalSeconds = exportRun.totalSeconds ?? secondsBetween(exportRun.start, exportRun.completed)
  const activeTotalSeconds = !exportRun.completed ? secondsBetween(exportRun.start, exportRun.lastTimestamp) : null
  const perf = exportRun.perf
  const lastPerf = perf.at(-1)

  return {
    label,
    status: exportRun.cancelled ? 'cancelled' : exportRun.completed ? 'completed' : exportRun.renderFinished ? 'render-finished' : 'incomplete',
    total: formatSeconds(totalSeconds),
    activeElapsed: formatSeconds(activeTotalSeconds),
    startupUi: formatSeconds(startupSeconds),
    workerStartup: formatSeconds(workerStartupSeconds),
    renderLoop: formatSeconds(renderSeconds),
    activeRenderLoop: formatSeconds(activeRenderSeconds),
    finalizing: formatSeconds(finalizingSeconds),
    encoder: exportRun.encoder || 'n/a',
    adaptiveSource: exportRun.adaptiveSource || 'n/a',
    effectiveSettings: exportRun.effectiveSettings || 'n/a',
    outputPath: exportRun.outputPath || 'n/a',
    ffmpegFpsAverage: average(exportRun.ffmpegFps),
    ffmpegFpsLast: exportRun.ffmpegFps.at(-1) ?? null,
    rendererPerfSamples: perf.length,
    rendererFpsAverage: average(perf.map((item) => item.fps)),
    lastRendererPerf: lastPerf || null,
    bottleneckHint: lastPerf
      ? Object.entries({
          backpressure: lastPerf.backpressure,
          mainDecode: lastPerf.mainDecode,
          webcamDecode: lastPerf.webcamDecode,
          draw: lastPerf.draw,
          encode: lastPerf.encode,
        })
          .filter(([, value]) => Number.isFinite(value))
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'n/a'
      : 'missing RendererPage perf samples; run a new export with current build',
  }
}

const lines = readLog()
const exports = []
let current = null

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i]
  const timestamp = parseTimestamp(line)

  if (line.includes('[ExportManager] Starting export process...')) {
    current = {
      start: timestamp,
      lastTimestamp: timestamp,
      startupReady: null,
      workerReady: null,
      renderFinished: null,
      ffmpegClosed: null,
      completed: null,
      totalSeconds: null,
      ffmpegFps: [],
      perf: [],
      encoder: null,
      outputPath: null,
      adaptiveSource: null,
      effectiveSettings: null,
      cancelled: false,
    }
    exports.push(current)
  }

  if (!current) continue
  if (timestamp) current.lastTimestamp = timestamp

  if (line.includes('Export startup UI initialized')) current.startupReady = timestamp
  if (line.includes('Configured encoder:')) current.encoder = line.replace(/^.*Configured encoder:\s*/, '').trim()
  if (line.includes('Adaptive export source info:')) {
    current.adaptiveSource = line.replace(/^.*Adaptive export source info:\s*/, '').trim()
  }
  if (line.includes('Effective export settings:')) {
    current.effectiveSettings = line.replace(/^.*Effective export settings:\s*/, '').trim()
  }
  if (line.includes('Worker ready. Sending project state.')) current.workerReady = timestamp
  if (line.includes('Render finished. Closing FFmpeg stdin.')) current.renderFinished = timestamp
  if (line.includes('FFmpeg process exited with code 0.')) current.ffmpegClosed = timestamp
  if (line.includes('Received "export:cancel"') || line.includes('Export cancelled.')) current.cancelled = true
  if (line.includes('Export completed successfully')) {
    current.completed = timestamp
    current.totalSeconds = extractNumber(line, /in\s+([0-9.]+)\s+seconds/)
  }
  if (line.includes('Spawning FFmpeg with args:')) {
    const outputMatch = /\s([^ ]+\.mp4)$/.exec(line)
    if (outputMatch) current.outputPath = outputMatch[1]
  }
  if (line.includes('[FFmpeg stderr]:') && line.includes('fps=')) {
    const fps = extractNumber(line, /fps=\s*([0-9.]+)/)
    if (fps !== null) current.ffmpegFps.push(fps)
  }
  if (line.includes('[RendererPage][Perf] Render loop metrics')) {
    const perf = parsePerfBlock(lines, i)
    if (perf) current.perf.push(perf)
  }
}

const lastCompletedExport = exports.findLast((item) => item.completed || item.renderFinished)
const latestExport = exports.at(-1)

if (!lastCompletedExport && !latestExport) {
  console.log('[analyze-export-benchmark] No export found in log.')
  process.exit(1)
}

const result = {
  logPath,
  latestExport: latestExport ? summarizeExport(latestExport, 'latest') : null,
  lastCompletedExport: lastCompletedExport ? summarizeExport(lastCompletedExport, 'last-completed') : null,
}

console.log(JSON.stringify(result, null, 2))
