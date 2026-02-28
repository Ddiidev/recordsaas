// Utilities for normalizing media protocol paths in the main process.

const WINDOWS_DRIVE_WITHOUT_COLON = /^[a-z]\/.+/i
const WINDOWS_DRIVE_WITH_LEADING_SLASH = /^\/[a-z]:\//i
const NON_WINDOWS_SCHEME_PREFIX = /^([^/]+):\//

/**
 * Normalizes a path-like value that may come from legacy media URLs.
 * Keeps absolute Windows paths valid and converts legacy forms such as:
 * - c/Users/... -> c:/Users/...
 * - wallpapers:/images/... -> wallpapers/images/...
 */
export function normalizeMediaPath(value: string): string {
  let normalized = value.trim()
  if (!normalized) return normalized

  normalized = normalized.replace(/\\/g, '/')

  if (WINDOWS_DRIVE_WITH_LEADING_SLASH.test(normalized)) {
    normalized = normalized.slice(1)
  }

  if (WINDOWS_DRIVE_WITHOUT_COLON.test(normalized)) {
    normalized = `${normalized[0]}:/${normalized.slice(2)}`
  }

  if (NON_WINDOWS_SCHEME_PREFIX.test(normalized) && !/^[a-z]:\//i.test(normalized)) {
    normalized = normalized.replace(NON_WINDOWS_SCHEME_PREFIX, '$1/')
  }

  normalized = normalized.replace(/\/{2,}/g, '/')
  normalized = normalized.replace(/^\.\//, '')

  return normalized
}

/**
 * Normalizes a full media request URL to a local path candidate.
 * Supports modern and legacy forms:
 * - media://C:/Users/...
 * - media:///C:/Users/...
 * - media:c/Users/...
 * - media:wallpapers:/images/...
 */
export function normalizeMediaRequestPath(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl)
    const host = decodeURIComponent(parsed.hostname || '')
    const pathname = decodeURIComponent(parsed.pathname || '')

    let reconstructed = `${host}${pathname}`
    if (host.length === 1 && /^[a-z]$/i.test(host)) {
      reconstructed = `${host}:${pathname}`
    } else if (!host && pathname) {
      reconstructed = pathname
    }

    return normalizeMediaPath(reconstructed)
  } catch {
    const withoutScheme = requestUrl.replace(/^media:(\/\/)?/i, '')
    return normalizeMediaPath(withoutScheme)
  }
}

