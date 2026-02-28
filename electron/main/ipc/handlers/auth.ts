import { IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main'
import {
  getDesktopAuthState,
  logoutDesktopAuth,
  refreshDesktopAuthNow,
  startDesktopLogin,
} from '../../features/auth-manager'

export async function handleAuthGetState(_event: IpcMainInvokeEvent) {
  return getDesktopAuthState()
}

export async function handleAuthStartLogin(_event: IpcMainInvokeEvent) {
  log.info('[Auth IPC] Login request received')
  await startDesktopLogin()
  return { success: true }
}

export async function handleAuthLogout(_event: IpcMainInvokeEvent) {
  log.info('[Auth IPC] Logout request received')
  await logoutDesktopAuth()
  return { success: true }
}

export async function handleAuthRefresh(_event: IpcMainInvokeEvent) {
  log.info('[Auth IPC] Refresh request received')
  const state = await refreshDesktopAuthNow()
  return { success: true, state }
}
