import { useCallback, useEffect, useState } from 'react'
import type { DesktopAuthState } from '../types/auth'

const EMPTY_AUTH_STATE: DesktopAuthState = {
  isAuthenticated: false,
  canExport: false,
  watermarkRequired: true,
  reason: 'not_logged_in',
  user: null,
  license: null,
  sessionExpiresAt: null,
  entitlementExpiresAt: null,
  apiBaseUrl: '',
}

export function useDesktopAuth() {
  const [authState, setAuthState] = useState<DesktopAuthState>(EMPTY_AUTH_STATE)

  useEffect(() => {
    let mounted = true

    const loadInitialState = async () => {
      try {
        const state = await window.electronAPI.authGetState()
        if (mounted) {
          setAuthState(state)
        }
      } catch (error) {
        console.error('Failed to load desktop auth state:', error)
      }
    }

    void loadInitialState()

    const cleanup = window.electronAPI.onAuthChanged((state) => {
      if (mounted) {
        setAuthState(state)
      }
    })

    return () => {
      mounted = false
      cleanup()
    }
  }, [])

  const startLogin = useCallback(async () => {
    try {
      await window.electronAPI.authStartLogin()
    } catch (error) {
      console.error('Failed to start login flow:', error)
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await window.electronAPI.authLogout()
    } catch (error) {
      console.error('Failed to logout:', error)
      throw error
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const response = await window.electronAPI.authRefresh()
      if (response?.state) {
        setAuthState(response.state)
      }
    } catch (error) {
      console.error('Failed to refresh auth tokens:', error)
      throw error
    }
  }, [])

  return {
    authState,
    startLogin,
    logout,
    refresh,
  }
}
