import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { SkeletonDetail } from '../../components/ui/Skeleton'
import toast from 'react-hot-toast'

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showVisitForm, setShowVisitForm] = useState(false)
  const [visit, setVisit] = useState({ visit_date: '', supervisor_id: '', supervisor_name: '', observations: '' })

  const { data: contract } = useQuery({
    queryKey: ['contract', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('*,supervisor:user_profiles(full_name)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const { data: visits } = useQuery({
    queryKey: ['supervision-visits', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('supervision_visits').select('*,supervisor:user_profiles(full_name)').eq('contract_id', id).order('visit_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: supervisors } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const addVisit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('supervision_visits').insert({
        contract_id: id,
        visit_date: visit.visit_date,
        supervisor_id: visit.supervisor_id || null,
        supervisor_name: visit.supervisor_name || null,
        observations: visit.observations || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Visita registrada!')
      qc.invalidateQueries({ queryKey: ['supervision-visits', id] })
      setShowVisitForm(false)
      setVisit({ visit_date: '', supervisor_id: '', supervisor_name: '', observations: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!contract) return <SkeletonDetail />

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold flex-1">{contract.client_name || 'Contrato'}</h1>
        <button onClick={() => navigate(`/contratos/${id}/editar`)} className="btn-secondary flex items-center gap-2"><Edit size={14} />Editar</button>
      </div>

      <div className="card p-5 grid grid-cols-2 gap-4">
        <div><p className="text-xs text-gray-400">Tipo</p><p className="text-sm">{contract.type}</p></div>
        <div><p className="text-xs text-gray-400">Início</p><p className="text-sm">{formatDate(contract.start_date)}</p></div>
        <div><p className="text-xs text-gray-400">Fim</p><p className="text-sm">{formatDate(contract.end_date)}</p></div>
        <div><p className="text-xs text-gray-400">Assinatura</p>
          <span className={`badge ${contract.signed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {contract.signed ? `Assinado em ${formatDate(contract.signed_at)}` : 'Pendente'}
          </span>
        </div>
        <div><p className="text-xs text-gray-400">Responsável</p><p className="text-sm">{contract.employee_responsible || '-'}</p></div>
        <div><p className="text-xs text-gray-400">Supervisor</p><p className="text-sm">{(contract as { supervisor?: { full_name: string } }).supervisor?.full_name || '-'}</p></div>
        {contract.observations && <div className="col-span-2"><p className="text-xs text-gray-400">Observações</p><p className="text-sm">{contract.observations}</p></div>}
      </div>

      {/* Visits */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium">Visitas de Supervisão ({visits?.length || 0}/{contract.supervision_visits_per_month || 0} no mês)</h3>
          <button onClick={() => setShowVisitForm(true)} className="btn-secondary text-xs flex items-center gap-1"><Plus size={12} />Registrar Visita</button>
        </div>
        {showVisitForm && (
          <div className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Data *</label>
                <input className="input" type="date" value={visit.visit_date} onChange={e => setVisit(p => ({ ...p, visit_date: e.target.value }))} required />
              </div>
              <div>
                <label className="label">Supervisor</label>
                <select className="input" value={visit.supervisor_id} onChange={e => setVisit(p => ({ ...p, supervisor_id: e.target.value }))}>
                  <option value="">Selecionar ou digitar abaixo</option>
                  {supervisors?.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Supervisor (texto livre)</label>
                <input className="input" placeholder="Nome do supervisor" value={visit.supervisor_name} onChange={e => setVisit(p => ({ ...p, supervisor_name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Observação</label>
                <input className="input" value={visit.observations} onChange={e => setVisit(p => ({ ...p, observations: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary text-sm" onClick={() => addVisit.mutate()} disabled={!visit.visit_date}>Salvar</button>
              <button className="btn-secondary text-sm" onClick={() => setShowVisitForm(false)}>Cancelar</button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {visits?.map(v => (
            <div key={v.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
              <div>
                <p className="text-sm font-medium">{formatDate(v.visit_date)}</p>
                <p className="text-xs text-gray-500">{(v as { supervisor?: { full_name: string } }).supervisor?.full_name || v.supervisor_name || 'Sem supervisor'}</p>
                {v.observations && <p className="text-xs text-gray-400 mt-0.5">{v.observations}</p>}
              </div>
            </div>
          ))}
          {visits?.length === 0 && <p className="text-sm text-gray-400">Nenhuma visita registrada</p>}
        </div>
      </div>
    </div>
  )
}
