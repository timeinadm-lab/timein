import { useState } from 'react'
import { User, Lock, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { profile, role } = useAuth()
  const [showPass, setShowPass] = useState(false)
  const [form, setForm] = useState({ newPass: '', confirm: '' })
  const [saving, setSaving] = useState(false)

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.newPass.length < 6) { toast.error('A senha deve ter no mínimo 6 caracteres.'); return }
    if (form.newPass !== form.confirm) { toast.error('As senhas não coincidem.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: form.newPass })
      if (error) throw error
      toast.success('Senha alterada com sucesso!')
      setForm({ newPass: '', confirm: '' })
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao alterar senha.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="eyebrow mb-1">Conta</p>
        <h1 className="text-2xl font-display font-extrabold text-ink-900">Meu Perfil</h1>
      </div>

      {/* Info card */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-lg font-bold flex-shrink-0">
            <User size={22} />
          </div>
          <div>
            <p className="font-semibold text-ink-900 text-lg">{profile?.full_name || '—'}</p>
            <p className="text-sm text-ink-400">{profile?.email || '—'}</p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <span className={`badge ${role === 'chefe' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {role === 'chefe' ? 'Chefe' : 'Recrutador'}
          </span>
        </div>
      </div>

      {/* Alterar senha */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 text-ink-700 font-semibold">
          <Lock size={18} />
          Alterar Senha
        </div>

        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="label">Nova Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className="input pr-10"
                placeholder="Mínimo 6 caracteres"
                value={form.newPass}
                onChange={e => setForm(f => ({ ...f, newPass: e.target.value }))}
                required
                minLength={6}
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="label">Confirmar Nova Senha</label>
            <input
              type={showPass ? 'text' : 'password'}
              className="input"
              placeholder="Repita a nova senha"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Nova Senha'}
          </button>
        </form>
      </div>
    </div>
  )
}
