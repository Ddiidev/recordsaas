import {
  getAuthSession,
  logoutAuthSession,
  startDesktopAuthLogin,
} from '../../features/auth-manager'

export async function handleAuthGetSession() {
  return getAuthSession()
}

export async function handleAuthStartLogin() {
  await startDesktopAuthLogin()
  return { success: true }
}

export function handleAuthLogout() {
  return logoutAuthSession()
}
