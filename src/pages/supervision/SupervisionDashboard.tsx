import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import toast from 'react-hot-toast'

export default function SupervisionDashboard() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [visitForm, setVisitForm] = useState<{ contractId: string; date: string; supervisorId: string; obs: string } | null>(null)
  const monthStart = startOfMonth(new Date(month + '-01')).toISOString()
  const monthEnd = endOfMonth(new Date(month + '-01')).toISOString()

  const { data: contracts } = useQuery({
    queryKey: ['supervision-contracts'],
    queryFn: async () => {
      // Query clients that have supervision configured (visits_per_month > 0)
      const { data, error } = await supabase
        .from('clients')
        .select('id,name,supervision_visits_per_month,supervisor:user_profiles(full_name)')
        .gt('supervision_visits_per_month', 0)
        .order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: visits } = useQuery({
    queryKey: ['supervision-visits-month', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('supervision_visits')
        .select('client_id,contract_id')
        .gte('visit_date', monthStart.slice(0, 10))
        .lte('visit_date', monthEnd.slice(0, 10))
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
      if (!visitForm) return
      const { error } = await supabase.from('supervision_visits').insert({
        client_id: visitForm.contractId,
        visit_date: visitForm.date,
        supervisor_id: visitForm.supervisorId || null,
        observations: visitForm.obs || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Visita registrada!')
      qc.invalidateQueries({ queryKey: ['supervision-visits-month', month] })
      setVisitForm(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const visitCounts = visits?.reduce((acc, v) => {
    const key = v.client_id || v.contract_id
    if (key) acc[key] = (acc[key] || 0) + 1
    return acc
  }, {} as Record<string, number>) ?? {}

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Qualidade</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Supervisão</h1>
        </div>
        <input className="input w-36" type="month" value={month} onChange={e => setMonth(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">CLIENTE</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">SUPERVISOR</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">PREVISTAS</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">REALIZADAS</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">PENDENTES</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {contracts?.map(c => {
              const done = visitCounts[c.id] || 0
              const planned = c.supervision_visits_per_month || 0
              const pending = Math.max(0, planned - done)
              return (
                <tr key={c.id} className={pending > 0 ? 'bg-red-50' : ''}>
                  <td className="px-4 py-3 font-medium">{c.name || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{(c as { supervisor?: { full_name: string } }).supervisor?.full_name || '-'}</td>
                  <td className="px-4 py-3">{planned}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${done >= planned ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{done}</span>
                  </td>
                  <td className="px-4 py-3">
                    {pending > 0 ? <span className="badge bg-red-100 text-red-700">{pending}</span> : <span className="badge bg-green-100 text-green-700">0</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setVisitForm({ contractId: c.id, date: new Date().toISOString().slice(0, 10), supervisorId: '', obs: '' })}
                      className="btn-secondary text-xs flex items-center gap-1"
                    >
                      <Plus size={12} />Visita
                    </button>
                  </td>
                </tr>
              )
            })}
            {contracts?.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum cliente com supervisão configurada. Configure "Visitas/mês" no cadastro do cliente.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Visit modal */}
      {visitForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 space-y-4">
            <h3 className="font-semibold">Registrar Visita</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Data *</label><input className="input" type="date" value={visitForm.date} onChange={e => setVisitForm(p => p ? { ...p, date: e.target.value } : null)} /></div>
              <div>
                <label className="label">Supervisor</label>
                <select className="input" value={visitForm.supervisorId} onChange={e => setVisitForm(p => p ? { ...p, supervisorId: e.target.value } : null)}>
                  <option value="">Selecionar...</option>
                  {supervisors?.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Observação</label>
                <textarea className="input" rows={2} value={visitForm.obs} onChange={e => setVisitForm(p => p ? { ...p, obs: e.target.value } : null)} />
              </div>
            </div>
            <div className="flex gap-3">
              <button className="btn-primary flex-1" onClick={() => addVisit.mutate()} disabled={!visitForm.date || addVisit.isPending}>Salvar</button>
              <button className="btn-secondary" onClick={() => setVisitForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
