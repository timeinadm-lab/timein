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
    // Duas metades: a marca (verde, liso) e o formulário no fundo papel.
    // Antes: degradê com brilhos desfocados — a cara de template.
    <div className="min-h-screen grid md:grid-cols-2 bg-[#f7f6f2]">
      <div className="bg-primary-900 text-white px-6 pt-10 pb-8 md:p-12 flex flex-col justify-between"
        style={{ paddingTop: 'max(2.5rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="TIN" className="w-9 h-9 rounded-lg" />
          <span className="font-serif text-2xl leading-none">TIN</span>
        </div>
        <div className="mt-8 md:mt-0">
          <h1 className="font-serif text-4xl md:text-6xl leading-[1.05] tracking-tight text-white">
            Gestão de pessoas<br /><em className="text-primary-300">para nutrição.</em>
          </h1>
          <p className="hidden md:block text-primary-200/80 mt-4 max-w-sm text-sm leading-relaxed">
            Colaboradores, vagas, visitas e pagamentos da consultoria num lugar só.
          </p>
        </div>
        <p className="hidden md:block text-xs text-primary-300/70">Time IN</p>
      </div>

      <div className="flex items-start md:items-center justify-center p-6 md:p-12">
      <div className="w-full max-w-sm animate-fade-in">
        <h2 className="text-xl font-semibold text-ink-900 mb-1">Entrar</h2>
        <p className="text-sm text-ink-500 mb-6">Use o e-mail e a senha do sistema.</p>

        {!isConfigured && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            <strong>Atenção:</strong> As variáveis de ambiente <code>VITE_SUPABASE_URL</code> e{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> não estão configuradas. Copie{' '}
            <code>.env.example</code> para <code>.env</code> e preencha com suas credenciais do Supabase.
          </div>
        )}

        <div>
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
      </div>
      </div>
    </div>
  )
}
