import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X, FileText, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatLocalTime } from '../../lib/utils'

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

export default function CalendarPage() {
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(new Date())
  const [dayOpen, setDayOpen] = useState<string | null>(null)
  const [fEmployee, setFEmployee] = useState('')
  const [fClient, setFClient] = useState('')

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
        .select('id, title, scheduled_at, modality, status, employee:employees(full_name), candidate:candidates(full_name), vacancy:vacancies(title)')
        .gte('scheduled_at', mStart).lte('scheduled_at', mEnd + 'T23:59:59')
      if (error) { console.warn('interviews:', error.message); return [] }
      return data || []
    },
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
          || (ap as { candidate?: { full_name: string } }).candidate?.full_name || '—',
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
              <button key={day} onClick={() => evs.length && setDayOpen(dateStr)} disabled={!evs.length}
                className={`min-h-[62px] md:min-h-[76px] rounded-xl border p-1.5 flex flex-col items-start gap-1 transition-colors text-left
                  ${evs.length ? 'border-ink-200 hover:border-primary-300 hover:bg-primary-50/40 cursor-pointer' : 'border-ink-100'}
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
