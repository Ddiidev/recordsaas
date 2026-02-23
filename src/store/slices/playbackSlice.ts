import type { PlaybackState, PlaybackActions, Slice } from '../../types'
import { getTopActiveRegionAtTime } from '../../lib/timeline-lanes'

const PLAYBACK_STORE_SYNC_INTERVAL_MS = 200

export const initialPlaybackState: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
}

export const createPlaybackSlice: Slice<PlaybackState, PlaybackActions> = (set, get) => {
  let lastThrottledSyncAt = 0

  const applyCurrentTime = (time: number, computeActiveRegions: boolean) => {
    set((state) => {
      state.currentTime = time

      if (!computeActiveRegions) return

      const lanes = state.timelineLanes
      const allZoomRegions = Object.values(state.zoomRegions)
      const allCutRegions = Object.values(state.cutRegions)

      const newActiveRegion = getTopActiveRegionAtTime(allZoomRegions, time, lanes)
      state.activeZoomRegionId = newActiveRegion?.id ?? null

      const activeCutRegion = getTopActiveRegionAtTime(allCutRegions, time, lanes)
      state.isCurrentlyCut = !!activeCutRegion
    })
  }

  const stopPlayback = () => {
    lastThrottledSyncAt = 0
    set((state) => {
      state.isPlaying = false
    })
  }

  return {
    ...initialPlaybackState,
    setCurrentTime: (time) => {
      // Keep playback path lightweight by skipping expensive active-region lookups while playing.
      const computeActiveRegions = !get().isPlaying
      applyCurrentTime(time, computeActiveRegions)
    },
    setCurrentTimeThrottled: (time) => {
      if (!get().isPlaying) {
        applyCurrentTime(time, true)
        return
      }

      const now = Date.now()
      if (now - lastThrottledSyncAt < PLAYBACK_STORE_SYNC_INTERVAL_MS) return
      lastThrottledSyncAt = now

      applyCurrentTime(time, false)
    },
    togglePlay: () => {
      const nextPlaying = !get().isPlaying
      if (!nextPlaying) lastThrottledSyncAt = 0

      set((state) => {
        state.isPlaying = nextPlaying
      })
    },
    setPlaying: (isPlaying) => {
      if (!isPlaying) lastThrottledSyncAt = 0

      set((state) => {
        state.isPlaying = isPlaying
      })
    },
    seekToPreviousFrame: () => {
      const { isPlaying, currentTime } = get()
      if (isPlaying) stopPlayback()
      const frameDuration = 1 / 30 // Assuming 30 FPS for frame-by-frame seeking
      const newTime = Math.max(0, currentTime - frameDuration)
      get().setCurrentTime(newTime)
    },
    seekToNextFrame: () => {
      const { isPlaying, currentTime, duration } = get()
      if (isPlaying) stopPlayback()
      const frameDuration = 1 / 30 // Assuming 30 FPS
      const newTime = Math.min(duration, currentTime + frameDuration)
      get().setCurrentTime(newTime)
    },
    seekBackward: (seconds) => {
      const { isPlaying, currentTime } = get()
      if (isPlaying) stopPlayback()
      const newTime = Math.max(0, currentTime - seconds)
      get().setCurrentTime(newTime)
    },
    seekForward: (seconds) => {
      const { isPlaying, currentTime, duration } = get()
      if (isPlaying) stopPlayback()
      const newTime = Math.min(duration, currentTime + seconds)
      get().setCurrentTime(newTime)
    },
  }
}
