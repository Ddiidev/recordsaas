import type { AudioState, AudioActions, Slice } from '../../types'
import { DEFAULTS } from '../../lib/constants'

const clampVolume = (volume: number) => Math.max(0, Math.min(1, volume))

export const initialAudioState: AudioState = {
  masterVolume: DEFAULTS.AUDIO.MASTER_VOLUME.defaultValue,
  masterMuted: DEFAULTS.AUDIO.MASTER_MUTED.defaultValue,
  micVolume: DEFAULTS.AUDIO.MIC_VOLUME.defaultValue,
  micMuted: DEFAULTS.AUDIO.MIC_MUTED.defaultValue,
  systemVolume: DEFAULTS.AUDIO.SYSTEM_VOLUME.defaultValue,
  systemMuted: DEFAULTS.AUDIO.SYSTEM_MUTED.defaultValue,
  // Legacy aliases (master channel).
  volume: DEFAULTS.AUDIO.VOLUME.defaultValue,
  isMuted: DEFAULTS.AUDIO.MUTED.defaultValue,
}

export const createAudioSlice: Slice<AudioState, AudioActions> = (set) => ({
  ...initialAudioState,
  setMasterVolume: (volume: number) => {
    set((state) => {
      state.masterVolume = clampVolume(volume)
      state.volume = state.masterVolume
      if (state.masterVolume > 0) {
        state.masterMuted = false
        state.isMuted = false
      }
    })
  },
  toggleMasterMute: () => {
    set((state) => {
      state.masterMuted = !state.masterMuted
      state.isMuted = state.masterMuted
    })
  },
  setMasterMuted: (isMuted: boolean) => {
    set((state) => {
      state.masterMuted = isMuted
      state.isMuted = isMuted
    })
  },
  setMicVolume: (volume: number) => {
    set((state) => {
      state.micVolume = clampVolume(volume)
      if (state.micVolume > 0) {
        state.micMuted = false
      }
    })
  },
  toggleMicMute: () => {
    set((state) => {
      state.micMuted = !state.micMuted
    })
  },
  setMicMuted: (isMuted: boolean) => {
    set((state) => {
      state.micMuted = isMuted
    })
  },
  setSystemVolume: (volume: number) => {
    set((state) => {
      state.systemVolume = clampVolume(volume)
      if (state.systemVolume > 0) {
        state.systemMuted = false
      }
    })
  },
  toggleSystemMute: () => {
    set((state) => {
      state.systemMuted = !state.systemMuted
    })
  },
  setSystemMuted: (isMuted: boolean) => {
    set((state) => {
      state.systemMuted = isMuted
    })
  },
  // Legacy wrappers mapped to master controls.
  setVolume: (volume: number) => {
    set((state) => {
      state.masterVolume = clampVolume(volume)
      state.volume = state.masterVolume
      if (state.masterVolume > 0) {
        state.masterMuted = false
        state.isMuted = false
      }
    })
  },
  toggleMute: () => {
    set((state) => {
      state.masterMuted = !state.masterMuted
      state.isMuted = state.masterMuted
    })
  },
  setIsMuted: (isMuted: boolean) => {
    set((state) => {
      state.masterMuted = isMuted
      state.isMuted = isMuted
    })
  },
})
