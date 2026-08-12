import { MAX_AMPLIFIED_AUDIO_GAIN } from './audio-volume'

type PreviewAudioGraph = {
  gainNode: GainNode
  routedThroughLimiter: boolean
}

const previewAudioGraphs = new WeakMap<HTMLMediaElement, PreviewAudioGraph>()
let previewAudioContext: AudioContext | null = null
let previewMasterLimiter: DynamicsCompressorNode | null = null
const PREVIEW_AUDIO_PEAK_LIMIT_DB = -1.5
const PREVIEW_AUDIO_PEAK_LIMIT = 10 ** (PREVIEW_AUDIO_PEAK_LIMIT_DB / 20)
const PREVIEW_AUDIO_SOFT_CLIP_START = 0.75

const createPreviewSoftPeakGuardCurve = (): Float32Array<ArrayBuffer> => {
  const curve = new Float32Array(65537)
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1
    const magnitude = Math.abs(input)
    if (magnitude <= PREVIEW_AUDIO_SOFT_CLIP_START) {
      curve[index] = input
      continue
    }

    const progress = (magnitude - PREVIEW_AUDIO_SOFT_CLIP_START) / (1 - PREVIEW_AUDIO_SOFT_CLIP_START)
    const softenedProgress = progress * (2 - progress)
    const softenedMagnitude =
      PREVIEW_AUDIO_SOFT_CLIP_START + (PREVIEW_AUDIO_PEAK_LIMIT - PREVIEW_AUDIO_SOFT_CLIP_START) * softenedProgress
    curve[index] = Math.sign(input) * softenedMagnitude
  }
  return curve
}

const configurePreviewLimiter = (limiterNode: DynamicsCompressorNode) => {
  const currentTime = limiterNode.context.currentTime
  limiterNode.threshold.setValueAtTime(-12, currentTime)
  limiterNode.knee.setValueAtTime(18, currentTime)
  limiterNode.ratio.setValueAtTime(8, currentTime)
  limiterNode.attack.setValueAtTime(0.005, currentTime)
  limiterNode.release.setValueAtTime(0.2, currentTime)
}

const getPreviewMasterLimiter = (context: AudioContext): DynamicsCompressorNode => {
  if (!previewMasterLimiter) {
    previewMasterLimiter = context.createDynamicsCompressor()
    configurePreviewLimiter(previewMasterLimiter)
    const peakGuard = context.createWaveShaper()
    peakGuard.curve = createPreviewSoftPeakGuardCurve()
    peakGuard.oversample = '4x'
    previewMasterLimiter.connect(peakGuard)
    peakGuard.connect(context.destination)
  }
  return previewMasterLimiter
}

const routePreviewAudioGraph = (graph: PreviewAudioGraph, context: AudioContext, limitPeaks: boolean) => {
  if (graph.routedThroughLimiter === limitPeaks) return

  graph.gainNode.disconnect()
  graph.gainNode.connect(limitPeaks ? getPreviewMasterLimiter(context) : context.destination)
  graph.routedThroughLimiter = limitPeaks
}

export const setPreviewAudioVolume = (element: HTMLMediaElement, requestedGain: number, limitPeaks = false) => {
  const gain = Number.isFinite(requestedGain) ? Math.max(0, Math.min(MAX_AMPLIFIED_AUDIO_GAIN, requestedGain)) : 1
  let graph = previewAudioGraphs.get(element)

  if (!graph && gain <= 1 && !limitPeaks) {
    element.volume = gain
    return
  }

  try {
    if (!previewAudioContext) previewAudioContext = new AudioContext()
    if (!graph) {
      const source = previewAudioContext.createMediaElementSource(element)
      const gainNode = previewAudioContext.createGain()
      source.connect(gainNode)
      gainNode.connect(limitPeaks ? getPreviewMasterLimiter(previewAudioContext) : previewAudioContext.destination)
      graph = { gainNode, routedThroughLimiter: limitPeaks }
      previewAudioGraphs.set(element, graph)
    }
    routePreviewAudioGraph(graph, previewAudioContext, limitPeaks)
    element.volume = 1
    graph.gainNode.gain.setValueAtTime(gain, previewAudioContext.currentTime)
    if (previewAudioContext.state === 'suspended') {
      void previewAudioContext.resume().catch((error: unknown) => {
        console.warn('[Preview] Failed to resume amplified audio context:', error)
      })
    }
  } catch (error) {
    element.volume = Math.min(1, gain)
    console.warn('[Preview] Failed to initialize amplified audio:', error)
  }
}

export const resumePreviewAudioContextFor = (element: HTMLMediaElement) => {
  if (!previewAudioGraphs.has(element) || previewAudioContext?.state !== 'suspended') return

  void previewAudioContext.resume().catch((error: unknown) => {
    console.warn('[Preview] Failed to resume amplified audio context before playback:', error)
  })
}
