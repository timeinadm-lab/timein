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
    visit_frequency: 'Semanal' as 'Semanal' | 'Quinzenal' | 'Mensal',
    weekly_hours: '',      // Consultoria: horas por visita
    visits_per_week: '',   // Consultoria: combinado de visitas (opcional — referência)
    pay_extra_visits: true, // Consultoria: visita além do combinado é paga?
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
      visit_frequency: (data.visit_frequency as 'Semanal' | 'Quinzenal' | 'Mensal') || 'Semanal',
      weekly_hours: data.weekly_hours ? String(data.weekly_hours) : '',
      visits_per_week: data.visits_per_week ? String(data.visits_per_week) : '',
      pay_extra_visits: data.pay_extra_visits !== false,
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
              linkUpdate.monthly_amount = avg > 0 ? Math.round(avg * 4 * 100) / 100 : null
              linkUpdate.visit_frequency = payload.visit_frequency ?? 'Semanal'
              linkUpdate.weekly_hours_quota = payload.weekly_hours ?? null
              linkUpdate.monthly_hours_quota = payload.monthly_hours ?? null
              linkUpdate.visits_per_week = payload.visits_per_week ?? null
            } else if (payload.salary_amount != null) {
              linkUpdate.monthly_amount = payload.salary_amount
              linkUpdate.cost_assistance = payload.cost_assistance ?? 0
            }
            await supabase.from('employee_client_links')
              .update(linkUpdate)
              .in('employee_id', empIds)
              .eq('client_id', payload.client_id)
          }
        }
      } else {
        const { error } = await supabase.from('vacancies').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Vaga atualizada! Escala e valores propagados para os colaboradores contratados por ela.' : 'Vaga criada!')
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

  const freqMultiplier = form.visit_frequency === 'Mensal' ? 1 : form.visit_frequency === 'Quinzenal' ? 2 : 4
  const freqLabel = form.visit_frequency === 'Mensal' ? '1 visita/mês' : form.visit_frequency === 'Quinzenal' ? '2 visitas/mês' : '4 visitas/mês'
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
      payment_day_1: form.payment_day_1 ? Number(form.payment_day_1) : null,
      payment_day_2: form.payment_day_2 ? Number(form.payment_day_2) : null,
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
      monthly_hours: isConsultoria && form.weekly_hours ? Number(form.weekly_hours) * freqMultiplier : null,
      weekly_hours: isConsultoria && form.weekly_hours ? Number(form.weekly_hours) : null,
      visits_per_week: isConsultoria && form.visits_per_week ? Number(form.visits_per_week) : null,
      pay_extra_visits: isConsultoria ? form.pay_extra_visits : true,
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
            <div className="grid grid-cols-2 gap-3 mt-1">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
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
              {!isConsultoria && (
                <div>
                  <label className="label">Salário mensal (R$)</label>
                  <input className="input" type="number" min={0} placeholder="0,00" value={form.salary_amount} onChange={e => set('salary_amount', e.target.value)} />
                </div>
              )}
              <div>
                <label className="label">Ajuda de custo (R$) <span className="text-gray-400 font-normal">— opcional</span></label>
                <input className="input" type="number" min={0} placeholder="0,00" value={form.cost_assistance} onChange={e => set('cost_assistance', e.target.value)} />
              </div>

              {/* Carga horária */}
              <div className="col-span-2 border-t pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Carga Horária</p>
                <div className="grid grid-cols-2 gap-3">
                  {!isConsultoria && (
                    <>
                      <div>
                        <label className="label">Escala de trabalho *</label>
                        <select className="input" value={form.work_schedule_type} onChange={e => set('work_schedule_type', e.target.value)}>
                          <option value="">Selecionar...</option>
                          <option value="5x2">5x2 — 5 dias trabalho, 2 folga</option>
                          <option value="6x1">6x1 — 6 dias trabalho, 1 folga</option>
                          <option value="12x36">12x36 — 12h trabalho / 36h descanso</option>
                          <option value="Plantão">Plantão</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Horas por dia</label>
                        <input className="input" type="number" min={1} max={24} placeholder="Ex: 8" value={form.daily_hours} onChange={e => set('daily_hours', e.target.value)} />
                      </div>

                      {/* 12x36: âncora da escala — dia sim, dia não a partir desta data */}
                      {form.work_schedule_type === '12x36' && (
                        <div className="col-span-2">
                          <label className="label">Primeiro dia de trabalho da escala 12x36 *</label>
                          <input className="input" type="date" value={form.schedule_anchor_date} onChange={e => set('schedule_anchor_date', e.target.value)} />
                          <p className="text-xs text-gray-400 mt-1">
                            A partir desta data a escala alterna: dia de trabalho, dia de folga. O sistema usa isso para saber os dias dela e cobrar o preenchimento da folha de ponto. Pode ser alterado depois em Editar Vaga.
                          </p>
                        </div>
                      )}

                      {/* Seletor de dias de folga — para 5x2 e 6x1 */}
                      {(form.work_schedule_type === '5x2' || form.work_schedule_type === '6x1') && (() => {
                        const maxOff = form.work_schedule_type === '5x2' ? 2 : 1
                        const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
                        const toggleDay = (d: number) => {
                          const current = form.days_off
                          if (current.includes(d)) {
                            set('days_off', current.filter(x => x !== d))
                          } else if (current.length < maxOff) {
                            set('days_off', [...current, d])
                          }
                        }
                        return (
                          <div className="col-span-2">
                            <label className="label">
                              Dia(s) de folga — escolha {maxOff === 1 ? '1 dia' : '2 dias'}
                              {form.work_schedule_type === '6x1' && <span className="text-gray-400 font-normal ml-1">— se a folga for rotativa, marque como rotativo</span>}
                            </label>
                            <div className="flex gap-2 flex-wrap mt-1">
                              {DAYS.map((name, idx) => {
                                const selected = form.days_off.includes(idx)
                                const disabled = !selected && form.days_off.length >= maxOff
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() => toggleDay(idx)}
                                    disabled={disabled}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                                      selected ? 'bg-primary-600 text-white border-primary-600' :
                                      disabled ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed' :
                                      'bg-white text-gray-700 border-gray-300 hover:border-primary-400'
                                    }`}
                                  >
                                    {name}
                                  </button>
                                )
                              })}
                              {form.work_schedule_type === '6x1' && (
                                <button
                                  type="button"
                                  onClick={() => set('days_off', [])}
                                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                                    form.days_off.length === 0 ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-600 border-amber-300 hover:border-amber-500'
                                  }`}
                                >
                                  Rotativo
                                </button>
                              )}
                            </div>
                            {form.days_off.length > 0 && (
                              <p className="text-xs text-blue-600 mt-1">
                                Folga: {form.days_off.map(d => ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][d]).join(' e ')} — o sistema não vai exigir presença nesses dias.
                              </p>
                            )}
                            {form.work_schedule_type === '6x1' && form.days_off.length === 0 && (
                              <p className="text-xs text-amber-600 mt-1">Folga rotativa — a colaboradora indica o dia de folga na folha de ponto.</p>
                            )}
                          </div>
                        )
                      })()}
                    </>
                  )}
                  {isConsultoria && (
                    <>
                      <div>
                        <label className="label">Frequência de visita *</label>
                        <select className="input" value={form.visit_frequency} onChange={e => set('visit_frequency', e.target.value)}>
                          <option value="Semanal">Semanal (4×/mês)</option>
                          <option value="Quinzenal">Quinzenal (2×/mês)</option>
                          <option value="Mensal">Mensal (1×/mês)</option>
                        </select>
                      </div>
                      <div>
                        <label className="label">Horas por visita *</label>
                        <input className="input" type="number" min={0.5} max={60} step="0.5" placeholder="Ex: 4" value={form.weekly_hours} onChange={e => set('weekly_hours', e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Horas no mês <span className="text-gray-400 font-normal">— automático</span></label>
                        <div className="input bg-gray-50 text-gray-600 flex items-center">{monthlyHoursCalc > 0 ? `${monthlyHoursCalc}h (${form.weekly_hours}h × ${freqLabel})` : '—'}</div>
                      </div>
                      <p className="col-span-2 text-xs text-blue-600">
                        Combinado: <strong>{monthlyHoursCalc > 0 ? `${monthlyHoursCalc}h/mês` : 'horas por visita × visitas/mês'}</strong>. Se passar disso em mais de 1h, o excedente vai pra <strong>sua aprovação</strong> — você decide se paga, caso a caso.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {/* Payment days — shown for all vacancy types */}
              <div className="col-span-2 border-t pt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Dia(s) de Pagamento</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">1º pagamento — dia do mês *</label>
                    <input className="input" type="number" min={1} max={31} placeholder="Ex: 8" value={form.payment_day_1} onChange={e => set('payment_day_1', e.target.value)} />
                  </div>
                  <div>
                    <label className="label">2º pagamento — dia do mês <span className="text-gray-400 font-normal">— opcional</span></label>
                    <input className="input" type="number" min={1} max={31} placeholder="Ex: 20" value={form.payment_day_2} onChange={e => set('payment_day_2', e.target.value)} />
                  </div>
                </div>
                {form.payment_day_1 && form.payment_day_2 && (
                  <p className="text-xs text-blue-600 mt-2">
                    Dois pagamentos: dia {form.payment_day_1} e dia {form.payment_day_2} — cada um equivale a metade do valor mensal.
                  </p>
                )}
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

            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid grid-cols-2 gap-4">
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
