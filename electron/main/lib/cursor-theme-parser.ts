import fs from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { AniParser, CursorParser } from './cursor-file-parser'
import { CursorTheme } from '../types'

/**
 * Detects the file type from a buffer.
 */
function detectFileType(buffer: Buffer): 'ani' | 'cur' | 'unknown' {
  if (buffer.length < 16) return 'unknown'
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'ACON') {
    return 'ani'
  }
  const type = buffer.readUInt16LE(2)
  if (type === 2) return 'cur'
  return 'unknown'
}

/**
 * Parses a .theme file with the CURA format.
 */
export async function loadCursorThemeFromFile(themePath: string): Promise<CursorTheme> {
  const buf = await fs.readFile(themePath)
  if (buf.toString('ascii', 0, 4) !== 'CURA') {
    throw new Error('Incorrect CURA format')
  }

  const total = buf.readUInt32LE(4)
  let offset = 8
  const result: CursorTheme = {}

  for (let i = 0; i < total; i++) {
    const type = buf.readUInt8(offset)
    offset += 1 // 0 for CUR, 1 for ANI, 2 for auto-detect
    const nameLen = buf.readUInt32LE(offset)
    offset += 4
    const name = buf.toString('utf8', offset, offset + nameLen)
    offset += nameLen
    const dataLen = buf.readUInt32LE(offset)
    offset += 4
    const data = buf.slice(offset, offset + dataLen)
    offset += dataLen

    let parser: AniParser | CursorParser
    const detectedType = type === 2 ? detectFileType(data) : type === 1 ? 'ani' : 'cur'

    if (detectedType === 'ani') {
      parser = new AniParser(data)
    } else if (detectedType === 'cur') {
      parser = new CursorParser(data)
    } else {
      log.warn(`[CURAParser] Skipping ${name} (unknown file type)`)
      continue
    }

    try {
      const parsed = parser.parse()
      for (const [scaleStr, frames] of Object.entries(parsed)) {
        const scale = parseFloat(scaleStr)
        if (!result[scale]) result[scale] = {}
        const baseName = path.basename(name, path.extname(name))
        result[scale][baseName] = frames
      }
    } catch (e) {
      log.error(`[CURAParser] ❌ Error parsing ${name}:`, e)
    }
  }
  return result
}
