import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Edit, Key, Plus, Check, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { getInitials } from '../../lib/utils'
import { SkeletonRows } from '../../components/ui/Skeleton'
import toast from 'react-hot-toast'

export default function UserManagement() {
  const { user: currentUser, role } = useAuth()
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState<'chefe' | 'recrutador'>('recrutador')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ full_name: '', email: '', password: '', role: 'recrutador' as 'chefe' | 'recrutador' })
  const [pinValue, setPinValue] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')

  const { data: hasDeletePin } = useQuery({
    queryKey: ['has-delete-pin'],
    queryFn: async () => {
      const { data } = await supabase.rpc('has_delete_pin')
      return !!data
    },
    enabled: role === 'chefe',
  })

  const setDeletePin = useMutation({
    mutationFn: async () => {
      if (pinValue.length < 4) throw new Error('O PIN precisa de pelo menos 4 dígitos')
      if (pinValue !== pinConfirm) throw new Error('Os PINs não coincidem')
      const { error } = await supabase.rpc('set_delete_pin', { p_pin: pinValue })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('PIN de exclusão definido!')
      qc.invalidateQueries({ queryKey: ['has-delete-pin'] })
      setPinValue(''); setPinConfirm('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: users, isLoading } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('*').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'chefe' | 'recrutador' }) => {
      const { error } = await supabase.from('user_profiles').update({ role }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Role atualizado!')
      qc.invalidateQueries({ queryKey: ['user-profiles'] })
      setEditingId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const createUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.auth.signUp({
        email: newForm.email,
        password: newForm.password,
        options: { data: { full_name: newForm.full_name } },
      })
      if (error) throw error
      if (data.user) {
        await supabase.from('user_profiles').upsert({
          id: data.user.id,
          full_name: newForm.full_name,
          email: newForm.email,
          role: newForm.role,
        })
      }
    },
    onSuccess: () => {
      toast.success('Usuário criado! Lembre de verificar as configurações de e-mail no Supabase.')
      qc.invalidateQueries({ queryKey: ['user-profiles'] })
      setShowNewForm(false)
      setNewForm({ full_name: '', email: '', password: '', role: 'recrutador' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resetPassword = async (email: string) => {
    if (!confirm(`Enviar link de redefinição para ${email}?`)) return
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) toast.error(error.message)
    else toast.success('Link enviado!')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Administração</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Gestão de Usuários</h1>
        </div>
        <button onClick={() => setShowNewForm(true)} className="btn-primary text-sm"><Plus size={16} />Novo Usuário</button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
        <strong>Lembrete:</strong> Desative "Email Confirmation" em Authentication → Providers no Supabase para que novos usuários possam fazer login imediatamente.
      </div>

      {/* PIN de exclusão — só o chefe define */}
      {role === 'chefe' && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
              <Key size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="section-title text-base">PIN de Exclusão</h3>
              <p className="text-xs text-ink-400">
                {hasDeletePin
                  ? 'Um PIN já está configurado. Defina abaixo para trocá-lo.'
                  : 'Nenhum PIN definido ainda. Apagar vaga, colaborador ou cliente exige este PIN.'}
              </p>
            </div>
            {hasDeletePin && <span className="badge bg-primary-100 text-primary-700 ml-auto">Ativo</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Novo PIN (mín. 4 dígitos)</label>
              <input type="password" inputMode="numeric" className="input tracking-widest" placeholder="••••" value={pinValue} onChange={e => setPinValue(e.target.value)} />
            </div>
            <div>
              <label className="label">Confirmar PIN</label>
              <input type="password" inputMode="numeric" className="input tracking-widest" placeholder="••••" value={pinConfirm} onChange={e => setPinConfirm(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary text-sm" disabled={setDeletePin.isPending || !pinValue || !pinConfirm} onClick={() => setDeletePin.mutate()}>
              {setDeletePin.isPending ? 'Salvando…' : hasDeletePin ? 'Trocar PIN' : 'Definir PIN'}
            </button>
            <p className="text-xs text-ink-400">Só você (chefe) consegue definir. Os recrutadores precisam dele para apagar registros.</p>
          </div>
        </div>
      )}

      {showNewForm && (
        <div className="card p-5 space-y-4">
          <h3 className="font-medium">Novo Usuário</h3>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Nome *</label><input className="input" required value={newForm.full_name} onChange={e => setNewForm(p => ({ ...p, full_name: e.target.value }))} /></div>
            <div><label className="label">E-mail *</label><input className="input" type="email" required value={newForm.email} onChange={e => setNewForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div><label className="label">Senha *</label><input className="input" type="password" required value={newForm.password} onChange={e => setNewForm(p => ({ ...p, password: e.target.value }))} /></div>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={newForm.role} onChange={e => setNewForm(p => ({ ...p, role: e.target.value as 'chefe' | 'recrutador' }))}>
                <option value="recrutador">Recrutador</option>
                <option value="chefe">Chefe</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button className="btn-primary" onClick={() => createUser.mutate()} disabled={!newForm.email || !newForm.password || !newForm.full_name || createUser.isPending}>
              {createUser.isPending ? 'Criando...' : 'Criar Usuário'}
            </button>
            <button className="btn-secondary" onClick={() => setShowNewForm(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <SkeletonRows count={4} />
      ) : (
        <div className="card divide-y divide-gray-100">
          {users?.map(u => {
            const isCurrent = u.id === currentUser?.id
            return (
              <div key={u.id} className={`flex items-center gap-4 px-5 py-4 ${isCurrent ? 'opacity-50' : ''}`}>
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-medium flex-shrink-0">
                  {getInitials(u.full_name)}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{u.full_name} {isCurrent && <span className="text-xs text-gray-400">(você)</span>}</p>
                  <p className="text-sm text-gray-500">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {editingId === u.id ? (
                    <>
                      <select className="input text-sm w-32" value={editRole} onChange={e => setEditRole(e.target.value as 'chefe' | 'recrutador')}>
                        <option value="recrutador">Recrutador</option>
                        <option value="chefe">Chefe</option>
                      </select>
                      <button onClick={() => updateRole.mutate({ id: u.id, role: editRole })} className="btn-ghost p-1 text-green-600"><Check size={16} /></button>
                      <button onClick={() => setEditingId(null)} className="btn-ghost p-1 text-red-500"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <span className={`badge ${u.role === 'chefe' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{u.role === 'chefe' ? 'Chefe' : 'Recrutador'}</span>
                      {!isCurrent && (
                        <>
                          <button onClick={() => { setEditingId(u.id); setEditRole(u.role) }} className="btn-ghost p-2"><Edit size={14} /></button>
                          <button onClick={() => resetPassword(u.email)} className="btn-ghost p-2"><Key size={14} /></button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
