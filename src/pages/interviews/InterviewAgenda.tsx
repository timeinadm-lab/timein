import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Calendar, List, Edit, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, formatDateTime } from '../../lib/utils'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, addMonths, subMonths } from 'date-fns'
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

export default function InterviewAgenda() {
  const { role, profile } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMine, setFilterMine] = useState(role === 'recrutador')
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const { data: interviews } = useQuery({
    queryKey: ['interviews', filterStatus, filterMine, profile?.id],
    queryFn: async () => {
      let q = supabase.from('interviews')
        .select('*,candidate:candidates(id,full_name),vacancy:vacancies(id,title),recruiter:user_profiles(full_name),employee:employees(id,full_name)')
        .order('scheduled_at', { ascending: true })
      if (filterStatus) q = q.eq('status', filterStatus)
      if (filterMine && profile?.id) q = q.eq('recruiter_id', profile.id)
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

  const monthDays = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
  const dayInterviews = (day: Date) => interviews?.filter(i => isSameDay(parseISO(i.scheduled_at), day)) ?? []

  const displayInterviews = selectedDay ? interviews?.filter(i => isSameDay(parseISO(i.scheduled_at), selectedDay)) : interviews

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
        {displayInterviews?.map(i => (
          <div key={i.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium">{i.title || (i as { candidate?: { full_name: string } }).candidate?.full_name || 'Compromisso'}</p>
                  <span className={`badge ${MODAL_COLORS[i.modality] || 'bg-gray-100'}`}>{i.modality}</span>
                  <span className={`badge ${STATUS_COLORS[i.status] || 'bg-gray-100'}`}>{i.status}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {formatDateTime(i.scheduled_at)}
                  {i.end_date ? ` → ${formatDate(i.end_date)}` : ` · ${i.duration_min}min`}
                </p>
                {(i as { employee?: { id: string; full_name: string } }).employee?.full_name && <p className="text-xs text-gray-400">Colaborador: <span className="cursor-pointer hover:text-primary-600" onClick={() => (i as { employee?: { id: string } }).employee?.id && navigate(`/colaboradores/${(i as { employee?: { id: string } }).employee?.id}`)}>{(i as { employee?: { full_name: string } }).employee?.full_name}</span></p>}
                {(i as { candidate?: { full_name: string } }).candidate?.full_name && <p className="text-xs text-gray-400">Candidato: <span className="cursor-pointer hover:text-primary-600" onClick={() => i.candidate?.id && navigate(`/candidatos/${i.candidate.id}`)}>{(i as { candidate?: { full_name: string } }).candidate?.full_name}</span></p>}
                {(i as { vacancy?: { title: string } }).vacancy?.title && <p className="text-xs text-gray-400">Vaga: {(i as { vacancy?: { title: string } }).vacancy?.title}</p>}
                {i.link_or_address && <p className="text-xs text-primary-600 mt-0.5">{i.link_or_address}</p>}
                {i.notes && <p className="text-xs text-gray-500 mt-0.5">{i.notes}</p>}
                {(i as { recruiter?: { full_name: string } }).recruiter?.full_name && <p className="text-xs text-gray-400 mt-0.5">Responsável: {(i as { recruiter?: { full_name: string } }).recruiter?.full_name}</p>}
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
        ))}
      </div>
    </div>
  )
}
