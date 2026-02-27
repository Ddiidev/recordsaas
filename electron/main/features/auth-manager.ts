import { BrowserWindow, shell } from 'electron'
import Store from 'electron-store'
import { createPublicKey, createVerify, randomUUID } from 'node:crypto'

type DesktopAuthReason =
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

interface StoredAuthSession {
  sessionToken: string
  entitlementToken: string
  user: DesktopAuthUser
  license: DesktopAuthLicense
}

interface PendingLoginState {
  nonce: string
  createdAt: number
}

interface SigningMetadata {
  publicKey: string
  issuer: string
  algorithm: string
}

interface JwtPayload {
  [key: string]: unknown
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  typ?: string
  sub?: string
  email?: string
  active?: boolean
  plan?: string | null
  license_valid_until?: string | null
  watermark_required?: boolean
}

const AUTH_API_BASE_URL = (process.env.RECORDSAAS_API_BASE_URL || 'https://recordsaas.app').replace(/\/$/, '')
const AUTH_SCHEME = 'recordsaas'
const AUTH_HOST = 'auth'
const AUTH_CALLBACK_PATH = '/callback'

const AUTH_SESSION_KEY = 'auth.desktop.session'
const AUTH_PENDING_LOGIN_KEY = 'auth.desktop.pendingLogin'
const AUTH_SIGNING_KEY = 'auth.desktop.signing'

const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000
const TOKEN_REVALIDATE_INTERVAL_MS = 60 * 60 * 1000

const store = new Store()

let currentState: DesktopAuthState = createLoggedOutState('not_logged_in')
let revalidateInterval: NodeJS.Timeout | null = null
let autoRefreshInFlight: Promise<void> | null = null

function createLoggedOutState(reason: DesktopAuthReason): DesktopAuthState {
  return {
    isAuthenticated: false,
    canExport: false,
    watermarkRequired: true,
    reason,
    user: null,
    license: null,
    sessionExpiresAt: null,
    entitlementExpiresAt: null,
    apiBaseUrl: AUTH_API_BASE_URL,
  }
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

function parseJwtPayload(token: string): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }

  return JSON.parse(decodeBase64Url(parts[1]).toString('utf8')) as JwtPayload
}

function hasAudience(payloadAud: string | string[] | undefined, expectedAud: string): boolean {
  if (!payloadAud) return false
  if (typeof payloadAud === 'string') return payloadAud === expectedAud
  return payloadAud.includes(expectedAud)
}

function toIsoFromExp(exp: unknown): string | null {
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null
  return new Date(exp * 1000).toISOString()
}

function isFutureDate(value: string | null | undefined): boolean {
  if (!value) return false
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return timestamp > Date.now()
}

function verifyJwt(
  token: string,
  metadata: SigningMetadata,
  expectedAud: string,
  expectedType: string,
): JwtPayload {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts
  const header = JSON.parse(decodeBase64Url(encodedHeader).toString('utf8')) as {
    alg?: string
    typ?: string
  }

  if (header.alg !== 'RS256' || header.typ !== 'JWT') {
    throw new Error('Invalid token header')
  }

  const verify = createVerify('RSA-SHA256')
  verify.update(`${encodedHeader}.${encodedPayload}`)
  verify.end()

  const isValid = verify.verify(createPublicKey(metadata.publicKey), decodeBase64Url(encodedSignature))
  if (!isValid) {
    throw new Error('Invalid token signature')
  }

  const payload = parseJwtPayload(token)

  if (payload.iss !== metadata.issuer) {
    throw new Error('Invalid token issuer')
  }

  if (!hasAudience(payload.aud, expectedAud)) {
    throw new Error('Invalid token audience')
  }

  if (payload.typ !== expectedType) {
    throw new Error('Invalid token type')
  }

  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number') {
    throw new Error('Missing token expiration')
  }
  if (payload.exp <= now) {
    throw new Error('Token expired')
  }

  return payload
}

function loadStoredSession(): StoredAuthSession | null {
  const value = store.get(AUTH_SESSION_KEY)
  if (!value || typeof value !== 'object') return null

  const session = value as Partial<StoredAuthSession>
  if (
    typeof session.sessionToken !== 'string' ||
    typeof session.entitlementToken !== 'string' ||
    !session.user ||
    !session.license
  ) {
    return null
  }

  return session as StoredAuthSession
}

function saveStoredSession(session: StoredAuthSession): void {
  store.set(AUTH_SESSION_KEY, session)
}

function clearStoredSession(): void {
  store.delete(AUTH_SESSION_KEY)
}

function loadPendingLogin(): PendingLoginState | null {
  const value = store.get(AUTH_PENDING_LOGIN_KEY)
  if (!value || typeof value !== 'object') return null

  const pending = value as Partial<PendingLoginState>
  if (typeof pending.nonce !== 'string' || typeof pending.createdAt !== 'number') {
    return null
  }

  return pending as PendingLoginState
}

function savePendingLogin(nonce: string): void {
  store.set(AUTH_PENDING_LOGIN_KEY, {
    nonce,
    createdAt: Date.now(),
  } satisfies PendingLoginState)
}

function clearPendingLogin(): void {
  store.delete(AUTH_PENDING_LOGIN_KEY)
}

function loadCachedSigningMetadata(): SigningMetadata | null {
  const value = store.get(AUTH_SIGNING_KEY)
  if (!value || typeof value !== 'object') return null

  const metadata = value as Partial<SigningMetadata>
  if (
    typeof metadata.publicKey !== 'string' ||
    typeof metadata.issuer !== 'string' ||
    typeof metadata.algorithm !== 'string'
  ) {
    return null
  }

  return metadata as SigningMetadata
}

function saveSigningMetadata(metadata: SigningMetadata): void {
  store.set(AUTH_SIGNING_KEY, metadata)
}

async function fetchSigningMetadata(): Promise<SigningMetadata> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/public-key`, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch public key: HTTP ${response.status}`)
    }

    const body = (await response.json()) as Partial<SigningMetadata>

    if (
      typeof body.publicKey !== 'string' ||
      typeof body.issuer !== 'string' ||
      body.algorithm !== 'RS256'
    ) {
      throw new Error('Invalid signing metadata payload')
    }

    const metadata: SigningMetadata = {
      publicKey: body.publicKey,
      issuer: body.issuer,
      algorithm: body.algorithm,
    }

    saveSigningMetadata(metadata)
    return metadata
  } finally {
    clearTimeout(timeout)
  }
}

async function getSigningMetadata(forceRefresh = false): Promise<SigningMetadata | null> {
  const cached = loadCachedSigningMetadata()

  if (cached && !forceRefresh) {
    return cached
  }

  try {
    return await fetchSigningMetadata()
  } catch {
    return cached
  }
}

function buildAuthenticatedState(
  session: StoredAuthSession,
  sessionPayload: JwtPayload,
  entitlementPayload: JwtPayload,
  reason: DesktopAuthReason,
): DesktopAuthState {
  const entitlementExpiresAt = toIsoFromExp(entitlementPayload.exp)
  const sessionExpiresAt = toIsoFromExp(sessionPayload.exp)
  const licenseValidUntil =
    typeof entitlementPayload.license_valid_until === 'string'
      ? entitlementPayload.license_valid_until
      : session.license.licenseValidUntil

  const entitlementActive = entitlementPayload.active === true
  const watermarkFromToken = entitlementPayload.watermark_required === true
  const licenseValid = isFutureDate(licenseValidUntil)

  const canExport = entitlementActive && licenseValid && !watermarkFromToken
  const watermarkRequired = !canExport || watermarkFromToken

  return {
    isAuthenticated: true,
    canExport,
    watermarkRequired,
    reason,
    user: session.user,
    license: {
      ...session.license,
      active: entitlementActive,
      plan:
        typeof entitlementPayload.plan === 'string' || entitlementPayload.plan === null
          ? entitlementPayload.plan
          : session.license.plan,
      licenseValidUntil,
      watermarkRequired,
      subscriptionStatus:
        typeof entitlementPayload.subscription_status === 'string' ||
        entitlementPayload.subscription_status === null
          ? entitlementPayload.subscription_status
          : session.license.subscriptionStatus,
      paidAmount:
        typeof entitlementPayload.paid_amount === 'number' || entitlementPayload.paid_amount === null
          ? entitlementPayload.paid_amount
          : session.license.paidAmount,
      paidCurrency:
        typeof entitlementPayload.paid_currency === 'string' || entitlementPayload.paid_currency === null
          ? entitlementPayload.paid_currency
          : session.license.paidCurrency,
    },
    sessionExpiresAt,
    entitlementExpiresAt,
    apiBaseUrl: AUTH_API_BASE_URL,
  }
}

function resolveReasonFromValidationError(error: unknown, fallback: DesktopAuthReason): DesktopAuthReason {
  if (!(error instanceof Error)) return fallback

  const message = error.message.toLowerCase()
  if (message.includes('expired')) return 'expired_entitlement'
  if (message.includes('session')) return 'invalid_session'
  if (message.includes('entitlement')) return 'invalid_entitlement'

  return fallback
}

function broadcastAuthState(): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('auth:changed', currentState)
    }
  }
}

async function evaluateCurrentState(): Promise<DesktopAuthState> {
  const session = loadStoredSession()
  if (!session) {
    return createLoggedOutState('not_logged_in')
  }

  const metadata = await getSigningMetadata(false)
  if (!metadata) {
    return {
      ...createLoggedOutState('public_key_unavailable'),
      isAuthenticated: true,
      user: session.user,
      license: session.license,
    }
  }

  try {
    const sessionPayload = verifyJwt(session.sessionToken, metadata, 'recordsaas-api', 'session')
    const entitlementPayload = verifyJwt(
      session.entitlementToken,
      metadata,
      'recordsaas-desktop',
      'entitlement',
    )

    const base = buildAuthenticatedState(session, sessionPayload, entitlementPayload, null)

    if (!base.license?.active) {
      return {
        ...base,
        canExport: false,
        watermarkRequired: true,
        reason: 'license_inactive',
      }
    }

    if (!isFutureDate(base.license.licenseValidUntil)) {
      return {
        ...base,
        canExport: false,
        watermarkRequired: true,
        reason: 'license_expired',
      }
    }

    return base
  } catch (error) {
    const reason = resolveReasonFromValidationError(error, 'invalid_entitlement')

    if (reason === 'invalid_session' || reason === 'invalid_entitlement') {
      clearStoredSession()
      return createLoggedOutState(reason)
    }

    return {
      ...createLoggedOutState(reason),
      isAuthenticated: true,
      user: session.user,
      license: session.license,
    }
  }
}

async function setCurrentStateFromEvaluation(): Promise<DesktopAuthState> {
  currentState = await evaluateCurrentState()
  broadcastAuthState()
  void maybeAutoRefreshTokens()
  return currentState
}

function extractSessionTokenForRefresh(): string | null {
  const session = loadStoredSession()
  return session?.sessionToken || null
}

function extractSessionTokenExpirationMs(): number | null {
  const sessionToken = extractSessionTokenForRefresh()
  if (!sessionToken) return null

  try {
    const payload = parseJwtPayload(sessionToken)
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return null
    }
    return payload.exp * 1000
  } catch {
    return null
  }
}

async function refreshTokensInternal(): Promise<boolean> {
  const sessionToken = extractSessionTokenForRefresh()
  if (!sessionToken) {
    return false
  }

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        clearStoredSession()
        await setCurrentStateFromEvaluation()
      }
      return false
    }

    const data = (await response.json()) as {
      user?: DesktopAuthUser
      license?: DesktopAuthLicense
      sessionToken?: string
      entitlementToken?: string
    }

    if (
      !data ||
      typeof data.sessionToken !== 'string' ||
      typeof data.entitlementToken !== 'string' ||
      !data.user ||
      !data.license
    ) {
      return false
    }

    saveStoredSession({
      sessionToken: data.sessionToken,
      entitlementToken: data.entitlementToken,
      user: data.user,
      license: data.license,
    })

    await getSigningMetadata(true)
    await setCurrentStateFromEvaluation()
    return true
  } catch {
    return false
  }
}

async function maybeAutoRefreshTokens(): Promise<void> {
  if (!currentState.isAuthenticated) {
    return
  }

  const expiration = extractSessionTokenExpirationMs()
  if (typeof expiration !== 'number' || !Number.isFinite(expiration)) {
    return
  }

  if (expiration - Date.now() > TOKEN_REFRESH_THRESHOLD_MS) {
    return
  }

  if (autoRefreshInFlight) {
    return
  }

  autoRefreshInFlight = (async () => {
    await refreshTokensInternal()
  })().finally(() => {
    autoRefreshInFlight = null
  })
}

function generateNonce(): string {
  try {
    return randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
}

export async function initializeAuthManager(): Promise<void> {
  await setCurrentStateFromEvaluation()

  if (revalidateInterval) {
    clearInterval(revalidateInterval)
    revalidateInterval = null
  }

  revalidateInterval = setInterval(() => {
    void setCurrentStateFromEvaluation()
  }, TOKEN_REVALIDATE_INTERVAL_MS)
}

export async function getDesktopAuthState(): Promise<DesktopAuthState> {
  await setCurrentStateFromEvaluation()
  return currentState
}

export async function startDesktopLogin(): Promise<void> {
  const nonce = generateNonce()
  savePendingLogin(nonce)

  const loginUrl = new URL(`${AUTH_API_BASE_URL}/`)
  loginUrl.searchParams.set('desktop', '1')
  loginUrl.searchParams.set('redirect_uri', `${AUTH_SCHEME}://${AUTH_HOST}${AUTH_CALLBACK_PATH}`)
  loginUrl.searchParams.set('nonce', nonce)
  loginUrl.searchParams.set('api_base', AUTH_API_BASE_URL)

  await shell.openExternal(loginUrl.toString())
}

export async function handleAuthDeepLink(url: string): Promise<boolean> {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (
    parsed.protocol !== `${AUTH_SCHEME}:` ||
    parsed.hostname !== AUTH_HOST ||
    parsed.pathname !== AUTH_CALLBACK_PATH
  ) {
    return false
  }

  const error = parsed.searchParams.get('error')
  if (error) {
    await setCurrentStateFromEvaluation()
    return true
  }

  const code = parsed.searchParams.get('code')
  if (!code) {
    await setCurrentStateFromEvaluation()
    return true
  }

  const pending = loadPendingLogin()
  const nonce = pending?.nonce

  if (!nonce) {
    currentState = {
      ...createLoggedOutState('invalid_session'),
    }
    broadcastAuthState()
    return true
  }

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/auth/desktop/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ desktopCode: code, nonce }),
    })

    if (!response.ok) {
      clearPendingLogin()
      await setCurrentStateFromEvaluation()
      return true
    }

    const data = (await response.json()) as {
      user?: DesktopAuthUser
      license?: DesktopAuthLicense
      sessionToken?: string
      entitlementToken?: string
    }

    if (
      typeof data.sessionToken !== 'string' ||
      typeof data.entitlementToken !== 'string' ||
      !data.user ||
      !data.license
    ) {
      clearPendingLogin()
      await setCurrentStateFromEvaluation()
      return true
    }

    saveStoredSession({
      sessionToken: data.sessionToken,
      entitlementToken: data.entitlementToken,
      user: data.user,
      license: data.license,
    })

    clearPendingLogin()
    await getSigningMetadata(true)
    await setCurrentStateFromEvaluation()
    return true
  } catch {
    clearPendingLogin()
    await setCurrentStateFromEvaluation()
    return true
  }
}

export async function logoutDesktopAuth(): Promise<void> {
  clearStoredSession()
  clearPendingLogin()
  await setCurrentStateFromEvaluation()
}

export async function refreshDesktopAuthNow(): Promise<DesktopAuthState> {
  await refreshTokensInternal()
  return currentState
}

export async function getExportAuthorizationDecision(): Promise<{
  isAuthenticated: boolean
  canExport: boolean
  watermarkRequired: boolean
  reason: DesktopAuthReason
}> {
  await setCurrentStateFromEvaluation()

  return {
    isAuthenticated: currentState.isAuthenticated,
    canExport: currentState.canExport,
    watermarkRequired: currentState.watermarkRequired || !currentState.canExport,
    reason: currentState.reason,
  }
}
