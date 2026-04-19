import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Protects routes that require manager or admin role.
 * - While auth is loading: renders nothing (avoids flash redirect)
 * - Not authenticated: redirects to /login
 * - Authenticated but insufficient role: redirects to /chat
 * - Manager/Admin: renders children
 */
export function RequireManager({ children }: { children: React.ReactNode }) {
  const { user, isManager, loading } = useAuth()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!isManager) return <Navigate to="/chat" replace />

  return <>{children}</>
}

/**
 * Protects routes that require admin role (full access).
 */
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth()

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/chat" replace />

  return <>{children}</>
}
