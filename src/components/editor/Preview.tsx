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
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { drawScene } from '../../lib/renderer'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media-url'
import { getTopActiveRegionAtTime, getTopRegionByPredicate } from '../../lib/timeline-lanes'
import { BlurOverlayEditor } from './preview/BlurOverlayEditor'
import { FloatingMonitorOverlayEditor } from './preview/FloatingMonitorOverlayEditor'
import type { ChangeSoundSourceKey, FloatingMonitor, FloatingMonitorRegion } from '../../types'

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

const pendingMonitorSeekTargets = new WeakMap<HTMLVideoElement, number>()
const monitorSeekListenerAttached = new WeakSet<HTMLVideoElement>()

const queueMonitorVideoSeek = (monitorVideo: HTMLVideoElement, targetTime: number, maxDrift: number) => {
  if (monitorVideo.readyState === 0) return
  if (!pendingMonitorSeekTargets.has(monitorVideo) && Math.abs(monitorVideo.currentTime - targetTime) <= maxDrift) {
    return
  }

  pendingMonitorSeekTargets.set(monitorVideo, targetTime)
  if (monitorSeekListenerAttached.has(monitorVideo)) return

  const drainMonitorSeek = () => {
    const nextTime = pendingMonitorSeekTargets.get(monitorVideo)
    if (nextTime === undefined) return
    if (!monitorVideo.seeking && Math.abs(monitorVideo.currentTime - nextTime) <= maxDrift) {
      pendingMonitorSeekTargets.delete(monitorVideo)
      return
    }

    const handleSeeked = () => {
      monitorVideo.removeEventListener('seeked', handleSeeked)
      monitorSeekListenerAttached.delete(monitorVideo)
      drainMonitorSeek()
    }
    monitorSeekListenerAttached.add(monitorVideo)
    monitorVideo.addEventListener('seeked', handleSeeked)
    if (monitorVideo.seeking) return

    try {
      monitorVideo.currentTime = nextTime
    } catch {
      monitorVideo.removeEventListener('seeked', handleSeeked)
      monitorSeekListenerAttached.delete(monitorVideo)
      pendingMonitorSeekTargets.delete(monitorVideo)
    }
  }

  drainMonitorSeek()
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
) => {
  if (!element) return

  if (!resolved.isActive) {
    requestMediaPlayback(element, false)
    if (element.readyState > 0) element.currentTime = 0
    return
  }

  if (element.readyState > 0 && Math.abs(element.currentTime - resolved.sourceTime) > maxDrift) {
    element.currentTime = resolved.sourceTime
  }
  element.volume = Math.max(0, Math.min(1, nextVolume))
  element.playbackRate = playbackRate

  requestMediaPlayback(element, shouldPlay)
}

const pendingMediaPlayRequests = new WeakSet<HTMLMediaElement>()
const requestedMediaPlayback = new WeakMap<HTMLMediaElement, boolean>()
const interruptedMediaPlayRetries = new WeakMap<HTMLMediaElement, number>()

const isExpectedPlayInterruption = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

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
  const playRequest = element.play()
  void playRequest
    .catch((error: unknown) => {
      wasInterrupted = isExpectedPlayInterruption(error)
      if (!wasInterrupted) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        console.error(`[Preview] Media playback failed: ${detail}`)
      }
    })
    .finally(() => {
      pendingMediaPlayRequests.delete(element)
      if (!wasInterrupted) {
        interruptedMediaPlayRetries.delete(element)
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
      currentTime,
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
    } = useEditorStore(
      useShallow((state) => ({
        videoUrl: state.videoUrl,
        audioUrl: state.audioUrl,
        systemAudioUrl: state.systemAudioUrl,
        systemAudioVolume: state.systemAudioVolume,
        systemAudioMuted: state.systemAudioMuted,
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
        currentTime: state.currentTime,
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
      })),
    )

    const { setPlaying, setDuration, setVideoDimensions, setHasAudioTrack, setMediaAudioDuration } =
      useEditorStore.getState()
    const isPlaying = useEditorStore((state) => state.isPlaying)

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const recordingAudioRef = useRef<HTMLAudioElement>(null)
    const systemAudioRef = useRef<HTMLAudioElement>(null)
    const mediaAudioRef = useRef<HTMLAudioElement>(null)
    const floatingMonitorVideoRefs = useRef(new Map<string, HTMLVideoElement>())
    const floatingMonitorImageRefs = useRef(new Map<string, HTMLImageElement>())
    const assetImageRef = useRef<HTMLImageElement>(null)
    const isEditingImageAsset = Boolean(
      assetTimelineEditing && floatingMonitors[assetTimelineEditing.monitorId]?.kind === 'image',
    )
    const floatingMonitorSourceInstances = useMemo(
      () => collectFloatingMonitorSourceInstances(floatingMonitorRegions, floatingMonitors, null),
      [floatingMonitorRegions, floatingMonitors],
    )
    const animationFrameId = useRef<number>()
    const lastWebcamResyncAtRef = useRef(0)
    const lastUiSyncAtRef = useRef(0)
    const [playbackUiTime, setPlaybackUiTime] = useState(0)
    const [controlBarWidth, setControlBarWidth] = useState(0)
    const hasSeparateAudioTracks = !!audioUrl || !!systemAudioUrl || !!mediaAudioClip?.url

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
          Math.abs(webcamVideo.currentTime - playbackTime) > webcamMaxDrift
        ) {
          webcamVideo.currentTime = playbackTime
        }

        const resolvedRecording = resolveRecordingForTime(playbackTime)
        syncResolvedAudioElement(
          recordingAudio,
          resolvedRecording,
          volume * resolvedRecording.volumeMultiplier,
          video?.playbackRate ?? 1,
          resumePlayback,
          audioMaxDrift,
        )
        const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
        syncResolvedAudioElement(
          systemAudio,
          resolvedSystemAudio,
          systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
          video?.playbackRate ?? 1,
          resumePlayback,
          audioMaxDrift,
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
          queueMonitorVideoSeek(monitorVideo, sourceTime, webcamMaxDrift)
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
        floatingMonitors,
        floatingMonitorRegions,
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
    }, [canvasDimensions])

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
      const canvas = canvasRef.current
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      const assetImage = assetImageRef.current
      const state = useEditorStore.getState()
      const ctx = canvas?.getContext('2d')
      const primarySource = isEditingImageAsset ? assetImage : video
      if (!canvas || !primarySource || !ctx || !state.videoDimensions.width) {
        if (state.isPlaying) animationFrameId.current = requestAnimationFrame(renderCanvas)
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
        )
        return
      }
      if (!video) return

      if (webcamVideo && !isTimelineScrubbing) {
        webcamVideo.playbackRate = video.playbackRate
        const drift = Math.abs(webcamVideo.currentTime - video.currentTime)
        if (state.isPlaying) {
          if (webcamVideo.paused && webcamVideo.readyState >= 2) {
            requestMediaPlayback(webcamVideo, true)
          }
          const now = performance.now()
          if (
            drift > WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS &&
            webcamVideo.readyState >= 2 &&
            !webcamVideo.seeking &&
            now - lastWebcamResyncAtRef.current >= 250
          ) {
            webcamVideo.currentTime = video.currentTime
            lastWebcamResyncAtRef.current = now
          }
        } else if (webcamVideo.readyState >= 2 && !webcamVideo.seeking && drift > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideo.currentTime = video.currentTime
        }
      }

      drawScene(
        ctx,
        state,
        video,
        webcamVideo,
        video.currentTime,
        canvas.width,
        canvas.height,
        bgImage,
        undefined,
        undefined,
        floatingMonitorSources,
      )
      if (state.isPlaying) {
        animationFrameId.current = requestAnimationFrame(renderCanvas)
      }
    }, [videoRef, bgImage, isTimelineScrubbing, isEditingImageAsset])

    useEffect(() => {
      if (isPlaying) {
        animationFrameId.current = requestAnimationFrame(renderCanvas)
      } else {
        renderCanvas()
      }
      return () => {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current)
        }
      }
    }, [isPlaying, renderCanvas])

    useEffect(() => {
      if (isPlaying) return
      renderCanvas()
    }, [
      isPlaying,
      currentTime,
      renderCanvas,
      canvasDimensions,
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
      const webcamVideo = webcamVideoRef.current
      const recordingAudio = recordingAudioRef.current
      const systemAudio = systemAudioRef.current
      const mediaAudio = mediaAudioRef.current
      if (isTimelineScrubbing) {
        requestMediaPlayback(video, false)
        requestMediaPlayback(webcamVideo, false)
        syncMediaToVideoTime(video.currentTime, false)
        return
      }
      if (isPlaying) {
        requestMediaPlayback(video, true)
        requestMediaPlayback(webcamVideo, true)
        syncMediaToVideoTime(video.currentTime, true)
      } else {
        requestMediaPlayback(video, false)
        requestMediaPlayback(webcamVideo, false)
        syncMediaToVideoTime(video.currentTime, false)
        // When pausing, reset playbackRate to 1 so scrubbing is at normal speed
        video.playbackRate = 1
        if (webcamVideo) webcamVideo.playbackRate = 1
        if (recordingAudio) recordingAudio.playbackRate = 1
        if (systemAudio) systemAudio.playbackRate = 1
        if (mediaAudio) mediaAudio.playbackRate = 1
      }
    }, [isPlaying, isTimelineScrubbing, syncMediaToVideoTime, videoRef])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      syncMediaToVideoTime(video.currentTime, isPlaying)
    }, [audioUrl, isPlaying, mediaAudioClip, syncMediaToVideoTime, systemAudioUrl, videoRef])

    useEffect(() => {
      if (isTimelineScrubbing) return
      const video = videoRef.current
      if (!video) return
      syncMediaToVideoTime(video.currentTime, !video.paused)
      renderCanvas()
    }, [isTimelineScrubbing, renderCanvas, syncMediaToVideoTime, videoRef])

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
          video.volume = volume
          video.muted = isMuted
        }
      }
      if (recordingAudio) {
        const playbackTime = video?.currentTime ?? currentTime
        const resolvedRecording = resolveRecordingForTime(playbackTime)
        recordingAudio.volume = Math.max(0, Math.min(1, volume * resolvedRecording.volumeMultiplier))
        recordingAudio.muted = isMuted
      }
      if (systemAudio) {
        const playbackTime = video?.currentTime ?? currentTime
        const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
        systemAudio.volume = Math.max(0, Math.min(1, systemAudioVolume * resolvedSystemAudio.volumeMultiplier))
        systemAudio.muted = systemAudioMuted
      }
      if (mediaAudio) {
        const playbackTime = video?.currentTime ?? currentTime
        const resolvedMedia = resolveMediaForTime(playbackTime)
        mediaAudio.volume = Math.max(0, Math.min(1, resolvedMedia.volumeMultiplier))
        mediaAudio.muted = false
      }
    }, [
      volume,
      isMuted,
      videoRef,
      hasSeparateAudioTracks,
      currentTime,
      resolveRecordingForTime,
      resolveSystemAudioForTime,
      resolveMediaForTime,
      systemAudioVolume,
      systemAudioMuted,
    ])

    const handleTimeUpdate = () => {
      if (!videoRef.current) return
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      const systemAudio = systemAudioRef.current
      const mediaAudio = mediaAudioRef.current
      let playbackTime = video.currentTime
      let shouldPlayAudio = isPlaying

      // Handle cut regions without depending on store currentTime updates during playback
      if (isPlaying) {
        const activeCutRegion = getTopActiveRegionAtTime(Object.values(cutRegions), playbackTime, timelineLanes)
        if (activeCutRegion) {
          playbackTime = activeCutRegion.startTime + activeCutRegion.duration
          video.currentTime = playbackTime
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
        video.currentTime = playbackTime
        requestMediaPlayback(video, false)
        shouldPlayAudio = false
        syncCurrentTimeToStore(playbackTime, true)
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.playbackRate = video.playbackRate // Sync webcam speed
        if (
          !isPlaying &&
          Math.abs(webcamVideoRef.current.currentTime - playbackTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideoRef.current.currentTime = playbackTime
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
      )
      const resolvedSystemAudio = resolveSystemAudioForTime(playbackTime)
      syncResolvedAudioElement(
        systemAudio,
        resolvedSystemAudio,
        systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
        video.playbackRate,
        shouldPlayAudio,
        0.1,
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
        setDuration(video.duration)
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
        video.currentTime = timeFromStore
      }
    }

    const handleWebcamLoadedMetadata = useCallback(() => {
      const mainVideo = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (mainVideo && webcamVideo) {
        webcamVideo.currentTime = mainVideo.currentTime
        if (mainVideo.paused) {
          requestMediaPlayback(webcamVideo, false)
        } else {
          requestMediaPlayback(webcamVideo, true)
        }
      }
    }, [videoRef])

    const handleRecordingAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      if (video && recordingAudio) {
        console.info(
          `[Preview] Recording audio metadata loaded: duration=${recordingAudio.duration} src=${recordingAudio.currentSrc}`,
        )
        const resolvedRecording = resolveRecordingForTime(video.currentTime)
        syncResolvedAudioElement(
          recordingAudio,
          resolvedRecording,
          volume * resolvedRecording.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
        )
      }
    }, [resolveRecordingForTime, videoRef, volume])

    const handleSystemAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const systemAudio = systemAudioRef.current
      if (video && systemAudio) {
        console.info(
          `[Preview] Computer audio metadata loaded: duration=${systemAudio.duration} src=${systemAudio.currentSrc}`,
        )
        const resolvedSystemAudio = resolveSystemAudioForTime(video.currentTime)
        systemAudio.muted = systemAudioMuted
        syncResolvedAudioElement(
          systemAudio,
          resolvedSystemAudio,
          systemAudioVolume * resolvedSystemAudio.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
        )
      }
    }, [resolveSystemAudioForTime, videoRef, systemAudioVolume, systemAudioMuted])

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
        const resolvedMedia = resolveMediaForTime(video.currentTime)
        syncResolvedAudioElement(
          mediaAudio,
          resolvedMedia,
          resolvedMedia.volumeMultiplier,
          video.playbackRate,
          !video.paused,
          0,
        )
      }
    }, [mediaAudioClip, resolveMediaForTime, setMediaAudioDuration, videoRef])

    const handleVideoPlay = useCallback(() => {
      if (isTimelineScrubbing) {
        requestMediaPlayback(videoRef.current, false)
        return
      }
      setPlaying(true)
      const video = videoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
      }
    }, [isTimelineScrubbing, setPlaying, videoRef])

    const handleVideoPause = useCallback(() => {
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
        if (
          !isTimelineScrubbing &&
          webcamVideo &&
          !webcamVideo.seeking &&
          Math.abs(webcamVideo.currentTime - video.currentTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideo.currentTime = video.currentTime
        }
      }
    }, [isTimelineScrubbing, setPlaying, videoRef, syncCurrentTimeToStore])

    const handleVideoEnded = useCallback(() => {
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
        if (
          !isTimelineScrubbing &&
          webcamVideo &&
          !webcamVideo.seeking &&
          Math.abs(webcamVideo.currentTime - video.currentTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS
        ) {
          webcamVideo.currentTime = video.currentTime
        }
      }
    }, [isTimelineScrubbing, setPlaying, videoRef, syncCurrentTimeToStore])

    const handleVideoSeeking = useCallback(() => {
      const video = videoRef.current
      if (!video) return

      if (isTimelineScrubbing) {
        requestMediaPlayback(webcamVideoRef.current, false)
        requestMediaPlayback(recordingAudioRef.current, false)
        requestMediaPlayback(systemAudioRef.current, false)
        requestMediaPlayback(mediaAudioRef.current, false)
        return
      }

      syncMediaToVideoTime(video.currentTime, false)
    }, [isTimelineScrubbing, syncMediaToVideoTime, videoRef])

    const handleVideoSeeked = useCallback(() => {
      const video = videoRef.current
      if (!video) return

      setPlaybackUiTime(video.currentTime)
      syncCurrentTimeToStore(video.currentTime, true)
      renderCanvas()
      if (!isTimelineScrubbing) {
        syncMediaToVideoTime(video.currentTime, !video.paused)
      }
    }, [isTimelineScrubbing, renderCanvas, syncCurrentTimeToStore, syncMediaToVideoTime, videoRef])

    const handleScrub = (value: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = value
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
      if (videoRef.current) {
        videoRef.current.currentTime = rewindTime
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
          className="transition-all duration-300 ease-out flex items-center justify-center w-full flex-1 min-h-0 relative"
        >
          {videoUrl ? (
            <canvas
              ref={canvasRef}
              width={canvasDimensions.width}
              height={canvasDimensions.height}
              style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
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
            onError={handleWebcamVideoError}
            style={{ display: 'none' }}
          />
        )}
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
              preload="auto"
              onLoadedMetadata={(event) => {
                const duration = event.currentTarget.duration
                if (Number.isFinite(duration) && duration > 0 && duration !== monitor.duration) {
                  updateFloatingMonitor(monitor.id, {
                    duration,
                    timelineDuration: monitor.timelineDuration > 0 ? monitor.timelineDuration : duration,
                  })
                }
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

              <div className="flex items-baseline gap-2 text-xs font-mono tabular-nums text-muted-foreground min-w-[130px] ml-2 mr-4">
                <span className="text-foreground font-semibold">{formatTime(previewTime, true)}</span>
                <span className="text-muted-foreground/50">/</span>
                <span className="text-muted-foreground">{formatTime(duration, true)}</span>
              </div>
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
