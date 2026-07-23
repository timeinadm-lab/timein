import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, ClipboardList, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { format } from 'date-fns'
import { formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'

type Tab = 'registrar' | 'gestao'
type ActType = { id: string; name: string }
type ActLog = { id: string; user_id: string; activity_date: string; activity_name: string; notes: string | null; user?: { full_name: string } }

export default function ActivitiesPage() {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const uid = user?.id

  const [tab, setTab] = useState<Tab>('registrar')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [pickedName, setPickedName] = useState('')   // atividade escolhida (nome)
  const [isOther, setIsOther] = useState(false)
  const [customName, setCustomName] = useState('')
  const [notes, setNotes] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [newType, setNewType] = useState('')
  const [gestaoMonth, setGestaoMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [gestaoPerson, setGestaoPerson] = useState('')

  const { data: types } = useQuery({
    queryKey: ['activity-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_types').select('id,name').order('name')
      if (error) throw error
      return (data || []) as ActType[]
    },
  })

  const { data: myLogs } = useQuery({
    queryKey: ['activity-logs-mine', uid, date],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_logs').select('*').eq('user_id', uid).eq('activity_date', date).order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as ActLog[]
    },
    enabled: !!uid,
  })

  const { data: allLogs } = useQuery({
    queryKey: ['activity-logs-all', gestaoMonth],
    queryFn: async () => {
      const start = gestaoMonth + '-01'
      const [y, m] = gestaoMonth.split('-').map(Number)
      const end = format(new Date(y, m, 0), 'yyyy-MM-dd')
      const { data, error } = await supabase.from('activity_logs')
        .select('*, user:user_profiles(full_name)')
        .gte('activity_date', start).lte('activity_date', end)
        .order('activity_date', { ascending: false })
      if (error) throw error
      return (data || []) as ActLog[]
    },
    enabled: tab === 'gestao',
  })

  const addType = useMutation({
    mutationFn: async () => {
      if (!newType.trim()) throw new Error('Escreva o nome da atividade')
      const { error } = await supabase.from('activity_types').insert({ name: newType.trim() })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activity-types'] }); setNewType('') },
    onError: (e: Error) => toast.error(e.message),
  })

  const delType = useMutation({
    mutationFn: async (typeId: string) => {
      const { error } = await supabase.from('activity_types').delete().eq('id', typeId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const addLog = useMutation({
    mutationFn: async () => {
      const name = isOther ? customName.trim() : pickedName
      if (!name) throw new Error('Escolha uma atividade')
      if (!uid) throw new Error('Sessão inválida')
      const { error } = await supabase.from('activity_logs').insert({
        user_id: uid, activity_date: date, activity_name: name, notes: notes.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Atividade registrada!')
      qc.invalidateQueries({ queryKey: ['activity-logs-mine', uid, date] })
      setPickedName(''); setIsOther(false); setCustomName(''); setNotes('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delLog = useMutation({
    mutationFn: async (logId: string) => {
      const { error } = await supabase.from('activity_logs').delete().eq('id', logId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Removido.')
      qc.invalidateQueries({ queryKey: ['activity-logs-mine', uid, date] })
      qc.invalidateQueries({ queryKey: ['activity-logs-all', gestaoMonth] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canAdd = (isOther ? customName.trim().length > 0 : pickedName.length > 0)
  const people = [...new Map((allLogs || []).map(l => [l.user_id, l.user?.full_name || '—'])).entries()]
  const gestaoList = (allLogs || []).filter(l => !gestaoPerson || l.user_id === gestaoPerson)

  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow mb-1">Administrativo</p>
        <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900 flex items-center gap-2">
          <ClipboardList size={26} className="text-primary-600" /> Atividades
        </h1>
        <p className="text-sm text-ink-400 mt-1">Registre o que você fez no dia. A lista de atividades é criada por vocês.</p>
      </div>

      {/* Abas */}
      <div className="flex gap-1.5">
        {([['registrar', 'Registrar meu dia'], ['gestao', 'Gestão (todos)']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition-all ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'registrar' && (
        <div className="space-y-4">
          {/* Registrar */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <label className="label">Dia</label>
                <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <button onClick={() => setManageOpen(v => !v)} className="btn-ghost text-xs flex items-center gap-1 self-end">
                <Settings size={14} /> Gerenciar atividades
              </button>
            </div>

            {/* Gerenciar tipos */}
            {manageOpen && (
              <div className="bg-ink-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-ink-500">Lista de atividades (some quando você exclui)</p>
                <div className="flex gap-2">
                  <input className="input flex-1 text-sm" placeholder="Ex: Manual e POP, Contrato, Apresentação..." value={newType}
                    onChange={e => setNewType(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newType.trim()) addType.mutate() }} />
                  <button className="btn-primary text-sm" disabled={!newType.trim() || addType.isPending} onClick={() => addType.mutate()}><Plus size={15} /></button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {types?.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1 bg-white border border-ink-200 rounded-full pl-3 pr-1.5 py-1 text-xs">
                      {t.name}
                      <button onClick={() => delType.mutate(t.id)} className="text-ink-300 hover:text-red-500 p-0.5"><X size={12} /></button>
                    </span>
                  ))}
                  {!types?.length && <span className="text-xs text-ink-400">Nenhuma atividade cadastrada ainda — adicione acima.</span>}
                </div>
              </div>
            )}

            {/* Escolher atividade */}
            <div>
              <label className="label">Atividade</label>
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
                <input className="input mt-2" placeholder="Descreva a atividade" value={customName} onChange={e => setCustomName(e.target.value)} />
              )}
            </div>

            <div>
              <label className="label">Observação <span className="text-gray-400 font-normal">(opcional)</span></label>
              <textarea className="input" rows={2} placeholder="Ex: contrato do fulano e beltrano; objetivo da apresentação..." value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            <button className="btn-primary" disabled={!canAdd || addLog.isPending} onClick={() => addLog.mutate()}>
              <Plus size={16} /> {addLog.isPending ? 'Salvando...' : 'Adicionar atividade'}
            </button>
          </div>

          {/* Minhas atividades do dia */}
          <div className="card p-5">
            <h3 className="font-semibold text-ink-900 mb-3">Suas atividades em {formatDate(date)}</h3>
            {myLogs?.length === 0 && <p className="text-sm text-ink-400">Nada registrado neste dia ainda.</p>}
            <div className="space-y-2">
              {myLogs?.map(l => (
                <div key={l.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-ink-100 hover:bg-ink-50">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-800">{l.activity_name}</p>
                    {l.notes && <p className="text-xs text-ink-500 mt-0.5">{l.notes}</p>}
                  </div>
                  <button onClick={() => delLog.mutate(l.id)} className="text-ink-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={15} /></button>
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
              {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
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
                  </div>
                  {l.notes && <p className="text-xs text-ink-500 mt-0.5">{l.notes}</p>}
                </div>
                {(profile?.role === 'chefe' || l.user_id === uid) && (
                  <button onClick={() => delLog.mutate(l.id)} className="text-ink-300 hover:text-red-500 p-1 shrink-0"><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
