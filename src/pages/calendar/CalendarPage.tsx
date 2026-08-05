import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X, FileText, Clock, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatLocalTime } from '../../lib/utils'
import toast from 'react-hot-toast'

import { format, startOfMonth, endOfMonth, getDaysInMonth, getDay, addMonths, subMonths } from 'date-fns'
import { SignedLink } from '../../components/ui/SignedFile'

type EventKind = 'realizada' | 'planejada' | 'ausencia' | 'compromisso'
type Ev = {
  kind: EventKind
  date: string
  employee: string
  client?: string
  unit?: string
  time?: string | null
  hours?: number | null
  note?: string | null
  reportUrl?: string | null
  employeeId?: string
}

const KIND_META: Record<EventKind, { label: string; dot: string; chip: string }> = {
  realizada:    { label: 'Visita realizada', dot: 'bg-primary-600',  chip: 'bg-primary-50 text-primary-700 border-primary-200' },
  planejada:    { label: 'Visita planejada', dot: 'bg-amber-400',    chip: 'bg-amber-50 text-amber-800 border-amber-200' },
  ausencia:     { label: 'Ausência avisada', dot: 'bg-red-400',      chip: 'bg-red-50 text-red-700 border-red-200' },
  compromisso:  { label: 'Compromisso',      dot: 'bg-blue-400',     chip: 'bg-blue-50 text-blue-700 border-blue-200' },
}

const EMPTY_ADD = {
  vacancy_id: '', employee_id: '', client_id: '', unit_id: '',
  time: '', hours: '', notes: '', title: '', reason: '', assignee: '',
  manualKind: 'planejada' as 'planejada' | 'ausencia' | 'compromisso',
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [cursor, setCursor] = useState(new Date())
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [fEmployee, setFEmployee] = useState('')
  const [fClient, setFClient] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addTab, setAddTab] = useState<'vincular' | 'manual'>('vincular')
  const [addForm, setAddForm] = useState(EMPTY_ADD)

  const monthKey = format(cursor, 'yyyy-MM')
  const mStart = format(startOfMonth(cursor), 'yyyy-MM-dd')
  const mEnd = format(endOfMonth(cursor), 'yyyy-MM-dd')

  // Visitas realizadas
  const { data: visits } = useQuery({
    queryKey: ['cal-visits', monthKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('nutritionist_visits')
        .select('id, visit_date, check_in, check_out, break_start, break_end, unit_name, observations, report_url, is_unavailable, is_holiday, employee_id, employee:employees(full_name), client:clients(name)')
        .gte('visit_date', mStart).lte('visit_date', mEnd)
      if (error) throw error
      return data || []
    },
  })

  // Visitas planejadas (agenda)
  const { data: agenda } = useQuery({
    queryKey: ['cal-agenda', monthKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('nutritionist_agenda')
        .select('id, planned_date, planned_time, notes, hours_expected, employee_id, employee:employees(full_name), client:clients(name), unit:client_units(name)')
        .gte('planned_date', mStart).lte('planned_date', mEnd)
      if (error) throw error
      return data || []
    },
  })

  // Ausências avisadas pelo portal (médico, pessoal...)
  const { data: notices } = useQuery({
    queryKey: ['cal-notices', monthKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('schedule_notices')
        .select('id, notice_date, type, reason, employee_id, employee:employees(full_name), client:clients(name)')
        .gte('notice_date', mStart).lte('notice_date', mEnd)
      if (error) { console.warn('schedule_notices:', error.message); return [] }
      return data || []
    },
  })

  // Compromissos da Agenda do RH (reuniões, férias...)
  const { data: appointments } = useQuery({
    queryKey: ['cal-appointments', monthKey],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews')
        .select('id, title, scheduled_at, modality, status, employee:employees(full_name), candidate:candidates(full_name), vacancy:vacancies(title), recruiter:user_profiles(full_name)')
        .gte('scheduled_at', mStart).lte('scheduled_at', mEnd + 'T23:59:59')
      if (error) { console.warn('interviews:', error.message); return [] }
      return data || []
    },
  })

  // ── Dados de apoio pra adicionar no dia ──
  const { data: vagas } = useQuery({
    queryKey: ['cal-vagas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies')
        .select('id, title, client_id, weekly_hours, status, client:clients(name)')
        .neq('status', 'Fechada').order('title')
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  // Vínculos por vaga — pra saber quais nutricionistas estão naquela vaga
  const { data: vagaLinks } = useQuery({
    queryKey: ['cal-vaga-links'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_client_links')
        .select('id, employee_id, vacancy_id, client_id, weekly_hours_quota, employee:employees(id, full_name)')
        .not('vacancy_id', 'is', null)
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  const { data: allClients } = useQuery({
    queryKey: ['cal-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name')
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  const { data: allEmployees } = useQuery({
    queryKey: ['cal-employees'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, full_name').neq('status', 'Inativo').order('full_name')
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  // Equipe do RH (usuários do sistema) — pra atribuir compromisso a alguém do RH
  const { data: rhUsers } = useQuery({
    queryKey: ['cal-rh-users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return data || []
    },
    enabled: addOpen,
  })

  // Unidades do cliente escolhido
  const chosenVaga = (vagas || []).find(v => v.id === addForm.vacancy_id)
  const targetClientId = addTab === 'vincular' ? (chosenVaga?.client_id || '') : addForm.client_id
  const { data: unitOpts } = useQuery({
    queryKey: ['cal-units', targetClientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_units').select('id, name').eq('client_id', targetClientId).order('name')
      if (error) throw error
      return data || []
    },
    enabled: addOpen && !!targetClientId,
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['cal-visits', monthKey] })
    qc.invalidateQueries({ queryKey: ['cal-agenda', monthKey] })
    qc.invalidateQueries({ queryKey: ['cal-notices', monthKey] })
    qc.invalidateQueries({ queryKey: ['cal-appointments', monthKey] })
  }

  const closeAdd = () => { setAddOpen(false); setAddForm(EMPTY_ADD) }

  // Vincular: agenda uma visita a partir da vaga (cliente e horas já vêm dela)
  const addFromVaga = useMutation({
    mutationFn: async () => {
      if (!dayOpen) throw new Error('Dia inválido')
      if (!addForm.vacancy_id) throw new Error('Escolha a vaga')
      if (!addForm.employee_id) throw new Error('Escolha o nutricionista')
      const clientId = chosenVaga?.client_id
      if (!clientId) throw new Error('Esta vaga não tem cliente definido')
      const link = (vagaLinks || []).find(l => l.vacancy_id === addForm.vacancy_id && l.employee_id === addForm.employee_id)
      const hours = addForm.hours ? Number(addForm.hours)
        : (link?.weekly_hours_quota ? Number(link.weekly_hours_quota) : (chosenVaga?.weekly_hours ? Number(chosenVaga.weekly_hours) : null))
      const { error } = await supabase.from('nutritionist_agenda').insert({
        employee_id: addForm.employee_id,
        client_id: clientId,
        unit_id: addForm.unit_id || null,
        planned_date: dayOpen,
        planned_time: addForm.time || null,
        hours_expected: hours,
        notes: addForm.notes || null,
        created_by_admin: true,
      })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Visita agendada!'); invalidateAll(); closeAdd() },
    onError: (e: Error) => toast.error(e.message),
  })

  // Manual: visita planejada, ausência avisada ou compromisso
  const addManual = useMutation({
    mutationFn: async () => {
      if (!dayOpen) throw new Error('Dia inválido')
      const k = addForm.manualKind
      // "Para quem?" vem como 'emp:<id>' (colaborador) ou 'rh:<id>' (equipe RH).
      const [who, whoId] = (addForm.assignee || '').split(':')

      // ── Equipe RH: NUNCA entra na folha. Vira item da Agenda pessoal da
      // pessoa (interviews.recruiter_id) — só calendário + agenda dela. ──
      if (who === 'rh') {
        if (!whoId) throw new Error('Escolha a pessoa do RH')
        const clientName = (allClients || []).find(c => c.id === addForm.client_id)?.name
        let title = addForm.title.trim()
        if (!title) {
          if (k === 'planejada') title = clientName ? `Visita — ${clientName}` : 'Visita'
          else if (k === 'ausencia') title = addForm.reason.trim() ? `Ausência — ${addForm.reason.trim()}` : 'Ausência'
          else title = 'Compromisso'
        }
        const { error } = await supabase.from('interviews').insert({
          title,
          recruiter_id: whoId,
          scheduled_at: `${dayOpen}T${addForm.time || '09:00'}:00`,
          duration_min: 60,
          modality: 'Presencial',
          status: 'Agendada',
          notes: addForm.notes || null,
        })
        if (error) throw error
        return
      }

      // ── Colaborador (ou ninguém): comportamento por tipo ──
      const empId = who === 'emp' ? whoId : ''
      if (k === 'planejada') {
        if (!addForm.client_id) throw new Error('Escolha o cliente')
        if (!empId) throw new Error('Escolha o colaborador')
        const { error } = await supabase.from('nutritionist_agenda').insert({
          employee_id: empId,
          client_id: addForm.client_id,
          unit_id: addForm.unit_id || null,
          planned_date: dayOpen,
          planned_time: addForm.time || null,
          hours_expected: addForm.hours ? Number(addForm.hours) : null,
          notes: addForm.notes || null,
          created_by_admin: true,
        })
        if (error) throw error
      } else if (k === 'ausencia') {
        if (!empId) throw new Error('Escolha o colaborador')
        if (!addForm.reason.trim()) throw new Error('Escreva o motivo (ex: médico)')
        // Sem cliente escolhido, usa o primeiro vínculo da pessoa (a tabela espera um cliente)
        let clientId = addForm.client_id
        if (!clientId) {
          const { data } = await supabase.from('employee_client_links').select('client_id').eq('employee_id', empId).limit(1)
          clientId = data?.[0]?.client_id || ''
        }
        if (!clientId) throw new Error('Escolha o cliente (esta pessoa não tem vínculo)')
        const { error } = await supabase.from('schedule_notices').insert({
          employee_id: empId,
          client_id: clientId,
          type: 'falta',
          notice_date: dayOpen,
          reason: addForm.reason.trim(),
        })
        if (error) throw error
      } else {
        if (!addForm.title.trim()) throw new Error('Escreva o título do compromisso')
        const { error } = await supabase.from('interviews').insert({
          title: addForm.title.trim(),
          employee_id: empId || null,
          scheduled_at: `${dayOpen}T${addForm.time || '09:00'}:00`,
          duration_min: 60,
          modality: 'Presencial',
          status: 'Agendada',
          notes: addForm.notes || null,
        })
        if (error) throw error
      }
    },
    onSuccess: () => { toast.success('Adicionado ao calendário!'); invalidateAll(); closeAdd() },
    onError: (e: Error) => toast.error(e.message),
  })

  const durH = (a?: string | null, b?: string | null, bs?: string | null, be?: string | null) => {
    if (!a || !b) return null
    const m = (t: string) => { const [h, mm] = t.slice(0, 5).split(':').map(Number); return h * 60 + mm }
    let net = m(b) - m(a)
    if (bs && be) net -= Math.max(0, m(be) - m(bs))
    return net > 0 ? Math.round((net / 60) * 10) / 10 : null
  }

  // Junta tudo num único array de eventos
  const events = useMemo<Ev[]>(() => {
    const out: Ev[] = []
    for (const v of visits || []) {
      const emp = (v as { employee?: { full_name: string } }).employee?.full_name || '—'
      out.push({
        kind: v.is_unavailable ? 'ausencia' : 'realizada',
        date: v.visit_date,
        employee: emp,
        client: (v as { client?: { name: string } }).client?.name,
        unit: v.unit_name || undefined,
        time: v.check_in ? v.check_in.slice(0, 5) : null,
        hours: durH(v.check_in, v.check_out, v.break_start, v.break_end),
        note: v.is_unavailable ? 'Falta registrada' : v.observations,
        reportUrl: v.report_url,
        employeeId: v.employee_id,
      })
    }
    // planejadas: se já tem visita realizada no mesmo dia+colaborador, não duplica
    for (const a of agenda || []) {
      const emp = (a as { employee?: { full_name: string } }).employee?.full_name || '—'
      const already = (visits || []).some(v => v.visit_date === a.planned_date && v.employee_id === a.employee_id && !v.is_unavailable)
      if (already) continue
      out.push({
        kind: 'planejada',
        date: a.planned_date,
        employee: emp,
        client: (a as { client?: { name: string } }).client?.name,
        unit: (a as { unit?: { name: string } }).unit?.name,
        time: a.planned_time ? a.planned_time.slice(0, 5) : null,
        hours: a.hours_expected ?? null,
        note: a.notes,
        employeeId: a.employee_id,
      })
    }
    for (const n of notices || []) {
      out.push({
        kind: 'ausencia',
        date: n.notice_date,
        employee: (n as { employee?: { full_name: string } }).employee?.full_name || '—',
        client: (n as { client?: { name: string } }).client?.name,
        note: n.reason || (n.type === 'falta' ? 'Falta avisada' : 'Troca de dia'),
        employeeId: n.employee_id,
      })
    }
    for (const ap of appointments || []) {
      out.push({
        kind: 'compromisso',
        date: (ap.scheduled_at || '').slice(0, 10),
        employee: (ap as { employee?: { full_name: string } }).employee?.full_name
          || (ap as { candidate?: { full_name: string } }).candidate?.full_name
          || (ap as { recruiter?: { full_name: string } }).recruiter?.full_name || '—',
        time: formatLocalTime(ap.scheduled_at),
        note: ap.title || (ap as { vacancy?: { title: string } }).vacancy?.title,
      })
    }
    return out
  }, [visits, agenda, notices, appointments])

  const filtered = events.filter(e =>
    (!fEmployee || e.employee === fEmployee) && (!fClient || e.client === fClient))

  const byDay = useMemo(() => {
    const m: Record<string, Ev[]> = {}
    for (const e of filtered) { (m[e.date] ||= []).push(e) }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
    return m
  }, [filtered])

  const employees = [...new Set(events.map(e => e.employee))].filter(n => n !== '—').sort()
  const clients = [...new Set(events.map(e => e.client).filter(Boolean) as string[])].sort()

  const daysInMonth = getDaysInMonth(cursor)
  const firstDow = getDay(startOfMonth(cursor))
  const todayStr = new Date().toISOString().slice(0, 10)
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

  const totalMes = filtered.filter(e => e.kind === 'realizada').length
  const planejadasMes = filtered.filter(e => e.kind === 'planejada').length
  const ausenciasMes = filtered.filter(e => e.kind === 'ausencia').length

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Operação</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900 flex items-center gap-2">
            <CalendarDays size={26} className="text-primary-600" /> Calendário
          </h1>
          <p className="text-sm text-ink-400 mt-1">Tudo que acontece na empresa: visitas, ausências e compromissos.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCursor(subMonths(cursor, 1))} className="btn-secondary p-2"><ChevronLeft size={16} /></button>
          <span className="font-display font-bold text-ink-900 capitalize min-w-[140px] text-center">{format(cursor, 'MMMM yyyy')}</span>
          <button onClick={() => setCursor(addMonths(cursor, 1))} className="btn-secondary p-2"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Resumo + filtros */}
      <div className="card p-3 flex gap-2 flex-wrap items-center">
        <span className="badge bg-primary-50 text-primary-700">{totalMes} realizadas</span>
        <span className="badge bg-amber-50 text-amber-700">{planejadasMes} planejadas</span>
        {ausenciasMes > 0 && <span className="badge bg-red-50 text-red-600">{ausenciasMes} ausências</span>}
        <div className="flex gap-2 ml-auto flex-wrap">
          <select className="input w-auto text-xs py-1.5" value={fEmployee} onChange={e => setFEmployee(e.target.value)}>
            <option value="">Todos os colaboradores</option>
            {employees.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select className="input w-auto text-xs py-1.5" value={fClient} onChange={e => setFClient(e.target.value)}>
            <option value="">Todos os clientes</option>
            {clients.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Grade do mês */}
      <div className="card p-3 md:p-4">
        <div className="grid grid-cols-7 mb-1">
          {DOW.map(d => <div key={d} className="text-center text-[11px] text-ink-400 font-semibold py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`
            const evs = byDay[dateStr] || []
            const isToday = dateStr === todayStr
            const kinds = [...new Set(evs.map(e => e.kind))]
            return (
              <button key={day} onClick={() => { setDayOpen(dateStr); setAddOpen(false); setAddForm(EMPTY_ADD) }}
                className={`min-h-[62px] md:min-h-[76px] rounded-xl border p-1.5 flex flex-col items-start gap-1 transition-colors text-left cursor-pointer
                  ${evs.length ? 'border-ink-200 hover:border-primary-300 hover:bg-primary-50/40' : 'border-ink-100 hover:border-primary-200 hover:bg-ink-50/60'}
                  ${isToday ? 'ring-2 ring-primary-400' : ''}`}>
                <span className={`text-xs font-bold ${isToday ? 'text-primary-700' : 'text-ink-600'}`}>{day}</span>
                {evs.length > 0 && (
                  <>
                    <div className="flex gap-0.5 flex-wrap">
                      {kinds.map(k => <span key={k} className={`w-1.5 h-1.5 rounded-full ${KIND_META[k].dot}`} />)}
                    </div>
                    <span className="text-[10px] text-ink-500 leading-tight">{evs.length} {evs.length === 1 ? 'item' : 'itens'}</span>
                  </>
                )}
              </button>
            )
          })}
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-3 mt-3 text-[11px] text-ink-500 flex-wrap">
          {(Object.keys(KIND_META) as EventKind[]).map(k => (
            <span key={k} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${KIND_META[k].dot}`} /> {KIND_META[k].label}</span>
          ))}
        </div>
      </div>

      {/* Detalhe do dia */}
      {dayOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setDayOpen(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{formatDate(dayOpen)}</h3>
                <p className="text-xs text-ink-400">{(byDay[dayOpen] || []).length} item(ns) neste dia</p>
              </div>
              <button onClick={() => setDayOpen(null)} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
            </div>
            {(byDay[dayOpen] || []).length === 0 && !addOpen && (
              <p className="text-sm text-ink-400">Nada neste dia ainda.</p>
            )}

            {/* Adicionar no dia */}
            {!addOpen ? (
              <button onClick={() => setAddOpen(true)} className="btn-primary w-full text-sm"><Plus size={15} /> Adicionar neste dia</button>
            ) : (
              <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-3 space-y-3">
                <div className="flex gap-1">
                  {([['vincular', '🔗 Vincular vaga'], ['manual', '✏️ Digitar']] as const).map(([k, t]) => (
                    <button key={k} onClick={() => setAddTab(k)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${addTab === k ? 'bg-primary-600 text-white' : 'bg-white text-ink-500 border border-ink-200'}`}>{t}</button>
                  ))}
                </div>

                {addTab === 'vincular' ? (
                  <>
                    <div>
                      <label className="label">Vaga *</label>
                      <select className="input" value={addForm.vacancy_id}
                        onChange={e => setAddForm(p => ({ ...p, vacancy_id: e.target.value, employee_id: '', unit_id: '' }))}>
                        <option value="">Selecionar vaga...</option>
                        {vagas?.map(v => <option key={v.id} value={v.id}>{v.title}{(v as { client?: { name: string } }).client?.name ? ` — ${(v as { client?: { name: string } }).client!.name}` : ''}</option>)}
                      </select>
                    </div>
                    {addForm.vacancy_id && (() => {
                      const opts = (vagaLinks || []).filter(l => l.vacancy_id === addForm.vacancy_id)
                      return (
                        <div>
                          <label className="label">Nutricionista *</label>
                          <select className="input" value={addForm.employee_id} onChange={e => setAddForm(p => ({ ...p, employee_id: e.target.value }))}>
                            <option value="">{opts.length ? 'Selecionar...' : 'Nenhum vinculado — escolha abaixo'}</option>
                            {opts.map(l => <option key={l.id} value={l.employee_id}>{(l as { employee?: { full_name: string } }).employee?.full_name}</option>)}
                            {opts.length === 0 && allEmployees?.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                          </select>
                          {chosenVaga?.weekly_hours && <p className="text-[11px] text-primary-600 mt-1">Horas da vaga: {chosenVaga.weekly_hours}h por visita</p>}
                        </div>
                      )
                    })()}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="label">O que é? *</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {([['planejada', '🟡 Visita'], ['ausencia', '🔴 Ausência'], ['compromisso', '🔵 Compromisso']] as const).map(([k, t]) => (
                          <button key={k} onClick={() => setAddForm(p => ({ ...p, manualKind: k }))}
                            className={`py-2 px-1 text-xs font-medium rounded-lg border-2 transition-colors ${addForm.manualKind === k ? 'border-primary-600 bg-white' : 'border-ink-200 bg-white/60 text-ink-500'}`}>{t}</button>
                        ))}
                      </div>
                    </div>
                    {addForm.manualKind === 'compromisso' ? (
                      <div>
                        <label className="label">Título *</label>
                        <input className="input" placeholder="Ex: Reunião de alinhamento" value={addForm.title} onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))} />
                      </div>
                    ) : (
                      <div>
                        <label className="label">Cliente {addForm.manualKind === 'planejada' && !addForm.assignee.startsWith('rh:') ? '*' : <span className="text-gray-400 font-normal">(opcional)</span>}</label>
                        <select className="input" value={addForm.client_id} onChange={e => setAddForm(p => ({ ...p, client_id: e.target.value, unit_id: '' }))}>
                          <option value="">Selecionar...</option>
                          {allClients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="label">Para quem? {addForm.manualKind === 'compromisso' ? <span className="text-gray-400 font-normal">(opcional)</span> : '*'}</label>
                      <select className="input" value={addForm.assignee} onChange={e => setAddForm(p => ({ ...p, assignee: e.target.value }))}>
                        <option value="">Selecionar...</option>
                        <optgroup label="Colaboradores">
                          {allEmployees?.map(e => <option key={e.id} value={`emp:${e.id}`}>{e.full_name}</option>)}
                        </optgroup>
                        <optgroup label="Equipe RH">
                          {rhUsers?.map(u => <option key={u.id} value={`rh:${u.id}`}>{u.full_name}</option>)}
                        </optgroup>
                      </select>
                      {addForm.assignee.startsWith('rh:') && (
                        <p className="text-[11px] text-primary-600 mt-1">RH: entra só no calendário e na Agenda dessa pessoa — <strong>sem pagamento</strong>.</p>
                      )}
                    </div>
                    {addForm.manualKind === 'ausencia' && (
                      <div>
                        <label className="label">Motivo *</label>
                        <input className="input" placeholder="Ex: médico, pessoal, atestado..." value={addForm.reason} onChange={e => setAddForm(p => ({ ...p, reason: e.target.value }))} />
                      </div>
                    )}
                  </>
                )}

                {/* Campos comuns */}
                {(addTab === 'vincular' || addForm.manualKind !== 'ausencia') && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label">Hora <span className="text-gray-400 font-normal">(opcional)</span></label>
                      <input className="input" type="time" value={addForm.time} onChange={e => setAddForm(p => ({ ...p, time: e.target.value }))} />
                    </div>
                    {addForm.manualKind !== 'compromisso' && (
                      <div>
                        <label className="label">Horas <span className="text-gray-400 font-normal">(opcional)</span></label>
                        <input className="input" type="number" step="0.5" placeholder="Ex: 4" value={addForm.hours} onChange={e => setAddForm(p => ({ ...p, hours: e.target.value }))} />
                      </div>
                    )}
                  </div>
                )}
                {(unitOpts?.length ?? 0) > 0 && addForm.manualKind !== 'compromisso' && addForm.manualKind !== 'ausencia' && (
                  <div>
                    <label className="label">Unidade <span className="text-gray-400 font-normal">(opcional)</span></label>
                    <select className="input" value={addForm.unit_id} onChange={e => setAddForm(p => ({ ...p, unit_id: e.target.value }))}>
                      <option value="">Qualquer</option>
                      {unitOpts?.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                )}
                {addForm.manualKind !== 'ausencia' && (
                  <div>
                    <label className="label">Observação <span className="text-gray-400 font-normal">(opcional)</span></label>
                    <input className="input" placeholder="O que precisa saber..." value={addForm.notes} onChange={e => setAddForm(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                )}

                <div className="flex gap-2">
                  <button className="btn-primary flex-1 text-sm"
                    disabled={addFromVaga.isPending || addManual.isPending}
                    onClick={() => addTab === 'vincular' ? addFromVaga.mutate() : addManual.mutate()}>
                    {(addFromVaga.isPending || addManual.isPending) ? 'Salvando...' : 'Salvar'}
                  </button>
                  <button className="btn-secondary text-sm" onClick={closeAdd}>Cancelar</button>
                </div>
              </div>
            )}

            {(byDay[dayOpen] || []).map((e, idx) => (
              <div key={idx} className={`rounded-xl border p-3 space-y-1 ${KIND_META[e.kind].chip}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="font-semibold text-sm">{e.employee}</p>
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{KIND_META[e.kind].label}</span>
                </div>
                {e.client && <p className="text-sm">{e.client}{e.unit ? ` · ${e.unit}` : ''}</p>}
                <div className="flex items-center gap-3 text-xs flex-wrap opacity-80">
                  {e.time && <span className="flex items-center gap-1"><Clock size={11} /> {e.time}</span>}
                  {e.hours != null && <span>{e.hours}h</span>}
                </div>
                {e.note && <p className="text-xs opacity-90">{e.note}</p>}
                <div className="flex gap-2 pt-1">
                  {e.reportUrl && (
                    <SignedLink value={e.reportUrl} bucket="arquivos" className="btn-secondary text-xs inline-flex items-center gap-1 py-1"><FileText size={12} /> Relatório</SignedLink>
                  )}
                  {e.employeeId && (
                    <button onClick={() => navigate(`/colaboradores/${e.employeeId}`)} className="btn-secondary text-xs py-1">Abrir colaborador</button>
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
