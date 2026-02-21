import { app, BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { appState } from '../../state'
import { createRecorderWindow } from '../../windows/recorder-window'

export function handleGetPath(_event: IpcMainInvokeEvent, name: 'home' | 'userData' | 'desktop' | 'documents') {
  return app.getPath(name)
}

export function handleGetVersion() {
  return app.getVersion()
}

export function handleGetPlatform() {
  return process.platform
}

export function minimizeWindow(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.minimize()
}

export function maximizeWindow(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window?.isMaximized()) {
    window.unmaximize()
  } else {
    window?.maximize()
  }
}

export function closeWindow(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.close()
}

export function openRecorderWindow(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.close()
  if (!appState.recorderWin || appState.recorderWin.isDestroyed()) {
    createRecorderWindow()
  } else {
    appState.recorderWin.show()
  }
}

export function recorderClickThrough(event: IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender)
  window?.setIgnoreMouseEvents(true, { forward: true })
  setTimeout(() => {
    window?.setIgnoreMouseEvents(false)
  }, 100)
}

export function handleIsMaximized(event: IpcMainInvokeEvent): boolean {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window?.isMaximized() ?? false
}

export function updateTitleBarOverlay(_event: IpcMainEvent, options: { color: string; symbolColor: string }) {
  if (process.platform !== 'win32') return

  const editorWindow = appState.editorWin
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.setTitleBarOverlay(options)
  }
}
