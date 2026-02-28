import type { Background } from '../types'

const WINDOWS_DRIVE_WITHOUT_COLON = /^[a-z]\/.+/i
const WINDOWS_DRIVE_WITH_LEADING_SLASH = /^\/[a-z]:\//i
const NON_WINDOWS_SCHEME_PREFIX = /^([^/]+):\//

export function isBlobOrDataUrl(value: string): boolean {
  return /^blob:/i.test(value) || /^data:/i.test(value)
}

/**
 * Normalizes legacy/invalid media-like paths to a canonical path form.
 * The returned value does not include "media://".
 */
export function normalizeMediaPath(value: string): string {
  let normalized = value.trim()
  if (!normalized) return normalized

  normalized = normalized.replace(/^media:(\/\/)?/i, '')
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
 * Normalizes stored media path values while preserving blob/data URLs.
 */
export function normalizeStoredMediaPath(value: string): string {
  if (!value) return value
  if (isBlobOrDataUrl(value)) return value
  return normalizeMediaPath(value)
}

/**
 * Converts a stored media path to media protocol URL used by renderer assets.
 */
export function toMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null
  if (isBlobOrDataUrl(value)) return value
  return `media://${normalizeMediaPath(value)}`
}

/**
 * Migrates background URLs from legacy formats and reports whether any change happened.
 */
export function normalizeBackgroundMediaFields(background: Background): { background: Background; changed: boolean } {
  let changed = false

  const normalizeField = (field: string | undefined): string | undefined => {
    if (!field) return field
    const normalized = normalizeStoredMediaPath(field)
    if (normalized !== field) {
      changed = true
    }
    return normalized
  }

  const nextBackground: Background = {
    ...background,
    imageUrl: normalizeField(background.imageUrl),
    thumbnailUrl: normalizeField(background.thumbnailUrl),
  }

  return { background: nextBackground, changed }
}

