import React, { useEffect, useRef, memo, useState, useCallback } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { Movie } from 'tabler-icons-react'
import { FullscreenIcon, ExitFullscreenIcon } from '../ui/icons'
import {
  PlayerPlay,
  PlayerTrackPrev as RewindIcon,
  PlayerPause,
  PlayerSkipBack,
  PlayerSkipForward,
} from 'tabler-icons-react'
import { useShallow } from 'zustand/react/shallow'
import { formatTime } from '../../lib/utils'
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { drawScene } from '../../lib/renderer'
import { cn } from '../../lib/utils'
import { toMediaUrl } from '../../lib/media'
import { getTopActiveRegionAtTime, getTopRegionByPredicate } from '../../lib/timeline-lanes'
import { BlurOverlayEditor } from './preview/BlurOverlayEditor'

const PLAYBACK_UI_SYNC_INTERVAL_MS = 200

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
      micAudioUrl,
      systemAudioUrl,
      audioUrl,
      zoomRegions,
      cutRegions,
      speedRegions,
      blurRegions,
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
      webcamPosition,
      webcamStyles,
      videoDimensions,
      canvasDimensions,
      masterVolume,
      masterMuted,
      micVolume,
      micMuted,
      systemVolume,
      systemMuted,
      setCurrentTime,
      setCurrentTimeThrottled,
      setSelectedRegionId,
      updateRegion,
      cursorStyles,
      cursorBitmapsToRender,
    } = useEditorStore(
      useShallow((state) => ({
        videoUrl: state.videoUrl,
        micAudioUrl: state.micAudioUrl,
        systemAudioUrl: state.systemAudioUrl,
        audioUrl: state.audioUrl,
        zoomRegions: state.zoomRegions,
        cutRegions: state.cutRegions,
        speedRegions: state.speedRegions,
        blurRegions: state.blurRegions,
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
        webcamPosition: state.webcamPosition,
        webcamStyles: state.webcamStyles,
        videoDimensions: state.videoDimensions,
        canvasDimensions: state.canvasDimensions,
        masterVolume: state.masterVolume,
        masterMuted: state.masterMuted,
        micVolume: state.micVolume,
        micMuted: state.micMuted,
        systemVolume: state.systemVolume,
        systemMuted: state.systemMuted,
        setCurrentTime: state.setCurrentTime,
        setCurrentTimeThrottled: state.setCurrentTimeThrottled,
        setSelectedRegionId: state.setSelectedRegionId,
        updateRegion: state.updateRegion,
        cursorStyles: state.cursorStyles,
        cursorBitmapsToRender: state.cursorBitmapsToRender,
      })),
    )

    const { setPlaying, setDuration, setVideoDimensions, setHasAudioTrack } = useEditorStore.getState()
    const isPlaying = useEditorStore((state) => state.isPlaying)

    const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const webcamVideoRef = useRef<HTMLVideoElement>(null)
    const micAudioRef = useRef<HTMLAudioElement>(null)
    const systemAudioRef = useRef<HTMLAudioElement>(null)
    const legacyAudioRef = useRef<HTMLAudioElement>(null)
    const animationFrameId = useRef<number>()
    const lastUiSyncAtRef = useRef(0)
    const [playbackUiTime, setPlaybackUiTime] = useState(0)
    const [controlBarWidth, setControlBarWidth] = useState(0)

    // --- Start of Changes for Fullscreen Controls ---
    const [isControlBarVisible, setIsControlBarVisible] = useState(false)
    const [isCursorHidden, setIsCursorHidden] = useState(false)
    const inactivityTimerRef = useRef<number | null>(null)
    const previewContainerRef = useRef<HTMLDivElement>(null)
    const hasSeparateAudioTracks = Boolean(micAudioUrl || systemAudioUrl)
    const legacyAudioUrl = hasSeparateAudioTracks ? null : audioUrl

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
        const finalUrl = toMediaUrl(background.imageUrl)
        if (finalUrl) {
          img.src = finalUrl
        } else {
          setBgImage(null)
        }
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
      timelineLanes,
      isWebcamVisible,
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
      const audioElements = [micAudioRef.current, systemAudioRef.current, legacyAudioRef.current].filter(
        Boolean,
      ) as HTMLAudioElement[]
      if (isPlaying) {
        video.play().catch(console.error)
        webcamVideo?.play().catch(console.error)
        audioElements.forEach((audio) => audio.play().catch(console.error))
      } else {
        video.pause()
        webcamVideo?.pause()
        audioElements.forEach((audio) => audio.pause())
        // When pausing, reset playbackRate to 1 so scrubbing is at normal speed
        video.playbackRate = 1
        if (webcamVideo) webcamVideo.playbackRate = 1
        audioElements.forEach((audio) => {
          audio.playbackRate = 1
        })
      }
    }, [isPlaying, videoRef])

    // Effect to handle volume and mute state
    useEffect(() => {
      const video = videoRef.current
      const micAudio = micAudioRef.current
      const systemAudio = systemAudioRef.current
      const legacyAudio = legacyAudioRef.current
      if (video) {
        // Video is always muted when we have separate audio tracks.
        if (hasSeparateAudioTracks || legacyAudioUrl) {
          video.muted = true
        } else {
          // No separate audio, use video's own audio
          video.volume = masterVolume
          video.muted = masterMuted
        }
      }

      if (micAudio) {
        micAudio.volume = masterVolume * micVolume
        micAudio.muted = masterMuted || micMuted
      }
      if (systemAudio) {
        systemAudio.volume = masterVolume * systemVolume
        systemAudio.muted = masterMuted || systemMuted
      }
      if (legacyAudio) {
        legacyAudio.volume = masterVolume
        legacyAudio.muted = masterMuted
      }
    }, [
      masterVolume,
      masterMuted,
      micVolume,
      micMuted,
      systemVolume,
      systemMuted,
      hasSeparateAudioTracks,
      legacyAudioUrl,
      videoRef,
    ])

    const handleTimeUpdate = () => {
      if (!videoRef.current) return
      const video = videoRef.current
      const audioElements = [micAudioRef.current, systemAudioRef.current, legacyAudioRef.current].filter(
        Boolean,
      ) as HTMLAudioElement[]
      let playbackTime = video.currentTime

      // Handle cut regions without depending on store currentTime updates during playback
      if (isPlaying) {
        const activeCutRegion = getTopActiveRegionAtTime(Object.values(cutRegions), playbackTime, timelineLanes)
        if (activeCutRegion) {
          playbackTime = activeCutRegion.startTime + activeCutRegion.duration
          video.currentTime = playbackTime
          // Sync audio with the jump
          audioElements.forEach((audio) => {
            audio.currentTime = playbackTime
          })
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
        // Also pause audio
        audioElements.forEach((audio) => {
          audio.currentTime = playbackTime
          audio.pause()
        })
        syncCurrentTimeToStore(playbackTime, true)
      }
      if (webcamVideoRef.current) {
        // Only sync webcam when drift exceeds 0.3s to avoid expensive seeks every frame
        if (Math.abs(webcamVideoRef.current.currentTime - playbackTime) > 0.3) {
          webcamVideoRef.current.currentTime = playbackTime
        }
        webcamVideoRef.current.playbackRate = video.playbackRate // Sync webcam speed
      }
      audioElements.forEach((audio) => {
        if (Math.abs(audio.currentTime - playbackTime) > 0.1) {
          audio.currentTime = playbackTime
        }
        audio.playbackRate = video.playbackRate
      })

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

        // Only check video for embedded audio if we don't have separate audio tracks.
        const store = useEditorStore.getState()
        if (!store.micAudioUrl && !store.systemAudioUrl && !legacyAudioUrl) {
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

    const syncAudioElementToVideo = useCallback(
      (audio: HTMLAudioElement | null) => {
        const video = videoRef.current
        if (video && audio) {
          audio.currentTime = video.currentTime
          if (video.paused) {
            audio.pause()
          } else {
            audio.play().catch(console.error)
          }
        }
      },
      [videoRef],
    )

    const handleMicAudioLoadedMetadata = useCallback(() => {
      syncAudioElementToVideo(micAudioRef.current)
    }, [syncAudioElementToVideo])

    const handleSystemAudioLoadedMetadata = useCallback(() => {
      syncAudioElementToVideo(systemAudioRef.current)
    }, [syncAudioElementToVideo])

    const handleLegacyAudioLoadedMetadata = useCallback(() => {
      syncAudioElementToVideo(legacyAudioRef.current)
    }, [syncAudioElementToVideo])

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
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
      }
    }, [setPlaying, videoRef, syncCurrentTimeToStore])

    const handleVideoEnded = useCallback(() => {
      setPlaying(false)
      const video = videoRef.current
      if (video) {
        setPlaybackUiTime(video.currentTime)
        syncCurrentTimeToStore(video.currentTime, true)
      }
    }, [setPlaying, videoRef, syncCurrentTimeToStore])

    const handleScrub = (value: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = value
        setPlaybackUiTime(value)
        syncCurrentTimeToStore(value, true)
      }
      ;[micAudioRef.current, systemAudioRef.current, legacyAudioRef.current].forEach((audio) => {
        if (audio) audio.currentTime = value
      })
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
      ;[micAudioRef.current, systemAudioRef.current, legacyAudioRef.current].forEach((audio) => {
        if (audio) audio.currentTime = rewindTime
      })
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
            <div className="w-full h-full bg-gradient-to-br from-muted/30 to-muted/10 border-2 border-dashed border-border/40 rounded-xl flex flex-col items-center justify-center text-muted-foreground gap-4 backdrop-blur-sm">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center backdrop-blur-md border border-border/30 shadow-md">
                <Movie className="w-10 h-10 text-primary/60" />
              </div>
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
        {micAudioUrl && (
          <audio
            ref={micAudioRef}
            src={micAudioUrl}
            onLoadedMetadata={handleMicAudioLoadedMetadata}
            style={{ display: 'none' }}
          />
        )}
        {systemAudioUrl && (
          <audio
            ref={systemAudioRef}
            src={systemAudioUrl}
            onLoadedMetadata={handleSystemAudioLoadedMetadata}
            style={{ display: 'none' }}
          />
        )}
        {legacyAudioUrl && (
          <audio
            ref={legacyAudioRef}
            src={legacyAudioUrl}
            onLoadedMetadata={handleLegacyAudioLoadedMetadata}
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
              className="bg-card/95 backdrop-blur-xl border border-border/40 shadow-md rounded-xl px-3 py-2 flex items-center gap-2 max-w-full mx-auto"
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
                className="flex-shrink-0 text-foreground hover:text-foreground hover:bg-accent h-10 w-10 rounded-xl transition-all duration-150"
              >
                {isPlaying ? <PlayerPause className="w-4 h-4" /> : <PlayerPlay className="w-4 h-4 ml-0.5" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRewind}
                title="Rewind to Start"
                className="flex-shrink-0 text-foreground hover:text-foreground hover:bg-accent h-10 w-10 rounded-xl transition-all duration-150"
              >
                <RewindIcon className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('prev')}
                title="Previous Frame (J)"
                className="flex-shrink-0 text-foreground hover:text-foreground hover:bg-accent h-10 w-10 rounded-xl transition-all duration-150"
              >
                <PlayerSkipBack className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onSeekFrame('next')}
                title="Next Frame (K)"
                className="flex-shrink-0 text-foreground hover:text-foreground hover:bg-accent h-10 w-10 rounded-xl transition-all duration-150"
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
                className="flex-shrink-0 text-foreground hover:text-foreground hover:bg-accent h-10 w-10 rounded-xl transition-all duration-150"
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
