import { IpcMainInvokeEvent } from 'electron'
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
  await startDesktopLogin()
  return { success: true }
}

export async function handleAuthLogout(_event: IpcMainInvokeEvent) {
  await logoutDesktopAuth()
  return { success: true }
}

export async function handleAuthRefresh(_event: IpcMainInvokeEvent) {
  const state = await refreshDesktopAuthNow()
  return { success: true, state }
}
