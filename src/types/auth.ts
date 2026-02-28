export type DesktopAuthReason =
  | 'not_logged_in'
  | 'missing_entitlement'
  | 'invalid_session'
  | 'invalid_entitlement'
  | 'expired_entitlement'
  | 'license_inactive'
  | 'license_expired'
  | 'public_key_unavailable'
  | null

export interface DesktopAuthUser {
  email: string
  name: string | null
  picture: string | null
}

export interface DesktopAuthLicense {
  active: boolean
  plan: string | null
  region: string | null
  activatedAt: string | null
  subscriptionStatus: string | null
  licenseValidUntil: string | null
  paidAmount: number | null
  paidCurrency: string | null
  watermarkRequired: boolean
}

export interface DesktopAuthState {
  isAuthenticated: boolean
  canExport: boolean
  watermarkRequired: boolean
  reason: DesktopAuthReason
  user: DesktopAuthUser | null
  license: DesktopAuthLicense | null
  sessionExpiresAt: string | null
  entitlementExpiresAt: string | null
  apiBaseUrl: string
}
