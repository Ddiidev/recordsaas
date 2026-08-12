import React, { useEffect, useRef, memo, useState, useCallback, useMemo } from 'react'
import { useEditorStore } from '../../store/editorStore'
import {
  ExitFullscreenIcon,
  FullscreenIcon,
  IconShell,
  Movie,
  PlayerPlay,
  PlayerTrackPrev as RewindIcon,
  PlayerPause,
  PlayerSkipBack,
  PlayerSkipForward,
} from '@icons'
import { useShallow } from 'zustand/react/shallow'
import { formatTime } from '../../lib/utils'
import { DEFAULTS } from '../../lib/constants'
import { calcRealDuration } from '../../lib/real-duration'
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { SimpleTooltip } from '../ui/tooltip'
import { drawScene } from '../../lib/renderer'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media-url'
import { getTopActiveRegionAtTime, getTopRegionByPredicate } from '../../lib/timeline-lanes'
import { BlurOverlayEditor } from './preview/BlurOverlayEditor'
import { FloatingMonitorOverlayEditor } from './preview/FloatingMonitorOverlayEditor'
import type { ChangeSoundSourceKey, FloatingMonitor, FloatingMonitorRegion } from '../../types'
import {
  getTakeScopedZoomRegions,
  mapCompositionTimeToTake,
  mapTakeMetadataToComposition,
  positionTakes,
} from '../../lib/takes'

const PLAYBACK_UI_SYNC_INTERVAL_MS = 200
const WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS = 0.12
const WEBCAM_SCRUB_RESYNC_DRIFT_SECS = 0.02
const AUDIO_PLAYBACK_RESYNC_DRIFT_SECS = 0.1

type ResolvedAudioPlayback = {
  isActive: boolean
  sourceTime: number
  volumeMultiplier: number
}

type FloatingMonitorSourceInstance = {
  sourceKey: string
  monitor: FloatingMonitor
  region: FloatingMonitorRegion
  sourceTime: number
}

type PendingMediaSeek = {
  targetTime: number
  maxDrift: number
}

const pendingMediaSeekTargets = new WeakMap<HTMLMediaElement, PendingMediaSeek>()
const mediaSeekListenerAttached = new WeakSet<HTMLMediaElement>()
const previewAudioGainNodes = new WeakMap<HTMLMediaElement, GainNode>()
let previewAudioContext: AudioContext | null = null

const setPreviewAudioVolume = (element: HTMLMediaElement, requestedVolume: number) => {
  const volume = Math.max(0, Math.min(DEFAULTS.AUDIO.VOLUME.max, requestedVolume))
  element.volume = Math.min(1, volume)

  if (volume <= 1 || typeof window === 'undefined') {
    const gainNode = previewAudioGainNodes.get(element)
    if (gainNode) gainNode.gain.value = 1
    return
  }

  try {
    if (!previewAudioContext) {
      previewAudioContext = new AudioContext()
    }
    let gainNode = previewAudioGainNodes.get(element)
    if (!gainNode) {
      const source = previewAudioContext.createMediaElementSource(element)
      gainNode = previewAudioContext.createGain()
      source.connect(gainNode)
      gainNode.connect(previewAudioContext.destination)
      previewAudioGainNodes.set(element, gainNode)
    }
    gainNode.gain.value = volume
    if (previewAudioContext.state === 'suspended') void previewAudioContext.resume()
  } catch {
    // Keep native playback available if Web Audio cannot attach to the element.
  }
}

const queueMediaSeek = (element: HTMLMediaElement, targetTime: number, maxDrift: number) => {
  if (element.readyState === HTMLMediaElement.HAVE_NOTHING) return
  if (!pendingMediaSeekTargets.has(element) && Math.abs(element.currentTime - targetTime) <= maxDrift) {
    return
  }

  pendingMediaSeekTargets.set(element, { targetTime, maxDrift })
  if (mediaSeekListenerAttached.has(element)) return

  const drainMediaSeek = () => {
    const pendingSeek = pendingMediaSeekTargets.get(element)
    if (!pendingSeek) return
    if (!element.seeking && Math.abs(element.currentTime - pendingSeek.targetTime) <= pendingSeek.maxDrift) {
      pendingMediaSeekTargets.delete(element)
      return
    }

    let fallbackTimer: number | null = null
    const clearSeekListener = () => {
      element.removeEventListener('seeked', handleSeeked)
      element.removeEventListener('error', handleSeekFailure)
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer)
      mediaSeekListenerAttached.delete(element)
    }
    const handleSeeked = () => {
      clearSeekListener()
      drainMediaSeek()
    }
    const handleSeekFailure = () => {
      clearSeekListener()
      pendingMediaSeekTargets.delete(element)
    }
    mediaSeekListenerAttached.add(element)
    element.addEventListener('seeked', handleSeeked)
    element.addEventListener('error', handleSeekFailure, { once: true })
    fallbackTimer = window.setTimeout(handleSeekFailure, 1500)
    if (element.seeking) return

    try {
      element.currentTime = pendingSeek.targetTime
    } catch {
      handleSeekFailure()
    }
  }

  drainMediaSeek()
}

const collectFloatingMonitorSourceInstances = (
  regions: Record<string, FloatingMonitorRegion>,
  monitors: Record<string, FloatingMonitor>,
  playbackTime: number | null,
  ancestry = new Set<string>(),
  sourcePath = 'main',
): FloatingMonitorSourceInstance[] =>
  Object.values(regions).flatMap((region) => {
    const monitor = monitors[region.monitorId]
    if (!monitor || ancestry.has(monitor.id)) return []
    if (
      playbackTime !== null &&
      (playbackTime < region.startTime || playbackTime >= region.startTime + region.duration)
    ) {
      return []
    }
    const sourceKey = `${sourcePath}/${region.id}`
    const sourceTime = playbackTime === null ? 0 : Math.max(0, region.sourceStart + playbackTime - region.startTime)
    const nestedAncestry = new Set(ancestry)
    nestedAncestry.add(monitor.id)
    return [
      { sourceKey, monitor, region, sourceTime },
      ...(monitor.timeline
        ? collectFloatingMonitorSourceInstances(
            monitor.timeline.floatingMonitorRegions,
            monitors,
            playbackTime === null ? null : sourceTime,
            nestedAncestry,
            sourceKey,
          )
        : []),
    ]
  })

const syncResolvedAudioElement = (
  element: HTMLAudioElement | null,
  resolved: ResolvedAudioPlayback,
  nextVolume: number,
  playbackRate: number,
  shouldPlay: boolean,
  maxDrift: number,
  timeOffsetSec = 0,
) => {
  if (!element) return

  if (!resolved.isActive) {
    requestMediaPlayback(element, false)
    if (element.readyState > 0) queueMediaSeek(element, 0, 0.001)
    return
  }

  const targetTime = resolved.sourceTime + timeOffsetSec
  if (element.readyState > 0 && Math.abs(element.currentTime - targetTime) > maxDrift) {
    queueMediaSeek(element, targetTime, maxDrift)
  }
  setPreviewAudioVolume(element, nextVolume)
  element.playbackRate = playbackRate

  requestMediaPlayback(element, shouldPlay)
}

const pendingMediaPlayRequests = new WeakSet<HTMLMediaElement>()
const requestedMediaPlayback = new WeakMap<HTMLMediaElement, boolean>()
const interruptedMediaPlayRetries = new WeakMap<HTMLMediaElement, number>()
const reportedMediaPlaybackFailures = new WeakMap<HTMLMediaElement, string>()

const isExpectedPlayInterruption = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

const reportMediaPlaybackFailure = (element: HTMLMediaElement, error: unknown) => {
  if (isExpectedPlayInterruption(error)) return

  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (reportedMediaPlaybackFailures.get(element) === detail) return
  reportedMediaPlaybackFailures.set(element, detail)
  console.error(`[Preview] Media playback failed: ${detail}`)
}

const requestMediaPlayback = (element: HTMLMediaElement | null, shouldPlay: boolean) => {
  if (!element) return

  requestedMediaPlayback.set(element, shouldPlay)
  if (!shouldPlay) {
    interruptedMediaPlayRetries.delete(element)
    element.pause()
    return
  }
  if (!element.paused || pendingMediaPlayRequests.has(element)) return

  pendingMediaPlayRequests.add(element)
  let wasInterrupted = false
  let didFailToPlay = false
  let playRequest: Promise<void>
  try {
    playRequest = element.play()
  } catch (error) {
    pendingMediaPlayRequests.delete(element)
    reportMediaPlaybackFailure(element, error)
    return
  }
  void playRequest
    .catch((error: unknown) => {
      wasInterrupted = isExpectedPlayInterruption(error)
      didFailToPlay = !wasInterrupted
      reportMediaPlaybackFailure(element, error)
    })
    .finally(() => {
      pendingMediaPlayRequests.delete(element)
      if (!wasInterrupted) {
        interruptedMediaPlayRetries.delete(element)
        if (!didFailToPlay) reportedMediaPlaybackFailures.delete(element)
        return
      }

      const retryCount = interruptedMediaPlayRetries.get(element) ?? 0
      if (requestedMediaPlayback.get(element) && element.paused && retryCount < 1) {
        interruptedMediaPlayRetries.set(element, retryCount + 1)
        window.requestAnimationFrame(() => requestMediaPlayback(element, true))
      }
    })
}

const describeMediaError = (element: HTMLMediaElement | null): string => {
  const error = element?.error
  if (!error) return 'code=unknown'
  return `code=${error.code} message=${error.message || 'unavailable'}`
}

export const Preview = memo(
  ({
    videoRef,
    onSeekFrame,
    isTimelineScrubbing,
  }: {
    videoRef: React.RefObject<HTMLVideoElement>
    onSeekFrame: (direction: 'next' | 'prev') => void
    isTimelineScrubbing: boolean
  }) => {
    const {
      videoUrl,
      audioUrl,
      systemAudioUrl,
      systemAudioVolume,
      systemAudioMuted,
      recordingSyncOffsetMs,
      systemAudioSyncOffsetMs,
      captureSourceOffsetsMs,
      mediaAudioClip,
      mediaAudioRegions,
      floatingMonitors,
      floatingMonitorRegions,
      updateFloatingMonitor,
      assetTimelineEditing,
      changeSoundRegions,
      zoomRegions,
      cutRegions,
      speedRegions,
      blurRegions,
      swapRegions,
      timelineLanes,
      selectedRegionId,
      webcamVideoUrl,
      duration,
      togglePlay,
      isPreviewFullScreen,
      togglePreviewFullScreen,
      frameStyles,
      isWebcamVisible,
      webcamLayout,
      webcamPosition,
      webcamStyles,
      videoDimensions,
      canvasDimensions,
      volume,
      isMuted,
      setCurrentTime,
      setCurrentTimeThrottled,
      setSelectedRegionId,
      updateRegion,
      cursorStyles,
      cursorBitmapsToRender,
      takeModeEnabled,
      takes,
      takeTransitions,
      sourceDuration,
    } = useEditorStore(
      useShallow((state) => ({
        videoUrl: state.videoUrl,
        audioUrl: state.audioUrl,
        systemAudioUrl: state.systemAudioUrl,
        systemAudioVolume: state.systemAudioVolume,
        systemAudioMuted: state.systemAudioMuted,
        recordingSyncOffsetMs: state.recordingSyncOffsetMs,
        systemAudioSyncOffsetMs: state.systemAudioSyncOffsetMs,
        captureSourceOffsetsMs: state.captureSourceOffsetsMs,
        mediaAudioClip: state.mediaAudioClip,
        mediaAudioRegions: state.mediaAudioRegions,
        floatingMonitors: state.floatingMonitors,
        floatingMonitorRegions: state.floatingMonitorRegions,
        updateFloatingMonitor: state.updateFloatingMonitor,
        assetTimelineEditing: state.assetTimelineEditing,
        changeSoundRegions: state.changeSoundRegions,
        zoomRegions: state.zoomRegions,
        cutRegions: state.cutRegions,
        speedRegions: state.speedRegions,
        blurRegions: state.blurRegions,
        swapRegions: state.swapRegions,
        timelineLanes: state.timelineLanes,
        selectedRegionId: state.selectedRegionId,
        webcamVideoUrl: state.webcamVideoUrl,
        duration: state.duration,
        togglePlay: state.togglePlay,
        isPreviewFullScreen: state.isPreviewFullScreen,
        togglePreviewFullScreen: state.togglePreviewFullScreen,
        frameStyles: state.frameStyles,
        isWebcamVisible: state.isWebcamVisible,
        webcamLayout: state.webcamLayout,
        webcamPosition: state.webcamPosition,
        webcamStyles: state.webcamStyles,
        videoDimensions: state.videoDimensions,
        canvasDimensions: state.canvasDimensions,
        volume: state.volume,
        isMuted: state.isMuted,
        setCurrentTime: state.setCurrentTime,
        setCurrentTimeThrottled: state.setCurrentTimeThrottled,
        setSelectedRegionId: state.setSelectedRegionId,
        updateRegion: state.updateRegion,
        cursorStyles: state.cursorStyles,
        cursorBitmapsToRender: state.cursorBitmapsToRender,
        takeModeEnabled: state.takeModeEnabled,
        takes: state.takes,
        takeTransitions: state.takeTransitions,
        sourceDuration: state.sourceDuration,
      })),
    )

    const { setPlaying, setDuration, setVideoDimensions, setHasAudioTrack, setMediaAudioDuration } =
      useEditorStore.getState()
    const isPlaying = useEditorStore((state) => state.isPlaying)

    const realDuration = useMemo(
      () => calcRealDuration(duration, cutRegions, speedRegions),
      [duration, cutRegions, speedRegions],
    )
    const hasTakeSourceDuration = takeModeEnabled && sourceDuration > 0

    const captureSourceOffsetSeconds = useCallback(
      (source: 'screen' | 'webcam' | 'recording' | 'systemAudio') => {
        const value = captureSourceOffsetsMs?.[source]
        return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) / 1000 : 0
      },
      [captureSourceOffsetsMs],
    )
    const toScreenSourceTime = useCallback(
      (timelineTime: number) => Math.max(0, timelineTime + captureSourceOffsetSeconds('screen')),
      [captureSourceOffsetSeconds],
    )
    const toWebcamSourceTime = useCallback(
      (timelineTime: number) => Math.max(0, timelineTime + captureSourceOffsetSeconds('webcam')),
      [captureSourceOffsetSeconds],
    )
    const toTimelineTime = useCallback(
      (screenSourceTime: number) => Math.max(0, screenSourceTime - captureSourceOffsetSeconds('screen')),
      [captureSourceOffsetSeconds],
    )

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const previewStageRef = useRef<HTMLDivElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const recordingAudioRef = useRef<HTMLAudioElement>(null)
    const systemAudioRef = useRef<HTMLAudioElement>(null)
    const mediaAudioRef = useRef<HTMLAudioElement>(null)
    const floatingMonitorVideoRefs = useRef(new Map<string, HTMLVideoElement>())
    const floatingMonitorImageRefs = useRef(new Map<string, HTMLImageElement>())
    const takeVideoRefs = useRef(new Map<string, HTMLVideoElement>())
    const takeCanvasARef = useRef<HTMLCanvasElement | null>(null)
    const takeCanvasBRef = useRef<HTMLCanvasElement | null>(null)
    const assetImageRef = useRef<HTMLImageElement>(null)
    const isEditingImageAsset = Boolean(
      assetTimelineEditing && floatingMonitors[assetTimelineEditing.monitorId]?.kind === 'image',
    )
    const currentTime = useEditorStore(
      (state) => state.currentTime,
      (previousTime, nextTime) => (isTimelineScrubbing && !isEditingImageAsset ? true : previousTime === nextTime),
    )
    const floatingMonitorSourceInstances = useMemo(
      () => collectFloatingMonitorSourceInstances(floatingMonitorRegions, floatingMonitors, null),
      [floatingMonitorRegions, floatingMonitors],
    )
    const importedTakeAssets = useMemo(
      () =>
        takes.flatMap((take) => {
          if (take.source.kind !== 'imported-video') return []
          const monitor = floatingMonitors[take.source.assetId]
          return monitor?.kind === 'video' ? [{ takeId: take.id, monitor }] : []
        }),
      [floatingMonitors, takes],
    )
    const animationFrameId = useRef<number | null>(null)
    const monitorRenderFrameRef = useRef<number | null>(null)
    const lastUiSyncAtRef = useRef(0)
    const lastRenderedMainVideoFrameCountRef = useRef<number | null>(null)
    const takePlaybackFrameRef = useRef<number | null>(null)
    const [playbackUiTime, setPlaybackUiTime] = useState(0)
    const [controlBarWidth, setControlBarWidth] = useState(0)
    const [previewStageSize, setPreviewStageSize] = useState({ width: 0, height: 0 })
    const hasSeparateAudioTracks = !!audioUrl || !!systemAudioUrl || !!mediaAudioClip?.url
    const previewRaster = useMemo(() => {
      const canonicalWidth = Math.max(1, canvasDimensions.width)
      const canonicalHeight = Math.max(1, canvasDimensions.height)
      const stageWidth = previewStageSize.width || canonicalWidth
      const stageHeight = previewStageSize.height || canonicalHeight
      const fitScale = Math.min(1, stageWidth / canonicalWidth, stageHeight / canonicalHeight)
      const cssWidth = Math.max(1, Math.floor(canonicalWidth * fitScale))
      const cssHeight = Math.max(1, Math.round((cssWidth * canonicalHeight) / canonicalWidth))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5)

      return {
        cssWidth,
        cssHeight,
        width: Math.max(1, Math.min(canonicalWidth, Math.round(cssWidth * pixelRatio))),
        height: Math.max(1, Math.min(canonicalHeight, Math.round(cssHeight * pixelRatio))),
      }
    }, [canvasDimensions.height, canvasDimensions.width, previewStageSize.height, previewStageSize.width])

    const resolveChangeSoundForTime = useCallback(
      (sourceKey: ChangeSoundSourceKey, sourceAvailable: boolean, playbackTime: number) => {
        if (!sourceAvailable) {
          return { isActive: false, sourceTime: 0, volumeMultiplier: 0 }
        }

        const sourceRegions = Object.values(changeSoundRegions).filter((region) => region.sourceKey === sourceKey)
        const activeRegion = getTopActiveRegionAtTime(sourceRegions, playbackTime, timelineLanes)
        if (!activeRegion) {
          return { isActive: true, sourceTime: playbackTime, volumeMultiplier: 1 }
        }

        const localTime = Math.max(0, playbackTime - activeRegion.startTime)
        const safeDuration = Math.max(0.001, activeRegion.duration)
        const timeFromStart = Math.min(localTime, safeDuration)
        const timeToEnd = Math.max(0, safeDuration - timeFromStart)
        const fadeInGain =
          activeRegion.fadeInDuration > 0 ? Math.max(0, Math.min(1, timeFromStart / activeRegion.fadeInDuration)) : 1
        const fadeOutGain =
          activeRegion.fadeOutDuration > 0 ? Math.max(0, Math.min(1, timeToEnd / activeRegion.fadeOutDuration)) : 1
        const baseGain = activeRegion.isMuted ? 0 : Math.max(0, Math.min(1, activeRegion.volume))

        return {
          isActive: true,
          sourceTime: playbackTime,
          volumeMultiplier: Math.max(0, Math.min(1, baseGain * Math.min(fadeInGain, fadeOutGain))),
        }
      },
      [changeSoundRegions, timelineLanes],
    )

    const resolveRecordingForTime = useCallback(
      (playbackTime: number) => resolveChangeSoundForTime('recording-mic', Boolean(audioUrl), playbackTime),
      [audioUrl, resolveChangeSoundForTime],
    )

    const resolveSystemAudioForTime = useCallback(
      (playbackTime: number) => resolveChangeSoundForTime('system-audio', Boolean(systemAudioUrl), playbackTime),
      [resolveChangeSoundForTime, systemAudioUrl],
    )

    const resolveMediaForTime = useCallback(
      (playbackTime: number) => {
        if (!mediaAudioClip) {
          return { isActive: false, sourceTime: 0, volumeMultiplier: 0 }
        }
        const activeRegion = getTopActiveRegionAtTime(Object.values(mediaAudioRegions), playbackTime, timelineLanes)
        if (!activeRegion) {
          return { isActive: false, sourceTime: 0, volumeMultiplier: 0 }
        }

        const localTime = Math.max(0, playbackTime - activeRegion.startTime)
        const sourceTime = Math.max(0, activeRegion.sourceStart + localTime)
        const safeDuration = Math.max(0.001, activeRegion.duration)
        const timeFromStart = Math.min(localTime, safeDuration)
        const timeToEnd = Math.max(0, safeDuration - timeFromStart)
        const fadeInGain =
          activeRegion.fadeInDuration > 0 ? Math.max(0, Math.min(1, timeFromStart / activeRegion.fadeInDuration)) : 1
        const fadeOutGain =
          activeRegion.fadeOutDuration > 0 ? Math.max(0, Math.min(1, timeToEnd / activeRegion.fadeOutDuration)) : 1
        const baseGain = activeRegion.isMuted ? 0 : Math.max(0, Math.min(1, activeRegion.volume))

        return {
          isActive: true,
          sourceTime,
          volumeMultiplier: Math.max(0, Math.min(1, baseGain * Math.min(fadeInGain, fadeOutGain))),
        }
      },
      [mediaAudioClip, mediaAudioRegions, timelineLanes],
    )

    const syncMediaToVideoTime = useCallback(
      (playbackTime: number, resumePlayback: boolean) => {
        const video = videoRef.current
        const webcamVideo = webcamVideoRef.current
        const recordingAudio = recordingAudioRef.current
        const systemAudio = systemAudioRef.current
        const mediaAudio = mediaAudioRef.current

        const webcamMaxDrift = resumePlayback ? WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS : WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        const audioMaxDrift = resumePlayback ? AUDIO_PLAYBACK_RESYNC_DRIFT_SECS : WEBCAM_SCRUB_RESYNC_DRIFT_SECS

        if (
          !isTimelineScrubbing &&
          webcamVideo &&
          webcamVideo.readyState >= 2 &&
          !webcamVideo.seeking &&
          Math.abs(webcamVideo.currentTime - toWebcamSourceTime(playbackTime)) > webcamMaxDrift
        ) {
          webcamVideo.currentTime = toWebcamSourceTime(playbackTime)
        }

        const resolvedRecording = resolveRecordingForTime(playbackTime)
        syncResolvedAudioElement(
          recordingAudio,
          resolvedRecording,
          volume * resolvedRecording.volumeMultiplier,
          video?.playbackRate ?? 1,
          resumePlayback,
          audioMaxDrift,
          captureSourceOffsetSeconds('recording') + recordingSyncOffsetMs / 1000,
        )
        const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
        syncResolvedAudioElement(
          systemAudio,
          resolvedSystemAudio,
          systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
          video?.playbackRate ?? 1,
          resumePlayback,
          audioMaxDrift,
          captureSourceOffsetSeconds('systemAudio') + systemAudioSyncOffsetMs / 1000,
        )

        const resolvedMedia = resolveMediaForTime(playbackTime)
        syncResolvedAudioElement(
          mediaAudio,
          resolvedMedia,
          resolvedMedia.volumeMultiplier,
          video?.playbackRate ?? 1,
          resumePlayback,
          audioMaxDrift,
        )

        const activeInstances = collectFloatingMonitorSourceInstances(
          floatingMonitorRegions,
          floatingMonitors,
          playbackTime,
        )
        const activeInstanceKeys = new Set(activeInstances.map((instance) => instance.sourceKey))
        floatingMonitorVideoRefs.current.forEach((monitorVideo, sourceKey) => {
          if (!activeInstanceKeys.has(sourceKey)) requestMediaPlayback(monitorVideo, false)
        })
        activeInstances.forEach(({ sourceKey, monitor, sourceTime }) => {
          if (monitor.kind === 'image') return
          const monitorVideo = floatingMonitorVideoRefs.current.get(sourceKey)
          if (!monitorVideo) return
          queueMediaSeek(monitorVideo, sourceTime, webcamMaxDrift)
          monitorVideo.playbackRate = video?.playbackRate ?? 1
          requestMediaPlayback(monitorVideo, resumePlayback)
        })
      },
      [
        isTimelineScrubbing,
        resolveMediaForTime,
        resolveRecordingForTime,
        resolveSystemAudioForTime,
        systemAudioVolume,
        videoRef,
        volume,
        recordingSyncOffsetMs,
        systemAudioSyncOffsetMs,
        captureSourceOffsetSeconds,
        toWebcamSourceTime,
        floatingMonitors,
        floatingMonitorRegions,
      ],
    )

    const syncTakeCompositionMedia = useCallback(
      (compositionTime: number, resumePlayback: boolean) => {
        const mapping = mapCompositionTimeToTake(compositionTime, takes, takeTransitions)
        if (!mapping) return
        const mainVideo = videoRef.current
        const webcamVideo = webcamVideoRef.current
        const sourceElements = new Map<string, HTMLVideoElement>()
        if (mainVideo) sourceElements.set('screen', mainVideo)
        if (webcamVideo) sourceElements.set('webcam', webcamVideo)
        takeVideoRefs.current.forEach((element, takeId) => sourceElements.set(`take:${takeId}`, element))
        const sourceKey = (take: typeof mapping.primary.take): string => {
          if (take.source.kind === 'recording-screen') return 'screen'
          if (take.source.kind === 'recording-webcam') return 'webcam'
          return `take:${take.id}`
        }
        const active = [mapping.primary, ...(mapping.secondary ? [mapping.secondary] : [])]
        const activeKeys = new Set(active.map(({ take }) => sourceKey(take)))
        const webcamSource =
          active.find(({ take }) => take.source.kind === 'recording-webcam') ??
          (isWebcamVisible ? active.find(({ take }) => take.source.kind === 'recording-screen') : undefined)
        if (webcamSource) activeKeys.add('webcam')

        sourceElements.forEach((element, key) => {
          if (!activeKeys.has(key)) requestMediaPlayback(element, false)
          element.muted = true
        })
        active.forEach((source) => {
          const element = sourceElements.get(sourceKey(source.take))
          if (!element) return
          const sourceTime =
            source.take.source.kind === 'recording-screen'
              ? toScreenSourceTime(source.sourceTime)
              : source.take.source.kind === 'recording-webcam'
                ? toWebcamSourceTime(source.sourceTime)
                : source.sourceTime
          queueMediaSeek(
            element,
            sourceTime,
            resumePlayback ? WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS : WEBCAM_SCRUB_RESYNC_DRIFT_SECS,
          )
          element.playbackRate = 1
          const embeddedAudioActive =
            source.take.source.kind === 'imported-video' && source.take.audioMode === 'source' && !source.take.isMuted
          element.muted = !embeddedAudioActive
          element.volume = embeddedAudioActive ? Math.max(0, Math.min(1, source.take.volume * source.weight)) : 0
          requestMediaPlayback(element, resumePlayback)
        })
        if (webcamVideo && webcamSource?.take.source.kind === 'recording-screen') {
          queueMediaSeek(
            webcamVideo,
            toWebcamSourceTime(webcamSource.sourceTime),
            resumePlayback ? WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS : WEBCAM_SCRUB_RESYNC_DRIFT_SECS,
          )
          webcamVideo.playbackRate = 1
          requestMediaPlayback(webcamVideo, resumePlayback)
        }

        const sessionSource =
          mapping.transition?.audioMode === 'crossfade' && mapping.secondary
            ? mapping.transitionProgress < 0.5
              ? mapping.primary
              : mapping.secondary
            : mapping.primary
        const sessionEnabled = sessionSource.take.audioMode === 'session' && !sessionSource.take.isMuted
        const sessionLocalTime = sessionSource.sourceTime - sessionSource.take.sourceStart
        const sessionAudioTime = Math.max(
          0,
          (sessionSource.take.sessionAudioStart ?? sessionSource.take.sourceStart) + sessionLocalTime,
        )
        const sessionGain = sessionEnabled ? sessionSource.take.volume : 0
        const resolvedRecording = resolveRecordingForTime(compositionTime)
        syncResolvedAudioElement(
          recordingAudioRef.current,
          {
            ...resolvedRecording,
            isActive: sessionEnabled && resolvedRecording.isActive,
            sourceTime: sessionAudioTime,
          },
          volume * resolvedRecording.volumeMultiplier * sessionGain,
          1,
          resumePlayback && sessionEnabled,
          AUDIO_PLAYBACK_RESYNC_DRIFT_SECS,
          captureSourceOffsetSeconds('recording') + recordingSyncOffsetMs / 1000,
        )
        const resolvedSystem = resolveSystemAudioForTime(compositionTime)
        syncResolvedAudioElement(
          systemAudioRef.current,
          { ...resolvedSystem, isActive: sessionEnabled && resolvedSystem.isActive, sourceTime: sessionAudioTime },
          systemAudioVolume * resolvedSystem.volumeMultiplier * sessionGain,
          1,
          resumePlayback && sessionEnabled,
          AUDIO_PLAYBACK_RESYNC_DRIFT_SECS,
          captureSourceOffsetSeconds('systemAudio') + systemAudioSyncOffsetMs / 1000,
        )
        const resolvedMedia = resolveMediaForTime(compositionTime)
        syncResolvedAudioElement(
          mediaAudioRef.current,
          resolvedMedia,
          resolvedMedia.volumeMultiplier,
          1,
          resumePlayback,
          AUDIO_PLAYBACK_RESYNC_DRIFT_SECS,
        )

        const activeInstances = collectFloatingMonitorSourceInstances(
          floatingMonitorRegions,
          floatingMonitors,
          compositionTime,
        )
        const activeInstanceKeys = new Set(activeInstances.map((instance) => instance.sourceKey))
        floatingMonitorVideoRefs.current.forEach((monitorVideo, key) => {
          if (!activeInstanceKeys.has(key)) requestMediaPlayback(monitorVideo, false)
        })
        activeInstances.forEach(({ sourceKey: key, monitor, sourceTime }) => {
          if (monitor.kind === 'image') return
          const monitorVideo = floatingMonitorVideoRefs.current.get(key)
          if (!monitorVideo) return
          queueMediaSeek(monitorVideo, sourceTime, WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS)
          requestMediaPlayback(monitorVideo, resumePlayback)
        })
      },
      [
        floatingMonitorRegions,
        floatingMonitors,
        recordingSyncOffsetMs,
        captureSourceOffsetSeconds,
        resolveMediaForTime,
        resolveRecordingForTime,
        resolveSystemAudioForTime,
        systemAudioSyncOffsetMs,
        systemAudioVolume,
        toScreenSourceTime,
        toWebcamSourceTime,
        isWebcamVisible,
        takeTransitions,
        takes,
        videoRef,
        volume,
      ],
    )

    // --- Start of Changes for Fullscreen Controls ---
    const [isControlBarVisible, setIsControlBarVisible] = useState(false)
    const [isCursorHidden, setIsCursorHidden] = useState(false)
    const inactivityTimerRef = useRef<number | null>(null)
    const previewContainerRef = useRef<HTMLDivElement>(null)

    // This effect handles the auto-hiding control bar in fullscreen mode.
    useEffect(() => {
      if (!isPreviewFullScreen) {
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
          inactivityTimerRef.current = null
        }
        setIsCursorHidden(false)
        return // Do nothing if not in fullscreen
      }

      // Start with controls hidden
      setIsControlBarVisible(false)

      // Hide cursor after 3 seconds of inactivity
      const initialHideTimeout = window.setTimeout(() => {
        setIsCursorHidden(true)
      }, 3000)

      const showControlsAndSetTimer = () => {
        setIsControlBarVisible(true)
        setIsCursorHidden(false)
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
        }
        inactivityTimerRef.current = window.setTimeout(() => {
          setIsControlBarVisible(false)
          setIsCursorHidden(true) // Ẩn con trỏ khi hết thời gian chờ
        }, 3000) // Hide after 3 seconds of inactivity
      }

      const container = previewContainerRef.current
      if (container) {
        container.addEventListener('mousemove', showControlsAndSetTimer)
      }

      // Cleanup function
      return () => {
        clearTimeout(initialHideTimeout)
        if (inactivityTimerRef.current) {
          window.clearTimeout(inactivityTimerRef.current)
        }
        if (container) {
          container.removeEventListener('mousemove', showControlsAndSetTimer)
        }
      }
    }, [isPreviewFullScreen])
    // --- End of Changes for Fullscreen Controls ---

    useEffect(() => {
      const stage = previewStageRef.current
      if (!stage) return

      const updatePreviewStageSize = (width: number, height: number) => {
        if (width <= 0 || height <= 0) return
        setPreviewStageSize((previous) => {
          if (Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1) return previous
          return { width, height }
        })
      }
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0]
        if (entry) updatePreviewStageSize(entry.contentRect.width, entry.contentRect.height)
      })

      updatePreviewStageSize(stage.clientWidth, stage.clientHeight)
      resizeObserver.observe(stage)
      return () => resizeObserver.disconnect()
    }, [])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]) {
          const newWidth = entries[0].contentRect.width
          if (newWidth > 0) {
            setControlBarWidth(newWidth)
          }
        }
      })
      resizeObserver.observe(canvas)
      return () => {
        resizeObserver.disconnect()
      }
    }, [previewRaster.cssWidth, previewRaster.cssHeight])

    useEffect(() => {
      const background = frameStyles.background
      if ((background.type === 'image' || background.type === 'wallpaper') && background.imageUrl) {
        const img = new Image()
        img.onload = () => {
          setBgImage(img)
        }
        const finalUrl = background.imageUrl.startsWith('blob:')
          ? background.imageUrl
          : toMediaUrl(background.imageUrl) || ''
        img.src = finalUrl
      } else {
        setBgImage(null)
      }
    }, [frameStyles.background])

    const syncCurrentTimeToStore = useCallback(
      (time: number, force: boolean = false) => {
        const playing = useEditorStore.getState().isPlaying

        if (force || !playing) {
          setCurrentTime(time)
        } else {
          setCurrentTimeThrottled(time)
        }
      },
      [setCurrentTime, setCurrentTimeThrottled],
    )

    const renderCanvas = useCallback(() => {
      const scheduleNextRender = () => {
        if (animationFrameId.current !== null) return
        animationFrameId.current = window.requestAnimationFrame(() => {
          animationFrameId.current = null
          renderCanvas()
        })
      }
      const canvas = canvasRef.current
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      const assetImage = assetImageRef.current
      const state = useEditorStore.getState()
      const ctx = canvas?.getContext('2d')
      const primarySource = isEditingImageAsset ? assetImage : video
      if (!canvas || !primarySource || !ctx || !state.videoDimensions.width) {
        if (state.isPlaying) scheduleNextRender()
        return
      }

      const mainVideoFrameCount = video?.getVideoPlaybackQuality?.().totalVideoFrames
      const webcamNeedsContinuousRedraw = Boolean(
        state.isWebcamVisible && webcamVideo && webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
      )

      // Canvas work is costly. A 30 fps source can otherwise be composited twice per browser frame.
      // When the webcam is active, the canvas must keep updating even if the screen
      // decoder repeats/skips a frame; otherwise the webcam overlay looks frozen.
      if (
        !isEditingImageAsset &&
        video &&
        state.isPlaying &&
        !isTimelineScrubbing &&
        !state.takeModeEnabled &&
        !webcamNeedsContinuousRedraw &&
        mainVideoFrameCount !== undefined &&
        lastRenderedMainVideoFrameCountRef.current === mainVideoFrameCount
      ) {
        scheduleNextRender()
        return
      }

      const floatingMonitorSources = Object.fromEntries([
        ...Array.from(floatingMonitorVideoRefs.current.entries())
          .filter(([, monitorVideo]) => monitorVideo.videoWidth > 0 && monitorVideo.videoHeight > 0)
          .map(([sourceKey, monitorVideo]) => [
            sourceKey,
            { source: monitorVideo, width: monitorVideo.videoWidth, height: monitorVideo.videoHeight },
          ]),
        ...Array.from(floatingMonitorImageRefs.current.entries())
          .filter(([, monitorImage]) => monitorImage.naturalWidth > 0 && monitorImage.naturalHeight > 0)
          .map(([sourceKey, monitorImage]) => [
            sourceKey,
            { source: monitorImage, width: monitorImage.naturalWidth, height: monitorImage.naturalHeight },
          ]),
      ])

      const previewRenderScale = Math.min(
        1,
        canvas.width / Math.max(1, state.canvasDimensions.width),
        canvas.height / Math.max(1, state.canvasDimensions.height),
      )

      if (isEditingImageAsset) {
        drawScene(
          ctx,
          state,
          primarySource,
          null,
          state.currentTime,
          canvas.width,
          canvas.height,
          bgImage,
          undefined,
          undefined,
          floatingMonitorSources,
          undefined,
          'main',
          previewRenderScale,
        )
        return
      }
      if (!video) return

      if (state.takeModeEnabled && state.takes.length > 0) {
        const mapping = mapCompositionTimeToTake(state.currentTime, state.takes, state.takeTransitions)
        if (!mapping) return
        const takePositions = new Map(
          positionTakes(state.takes, state.takeTransitions).map((item) => [item.take.id, item]),
        )

        const resolveSource = (take: typeof mapping.primary.take): HTMLVideoElement | null => {
          if (take.source.kind === 'recording-screen') return video
          if (take.source.kind === 'recording-webcam') return webcamVideo
          return takeVideoRefs.current.get(take.id) || null
        }
        const drawTake = (target: HTMLCanvasElement, sourceTime: typeof mapping.primary): boolean => {
          const source = resolveSource(sourceTime.take)
          const targetContext = target.getContext('2d')
          if (!source || !targetContext || source.readyState < 2) return false
          target.width = canvas.width
          target.height = canvas.height
          const isScreen = sourceTime.take.source.kind === 'recording-screen'
          const takePosition = takePositions.get(sourceTime.take.id)
          const takeEffects = takePosition
            ? {
                zoomRegions: getTakeScopedZoomRegions(state.zoomRegions, sourceTime.take.id),
                metadata: mapTakeMetadataToComposition(state.metadata, sourceTime.take, takePosition.start),
              }
            : { zoomRegions: state.zoomRegions, metadata: [] }
          const sceneState = isScreen
            ? { ...state, ...takeEffects }
            : {
                ...state,
                ...takeEffects,
                isWebcamVisible: false,
                swapRegions: {},
                cursorStyles: {
                  ...state.cursorStyles,
                  showCursor: false,
                  clickRippleEffect: false,
                  clickScaleEffect: false,
                },
              }
          drawScene(
            targetContext,
            sceneState,
            source,
            isScreen ? webcamVideo : null,
            state.currentTime,
            target.width,
            target.height,
            bgImage,
            undefined,
            undefined,
            floatingMonitorSources,
            undefined,
            'main',
            previewRenderScale,
          )
          return true
        }

        takeCanvasARef.current ||= document.createElement('canvas')
        takeCanvasBRef.current ||= document.createElement('canvas')
        const canvasA = takeCanvasARef.current
        const canvasB = takeCanvasBRef.current
        const hasPrimary = drawTake(canvasA, mapping.primary)
        if (!hasPrimary) {
          if (state.isPlaying) scheduleNextRender()
          return
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (!mapping.secondary || !mapping.transition || !drawTake(canvasB, mapping.secondary)) {
          ctx.drawImage(canvasA, 0, 0)
        } else {
          const progress = Math.max(0, Math.min(1, mapping.transitionProgress))
          if (mapping.transition.type === 'dip-black') {
            if (progress < 0.5) {
              ctx.drawImage(canvasA, 0, 0)
              ctx.fillStyle = `rgba(0,0,0,${progress * 2})`
              ctx.fillRect(0, 0, canvas.width, canvas.height)
            } else {
              ctx.drawImage(canvasB, 0, 0)
              ctx.fillStyle = `rgba(0,0,0,${(1 - progress) * 2})`
              ctx.fillRect(0, 0, canvas.width, canvas.height)
            }
          } else if (mapping.transition.type === 'slide-left' || mapping.transition.type === 'slide-right') {
            const direction = mapping.transition.type === 'slide-left' ? -1 : 1
            ctx.drawImage(canvasA, direction * progress * canvas.width, 0)
            ctx.drawImage(canvasB, direction * (progress - 1) * canvas.width, 0)
          } else if (mapping.transition.type === 'zoom') {
            const outgoingScale = 1 + progress * 0.08
            const incomingScale = 0.92 + progress * 0.08
            ctx.save()
            ctx.globalAlpha = 1 - progress
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.scale(outgoingScale, outgoingScale)
            ctx.drawImage(canvasA, -canvas.width / 2, -canvas.height / 2)
            ctx.restore()
            ctx.save()
            ctx.globalAlpha = progress
            ctx.translate(canvas.width / 2, canvas.height / 2)
            ctx.scale(incomingScale, incomingScale)
            ctx.drawImage(canvasB, -canvas.width / 2, -canvas.height / 2)
            ctx.restore()
          } else {
            ctx.drawImage(canvasA, 0, 0)
            ctx.globalAlpha = progress
            ctx.drawImage(canvasB, 0, 0)
            ctx.globalAlpha = 1
          }
        }
        if (state.isPlaying) scheduleNextRender()
        return
      }

      if (webcamVideo && !isTimelineScrubbing) {
        webcamVideo.playbackRate = video.playbackRate
        const timelineTime = toTimelineTime(video.currentTime)
        const webcamSourceTime = toWebcamSourceTime(timelineTime)
        const drift = Math.abs(webcamVideo.currentTime - webcamSourceTime)
        if (state.isPlaying) {
          if (webcamVideo.paused && webcamVideo.readyState >= 2) {
            requestMediaPlayback(webcamVideo, true)
          }
        } else if (webcamVideo.readyState >= 2 && !webcamVideo.seeking && drift > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideo.currentTime = webcamSourceTime
        }
      }

      drawScene(
        ctx,
        state,
        video,
        webcamVideo,
        toTimelineTime(video.currentTime),
        canvas.width,
        canvas.height,
        bgImage,
        undefined,
        undefined,
        floatingMonitorSources,
        undefined,
        'main',
        previewRenderScale,
      )
      lastRenderedMainVideoFrameCountRef.current = mainVideoFrameCount ?? null
      if (state.isPlaying) {
        scheduleNextRender()
      }
    }, [videoRef, bgImage, isTimelineScrubbing, isEditingImageAsset, toTimelineTime, toWebcamSourceTime])

    useEffect(() => {
      if (!takeModeEnabled || isEditingImageAsset) return
      if (takePlaybackFrameRef.current !== null) {
        cancelAnimationFrame(takePlaybackFrameRef.current)
        takePlaybackFrameRef.current = null
      }

      if (!isPlaying) return

      let previousTick = performance.now()
      let playbackTime = useEditorStore.getState().currentTime
      const tick = (now: number) => {
        const state = useEditorStore.getState()
        if (!state.isPlaying || !state.takeModeEnabled) return
        const deltaSeconds = Math.min(0.1, Math.max(0, now - previousTick) / 1000)
        previousTick = now
        const activeCut = getTopActiveRegionAtTime(Object.values(state.cutRegions), playbackTime, state.timelineLanes)
        if (activeCut) playbackTime = activeCut.startTime + activeCut.duration
        const activeSpeed = getTopActiveRegionAtTime(
          Object.values(state.speedRegions),
          playbackTime,
          state.timelineLanes,
        )
        playbackTime = Math.min(state.duration, playbackTime + deltaSeconds * (activeSpeed?.speed || 1))
        state.setCurrentTime(playbackTime)
        setPlaybackUiTime(playbackTime)
        syncTakeCompositionMedia(playbackTime, true)
        if (playbackTime >= state.duration) {
          state.setPlaying(false)
          return
        }
        takePlaybackFrameRef.current = requestAnimationFrame(tick)
      }
      syncTakeCompositionMedia(playbackTime, true)
      renderCanvas()
      takePlaybackFrameRef.current = requestAnimationFrame(tick)
      return () => {
        if (takePlaybackFrameRef.current !== null) cancelAnimationFrame(takePlaybackFrameRef.current)
        takePlaybackFrameRef.current = null
      }
    }, [isEditingImageAsset, isPlaying, renderCanvas, syncTakeCompositionMedia, takeModeEnabled])

    useEffect(() => {
      if (!takeModeEnabled || isPlaying || isEditingImageAsset) return
      syncTakeCompositionMedia(currentTime, false)
      renderCanvas()
    }, [currentTime, isEditingImageAsset, isPlaying, renderCanvas, syncTakeCompositionMedia, takeModeEnabled])

    const queueMonitorCanvasRender = useCallback(() => {
      if (useEditorStore.getState().isPlaying || monitorRenderFrameRef.current !== null) return
      monitorRenderFrameRef.current = window.requestAnimationFrame(() => {
        monitorRenderFrameRef.current = null
        renderCanvas()
      })
    }, [renderCanvas])

    useEffect(() => {
      if (isPlaying) lastRenderedMainVideoFrameCountRef.current = null
      renderCanvas()
      return () => {
        if (animationFrameId.current !== null) {
          cancelAnimationFrame(animationFrameId.current)
          animationFrameId.current = null
        }
        if (monitorRenderFrameRef.current !== null) {
          cancelAnimationFrame(monitorRenderFrameRef.current)
          monitorRenderFrameRef.current = null
        }
      }
    }, [isPlaying, renderCanvas])

    useEffect(() => {
      if (isPlaying || (isTimelineScrubbing && !isEditingImageAsset)) return
      renderCanvas()
    }, [
      isPlaying,
      isTimelineScrubbing,
      isEditingImageAsset,
      currentTime,
      renderCanvas,
      previewRaster.height,
      previewRaster.width,
      frameStyles,
      zoomRegions,
      cutRegions,
      speedRegions,
      blurRegions,
      swapRegions,
      timelineLanes,
      isWebcamVisible,
      webcamLayout,
      webcamPosition,
      webcamStyles,
      videoDimensions,
      cursorStyles,
      cursorBitmapsToRender,
      floatingMonitors,
      floatingMonitorRegions,
    ])

    useEffect(() => {
      if (!isPlaying) {
        lastUiSyncAtRef.current = 0
        setPlaybackUiTime(currentTime)
      }
    }, [isPlaying, currentTime])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      if (takeModeEnabled) return
      const webcamVideo = webcamVideoRef.current
      const recordingAudio = recordingAudioRef.current
      const systemAudio = systemAudioRef.current
      const mediaAudio = mediaAudioRef.current
      if (isTimelineScrubbing) {
        requestMediaPlayback(video, false)
        requestMediaPlayback(webcamVideo, false)
        syncMediaToVideoTime(toTimelineTime(video.currentTime), false)
        return
      }
      if (isPlaying) {
        requestMediaPlayback(video, true)
        requestMediaPlayback(webcamVideo, true)
        syncMediaToVideoTime(toTimelineTime(video.currentTime), true)
      } else {
        requestMediaPlayback(video, false)
        requestMediaPlayback(webcamVideo, false)
        syncMediaToVideoTime(toTimelineTime(video.currentTime), false)
        // When pausing, reset playbackRate to 1 so scrubbing is at normal speed
        video.playbackRate = 1
        if (webcamVideo) webcamVideo.playbackRate = 1
        if (recordingAudio) recordingAudio.playbackRate = 1
        if (systemAudio) systemAudio.playbackRate = 1
        if (mediaAudio) mediaAudio.playbackRate = 1
      }
    }, [isPlaying, isTimelineScrubbing, syncMediaToVideoTime, takeModeEnabled, toTimelineTime, videoRef])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      if (takeModeEnabled) return
      syncMediaToVideoTime(toTimelineTime(video.currentTime), isPlaying)
    }, [
      audioUrl,
      isPlaying,
      mediaAudioClip,
      syncMediaToVideoTime,
      systemAudioUrl,
      takeModeEnabled,
      toTimelineTime,
      videoRef,
    ])

    useEffect(() => {
      if (isTimelineScrubbing) return
      if (takeModeEnabled) return
      const video = videoRef.current
      if (!video) return
      syncMediaToVideoTime(toTimelineTime(video.currentTime), !video.paused)
      renderCanvas()
    }, [isTimelineScrubbing, renderCanvas, syncMediaToVideoTime, takeModeEnabled, toTimelineTime, videoRef])

    // Effect to handle volume and mute state
    useEffect(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      const systemAudio = systemAudioRef.current
      const mediaAudio = mediaAudioRef.current
      if (video) {
        // Video is always muted when we have a separate audio track
        if (hasSeparateAudioTracks) {
          video.muted = true
        } else {
          // No separate audio, use video's own audio
          setPreviewAudioVolume(video, volume)
          video.muted = isMuted
        }
      }
      if (recordingAudio) {
        const playbackTime = takeModeEnabled ? currentTime : toTimelineTime(video?.currentTime ?? currentTime)
        const resolvedRecording = resolveRecordingForTime(playbackTime)
        setPreviewAudioVolume(recordingAudio, volume * resolvedRecording.volumeMultiplier)
        recordingAudio.muted = isMuted
      }
      if (systemAudio) {
        const playbackTime = takeModeEnabled ? currentTime : toTimelineTime(video?.currentTime ?? currentTime)
        const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
        setPreviewAudioVolume(systemAudio, systemAudioVolume * resolvedSystemAudio.volumeMultiplier)
        systemAudio.muted = systemAudioMuted
      }
      if (mediaAudio) {
        const playbackTime = takeModeEnabled ? currentTime : toTimelineTime(video?.currentTime ?? currentTime)
        const resolvedMedia = resolveMediaForTime(playbackTime)
        setPreviewAudioVolume(mediaAudio, resolvedMedia.volumeMultiplier)
        mediaAudio.muted = false
      }
    }, [
      volume,
      isMuted,
      videoRef,
      hasSeparateAudioTracks,
      resolveRecordingForTime,
      resolveSystemAudioForTime,
      resolveMediaForTime,
      systemAudioVolume,
      systemAudioMuted,
      takeModeEnabled,
      currentTime,
      toTimelineTime,
    ])

    const handleTimeUpdate = () => {
      if (!videoRef.current) return
      if (takeModeEnabled) return
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      const systemAudio = systemAudioRef.current
      const mediaAudio = mediaAudioRef.current
      let playbackTime = toTimelineTime(video.currentTime)
      let shouldPlayAudio = isPlaying

      // Handle cut regions without depending on store currentTime updates during playback
      if (isPlaying) {
        const activeCutRegion = getTopActiveRegionAtTime(Object.values(cutRegions), playbackTime, timelineLanes)
        if (activeCutRegion) {
          playbackTime = activeCutRegion.startTime + activeCutRegion.duration
          video.currentTime = toScreenSourceTime(playbackTime)
          syncCurrentTimeToStore(playbackTime, true)
        }
      }

      // Handle speed regions
      const activeSpeedRegion = getTopActiveRegionAtTime(Object.values(speedRegions), playbackTime, timelineLanes)
      video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1

      const endTrimRegion = getTopRegionByPredicate(
        Object.values(cutRegions),
        timelineLanes,
        (r) => r.trimType === 'end',
      )
      if (isPlaying && endTrimRegion && playbackTime >= endTrimRegion.startTime) {
        playbackTime = endTrimRegion.startTime
        video.currentTime = toScreenSourceTime(playbackTime)
        requestMediaPlayback(video, false)
        shouldPlayAudio = false
        syncCurrentTimeToStore(playbackTime, true)
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.playbackRate = video.playbackRate // Sync webcam speed
        if (
          !isPlaying &&
          Math.abs(webcamVideoRef.current.currentTime - toWebcamSourceTime(playbackTime)) >
            WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideoRef.current.currentTime = toWebcamSourceTime(playbackTime)
        }
      }
      const resolvedRecording = resolveRecordingForTime(playbackTime)
      syncResolvedAudioElement(
        recordingAudio,
        resolvedRecording,
        volume * resolvedRecording.volumeMultiplier,
        video.playbackRate,
        shouldPlayAudio,
        0.1,
        captureSourceOffsetSeconds('recording') + recordingSyncOffsetMs / 1000,
      )
      const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
      syncResolvedAudioElement(
        systemAudio,
        resolvedSystemAudio,
        systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
        video.playbackRate,
        shouldPlayAudio,
        0.1,
        captureSourceOffsetSeconds('systemAudio') + systemAudioSyncOffsetMs / 1000,
      )
      const resolvedMedia = resolveMediaForTime(playbackTime)
      syncResolvedAudioElement(
        mediaAudio,
        resolvedMedia,
        resolvedMedia.volumeMultiplier,
        video.playbackRate,
        shouldPlayAudio,
        0.1,
      )

      if (isPlaying) {
        const now = performance.now()
        if (now - lastUiSyncAtRef.current >= PLAYBACK_UI_SYNC_INTERVAL_MS) {
          lastUiSyncAtRef.current = now
          setPlaybackUiTime(playbackTime)
          syncCurrentTimeToStore(playbackTime)
        }
      } else {
        setPlaybackUiTime(playbackTime)
        syncCurrentTimeToStore(playbackTime)
      }
    }

    const handleMediaLoadError = useCallback((label: string, element: HTMLMediaElement | null) => {
      const src = element?.currentSrc || element?.src || '(empty)'
      console.error(`[Preview] ${label} failed to load: src=${src} ${describeMediaError(element)}`)
    }, [])

    const handleVideoError = useCallback(() => {
      handleMediaLoadError('Main video', videoRef.current)
    }, [handleMediaLoadError, videoRef])

    const handleWebcamVideoError = useCallback(() => {
      handleMediaLoadError('Webcam video', webcamVideoRef.current)
    }, [handleMediaLoadError])

    const handleRecordingAudioError = useCallback(() => {
      handleMediaLoadError('Recording audio', recordingAudioRef.current)
    }, [handleMediaLoadError])

    const handleSystemAudioError = useCallback(() => {
      handleMediaLoadError('Computer audio', systemAudioRef.current)
    }, [handleMediaLoadError])

    const handleMediaAudioError = useCallback(() => {
      handleMediaLoadError('Media audio', mediaAudioRef.current)
    }, [handleMediaLoadError])

    const handleLoadedMetadata = () => {
      const video = videoRef.current
      if (video) {
        console.info(
          `[Preview] Main video metadata loaded: duration=${video.duration} dimensions=${video.videoWidth}x${video.videoHeight} src=${video.currentSrc}`,
        )
        setDuration(Math.max(0, video.duration - captureSourceOffsetSeconds('screen')))
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight })

        // Only check video for audio tracks if we don't have a separate audio file
        const store = useEditorStore.getState()
        if (!store.audioUrl && !store.systemAudioUrl) {
          // Check for audio tracks using type-safe checks
          const hasAudioTracks = video.audioTracks && video.audioTracks.length > 0
          const hasMozAudio = 'mozHasAudio' in video && video.mozHasAudio === true
          const hasWebkitAudio = 'webkitHasAudio' in video && video.webkitHasAudio === true

          setHasAudioTrack(!!(hasAudioTracks || hasMozAudio || hasWebkitAudio))
        }

        const timeFromStore = useEditorStore.getState().currentTime

        // Restore the video's time from the store to prevent rewinding. The
        // persistent seeked handler redraws the canvas and syncs audio.
        const mapping = store.takeModeEnabled
          ? mapCompositionTimeToTake(timeFromStore, store.takes, store.takeTransitions)
          : null
        video.currentTime = toScreenSourceTime(
          mapping?.primary.take.source.kind === 'recording-screen' ? mapping.primary.sourceTime : timeFromStore,
        )
      }
    }

    const handleWebcamLoadedMetadata = useCallback(() => {
      const mainVideo = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (mainVideo && webcamVideo) {
        webcamVideo.currentTime = toWebcamSourceTime(toTimelineTime(mainVideo.currentTime))
        if (mainVideo.paused) {
          requestMediaPlayback(webcamVideo, false)
        } else {
          requestMediaPlayback(webcamVideo, true)
        }
        renderCanvas()
      }
    }, [renderCanvas, toTimelineTime, toWebcamSourceTime, videoRef])

    const handleRecordingAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      if (video && recordingAudio) {
        console.info(
          `[Preview] Recording audio metadata loaded: duration=${recordingAudio.duration} src=${recordingAudio.currentSrc}`,
        )
        const resolvedRecording = resolveRecordingForTime(toTimelineTime(video.currentTime))
        syncResolvedAudioElement(
          recordingAudio,
          resolvedRecording,
          volume * resolvedRecording.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
          captureSourceOffsetSeconds('recording') + recordingSyncOffsetMs / 1000,
        )
      }
    }, [captureSourceOffsetSeconds, resolveRecordingForTime, toTimelineTime, videoRef, volume, recordingSyncOffsetMs])

    const handleSystemAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const systemAudio = systemAudioRef.current
      if (video && systemAudio) {
        console.info(
          `[Preview] Computer audio metadata loaded: duration=${systemAudio.duration} src=${systemAudio.currentSrc}`,
        )
        const resolvedSystemAudio = resolveSystemAudioForTime(toTimelineTime(video.currentTime))
        systemAudio.muted = systemAudioMuted
        syncResolvedAudioElement(
          systemAudio,
          resolvedSystemAudio,
          systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
          captureSourceOffsetSeconds('systemAudio') + systemAudioSyncOffsetMs / 1000,
        )
      }
    }, [
      captureSourceOffsetSeconds,
      resolveSystemAudioForTime,
      toTimelineTime,
      videoRef,
      systemAudioVolume,
      systemAudioMuted,
      systemAudioSyncOffsetMs,
    ])

    const handleMediaAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const mediaAudio = mediaAudioRef.current
      if (video && mediaAudio) {
        console.info(
          `[Preview] Media audio metadata loaded: duration=${mediaAudio.duration} src=${mediaAudio.currentSrc}`,
        )
        if (mediaAudioClip && Number.isFinite(mediaAudio.duration)) {
          setMediaAudioDuration(mediaAudio.duration)
        }
        const resolvedMedia = resolveMediaForTime(toTimelineTime(video.currentTime))
        syncResolvedAudioElement(
          mediaAudio,
          resolvedMedia,
          resolvedMedia.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
        )
      }
    }, [mediaAudioClip, resolveMediaForTime, setMediaAudioDuration, toTimelineTime, videoRef])

    const handleVideoPlay = useCallback(() => {
      if (takeModeEnabled) return
      if (isTimelineScrubbing) {
        requestMediaPlayback(videoRef.current, false)
        return
      }
      setPlaying(true)
      const video = videoRef.current
      if (video) {
        setPlaybackUiTime(toTimelineTime(video.currentTime))
      }
    }, [isTimelineScrubbing, setPlaying, takeModeEnabled, toTimelineTime, videoRef])

    const handleVideoPause = useCallback(() => {
      if (takeModeEnabled) return
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        const timelineTime = toTimelineTime(video.currentTime)
        setPlaybackUiTime(timelineTime)
        syncCurrentTimeToStore(timelineTime, true)
        if (
          !isTimelineScrubbing &&
          webcamVideo &&
          !webcamVideo.seeking &&
          Math.abs(webcamVideo.currentTime - toWebcamSourceTime(timelineTime)) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideo.currentTime = toWebcamSourceTime(timelineTime)
        }
      }
    }, [
      isTimelineScrubbing,
      setPlaying,
      takeModeEnabled,
      toTimelineTime,
      toWebcamSourceTime,
      videoRef,
      syncCurrentTimeToStore,
    ])

    const handleVideoEnded = useCallback(() => {
      if (takeModeEnabled) return
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        const timelineTime = toTimelineTime(video.currentTime)
        setPlaybackUiTime(timelineTime)
        syncCurrentTimeToStore(timelineTime, true)
        if (
          !isTimelineScrubbing &&
          webcamVideo &&
          !webcamVideo.seeking &&
          Math.abs(webcamVideo.currentTime - toWebcamSourceTime(timelineTime)) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideo.currentTime = toWebcamSourceTime(timelineTime)
        }
      }
    }, [
      isTimelineScrubbing,
      setPlaying,
      takeModeEnabled,
      toTimelineTime,
      toWebcamSourceTime,
      videoRef,
      syncCurrentTimeToStore,
    ])

    const handleVideoSeeking = useCallback(() => {
      const video = videoRef.current
      if (!video) return
      if (takeModeEnabled) return

      if (isTimelineScrubbing) {
        requestMediaPlayback(webcamVideoRef.current, false)
        requestMediaPlayback(recordingAudioRef.current, false)
        requestMediaPlayback(systemAudioRef.current, false)
        requestMediaPlayback(mediaAudioRef.current, false)
        return
      }

      syncMediaToVideoTime(toTimelineTime(video.currentTime), false)
    }, [isTimelineScrubbing, syncMediaToVideoTime, takeModeEnabled, toTimelineTime, videoRef])

    const handleVideoSeeked = useCallback(() => {
      const video = videoRef.current
      if (!video) return
      if (takeModeEnabled) return

      const timelineTime = toTimelineTime(video.currentTime)
      setPlaybackUiTime(timelineTime)
      syncCurrentTimeToStore(timelineTime, true)
      renderCanvas()
      if (!isTimelineScrubbing) {
        syncMediaToVideoTime(timelineTime, !video.paused)
      }
    }, [
      isTimelineScrubbing,
      renderCanvas,
      syncCurrentTimeToStore,
      syncMediaToVideoTime,
      takeModeEnabled,
      toTimelineTime,
      videoRef,
    ])

    const handleScrub = (value: number) => {
      if (takeModeEnabled) {
        setPlaybackUiTime(value)
        syncCurrentTimeToStore(value, true)
        syncTakeCompositionMedia(value, false)
        renderCanvas()
        return
      }
      if (videoRef.current) {
        videoRef.current.currentTime = toScreenSourceTime(value)
        setPlaybackUiTime(value)
        syncCurrentTimeToStore(value, true)
      }
      syncMediaToVideoTime(value, !!videoRef.current && !videoRef.current.paused)
    }

    const handleRewind = () => {
      const startTrimRegion = getTopRegionByPredicate(
        Object.values(cutRegions),
        timelineLanes,
        (r) => r.trimType === 'start',
      )
      const rewindTime = startTrimRegion ? startTrimRegion.startTime + startTrimRegion.duration : 0
      setPlaybackUiTime(rewindTime)
      syncCurrentTimeToStore(rewindTime, true)
      if (takeModeEnabled) {
        syncTakeCompositionMedia(rewindTime, false)
        renderCanvas()
        return
      }
      if (videoRef.current) {
        videoRef.current.currentTime = toScreenSourceTime(rewindTime)
      }
      syncMediaToVideoTime(rewindTime, !!videoRef.current && !videoRef.current.paused)
    }

    const previewTime = isPlaying ? playbackUiTime : currentTime

    return (
      <div
        ref={previewContainerRef}
        className={cn(
          'w-full h-full flex flex-col items-center justify-center relative',
          isPreviewFullScreen && isCursorHidden && 'cursor-none',
        )}
      >
        <div
          id="preview-container"
          ref={previewStageRef}
          className="transition-all duration-300 ease-out flex items-center justify-center w-full flex-1 min-h-0 relative"
        >
          {videoUrl ? (
            <canvas
              ref={canvasRef}
              width={previewRaster.width}
              height={previewRaster.height}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: previewRaster.cssWidth,
                height: previewRaster.cssHeight,
              }}
              className="rounded-lg shadow-2xl"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-border/40 bg-gradient-to-br from-muted/30 to-muted/10 text-muted-foreground backdrop-blur-sm">
              <IconShell active className="h-20 w-20 shadow-md">
                <Movie className="h-10 w-10 text-primary/60" />
              </IconShell>
              <div className="text-center space-y-1">
                <p className="text-lg font-semibold text-foreground/80">No project loaded</p>
                <p className="text-sm text-muted-foreground/70">Load a project to begin editing</p>
              </div>
            </div>
          )}
          {videoUrl && (
            <BlurOverlayEditor
              canvasRef={canvasRef}
              blurRegions={blurRegions}
              currentTime={previewTime}
              timelineLanes={timelineLanes}
              frameStyles={frameStyles}
              videoDimensions={videoDimensions}
              selectedRegionId={selectedRegionId}
              onSelectRegion={setSelectedRegionId}
              onUpdateRegion={(id, updates) => updateRegion(id, updates)}
            />
          )}
          {videoUrl && (
            <FloatingMonitorOverlayEditor
              canvasRef={canvasRef}
              regions={floatingMonitorRegions}
              monitors={floatingMonitors}
              currentTime={previewTime}
              timelineLanes={timelineLanes}
              selectedRegionId={selectedRegionId}
              onSelectRegion={setSelectedRegionId}
              onUpdateRegion={(id, updates) => updateRegion(id, updates)}
            />
          )}
        </div>

        {isEditingImageAsset ? (
          <img
            ref={assetImageRef}
            src={videoUrl || undefined}
            alt=""
            onLoad={(event) =>
              setVideoDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            }
            style={{ display: 'none' }}
          />
        ) : (
          <video
            ref={videoRef}
            src={videoUrl || undefined}
            onTimeUpdate={handleTimeUpdate}
            onSeeking={handleVideoSeeking}
            onSeeked={handleVideoSeeked}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleVideoError}
            onPlay={handleVideoPlay}
            onPause={handleVideoPause}
            onEnded={handleVideoEnded}
            style={{ display: 'none' }}
          />
        )}
        {audioUrl && (
          <audio
            ref={recordingAudioRef}
            src={audioUrl}
            onLoadedMetadata={handleRecordingAudioLoadedMetadata}
            onError={handleRecordingAudioError}
            style={{ display: 'none' }}
          />
        )}
        {systemAudioUrl && (
          <audio
            ref={systemAudioRef}
            src={systemAudioUrl}
            onLoadedMetadata={handleSystemAudioLoadedMetadata}
            onError={handleSystemAudioError}
            style={{ display: 'none' }}
          />
        )}
        {mediaAudioClip?.url && (
          <audio
            ref={mediaAudioRef}
            src={mediaAudioClip.url}
            onLoadedMetadata={handleMediaAudioLoadedMetadata}
            onError={handleMediaAudioError}
            style={{ display: 'none' }}
          />
        )}
        {webcamVideoUrl && (
          <video
            ref={webcamVideoRef}
            src={webcamVideoUrl}
            muted
            playsInline
            onLoadedMetadata={handleWebcamLoadedMetadata}
            onSeeked={renderCanvas}
            onError={handleWebcamVideoError}
            style={{ display: 'none' }}
          />
        )}
        {importedTakeAssets.map(({ takeId, monitor }) => (
          <video
            key={`take-source-${takeId}`}
            ref={(element) => {
              if (element) takeVideoRefs.current.set(takeId, element)
              else takeVideoRefs.current.delete(takeId)
            }}
            src={monitor.url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const importedDuration = event.currentTarget.duration
              if (Number.isFinite(importedDuration) && importedDuration > 0 && importedDuration !== monitor.duration) {
                updateFloatingMonitor(monitor.id, {
                  duration: importedDuration,
                  timelineDuration: monitor.timelineDuration > 0 ? monitor.timelineDuration : importedDuration,
                })
              }
              syncTakeCompositionMedia(useEditorStore.getState().currentTime, false)
              renderCanvas()
            }}
            onSeeked={renderCanvas}
            onError={(event) => handleMediaLoadError(`Take source ${monitor.name}`, event.currentTarget)}
            style={{ display: 'none' }}
          />
        ))}
        {floatingMonitorSourceInstances.map(({ sourceKey, monitor }) =>
          monitor.kind === 'image' ? (
            <img
              key={sourceKey}
              ref={(element) => {
                if (element) floatingMonitorImageRefs.current.set(sourceKey, element)
                else floatingMonitorImageRefs.current.delete(sourceKey)
              }}
              src={monitor.url}
              alt=""
              style={{ display: 'none' }}
            />
          ) : (
            <video
              key={sourceKey}
              ref={(element) => {
                if (element) floatingMonitorVideoRefs.current.set(sourceKey, element)
                else floatingMonitorVideoRefs.current.delete(sourceKey)
              }}
              src={monitor.url}
              muted
              playsInline
              preload="metadata"
              onSeeked={queueMonitorCanvasRender}
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration
                if (Number.isFinite(duration) && duration > 0 && duration !== monitor.duration) {
                  updateFloatingMonitor(monitor.id, {
                    duration,
                    timelineDuration: monitor.timelineDuration > 0 ? monitor.timelineDuration : duration,
                  })
                }
                syncMediaToVideoTime(videoRef.current?.currentTime ?? currentTime, isPlaying)
                queueMonitorCanvasRender()
              }}
              style={{ display: 'none' }}
            />
          ),
        )}

        {/* Control bar */}
        {videoUrl && !isEditingImageAsset && (
          <div
            className={cn(
              'w-full mt-3 transition-opacity duration-200',
              isPreviewFullScreen && 'absolute bottom-6 left-0 right-0 mx-auto px-4 z-10',
              isPreviewFullScreen && !isControlBarVisible && 'opacity-0 pointer-events-none',
            )}
            style={{ maxWidth: isPreviewFullScreen ? 'min(90%, 800px)' : '100%' }}
          >
            <div
              className="mx-auto flex max-w-full items-center gap-2 rounded-lg border border-border/40 bg-card/95 px-3 py-2 shadow-md backdrop-blur-xl"
              style={{
                width: isPreviewFullScreen ? 'auto' : controlBarWidth,
                minWidth: isPreviewFullScreen ? 'auto' : 420,
              }}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePlay}
                title="Play/Pause (Space)"
                className="icon-hover h-10 w-10 flex-shrink-0 rounded-md text-foreground hover:bg-accent hover:text-foreground"
              >
                {isPlaying ? <PlayerPause className="w-4 h-4" /> : <PlayerPlay className="w-4 h-4 ml-0.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRewind}
                title="Rewind to Start"
                className="icon-hover h-10 w-10 flex-shrink-0 rounded-md text-foreground hover:bg-accent hover:text-foreground"
              >
                <RewindIcon className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('prev')}
                title="Previous Frame (J)"
                className="icon-hover h-10 w-10 flex-shrink-0 rounded-md text-foreground hover:bg-accent hover:text-foreground"
              >
                <PlayerSkipBack className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('next')}
                title="Next Frame (K)"
                className="icon-hover h-10 w-10 flex-shrink-0 rounded-md text-foreground hover:bg-accent hover:text-foreground"
              >
                <PlayerSkipForward className="w-4 h-4" />
              </Button>

              <SimpleTooltip
                content={
                  hasTakeSourceDuration
                    ? `Original: ${formatTime(sourceDuration, true)} · pós-render: ${formatTime(realDuration, true)}`
                    : realDuration < duration
                      ? `Tempo real pós-render: ${formatTime(realDuration, true)}`
                      : 'Sem cortes aplicados'
                }
              >
                <div className="ml-2 mr-4 flex min-w-[130px] items-baseline gap-1.5 whitespace-nowrap text-xs font-mono tabular-nums text-muted-foreground cursor-help">
                  <span className="text-foreground font-semibold">{formatTime(previewTime, true)}</span>
                  <span className="text-muted-foreground/50">/</span>
                  <span title={hasTakeSourceDuration ? 'Tempo original' : 'Tempo total'} className="text-muted-foreground">
                    {formatTime(hasTakeSourceDuration ? sourceDuration : duration, true)}
                  </span>
                  {(hasTakeSourceDuration || realDuration < duration) && (
                    <>
                      <span className="text-muted-foreground/50">→</span>
                      <span title="Tempo real pós-render" className="text-primary/80">
                        {formatTime(realDuration, true)}
                      </span>
                    </>
                  )}
                </div>
              </SimpleTooltip>
              <Slider
                min={0}
                max={duration}
                step={0.01}
                value={previewTime}
                onChange={handleScrub}
                disabled={duration === 0}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePreviewFullScreen}
                className="icon-hover h-10 w-10 flex-shrink-0 rounded-md text-foreground hover:bg-accent hover:text-foreground"
              >
                {isPreviewFullScreen ? (
                  <ExitFullscreenIcon className="w-4 h-4" />
                ) : (
                  <FullscreenIcon className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  },
)
Preview.displayName = 'Preview'
