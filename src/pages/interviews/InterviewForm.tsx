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
    title: '', candidate_id: '', vacancy_id: '', employee_id: '', recruiter_id: profile?.id || '',
    scheduled_at: '', end_date: '', duration_min: '30', modality: 'Online',
    link_or_address: '', notes: '', status: 'Agendada',
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-select'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,full_name').eq('status', 'Ativo').order('full_name')
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
        candidate_id: data.candidate_id || '',
        vacancy_id: data.vacancy_id || '',
        employee_id: data.employee_id || '',
        recruiter_id: data.recruiter_id || '',
        scheduled_at: data.scheduled_at ? data.scheduled_at.slice(0, 16) : '',
        end_date: data.end_date || '',
        duration_min: String(data.duration_min || 30),
        modality: data.modality || 'Online',
        link_or_address: data.link_or_address || '',
        notes: data.notes || '',
        status: data.status || 'Agendada',
      })
      return data
    },
    enabled: isEdit,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        const { error } = await supabase.from('interviews').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('interviews').insert(payload)
        if (error) throw error
        // Update candidate stage
        if (payload.candidate_id) {
          await supabase.from('candidates').update({
            pipeline_stage: 'Entrevista Agendada',
            interview_scheduled_at: payload.scheduled_at,
          }).eq('id', payload.candidate_id)
        }
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Compromisso atualizado!' : 'Compromisso agendado!')
      qc.invalidateQueries({ queryKey: ['interviews'] })
      navigate('/agenda')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      title: form.title || null,
      candidate_id: form.candidate_id || null,
      vacancy_id: form.vacancy_id || null,
      employee_id: form.employee_id || null,
      recruiter_id: form.recruiter_id || null,
      scheduled_at: form.scheduled_at,
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
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Título *</label>
            <input className="input" required placeholder="Ex: Reunião com fornecedor, Entrevista com a Maria…" value={form.title} onChange={e => set('title', e.target.value)} />
          </div>
          <div>
            <label className="label">Data e Hora *</label>
            <input className="input" type="datetime-local" required value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
          </div>
          <div>
            <label className="label">Até <span className="text-gray-400 font-normal">(opcional — férias, período)</span></label>
            <input className="input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
          </div>
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
          <div className="col-span-2">
            <label className="label">Responsável <span className="text-gray-400 font-normal">(quem vai fazer — pode agendar para qualquer pessoa)</span></label>
            <select className="input" value={form.recruiter_id} onChange={e => set('recruiter_id', e.target.value)}>
              <option value="">Ninguém específico</option>
              {recruiters?.map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className="label">Link de reunião / Endereço</label><input className="input" value={form.link_or_address} onChange={e => set('link_or_address', e.target.value)} /></div>
          <div className="col-span-2"><label className="label">Notas</label><textarea className="input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
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
