export type RecordingResolution = 'native' | 'sd' | 'hd' | 'full-hd' | '2k'
export type RecordingScreenFps = 30 | 60 | 120
export type RecordingWebcamFps = 'synced' | 30 | 60

export type RecordingProfile = {
  id: string
  name: string
  isNative?: boolean
  screenResolution: RecordingResolution
  screenFps: RecordingScreenFps
  webcamResolution: RecordingResolution
  webcamFps: RecordingWebcamFps
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

export const createNativeRecordingProfile = (recommendedFps: 30 | 60 = 30): RecordingProfile => ({
  id: NATIVE_RECORDING_PROFILE_ID,
  name: 'Native Adaptive (Recommended)',
  isNative: true,
  screenResolution: 'native',
  screenFps: recommendedFps,
  webcamResolution: 'native',
  webcamFps: 30,
})

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
      ...createNativeRecordingProfile(),
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

  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : fallback.id,
    name: typeof source.name === 'string' && source.name.trim().length > 0 ? source.name.trim() : fallback.name,
    screenResolution,
    screenFps,
    webcamResolution,
    webcamFps,
  }
}

export const normalizeRecordingProfiles = (value: unknown, nativeRecommendedFps: 30 | 60 = 30): RecordingProfile[] => {
  const nativeProfile = createNativeRecordingProfile(nativeRecommendedFps)
  const customProfiles = Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === 'object')
        .map((item, index) =>
          normalizeRecordingProfile(item as Partial<RecordingProfile>, {
            id: `recording-profile-${index + 1}`,
            name: `Profile ${index + 1}`,
            screenResolution: 'native',
            screenFps: 30,
            webcamResolution: 'native',
            webcamFps: 'synced',
          }),
        )
        .filter((profile) => !profile.isNative && profile.id !== NATIVE_RECORDING_PROFILE_ID)
    : []

  return [nativeProfile, ...customProfiles]
}

export const getRecordingProfileLabel = (profile: RecordingProfile): string => {
  if (profile.isNative) return `${profile.name} - ${profile.screenFps}fps`
  return `${profile.name} - ${RESOLUTION_LABELS[profile.screenResolution]}, ${profile.screenFps}fps`
}
