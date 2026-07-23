import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, ClipboardList, Settings, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { format } from 'date-fns'
import { formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'

type Tab = 'registrar' | 'gestao'
type ActType = { id: string; name: string }
type ActLog = {
  id: string; user_id: string; activity_date: string; activity_name: string
  notes: string | null; done: boolean | null; assigned_by: string | null
  user?: { full_name: string }
}
type Person = { id: string; full_name: string }

export default function ActivitiesPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const uid = user?.id

  const [tab, setTab] = useState<Tab>('registrar')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [targetUser, setTargetUser] = useState('')   // dono do dia (vazio = eu)
  const [pickedName, setPickedName] = useState('')
  const [isOther, setIsOther] = useState(false)
  const [customName, setCustomName] = useState('')
  const [notes, setNotes] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [newType, setNewType] = useState('')
  const [gestaoMonth, setGestaoMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [gestaoPerson, setGestaoPerson] = useState('')

  const ownerId = targetUser || uid || ''

  const { data: people } = useQuery({
    queryKey: ['activity-people'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name').order('full_name')
      if (error) throw error
      return (data || []) as Person[]
    },
  })
  const nameOf = (id: string | null) => people?.find(p => p.id === id)?.full_name || '—'

  // Lista pré-cadastrada é POR USUÁRIO (cada login tem a sua)
  const { data: types } = useQuery({
    queryKey: ['activity-types', uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_types').select('id,name').eq('user_id', uid).order('name')
      if (error) throw error
      return (data || []) as ActType[]
    },
    enabled: !!uid,
  })

  const { data: dayLogs } = useQuery({
    queryKey: ['activity-logs-day', ownerId, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_logs').select('*')
        .eq('user_id', ownerId).eq('activity_date', date).order('created_at')
      if (error) throw error
      return (data || []) as ActLog[]
    },
    enabled: !!ownerId,
  })

  const { data: allLogs } = useQuery({
    queryKey: ['activity-logs-all', gestaoMonth],
    queryFn: async () => {
      const start = gestaoMonth + '-01'
      const [y, m] = gestaoMonth.split('-').map(Number)
      const end = format(new Date(y, m, 0), 'yyyy-MM-dd')
      const { data, error } = await supabase.from('activity_logs')
        .select('*, user:user_profiles!activity_logs_user_id_fkey(full_name)')
        .gte('activity_date', start).lte('activity_date', end)
        .order('activity_date', { ascending: false })
      if (error) throw error
      return (data || []) as ActLog[]
    },
    enabled: tab === 'gestao',
  })

  const addType = useMutation({
    mutationFn: async (name: string) => {
      const n = name.trim()
      if (!n) throw new Error('Escreva o nome')
      // evita duplicar
      if (types?.some(t => t.name.toLowerCase() === n.toLowerCase())) return
      const { error } = await supabase.from('activity_types').insert({ name: n, user_id: uid })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activity-types', uid] }); setNewType('') },
    onError: (e: Error) => toast.error(e.message),
  })

  const delType = useMutation({
    mutationFn: async (typeId: string) => {
      const { error } = await supabase.from('activity_types').delete().eq('id', typeId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types', uid] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const addLog = useMutation({
    mutationFn: async () => {
      const name = (isOther ? customName : pickedName).trim()
      if (!name) throw new Error('Escolha uma atividade')
      if (!ownerId) throw new Error('Sessão inválida')
      const { error } = await supabase.from('activity_logs').insert({
        user_id: ownerId, activity_date: date, activity_name: name,
        notes: notes.trim() || null, done: null, assigned_by: uid,
      })
      if (error) throw error
      // Vira memória: atividade digitada no "Outro" entra na MINHA lista pré-cadastrada
      if (isOther && !types?.some(t => t.name.toLowerCase() === name.toLowerCase())) {
        await supabase.from('activity_types').insert({ name, user_id: uid })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-logs-day', ownerId, date] })
      qc.invalidateQueries({ queryKey: ['activity-types', uid] })
      setPickedName(''); setIsOther(false); setCustomName(''); setNotes('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setDone = useMutation({
    mutationFn: async ({ logId, value }: { logId: string; value: boolean | null }) => {
      const { error } = await supabase.from('activity_logs').update({ done: value }).eq('id', logId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-logs-day', ownerId, date] })
      qc.invalidateQueries({ queryKey: ['activity-logs-all', gestaoMonth] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delLog = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase.from('activity_logs').delete().eq('id', logId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-logs-day', ownerId, date] })
      qc.invalidateQueries({ queryKey: ['activity-logs-all', gestaoMonth] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canAdd = (isOther ? customName.trim().length > 0 : pickedName.length > 0)
  const isOtherPerson = ownerId !== uid
  const gestaoList = (allLogs || []).filter(l => !gestaoPerson || l.user_id === gestaoPerson)

  const DoneToggle = ({ log }: { log: ActLog }) => (
    <div className="flex rounded-lg border border-ink-200 overflow-hidden text-xs shrink-0">
      <button onClick={() => setDone.mutate({ logId: log.id, value: log.done === true ? null : true })}
        className={`px-2.5 py-1.5 font-medium transition-colors ${log.done === true ? 'bg-green-600 text-white' : 'bg-white text-ink-500 hover:bg-green-50'}`}>✓ Feito</button>
      <button onClick={() => setDone.mutate({ logId: log.id, value: log.done === false ? null : false })}
        className={`px-2.5 py-1.5 font-medium transition-colors border-l border-ink-200 ${log.done === false ? 'bg-red-500 text-white' : 'bg-white text-ink-500 hover:bg-red-50'}`}>✕ Não</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow mb-1">Administrativo</p>
        <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900 flex items-center gap-2">
          <ClipboardList size={26} className="text-primary-600" /> Atividades
        </h1>
        <p className="text-sm text-ink-400 mt-1">Checklist do dia. Marque o que foi feito — e monte o dia de outra pessoa do time se precisar.</p>
      </div>

      <div className="flex gap-1.5">
        {([['registrar', 'Checklist do dia'], ['gestao', 'Gestão (todos)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition-all ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'registrar' && (
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Dia de</label>
                <select className="input" value={targetUser} onChange={e => setTargetUser(e.target.value)}>
                  <option value="">Eu</option>
                  {people?.filter(p => p.id !== uid).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Data</label>
                <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
              </div>
            </div>
            {isOtherPerson && (
              <p className="text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-2">Você está montando o dia de <strong>{nameOf(ownerId)}</strong> — as atividades aparecem como tarefa pra ela marcar.</p>
            )}

            <div className="flex items-center justify-between">
              <label className="label mb-0">Adicionar atividade</label>
              <button onClick={() => setManageOpen(v => !v)} className="btn-ghost text-xs flex items-center gap-1">
                <Settings size={14} /> Gerenciar lista
              </button>
            </div>

            {manageOpen && (
              <div className="bg-ink-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-ink-500">Lista pré-cadastrada (o X exclui)</p>
                <div className="flex gap-2">
                  <input className="input flex-1 text-sm" placeholder="Ex: Manual e POP, Contrato, Apresentação..." value={newType}
                    onChange={e => setNewType(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newType.trim()) addType.mutate(newType) }} />
                  <button className="btn-primary text-sm" disabled={!newType.trim() || addType.isPending} onClick={() => addType.mutate(newType)}><Plus size={15} /></button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {types?.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1 bg-white border border-ink-200 rounded-full pl-3 pr-1.5 py-1 text-xs">
                      {t.name}
                      <button onClick={() => delType.mutate(t.id)} className="text-ink-300 hover:text-red-500 p-0.5"><X size={12} /></button>
                    </span>
                  ))}
                  {!types?.length && <span className="text-xs text-ink-400">Nenhuma atividade ainda — adicione acima ou use "+ Outro".</span>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {types?.map(t => (
                <button key={t.id} onClick={() => { setPickedName(t.name); setIsOther(false) }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${!isOther && pickedName === t.name ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-ink-200 text-ink-600 hover:border-primary-300'}`}>
                  {t.name}
                </button>
              ))}
              <button onClick={() => { setIsOther(true); setPickedName('') }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${isOther ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-dashed border-ink-300 text-ink-500 hover:border-primary-300'}`}>
                + Outro
              </button>
            </div>
            {isOther && (
              <input className="input" placeholder="Descreva a atividade (fica salva pra reusar)" value={customName} onChange={e => setCustomName(e.target.value)} />
            )}

            <textarea className="input" rows={2} placeholder="Observação (opcional) — ex: contrato do fulano; objetivo da apresentação..." value={notes} onChange={e => setNotes(e.target.value)} />

            <button className="btn-primary" disabled={!canAdd || addLog.isPending} onClick={() => addLog.mutate()}>
              <Plus size={16} /> {addLog.isPending ? 'Adicionando...' : 'Adicionar ao checklist'}
            </button>
          </div>

          {/* Checklist do dia */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink-900 mb-3">
              {isOtherPerson ? `Checklist de ${nameOf(ownerId)}` : 'Seu checklist'} — {formatDate(date)}
            </h3>
            {dayLogs?.length === 0 && <p className="text-sm text-ink-400">Nada no checklist deste dia ainda.</p>}
            <div className="space-y-2">
              {dayLogs?.map(l => (
                <div key={l.id} className={`flex items-start justify-between gap-3 p-3 rounded-xl border ${l.done === true ? 'border-green-200 bg-green-50/50' : l.done === false ? 'border-red-200 bg-red-50/40' : 'border-ink-100'}`}>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${l.done === true ? 'text-green-800 line-through' : 'text-ink-800'}`}>{l.activity_name}</p>
                    {l.notes && <p className="text-xs text-ink-500 mt-0.5">{l.notes}</p>}
                    {l.assigned_by && l.assigned_by !== l.user_id && (
                      <p className="text-[11px] text-amber-600 mt-0.5">📌 Atribuído por {nameOf(l.assigned_by)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DoneToggle log={l} />
                    <button onClick={() => delLog.mutate(l.id)} className="text-ink-300 hover:text-red-500 p-1"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'gestao' && (
        <div className="card p-5 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <input type="month" className="input w-auto text-sm" value={gestaoMonth} onChange={e => setGestaoMonth(e.target.value)} />
            <select className="input w-auto text-sm" value={gestaoPerson} onChange={e => setGestaoPerson(e.target.value)}>
              <option value="">Todas as pessoas</option>
              {people?.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          {gestaoList.length === 0 && <p className="text-sm text-ink-400">Nenhuma atividade registrada neste mês.</p>}
          <div className="space-y-2">
            {gestaoList.map(l => (
              <div key={l.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-ink-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ink-800">{l.activity_name}</span>
                    <span className="badge bg-blue-50 text-blue-600 text-[10px]">{l.user?.full_name || '—'}</span>
                    <span className="text-xs text-ink-400">{formatDate(l.activity_date)}</span>
                    {l.done === true && <span className="badge bg-green-100 text-green-700 text-[10px]"><Check size={10} /> Feito</span>}
                    {l.done === false && <span className="badge bg-red-100 text-red-600 text-[10px]">Não feito</span>}
                    {l.done == null && <span className="badge bg-ink-100 text-ink-500 text-[10px]">Pendente</span>}
                  </div>
                  {l.notes && <p className="text-xs text-ink-500 mt-0.5">{l.notes}</p>}
                  {l.assigned_by && l.assigned_by !== l.user_id && (
                    <p className="text-[11px] text-amber-600 mt-0.5">📌 Atribuído por {nameOf(l.assigned_by)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
