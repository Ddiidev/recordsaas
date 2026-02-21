import type { AudioState, AudioActions, Slice } from '../../types'
import { DEFAULTS } from '../../lib/constants'

export const initialAudioState: AudioState = {
  volume: DEFAULTS.AUDIO.VOLUME.defaultValue,
  isMuted: DEFAULTS.AUDIO.MUTED.defaultValue,
}

export const createAudioSlice: Slice<AudioState, AudioActions> = (set) => ({
  ...initialAudioState,
  setVolume: (volume: number) => {
    set((state) => {
      // Clamp volume between 0 and 1
      state.volume = Math.max(0, Math.min(1, volume))
      // Unmute if volume is adjusted above 0
      if (state.volume > 0) {
        state.isMuted = false
      }
    })
  },
  toggleMute: () => {
    set((state) => {
      state.isMuted = !state.isMuted
    })
  },
  setIsMuted: (isMuted: boolean) => {
    set((state) => {
      state.isMuted = isMuted
    })
  },
})
