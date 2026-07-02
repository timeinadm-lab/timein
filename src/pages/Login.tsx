import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { isConfigured } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      toast.error('E-mail ou senha incorretos. Confira e tente novamente.')
    } else {
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden bg-gradient-to-br from-primary-800 via-primary-700 to-primary-900">
      {/* Brilhos de marca no fundo */}
      <div className="absolute -top-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-primary-400/20 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 w-[28rem] h-[28rem] rounded-full bg-primary-500/15 blur-3xl" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-white/5 blur-3xl" />

      <div className="w-full max-w-md relative animate-fade-in">
        <div className="text-center mb-8">
          <img
            src="/logo.svg"
            alt="TIN"
            className="w-20 h-20 mx-auto mb-5 rounded-[1.4rem] shadow-lift"
          />
          <h1 className="text-4xl font-display font-extrabold text-white tracking-tight">TIN</h1>
          <p className="text-primary-100/90 mt-1.5 font-medium">Time IN · Gestão de RH</p>
        </div>

        {!isConfigured && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <strong>Atenção:</strong> As variáveis de ambiente <code>VITE_SUPABASE_URL</code> e{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> não estão configuradas. Copie{' '}
            <code>.env.example</code> para <code>.env</code> e preencha com suas credenciais do Supabase.
          </div>
        )}

        <div className="card shadow-lift p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">E-mail</label>
              <input
                type="email"
                className="input !text-base py-3"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label className="label">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input !text-base py-3 pr-12"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-400 hover:text-ink-700 transition-colors"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="btn-primary w-full mt-2 py-3.5 text-base"
              disabled={loading}
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-primary-100/70 mt-6">TIN · Gestão de RH para consultoria de nutrição</p>
      </div>
    </div>
  )
}
