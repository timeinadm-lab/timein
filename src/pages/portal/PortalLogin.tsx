import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function PortalLogin() {
  const navigate = useNavigate()
  const [cpf, setCpf] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!cpf.trim() || !pin.trim()) { toast.error('Preencha CPF e senha'); return }
    setLoading(true)
    try {
      // A senha é validada no servidor (função portal_login). O navegador nunca
      // lê a tabela de colaboradores nem recebe o PIN de ninguém.
      const { data, error } = await supabase.rpc('portal_login', { p_cpf: cpf.trim(), p_pin: pin })
      if (error) { toast.error('Erro ao acessar o portal'); return }
      if (!data) { toast.error('CPF ou senha incorretos, ou colaborador inativo'); return }

      localStorage.setItem('portal_token', data.token)
      localStorage.setItem('portal_employee_id', data.employee_id)
      localStorage.setItem('portal_employee_name', data.full_name)
      localStorage.setItem('portal_session_ts', String(Date.now()))
      navigate('/portal/home')
    } catch {
      toast.error('Erro ao acessar o portal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">TI</div>
          <h1 className="text-2xl font-bold text-gray-900">Portal do Nutricionista</h1>
          <p className="text-gray-500 mt-1 text-sm">Time IN</p>
        </div>
        <div className="card p-6 space-y-4">
          <div>
            <label className="label">CPF</label>
            <input
              className="input"
              placeholder="000.000.000-00"
              value={cpf}
              autoComplete="off"
              onChange={e => setCpf(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
            />
          </div>
          <div>
            <label className="label">Senha</label>
            <input
              className="input"
              type="password"
              placeholder="Senha criada pelo seu gestor"
              value={pin}
              autoComplete="new-password"
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
            />
          </div>
          <button className="btn-primary w-full" onClick={handleLogin} disabled={loading || !cpf || !pin}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
