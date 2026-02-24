import { app, BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, screen } from 'electron'
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

export function setExportProgressCollapsed(_event: IpcMainEvent, payload: { collapsed?: boolean }) {
  const exportWindow = appState.exportProgressWin
  if (!exportWindow || exportWindow.isDestroyed()) return

  const collapsed = Boolean(payload?.collapsed)
  const expandedWidth = 220
  const collapsedWidth = 24
  const widgetHeight = 42
  const edgeMargin = collapsed ? 0 : 12

  const currentBounds = exportWindow.getBounds()
  const display = screen.getDisplayMatching(currentBounds)
  const { workArea } = display
  const targetWidth = collapsed ? collapsedWidth : expandedWidth
  const targetX = Math.round(workArea.x + workArea.width - targetWidth - edgeMargin)
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - widgetHeight)
  const targetY = Math.min(Math.max(currentBounds.y, workArea.y), maxY)

  exportWindow.setBounds(
    {
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: widgetHeight,
    },
    true,
  )
}
