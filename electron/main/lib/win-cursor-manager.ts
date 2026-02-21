/* eslint-disable @typescript-eslint/no-explicit-any */
// electron/main/lib/win-cursor-manager.ts

import log from 'electron-log/main'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let nativeModule: any
const handleToNameMap: Record<number, string> = {}
let isInitialized = false

// These IDs are standard Windows cursor identifiers.
const CURSOR_IDS = {
  IDC_ARROW: 32512,
  IDC_IBEAM: 32513,
  IDC_WAIT: 32514,
  IDC_CROSS: 32515,
  IDC_UPARROW: 32516,
  IDC_SIZE: 32640,
  IDC_ICON: 32641,
  IDC_SIZENWSE: 32642,
  IDC_SIZENESW: 32643,
  IDC_SIZEWE: 32644,
  IDC_SIZENS: 32645,
  IDC_SIZEALL: 32646,
  IDC_NO: 32648,
  IDC_HAND: 32649,
  IDC_APPSTARTING: 32650,
  IDC_HELP: 32651,
}

// Maps cursor names from the cursor theme to the standard Windows IDC names.
// This is important because file names might differ from standard constants.
const CURSOR_NAME_TO_IDC_MAP: Record<string, string> = {
  Arrow: 'IDC_ARROW',
  AppStarting: 'IDC_APPSTARTING',
  Cross: 'IDC_CROSS',
  Hand: 'IDC_HAND',
  Help: 'IDC_HELP',
  IBeam: 'IDC_IBEAM',
  NO: 'IDC_NO',
  SizeAll: 'IDC_SIZEALL',
  SizeNESW: 'IDC_SIZENESW',
  SizeNS: 'IDC_SIZENS',
  SizeNWSE: 'IDC_SIZENWSE',
  SizeWE: 'IDC_SIZEWE',
  UpArrow: 'IDC_UPARROW',
  Wait: 'IDC_WAIT',
}

export function initializeWinCursorManager() {
  try {
    nativeModule = require('node-win-cursor')
    isInitialized = true

    for (const [name, id] of Object.entries(CURSOR_IDS)) {
      const handle = nativeModule.loadCursorById(id)
      if (handle) handleToNameMap[Number(handle)] = name
    }
    log.info('[WinCursorManager] Initialized successfully with native node-win-cursor module.')
  } catch (e) {
    log.error('[WinCursorManager] Failed to initialize:', e)
  }
}

export function getCurrentCursorName(): string {
  if (!isInitialized || !nativeModule) {
    return 'IDC_ARROW' // Default fallback
  }
  try {
    const handle = nativeModule.getCurrentCursorHandle()
    return handleToNameMap[Number(handle)] || 'IDC_ARROW'
  } catch (e) {
    log.warn('[WinCursorManager] Could not get current cursor handle from native module:', e)
    return 'IDC_ARROW'
  }
}

/**
 * Maps a cursor name (e.g., "Arrow") to a standard IDC name (e.g., "IDC_ARROW").
 * @param cursorName The cursor name from the cursor theme.
 * @returns The corresponding IDC_ constant name, or the original name if not found.
 */
export function mapCursorNameToIDC(cursorName: string): string {
  return CURSOR_NAME_TO_IDC_MAP[cursorName] || cursorName
}
