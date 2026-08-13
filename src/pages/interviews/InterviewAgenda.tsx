import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, List, Edit, Trash2, CalendarClock, Check, Video, MapPin } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatLocalDateTime, parseLocal, isMeetingLink, mapsUrl } from '../../lib/utils'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'

const MODAL_COLORS: Record<string, string> = {
  Online: 'bg-blue-100 text-blue-700',
  Presencial: 'bg-green-100 text-green-700',
  Telefone: 'bg-gray-100 text-gray-700',
}
const STATUS_COLORS: Record<string, string> = {
  Agendada: 'bg-amber-100 text-amber-700',
  Realizada: 'bg-green-100 text-green-700',
  Cancelada: 'bg-gray-100 text-gray-700',
  Falta: 'bg-red-100 text-red-700',
}
const CATEGORY_COLORS: Record<string, string> = {
  Reunião: 'bg-blue-100 text-blue-700',
  Visita: 'bg-primary-100 text-primary-700',
  Treinamento: 'bg-purple-100 text-purple-700',
  Ligação: 'bg-cyan-100 text-cyan-700',
  Entrevista: 'bg-indigo-100 text-indigo-700',
  Outro: 'bg-gray-100 text-gray-600',
}

export default function InterviewAgenda() {
  const { role, profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMine, setFilterMine] = useState(role === 'recrutador')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [schedulingId, setSchedulingId] = useState<string | null>(null)
  const [scheduleValue, setScheduleValue] = useState('')

  const { data: allProfiles } = useQuery({
    queryKey: ['user-profiles-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name')
      if (error) throw error
      return data || []
    },
  })
  const profileName = (pid: string) => allProfiles?.find(p => p.id === pid)?.full_name || '?'

  const { data: interviews } = useQuery({
    queryKey: ['interviews', filterStatus, filterMine, profile?.id],
    queryFn: async () => {
      let q = supabase.from('interviews')
        .select('*,candidate:candidates(id,full_name),vacancy:vacancies(id,title),recruiter:user_profiles(full_name),employee:employees(id,full_name)')
        .order('scheduled_at', { ascending: true })
      if (filterStatus) q = q.eq('status', filterStatus)
      // Responsável antigo ou participante — os dois veem na própria agenda
      if (filterMine && profile?.id) q = q.or(`recruiter_id.eq.${profile.id},participant_ids.cs.{${profile.id}}`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, candidateId }: { id: string; status: string; candidateId?: string }) => {
      const { error } = await supabase.from('interviews').update({ status }).eq('id', id)
      if (error) throw error
      // Auto-advance candidate pipeline when interview is completed/missed
      if (candidateId) {
        if (status === 'Realizada') {
          await supabase.from('candidates').update({ pipeline_stage: 'Aprovado' })
            .eq('id', candidateId).eq('pipeline_stage', 'Entrevista Agendada')
        } else if (status === 'Falta') {
          await supabase.from('candidates').update({ pipeline_stage: 'Reprovado' })
            .eq('id', candidateId)
        }
      }
    },
    onSuccess: () => { toast.success('Status atualizado!'); qc.invalidateQueries({ queryKey: ['interviews'] }); qc.invalidateQueries({ queryKey: ['candidates'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteInterview = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('interviews').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Compromisso excluído!'); qc.invalidateQueries({ queryKey: ['interviews'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Define a data de um item que estava "a agendar"
  const setDate = useMutation({
    mutationFn: async ({ id, dt }: { id: string; dt: string }) => {
      const { error } = await supabase.from('interviews').update({ scheduled_at: dt }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Data definida!'); qc.invalidateQueries({ queryKey: ['interviews'] }); setSchedulingId(null); setScheduleValue('') },
    onError: (e: Error) => toast.error(e.message),
  })

  // Itens SEM data ainda (a agendar) — separados da lista normal
  const pending = (interviews || []).filter(i => !i.scheduled_at && i.status === 'Agendada')

  const monthDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
  const dayInterviews = (day: Date) => interviews?.filter(i => { const d = parseLocal(i.scheduled_at); return d && isSameDay(d, day) }) ?? []

  const dated = interviews?.filter(i => i.scheduled_at)
  const displayInterviews = selectedDay ? dated?.filter(i => { const d = parseLocal(i.scheduled_at); return d && isSameDay(d, selectedDay) }) : dated

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Gestão</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Agenda</h1>
        </div>
        <button onClick={() => navigate('/agenda/nova')} className="btn-primary text-sm"><Plus size={16} />Novo Compromisso</button>
      </div>

      <div className="card p-4 flex gap-3 flex-wrap items-center">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'list' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
            <List size={14} className="inline mr-1" />Lista
          </button>
          <button onClick={() => setView('calendar')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'calendar' ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
            <Calendar size={14} className="inline mr-1" />Calendário
          </button>
        </div>
        <select className="input w-44" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Todos status</option>
          <option>Agendada</option><option>Realizada</option><option>Cancelada</option><option>Falta</option>
        </select>
        {role === 'chefe' && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={filterMine} onChange={e => setFilterMine(e.target.checked)} className="rounded" />
            Só meus compromissos
          </label>
        )}
      </div>

      {/* A AGENDAR — itens sem data ainda. Fica no topo pra ninguém esquecer. */}
      {pending.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50/40 space-y-2">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-amber-600" />
            <h3 className="font-semibold text-amber-800 text-sm">A agendar <span className="font-normal text-amber-600">— {pending.length} sem data definida</span></h3>
          </div>
          {pending.map(i => (
            <div key={i.id} className="rounded-xl bg-white border border-amber-100 p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(i as { category?: string }).category && <span className={`badge ${CATEGORY_COLORS[(i as { category?: string }).category!] || 'bg-gray-100 text-gray-600'}`}>{(i as { category?: string }).category}</span>}
                    <p className="font-medium text-sm">{i.title || 'Compromisso'}</p>
                  </div>
                  {!!(i as { participant_ids?: string[] }).participant_ids?.length && <p className="text-xs text-gray-400">Participantes: {(i as { participant_ids?: string[] }).participant_ids!.map(profileName).join(', ')}</p>}
                  {i.notes && <p className="text-xs text-gray-500 mt-0.5">{i.notes}</p>}
                </div>
                <div className="flex gap-1 items-center">
                  {schedulingId === i.id ? (
                    <>
                      <input type="datetime-local" className="input w-auto text-xs py-1.5" value={scheduleValue} onChange={e => setScheduleValue(e.target.value)} />
                      <button disabled={!scheduleValue || setDate.isPending} onClick={() => setDate.mutate({ id: i.id, dt: scheduleValue })} className="btn-primary text-xs px-2 py-1.5"><Check size={13} /></button>
                      <button onClick={() => { setSchedulingId(null); setScheduleValue('') }} className="btn-ghost text-xs px-2 py-1.5">✕</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => { setSchedulingId(i.id); setScheduleValue('') }} className="btn-secondary text-xs">Definir data</button>
                      <button onClick={() => navigate(`/agenda/${i.id}/editar`)} className="btn-ghost p-2"><Edit size={14} /></button>
                      <button onClick={() => { if (confirm('Excluir?')) deleteInterview.mutate(i.id) }} className="btn-ghost p-2 text-red-400"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="btn-ghost px-2">‹</button>
            <h2 className="font-semibold capitalize">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</h2>
            <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="btn-ghost px-2">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-2">
            {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => <div key={d} className="py-1 font-medium">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {/* First row offset */}
            {Array.from({ length: monthDays[0].getDay() }).map((_, i) => <div key={i} />)}
            {monthDays.map(day => {
              const di = dayInterviews(day)
              const isSelected = selectedDay && isSameDay(day, selectedDay)
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-colors ${isSelected ? 'bg-primary-600 text-white' : di.length > 0 ? 'bg-primary-50 text-primary-700 font-medium hover:bg-primary-100' : 'hover:bg-gray-50 text-gray-700'}`}
                >
                  <span>{day.getDate()}</span>
                  {di.length > 0 && <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isSelected ? 'bg-white' : 'bg-primary-500'}`} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Interview list */}
      <div className="space-y-3">
        {selectedDay && (
          <div className="flex items-center gap-2">
            <h3 className="font-medium">Compromissos de {formatDate(selectedDay)}</h3>
            <button onClick={() => setSelectedDay(null)} className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
          </div>
        )}
        {displayInterviews?.length === 0 && (
          <div className="card p-8 text-center text-gray-400">Nenhum compromisso encontrado</div>
        )}
        {displayInterviews?.map(i => {
          const d = parseLocal(i.scheduled_at)
          const isHoje = d && d.toDateString() === new Date().toDateString()
          const emp = (i as { employee?: { id: string; full_name: string } }).employee
          const cand = (i as { candidate?: { id: string; full_name: string } }).candidate
          const vaga = (i as { vacancy?: { title: string } }).vacancy
          const pids = (i as { participant_ids?: string[] }).participant_ids
          const cat = (i as { category?: string }).category
          // Detalhes secundários juntos numa linha só, em vez de 5 linhas empilhadas
          const detalhes = [
            emp?.full_name && { label: 'Colaborador', value: emp.full_name, path: emp.id ? `/colaboradores/${emp.id}` : null },
            cand?.full_name && { label: 'Candidato', value: cand.full_name, path: cand.id ? `/candidatos/${cand.id}` : null },
            vaga?.title && { label: 'Vaga', value: vaga.title, path: null },
          ].filter(Boolean) as { label: string; value: string; path: string | null }[]

          return (
          <div key={i.id} className={`card p-4 ${isHoje ? 'border-primary-300 bg-primary-50/30' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0 space-y-2">
                {/* Título + o que é */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-ink-900">{i.title || cand?.full_name || 'Compromisso'}</p>
                    {cat && <span className={`badge ${CATEGORY_COLORS[cat] || 'bg-gray-100 text-gray-600'}`}>{cat}</span>}
                    <span className={`badge ${STATUS_COLORS[i.status] || 'bg-gray-100'}`}>{i.status}</span>
                  </div>
                  <p className="text-sm text-ink-500 mt-0.5">
                    {isHoje && <span className="font-semibold text-primary-700">Hoje · </span>}
                    {formatLocalDateTime(i.scheduled_at)}
                    {i.end_date ? ` → ${formatDate(i.end_date)}` : ` · ${i.duration_min}min`}
                    <span className="text-ink-300"> · </span>
                    <span className={`${MODAL_COLORS[i.modality]?.includes('blue') ? 'text-blue-600' : 'text-ink-500'}`}>{i.modality}</span>
                  </p>
                </div>

                {/* Onde é — clicável: link abre a reunião, endereço abre o mapa */}
                {i.link_or_address && (
                  isMeetingLink(i.link_or_address) ? (
                    <a href={i.link_or_address} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-95 transition-all">
                      <Video size={14} /> Entrar na reunião
                    </a>
                  ) : (
                    <a href={mapsUrl(i.link_or_address)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline">
                      <MapPin size={14} className="flex-shrink-0" /> {i.link_or_address}
                    </a>
                  )
                )}

                {/* Vínculos numa linha só */}
                {detalhes.length > 0 && (
                  <p className="text-xs text-ink-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    {detalhes.map(dt => (
                      <span key={dt.label}>
                        {dt.label}:{' '}
                        <span className={dt.path ? 'text-ink-600 cursor-pointer hover:text-primary-600 hover:underline' : 'text-ink-600'}
                          onClick={() => dt.path && navigate(dt.path)}>{dt.value}</span>
                      </span>
                    ))}
                  </p>
                )}

                {i.notes && <p className="text-xs text-ink-500 bg-ink-50 rounded-lg px-2 py-1.5">{i.notes}</p>}
                {!!pids?.length && (
                  <p className="text-xs text-ink-400">
                    <span className="text-ink-300">Com:</span> {pids.map(profileName).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-1">
                {i.status === 'Agendada' && (
                  <>
                    <button onClick={() => updateStatus.mutate({ id: i.id, status: 'Realizada', candidateId: i.candidate?.id })} className="btn-secondary text-xs">Realizada</button>
                    <button onClick={() => updateStatus.mutate({ id: i.id, status: 'Cancelada', candidateId: i.candidate?.id })} className="btn-secondary text-xs">Cancelada</button>
                    <button onClick={() => updateStatus.mutate({ id: i.id, status: 'Falta', candidateId: i.candidate?.id })} className="btn-secondary text-xs">Falta</button>
                  </>
                )}
                <button onClick={() => navigate(`/agenda/${i.id}/editar`)} className="btn-ghost p-2"><Edit size={14} /></button>
                <button onClick={() => { if (confirm('Excluir compromisso?')) deleteInterview.mutate(i.id) }} className="btn-ghost p-2 text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
