import { useState, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { BRAZIL_STATES, SP_REGIONS, TOOLS_OPTIONS, POSTGRAD_OPTIONS, SEGMENT_OPTIONS, UAN_OPTIONS, PIPELINE_STAGES, CONTRACT_TYPE_OPTIONS } from '../../lib/utils'
import MultiCheck from '../../components/ui/MultiCheck'
import toast from 'react-hot-toast'

type Tab = 'geral' | 'formacao' | 'ferramentas' | 'disponibilidade' | 'pipeline'

const EMPTY = {
  full_name: '', state: '', city: '', sp_region: '', whatsapp: '', email: '',
  crn_number: '', crn_region: '', requires_travel: false, requires_relocation: false, has_vehicle: false,
  formation: '', graduation_year: '', institution: '', postgrad_options: [] as string[],
  experience_area: '', experience_time: '', segments: [] as string[], uan_areas: [] as string[], max_meals_volume: '',
  tools: [] as string[], available_start: '', available_weekends: false, work_shift: '', work_hours: '',
  contract_types: [] as string[], pipeline_stage: 'Banco',
}

export default function CandidateForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id
  const [tab, setTab] = useState<Tab>('geral')
  const [form, setForm] = useState(EMPTY)
  const [dataLoaded, setDataLoaded] = useState(!isEdit)

  const { isLoading: loadingCandidate } = useQuery({
    queryKey: ['candidate', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidates').select('*').eq('id', id).single()
      if (error) throw error
      setForm({
        ...EMPTY,
        ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v == null ? (Array.isArray(EMPTY[k as keyof typeof EMPTY]) ? [] : typeof EMPTY[k as keyof typeof EMPTY] === 'boolean' ? false : '') : v]))
      } as typeof EMPTY)
      setDataLoaded(true)
      return data
    },
    enabled: isEdit,
  })

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        const { error } = await supabase.from('candidates').update(payload).eq('id', id)
        if (error) throw error
        return id
      } else {
        const { data, error } = await supabase.from('candidates').insert(payload).select('id').single()
        if (error) throw error
        return data.id
      }
    },
    onSuccess: (newId) => {
      toast.success(isEdit ? 'Candidato atualizado!' : 'Candidato criado!')
      qc.invalidateQueries({ queryKey: ['candidates'] })
      navigate(`/candidatos/${newId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    mutation.mutate({
      full_name: form.full_name, state: form.state || null, city: form.city || null,
      sp_region: form.sp_region || null, whatsapp: form.whatsapp || null, email: form.email || null,
      crn_number: form.crn_number || null, crn_region: form.crn_region || null,
      requires_travel: form.requires_travel, requires_relocation: form.requires_relocation, has_vehicle: form.has_vehicle,
      formation: form.formation || null, graduation_year: form.graduation_year ? Number(form.graduation_year) : null,
      institution: form.institution || null, postgrad_options: form.postgrad_options,
      experience_area: form.experience_area || null, experience_time: form.experience_time || null,
      segments: form.segments, uan_areas: form.uan_areas,
      max_meals_volume: form.max_meals_volume ? Number(form.max_meals_volume) : null,
      tools: form.tools, available_start: form.available_start || null,
      available_weekends: form.available_weekends, work_shift: form.work_shift || null,
      work_hours: form.work_hours || null, contract_types: form.contract_types, pipeline_stage: form.pipeline_stage,
    })
  }

  const TABS: Tab[] = ['geral', 'formacao', 'ferramentas', 'disponibilidade', 'pipeline']
  const TAB_LABELS: Record<Tab, string> = { geral: 'Dados Gerais', formacao: 'Formação', ferramentas: 'Ferramentas', disponibilidade: 'Disponibilidade', pipeline: 'Pipeline' }

  if (isEdit && loadingCandidate) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
          <h1 className="text-xl font-bold">Editar Candidato</h1>
        </div>
        <div className="card p-8 flex items-center justify-center gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          Carregando dados...
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Candidato' : 'Novo Candidato'}</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {tab === 'geral' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2"><label className="label">Nome *</label><input className="input" required value={form.full_name} onChange={e => set('full_name', e.target.value)} /></div>
              <div>
                <label className="label">Estado</label>
                <select className="input" value={form.state} onChange={e => set('state', e.target.value)}>
                  <option value="">Selecionar</option>{BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="label">Cidade</label><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></div>
              {form.state === 'SP' && (
                <div>
                  <label className="label">Região SP</label>
                  <select className="input" value={form.sp_region} onChange={e => set('sp_region', e.target.value)}>
                    <option value="">Selecionar</option>{SP_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              <div><label className="label">WhatsApp</label><input className="input" value={form.whatsapp} onChange={e => set('whatsapp', e.target.value)} /></div>
              <div><label className="label">E-mail</label><input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              <div><label className="label">CRN Nº</label><input className="input" value={form.crn_number} onChange={e => set('crn_number', e.target.value)} /></div>
              <div>
                <label className="label">CRN Região</label>
                <select className="input" value={form.crn_region} onChange={e => set('crn_region', e.target.value)}>
                  <option value="">Selecionar</option>{BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-4">
              {[{ k: 'requires_travel', l: 'Aceita viagens' }, { k: 'requires_relocation', l: 'Aceita mudança' }, { k: 'has_vehicle', l: 'Tem veículo' }].map(({ k, l }) => (
                <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form[k as keyof typeof form] as boolean} onChange={e => set(k, e.target.checked)} className="rounded" />
                  {l}
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'formacao' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Formação</label>
                <select className="input" value={form.formation} onChange={e => set('formation', e.target.value)}>
                  <option value="">Selecionar</option>
                  <option>Técnico em Nutrição</option><option>Nutricionista</option><option>Ambos</option>
                </select>
              </div>
              <div><label className="label">Ano de formação</label><input className="input" type="number" value={form.graduation_year} onChange={e => set('graduation_year', e.target.value)} /></div>
              <div className="col-span-2"><label className="label">Instituição</label><input className="input" value={form.institution} onChange={e => set('institution', e.target.value)} /></div>
              <div>
                <label className="label">Tempo de Experiência</label>
                <select className="input" value={form.experience_time} onChange={e => set('experience_time', e.target.value)}>
                  <option value="">Selecionar</option>
                  <option>Nenhuma</option><option>Até 1 ano</option><option>1-3 anos</option><option>3-5 anos</option><option>Mais de 5 anos</option>
                </select>
              </div>
              <div><label className="label">Volume Máx. Refeições</label><input className="input" type="number" value={form.max_meals_volume} onChange={e => set('max_meals_volume', e.target.value)} /></div>
            </div>
            <MultiCheck label="Pós-graduações" options={POSTGRAD_OPTIONS} value={form.postgrad_options} onChange={v => set('postgrad_options', v)} />
            <MultiCheck label="Segmentos" options={SEGMENT_OPTIONS} value={form.segments} onChange={v => set('segments', v)} />
            <MultiCheck label="Áreas UAN" options={UAN_OPTIONS} value={form.uan_areas} onChange={v => set('uan_areas', v)} />
          </div>
        )}

        {tab === 'ferramentas' && (
          <div className="card p-6">
            <MultiCheck label="Ferramentas" options={TOOLS_OPTIONS} value={form.tools} onChange={v => set('tools', v)} />
          </div>
        )}

        {tab === 'disponibilidade' && (
          <div className="card p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="label">Início Disponível</label><input className="input" type="date" value={form.available_start} onChange={e => set('available_start', e.target.value)} /></div>
              <div>
                <label className="label">Turno</label>
                <select className="input" value={form.work_shift} onChange={e => set('work_shift', e.target.value)}>
                  <option value="">Qualquer</option><option>Manhã</option><option>Tarde</option><option>Noite</option><option>Integral</option>
                </select>
              </div>
              <div><label className="label">Horário</label><input className="input" placeholder="Ex: 08h-18h" value={form.work_hours} onChange={e => set('work_hours', e.target.value)} /></div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer mt-6 text-sm">
                  <input type="checkbox" checked={form.available_weekends} onChange={e => set('available_weekends', e.target.checked)} className="rounded" />
                  Disponível fins de semana
                </label>
              </div>
            </div>
            <MultiCheck label="Tipo de Contrato Preferido" options={CONTRACT_TYPE_OPTIONS} value={form.contract_types} onChange={v => set('contract_types', v)} />
          </div>
        )}

        {tab === 'pipeline' && (
          <div className="card p-6">
            <label className="label">Estágio no Pipeline</label>
            <select className="input" value={form.pipeline_stage} onChange={e => set('pipeline_stage', e.target.value)}>
              {PIPELINE_STAGES.filter(s => !['Em Processo de Contratação', 'Contratado'].includes(s)).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button type="submit" className="btn-primary" disabled={mutation.isPending || loadingCandidate}>{mutation.isPending ? 'Salvando...' : loadingCandidate ? 'Carregando...' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
