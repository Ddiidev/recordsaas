import { useMemo, useState } from 'react'
import { Button } from '../ui/button'
import { useDesktopAuth } from '../../hooks/useDesktopAuth'

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function formatCurrency(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined || !currency) return '—'

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100)
  } catch {
    return `${amount / 100} ${currency.toUpperCase()}`
  }
}

export function AccountTab() {
  const { authState, startLogin, logout, refresh } = useDesktopAuth()
  const [isLoading, setIsLoading] = useState(false)

  const planLabel = useMemo(() => {
    if (!authState.license?.plan) return 'Free'
    if (authState.license.plan === 'lifetime') return 'Lifetime'
    if (authState.license.plan === 'pro') return 'Pro'
    return authState.license.plan
  }, [authState.license?.plan])

  const statusLabel = useMemo(() => {
    if (!authState.isAuthenticated) return 'Not logged in'
    if (authState.canExport) return 'Export enabled'
    return 'Free export (480p/30)'
  }, [authState.canExport, authState.isAuthenticated, authState.reason])

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
            <div>
              <p className="text-muted-foreground">License valid until</p>
              <p className="font-medium text-foreground">{formatDate(authState.license?.licenseValidUntil || null)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Paid amount</p>
              <p className="font-medium text-foreground">{formatCurrency(authState.license?.paidAmount || null, authState.license?.paidCurrency || null)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Watermark fallback</p>
              <p className="font-medium text-foreground">{authState.watermarkRequired ? 'Enabled' : 'Disabled'}</p>
            </div>
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
