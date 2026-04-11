import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Protects routes that require admin/tk_master role.
 * - While auth is loading: renders nothing (avoids flash redirect)
 * - Not authenticated: redirects to /login
 * - Authenticated but not admin: redirects to /chat
 * - Admin: renders children
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/chat" replace />

  return <>{children}</>
}
