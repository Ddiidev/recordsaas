import { shell } from 'electron'
import log from 'electron-log/main'
import Store from 'electron-store'
import { createPublicKey, createVerify, KeyObject, randomUUID } from 'node:crypto'
import { appState } from '../state'

const AUTH_API_BASE = 'https://recordsaas.app'
const AUTH_DESKTOP_REDIRECT_URI = 'recordsaas://auth/callback'
const NONCE_MAX_AGE_MS = 15 * 60 * 1000
const AUTH_PUBLIC_KEY_CACHE_TTL_MS = 5 * 60 * 1000

const AUTH_SESSION_TOKEN_KEY = 'auth.sessionToken'
const AUTH_ENTITLEMENT_TOKEN_KEY = 'auth.entitlementToken'
const AUTH_USER_KEY = 'auth.user'
const AUTH_LICENSE_KEY = 'auth.license'
const AUTH_CREDITS_KEY = 'auth.credits'
const AUTH_LOGGED_AT_KEY = 'auth.loggedAt'
const AUTH_PENDING_NONCE_KEY = 'auth.pendingNonce'
const AUTH_PENDING_NONCE_CREATED_AT_KEY = 'auth.pendingNonceCreatedAt'

const store = new Store()

type AuthStatusLabel = 'active' | 'canceled' | 'free'

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

export interface AuthSessionPayload {
  user: AuthUser | null
  license: AuthLicense | null
  credits: AuthCredits | null
  sessionToken: string | null
  entitlementToken: string | null
  isAuthenticated: boolean
  status: AuthStatusLabel
}

export interface AuthDeepLinkPayload {
  status: 'success' | 'error'
  code?: string
  error?: string
  rawUrl: string
}

export type ExportFormat = 'mp4' | 'gif'
export type ExportResolution = '480p' | '576p' | '720p' | '1080p' | '2k'
export type ExportFps = 30 | 60

export interface ExportSelectionRequest {
  format: ExportFormat
  resolution: ExportResolution
  fps: ExportFps
}

export interface ExportApproval {
  format: ExportFormat
  resolution: ExportResolution
  fps: ExportFps
  creditCostUnits: number
  creditCostCredits: number
  balanceAfterUnits: number
  balanceAfterCredits: number
}

type ExportGrantPayload = {
  typ: 'export_grant'
  sub: string
  email: string
  approved: ExportApproval
  aud?: string | string[]
  iss?: string
  exp?: number
  nbf?: number
  iat?: number
}

let cachedAuthPublicKey: KeyObject | null = null
let cachedAuthIssuer: string | null = null
let cachedAuthPublicKeyLoadedAt = 0

function parseUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') return null
  const maybeUser = value as Partial<AuthUser>
  if (typeof maybeUser.email !== 'string') return null

  return {
    email: maybeUser.email,
    name: typeof maybeUser.name === 'string' ? maybeUser.name : null,
    picture: typeof maybeUser.picture === 'string' && maybeUser.picture.length > 0 ? maybeUser.picture : null,
  }
}

function parseLicense(value: unknown): AuthLicense | null {
  if (!value || typeof value !== 'object') return null
  const maybeLicense = value as Partial<AuthLicense>
  if (typeof maybeLicense.active !== 'boolean') return null

  return {
    active: maybeLicense.active,
    plan: typeof maybeLicense.plan === 'string' ? maybeLicense.plan : null,
    region: typeof maybeLicense.region === 'string' ? maybeLicense.region : null,
    activatedAt: typeof maybeLicense.activatedAt === 'string' ? maybeLicense.activatedAt : null,
    subscriptionStatus: typeof maybeLicense.subscriptionStatus === 'string' ? maybeLicense.subscriptionStatus : null,
    licenseValidUntil: typeof maybeLicense.licenseValidUntil === 'string' ? maybeLicense.licenseValidUntil : null,
    paidAmount: typeof maybeLicense.paidAmount === 'number' ? maybeLicense.paidAmount : null,
    paidCurrency: typeof maybeLicense.paidCurrency === 'string' ? maybeLicense.paidCurrency : null,
    watermarkRequired: typeof maybeLicense.watermarkRequired === 'boolean' ? maybeLicense.watermarkRequired : !maybeLicense.active,
  }
}

function parseCredits(value: unknown): AuthCredits | null {
  if (!value || typeof value !== 'object') return null
  const maybeCredits = value as Partial<AuthCredits>

  if (
    typeof maybeCredits.balanceUnits !== 'number' ||
    typeof maybeCredits.balanceCredits !== 'number' ||
    typeof maybeCredits.monthlyGrantUnits !== 'number' ||
    typeof maybeCredits.month !== 'string'
  ) {
    return null
  }

  return {
    visible: typeof maybeCredits.visible === 'boolean' ? maybeCredits.visible : true,
    balanceUnits: maybeCredits.balanceUnits,
    balanceCredits: maybeCredits.balanceCredits,
    monthlyGrantUnits: maybeCredits.monthlyGrantUnits,
    month: maybeCredits.month,
  }
}

function mapAuthStatus(license: AuthLicense | null): AuthStatusLabel {
  if (!license) return 'free'
  if (license.active) return 'active'
  return 'free'
}

function getStoredSessionToken(): string | null {
  const token = store.get(AUTH_SESSION_TOKEN_KEY)
  return typeof token === 'string' && token.length > 0 ? token : null
}

function getStoredEntitlementToken(): string | null {
  const token = store.get(AUTH_ENTITLEMENT_TOKEN_KEY)
  return typeof token === 'string' && token.length > 0 ? token : null
}

function getStoredUser(): AuthUser | null {
  return parseUser(store.get(AUTH_USER_KEY))
}

function getStoredLicense(): AuthLicense | null {
  return parseLicense(store.get(AUTH_LICENSE_KEY))
}

function getStoredCredits(): AuthCredits | null {
  return parseCredits(store.get(AUTH_CREDITS_KEY))
}

function getStoredSessionPayload(): AuthSessionPayload {
  const sessionToken = getStoredSessionToken()
  const user = getStoredUser()
  const license = getStoredLicense()

  return {
    user,
    license,
    credits: getStoredCredits(),
    sessionToken,
    entitlementToken: getStoredEntitlementToken(),
    isAuthenticated: Boolean(sessionToken && user),
    status: mapAuthStatus(license),
  }
}

function persistAuthSession(data: {
  user: AuthUser
  license: AuthLicense
  credits: AuthCredits | null
  sessionToken: string
  entitlementToken: string
}): AuthSessionPayload {
  store.set(AUTH_USER_KEY, data.user)
  store.set(AUTH_LICENSE_KEY, data.license)
  if (data.credits) {
    store.set(AUTH_CREDITS_KEY, data.credits)
  } else {
    store.delete(AUTH_CREDITS_KEY)
  }
  store.set(AUTH_SESSION_TOKEN_KEY, data.sessionToken)
  store.set(AUTH_ENTITLEMENT_TOKEN_KEY, data.entitlementToken)
  store.set(AUTH_LOGGED_AT_KEY, new Date().toISOString())

  return {
    user: data.user,
    license: data.license,
    credits: data.credits,
    sessionToken: data.sessionToken,
    entitlementToken: data.entitlementToken,
    isAuthenticated: true,
    status: mapAuthStatus(data.license),
  }
}

function clearPendingNonce(): void {
  store.delete(AUTH_PENDING_NONCE_KEY)
  store.delete(AUTH_PENDING_NONCE_CREATED_AT_KEY)
}

function clearAuthSession(): void {
  store.delete(AUTH_SESSION_TOKEN_KEY)
  store.delete(AUTH_ENTITLEMENT_TOKEN_KEY)
  store.delete(AUTH_USER_KEY)
  store.delete(AUTH_LICENSE_KEY)
  store.delete(AUTH_CREDITS_KEY)
  store.delete(AUTH_LOGGED_AT_KEY)
}

function emitToRenderer(channel: string, payload: unknown): void {
  const windows = [appState.recorderWin, appState.editorWin]
  windows.forEach((win) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  })
}

function emitSessionUpdated(payload: AuthSessionPayload): void {
  emitToRenderer('auth:session-updated', payload)
}

function createNonce(): string {
  try {
    return randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
}

function buildDesktopLoginUrl(nonce: string): string {
  const loginUrl = new URL('/auth/google/', AUTH_API_BASE)
  loginUrl.searchParams.set('desktop', '1')
  loginUrl.searchParams.set('start', '1')
  loginUrl.searchParams.set('nonce', nonce)
  loginUrl.searchParams.set('redirect_uri', AUTH_DESKTOP_REDIRECT_URI)
  loginUrl.searchParams.set('api_base', AUTH_API_BASE)
  return loginUrl.toString()
}

function getPendingNonce(): string | null {
  const nonce = store.get(AUTH_PENDING_NONCE_KEY)
  const createdAt = store.get(AUTH_PENDING_NONCE_CREATED_AT_KEY)

  if (typeof nonce !== 'string' || nonce.length === 0) {
    clearPendingNonce()
    return null
  }

  if (typeof createdAt !== 'number' || Date.now() - createdAt > NONCE_MAX_AGE_MS) {
    clearPendingNonce()
    return null
  }

  return nonce
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseExchangePayload(payload: Record<string, unknown>): {
  user: AuthUser
  license: AuthLicense
  credits: AuthCredits | null
  sessionToken: string
  entitlementToken: string
} | null {
  const user = parseUser(payload.user)
  const license = parseLicense(payload.license)
  const credits = parseCredits(payload.credits)
  const sessionToken = typeof payload.sessionToken === 'string' ? payload.sessionToken : null
  const entitlementToken = typeof payload.entitlementToken === 'string' ? payload.entitlementToken : null

  if (!user || !license || !sessionToken || !entitlementToken) {
    return null
  }

  return { user, license, credits, sessionToken, entitlementToken }
}

async function callAuthStatus(sessionToken: string): Promise<AuthSessionPayload | null> {
  const response = await fetch(`${AUTH_API_BASE}/api/auth/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = await parseJson(response)
  const user = parseUser(payload.user)
  const license = parseLicense(payload.license)
  const credits = parseCredits(payload.credits)
  const entitlementToken = typeof payload.entitlementToken === 'string' ? payload.entitlementToken : null

  if (!user || !license || !entitlementToken) {
    return null
  }

  return persistAuthSession({
    user,
    license,
    credits,
    sessionToken,
    entitlementToken,
  })
}

async function callAuthRefresh(sessionToken: string): Promise<AuthSessionPayload | null> {
  const response = await fetch(`${AUTH_API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = await parseJson(response)
  const exchange = parseExchangePayload(payload)
  if (!exchange) {
    return null
  }

  return persistAuthSession(exchange)
}

async function exchangeDesktopCode(code: string): Promise<AuthSessionPayload> {
  const nonce = getPendingNonce()
  if (!nonce) {
    throw new Error('Desktop login nonce is missing or expired')
  }

  const response = await fetch(`${AUTH_API_BASE}/api/auth/desktop/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      desktopCode: code,
      nonce,
    }),
  })

  if (!response.ok) {
    const payload = await parseJson(response)
    const message = typeof payload.error === 'string' ? payload.error : 'Desktop exchange failed'
    throw new Error(message)
  }

  const payload = await parseJson(response)
  const exchange = parseExchangePayload(payload)
  if (!exchange) {
    throw new Error('Invalid desktop exchange response')
  }

  clearPendingNonce()
  const session = persistAuthSession(exchange)
  emitSessionUpdated(session)
  return session
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function parseJsonBuffer<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString('utf-8')) as T
}

function ensureAudience(audience: string | string[] | undefined, expected: string): boolean {
  if (!audience) return false
  if (typeof audience === 'string') return audience === expected
  return audience.includes(expected)
}

async function getAuthPublicKeyContext(): Promise<{ key: KeyObject; issuer: string }> {
  const now = Date.now()
  const shouldRefresh =
    !cachedAuthPublicKey ||
    !cachedAuthIssuer ||
    now - cachedAuthPublicKeyLoadedAt > AUTH_PUBLIC_KEY_CACHE_TTL_MS

  if (!shouldRefresh && cachedAuthPublicKey && cachedAuthIssuer) {
    return {
      key: cachedAuthPublicKey,
      issuer: cachedAuthIssuer,
    }
  }

  const response = await fetch(`${AUTH_API_BASE}/api/auth/public-key`, {
    method: 'GET',
  })

  if (!response.ok) {
    throw new Error('Failed to fetch auth public key')
  }

  const payload = (await response.json()) as {
    algorithm?: string
    issuer?: string
    publicKey?: string
  }

  if (payload.algorithm !== 'RS256' || typeof payload.issuer !== 'string' || typeof payload.publicKey !== 'string') {
    throw new Error('Invalid auth public key payload')
  }

  cachedAuthPublicKey = createPublicKey(payload.publicKey)
  cachedAuthIssuer = payload.issuer
  cachedAuthPublicKeyLoadedAt = now

  return {
    key: cachedAuthPublicKey,
    issuer: cachedAuthIssuer,
  }
}

async function verifyExportGrant(exportToken: string): Promise<ExportGrantPayload> {
  const parts = exportToken.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid export token format')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = parseJsonBuffer<{ alg?: string; typ?: string }>(decodeBase64Url(encodedHeader))
  if (header.alg !== 'RS256' || header.typ !== 'JWT') {
    throw new Error('Unsupported export token header')
  }

  const { key, issuer } = await getAuthPublicKeyContext()
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${encodedHeader}.${encodedPayload}`)
  verifier.end()

  const signature = decodeBase64Url(encodedSignature)
  const isValid = verifier.verify(key, signature)
  if (!isValid) {
    throw new Error('Invalid export token signature')
  }

  const payload = parseJsonBuffer<ExportGrantPayload>(decodeBase64Url(encodedPayload))
  const now = Math.floor(Date.now() / 1000)

  if (payload.typ !== 'export_grant') {
    throw new Error('Invalid export token type')
  }

  if (payload.iss !== issuer) {
    throw new Error('Invalid export token issuer')
  }

  if (!ensureAudience(payload.aud, 'recordsaas-desktop-export')) {
    throw new Error('Invalid export token audience')
  }

  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('Export token expired')
  }

  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    throw new Error('Export token not active yet')
  }

  if (!payload.approved || typeof payload.approved !== 'object') {
    throw new Error('Invalid export token approved payload')
  }

  return payload
}

export async function startDesktopAuthLogin(): Promise<void> {
  const nonce = createNonce()
  store.set(AUTH_PENDING_NONCE_KEY, nonce)
  store.set(AUTH_PENDING_NONCE_CREATED_AT_KEY, Date.now())
  await shell.openExternal(buildDesktopLoginUrl(nonce))
}

export async function getAuthSession(): Promise<AuthSessionPayload> {
  const sessionToken = getStoredSessionToken()
  if (!sessionToken) {
    return {
      user: null,
      license: null,
      credits: null,
      sessionToken: null,
      entitlementToken: null,
      isAuthenticated: false,
      status: 'free',
    }
  }

  try {
    const statusSession = await callAuthStatus(sessionToken)
    if (statusSession) {
      return statusSession
    }

    const refreshedSession = await callAuthRefresh(sessionToken)
    if (refreshedSession) {
      emitSessionUpdated(refreshedSession)
      return refreshedSession
    }
  } catch (error) {
    log.warn('[Auth] Failed to refresh desktop session', error)
  }

  clearAuthSession()
  clearPendingNonce()

  const signedOut = {
    user: null,
    license: null,
    credits: null,
    sessionToken: null,
    entitlementToken: null,
    isAuthenticated: false,
    status: 'free' as const,
  }

  emitSessionUpdated(signedOut)
  return signedOut
}

export function logoutAuthSession(): AuthSessionPayload {
  clearAuthSession()
  clearPendingNonce()

  const payload = {
    user: null,
    license: null,
    credits: null,
    sessionToken: null,
    entitlementToken: null,
    isAuthenticated: false,
    status: 'free' as const,
  }

  emitSessionUpdated(payload)
  return payload
}

export async function authorizeDesktopExport(selection: ExportSelectionRequest): Promise<{
  approved: ExportApproval
  exportToken: string
}> {
  const session = await getAuthSession()

  if (!session.isAuthenticated || !session.sessionToken) {
    throw new Error('AUTH_REQUIRED')
  }

  const response = await fetch(`${AUTH_API_BASE}/api/export/authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.sessionToken}`,
    },
    body: JSON.stringify(selection),
  })

  const payload = await parseJson(response)

  if (!response.ok) {
    if (response.status === 402 && payload.code === 'INSUFFICIENT_CREDITS') {
      const buyUrl = typeof payload.buyCreditsUrl === 'string' ? payload.buyCreditsUrl : `${AUTH_API_BASE}/account/`
      const requiredCredits = typeof payload.requiredCredits === 'number' ? payload.requiredCredits : -1
      const availableCredits = typeof payload.availableCredits === 'number' ? payload.availableCredits : -1
      throw new Error(`INSUFFICIENT_CREDITS|${buyUrl}|${requiredCredits}|${availableCredits}`)
    }

    const message = typeof payload.error === 'string' ? payload.error : 'Export authorization failed'
    throw new Error(message)
  }

  const exportToken = typeof payload.exportToken === 'string' ? payload.exportToken : null
  if (!exportToken) {
    throw new Error('Missing export token')
  }

  const verified = await verifyExportGrant(exportToken)
  return {
    approved: verified.approved,
    exportToken,
  }
}

export async function handleAuthDeepLinkUrl(rawUrl: string): Promise<void> {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    return
  }

  if (parsed.protocol !== 'recordsaas:' || parsed.hostname !== 'auth' || parsed.pathname !== '/callback') {
    return
  }

  const code = parsed.searchParams.get('code')
  const error = parsed.searchParams.get('error')

  if (error) {
    emitToRenderer('auth:deeplink', {
      status: 'error',
      error,
      rawUrl,
    } satisfies AuthDeepLinkPayload)
    return
  }

  if (!code) {
    emitToRenderer('auth:deeplink', {
      status: 'error',
      error: 'missing_code',
      rawUrl,
    } satisfies AuthDeepLinkPayload)
    return
  }

  try {
    await exchangeDesktopCode(code)
    emitToRenderer('auth:deeplink', {
      status: 'success',
      code,
      rawUrl,
    } satisfies AuthDeepLinkPayload)
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : 'desktop_exchange_failed'
    emitToRenderer('auth:deeplink', {
      status: 'error',
      code,
      error: message,
      rawUrl,
    } satisfies AuthDeepLinkPayload)
  }
}

export function getCachedAuthSession(): AuthSessionPayload {
  return getStoredSessionPayload()
}
