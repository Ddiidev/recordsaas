export const SCREEN_ENCODER_PREFERENCE_SETTING_KEY = 'recorder.screenEncoderPreference'
export const HIDE_GENERIC_ENCODER_WARNING_SETTING_KEY = 'recorder.hideGenericEncoderWarning'

export type ScreenEncoderPreference = 'auto' | 'nvidia' | 'amd' | 'intel' | 'apple' | 'generic'
export type ScreenEncoderVendor = Exclude<ScreenEncoderPreference, 'auto'>
export type ScreenEncoderSelectionMode = 'automatic' | 'manual' | 'fallback'

export interface ScreenEncoderProbeResult {
  preference: ScreenEncoderVendor
  encoder: string
  available: boolean
  reason?: string
}

export interface ScreenEncoderStatus {
  preference: ScreenEncoderPreference
  detectedVendor: Exclude<ScreenEncoderVendor, 'generic'> | null
  detectedDevice?: string
  selectedVendor: ScreenEncoderVendor
  encoder: string
  selectionMode: ScreenEncoderSelectionMode
  requestedAvailable: boolean
  isHardware: boolean
  fallbackReason?: string
  probes: ScreenEncoderProbeResult[]
  probedAt: string
}

export const isScreenEncoderPreference = (value: unknown): value is ScreenEncoderPreference =>
  value === 'auto' ||
  value === 'nvidia' ||
  value === 'amd' ||
  value === 'intel' ||
  value === 'apple' ||
  value === 'generic'

export const normalizeScreenEncoderPreference = (value: unknown): ScreenEncoderPreference =>
  isScreenEncoderPreference(value) ? value : 'auto'
