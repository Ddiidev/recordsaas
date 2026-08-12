const WINDOWS_DRIVE_PATH = /^[a-zA-Z]:[\\/]/
const WINDOWS_UNC_PATH = /^\\\\/

const isAbsoluteLikePath = (value: string): boolean =>
  WINDOWS_DRIVE_PATH.test(value) || WINDOWS_UNC_PATH.test(value) || value.startsWith('/')

export function normalizeMediaPath(value: string | null | undefined): string {
  if (!value) return ''

  const trimmed = value.trim()
  if (!trimmed.startsWith('media://')) return trimmed

  const legacyWindowsUrlPath = trimmed.match(/^media:\/\/([a-zA-Z])\/(.+)$/)
  if (legacyWindowsUrlPath) {
    const [, drive, rest] = legacyWindowsUrlPath
    try {
      return `${drive.toUpperCase()}:/${decodeURIComponent(rest)}`
    } catch {
      return `${drive.toUpperCase()}:/${rest}`
    }
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol === 'media:' && url.hostname === 'file') {
      return url.searchParams.get('path')?.trim() || ''
    }
  } catch {
    // Fall back to the legacy media://path parser below.
  }

  const stripped = trimmed.replace(/^media:\/\//, '')
  try {
    return decodeURIComponent(stripped)
  } catch {
    return stripped
  }
}

export function toMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null

  const normalized = normalizeMediaPath(value)
  if (!normalized) return null
  if (value.startsWith('media://file?path=')) return value
  if (isAbsoluteLikePath(normalized)) return `media://file?path=${encodeURIComponent(normalized)}`

  return value.startsWith('media://') ? value : `media://${normalized}`
}

export function resolveProjectMediaPath(
  projectFolder: string | null | undefined,
  value: string | null | undefined,
): string {
  const normalized = normalizeMediaPath(value)
  if (!normalized || isAbsoluteLikePath(normalized)) return normalized

  const normalizedProjectFolder = normalizeMediaPath(projectFolder)
  if (!normalizedProjectFolder || !isAbsoluteLikePath(normalizedProjectFolder)) return normalized

  return `${normalizedProjectFolder.replace(/[\\/]+$/, '')}/${normalized.replace(/^[\\/]+/, '')}`
}

export function getMediaPathBasename(value: string): string {
  const normalized = normalizeMediaPath(value)
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized
}
