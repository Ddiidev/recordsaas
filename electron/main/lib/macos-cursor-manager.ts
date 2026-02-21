/* eslint-disable @typescript-eslint/no-explicit-any */

import log from 'electron-log/main'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const hash = (buffer: Buffer) => createHash('sha1').update(buffer).digest('hex')

let nativeModule: any
const hashToNameMap: Record<string, string> = {}
let isInitialized = false

// These IDs are standard macOS cursor identifiers.
const CURSOR_NAMES = ['arrow', 'IBeam', 'crosshair', 'closedHand', 'openHand', 'pointingHand']

export function initializeMacOSCursorManager() {
  try {
    nativeModule = require('node-macos-cursor')
    isInitialized = true

    for (const name of CURSOR_NAMES) {
      const imageBuffer = nativeModule.getCursorPNGByName(name)
      const imageKey = hash(imageBuffer)
      hashToNameMap[imageKey] = name
    }
    log.info('[MacOSCursorManager] Initialized successfully with macos-cursor-manager and created image map.')
  } catch (e) {
    log.error('[MacOSCursorManager] Failed to initialize:', e)
  }
}

export function getCurrentCursorName(): string {
  if (!isInitialized) return 'arrow'
  try {
    const imageBuffer = nativeModule.getCurrentCursorPNG()
    const imageKey = hash(imageBuffer)
    return hashToNameMap[imageKey] || 'arrow'
  } catch (e) {
    log.warn('[MacOSCursorManager] Could not get current cursor image:', e)
    return 'arrow'
  }
}
