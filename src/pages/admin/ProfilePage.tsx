import { useState, useRef, useEffect } from 'react'
import { User, Lock, Eye, EyeOff, Camera, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { SignedImage } from '../../components/ui/SignedFile'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { profile, role, refreshProfile } = useAuth()
  const [showPass, setShowPass] = useState(false)
  const [form, setForm] = useState({ newPass: '', confirm: '' })
  const [saving, setSaving] = useState(false)

  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [uploading, setUploading] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  // O perfil chega depois do primeiro render — só então dá pra preencher o campo
  useEffect(() => { setName(profile?.full_name || '') }, [profile?.full_name])

  const nameChanged = name.trim() !== (profile?.full_name || '') && !!name.trim()

  const handleSaveName = async () => {
    if (!profile?.id || !nameChanged) return
    setSavingName(true)
    const { error } = await supabase.from('user_profiles')
      .update({ full_name: name.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) { toast.error(error.message); return }
    await refreshProfile()
    toast.success('Nome atualizado!')
  }

  const handlePhoto = async (file: File) => {
    if (!profile?.id) return
    if (!file.type.startsWith('image/')) { toast.error('Apenas imagens'); return }
    if (file.size > 5_000_000) { toast.error('Máximo 5MB'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()
    // Mesmo bucket e padrão de caminho usado na foto do colaborador
    const path = `perfil-${profile.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from('fotos de funcionários').upload(path, file, { upsert: true })
    if (upErr) { toast.error('Erro no upload da foto'); setUploading(false); return }
    const { error } = await supabase.from('user_profiles')
      .update({ photo_url: path }).eq('id', profile.id)
    setUploading(false)
    if (error) { toast.error(error.message); return }
    await refreshProfile()
    toast.success('Foto atualizada!')
  }

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

  const photo = profile?.photo_url

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="eyebrow mb-1">Conta</p>
        <h1 className="text-2xl font-display font-extrabold text-ink-900">Meu Perfil</h1>
      </div>

      {/* Foto + nome */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            disabled={uploading}
            className="relative w-20 h-20 rounded-full overflow-hidden flex-shrink-0 group ring-2 ring-white shadow-soft disabled:opacity-60"
            title="Trocar foto"
          >
            {photo ? (
              <SignedImage value={photo} bucket="fotos de funcionários" alt={profile?.full_name || 'foto'}
                className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full bg-primary-100 flex items-center justify-center text-primary-700">
                <User size={30} />
              </span>
            )}
            <span className="absolute inset-0 bg-black/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera size={20} className="text-white" />
            </span>
          </button>
          <input ref={photoRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = '' }} />

          <div className="min-w-0">
            <p className="text-sm text-ink-400">{profile?.email || '—'}</p>
            <span className={`badge mt-1 ${role === 'chefe' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
              {role === 'chefe' ? 'Chefe' : role === 'contabilidade' ? 'Contabilidade' : 'Recrutador'}
            </span>
            <button type="button" onClick={() => photoRef.current?.click()} disabled={uploading}
              className="block text-xs text-primary-600 hover:underline font-medium mt-1.5 disabled:opacity-60">
              {uploading ? 'Enviando foto...' : photo ? 'Trocar foto' : 'Adicionar foto'}
            </button>
          </div>
        </div>

        <div>
          <label className="label">Seu nome</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={name}
              placeholder="Como você quer aparecer no sistema"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nameChanged) handleSaveName() }}
            />
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!nameChanged || savingName}
              className="btn-primary px-3 flex-shrink-0 disabled:opacity-40"
            >
              {savingName ? '...' : <Check size={16} />}
            </button>
          </div>
          <p className="text-xs text-ink-400 mt-1">
            É este nome que aparece nos compromissos da agenda e como responsável.
          </p>
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
