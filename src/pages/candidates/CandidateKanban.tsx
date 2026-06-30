import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PIPELINE_STAGES } from '../../lib/utils'
import toast from 'react-hot-toast'

const STAGE_COLORS: Record<string, string> = {
  'Banco': 'bg-gray-50 border-gray-200',
  'Em Avaliação': 'bg-purple-50 border-purple-200',
  'Contato Feito': 'bg-blue-50 border-blue-200',
  'Entrevista Agendada': 'bg-orange-50 border-orange-200',
  'Aprovado': 'bg-green-50 border-green-200',
  'Em Processo de Contratação': 'bg-blue-100 border-blue-300',
  'Contratado': 'bg-green-100 border-green-300',
  'Reprovado': 'bg-red-50 border-red-200',
  'Inativo': 'bg-gray-100 border-gray-300',
}

const CARD_ACCENT: Record<string, string> = {
  'Banco': 'border-l-gray-400',
  'Em Avaliação': 'border-l-purple-400',
  'Contato Feito': 'border-l-blue-400',
  'Entrevista Agendada': 'border-l-orange-400',
  'Aprovado': 'border-l-green-500',
  'Em Processo de Contratação': 'border-l-blue-600',
  'Contratado': 'border-l-green-600',
  'Reprovado': 'border-l-red-400',
  'Inativo': 'border-l-gray-500',
}

export default function CandidateKanban() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [rejectModal, setRejectModal] = useState<{ id: string; stage: string } | null>(null)
  const [reason, setReason] = useState('')
  const [interviewModal, setInterviewModal] = useState<{ id: string } | null>(null)
  const [interviewForm, setInterviewForm] = useState({
    scheduled_at: '', duration_min: '30', modality: 'Online', link_or_address: '', notes: '', vacancy_id: '',
  })

  const { data: candidates } = useQuery({
    queryKey: ['candidates-kanban'],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('id,full_name,city,formation,pipeline_stage,updated_at').order('full_name')
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

  const updateStage = useMutation({
    mutationFn: async ({ id, stage, reason, inactivation_reason }: { id: string; stage: string; reason?: string; inactivation_reason?: string }) => {
      const updates: Record<string, unknown> = { pipeline_stage: stage }
      if (reason) updates.rejection_reason = reason
      if (inactivation_reason) updates.inactivation_reason = inactivation_reason
      const { error } = await supabase.from('candidates').update(updates).eq('id', id)
      if (error) throw error
      if (reason) {
        await supabase.from('candidate_contacts').insert({ candidate_id: id, contact_date: new Date().toISOString().slice(0, 10), observations: `Reprovado: ${reason}` })
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['candidates-kanban'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const createInterview = useMutation({
    mutationFn: async (candidateId: string) => {
      const { error } = await supabase.from('interviews').insert({
        candidate_id: candidateId,
        scheduled_at: interviewForm.scheduled_at,
        duration_min: Number(interviewForm.duration_min),
        modality: interviewForm.modality,
        link_or_address: interviewForm.link_or_address || null,
        notes: interviewForm.notes || null,
        vacancy_id: interviewForm.vacancy_id || null,
        status: 'Agendada',
      })
      if (error) throw error
      await supabase.from('candidates').update({ pipeline_stage: 'Entrevista Agendada', interview_scheduled_at: interviewForm.scheduled_at }).eq('id', candidateId)
    },
    onSuccess: () => {
      toast.success('Entrevista agendada!')
      qc.invalidateQueries({ queryKey: ['candidates-kanban'] })
      setInterviewModal(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const grouped = PIPELINE_STAGES.reduce((acc, stage) => {
    acc[stage] = candidates?.filter(c => c.pipeline_stage === stage) ?? []
    return acc
  }, {} as Record<string, typeof candidates>)

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const { draggableId, destination } = result
    const newStage = destination.droppableId
    const candidate = candidates?.find(c => c.id === draggableId)
    if (!candidate || candidate.pipeline_stage === newStage) return
    if (['Em Processo de Contratação', 'Contratado'].includes(newStage)) {
      toast('Este estágio é atualizado automaticamente', { icon: 'ℹ️' })
      return
    }
    if (newStage === 'Reprovado') { setRejectModal({ id: draggableId, stage: newStage }); return }
    if (newStage === 'Inativo') { setRejectModal({ id: draggableId, stage: newStage }); return }
    if (newStage === 'Entrevista Agendada') { setInterviewModal({ id: draggableId }); return }
    updateStage.mutate({ id: draggableId, stage: newStage })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/candidatos')} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">Pipeline Kanban</h1>
        <span className="text-sm text-gray-500">({candidates?.length ?? 0} candidatos)</span>
      </div>

      <div className="overflow-x-auto pb-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3" style={{ minWidth: `${PIPELINE_STAGES.length * 220}px` }}>
            {PIPELINE_STAGES.map(stage => (
              <div key={stage} className="flex-shrink-0 w-52">
                <div className={`rounded-xl border p-3 ${STAGE_COLORS[stage] || 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-gray-700 truncate">{stage}</h3>
                    <span className="text-xs text-gray-500 bg-white rounded-full px-1.5 py-0.5">{grouped[stage]?.length ?? 0}</span>
                  </div>
                  <Droppable droppableId={stage}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`min-h-20 space-y-2 rounded-lg transition-colors ${snapshot.isDraggingOver ? 'bg-white/60' : ''}`}
                      >
                        {grouped[stage]?.map((c, index) => (
                          <Draggable key={c.id} draggableId={c.id} index={index}
                            isDragDisabled={['Em Processo de Contratação', 'Contratado'].includes(stage)}>
                            {(prov) => (
                              <div
                                ref={prov.innerRef}
                                {...prov.draggableProps}
                                {...prov.dragHandleProps}
                                className={`bg-white rounded-lg p-3 shadow-sm border-l-4 cursor-pointer hover:shadow-md ${CARD_ACCENT[stage] || 'border-l-gray-300'}`}
                                onClick={() => navigate(`/candidatos/${c.id}`)}
                              >
                                <p className="text-xs font-medium text-gray-900 line-clamp-2">{c.full_name}</p>
                                <p className="text-xs text-gray-400 mt-0.5">{c.city || '-'}</p>
                                {c.formation && <p className="text-xs text-gray-400">{c.formation}</p>}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>

      {/* Reject/Inactivate modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold">{rejectModal.stage === 'Reprovado' ? 'Registrar Reprovação' : 'Registrar Inativação'}</h3>
            <p className="text-sm text-gray-500">Informe o motivo:</p>
            <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo..." autoFocus />
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={!reason} onClick={() => {
                updateStage.mutate({
                  id: rejectModal.id, stage: rejectModal.stage,
                  reason: rejectModal.stage === 'Reprovado' ? reason : undefined,
                  inactivation_reason: rejectModal.stage === 'Inativo' ? reason : undefined,
                })
                setRejectModal(null); setReason('')
              }}>Confirmar</button>
              <button className="btn-secondary" onClick={() => { setRejectModal(null); setReason('') }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Interview modal */}
      {interviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="font-semibold">Agendar Entrevista</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="label">Data e Hora *</label><input className="input" type="datetime-local" value={interviewForm.scheduled_at} onChange={e => setInterviewForm(p => ({ ...p, scheduled_at: e.target.value }))} /></div>
              <div>
                <label className="label">Duração</label>
                <select className="input" value={interviewForm.duration_min} onChange={e => setInterviewForm(p => ({ ...p, duration_min: e.target.value }))}>
                  <option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option>
                </select>
              </div>
              <div>
                <label className="label">Modalidade</label>
                <select className="input" value={interviewForm.modality} onChange={e => setInterviewForm(p => ({ ...p, modality: e.target.value }))}>
                  <option>Online</option><option>Presencial</option><option>Telefone</option>
                </select>
              </div>
              <div className="col-span-2"><label className="label">Link / Endereço</label><input className="input" value={interviewForm.link_or_address} onChange={e => setInterviewForm(p => ({ ...p, link_or_address: e.target.value }))} /></div>
              <div>
                <label className="label">Vaga</label>
                <select className="input" value={interviewForm.vacancy_id} onChange={e => setInterviewForm(p => ({ ...p, vacancy_id: e.target.value }))}>
                  <option value="">Nenhuma</option>
                  {vacancies?.map(v => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={!interviewForm.scheduled_at || createInterview.isPending} onClick={() => createInterview.mutate(interviewModal.id)}>
                Agendar
              </button>
              <button className="btn-secondary" onClick={() => setInterviewModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
