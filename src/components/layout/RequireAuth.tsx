import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, signOut } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" />
    </div>
  )
  if (!session) return <Navigate to="/login" replace />
  // Conta ainda não liberada pela chefia (migração 077): não entra. Sem perfil o banco já não mostra nada.
  if (profile?.acesso_liberado === false) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card p-6 max-w-sm text-center space-y-3">
        <p className="font-semibold text-ink-900">Acesso aguardando liberação</p>
        <p className="text-sm text-ink-500">Sua conta existe, mas ainda não foi liberada. Peça para a chefia liberar em Usuários.</p>
        <button className="btn-secondary w-full" onClick={signOut}>Sair</button>
      </div>
    </div>
  )
  return <>{children}</>
}

export function RequireChefe({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth()
  if (loading) return null
  if (role !== 'chefe') return <Navigate to="/" replace />
  return <>{children}</>
}

export function RequireContabilidade({ children }: { children: React.ReactNode }) {
  const { isContabilidade, loading } = useAuth()
  if (loading) return null
  if (!isContabilidade) return <Navigate to="/" replace />
  return <>{children}</>
}
