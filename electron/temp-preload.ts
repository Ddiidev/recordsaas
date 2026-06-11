/* eslint-disable @typescript-eslint/no-explicit-any */
// Lightweight preload for temporary windows (selection, export-progress, saving)
// These windows only need basic IPC capabilities.

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/* ------------------------------------------------------------------ */
//  Typed contract exposed to temporary windows via window.tempAPI
/* ------------------------------------------------------------------ */
export interface TempAPI {
  send(channel: string, ...args: any[]): void
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  removeAllListeners(channel: string): void
}

/* ------------------------------------------------------------------ */
//  Whitelist of channels allowed from temporary windows
/* ------------------------------------------------------------------ */
const VALID_SEND_CHANNELS = new Set<string>([
  'selection:complete',
  'selection:cancel',
  'window:minimize',
  'export-progress:set-collapsed',
])

const VALID_INVOKE_CHANNELS = new Set<string>([
  'settings:get',
  'export-progress:get-state',
])

const VALID_ON_CHANNELS = new Set<string>([
  'export:progress',
  'export:complete',
])

function validateChannel(map: Set<string>, channel: string): boolean {
  if (!map.has(channel)) {
    console.error(`[TempPreload] Blocked unauthorized channel: "${channel}"`)
    return false
  }
  return true
}

const tempAPI: TempAPI = {
  send(channel, ...args) {
    if (validateChannel(VALID_SEND_CHANNELS, channel)) {
      ipcRenderer.send(channel, ...args)
    }
  },

  invoke(channel, ...args) {
    if (validateChannel(VALID_INVOKE_CHANNELS, channel)) {
      return ipcRenderer.invoke(channel, ...args)
    }
    return Promise.reject(new Error(`[TempPreload] Unauthorized invoke channel: "${channel}"`))
  },

  on(channel, callback) {
    if (!validateChannel(VALID_ON_CHANNELS, channel)) {
      return () => {}
    }
    const listener = (_event: IpcRendererEvent, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },

  removeAllListeners(channel) {
    if (validateChannel(VALID_ON_CHANNELS, channel)) {
      ipcRenderer.removeAllListeners(channel)
    }
  },
}

contextBridge.exposeInMainWorld('tempAPI', tempAPI)
console.info('[TempPreload] tempAPI bridge exposed.')
