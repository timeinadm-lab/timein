import { useState, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function ClientForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    name: '', cnpj: '', address: '',
    contact_name: '', contact_phone: '', contact_email: '',
    contract_start: '', contract_end: '',
    supervisor_id: '', requires_supervision: false,
    supervision_visits_per_month: '', observations: '',
  })

  // Units: just names — visit rates are defined per vacancy, not per unit
  const [units, setUnits] = useState<string[]>([])
  const [unitInput, setUnitInput] = useState('')

  const { data: supervisors } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name,role').order('full_name')
      if (error) throw error
      return data || []
    },
  })

  // Load existing data when editing
  useQuery({
    queryKey: ['client-edit', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).single()
      if (error) throw error
      setForm({
        name: data.name || '',
        cnpj: data.cnpj || '',
        address: data.address || '',
        contact_name: data.contact_name || '',
        contact_phone: data.contact_phone || '',
        contact_email: data.contact_email || '',
        contract_start: data.contract_start || '',
        contract_end: data.contract_end || '__indeterminate__',
        supervisor_id: data.supervisor_id || '',
        requires_supervision: !!data.requires_supervision,
        supervision_visits_per_month: data.supervision_visits_per_month != null ? String(data.supervision_visits_per_month) : '',
        observations: data.observations || '',
      })

      // Load existing units
      const { data: existingUnits } = await supabase.from('client_units').select('name').eq('client_id', id).order('name')
      if (existingUnits?.length) {
        setUnits(existingUnits.map(u => u.name))
      }

      return data
    },
    enabled: isEdit,
  })

  const addUnit = () => {
    if (!unitInput.trim()) return
    setUnits(prev => [...prev, unitInput.trim()])
    setUnitInput('')
  }

  const removeUnit = (i: number) => setUnits(prev => prev.filter((_, j) => j !== i))

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        cnpj: form.cnpj || null,
        address: form.address || null,
        contact_name: form.contact_name || null,
        contact_phone: form.contact_phone || null,
        contact_email: form.contact_email || null,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end && form.contract_end !== '__indeterminate__' ? form.contract_end : null,
        supervisor_id: form.supervisor_id || null,
        requires_supervision: form.requires_supervision,
        supervision_visits_per_month: form.supervision_visits_per_month ? Number(form.supervision_visits_per_month) : null,
        observations: form.observations || null,
      }

      let clientId = id
      if (isEdit) {
        const { error } = await supabase.from('clients').update(payload).eq('id', id)
        if (error) throw error
        // Replace units: delete all then re-insert
        await supabase.from('client_units').delete().eq('client_id', id)
      } else {
        const { data, error } = await supabase.from('clients').insert(payload).select('id').single()
        if (error) throw error
        clientId = data.id
      }

      if (units.length > 0) {
        const { error } = await supabase.from('client_units').insert(
          units.map(name => ({ client_id: clientId, name }))
        )
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Cliente atualizado!' : 'Cliente criado!')
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client-units'] })
      navigate('/clientes')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Cliente' : 'Novo Cliente'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Dados da Empresa */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Dados da Empresa</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-full">
              <label className="label">Nome *</label>
              <input className="input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Hospital Santa Casa" />
            </div>
            <div>
              <label className="label">CNPJ</label>
              <input className="input" value={form.cnpj} onChange={e => set('cnpj', e.target.value)} placeholder="00.000.000/0001-00" />
            </div>
            <div className="col-span-full">
              <label className="label">Endereço</label>
              <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Unidades — opcional na criação, pode adicionar depois */}
        <div className="card p-5 space-y-3">
          <div>
            <h3 className="font-semibold text-gray-900">Unidades</h3>
            <p className="text-xs text-gray-400 mt-0.5">Locais onde o cliente opera. Pode adicionar depois — mas é necessário ter ao menos uma unidade para abrir vagas.</p>
          </div>

          {units.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {units.map((name, i) => (
                <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 border border-primary-200 rounded-full text-sm text-primary-800 font-medium">
                  <span>{name}</span>
                  <button type="button" onClick={() => removeUnit(i)} className="text-primary-400 hover:text-red-500">
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Ex: UAN Central, Refeitório Norte..."
              value={unitInput}
              onChange={e => setUnitInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addUnit())}
            />
            <button
              type="button"
              className="btn-primary flex items-center gap-1 whitespace-nowrap"
              onClick={addUnit}
              disabled={!unitInput.trim()}
            >
              <Plus size={16} /> Adicionar
            </button>
          </div>

        </div>

        {/* Contato */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Contato</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Nome do Contato</label>
              <input className="input" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Telefone</label>
              <input className="input" value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} />
            </div>
            <div className="col-span-full">
              <label className="label">E-mail</label>
              <input className="input" type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Contrato */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Contrato</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Data Início</label>
              <input className="input" type="date" value={form.contract_start} onChange={e => set('contract_start', e.target.value)} />
            </div>
            {form.contract_end !== '__indeterminate__' && (
              <div>
                <label className="label">Data Fim</label>
                <input className="input" type="date" value={form.contract_end} onChange={e => set('contract_end', e.target.value)} />
              </div>
            )}
            <div className="col-span-full">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={form.contract_end === '__indeterminate__'}
                  onChange={e => set('contract_end', e.target.checked ? '__indeterminate__' : '')}
                />
                <span className="text-sm">Contrato por tempo indeterminado</span>
              </label>
              <p className="text-xs text-gray-400 mt-0.5 ml-6">Sem data de vencimento — pode ser rescindido a qualquer momento.</p>
            </div>
            {form.contract_start && form.contract_end && form.contract_end !== '__indeterminate__' && (() => {
              const months = Math.round((new Date(form.contract_end).getTime() - new Date(form.contract_start).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
              return months > 0 ? (
                <div className="col-span-full bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700">
                  Duração: <strong>{months} meses</strong>
                </div>
              ) : null
            })()}
          </div>
        </div>

        {/* Supervisão */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-gray-900">Supervisão</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.requires_supervision} onChange={e => set('requires_supervision', e.target.checked)} className="rounded" />
            <span className="text-sm">Este cliente requer supervisão periódica</span>
          </label>
          {form.requires_supervision && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Visitas de supervisão/mês</label>
                <input className="input" type="number" value={form.supervision_visits_per_month} onChange={e => set('supervision_visits_per_month', e.target.value)} />
              </div>
              <div>
                <label className="label">Supervisor responsável</label>
                <select className="input" value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
                  <option value="">Selecionar...</option>
                  {supervisors?.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Observações */}
        <div className="card p-5">
          <label className="label">Observações</label>
          <textarea className="input" rows={3} value={form.observations} onChange={e => set('observations', e.target.value)} />
        </div>

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando...' : isEdit ? 'Salvar Alterações' : 'Criar Cliente'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
