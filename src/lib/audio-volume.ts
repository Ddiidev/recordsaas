import { DEFAULTS } from './constants'

export const MAX_AUDIO_BOOST_DB = 24

export const MAX_AMPLIFIED_AUDIO_GAIN = 10 ** (MAX_AUDIO_BOOST_DB / 20)

const clampAudioVolumeSetting = (requestedVolume: number): number =>
  Number.isFinite(requestedVolume)
    ? Math.max(DEFAULTS.AUDIO.VOLUME.min, Math.min(DEFAULTS.AUDIO.VOLUME.max, requestedVolume))
    : DEFAULTS.AUDIO.VOLUME.defaultValue

export const audioVolumeSettingToBoostDb = (requestedVolume: number): number => {
  const volume = clampAudioVolumeSetting(requestedVolume)
  if (volume <= 1) return 0

  const boostRange = DEFAULTS.AUDIO.VOLUME.max - 1
  const boostProgress = boostRange > 0 ? (volume - 1) / boostRange : 0
  return boostProgress * MAX_AUDIO_BOOST_DB
}

export const audioVolumeSettingToGain = (requestedVolume: number): number => {
  const volume = clampAudioVolumeSetting(requestedVolume)
  if (volume <= 1) return volume

  return 10 ** (audioVolumeSettingToBoostDb(volume) / 20)
}
