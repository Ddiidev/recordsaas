import path from 'node:path'

export function normalizeMediaPath(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null
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
      const filePath = url.searchParams.get('path')?.trim()
      return filePath || null
    }
  } catch {
    // Fall back to the legacy media://path parser below.
  }

  const stripped = trimmed.replace(/^media:\/\//, '')
  try {
    const decoded = decodeURIComponent(stripped).trim()
    return decoded || null
  } catch {
    return stripped.trim() || null
  }
}

export function toMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null
  if (value.startsWith('media://file?path=')) return value

  const normalized = normalizeMediaPath(value)
  if (!normalized) return null
  if (path.isAbsolute(normalized)) return `media://file?path=${encodeURIComponent(normalized)}`

  return value.startsWith('media://') ? value : `media://${normalized}`
}

export function resolveMediaRequestPath(requestUrl: string, publicRoot: string): string | null {
  const normalized = normalizeMediaPath(requestUrl)
  if (!normalized) return null
  return path.isAbsolute(normalized) ? normalized : path.join(publicRoot, normalized)
}
