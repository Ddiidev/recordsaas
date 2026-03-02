import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Login, Logout, UserCircle } from 'tabler-icons-react'
import type { AuthSession } from '../../types/auth'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

const EMPTY_SESSION: AuthSession = {
  user: null,
  license: null,
  credits: null,
  sessionToken: null,
  entitlementToken: null,
  isAuthenticated: false,
  status: 'free',
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return `${local.slice(0, 5)}***@${domain}`
}

function getPlanLabel(session: AuthSession): string {
  const plan = session.license?.plan
  if (plan === 'lifetime') return 'Lifetime'
  if (plan) return 'Pro'
  return 'Free'
}

function getStatusLabel(session: AuthSession): string {
  if (session.status === 'active') return 'Ativo'
  if (session.status === 'canceled') return 'Cancelado'
  return 'Free'
}

export function AccountTab() {
  const [session, setSession] = useState<AuthSession>(EMPTY_SESSION)
  const [isLoading, setIsLoading] = useState(true)
  const [isBusy, setIsBusy] = useState(false)

  const loadAuthSession = useCallback(async () => {
    try {
      const authSession = await window.electronAPI.getAuthSession()
      setSession(authSession)
    } catch (error) {
      console.error('Failed to load auth session:', error)
      setSession(EMPTY_SESSION)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAuthSession()

    const cleanupSessionUpdated = window.electronAPI.onAuthSessionUpdated((nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
      setIsBusy(false)
    })

    const cleanupDeepLink = window.electronAPI.onAuthDeepLink((payload) => {
      if (payload.status === 'error') {
        console.error('Desktop login deep-link error:', payload.error || payload.rawUrl)
      }
      setIsBusy(false)
      void loadAuthSession()
    })

    return () => {
      cleanupSessionUpdated()
      cleanupDeepLink()
    }
  }, [loadAuthSession])

  const handleLogin = async () => {
    setIsBusy(true)
    try {
      await window.electronAPI.startAuthLogin()
    } catch (error) {
      console.error('Failed to open desktop login flow:', error)
      setIsBusy(false)
    }
  }

  const handleLogout = async () => {
    setIsBusy(true)
    try {
      const nextSession = await window.electronAPI.logoutAuth()
      setSession(nextSession)
    } catch (error) {
      console.error('Failed to logout desktop session:', error)
    } finally {
      setIsBusy(false)
    }
  }

  const userName = session.user?.name || 'Not logged in'
  const userEmail = session.user?.email ? maskEmail(session.user.email) : '—'

  const statusClassName = useMemo(() => {
    if (session.status === 'active') {
      return 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
    }

    if (session.status === 'canceled') {
      return 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    }

    return 'bg-muted text-muted-foreground border-border'
  }, [session.status])

  if (isLoading) {
    return (
      <div className="p-8 h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="p-8 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold text-foreground mb-6">Account</h2>

      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl border-2 border-emerald-500 overflow-hidden bg-background flex items-center justify-center">
            {session.user?.picture ? (
              <img
                src={session.user.picture}
                alt={userName}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <UserCircle className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{userName}</p>
            <p className="text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Plano</span>
            <span className="text-sm font-medium text-foreground">{getPlanLabel(session)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <span className={cn('text-xs font-semibold px-2 py-1 rounded-md border', statusClassName)}>
              {getStatusLabel(session)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6">
        {session.isAuthenticated ? (
          <Button
            variant="destructive"
            className="w-full"
            onClick={handleLogout}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Logout className="w-4 h-4 mr-2" />}
            Log out
          </Button>
        ) : (
          <Button className="w-full" onClick={handleLogin} disabled={isBusy}>
            {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Login className="w-4 h-4 mr-2" />}
            Sign in with Google
          </Button>
        )}
      </div>
    </div>
  )
}
