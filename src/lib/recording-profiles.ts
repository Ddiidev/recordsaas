export type RecordingResolution = 'native' | 'sd' | 'hd' | 'full-hd' | '2k'
export type RecordingScreenFps = 30 | 60 | 120
export type RecordingWebcamFps = 'synced' | 30 | 60
export type RecordingAudioCodec = 'aac' | 'mp3'
export type RecordingAudioBitrateKbps = 128 | 192 | 320
export type RecordingAudioSampleRate = 44100 | 48000

export type RecordingProfile = {
  id: string
  name: string
  isNative?: boolean
  screenResolution: RecordingResolution
  screenFps: RecordingScreenFps
  webcamResolution: RecordingResolution
  webcamFps: RecordingWebcamFps
  audioCodec: RecordingAudioCodec
  audioBitrateKbps: RecordingAudioBitrateKbps
  audioSampleRate: RecordingAudioSampleRate
}

export type RecordingCapabilityAnalysis = {
  recommendedFps: 30 | 60
  canRecord60Fps: boolean
  reason: string
  measuredFps?: number
}

export const NATIVE_RECORDING_PROFILE_ID = 'native-adaptive'
export const RECORDING_PROFILES_SETTING_KEY = 'recorder.recordingProfiles'
export const SELECTED_RECORDING_PROFILE_SETTING_KEY = 'recorder.selectedRecordingProfileId'
export const NATIVE_RECORDING_ANALYSIS_SETTING_KEY = 'recorder.nativeRecordingCapability'

export const RESOLUTION_LABELS: Record<RecordingResolution, string> = {
  native: 'Native (Recommended)',
  sd: 'SD',
  hd: 'HD',
  'full-hd': 'Full HD',
  '2k': '2K',
}

export const SCREEN_FPS_OPTIONS: RecordingScreenFps[] = [30, 60, 120]
export const WEBCAM_FPS_OPTIONS: RecordingWebcamFps[] = ['synced', 30, 60]
export const RESOLUTION_OPTIONS: RecordingResolution[] = ['native', 'sd', 'hd', 'full-hd', '2k']
export const AUDIO_CODEC_OPTIONS: RecordingAudioCodec[] = ['aac', 'mp3']
export const AUDIO_BITRATE_OPTIONS: RecordingAudioBitrateKbps[] = [128, 192, 320]
export const AUDIO_SAMPLE_RATE_OPTIONS: RecordingAudioSampleRate[] = [44100, 48000]
export const AUDIO_CODEC_LABELS: Record<RecordingAudioCodec, string> = {
  aac: 'AAC',
  mp3: 'MP3',
}

const isRecordingAudioCodec = (value: unknown): value is RecordingAudioCodec =>
  value === 'aac' || value === 'mp3'

const isRecordingAudioBitrateKbps = (value: unknown): value is RecordingAudioBitrateKbps =>
  value === 128 || value === 192 || value === 320

const isRecordingAudioSampleRate = (value: unknown): value is RecordingAudioSampleRate =>
  value === 44100 || value === 48000

const normalizeRecordingAudioCodec = (value: unknown, fallback: RecordingAudioCodec): RecordingAudioCodec =>
  isRecordingAudioCodec(value) ? value : fallback

const normalizeRecordingAudioBitrateKbps = (
  value: unknown,
  fallback: RecordingAudioBitrateKbps,
): RecordingAudioBitrateKbps => (isRecordingAudioBitrateKbps(value) ? value : fallback)

const normalizeRecordingAudioSampleRate = (
  value: unknown,
  fallback: RecordingAudioSampleRate,
): RecordingAudioSampleRate => (isRecordingAudioSampleRate(value) ? value : fallback)

export const createNativeRecordingProfile = (
  recommendedFps: 30 | 60 = 30,
  overrides: Partial<Pick<RecordingProfile, 'audioCodec' | 'audioBitrateKbps' | 'audioSampleRate'>> | null = {},
): RecordingProfile => {
  const audioOverrides = overrides && typeof overrides === 'object' ? overrides : {}

  return {
    id: NATIVE_RECORDING_PROFILE_ID,
    name: 'Native Adaptive (Recommended)',
    isNative: true,
    screenResolution: 'native',
    screenFps: recommendedFps,
    webcamResolution: 'native',
    webcamFps: 30,
    audioCodec: normalizeRecordingAudioCodec((audioOverrides as Partial<RecordingProfile>).audioCodec, 'aac'),
    audioBitrateKbps: normalizeRecordingAudioBitrateKbps(
      (audioOverrides as Partial<RecordingProfile>).audioBitrateKbps,
      192,
    ),
    audioSampleRate: normalizeRecordingAudioSampleRate(
      (audioOverrides as Partial<RecordingProfile>).audioSampleRate,
      48000,
    ),
  }
}

export const isRecordingCapabilityAnalysis = (value: unknown): value is RecordingCapabilityAnalysis => {
  if (!value || typeof value !== 'object') return false

  const source = value as Partial<RecordingCapabilityAnalysis>
  const hasMeasuredFps =
    source.measuredFps === undefined || (typeof source.measuredFps === 'number' && Number.isFinite(source.measuredFps))

  return (
    (source.recommendedFps === 30 || source.recommendedFps === 60) &&
    typeof source.canRecord60Fps === 'boolean' &&
    typeof source.reason === 'string' &&
    source.reason.trim().length > 0 &&
    hasMeasuredFps
  )
}

export const normalizeRecordingProfile = (
  value: Partial<RecordingProfile> | null | undefined,
  fallback: RecordingProfile,
): RecordingProfile => {
  const source = value && typeof value === 'object' ? value : {}
  const isNative = source.id === NATIVE_RECORDING_PROFILE_ID || source.isNative === true

  if (isNative) {
    return {
      ...createNativeRecordingProfile(fallback.screenFps === 60 ? 60 : 30, {
        audioCodec: normalizeRecordingAudioCodec(source.audioCodec, fallback.audioCodec),
        audioBitrateKbps: normalizeRecordingAudioBitrateKbps(source.audioBitrateKbps, fallback.audioBitrateKbps),
        audioSampleRate: normalizeRecordingAudioSampleRate(source.audioSampleRate, fallback.audioSampleRate),
      }),
      screenFps: SCREEN_FPS_OPTIONS.includes(source.screenFps as RecordingScreenFps)
        ? (source.screenFps as RecordingScreenFps)
        : fallback.screenFps,
    }
  }

  const screenResolution = RESOLUTION_OPTIONS.includes(source.screenResolution as RecordingResolution)
    ? (source.screenResolution as RecordingResolution)
    : fallback.screenResolution
  const webcamResolution = RESOLUTION_OPTIONS.includes(source.webcamResolution as RecordingResolution)
    ? (source.webcamResolution as RecordingResolution)
    : fallback.webcamResolution
  const screenFps = SCREEN_FPS_OPTIONS.includes(source.screenFps as RecordingScreenFps)
    ? (source.screenFps as RecordingScreenFps)
    : fallback.screenFps
  const webcamFps = WEBCAM_FPS_OPTIONS.includes(source.webcamFps as RecordingWebcamFps)
    ? (source.webcamFps as RecordingWebcamFps)
    : fallback.webcamFps
  const audioCodec = normalizeRecordingAudioCodec(source.audioCodec, fallback.audioCodec)
  const audioBitrateKbps = normalizeRecordingAudioBitrateKbps(source.audioBitrateKbps, fallback.audioBitrateKbps)
  const audioSampleRate = normalizeRecordingAudioSampleRate(source.audioSampleRate, fallback.audioSampleRate)

  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : fallback.id,
    name: typeof source.name === 'string' && source.name.trim().length > 0 ? source.name.trim() : fallback.name,
    screenResolution,
    screenFps,
    webcamResolution,
    webcamFps,
    audioCodec,
    audioBitrateKbps,
    audioSampleRate,
  }
}

export const normalizeRecordingProfiles = (value: unknown, nativeRecommendedFps: 30 | 60 = 30): RecordingProfile[] => {
  const storedProfiles = Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []
  const storedNativeProfile =
    storedProfiles.find((item) => {
      const profile = item as Partial<RecordingProfile>
      return profile.id === NATIVE_RECORDING_PROFILE_ID || profile.isNative === true
    }) || null
  const nativeProfile = createNativeRecordingProfile(nativeRecommendedFps, storedNativeProfile as Partial<RecordingProfile>)
  const customProfiles = storedProfiles
        .filter((item) => item && typeof item === 'object')
        .map((item, index) =>
          normalizeRecordingProfile(item as Partial<RecordingProfile>, {
            id: `recording-profile-${index + 1}`,
            name: `Profile ${index + 1}`,
            screenResolution: 'native',
            screenFps: 30,
            webcamResolution: 'native',
            webcamFps: 'synced',
            audioCodec: 'aac',
            audioBitrateKbps: 192,
            audioSampleRate: 48000,
          }),
        )
        .filter((profile) => !profile.isNative && profile.id !== NATIVE_RECORDING_PROFILE_ID)

  return [nativeProfile, ...customProfiles]
}

export const getRecordingProfileLabel = (profile: RecordingProfile): string => {
  if (profile.isNative) return `${profile.name} - ${profile.screenFps}fps`
  return `${profile.name} - ${RESOLUTION_LABELS[profile.screenResolution]}, ${profile.screenFps}fps`
}
