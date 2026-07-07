import { useState, useEffect, FormEvent, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { BRAZIL_STATES, DEFAULT_DOCUMENTS } from '../../lib/utils'
import { SignedImage } from '../../components/ui/SignedFile'
import toast from 'react-hot-toast'

type Tab = 'pessoal' | 'profissional' | 'bancario'

const EMPTY = {
  full_name: '', rg: '', cpf: '', birth_date: '',
  phone: '', whatsapp: '', email: '', emergency_phone: '',
  address_street: '', address_number: '', address_neighborhood: '', address_city: '', address_zip: '',
  crn_number: '', crn_region: '', role: '', admission_date: '',
  status: 'Ativo' as 'Ativo' | 'Inativo' | 'Ocioso',
  dismissal_date: '', dismissal_reason: '',
  bank_name: '', bank_agency: '', bank_account: '', bank_account_type: 'Corrente' as 'Corrente' | 'Poupança', pix: '',
  photo_url: '',
}

export default function EmployeeForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id
  const [tab, setTab] = useState<Tab>('pessoal')
  const [form, setForm] = useState(EMPTY)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: employee, isLoading: empLoading } = useQuery({
    queryKey: ['employee-edit', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  useEffect(() => {
    if (employee) {
      setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(employee).map(([k, v]) => [k, v == null ? (typeof EMPTY[k as keyof typeof EMPTY] === 'boolean' ? false : '') : v])) } as typeof EMPTY)
    }
  }, [employee])

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        if (payload.status === 'Inativo') {
          const { data: emp } = await supabase.from('employees').select('status').eq('id', id!).single()
          const { data: interest } = await supabase.from('vacancy_interests')
            .select('vacancy_id').eq('candidate_id', id!).eq('status', 'Contratado').limit(1).maybeSingle()
          if (emp?.status === 'Ativo' && interest?.vacancy_id) {
            const { data: vac } = await supabase.from('vacancies').select('hired_count').eq('id', interest.vacancy_id).single()
            if (vac) {
              await supabase.from('vacancies').update({
                hired_count: Math.max(0, (vac.hired_count || 1) - 1),
                status: 'Aberta',
              }).eq('id', interest.vacancy_id)
            }
          }
        }
        const { error } = await supabase.from('employees').update(payload).eq('id', id)
        if (error) throw error
        return id
      } else {
        const autoPin = String(Math.floor(100000 + Math.random() * 900000))
        const { data, error } = await supabase.from('employees').insert({ ...payload, portal_pin: autoPin }).select('id').single()
        if (error) throw error
        toast.success(`Colaborador criado! Senha do portal: ${autoPin}`, { duration: 8000 })
        return data.id
      }
    },
    onSuccess: (newId) => {
      if (isEdit) toast.success('Colaborador atualizado!')
      qc.invalidateQueries({ queryKey: ['employees'] })
      navigate(`/colaboradores/${newId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handlePhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Apenas imagens'); return }
    if (file.size > 5_000_000) { toast.error('Máx 5MB'); return }
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('fotos de funcionários').upload(path, file, { upsert: true })
    if (error) { toast.error('Erro no upload'); setUploading(false); return }
    set('photo_url', path) // guarda o caminho; a exibição usa URL assinada
    setUploading(false)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      full_name: form.full_name,
      rg: form.rg || null,
      cpf: form.cpf || null,
      birth_date: form.birth_date || null,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      emergency_phone: form.emergency_phone || null,
      address_street: form.address_street || null,
      address_number: form.address_number || null,
      address_neighborhood: form.address_neighborhood || null,
      address_city: form.address_city || null,
      address_zip: form.address_zip || null,
      photo_url: form.photo_url || null,
      crn_number: form.crn_number || null,
      crn_region: form.crn_region || null,
      role: form.role || null,
      admission_date: form.admission_date || null,
      status: form.status,
      dismissal_date: form.dismissal_date || null,
      dismissal_reason: form.dismissal_reason || null,
      bank_name: form.bank_name || null,
      bank_agency: form.bank_agency || null,
      bank_account: form.bank_account || null,
      bank_account_type: form.bank_account_type,
      pix: form.pix || null,
    })
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'pessoal', label: 'Dados Pessoais' },
    { key: 'profissional', label: 'Profissional' },
    { key: 'bancario', label: 'Bancário' },
  ]

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Colaborador' : 'Novo Colaborador'}</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isEdit && empLoading && (
        <div className="card p-10 text-center text-gray-400">
          <p className="text-sm">Carregando dados...</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className={isEdit && empLoading ? 'hidden' : ''}>
        {/* ── DADOS PESSOAIS ── */}
        {tab === 'pessoal' && (
          <div className="card p-6 space-y-5">
            {/* Foto */}
            <div className="flex items-center gap-4">
              <div
                className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer overflow-hidden border-2 border-dashed border-gray-300 hover:border-primary-400"
                onClick={() => fileRef.current?.click()}
              >
                <SignedImage value={form.photo_url} bucket="fotos de funcionários" alt="foto" className="w-full h-full object-cover"
                  fallback={<Camera size={24} className="text-gray-400" />} />
              </div>
              <div>
                <p className="text-sm font-medium">Foto 3x4</p>
                <p className="text-xs text-gray-400">PNG, JPG — máx 5MB</p>
                {uploading && <p className="text-xs text-primary-600">Enviando...</p>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handlePhoto(e.target.files[0])} />
            </div>

            {/* Identificação */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Identificação</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Nome Completo *</label>
                  <input className="input" required value={form.full_name} onChange={e => set('full_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">CPF <span className="text-orange-500 text-xs">(login do portal)</span></label>
                  <input className={`input ${!form.cpf ? 'border-orange-300 bg-orange-50' : ''}`} placeholder="000.000.000-00" value={form.cpf} onChange={e => set('cpf', e.target.value)} />
                  {!form.cpf && <p className="text-xs text-orange-500 mt-1">⚠️ Necessário para acesso ao portal</p>}
                </div>
                <div>
                  <label className="label">RG</label>
                  <input className="input" placeholder="00.000.000-0" value={form.rg} onChange={e => set('rg', e.target.value)} />
                </div>
                <div>
                  <label className="label">Data de Nascimento</label>
                  <input className="input" type="date" value={form.birth_date} onChange={e => set('birth_date', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Contato */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contato</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Telefone</label>
                  <input className="input" placeholder="(00) 0000-0000" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div>
                  <label className="label">WhatsApp</label>
                  <input className="input" placeholder="(00) 90000-0000" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="label">E-mail</label>
                  <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="label">Telefone de Emergência</label>
                  <input className="input" placeholder="Nome e telefone do contato de emergência" value={form.emergency_phone} onChange={e => set('emergency_phone', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Endereço */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Endereço</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Rua / Avenida</label>
                  <input className="input" placeholder="Ex: Rua das Flores" value={form.address_street} onChange={e => set('address_street', e.target.value)} />
                </div>
                <div>
                  <label className="label">Número</label>
                  <input className="input" placeholder="123" value={form.address_number} onChange={e => set('address_number', e.target.value)} />
                </div>
                <div>
                  <label className="label">CEP</label>
                  <input className="input" placeholder="00000-000" value={form.address_zip} onChange={e => set('address_zip', e.target.value)} />
                </div>
                <div>
                  <label className="label">Bairro</label>
                  <input className="input" value={form.address_neighborhood} onChange={e => set('address_neighborhood', e.target.value)} />
                </div>
                <div>
                  <label className="label">Cidade</label>
                  <input className="input" value={form.address_city} onChange={e => set('address_city', e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PROFISSIONAL ── */}
        {tab === 'profissional' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Número CRN</label><input className="input" value={form.crn_number} onChange={e => set('crn_number', e.target.value)} /></div>
              <div>
                <label className="label">Região CRN</label>
                <select className="input" value={form.crn_region} onChange={e => set('crn_region', e.target.value)}>
                  <option value="">Selecionar</option>
                  {BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="label">Cargo / Função</label><input className="input" placeholder="Ex: Nutricionista Clínica" value={form.role} onChange={e => set('role', e.target.value)} /></div>
              <div><label className="label">Data de Admissão</label><input className="input" type="date" value={form.admission_date} onChange={e => set('admission_date', e.target.value)} /></div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => set('status', e.target.value as 'Ativo' | 'Inativo' | 'Ocioso')}>
                  <option>Ativo</option>
                  <option>Inativo</option>
                  <option>Ocioso</option>
                </select>
              </div>
            </div>
            {form.status === 'Inativo' && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Informações de Saída</p>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">Data de Saída</label><input className="input" type="date" value={form.dismissal_date} onChange={e => set('dismissal_date', e.target.value)} /></div>
                  <div>
                    <label className="label">Motivo</label>
                    <select className="input" value={form.dismissal_reason} onChange={e => set('dismissal_reason', e.target.value)}>
                      <option value="">Selecionar</option>
                      <option>Pediu demissão</option>
                      <option>Fim de contrato</option>
                      <option>Decisão da empresa</option>
                      <option>Outro</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── BANCÁRIO ── */}
        {tab === 'bancario' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="label">Banco</label><input className="input" placeholder="Ex: Nubank, Itaú, Bradesco..." value={form.bank_name} onChange={e => set('bank_name', e.target.value)} /></div>
              <div><label className="label">Agência</label><input className="input" placeholder="0000-0" value={form.bank_agency} onChange={e => set('bank_agency', e.target.value)} /></div>
              <div><label className="label">Conta Corrente</label><input className="input" placeholder="00000-0" value={form.bank_account} onChange={e => set('bank_account', e.target.value)} /></div>
              <div>
                <label className="label">Tipo de Conta</label>
                <select className="input" value={form.bank_account_type} onChange={e => set('bank_account_type', e.target.value as 'Corrente' | 'Poupança')}>
                  <option>Corrente</option>
                  <option>Poupança</option>
                </select>
              </div>
              <div><label className="label">Chave PIX</label><input className="input" placeholder="CPF, e-mail, telefone ou aleatória" value={form.pix} onChange={e => set('pix', e.target.value)} /></div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-600">
              💡 Os dados bancários são usados para geração de relatórios de pagamento. Mantenha sempre atualizado.
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
