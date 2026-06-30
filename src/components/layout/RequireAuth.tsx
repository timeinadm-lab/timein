import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function RequireChefe({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return null
  if (role !== 'chefe') return <Navigate to="/" replace />
  return <>{children}</>
}
