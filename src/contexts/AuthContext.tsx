import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { UserProfile } from '../types'

interface AuthContextType {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  role: 'chefe' | 'recrutador' | null       // efetivo: contabilidade é tratado como chefe (acesso total)
  isContabilidade: boolean                  // só o Financeiro usa isso
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  const perfilDe = useRef<string | null>(null)   // de quem é o perfil carregado

  // 18/11/2026 ("parece que cai"): se a busca do perfil falhava por oscilação,
  // o perfil era zerado — o menu sumia e as telas de chefe mandavam para o
  // início. Agora tenta 3 vezes e, se a pessoa é a mesma, mantém o que já tinha.
  async function loadProfile(userId: string) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', userId)
          .single()
        if (error) throw error
        perfilDe.current = userId
        setProfile(data)
        return
      } catch {
        await new Promise(r => setTimeout(r, 700 * (tentativa + 1)))
      }
    }
    if (perfilDe.current !== userId) setProfile(null)
  }

  async function refreshProfile() {
    if (session?.user) await loadProfile(session.user.id)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (!session?.user) { perfilDe.current = null; setProfile(null); return }
      // Renovação de sessão (a cada hora e ao voltar para a aba) não muda o perfil
      if (event === 'TOKEN_REFRESHED' && perfilDe.current === session.user.id) return
      // Fora do aviso: consultar o Supabase DENTRO dele pode travar as próximas
      // consultas (trava interna da biblioteca) — a tela ficava carregando para sempre
      const uid = session.user.id
      setTimeout(() => { loadProfile(uid) }, 0)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signOut = () => {
    supabase.auth.signOut().catch(() => {})
    window.location.href = '/login'
  }

  const realRole = profile?.role ?? null
  // Contabilidade herda todo o acesso do chefe; o role "efetivo" vira 'chefe'
  const effectiveRole = realRole === 'contabilidade' ? 'chefe' : realRole

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user ?? null,
      profile,
      role: effectiveRole,
      isContabilidade: realRole === 'contabilidade',
      loading,
      signIn,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
