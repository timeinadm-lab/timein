import { useState, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function ContractForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    client_name: '', client_id: '', employee_id: '',
    type: 'Manual' as 'Manual' | 'Padrão',
    service_type: 'Fixo' as 'Fixo' | 'Consultoria',
    work_shift: '', work_schedule: '', monthly_amount: '',
    visits_per_month: '', visit_amount: '',
    start_date: '', end_date: '', signed: false, signed_at: '',
    employee_responsible: '', requires_supervision: false,
    supervision_visits_per_month: '', supervisor_id: '', template_id: '', observations: '',
  })

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: employees } = useQuery({
    queryKey: ['employees-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,full_name').eq('status', 'Ativo').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: supervisors } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name,role').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: templates } = useQuery({
    queryKey: ['contract-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contract_templates').select('id,name')
      if (error) throw error
      return data || []
    },
  })

  useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*').eq('id', id).single()
      if (error) throw error
      setForm({
        client_name: data.client_name || '',
        client_id: data.client_id || '',
        employee_id: data.employee_id || '',
        type: data.type || 'Manual',
        service_type: data.service_type || 'Fixo',
        work_shift: data.work_shift || '',
        work_schedule: data.work_schedule || '',
        monthly_amount: data.monthly_amount ? String(data.monthly_amount) : '',
        visits_per_month: data.visits_per_month ? String(data.visits_per_month) : '',
        visit_amount: data.visit_amount ? String(data.visit_amount) : '',
        start_date: data.start_date || '',
        end_date: data.end_date || '',
        signed: !!data.signed,
        signed_at: data.signed_at || '',
        employee_responsible: data.employee_responsible || '',
        requires_supervision: !!data.requires_supervision,
        supervision_visits_per_month: data.supervision_visits_per_month ? String(data.supervision_visits_per_month) : '',
        supervisor_id: data.supervisor_id || '',
        template_id: data.template_id || '',
        observations: data.observations || '',
      })
      return data
    },
    enabled: isEdit,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        const { error } = await supabase.from('contracts').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contracts').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Contrato atualizado!' : 'Contrato criado!')
      qc.invalidateQueries({ queryKey: ['contracts'] })
      navigate('/contratos')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      client_name: form.client_name,
      client_id: form.client_id || null,
      employee_id: form.employee_id || null,
      type: form.type,
      // Store service type details in existing fields
      employee_responsible: form.employee_id ? form.service_type : (form.employee_responsible || null),
      supervision_visits_per_month: form.service_type === 'Consultoria' ? (Number(form.visits_per_month) || null) : null,
      observations: form.service_type === 'Fixo'
        ? [form.observations, form.work_shift && `Turno: ${form.work_shift}`, form.work_schedule && `Escala: ${form.work_schedule}`, form.monthly_amount && `Valor: R$ ${form.monthly_amount}/mês`].filter(Boolean).join(' | ')
        : [form.observations, form.service_type === 'Consultoria' && form.visits_per_month && `${form.visits_per_month} visitas/mês`, form.visit_amount && `R$ ${form.visit_amount}/visita`].filter(Boolean).join(' | '),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      signed: form.signed,
      signed_at: form.signed_at || null,
      supervisor_id: form.supervisor_id || null,
      template_id: form.template_id || null,
    })
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Contrato' : 'Novo Contrato'}</h1>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Cliente *</label>
            <select className="input" value={form.client_id} onChange={e => {
              const cl = clients?.find(c => c.id === e.target.value)
              set('client_id', e.target.value)
              if (cl) set('client_name', cl.name)
            }}>
              <option value="">Selecionar cliente...</option>
              {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Colaborador</label>
            <select className="input" value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
              <option value="">Selecionar colaborador...</option>
              {employees?.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Tipo de Contrato *</label>
            <div className="grid grid-cols-2 gap-2">
              {(['Fixo', 'Consultoria'] as const).map(t => (
                <button key={t} type="button"
                  className={`p-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${form.service_type === t ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  onClick={() => set('service_type', t)}>
                  {t === 'Fixo' ? '📅 Fixo / Escala' : '🔍 Consultoria'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Formato</label>
            <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
              <option>Manual</option>
              <option>Padrão</option>
            </select>
          </div>
        </div>

        {/* Fields specific to service type */}
        {form.service_type === 'Fixo' ? (
          <div className="grid grid-cols-2 gap-4 bg-blue-50 p-4 rounded-lg">
            <p className="col-span-2 text-xs font-semibold text-blue-700 uppercase tracking-wide">Detalhes da Escala</p>
            <div>
              <label className="label">Turno</label>
              <select className="input" value={form.work_shift} onChange={e => set('work_shift', e.target.value)}>
                <option value="">Qualquer</option>
                <option>Diurno</option><option>Noturno</option><option>Ambos</option>
              </select>
            </div>
            <div>
              <label className="label">Escala</label>
              <select className="input" value={form.work_schedule} onChange={e => set('work_schedule', e.target.value)}>
                <option value="">Selecionar</option>
                <option>5x2</option><option>6x1</option><option>12x36</option><option>12x60</option><option>Plantão</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Valor Mensal (R$)</label>
              <input className="input" type="number" placeholder="0,00" value={form.monthly_amount} onChange={e => set('monthly_amount', e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 bg-orange-50 p-4 rounded-lg">
            <p className="col-span-2 text-xs font-semibold text-orange-700 uppercase tracking-wide">Detalhes da Consultoria</p>
            <div>
              <label className="label">Visitas/mês</label>
              <input className="input" type="number" min="1" placeholder="Ex: 4" value={form.visits_per_month} onChange={e => set('visits_per_month', e.target.value)} />
            </div>
            <div>
              <label className="label">Valor por visita (R$)</label>
              <input className="input" type="number" placeholder="0,00" value={form.visit_amount} onChange={e => set('visit_amount', e.target.value)} />
            </div>
            {form.visits_per_month && form.visit_amount && (
              <div className="col-span-2 text-sm font-medium text-orange-800">
                Total mensal: R$ {(Number(form.visits_per_month) * Number(form.visit_amount)).toFixed(2)}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {form.type === 'Padrão' && (
            <div>
              <label className="label">Template</label>
              <select className="input" value={form.template_id} onChange={e => set('template_id', e.target.value)}>
                <option value="">Selecionar...</option>
                {templates?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Data Início</label>
            <input className="input" type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
          </div>
          <div>
            <label className="label">Data Fim</label>
            <input className="input" type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer mt-6">
              <input type="checkbox" checked={form.signed} onChange={e => set('signed', e.target.checked)} className="rounded" />
              <span className="text-sm">Assinado</span>
            </label>
          </div>
          {form.signed && (
            <div>
              <label className="label">Data Assinatura</label>
              <input className="input" type="date" value={form.signed_at} onChange={e => set('signed_at', e.target.value)} />
            </div>
          )}
          <div className="col-span-2">
            <label className="label">Colaborador Responsável</label>
            <input className="input" value={form.employee_responsible} onChange={e => set('employee_responsible', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={form.requires_supervision} onChange={e => set('requires_supervision', e.target.checked)} className="rounded" />
            <span className="text-sm font-medium">Requer supervisão</span>
          </label>
          {form.requires_supervision && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Visitas por mês</label>
                <input className="input" type="number" value={form.supervision_visits_per_month} onChange={e => set('supervision_visits_per_month', e.target.value)} />
              </div>
              <div>
                <label className="label">Supervisor</label>
                <select className="input" value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
                  <option value="">Selecionar...</option>
                  {supervisors?.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="label">Observações</label>
          <textarea className="input" rows={3} value={form.observations} onChange={e => set('observations', e.target.value)} />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
