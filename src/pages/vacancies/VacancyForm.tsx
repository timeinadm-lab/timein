import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  BRAZIL_STATES, SP_REGIONS, TOOLS_OPTIONS,
  SEGMENT_OPTIONS, UAN_OPTIONS,
  MIN_EXPERIENCE_OPTIONS, SHIFT_OPTIONS, WORK_SCALE_OPTIONS,
  START_AVAILABILITY_OPTIONS,
} from '../../lib/utils'
import MultiCheck from '../../components/ui/MultiCheck'
import toast from 'react-hot-toast'

type VacancyUnit = { unit_id: string; unit_name: string; visit_rate: string }

export default function VacancyForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    title: '', state: '', city: '', sp_region: '',
    client_id: '',
    unit_id: '',           // Fixo: single unit
    vacancy_type: '' as '' | 'Fixo' | 'Consultoria',
    positions_count: '1',
    salary_amount: '',     // Fixo: monthly salary
    cost_assistance: '',   // Fixo: optional
    payment_day_1: '',
    payment_day_2: '',
    work_schedule_type: '' as '' | '5x2' | '6x1' | '12x36' | 'Plantão',
    daily_hours: '',
    schedule_anchor_date: '', // 12x36: primeiro dia de trabalho da escala (dia sim, dia não a partir dele)
    visit_frequency: 'Semanal' as 'Semanal' | 'Quinzenal' | 'Mensal' | 'Avulso',
    agenda_mode: 'colaborador' as 'colaborador' | 'gestor', // quem monta a agenda deste vínculo
    weekly_hours: '',      // Consultoria: horas por visita
    visits_per_week: '',   // Consultoria: combinado de visitas (opcional — referência)
    day_off_type: '' as '' | 'fixo' | 'rotativo',
    fixed_day_off: '' as '' | '0' | '1' | '2' | '3' | '4' | '5' | '6',
    days_off: [] as number[], // days of week that are rest days (0=Sun..6=Sat)
    deadline: '', opening_date: '',
    status: 'Aberta',
    formation: '',
    requires_crn: false,
    requires_vehicle: false,
    requires_travel: false,
    requires_relocation: false,
    min_experience: 'Qualquer',
    segments: [] as string[],
    uan_areas: [] as string[],
    tools: [] as string[],
    shift: '',
    work_scale: [] as string[],
    start_availability: '',
    weekend_availability: false,
    observations: '',
    whatsapp_message: '',
  })

  // Consultoria: multiple units with rates — source of truth for payment calc
  const [vacancyUnits, setVacancyUnits] = useState<VacancyUnit[]>([])

  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const { data: clientUnits } = useQuery({
    queryKey: ['client-units', form.client_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('client_units').select('id,name').eq('client_id', form.client_id).order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!form.client_id,
  })

  const { data: vacancyData } = useQuery({
    queryKey: ['vacancy', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  // Preenche o formulário a partir dos dados da vaga — inclusive quando vêm do cache
  // (o preenchimento não pode ficar dentro do queryFn: com staleTime ele não roda no cache-hit,
  //  e o formulário abria em branco ao clicar Editar logo após ver a vaga).
  const populated = useRef(false)
  useEffect(() => {
    if (!vacancyData || populated.current) return
    populated.current = true
    const data = vacancyData
    setForm({
      title: data.title || '', state: data.state || '', city: data.city || '',
      sp_region: data.sp_region || '', client_id: data.client_id || '',
      unit_id: data.unit_id || '',
      vacancy_type: data.vacancy_type || '',
      positions_count: String(data.positions_count || 1),
      salary_amount: data.salary_amount ? String(data.salary_amount) : '',
      cost_assistance: data.cost_assistance ? String(data.cost_assistance) : '',
      payment_day_1: data.payment_day_1 ? String(data.payment_day_1) : '',
      payment_day_2: data.payment_day_2 ? String(data.payment_day_2) : '',
      work_schedule_type: data.work_schedule_type || '',
      daily_hours: data.daily_hours ? String(data.daily_hours) : '',
      schedule_anchor_date: data.schedule_anchor_date || '',
      visit_frequency: (data.visit_frequency as 'Semanal' | 'Quinzenal' | 'Mensal' | 'Avulso') || 'Semanal',
      agenda_mode: (data.agenda_mode as 'colaborador' | 'gestor') || 'colaborador',
      weekly_hours: data.weekly_hours ? String(data.weekly_hours) : '',
      visits_per_week: data.visits_per_week ? String(data.visits_per_week) : '',
      day_off_type: data.day_off_type || '',
      fixed_day_off: data.fixed_day_off != null ? String(data.fixed_day_off) : '',
      days_off: data.days_off || [],
      deadline: data.deadline || '', opening_date: data.opening_date || '',
      status: data.status || 'Aberta',
      formation: data.formation || '',
      requires_crn: !!data.requires_crn,
      requires_vehicle: !!data.requires_vehicle,
      requires_travel: !!data.requires_travel,
      requires_relocation: !!data.requires_relocation,
      min_experience: data.min_experience || 'Qualquer',
      segments: data.segments || [],
      uan_areas: data.uan_areas || [],
      tools: data.tools || [],
      shift: data.shift || '',
      work_scale: data.work_scale || [],
      start_availability: data.start_availability || '',
      weekend_availability: !!data.weekend_availability,
      observations: data.observations || '',
      whatsapp_message: data.whatsapp_message || '',
    })
    if (data.vacancy_units) setVacancyUnits((data.vacancy_units as { unit_id: string; unit_name: string; visit_rate?: string | number }[]).map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: u.visit_rate != null ? String(u.visit_rate) : '' })))
  }, [vacancyData])

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        const { error } = await supabase.from('vacancies').update(payload).eq('id', id)
        if (error) throw error
        // Sistema interligado: editar a vaga propaga escala e valores para os vínculos
        // de quem já foi contratado por esta vaga (neste cliente)
        if (payload.client_id) {
          const { data: hired } = await supabase
            .from('vacancy_interests')
            .select('employee_id')
            .eq('vacancy_id', id)
            .eq('status', 'Contratado')
            .not('employee_id', 'is', null)
          const empIds = (hired || []).map(h => h.employee_id).filter(Boolean)
          if (empIds.length) {
            const isConsult = payload.vacancy_type === 'Consultoria'
            const linkUpdate: Record<string, unknown> = {
              work_schedule_type: payload.work_schedule_type ?? null,
              daily_hours: payload.daily_hours ?? null,
              days_off: (payload.days_off as number[] | undefined)?.length ? payload.days_off : null,
              schedule_anchor_date: payload.schedule_anchor_date ?? null,
            }
            if (isConsult) {
              const units = (payload.vacancy_units as VacancyUnit[] | null) || []
              const mapped = units.map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: Number(u.visit_rate) || 0 }))
              const avg = mapped.length ? mapped.reduce((s, u) => s + u.visit_rate, 0) / mapped.length : 0
              linkUpdate.link_units = mapped.length ? mapped : null
              // Estimativa pela frequência real. Estava fixo em × 4 (semanal),
              // então editar uma vaga Mensal devolvia o valor 4x inflado e
              // desfazia a correção já feita na ficha do colaborador.
              const freq = payload.visit_frequency as string | undefined
              const mult = freq === 'Avulso' ? 0 : freq === 'Mensal' ? 1 : freq === 'Quinzenal' ? 2 : 4
              linkUpdate.monthly_amount = avg > 0 && mult > 0 ? Math.round(avg * mult * 100) / 100 : null
              linkUpdate.visit_frequency = payload.visit_frequency ?? 'Semanal'
              linkUpdate.agenda_mode = payload.agenda_mode ?? 'colaborador'
              linkUpdate.weekly_hours_quota = payload.weekly_hours ?? null
              // Avulso: sem cota mensal fixa (dias vêm da agenda)
              linkUpdate.monthly_hours_quota = payload.visit_frequency === 'Avulso' ? null : (payload.monthly_hours ?? null)
              linkUpdate.visits_per_week = payload.visits_per_week ?? null
            } else if (payload.salary_amount != null) {
              linkUpdate.monthly_amount = payload.salary_amount
              linkUpdate.cost_assistance = payload.cost_assistance ?? 0
            }
            // Só os vínculos QUE NASCERAM DESTA VAGA. Antes casava por
            // employee_id + client_id, então editar a vaga sobrescrevia também
            // vínculo criado direto pela ficha — que pode ter valor e escala
            // totalmente diferentes e nada a ver com esta vaga.
            await supabase.from('employee_client_links')
              .update(linkUpdate)
              .eq('vacancy_id', id)
              .in('employee_id', empIds)
          }
        }
      } else {
        const { error } = await supabase.from('vacancies').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isEdit
        ? 'Vaga atualizada! Escala e valores foram aplicados só a quem foi contratado por esta vaga — vínculos criados pela ficha do colaborador não são alterados.'
        : 'Vaga criada!')
      qc.invalidateQueries({ queryKey: ['vacancies'] })
      navigate('/vagas')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const toggleUnit = (unit: { id: string; name: string }) => {
    setVacancyUnits(prev => {
      const exists = prev.find(u => u.unit_id === unit.id)
      if (exists) return prev.filter(u => u.unit_id !== unit.id)
      return [...prev, { unit_id: unit.id, unit_name: unit.name, visit_rate: '' }]
    })
  }

  // Avulso: sem cadência fixa — os dias vêm da agenda montada, então não há
  // estimativa mensal automática (0 = "varia conforme a agenda")
  const isAvulso = form.visit_frequency === 'Avulso'
  const freqMultiplier = isAvulso ? 0 : form.visit_frequency === 'Mensal' ? 1 : form.visit_frequency === 'Quinzenal' ? 2 : 4
  const freqLabel = isAvulso ? 'sem cadência fixa (RH monta os dias)' : form.visit_frequency === 'Mensal' ? '1 visita/mês' : form.visit_frequency === 'Quinzenal' ? '2 visitas/mês' : '4 visitas/mês'
  const monthlyHoursCalc = form.weekly_hours ? Number(form.weekly_hours) * freqMultiplier : 0
  const avgUnitRate = vacancyUnits.length ? vacancyUnits.reduce((s, u) => s + (Number(u.visit_rate) || 0), 0) / vacancyUnits.length : 0
  const monthlyEstimate = avgUnitRate * freqMultiplier

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!form.client_id) { toast.error('Selecione um cliente'); return }
    if (!form.vacancy_type) { toast.error('Selecione o tipo da vaga (Fixo ou Consultoria)'); return }

    const isConsultoria = form.vacancy_type === 'Consultoria'

    if (isConsultoria) {
      if (vacancyUnits.length === 0) { toast.error('Selecione pelo menos uma unidade para a consultoria'); return }
      const missing = vacancyUnits.find(u => !u.visit_rate)
      if (missing) { toast.error(`Informe o valor da vistoria para: ${missing.unit_name}`); return }
      if (!form.weekly_hours) { toast.error('Informe as horas por visita'); return }
    } else {
      if (!form.unit_id) { toast.error('Selecione a unidade do cliente'); return }
    }

    mutation.mutate({
      title: form.title, state: form.state, city: form.city,
      sp_region: form.sp_region || null,
      client_id: form.client_id,
      unit_id: isConsultoria ? null : (form.unit_id || null),
      vacancy_units: isConsultoria ? vacancyUnits : null,
      vacancy_type: form.vacancy_type,
      positions_count: Number(form.positions_count),
      salary_amount: !isConsultoria && form.salary_amount ? Number(form.salary_amount) : null,
      cost_assistance: form.cost_assistance ? Number(form.cost_assistance) : null,
      payment_day_1: isConsultoria ? 8 : (form.payment_day_1 ? Number(form.payment_day_1) : null),
      payment_day_2: isConsultoria ? 20 : (form.payment_day_2 ? Number(form.payment_day_2) : null),
      deadline: form.deadline || null, opening_date: form.opening_date || null,
      status: form.status,
      formation: form.formation || null,
      requires_crn: form.requires_crn,
      requires_vehicle: form.requires_vehicle,
      requires_travel: form.requires_travel,
      requires_relocation: form.requires_relocation,
      min_experience: form.min_experience !== 'Qualquer' ? form.min_experience : null,
      segments: form.segments,
      uan_areas: form.uan_areas,
      tools: form.tools,
      shift: isConsultoria ? null : (form.shift || null),
      work_scale: isConsultoria ? [] : form.work_scale,
      work_schedule_type: form.work_schedule_type || null,
      daily_hours: !isConsultoria && form.daily_hours ? Number(form.daily_hours) : null,
      schedule_anchor_date: !isConsultoria && form.work_schedule_type === '12x36' && form.schedule_anchor_date ? form.schedule_anchor_date : null,
      visit_frequency: isConsultoria ? (form.visit_frequency || 'Semanal') : null,
      agenda_mode: isConsultoria ? form.agenda_mode : 'colaborador',
      monthly_hours: isConsultoria && !isAvulso && form.weekly_hours ? Number(form.weekly_hours) * freqMultiplier : null,
      weekly_hours: isConsultoria && form.weekly_hours ? Number(form.weekly_hours) : null,
      visits_per_week: isConsultoria && form.visits_per_week ? Number(form.visits_per_week) : null,
      days_off: !isConsultoria ? form.days_off : [],
      day_off_type: form.work_schedule_type === '6x1' ? (form.day_off_type || null) : null,
      fixed_day_off: form.work_schedule_type === '6x1' && form.day_off_type === 'fixo' && form.fixed_day_off !== '' ? Number(form.fixed_day_off) : null,
      start_availability: form.start_availability || null,
      weekend_availability: isConsultoria ? null : (form.weekend_availability || null),
      observations: form.observations || null,
      whatsapp_message: form.whatsapp_message || null,
    })
  }

  const isConsultoria = form.vacancy_type === 'Consultoria'
  const clientSelected = !!form.client_id
  const typeSelected = !!form.vacancy_type
  const unitsReady = isConsultoria ? vacancyUnits.length > 0 : !!form.unit_id

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Vaga' : 'Nova Vaga'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── PASSO 1: Cliente + Tipo ── */}
        <div className="card p-5 space-y-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">1. Cliente e Tipo da Vaga</p>

          <div>
            <label className="label">Cliente *</label>
            <select
              className="input"
              value={form.client_id}
              onChange={e => {
                setForm(p => ({ ...p, client_id: e.target.value, unit_id: '' }))
                setVacancyUnits([])
              }}
            >
              <option value="">Selecionar cliente...</option>
              {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Tipo da Vaga *</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              {(['Fixo', 'Consultoria'] as const).map(tipo => (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => { set('vacancy_type', tipo); set('unit_id', ''); setVacancyUnits([]) }}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    form.vacancy_type === tipo
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-sm">{tipo}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {tipo === 'Fixo'
                      ? 'Nutricionista com horário e escala definidos'
                      : 'Visitas em uma ou mais unidades — agenda própria'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── PASSO 2: Unidades ── só aparece após cliente + tipo */}
        {clientSelected && typeSelected && (
          <div className="card p-5 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              2. {isConsultoria ? 'Unidades de Atuação e Valores' : 'Unidade de Trabalho'}
            </p>

            {(!clientUnits || clientUnits.length === 0) ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                Este cliente não tem unidades cadastradas.{' '}
                <a href="/clientes" className="underline font-medium">Adicionar unidades no cliente</a>
              </div>
            ) : isConsultoria ? (
              // Consultoria: cada unidade tem o valor da vistoria dela. As horas (semana/mês) valem para a vaga toda.
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Selecione as unidades e o valor da vistoria de cada uma. As horas são definidas abaixo, para a vaga toda — a nutricionista distribui entre as unidades.</p>
                <div className="space-y-2">
                  {clientUnits.map(unit => {
                    const selected = vacancyUnits.find(u => u.unit_id === unit.id)
                    return (
                      <div key={unit.id} className={`border rounded-lg transition-all ${selected ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}>
                        <div className="flex items-center gap-3 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={!!selected}
                            onChange={() => toggleUnit(unit)}
                            className="rounded"
                          />
                          <span className="flex-1 text-sm font-medium text-gray-800">{unit.name}</span>
                          {selected && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-500">Vistoria R$</span>
                              <input
                                type="number"
                                className="input text-sm w-28"
                                placeholder="0,00"
                                value={selected.visit_rate}
                                onChange={e => setVacancyUnits(prev => prev.map(u => u.unit_id === unit.id ? { ...u, visit_rate: e.target.value } : u))}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {vacancyUnits.length > 0 && avgUnitRate > 0 && (
                  <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700 space-y-1">
                    <div className="flex items-center justify-between">
                      <span>Semana cheia (média das unidades)</span>
                      <span className="font-medium">R$ {avgUnitRate.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between font-semibold">
                      <span>Estimativa mensal (× 4 semanas)</span>
                      <span>R$ {monthlyEstimate.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-gray-400 font-normal">O valor real é pago pelas horas registradas na folha de ponto.</p>
                  </div>
                )}
              </div>
            ) : (
              // Fixo: single unit
              <div>
                <label className="label">Unidade onde vai trabalhar *</label>
                <select
                  className="input"
                  value={form.unit_id}
                  onChange={e => set('unit_id', e.target.value)}
                >
                  <option value="">Selecionar unidade...</option>
                  {clientUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Restante do form só aparece depois de cliente + tipo + unidades */}
        {clientSelected && typeSelected && unitsReady && (<>

          {/* ── DADOS DA VAGA ── */}
          <div className="card p-5 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">3. Dados da Vaga</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-full">
                <label className="label">Título *</label>
                <input className="input" required value={form.title} onChange={e => set('title', e.target.value)}
                  placeholder={isConsultoria ? 'Ex: Nutricionista Consultoria – Santa Casa' : 'Ex: Nutricionista UAN – SP'} />
              </div>
              <div>
                <label className="label">Estado *</label>
                <select className="input" required value={form.state} onChange={e => set('state', e.target.value)}>
                  <option value="">Selecionar</option>
                  {BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="label">Cidade *</label><input className="input" required value={form.city} onChange={e => set('city', e.target.value)} /></div>
              {form.state === 'SP' && (
                <div>
                  <label className="label">Região SP</label>
                  <select className="input" value={form.sp_region} onChange={e => set('sp_region', e.target.value)}>
                    <option value="">Selecionar</option>
                    {SP_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              <div><label className="label">Nº Posições</label><input className="input" type="number" min={1} value={form.positions_count} onChange={e => set('positions_count', e.target.value)} /></div>
              {/* Salário, escala, unidades/valores, frequência, agenda e dias de
                  pagamento saíram daqui. Eram pedidos três vezes — nesta tela, no
                  modal de contratar e no "+ Vincular" da ficha — e as três podiam
                  discordar sobre quanto alguém ganha. Agora só o VÍNCULO define
                  isso, no momento em que a pessoa entra no cliente. */}
              <div className="col-span-full rounded-xl bg-ink-50 px-3.5 py-2.5">
                <p className="text-xs text-ink-500 leading-relaxed">
                  <strong>Salário, escala e valores não ficam na vaga.</strong> A vaga serve para
                  divulgar e encontrar gente. O combinado de trabalho e pagamento é definido no
                  <strong> vínculo</strong>, ao colocar a pessoa no cliente — assim existe um lugar só
                  com a verdade sobre quanto cada um recebe.
                </p>
              </div>

              <div><label className="label">Prazo</label><input className="input" type="date" value={form.deadline} onChange={e => set('deadline', e.target.value)} /></div>
              <div><label className="label">Abertura</label><input className="input" type="date" value={form.opening_date} onChange={e => set('opening_date', e.target.value)} /></div>
              <div>
                <label className="label">Status</label>
                <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                  <option>Aberta</option><option>Pausada</option><option>Fechada</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── PERFIL DO CANDIDATO ── */}
          <div className="card p-5 space-y-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">4. Perfil Exigido</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Formação</label>
                <select className="input" value={form.formation} onChange={e => set('formation', e.target.value)}>
                  <option value="">Qualquer</option>
                  <option>Técnico em Nutrição</option>
                  <option>Nutricionista</option>
                  <option>Ambos</option>
                </select>
              </div>
              <div>
                <label className="label">Experiência mínima</label>
                <select className="input" value={form.min_experience} onChange={e => set('min_experience', e.target.value)}>
                  {MIN_EXPERIENCE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {([
                { k: 'requires_crn', label: 'Exige CRN ativo' },
                { k: 'requires_vehicle', label: 'Exige veículo próprio' },
                { k: 'requires_travel', label: 'Exige disponibilidade p/ viagens' },
                { k: 'requires_relocation', label: 'Exige disponibilidade p/ mudança' },
                ...(!isConsultoria ? [{ k: 'weekend_availability', label: 'Exige disponibilidade fins de semana' }] : []),
              ] as { k: string; label: string }[]).map(({ k, label }) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form[k as keyof typeof form] as boolean} onChange={e => set(k, e.target.checked)} className="rounded" />
                  {label}
                </label>
              ))}
            </div>

            <MultiCheck label="Segmentos onde já atuou" options={SEGMENT_OPTIONS} value={form.segments} onChange={v => set('segments', v)} />
            <MultiCheck label="Áreas dentro de UAN" options={UAN_OPTIONS} value={form.uan_areas} onChange={v => set('uan_areas', v)} />
          </div>

          {/* ── DISPONIBILIDADE ── */}
          {!isConsultoria ? (
            <div className="card p-5 space-y-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">5. Disponibilidade</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Turno</label>
                  <select className="input" value={form.shift} onChange={e => set('shift', e.target.value)}>
                    <option value="">Qualquer</option>
                    {SHIFT_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Disponibilidade de início</label>
                  <select className="input" value={form.start_availability} onChange={e => set('start_availability', e.target.value)}>
                    <option value="">Qualquer</option>
                    {START_AVAILABILITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              <MultiCheck label="Escala de trabalho aceita" options={WORK_SCALE_OPTIONS} value={form.work_scale} onChange={v => set('work_scale', v)} />
            </div>
          ) : (
            <div className="card p-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">5. Disponibilidade</p>
              <p className="text-sm text-gray-500 mt-2 italic">Consultoria — a nutricionista define os próprios horários. Turno e escala não se aplicam.</p>
              <div className="mt-3">
                <label className="label">Disponibilidade de início</label>
                <select className="input" value={form.start_availability} onChange={e => set('start_availability', e.target.value)}>
                  <option value="">Qualquer</option>
                  {START_AVAILABILITY_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* ── FERRAMENTAS ── */}
          <div className="card p-5">
            <MultiCheck label="Ferramentas / rotinas exigidas" options={TOOLS_OPTIONS} value={form.tools} onChange={v => set('tools', v)} />
          </div>

          {/* ── OBSERVAÇÕES ── */}
          <div className="card p-5 space-y-4">
            <div><label className="label">Observações internas</label><textarea className="input" rows={3} value={form.observations} onChange={e => set('observations', e.target.value)} /></div>
            <div>
              <label className="label">Mensagem WhatsApp (use [NOME])</label>
              <textarea className="input" rows={3} value={form.whatsapp_message} onChange={e => set('whatsapp_message', e.target.value)} placeholder="Olá [NOME], temos uma oportunidade para você..." />
            </div>
          </div>

          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
          </div>

        </>)}
      </form>
    </div>
  )
}
