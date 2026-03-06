import React, { useEffect, useRef, memo, useState, useCallback } from 'react'
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
import { getTopActiveRegionAtTime, getTopRegionByPredicate } from '../../lib/timeline-lanes'
import { BlurOverlayEditor } from './preview/BlurOverlayEditor'

const PLAYBACK_UI_SYNC_INTERVAL_MS = 200
const WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS = 0.12
const WEBCAM_SCRUB_RESYNC_DRIFT_SECS = 0.02

export const Preview = memo(
  ({
    videoRef,
    onSeekFrame,
  }: {
    videoRef: React.RefObject<HTMLVideoElement>
    onSeekFrame: (direction: 'next' | 'prev') => void
  }) => {
    const {
      videoUrl,
      audioUrl,
      mediaAudioClip,
      mediaAudioRegions,
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
        mediaAudioClip: state.mediaAudioClip,
        mediaAudioRegions: state.mediaAudioRegions,
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

    const { setPlaying, setDuration, setVideoDimensions, setHasAudioTrack, setMediaAudioDuration } = useEditorStore.getState()
    const isPlaying = useEditorStore((state) => state.isPlaying)

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const recordingAudioRef = useRef<HTMLAudioElement>(null)
    const mediaAudioRef = useRef<HTMLAudioElement>(null)
    const animationFrameId = useRef<number>()
    const lastUiSyncAtRef = useRef(0)
    const [playbackUiTime, setPlaybackUiTime] = useState(0)
    const [controlBarWidth, setControlBarWidth] = useState(0)
    const hasSeparateAudioTracks = !!audioUrl || !!mediaAudioClip?.url

    const resolveRecordingForTime = useCallback(
      (playbackTime: number) => {
        if (!audioUrl) {
          return { isActive: false, sourceTime: 0, volumeMultiplier: 0 }
        }

        const activeRegion = getTopActiveRegionAtTime(Object.values(changeSoundRegions), playbackTime, timelineLanes)
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
      [audioUrl, changeSoundRegions, timelineLanes],
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
          : `media://${background.imageUrl}`
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
      const state = useEditorStore.getState()
      const ctx = canvas?.getContext('2d')
      if (!canvas || !video || !ctx || !state.videoDimensions.width) {
        if (state.isPlaying) animationFrameId.current = requestAnimationFrame(renderCanvas)
        return
      }

      if (webcamVideo) {
        webcamVideo.playbackRate = video.playbackRate
        const drift = Math.abs(webcamVideo.currentTime - video.currentTime)
        if (state.isPlaying) {
          if (webcamVideo.paused && webcamVideo.readyState >= 2) {
            webcamVideo.play().catch(() => {})
          }
          if (drift > WEBCAM_PLAYBACK_RESYNC_DRIFT_SECS) {
            webcamVideo.currentTime = video.currentTime
          }
        } else if (drift > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideo.currentTime = video.currentTime
        }
      }

      drawScene(ctx, state, video, webcamVideo, video.currentTime, canvas.width, canvas.height, bgImage)
      if (state.isPlaying) {
        animationFrameId.current = requestAnimationFrame(renderCanvas)
      }
    }, [videoRef, bgImage])

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
    ])

    useEffect(() => {
      if (!isPlaying) {
        lastUiSyncAtRef.current = 0
        setPlaybackUiTime(currentTime)
      }
    }, [
      isPlaying,
      currentTime,
    ])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      const webcamVideo = webcamVideoRef.current
      const recordingAudio = recordingAudioRef.current
      const mediaAudio = mediaAudioRef.current
      if (isPlaying) {
        video.play().catch(console.error)
        webcamVideo?.play().catch(console.error)
        if (recordingAudio) {
          const resolvedRecording = resolveRecordingForTime(video.currentTime)
          if (resolvedRecording.isActive) {
            if (Math.abs(recordingAudio.currentTime - resolvedRecording.sourceTime) > 0.1) {
              recordingAudio.currentTime = resolvedRecording.sourceTime
            }
            recordingAudio.playbackRate = video.playbackRate
            recordingAudio.volume = Math.max(0, Math.min(1, volume * resolvedRecording.volumeMultiplier))
            recordingAudio.play().catch(console.error)
          } else {
            recordingAudio.pause()
            recordingAudio.currentTime = 0
          }
        }
        if (mediaAudio) {
          const resolvedMedia = resolveMediaForTime(video.currentTime)
          if (resolvedMedia.isActive) {
            if (Math.abs(mediaAudio.currentTime - resolvedMedia.sourceTime) > 0.1) {
              mediaAudio.currentTime = resolvedMedia.sourceTime
            }
            mediaAudio.playbackRate = video.playbackRate
            mediaAudio.volume = Math.max(0, Math.min(1, volume * resolvedMedia.volumeMultiplier))
            mediaAudio.play().catch(console.error)
          } else {
            mediaAudio.pause()
            mediaAudio.currentTime = 0
          }
        }
      } else {
        video.pause()
        webcamVideo?.pause()
        recordingAudio?.pause()
        mediaAudio?.pause()
        // When pausing, reset playbackRate to 1 so scrubbing is at normal speed
        video.playbackRate = 1
        if (webcamVideo) webcamVideo.playbackRate = 1
        if (recordingAudio) recordingAudio.playbackRate = 1
        if (mediaAudio) mediaAudio.playbackRate = 1
      }
    }, [isPlaying, resolveRecordingForTime, resolveMediaForTime, videoRef, volume])

    useEffect(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      if (!video || !recordingAudio) return

      const resolvedRecording = resolveRecordingForTime(video.currentTime)
      if (!resolvedRecording.isActive) {
        recordingAudio.pause()
        recordingAudio.currentTime = 0
        return
      }

      if (Math.abs(recordingAudio.currentTime - resolvedRecording.sourceTime) > 0.1) {
        recordingAudio.currentTime = resolvedRecording.sourceTime
      }
      recordingAudio.volume = Math.max(0, Math.min(1, volume * resolvedRecording.volumeMultiplier))
      if (!isPlaying) {
        recordingAudio.pause()
      }
    }, [audioUrl, isPlaying, resolveRecordingForTime, videoRef, volume])

    useEffect(() => {
      const video = videoRef.current
      const mediaAudio = mediaAudioRef.current
      if (!video || !mediaAudio) return

      const resolvedMedia = resolveMediaForTime(video.currentTime)
      if (!resolvedMedia.isActive) {
        mediaAudio.pause()
        mediaAudio.currentTime = 0
        return
      }

      if (Math.abs(mediaAudio.currentTime - resolvedMedia.sourceTime) > 0.1) {
        mediaAudio.currentTime = resolvedMedia.sourceTime
      }
      mediaAudio.volume = Math.max(0, Math.min(1, volume * resolvedMedia.volumeMultiplier))
      if (!isPlaying) {
        mediaAudio.pause()
      }
    }, [mediaAudioClip?.url, isPlaying, resolveMediaForTime, videoRef, volume])

    // Effect to handle volume and mute state
    useEffect(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
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
      if (mediaAudio) {
        const playbackTime = video?.currentTime ?? currentTime
        const resolvedMedia = resolveMediaForTime(playbackTime)
        mediaAudio.volume = Math.max(0, Math.min(1, volume * resolvedMedia.volumeMultiplier))
        mediaAudio.muted = isMuted
      }
    }, [volume, isMuted, videoRef, hasSeparateAudioTracks, currentTime, resolveRecordingForTime, resolveMediaForTime])

    const handleTimeUpdate = () => {
      if (!videoRef.current) return
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      const mediaAudio = mediaAudioRef.current
      let playbackTime = video.currentTime

      // Handle cut regions without depending on store currentTime updates during playback
      if (isPlaying) {
        const activeCutRegion = getTopActiveRegionAtTime(Object.values(cutRegions), playbackTime, timelineLanes)
        if (activeCutRegion) {
          playbackTime = activeCutRegion.startTime + activeCutRegion.duration
          video.currentTime = playbackTime
          const resolvedRecording = resolveRecordingForTime(playbackTime)
          const resolvedMedia = resolveMediaForTime(playbackTime)

          if (recordingAudio) {
            if (resolvedRecording.isActive) {
              recordingAudio.currentTime = resolvedRecording.sourceTime
            } else {
              recordingAudio.pause()
              recordingAudio.currentTime = 0
            }
          }
          if (mediaAudio) {
            if (resolvedMedia.isActive) {
              mediaAudio.currentTime = resolvedMedia.sourceTime
            } else {
              mediaAudio.pause()
              mediaAudio.currentTime = 0
            }
          }
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
      if (endTrimRegion && playbackTime >= endTrimRegion.startTime) {
        playbackTime = endTrimRegion.startTime
        video.currentTime = playbackTime
        video.pause()
        if (recordingAudio) {
          const resolvedRecording = resolveRecordingForTime(playbackTime)
          recordingAudio.currentTime = resolvedRecording.isActive ? resolvedRecording.sourceTime : 0
          recordingAudio.pause()
        }
        if (mediaAudio) {
          const resolvedMedia = resolveMediaForTime(playbackTime)
          mediaAudio.currentTime = resolvedMedia.isActive ? resolvedMedia.sourceTime : 0
          mediaAudio.pause()
        }
        syncCurrentTimeToStore(playbackTime, true)
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.playbackRate = video.playbackRate // Sync webcam speed
        if (!isPlaying && Math.abs(webcamVideoRef.current.currentTime - playbackTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideoRef.current.currentTime = playbackTime
        }
      }
      if (recordingAudio) {
        const resolvedRecording = resolveRecordingForTime(playbackTime)
        if (resolvedRecording.isActive) {
          if (Math.abs(recordingAudio.currentTime - resolvedRecording.sourceTime) > 0.1) {
            recordingAudio.currentTime = resolvedRecording.sourceTime
          }
          recordingAudio.volume = Math.max(0, Math.min(1, volume * resolvedRecording.volumeMultiplier))
          recordingAudio.playbackRate = video.playbackRate
          if (isPlaying && recordingAudio.paused) {
            recordingAudio.play().catch(console.error)
          }
        } else {
          if (!recordingAudio.paused) {
            recordingAudio.pause()
          }
          recordingAudio.currentTime = 0
        }
      }
      if (mediaAudio) {
        const resolvedMedia = resolveMediaForTime(playbackTime)
        if (resolvedMedia.isActive) {
          if (Math.abs(mediaAudio.currentTime - resolvedMedia.sourceTime) > 0.1) {
            mediaAudio.currentTime = resolvedMedia.sourceTime
          }
          mediaAudio.volume = Math.max(0, Math.min(1, volume * resolvedMedia.volumeMultiplier))
          mediaAudio.playbackRate = video.playbackRate
          if (isPlaying && mediaAudio.paused) {
            mediaAudio.play().catch(console.error)
          }
        } else {
          if (!mediaAudio.paused) {
            mediaAudio.pause()
          }
          mediaAudio.currentTime = 0
        }
      }

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

    const handleLoadedMetadata = () => {
      const video = videoRef.current
      if (video) {
        setDuration(video.duration)
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight })

        // Only check video for audio tracks if we don't have a separate audio file
        const store = useEditorStore.getState()
        if (!store.audioUrl) {
          // Check for audio tracks using type-safe checks
          const hasAudioTracks = video.audioTracks && video.audioTracks.length > 0
          const hasMozAudio = 'mozHasAudio' in video && video.mozHasAudio === true
          const hasWebkitAudio = 'webkitHasAudio' in video && video.webkitHasAudio === true

          setHasAudioTrack(!!(hasAudioTracks || hasMozAudio || hasWebkitAudio))
        }

        const timeFromStore = useEditorStore.getState().currentTime

        const onSeekComplete = () => {
          renderCanvas()
          video.removeEventListener('seeked', onSeekComplete)
        }

        video.addEventListener('seeked', onSeekComplete)
        // Restore the video's time from the store to prevent rewinding
        video.currentTime = timeFromStore
      }
    }

    const handleWebcamLoadedMetadata = useCallback(() => {
      const mainVideo = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (mainVideo && webcamVideo) {
        webcamVideo.currentTime = mainVideo.currentTime
        if (mainVideo.paused) {
          webcamVideo.pause()
        } else {
          webcamVideo.play().catch(console.error)
        }
      }
    }, [videoRef])

    const handleRecordingAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const recordingAudio = recordingAudioRef.current
      if (video && recordingAudio) {
        const resolvedRecording = resolveRecordingForTime(video.currentTime)
        if (!resolvedRecording.isActive) {
          recordingAudio.pause()
          recordingAudio.currentTime = 0
        } else {
          recordingAudio.currentTime = resolvedRecording.sourceTime
          recordingAudio.volume = Math.max(0, Math.min(1, volume * resolvedRecording.volumeMultiplier))
          if (video.paused) {
            recordingAudio.pause()
          } else {
            recordingAudio.play().catch(console.error)
          }
        }
      }
    }, [resolveRecordingForTime, videoRef, volume])

    const handleMediaAudioLoadedMetadata = useCallback(() => {
      const video = videoRef.current
      const mediaAudio = mediaAudioRef.current
      if (video && mediaAudio) {
        if (mediaAudioClip && Number.isFinite(mediaAudio.duration)) {
          setMediaAudioDuration(mediaAudio.duration)
        }
        const resolvedMedia = resolveMediaForTime(video.currentTime)

        if (!resolvedMedia.isActive) {
          mediaAudio.pause()
          mediaAudio.currentTime = 0
        } else {
          mediaAudio.currentTime = resolvedMedia.sourceTime
          mediaAudio.volume = Math.max(0, Math.min(1, volume * resolvedMedia.volumeMultiplier))
          if (video.paused) {
            mediaAudio.pause()
          } else {
            mediaAudio.play().catch(console.error)
          }
        }
      }
    }, [mediaAudioClip, resolveMediaForTime, setMediaAudioDuration, videoRef, volume])

    const handleVideoPlay = useCallback(() => {
      setPlaying(true)
      const video = videoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
      }
    }, [setPlaying, videoRef])

    const handleVideoPause = useCallback(() => {
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
        if (webcamVideo && Math.abs(webcamVideo.currentTime - video.currentTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideo.currentTime = video.currentTime
        }
      }
    }, [setPlaying, videoRef, syncCurrentTimeToStore])

    const handleVideoEnded = useCallback(() => {
      setPlaying(false)
      const video = videoRef.current
      const webcamVideo = webcamVideoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
        if (webcamVideo && Math.abs(webcamVideo.currentTime - video.currentTime) > WEBCAM_SCRUB_RESYNC_DRIFT_SECS) {
          webcamVideo.currentTime = video.currentTime
        }
      }
    }, [setPlaying, videoRef, syncCurrentTimeToStore])

    const handleScrub = (value: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = value
        setPlaybackUiTime(value)
        syncCurrentTimeToStore(value, true)
      }
      if (webcamVideoRef.current) {
        webcamVideoRef.current.currentTime = value
      }
      if (recordingAudioRef.current) {
        const resolvedRecording = resolveRecordingForTime(value)
        recordingAudioRef.current.currentTime = resolvedRecording.isActive ? resolvedRecording.sourceTime : 0
      }
      if (mediaAudioRef.current) {
        const resolvedMedia = resolveMediaForTime(value)
        mediaAudioRef.current.currentTime = resolvedMedia.isActive ? resolvedMedia.sourceTime : 0
      }
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
      if (webcamVideoRef.current) {
        webcamVideoRef.current.currentTime = rewindTime
      }
      if (recordingAudioRef.current) {
        const resolvedRecording = resolveRecordingForTime(rewindTime)
        recordingAudioRef.current.currentTime = resolvedRecording.isActive ? resolvedRecording.sourceTime : 0
      }
      if (mediaAudioRef.current) {
        const resolvedMedia = resolveMediaForTime(rewindTime)
        mediaAudioRef.current.currentTime = resolvedMedia.isActive ? resolvedMedia.sourceTime : 0
      }
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
        </div>

        <video
          ref={videoRef}
          src={videoUrl || undefined}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={handleVideoPlay}
          onPause={handleVideoPause}
          onEnded={handleVideoEnded}
          style={{ display: 'none' }}
        />
        {audioUrl && (
          <audio
            ref={recordingAudioRef}
            src={audioUrl}
            onLoadedMetadata={handleRecordingAudioLoadedMetadata}
            style={{ display: 'none' }}
          />
        )}
        {mediaAudioClip?.url && (
          <audio
            ref={mediaAudioRef}
            src={mediaAudioClip.url}
            onLoadedMetadata={handleMediaAudioLoadedMetadata}
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
            style={{ display: 'none' }}
          />
        )}

        {/* Control bar */}
        {videoUrl && (
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
