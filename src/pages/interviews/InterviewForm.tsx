import { useState, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'

export default function InterviewForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const isEdit = !!id

  const [form, setForm] = useState({
    title: '', category: 'Reunião', client_id: '', candidate_id: '', vacancy_id: '', employee_id: '',
    scheduled_at: '', end_date: '', duration_min: '30', modality: 'Online',
    link_or_address: '', notes: '', status: 'Agendada',
  })
  const [noDate, setNoDate] = useState(false)
  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().slice(0, 7)) // YYYY-MM
  const [participantIds, setParticipantIds] = useState<string[]>(profile?.id ? [profile.id] : [])
  const toggleParticipant = (pid: string) =>
    setParticipantIds(p => p.includes(pid) ? p.filter(x => x !== pid) : [...p, pid])

  const { data: employees } = useQuery({
    queryKey: ['employees-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,full_name').eq('status', 'Ativo').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: clients } = useQuery({
    queryKey: ['clients-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: candidates } = useQuery({
    queryKey: ['candidates-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('id,full_name').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: vacancies } = useQuery({
    queryKey: ['vacancies-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies').select('id,title').eq('status', 'Aberta')
      if (error) throw error
      return data || []
    },
  })

  const { data: recruiters } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name,role').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  useQuery({
    queryKey: ['interview', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews').select('*').eq('id', id).single()
      if (error) throw error
      setForm({
        title: data.title || '',
        category: data.category || 'Reunião',
        client_id: data.client_id || '',
        candidate_id: data.candidate_id || '',
        vacancy_id: data.vacancy_id || '',
        employee_id: data.employee_id || '',
        scheduled_at: data.scheduled_at ? data.scheduled_at.slice(0, 16) : '',
        end_date: data.end_date || '',
        duration_min: String(data.duration_min || 30),
        modality: data.modality || 'Online',
        link_or_address: data.link_or_address || '',
        notes: data.notes || '',
        status: data.status || 'Agendada',
      })
      const existingParticipants = (data as { participant_ids?: string[] }).participant_ids
      setParticipantIds(existingParticipants?.length ? existingParticipants : (data.recruiter_id ? [data.recruiter_id] : []))
      setNoDate(!data.scheduled_at)
      if (data.target_month) setTargetMonth(String(data.target_month).slice(0, 7))
      return data
    },
    enabled: isEdit,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      // Colunas que dependem de migração. Se o banco ainda não tiver alguma delas,
      // o Postgrest devolve "Could not find the 'X' column" — nesse caso a gente
      // remove só a coluna que faltou e tenta de novo, em vez de travar o usuário.
      const OPTIONAL_COLS = ['category', 'client_id', 'target_month', 'participant_ids']
      const run = async (body: Record<string, unknown>) =>
        isEdit
          ? supabase.from('interviews').update(body).eq('id', id)
          : supabase.from('interviews').insert(body)

      let body = { ...payload }
      let dropped: string[] = []
      for (let attempt = 0; attempt <= OPTIONAL_COLS.length; attempt++) {
        const { error } = await run(body)
        if (!error) break
        const missing = OPTIONAL_COLS.find(c =>
          error.message.includes(`'${c}' column`) || error.message.includes(`column "${c}"`))
        if (!missing || !(missing in body)) throw error
        delete body[missing]
        dropped.push(missing)
      }

      if (!isEdit && payload.candidate_id) {
        await supabase.from('candidates').update({
          pipeline_stage: 'Entrevista Agendada',
          interview_scheduled_at: payload.scheduled_at,
        }).eq('id', payload.candidate_id)
      }
      return { dropped }
    },
    onSuccess: (res) => {
      toast.success(isEdit ? 'Compromisso atualizado!' : 'Compromisso agendado!')
      if (res?.dropped.length) {
        toast('Salvo, mas o banco ainda não tem: ' + res.dropped.join(', ') + '. Rode a migração pendente no Supabase.',
          { icon: '⚠️', duration: 8000 })
      }
      qc.invalidateQueries({ queryKey: ['interviews'] })
      navigate('/agenda')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!noDate && !form.scheduled_at) { toast.error('Escolha a data, ou marque "sem data (a agendar)"'); return }
    if (form.category === 'Visita' && !form.client_id) { toast.error('Escolha o cliente da visita'); return }
    mutation.mutate({
      title: form.title || null,
      category: form.category || null,
      client_id: form.client_id || null,
      candidate_id: form.candidate_id || null,
      vacancy_id: form.vacancy_id || null,
      employee_id: form.employee_id || null,
      recruiter_id: participantIds[0] || null,
      participant_ids: participantIds,
      scheduled_at: noDate ? null : form.scheduled_at,
      target_month: noDate ? `${targetMonth}-01` : null,
      end_date: form.end_date || null,
      duration_min: Number(form.duration_min),
      modality: form.modality,
      link_or_address: form.link_or_address || null,
      notes: form.notes || null,
      status: form.status,
    })
  }

  const hasLinks = !!(form.employee_id || form.candidate_id || form.vacancy_id)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Compromisso' : 'Novo Compromisso'}</h1>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full">
            <label className="label">Tipo</label>
            <div className="flex flex-wrap gap-1.5">
              {['Reunião', 'Visita', 'Treinamento', 'Ligação', 'Entrevista', 'Outro'].map(c => (
                <button key={c} type="button"
                  onClick={() => setForm(p => ({ ...p, category: c, modality: c === 'Visita' ? 'Presencial' : c === 'Ligação' ? 'Telefone' : p.modality }))}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-colors ${form.category === c ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-ink-200 text-ink-500 hover:border-ink-300'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-full">
            <label className="label">Título *</label>
            <input className="input" required placeholder="Ex: Visita SLA, Reunião com fornecedor, Entrevista com a Maria…" value={form.title} onChange={e => set('title', e.target.value)} />
          </div>
          {form.category === 'Visita' && (
            <div className="col-span-full">
              <label className="label">Cliente da visita *</label>
              <select className="input" value={form.client_id} onChange={e => set('client_id', e.target.value)}>
                <option value="">Selecionar cliente...</option>
                {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Data e Hora {noDate ? <span className="text-gray-400 font-normal">(a agendar)</span> : '*'}</label>
            <input className="input" type="datetime-local" required={!noDate} disabled={noDate} value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
            <label className="flex items-center gap-2 mt-1.5 text-xs text-ink-600 cursor-pointer select-none">
              <input type="checkbox" checked={noDate} onChange={e => { setNoDate(e.target.checked); if (e.target.checked) set('scheduled_at', '') }} className="rounded" />
              Sem data definida <span className="text-ink-400">(a pessoa só precisa saber que tem que fazer)</span>
            </label>
            {noDate && (
              <div className="mt-2">
                <label className="label">De qual mês? <span className="text-gray-400 font-normal">(prazo pra agendar)</span></label>
                <input type="month" className="input" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} />
              </div>
            )}
          </div>
          {form.category !== 'Visita' && (
            <div>
              <label className="label">Até <span className="text-gray-400 font-normal">(opcional — férias, período)</span></label>
              <input className="input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          )}
          {form.category !== 'Visita' && (
            <>
              <div>
                <label className="label">Duração</label>
                <select className="input" value={form.duration_min} onChange={e => set('duration_min', e.target.value)}>
                  <option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option>
                </select>
              </div>
              <div>
                <label className="label">Modalidade</label>
                <select className="input" value={form.modality} onChange={e => set('modality', e.target.value)}>
                  <option>Online</option><option>Presencial</option><option>Telefone</option>
                </select>
              </div>
            </>
          )}
          <div className="col-span-full">
            <label className="label">Participantes <span className="text-gray-400 font-normal">(quem vai — pode marcar mais de uma pessoa, todas veem na própria agenda)</span></label>
            <div className="flex flex-wrap gap-1.5">
              {recruiters?.map(r => {
                const active = participantIds.includes(r.id)
                return (
                  <button key={r.id} type="button" onClick={() => toggleParticipant(r.id)}
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-colors ${active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-ink-200 text-ink-500 hover:border-ink-300'}`}>
                    {r.full_name}
                  </button>
                )
              })}
            </div>
            {participantIds.length === 0 && <p className="text-xs text-ink-400 mt-1">Ninguém marcado — o compromisso não aparece na agenda de ninguém.</p>}
          </div>
          <div className="col-span-full"><label className="label">{form.category === 'Visita' ? 'Endereço da visita' : 'Link de reunião / Endereço'}</label><input className="input" placeholder={form.category === 'Visita' ? 'Endereço do cliente' : ''} value={form.link_or_address} onChange={e => set('link_or_address', e.target.value)} /></div>
          <div className="col-span-full"><label className="label">Notas</label><textarea className="input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
          {isEdit && (
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                <option>Agendada</option><option>Realizada</option><option>Cancelada</option><option>Falta</option>
              </select>
            </div>
          )}
        </div>

        {/* Vínculos opcionais — recolhidos para manter o formulário simples */}
        <details className="border-t border-ink-100 pt-3" open={hasLinks}>
          <summary className="text-sm text-primary-600 font-medium cursor-pointer hover:underline select-none">
            Vincular a colaborador, candidato ou vaga (opcional)
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
            <div>
              <label className="label">Colaborador <span className="text-gray-400 font-normal">(férias, licença)</span></label>
              <select className="input" value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
                <option value="">Nenhum</option>
                {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Candidato</label>
              <select className="input" value={form.candidate_id} onChange={e => set('candidate_id', e.target.value)}>
                <option value="">Nenhum</option>
                {candidates?.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Vaga</label>
              <select className="input" value={form.vacancy_id} onChange={e => set('vacancy_id', e.target.value)}>
                <option value="">Nenhuma</option>
                {vacancies?.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            </div>
          </div>
        </details>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
