export type AuthStatus = 'active' | 'canceled' | 'free'

export interface AuthUser {
  email: string
  name: string | null
  picture: string | null
}

export interface AuthLicense {
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

export interface AuthCredits {
  visible: boolean
  balanceUnits: number
  balanceCredits: number
  monthlyGrantUnits: number
  month: string
}

export interface AuthSession {
  user: AuthUser | null
  license: AuthLicense | null
  credits: AuthCredits | null
  sessionToken: string | null
  entitlementToken: string | null
  isAuthenticated: boolean
  status: AuthStatus
}

export interface AuthDeepLinkEvent {
  status: 'success' | 'error'
  code?: string
  error?: string
  rawUrl: string
}
