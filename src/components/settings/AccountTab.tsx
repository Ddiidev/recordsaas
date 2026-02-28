import { useMemo, useState } from 'react'
import { Button } from '../ui/button'
import { useDesktopAuth } from '../../hooks/useDesktopAuth'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

export function AccountTab() {
  const { authState, startLogin, logout, refresh } = useDesktopAuth()
  const [isLoading, setIsLoading] = useState(false)

  const plan = authState.license?.plan || null
  const isLifetime = plan === 'lifetime'
  const isPro = plan === 'pro'

  const planLabel = useMemo(() => {
    if (!plan) return 'Free'
    if (plan === 'lifetime') return 'Lifetime'
    if (plan === 'pro') return 'Pro'
    return plan
  }, [plan])

  const statusLabel = useMemo(() => {
    if (!authState.isAuthenticated) return 'Not logged in'

    if (!plan) {
      return 'SD Export (480p)'
    }

    if (plan === 'lifetime') {
      return authState.license?.active ? 'Active' : 'Inactive'
    }

    if (plan === 'pro') {
      const subscriptionStatus = (authState.license?.subscriptionStatus || '').toLowerCase()
      const inactiveStatuses = new Set(['canceled', 'unpaid', 'past_due', 'incomplete_expired'])
      const hasInactiveSubscriptionStatus = inactiveStatuses.has(subscriptionStatus)
      const isActive = Boolean(authState.license?.active) && !hasInactiveSubscriptionStatus
      return isActive ? 'Active' : 'Inactive'
    }

    return authState.license?.active ? 'Active' : 'Inactive'
  }, [authState.isAuthenticated, authState.license?.active, authState.license?.subscriptionStatus, plan])

  const handleAction = async (action: 'login' | 'logout' | 'refresh') => {
    setIsLoading(true)
    try {
      if (action === 'login') {
        await startLogin()
      } else if (action === 'logout') {
        await logout()
      } else {
        await refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-8 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold text-foreground mb-6">Account</h2>

      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-border bg-muted/40">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Profile</p>
          {authState.isAuthenticated && authState.user ? (
            <div className="flex items-center gap-3">
              {authState.user.picture ? (
                <img
                  src={authState.user.picture}
                  alt={authState.user.name || authState.user.email}
                  className="w-10 h-10 rounded-lg border border-primary object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg border border-primary bg-background" />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">{authState.user.name || 'Google user'}</p>
                <p className="text-xs text-muted-foreground">{authState.user.email}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sign in with Google to activate desktop entitlements.</p>
          )}
        </div>

        <div className="p-4 rounded-lg border border-border bg-muted/40 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">License</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Plan</p>
              <p className="font-medium text-foreground">{planLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium text-foreground">{statusLabel}</p>
            </div>
            {(isPro || (plan && !isLifetime)) && (
              <div>
                <p className="text-muted-foreground">License valid until</p>
                <p className="font-medium text-foreground">{formatDate(authState.license?.licenseValidUntil || null)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!authState.isAuthenticated ? (
            <Button onClick={() => void handleAction('login')} disabled={isLoading}>
              Login with Google
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void handleAction('refresh')} disabled={isLoading}>
                Refresh Entitlement
              </Button>
              <Button variant="destructive" onClick={() => void handleAction('logout')} disabled={isLoading}>
                Logout
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
