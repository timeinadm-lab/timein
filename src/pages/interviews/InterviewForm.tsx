import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { isMeetingLink } from '../../lib/utils'
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
  const [dataLoaded, setDataLoaded] = useState(!id)
  const [targetMonth, setTargetMonth] = useState(new Date().toISOString().slice(0, 7)) // YYYY-MM
  const [participantIds, setParticipantIds] = useState<string[]>(profile?.id ? [profile.id] : [])
  // Colaboradores vinculados (migração 066): antes só dava um
  const [employeeIds, setEmployeeIds] = useState<string[]>([])
  const toggleParticipant = (pid: string) =>
    setParticipantIds(p => p.includes(pid) ? p.filter(x => x !== pid) : [...p, pid])

  // Repetir (só ao criar): toda semana nos dias escolhidos até uma data, ou
  // datas avulsas. Cada data vira uma reunião, ligadas pela mesma série.
  const [repetir, setRepetir] = useState<'nao' | 'semanal' | 'datas'>('nao')
  const [diasSemana, setDiasSemana] = useState<number[]>([])
  const [repetirAte, setRepetirAte] = useState('')
  const [datasExtras, setDatasExtras] = useState<string[]>([])
  const [novaData, setNovaData] = useState('')

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

  // Preenchimento fora do queryFn: no cache-hit (staleTime de 30s) o queryFn
  // não roda, o formulário abriria em branco e salvar apagaria o compromisso.
  const { data: interviewData } = useQuery({
    queryKey: ['interview', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  const populated = useRef(false)
  useEffect(() => {
    if (!interviewData || populated.current) return
    populated.current = true
    const data = interviewData
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
    const idsSalvos = (data as { employee_ids?: string[] }).employee_ids
    setEmployeeIds(idsSalvos?.length ? idsSalvos : (data.employee_id ? [data.employee_id] : []))
    setNoDate(!data.scheduled_at)
    if (data.target_month) setTargetMonth(String(data.target_month).slice(0, 7))
    setDataLoaded(true)
  }, [interviewData])

  // Datas que a reunião vai ter (formato do campo: yyyy-MM-ddTHH:mm)
  const datasDaSerie = (() => {
    if (noDate || !form.scheduled_at) return [] as string[]
    const base = form.scheduled_at.slice(0, 10)
    const hora = form.scheduled_at.slice(11, 16)
    if (isEdit || repetir === 'nao') return [form.scheduled_at]
    if (repetir === 'datas') {
      return Array.from(new Set([base, ...datasExtras])).sort().map(d => `${d}T${hora}`)
    }
    if (!repetirAte || repetirAte < base) return [form.scheduled_at]
    const dias = diasSemana.length ? diasSemana : [new Date(base + 'T12:00:00').getDay()]
    const out: string[] = []
    for (let d = new Date(base + 'T12:00:00'); out.length <= 200; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (ds > repetirAte) break
      if (dias.includes(d.getDay())) out.push(`${ds}T${hora}`)
    }
    return out
  })()

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      // Várias datas = uma reunião por data, todas na mesma série
      const lote = !isEdit && datasDaSerie.length > 1
        ? (() => {
            const serie = crypto.randomUUID()
            return datasDaSerie.map(dt => ({ ...payload, scheduled_at: dt, end_date: null, serie_id: serie }))
          })()
        : null
      const gravar = (p: Record<string, unknown> | Record<string, unknown>[]) => isEdit
        ? supabase.from('interviews').update(p as Record<string, unknown>).eq('id', id)
        : supabase.from('interviews').insert(p)
      let { error } = await gravar(lote || payload)
      // Sem a migração 066 não existe a lista nem a série: grava sem elas
      if (error && /employee_ids|serie_id/i.test(error.message)) {
        const tira = (p: Record<string, unknown>) => { const { employee_ids: _e, serie_id: _s, ...resto } = p; return resto }
        if (((payload.employee_ids as string[] | undefined)?.length || 0) > 1) toast('Só o primeiro colaborador foi salvo — falta rodar a migração 066.', { duration: 7000 })
        ;({ error } = await gravar(lote ? lote.map(tira) : tira(payload)))
      }
      if (error) throw error

      if (!isEdit && payload.candidate_id) {
        await supabase.from('candidates').update({
          pipeline_stage: 'Entrevista Agendada',
          interview_scheduled_at: payload.scheduled_at,
        }).eq('id', payload.candidate_id)
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Compromisso atualizado!' : datasDaSerie.length > 1 ? `${datasDaSerie.length} reuniões agendadas!` : 'Compromisso agendado!')
      qc.invalidateQueries({ queryKey: ['interviews'] })
      navigate('/agenda')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  // Compromisso é o tipo simples: o que é + quem. Sem duração, modalidade ou link.
  const ehCompromisso = form.category === 'Compromisso'

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (isEdit && !dataLoaded) {
      toast.error('Os dados ainda não carregaram. Recarregue a página antes de salvar.')
      return
    }
    if (!noDate && !form.scheduled_at) { toast.error('Escolha a data, ou marque "sem data (a agendar)"'); return }
    if (form.category === 'Visita' && !form.client_id) { toast.error('Escolha o cliente da visita'); return }
    if (ehCompromisso && !form.title.trim()) { toast.error('Escreva o que é o compromisso'); return }
    if (ehCompromisso && !form.employee_id && !participantIds.length) { toast.error('Escolha de quem é o compromisso'); return }
    if (form.end_date && form.scheduled_at && form.end_date < form.scheduled_at.slice(0, 10)) { toast.error('A data "Até" é antes do início'); return }
    if (!isEdit && repetir === 'semanal' && (!repetirAte || repetirAte <= form.scheduled_at.slice(0, 10))) { toast.error('Escolha até quando a reunião se repete'); return }
    if (datasDaSerie.length > 150) { toast.error('Mais de 150 datas — encurte o período'); return }
    // Compromisso: o colaborador vem do "Quem?"; nos outros tipos, da lista
    const colaboradores = ehCompromisso ? (form.employee_id ? [form.employee_id] : []) : employeeIds
    mutation.mutate({
      title: form.title || null,
      category: form.category || null,
      client_id: form.client_id || null,
      candidate_id: form.candidate_id || null,
      vacancy_id: form.vacancy_id || null,
      employee_id: colaboradores[0] || null,
      employee_ids: colaboradores,
      recruiter_id: participantIds[0] || null,
      participant_ids: participantIds,
      scheduled_at: noDate ? null : form.scheduled_at,
      target_month: noDate ? `${targetMonth}-01` : null,
      end_date: form.end_date || null,
      duration_min: ehCompromisso ? 60 : Number(form.duration_min),
      modality: ehCompromisso ? 'Presencial' : form.modality,
      link_or_address: ehCompromisso ? null : (form.link_or_address || null),
      notes: form.notes || null,
      status: form.status,
    })
  }

  const hasLinks = !!(employeeIds.length || form.candidate_id || form.vacancy_id)

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="page-title-sm">{isEdit ? 'Editar Compromisso' : 'Novo Compromisso'}</h1>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full">
            <label className="label">Tipo</label>
            <div className="flex flex-wrap gap-1.5">
              {['Reunião', 'Compromisso', 'Visita', 'Treinamento', 'Ligação', 'Entrevista', 'Outro'].map(c => (
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
          {/* Repetir: várias datas (ex.: toda terça de junho e julho) */}
          {!isEdit && !noDate && form.scheduled_at && (
            <div className="col-span-full rounded-xl border border-ink-200 p-3 space-y-3">
              <div>
                <label className="label">Repetir</label>
                <div className="flex flex-wrap gap-1.5">
                  {([['nao', 'Só este dia'], ['semanal', 'Toda semana'], ['datas', 'Escolher datas']] as const).map(([v, t]) => (
                    <button key={v} type="button" onClick={() => setRepetir(v)}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${repetir === v ? 'border-primary-600 bg-primary-50 text-primary-800 font-medium' : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>{t}</button>
                  ))}
                </div>
              </div>
              {repetir === 'semanal' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Nos dias</label>
                    <div className="flex gap-1">
                      {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((l, dia) => {
                        const padrao = new Date(form.scheduled_at.slice(0, 10) + 'T12:00:00').getDay()
                        const on = diasSemana.length ? diasSemana.includes(dia) : dia === padrao
                        return (
                          <button key={dia} type="button" title={['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][dia]}
                            onClick={() => setDiasSemana(p => { const base = p.length ? p : [padrao]; return base.includes(dia) ? base.filter(x => x !== dia) : [...base, dia] })}
                            className={`w-8 h-8 rounded-full text-xs font-semibold border ${on ? 'bg-primary-600 text-white border-primary-600' : 'border-ink-200 text-ink-500'}`}>{l}</button>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="label">Até *</label>
                    <input className="input" type="date" value={repetirAte} min={form.scheduled_at.slice(0, 10)} onChange={e => setRepetirAte(e.target.value)} />
                  </div>
                </div>
              )}
              {repetir === 'datas' && (
                <div>
                  <label className="label">Outras datas <span className="text-gray-400 font-normal">(mesmo horário)</span></label>
                  <div className="flex gap-2">
                    <input className="input flex-1" type="date" value={novaData} onChange={e => setNovaData(e.target.value)} />
                    <button type="button" className="btn-secondary" disabled={!novaData}
                      onClick={() => { if (novaData) { setDatasExtras(p => p.includes(novaData) ? p : [...p, novaData].sort()); setNovaData('') } }}>Adicionar</button>
                  </div>
                </div>
              )}
              {datasDaSerie.length > 1 && (
                <div>
                  <p className="text-xs font-medium text-ink-700 mb-1.5">Vai criar {datasDaSerie.length} reuniões:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {datasDaSerie.map(dt => {
                      const d = new Date(dt.slice(0, 10) + 'T12:00:00')
                      const extra = repetir === 'datas' && dt.slice(0, 10) !== form.scheduled_at.slice(0, 10)
                      return (
                        <span key={dt} className="inline-flex items-center gap-1 text-xs bg-ink-50 border border-ink-200 rounded-full px-2.5 py-1 tnum">
                          {d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')}
                          {extra && <button type="button" aria-label="Tirar data" onClick={() => setDatasExtras(p => p.filter(x => x !== dt.slice(0, 10)))}><X size={11} /></button>}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {form.category !== 'Visita' && (isEdit || repetir === 'nao') && (
            <div>
              <label className="label">Até <span className="text-gray-400 font-normal">(opcional — férias, período)</span></label>
              <input className="input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          )}
          {/* Compromisso não tem duração nem modalidade: é só "o que é" e "quem".
              Reunião tem pauta e horário; compromisso é onde a pessoa vai estar. */}
          {form.category !== 'Visita' && !ehCompromisso && (
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
          {ehCompromisso ? (
            <div className="col-span-full">
              <label className="label">Quem? *</label>
              <select className="input"
                value={form.employee_id ? `emp:${form.employee_id}` : participantIds[0] ? `rh:${participantIds[0]}` : ''}
                onChange={e => {
                  const [tipo, pid] = e.target.value.split(':')
                  if (tipo === 'emp') { set('employee_id', pid); setParticipantIds([]) }
                  else if (tipo === 'rh') { set('employee_id', ''); setParticipantIds([pid]) }
                  else { set('employee_id', ''); setParticipantIds([]) }
                }}>
                <option value="">Selecionar...</option>
                <optgroup label="Equipe RH">
                  {recruiters?.map(r => <option key={r.id} value={`rh:${r.id}`}>{r.full_name}</option>)}
                </optgroup>
                <optgroup label="Colaboradores">
                  {employees?.map(emp => <option key={emp.id} value={`emp:${emp.id}`}>{emp.full_name}</option>)}
                </optgroup>
              </select>
              <p className="text-xs text-ink-400 mt-1">Serve só pra equipe saber onde a pessoa vai estar. Não entra em pagamento.</p>
            </div>
          ) : (
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
          )}
          {!ehCompromisso && (
          <div className="col-span-full">
            <label className="label">{form.category === 'Visita' ? 'Endereço da visita' : 'Link de reunião / Endereço'}</label>
            <input className="input" placeholder={form.category === 'Visita' ? 'Rua, número, cidade' : 'Cole o link do Teams/Meet/Zoom, ou o endereço'}
              value={form.link_or_address} onChange={e => set('link_or_address', e.target.value)} />
            <p className="text-xs text-ink-400 mt-1">
              {isMeetingLink(form.link_or_address)
                ? '✅ Vai aparecer como botão "Entrar na reunião" na agenda e no painel.'
                : form.link_or_address
                  ? '📍 Vai aparecer como endereço, e abre no Google Maps ao clicar.'
                  : 'Link vira botão de entrar; endereço vira atalho pro mapa.'}
            </p>
          </div>
          )}
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
            {/* No compromisso o colaborador já é escolhido em "Quem?" acima */}
            {!ehCompromisso && (
              <div className="sm:col-span-3">
                <label className="label">Colaboradores <span className="text-gray-400 font-normal">(pode vincular mais de um)</span></label>
                {employeeIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {employeeIds.map(eid => (
                      <span key={eid} className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-800 border border-primary-200 rounded-full pl-2.5 pr-1 py-1">
                        {employees?.find(e => e.id === eid)?.full_name || 'Colaborador'}
                        <button type="button" className="p-0.5 rounded-full hover:bg-primary-100" aria-label="Tirar"
                          onClick={() => setEmployeeIds(p => p.filter(x => x !== eid))}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <select className="input" value="" onChange={e => { const v = e.target.value; if (v) setEmployeeIds(p => p.includes(v) ? p : [...p, v]) }}>
                  <option value="">{employeeIds.length ? 'Adicionar outro colaborador…' : 'Adicionar colaborador…'}</option>
                  {employees?.filter(emp => !employeeIds.includes(emp.id)).map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              </div>
            )}
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
