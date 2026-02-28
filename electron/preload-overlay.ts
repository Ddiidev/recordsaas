import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

contextBridge.exposeInMainWorld('overlayAPI', {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    const allowed = ['settings:get']
    if (allowed.includes(channel)) return ipcRenderer.invoke(channel, ...args)
    return Promise.reject(new Error(`Blocked channel: ${channel}`))
  },
  send: (channel: string, ...args: unknown[]): void => {
    const allowed = ['window:minimize', 'export-progress:set-collapsed']
    if (allowed.includes(channel)) ipcRenderer.send(channel, ...args)
  },
  on: (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const allowed = ['export:progress', 'export:complete']
    if (!allowed.includes(channel)) return () => {}
    const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  removeAllListeners: (channel: string): void => {
    const allowed = ['export:progress', 'export:complete']
    if (allowed.includes(channel)) ipcRenderer.removeAllListeners(channel)
  },
  sendSelection: (data: unknown): void => ipcRenderer.send('selection:complete', data),
  cancelSelection: (): void => ipcRenderer.send('selection:cancel'),
})
