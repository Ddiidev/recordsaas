import type { AudioState, AudioActions, Slice } from '../../types'
import { DEFAULTS } from '../../lib/constants'

export const initialAudioState: AudioState = {
  volume: DEFAULTS.AUDIO.VOLUME.defaultValue,
  isMuted: DEFAULTS.AUDIO.MUTED.defaultValue,
}

export const createAudioSlice: Slice<AudioState, AudioActions> = (set, get) => ({
  ...initialAudioState,
  setVolume: (volume: number) => {
    if (get().assetTimelineEditing) return
    set((state) => {
      state.volume = Math.max(0, Math.min(DEFAULTS.AUDIO.VOLUME.max, volume))
      // Unmute if volume is adjusted above 0
      if (state.volume > 0) {
        state.isMuted = false
      }
    })
  },
  toggleMute: () => {
    if (get().assetTimelineEditing) return
    set((state) => {
      state.isMuted = !state.isMuted
    })
  },
  setIsMuted: (isMuted: boolean) => {
    if (get().assetTimelineEditing) return
    set((state) => {
      state.isMuted = isMuted
    })
  },
})
