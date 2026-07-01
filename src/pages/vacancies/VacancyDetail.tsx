import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Edit, MessageCircle, ChevronDown, ChevronUp, FileText, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatWhatsApp, BRAZIL_STATES, DEFAULT_DOCUMENTS } from '../../lib/utils'
import { getCityRegion } from '../../lib/geoRegions'
import { SignedLink } from '../../components/ui/SignedFile'
import toast from 'react-hot-toast'

type InterestStatus = 'Interessado' | 'Em contrato' | 'Contratado'

type UnitEntry = { location_id: string; name: string; visits: number }

type HireDetails = {
  serviceType: 'Fixo' | 'Consultoria'
  workShift: string
  workSchedule: string
  monthlyAmount: string
  costAssistance: string
  visitsPerMonth: string
  visitAmount: string
  visitFrequency: 'Semanal' | 'Quinzenal' | 'Mensal'
  startDate: string
  contractEndDate: string
  selectedUnits: UnitEntry[]
}

const EMPTY_HIRE: HireDetails = {
  serviceType: 'Fixo', workShift: '', workSchedule: '',
  monthlyAmount: '', costAssistance: '', visitsPerMonth: '', visitAmount: '',
  visitFrequency: 'Semanal', startDate: '', contractEndDate: '',
  selectedUnits: [],
}

const EMPTY_EMP = {
  cpf: '', rg: '', birth_date: '',
  phone: '', emergency_phone: '',
  address_street: '', address_number: '', address_neighborhood: '', address_city: '', address_zip: '',
  admission_date: new Date().toISOString().slice(0,10),
  bank_name: '', bank_agency: '', bank_account: '', pix: '',
}

export default function VacancyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'info' | 'interessados' | 'match' | 'colaboradores' | 'documentos'>('info')
  const [showExtendModal, setShowExtendModal] = useState(false)
  const [extendDate, setExtendDate] = useState('')
  const [docForm, setDocForm] = useState({ topic: '', name: '' })
  const [docFile, setDocFile] = useState<File | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [matchSearch, setMatchSearch] = useState('')
  const [matchFilters, setMatchFilters] = useState({ state: '', formation: '', experience: '' })
  const [showMatchFilters, setShowMatchFilters] = useState(false)
  const [onlyCompatible, setOnlyCompatible] = useState(false)

  // Step 1: deadline modal — shown when clicking "Contratar"
  const [deadlineModal, setDeadlineModal] = useState<{ interestId: string; candidateId: string } | null>(null)
  const [deadlineHours, setDeadlineHours] = useState<24 | 48 | 72>(48)
  const [hireDetails, setHireDetails] = useState<HireDetails>(EMPTY_HIRE)

  // Step 2: contract template view
  const [contractModal, setContractModal] = useState<{ interest: Record<string, unknown>; candidate: Record<string, unknown> } | null>(null)

  // Step 3: create employee after signed
  const [createEmpModal, setCreateEmpModal] = useState<{ interestId: string; candidateId: string } | null>(null)
  const [empForm, setEmpForm] = useState(EMPTY_EMP)

  const { data: vacancy } = useQuery({
    queryKey: ['vacancy', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies').select('*,client:clients(id,name)').eq('id', id).single()
      if (error) throw error
      return data
    },
  })

  const { data: clientLocations } = useQuery({
    queryKey: ['client-units', vacancy?.client_id],
    queryFn: async () => {
      if (!vacancy?.client_id) return []
      const { data, error } = await supabase.from('client_units').select('id,name,visit_rate').eq('client_id', vacancy.client_id).order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!vacancy?.client_id,
  })

  const { data: interests } = useQuery({
    queryKey: ['vacancy-interests', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancy_interests')
        .select('*,candidate:candidates(id,full_name,city,state,whatsapp,formation,experience_time,crn_number)')
        .eq('vacancy_id', id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Ao abrir o Match, os filtros já vêm com o que a vaga exige (estado, formação).
  // Aplica uma vez por visita à aba — não sobrescreve se o usuário mexer depois.
  const matchFiltersApplied = useRef(false)
  useEffect(() => {
    if (tab !== 'match') { matchFiltersApplied.current = false; return }
    if (!vacancy || matchFiltersApplied.current) return
    matchFiltersApplied.current = true
    const vacForm = (vacancy as { formation?: string }).formation
    const allowedForm = ['Técnico em Nutrição', 'Nutricionista', 'Ambos']
    setMatchFilters({
      state: (vacancy as { state?: string }).state || '',
      formation: vacForm && allowedForm.includes(vacForm) ? vacForm : '',
      experience: (vacancy as { min_experience?: string }).min_experience || '',
    })
    setShowMatchFilters(true)
  }, [tab, vacancy])

  const { data: allCandidates } = useQuery({
    queryKey: ['candidates-match', matchSearch],
    queryFn: async () => {
      // Inclui contratados (podem preencher outra vaga); só esconde inativos.
      // Pagina pra carregar TODOS — sem isso o Supabase corta em ~1000 e some com metade da base.
      const all: Record<string, unknown>[] = []
      const pageSize = 1000
      let from = 0
      while (true) {
        let q = supabase.from('candidates').select('*').neq('pipeline_stage', 'Inativo')
        if (matchSearch) q = q.ilike('full_name', `%${matchSearch}%`)
        const { data, error } = await q.range(from, from + pageSize - 1)
        if (error) throw error
        if (!data?.length) break
        all.push(...data)
        if (data.length < pageSize) break
        from += pageSize
      }
      return all
    },
    enabled: tab === 'match',
  })

  // Mark as "Em contrato" with deadline — does NOT create employee yet
  const startContractProcess = useMutation({
    mutationFn: async ({ interestId, candidateId }: { interestId: string; candidateId: string }) => {
      const deadline = new Date()
      deadline.setHours(deadline.getHours() + deadlineHours)

      // Store hireDetails as JSON in notes field via contracts table (pending, unsigned)
      const client = (vacancy as { client?: { id: string; name: string } })?.client
      await supabase.from('contracts').insert({
        client_id: vacancy?.client_id || null,
        client_name: client?.name || '',
        employee_id: null,
        start_date: hireDetails.startDate || new Date().toISOString().slice(0, 10),
        end_date: hireDetails.contractEndDate && hireDetails.contractEndDate !== '__indeterminate__' ? hireDetails.contractEndDate : null,
        type: 'Manual',
        signed: false,
        employee_responsible: hireDetails.serviceType,
        observations: JSON.stringify({
          candidateId,
          interestId,
          serviceType: hireDetails.serviceType,
          workShift: hireDetails.workShift,
          workSchedule: hireDetails.workSchedule,
          startDate: hireDetails.startDate,
          contractEndDate: hireDetails.contractEndDate,
        }),
        supervision_visits_per_month: null,
      })

      const { error } = await supabase.from('vacancy_interests')
        .update({ status: 'Em contrato', deadline: deadline.toISOString() })
        .eq('id', interestId)
      if (error) throw error
      await supabase.from('candidates').update({ pipeline_stage: 'Em Processo de Contratação' }).eq('id', candidateId)
    },
    onSuccess: () => {
      toast.success('Processo de contratação iniciado! Prazo: ' + deadlineHours + 'h')
      qc.invalidateQueries({ queryKey: ['vacancy-interests', id] })
      setDeadlineModal(null)
      setHireDetails(EMPTY_HIRE)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // After candidate signs — create employee and finalize
  const finalizeHire = useMutation({
    mutationFn: async ({ interestId, candidateId }: { interestId: string; candidateId: string }) => {
      const { data: candidate, error: cErr } = await supabase.from('candidates').select('*').eq('id', candidateId).single()
      if (cErr) throw cErr

      // Find the pending contract for this interest
      const { data: pendingContract } = await supabase.from('contracts')
        .select('*')
        .eq('signed', false)
        .ilike('observations', `%"interestId":"${interestId}"%`)
        .limit(1)
        .maybeSingle()

      const details = pendingContract?.observations ? JSON.parse(pendingContract.observations) : {}
      const client = (vacancy as { client?: { id: string; name: string } })?.client

      // Senha forte do portal: 8 caracteres (letras+números, sem ambíguos). Guardada só como hash.
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const autoPin = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')

      // Este candidato já é colaborador? (preenchendo 2ª vaga ou readmissão) — reaproveita, não duplica
      const { data: priorInterest } = await supabase.from('vacancy_interests')
        .select('employee_id').eq('candidate_id', candidateId).not('employee_id', 'is', null).limit(1).maybeSingle()
      const existingEmpId = (priorInterest as { employee_id?: string } | null)?.employee_id || null

      let empId: string
      let autoPinToShow: string | null = null
      if (existingEmpId) {
        // Reaproveita o colaborador existente; garante que está ativo (caso tenha sido desligado)
        empId = existingEmpId
        await supabase.from('employees').update({ status: 'Ativo', dismissal_date: null }).eq('id', empId)
      } else {
        const { data: emp, error: empErr } = await supabase.from('employees').insert({
          full_name: candidate.full_name,
          cpf: empForm.cpf || null,
          rg: empForm.rg || null,
          birth_date: empForm.birth_date || null,
          phone: empForm.phone || null,
          emergency_phone: empForm.emergency_phone || null,
          address_street: empForm.address_street || null,
          address_number: empForm.address_number || null,
          address_neighborhood: empForm.address_neighborhood || null,
          address_city: empForm.address_city || null,
          address_zip: empForm.address_zip || null,
          whatsapp: candidate.whatsapp,
          email: candidate.email,
          crn_number: candidate.crn_number,
          crn_region: candidate.crn_region,
          role: candidate.formation || null,
          status: 'Ativo',
          admission_date: empForm.admission_date || new Date().toISOString().slice(0, 10),
          pix: empForm.pix || null,
          bank_name: empForm.bank_name || null,
          bank_agency: empForm.bank_agency || null,
          bank_account: empForm.bank_account || null,
        }).select('id').single()
        if (empErr) throw empErr
        empId = emp.id
        // Define a senha do portal já como hash (função no servidor)
        await supabase.rpc('portal_set_pin', { p_employee: empId, p_pin: autoPin })
        autoPinToShow = autoPin
      }
      const emp = { id: empId }

      // Update pending contract: attach employee, mark signed
      if (pendingContract) {
        await supabase.from('contracts').update({
          employee_id: emp.id,
          signed: true,
          signed_at: new Date().toISOString(),
        }).eq('id', pendingContract.id)
      }

      // Link to client
      if (vacancy?.client_id) {
        const vac = vacancy as {
          unit_id?: string; work_schedule_type?: string; daily_hours?: number;
          days_off?: number[]; vacancy_type?: string
          salary_amount?: number; cost_assistance?: number
          monthly_hours?: number; weekly_hours?: number
          visits_per_week?: number; pay_extra_visits?: boolean
          schedule_anchor_date?: string
          payment_day_1?: number; payment_day_2?: number
          vacancy_units?: { unit_id: string; unit_name: string; visit_rate?: string | number }[]
        }
        // Tipo: 1º o que foi escolhido no processo, 2º o tipo da vaga (fonte da verdade)
        const svcType = details.serviceType || vac.vacancy_type || 'Fixo'
        const isConsult = svcType === 'Consultoria'

        // Bloquear se vaga cheia (Volante não conta e não é bloqueado)
        if (svcType !== 'Volante') {
          const { count: currentNonVolante } = await supabase
            .from('employee_client_links')
            .select('id', { count: 'exact', head: true })
            .eq('vacancy_id', id)
            .neq('service_type', 'Volante')
          if ((currentNonVolante || 0) >= (vacancy?.positions_count || 1)) {
            throw new Error(
              `Vaga cheia — ${currentNonVolante}/${vacancy?.positions_count} posições preenchidas. Para adicionar mais colaboradores, edite a vaga e aumente o número de posições.`
            )
          }
        }

        // Fixo: salário vem da vaga. Consultoria: unidades com valor da vistoria + horas/semana;
        // estimativa mensal = média dos valores das unidades × 4 semanas (o real vem da folha de ponto)
        let monthlyAmt: number | null = null
        let linkUnits: { unit_id: string; unit_name: string; visit_rate: number }[] | null = null
        if (isConsult && vac.vacancy_units?.length) {
          linkUnits = vac.vacancy_units.map(u => ({ unit_id: u.unit_id, unit_name: u.unit_name, visit_rate: Number(u.visit_rate) || 0 }))
          const avgRate = linkUnits.reduce((s, u) => s + u.visit_rate, 0) / linkUnits.length
          monthlyAmt = Math.round(avgRate * 4 * 100) / 100 || null
        } else if (!isConsult && vac.salary_amount) {
          monthlyAmt = Number(vac.salary_amount)
        }

        const { data: newLink, error: linkErr } = await supabase.from('employee_client_links').insert({
          employee_id: emp.id,
          client_id: vacancy.client_id,
          unit_id: vac.unit_id || null,
          service_type: svcType,
          monthly_amount: monthlyAmt,
          cost_assistance: Number(vac.cost_assistance) || 0,
          link_units: linkUnits,
          visit_frequency: isConsult ? (details.visitFrequency || (vac as { visit_frequency?: string }).visit_frequency || 'Semanal') : null,
          monthly_hours_quota: isConsult ? (vac.monthly_hours || null) : null,
          weekly_hours_quota: isConsult ? (vac.weekly_hours || null) : null,
          visits_per_week: isConsult ? (vac.visits_per_week || null) : null,
          pay_extra_visits: isConsult ? (vac.pay_extra_visits !== false) : true,
          contract_end_date: details.contractEndDate && details.contractEndDate !== '__indeterminate__' ? details.contractEndDate : null,
          work_schedule: details.workSchedule || null,
          work_schedule_type: vac.work_schedule_type || null,
          daily_hours: vac.daily_hours || null,
          days_off: vac.days_off?.length ? vac.days_off : null,
          schedule_anchor_date: !isConsult ? (vac.schedule_anchor_date || null) : null,
          start_date: details.startDate || null,
          vacancy_id: id,
        }).select('id').single()
        if (linkErr) throw new Error('Erro ao criar vínculo com cliente: ' + linkErr.message)

        const payDays = isConsult ? [8, 20] : [vac.payment_day_1, vac.payment_day_2].filter(Boolean) as number[]
        if (newLink && payDays.length) {
          const perDate = monthlyAmt ? Math.round((monthlyAmt / payDays.length) * 100) / 100 : null
          await supabase.from('employee_payment_dates').insert(
            payDays.map(d => ({ link_id: newLink.id, day_of_month: d, amount: perDate }))
          )
        }
      }

      // Update interest + candidate — save employee_id so dismissal from any screen can trace back
      await supabase.from('vacancy_interests').update({ status: 'Contratado', hired_at: new Date().toISOString(), employee_id: emp.id }).eq('id', interestId)
      await supabase.from('candidates').update({ pipeline_stage: 'Contratado' }).eq('id', candidateId)
      // Reconta vínculos não-Volante (já inclui o recém-criado) para definir status
      const { count: nonVolante } = await supabase
        .from('employee_client_links')
        .select('id', { count: 'exact', head: true })
        .eq('vacancy_id', id)
        .neq('service_type', 'Volante')
      const effectiveHired = nonVolante || 0
      await supabase.from('vacancies').update({
        hired_count: effectiveHired,
        status: effectiveHired >= (vacancy?.positions_count || 1) ? 'Preenchida' : 'Aberta',
      }).eq('id', id)

      return { empId: emp.id, autoPin: autoPinToShow }
    },
    onSuccess: ({ empId, autoPin }) => {
      toast.success(
        autoPin
          ? `Colaborador criado! Acesso ao portal — CPF + Senha: ${autoPin}`
          : 'Colaborador adicionado à vaga! (novo vínculo no mesmo cadastro)',
        { duration: 8000 }
      )
      qc.invalidateQueries({ queryKey: ['vacancy-interests', id] })
      qc.invalidateQueries({ queryKey: ['vacancy', id] })
      setCreateEmpModal(null)
      setEmpForm(EMPTY_EMP)
      navigate(`/colaboradores/${empId}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revertInterest = useMutation({
    mutationFn: async ({ interestId, candidateId }: { interestId: string; candidateId: string }) => {
      await supabase.from('vacancy_interests').update({ status: 'Interessado', deadline: null }).eq('id', interestId)
      await supabase.from('candidates').update({ pipeline_stage: 'Em Avaliação' }).eq('id', candidateId)
      // Delete pending contract
      await supabase.from('contracts').delete().eq('signed', false)
        .ilike('observations', `%"interestId":"${interestId}"%`)
    },
    onSuccess: () => { toast.success('Revertido!'); qc.invalidateQueries({ queryKey: ['vacancy-interests', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const [confirmDismiss, setConfirmDismiss] = useState<{ interestId: string; candidateId: string; empName: string } | null>(null)
  const [dismissDeadline, setDismissDeadline] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10)
  })
  const [confirmCloseModal, setConfirmCloseModal] = useState(false)
  const [confirmCloseText, setConfirmCloseText] = useState('')

  const dismissEmployee = useMutation({
    mutationFn: async ({ interestId, candidateId, deadline }: { interestId: string; candidateId: string; deadline: string }) => {
      // O employee_id fica salvo no interest na contratação — não buscar por nome
      const interest = interests?.find(i => i.id === interestId)
      const empId = (interest as { employee_id?: string } | undefined)?.employee_id

      let isVolanteLink = false
      if (empId) {
        // Guarda o service_type antes de deletar para decidir se reconta capacidade
        const { data: linkData } = await supabase
          .from('employee_client_links')
          .select('service_type')
          .eq('employee_id', empId)
          .eq('client_id', vacancy?.client_id)
          .maybeSingle()
        isVolanteLink = linkData?.service_type === 'Volante'

        // Remove o vínculo com este cliente; desliga só se não tiver outros vínculos ativos
        await supabase.from('employee_client_links').delete().eq('employee_id', empId).eq('client_id', vacancy?.client_id)
        const { data: otherLinks } = await supabase.from('employee_client_links').select('id').eq('employee_id', empId).limit(1)
        if (!otherLinks?.length) {
          await supabase.from('employees').update({ status: 'Inativo', dismissal_date: new Date().toISOString().slice(0, 10) }).eq('id', empId)
        }
      }

      // Revert interest and candidate
      await supabase.from('vacancy_interests').update({ status: 'Interessado', hired_at: null, employee_id: null }).eq('id', interestId)
      await supabase.from('candidates').update({ pipeline_stage: 'Em Avaliação' }).eq('id', candidateId)

      // Volante não conta para capacidade — só recalcula se era não-Volante
      if (!isVolanteLink) {
        const { count: nonVolante } = await supabase
          .from('employee_client_links')
          .select('id', { count: 'exact', head: true })
          .eq('vacancy_id', id)
          .neq('service_type', 'Volante')
        const newCount = nonVolante || 0
        const reopened = newCount < (vacancy?.positions_count || 1)
        await supabase.from('vacancies').update({
          hired_count: newCount,
          status: reopened ? 'Aberta' : vacancy?.status,
          ...(reopened && deadline ? { deadline } : {}),
        }).eq('id', id)
      }
    },
    onSuccess: () => {
      toast.success('Colaborador desligado. Passagem registrada no histórico.')
      qc.invalidateQueries({ queryKey: ['vacancy-interests', id] })
      qc.invalidateQueries({ queryKey: ['vacancy', id] })
      qc.invalidateQueries({ queryKey: ['vacancy-history', id] })
      setConfirmDismiss(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addInterest = useMutation({
    mutationFn: async (candidateId: string) => {
      // Um colaborador pode preencher mais de uma vaga — só evitamos duplicar na MESMA vaga.
      const { data: existing } = await supabase.from('vacancy_interests')
        .select('id').eq('candidate_id', candidateId).eq('vacancy_id', id!).limit(1)
      if (existing && existing.length > 0) throw new Error('Este candidato já está nesta vaga')
      const { error } = await supabase.from('vacancy_interests').insert({ vacancy_id: id, candidate_id: candidateId, status: 'Interessado' })
      if (error) throw error
      // Não rebaixa o estágio de quem já está contratado em outra vaga
      await supabase.from('candidates').update({ pipeline_stage: 'Em Avaliação' }).eq('id', candidateId).neq('pipeline_stage', 'Contratado')
    },
    onSuccess: () => { toast.success('Adicionado aos interessados!'); qc.invalidateQueries({ queryKey: ['vacancy-interests', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Vaga preenchida e rodando: status "Atuando" ──
  const completeVacancy = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vacancies').update({ status: 'Atuando' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vaga marcada como Atuando!'); qc.invalidateQueries({ queryKey: ['vacancy', id] }); qc.invalidateQueries({ queryKey: ['vacancies'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Precisa de mais gente: +1 posição e reabre
  const increasePositions = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vacancies').update({
        positions_count: (vacancy?.positions_count || 1) + 1,
        status: 'Aberta',
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vaga ampliada — +1 posição e reaberta para contratação!'); qc.invalidateQueries({ queryKey: ['vacancy', id] }); qc.invalidateQueries({ queryKey: ['vacancies'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Prolonga o vencimento do contrato dos colaboradores contratados por esta vaga
  const extendContract = useMutation({
    mutationFn: async (newDate: string) => {
      const hiredIds = (interests || []).filter(i => i.status === 'Contratado' && (i as { employee_id?: string }).employee_id).map(i => (i as { employee_id?: string }).employee_id!)
      if (!hiredIds.length) throw new Error('Nenhum colaborador contratado por esta vaga')
      if (!vacancy?.client_id) throw new Error('Vaga sem cliente vinculado')
      const { error } = await supabase.from('employee_client_links')
        .update({ contract_end_date: newDate })
        .in('employee_id', hiredIds)
        .eq('client_id', vacancy.client_id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Contrato prolongado para os colaboradores da vaga!')
      qc.invalidateQueries({ queryKey: ['vacancy-hired', id] })
      setShowExtendModal(false)
      setExtendDate('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Colaboradores contratados por esta vaga ──
  const { data: hiredEmps } = useQuery({
    queryKey: ['vacancy-hired', id, interests?.length],
    queryFn: async () => {
      const hired = (interests || []).filter(i => i.status === 'Contratado' && (i as { employee_id?: string }).employee_id)
      if (!hired.length) return []
      const ids = hired.map(i => (i as { employee_id?: string }).employee_id!)
      const { data: emps } = await supabase.from('employees').select('id, full_name, status, role, admission_date').in('id', ids)
      const { data: empLinks } = vacancy?.client_id
        ? await supabase.from('employee_client_links').select('employee_id, contract_end_date, service_type, monthly_amount').in('employee_id', ids).eq('client_id', vacancy.client_id)
        : { data: [] as { employee_id: string; contract_end_date?: string; service_type?: string; monthly_amount?: number }[] }
      return hired.map(i => {
        const empId = (i as { employee_id?: string }).employee_id
        return {
          interest: i,
          emp: emps?.find(e => e.id === empId),
          link: (empLinks || []).find(l => l.employee_id === empId),
        }
      }).filter(h => h.emp)
    },
    enabled: !!interests && !!vacancy,
  })

  // Auto-corrige status e hired_count quando colaboradores ficam inativos fora do fluxo normal
  useEffect(() => {
    if (!vacancy || hiredEmps === undefined || vacancy.status === 'Fechada') return
    const activeCount = hiredEmps
      .filter(h => h.link?.service_type !== 'Volante' && h.emp?.status === 'Ativo').length
    const positions = vacancy.positions_count || 1
    const expectedStatus = activeCount === 0 ? 'Aberta'
      : activeCount >= positions ? (vacancy.status === 'Atuando' ? 'Atuando' : 'Preenchida')
      : 'Aberta'
    if (expectedStatus !== vacancy.status || activeCount !== (vacancy.hired_count ?? activeCount)) {
      supabase.from('vacancies')
        .update({ status: expectedStatus, hired_count: activeCount })
        .eq('id', id)
        .then(() => qc.invalidateQueries({ queryKey: ['vacancy', id] }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiredEmps])

  // ── Histórico de passagens: quem já passou por esta vaga ──
  const { data: vacancyHistory } = useQuery({
    queryKey: ['vacancy-history', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('placements_history')
        .select('*')
        .eq('vacancy_id', id)
        .order('end_date', { ascending: false })
      if (error) return []
      return data || []
    },
    enabled: tab === 'colaboradores',
  })

  // ── Documentos da vaga (compartilhados com o cliente) ──
  const { data: vacancyDocs } = useQuery({
    queryKey: ['vacancy-docs', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('shared_documents').select('*').eq('vacancy_id', id).order('topic').order('created_at')
      if (error) throw error
      return data || []
    },
    enabled: tab === 'documentos',
  })

  const uploadVacancyDoc = async () => {
    if (!docFile || !docForm.name.trim()) { toast.error('Informe o nome e escolha o arquivo'); return }
    setUploadingDoc(true)
    try {
      const ext = docFile.name.split('.').pop()
      const { data: inserted, error } = await supabase.from('shared_documents').insert({
        client_id: vacancy?.client_id || null,
        vacancy_id: id,
        topic: docForm.topic.trim() || 'Geral',
        name: docForm.name.trim(),
      }).select('id').single()
      if (error) throw error
      const path = `shared/${vacancy?.client_id || 'sem-cliente'}/${inserted.id}.${ext}`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, docFile, { upsert: true })
      if (upErr) throw upErr
      await supabase.from('shared_documents').update({ file_url: path }).eq('id', inserted.id)
      toast.success('Documento anexado! Ele também aparece na aba Documentos do cliente.')
      qc.invalidateQueries({ queryKey: ['vacancy-docs', id] })
      setDocForm({ topic: docForm.topic, name: '' })
      setDocFile(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setUploadingDoc(false)
    }
  }

  const deleteDoc = useMutation({
    mutationFn: async (docId: string) => {
      const { error } = await supabase.from('shared_documents').delete().eq('id', docId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Documento removido.'); qc.invalidateQueries({ queryKey: ['vacancy-docs', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const markComplete = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('vacancies').update({ status: 'Fechada' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vaga fechada!'); qc.invalidateQueries({ queryKey: ['vacancy', id] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (!vacancy) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>

  // Só conta colaboradores Ativos e não-Volante para capacidade
  const contractedCount = hiredEmps !== undefined
    ? hiredEmps.filter(h => h.link?.service_type !== 'Volante' && h.emp?.status === 'Ativo').length
    : (interests?.filter(i => i.status === 'Contratado').length ?? 0)
  const totalPositions = vacancy.positions_count || 1
  const activeHired = (hiredEmps || []).filter(h => h.emp?.status === 'Ativo')
  const interestIds = new Set(interests?.map(i => i.candidate_id) ?? [])

  // Match scoring — starts at 100, penalizes mismatches, bonuses for proximity
  const scoreCandidate = (c: Record<string, unknown>) => {
    const issues: string[] = []
    let score = 100

    // Hard requirements
    if (vacancy.requires_crn && !c.crn_number) { issues.push('Sem CRN'); score -= 30 }
    if (vacancy.requires_vehicle && !c.has_vehicle) { issues.push('Sem veículo'); score -= 20 }
    if (vacancy.requires_travel && !c.requires_travel) { issues.push('Não aceita viagens'); score -= 20 }
    if (vacancy.requires_relocation && !c.requires_relocation) { issues.push('Não aceita mudança'); score -= 15 }

    // Formation
    if (vacancy.formation && vacancy.formation !== 'Ambos' && c.formation && c.formation !== 'Ambos' && c.formation !== vacancy.formation) {
      issues.push('Formação diferente'); score -= 25
    }

    // Location scoring — region-aware for any Brazilian city
    const vCity = (vacancy.city as string) || ''
    const cCity = (c.city as string) || ''
    const vState = (vacancy.state as string) || ''
    const cState = (c.state as string) || ''

    if (vState && cState && cState !== vState) {
      issues.push(`Outro estado (${cState})`); score -= 20
    } else if (vState && cState === vState) {
      const nc = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim()
      const sameCity = vCity && cCity && (nc(vCity) === nc(cCity) || nc(cCity).includes(nc(vCity)) || nc(vCity).includes(nc(cCity)))
      if (sameCity) {
        score += 25 // mesma cidade
      } else {
        const vRegion = vCity ? getCityRegion(vCity, vState) : null
        const cRegion = cCity ? getCityRegion(cCity, cState) : null
        if (vRegion && cRegion && vRegion === cRegion) {
          score += 15 // mesma região/microrregião
        }
        // Same state but different region — no bonus, no penalty
      }
    }

    // Experience
    const expMap: Record<string, number> = {
      'Nenhuma. Busco minha primeira oportunidade.': 0,
      'Até 1 ano': 1, '1 a 3 anos': 2, '3 a 5 anos': 3, 'Mais de 5 anos': 4,
    }
    const minExp = vacancy.min_experience
    const candExp = expMap[c.experience_time as string] ?? -1
    if (minExp === 'Mais de 1 ano' && candExp !== -1 && candExp < 1) { issues.push('Pouca experiência'); score -= 15 }
    if (minExp === 'Mais de 3 anos' && candExp !== -1 && candExp < 3) { issues.push('Pouca experiência'); score -= 15 }
    if (minExp === 'Mais de 5 anos' && candExp !== -1 && candExp < 4) { issues.push('Pouca experiência'); score -= 15 }

    return { score: Math.min(110, Math.max(0, score)), issues }
  }

  const filteredCandidates = (allCandidates || [])
    .filter(c => !interestIds.has(c.id))
    .filter(c => !matchFilters.state || c.state === matchFilters.state)
    .filter(c => !matchFilters.formation || matchFilters.formation === 'Ambos' || c.formation === matchFilters.formation || c.formation === 'Ambos')
    .map(c => ({ ...c, ...scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score)

  const perfect = filteredCandidates.filter(c => c.score >= 90)
  const partial = filteredCandidates.filter(c => c.score < 90)
  const displayed = onlyCompatible ? perfect : [...perfect, ...partial]

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Confirm dismiss modal */}
      {confirmDismiss && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-lift p-6 max-w-sm w-full space-y-4">
            <h3 className="font-display font-bold text-lg text-red-700">Desligar colaborador?</h3>
            <p className="text-sm text-ink-600">
              <strong>{confirmDismiss.empName}</strong> será desligado(a) desta vaga. Se não tiver outros vínculos, ficará como <strong>Inativo</strong>. A vaga reabre nesta posição.
            </p>
            <div>
              <label className="label">Prazo para contratar substituto</label>
              <input
                type="date"
                className="input"
                value={dismissDeadline}
                onChange={e => setDismissDeadline(e.target.value)}
              />
              <p className="text-xs text-ink-400 mt-1">A vaga reabre com este prazo e entra nos alertas do Dashboard.</p>
            </div>
            <p className="text-xs text-ink-400">O histórico de pagamentos já gerado não será apagado.</p>
            <div className="flex gap-3">
              <button
                className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
                onClick={() => dismissEmployee.mutate({ ...confirmDismiss, deadline: dismissDeadline })}
                disabled={dismissEmployee.isPending}
              >
                {dismissEmployee.isPending ? 'Desligando...' : 'Confirmar desligamento'}
              </button>
              <button className="btn-secondary flex-1" onClick={() => setConfirmDismiss(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Fechar Vaga com confirmação por digitação */}
      {confirmCloseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <span className="text-red-600 text-lg">⚠</span>
              </div>
              <div>
                <h3 className="font-bold text-lg text-red-700">Fechar Vaga</h3>
                <p className="text-xs text-gray-500">Essa ação arquiva o processo seletivo</p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
              <p><strong>Atenção:</strong> Fechar uma vaga significa que o processo seletivo está encerrado.</p>
              <p className="text-xs">Os colaboradores contratados continuam ativos normalmente — apenas a vaga é arquivada.</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Para confirmar, digite <strong className="text-red-600 font-mono tracking-widest">FECHAR</strong> abaixo:</p>
              <input
                className="input font-mono tracking-widest uppercase text-center text-red-700 border-red-300 focus:border-red-500"
                placeholder="FECHAR"
                value={confirmCloseText}
                onChange={e => setConfirmCloseText(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 px-4 rounded-lg font-semibold text-sm text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700"
                disabled={confirmCloseText !== 'FECHAR' || markComplete.isPending}
                onClick={() => { markComplete.mutate(); setConfirmCloseModal(false) }}
              >
                {markComplete.isPending ? 'Fechando...' : 'Confirmar fechamento'}
              </button>
              <button className="btn-secondary flex-1" onClick={() => setConfirmCloseModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <button onClick={() => navigate(-1)} className="btn-ghost px-2 -ml-2 text-sm"><ArrowLeft size={16} />Voltar</button>

      <div className="card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-display font-extrabold text-ink-900">{vacancy.title}</h1>
            <div className="flex gap-1.5 flex-wrap mt-2">
              <span className={`badge ${vacancy.status === 'Aberta' ? 'bg-primary-100 text-primary-700' : vacancy.status === 'Atuando' ? 'bg-green-100 text-green-700' : vacancy.status === 'Preenchida' ? 'bg-purple-100 text-purple-700' : 'bg-ink-100 text-ink-600'}`}>{vacancy.status === 'Atuando' ? '● Atuando' : vacancy.status}</span>
              <span className="badge bg-ink-100 text-ink-600">{[vacancy.city, vacancy.state].filter(Boolean).join(', ')}</span>
              {(vacancy as { client?: { name: string } }).client?.name && <span className="badge bg-blue-50 text-blue-600">{(vacancy as { client?: { name: string } }).client?.name}</span>}
              <span className="badge bg-purple-50 text-purple-700">{contractedCount}/{totalPositions} preenchidas</span>
            </div>
          </div>
          <button onClick={() => navigate(`/vagas/${id}/editar`)} className="btn-secondary text-sm"><Edit size={16} /><span className="hidden sm:inline">Editar</span></button>
        </div>
        <div className="flex gap-2 flex-wrap mt-4 pt-4 border-t border-ink-100">
          {(vacancy.status === 'Aberta' || vacancy.status === 'Preenchida') && (
            <button onClick={() => completeVacancy.mutate()} disabled={completeVacancy.isPending} className="btn-primary text-sm">
              <CheckCircle size={16} /> Completar Vaga
            </button>
          )}
          {vacancy.status === 'Atuando' && (
            <>
              <button onClick={() => increasePositions.mutate()} disabled={increasePositions.isPending} className="btn-secondary text-sm">＋ Aumentar posições</button>
              <button onClick={() => setShowExtendModal(true)} className="btn-secondary text-sm">Prolongar contrato</button>
            </>
          )}
          {(vacancy.status === 'Aberta' || vacancy.status === 'Atuando' || vacancy.status === 'Preenchida') && (
            <button onClick={() => { setConfirmCloseText(''); setConfirmCloseModal(true) }} className="btn-ghost text-sm text-ink-500 ml-auto">Fechar Vaga</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {([['info', 'Informações'], ['interessados', `Interessados (${interests?.length ?? 0})`], ['match', 'Match de Candidatos'], ['colaboradores', `Colaboradores (${contractedCount})`], ['documentos', 'Documentos']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as typeof tab)}
            className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Modal: prolongar contrato */}
      {showExtendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg">Prolongar contrato</h3>
            <p className="text-sm text-gray-600">
              Novo vencimento de contrato para {contractedCount > 1 ? `os ${contractedCount} colaboradores contratados` : 'o colaborador contratado'} por esta vaga:
            </p>
            <input className="input" type="date" value={extendDate} onChange={e => setExtendDate(e.target.value)} />
            <div className="flex gap-3">
              <button className="btn-primary flex-1" disabled={!extendDate || extendContract.isPending} onClick={() => extendContract.mutate(extendDate)}>
                {extendContract.isPending ? 'Salvando...' : 'Prolongar'}
              </button>
              <button className="btn-secondary flex-1" onClick={() => setShowExtendModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* COLABORADORES — quem foi contratado por esta vaga */}
      {tab === 'colaboradores' && (
        <div className="space-y-4">
          {/* Em atuação */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">Em atuação</p>
            {activeHired.length === 0 && (
              <div className="card p-6 text-center text-gray-400 text-sm">Nenhum colaborador ativo nesta vaga no momento.</div>
            )}
            {activeHired.map(({ interest, emp, link }) => {
              const contractEnd = link?.contract_end_date
              return (
                <div key={emp!.id} className="card p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
                    {emp!.full_name.trim().split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button className="font-semibold text-gray-900 hover:text-primary-700 hover:underline" onClick={() => navigate(`/colaboradores/${emp!.id}`)}>
                      {emp!.full_name}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs">
                      <span className="badge bg-green-100 text-green-700">Ativo</span>
                      {link?.service_type && <span className={`badge ${link.service_type === 'Consultoria' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{link.service_type}</span>}
                      <span className="text-gray-400">Contratado em {formatDate(interest.hired_at)}</span>
                      {contractEnd ? <span className="text-gray-500">Contrato até {formatDate(contractEnd)}</span> : <span className="text-gray-400">Contrato indeterminado</span>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs" onClick={() => navigate(`/colaboradores/${emp!.id}`)}>Ver perfil</button>
                    <button
                      className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setConfirmDismiss({ interestId: interest.id, candidateId: (interest as { candidate_id?: string }).candidate_id || '', empName: emp!.full_name })}
                    >
                      Desligar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Histórico — passagens registradas (quem já foi contratado por esta vaga) */}
          {vacancyHistory && vacancyHistory.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">Histórico de passagens</p>
              {vacancyHistory.map(p => {
                const days = p.start_date && p.end_date
                  ? Math.max(1, Math.round((new Date(p.end_date).getTime() - new Date(p.start_date).getTime()) / 86400000))
                  : null
                return (
                  <div key={p.id} className="card p-4 flex items-center gap-3 opacity-80">
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 font-bold text-sm flex-shrink-0">
                      {(p.employee_name || '?').trim().split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      {p.employee_id ? (
                        <button className="font-semibold text-gray-700 hover:text-primary-700 hover:underline" onClick={() => navigate(`/colaboradores/${p.employee_id}`)}>
                          {p.employee_name}
                        </button>
                      ) : (
                        <span className="font-semibold text-gray-500">{p.employee_name}</span>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs">
                        {p.service_type && <span className="badge bg-gray-100 text-gray-500">{p.service_type}</span>}
                        <span className="text-gray-500">
                          {p.start_date ? formatDate(p.start_date) : '?'} → {formatDate(p.end_date)}
                          {days !== null && ` · ${days} dia${days === 1 ? '' : 's'}`}
                        </span>
                        {p.dismissal_reason && <span className="text-gray-400 italic">— {p.dismissal_reason}</span>}
                      </div>
                    </div>
                    {p.employee_id && (
                      <button className="btn-secondary text-xs" onClick={() => navigate(`/colaboradores/${p.employee_id}`)}>Ver perfil</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* DOCUMENTOS — compartilhados com o cliente */}
      {tab === 'documentos' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="font-semibold text-sm">Anexar documento</h3>
              <p className="text-xs text-gray-400">Crie o tópico na hora (ex: Colaboradores, Contratos, Fotos 3x4). Tudo que anexar aqui aparece também na aba Documentos do cliente.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">Tópico</label>
                <input className="input text-sm" placeholder="Ex: Colaboradores" list="doc-topics" value={docForm.topic} onChange={e => setDocForm(p => ({ ...p, topic: e.target.value }))} />
                <datalist id="doc-topics">
                  {[...new Set((vacancyDocs || []).map(d => d.topic))].map(t => <option key={t} value={t} />)}
                  <option value="Contratos" /><option value="Colaboradores" /><option value="Fotos 3x4" />
                </datalist>
              </div>
              <div>
                <label className="label text-xs">Nome do documento *</label>
                <input className="input text-sm" placeholder="Ex: Contrato assinado – Maria" value={docForm.name} onChange={e => setDocForm(p => ({ ...p, name: e.target.value }))} />
              </div>
            </div>
            <input id="vacancy-doc-file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
              onChange={e => setDocFile(e.target.files?.[0] || null)} />
            <button
              type="button"
              onClick={() => document.getElementById('vacancy-doc-file')?.click()}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors text-center"
            >
              {docFile ? `✓ ${docFile.name}` : '+ Escolher arquivo (PDF ou foto)'}
            </button>
            <button className="btn-primary text-sm w-full" disabled={uploadingDoc || !docFile || !docForm.name.trim()} onClick={uploadVacancyDoc}>
              {uploadingDoc ? 'Enviando...' : 'Anexar documento'}
            </button>
          </div>

          {(!vacancyDocs || vacancyDocs.length === 0) && (
            <div className="card p-8 text-center text-gray-400 text-sm">
              <FileText size={28} className="mx-auto mb-2 opacity-40" />
              Nenhum documento anexado nesta vaga.
            </div>
          )}
          {[...new Set((vacancyDocs || []).map(d => d.topic))].map(topic => (
            <div key={topic} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">{topic}</div>
              <div className="divide-y divide-gray-50">
                {(vacancyDocs || []).filter(d => d.topic === topic).map(d => (
                  <div key={d.id} className="px-4 py-3 flex items-center gap-3">
                    <FileText size={16} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      <p className="text-xs text-gray-400">{formatDate(d.created_at)}</p>
                    </div>
                    {d.file_url && <SignedLink value={d.file_url} bucket="arquivos" className="text-xs text-primary-600 underline">abrir</SignedLink>}
                    <button className="text-gray-300 hover:text-red-500 p-1" onClick={() => { if (window.confirm(`Excluir "${d.name}"?`)) deleteDoc.mutate(d.id) }}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* INFO */}
      {tab === 'info' && (
        <div className="card p-5 space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">Preenchimento da Vaga</span>
              <span>{contractedCount}/{totalPositions}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-primary-600 h-2 rounded-full" style={{ width: `${Math.min(100, (contractedCount / totalPositions) * 100)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-xs text-gray-400">Abertura</span><p>{formatDate(vacancy.opening_date)}</p></div>
            <div><span className="text-xs text-gray-400">Prazo</span><p>{formatDate(vacancy.deadline)}</p></div>
            <div><span className="text-xs text-gray-400">Formação</span><p>{vacancy.formation || 'Qualquer'}</p></div>
            <div><span className="text-xs text-gray-400">Local</span><p>{[vacancy.city, vacancy.state].filter(Boolean).join(', ') || '-'}</p></div>
            <div><span className="text-xs text-gray-400">Tipo</span><p>{(vacancy as { vacancy_type?: string }).vacancy_type || '-'}</p></div>
          </div>

          {/* Financeiro */}
          {(() => {
            const vac = vacancy as { vacancy_type?: string; salary_amount?: number; cost_assistance?: number; payment_day_1?: number; payment_day_2?: number; monthly_hours?: number; weekly_hours?: number; visits_per_week?: number; pay_extra_visits?: boolean; vacancy_units?: { unit_id: string; unit_name: string; visit_rate?: string | number }[] }
            const isConsultoria = vac.vacancy_type === 'Consultoria'
            const isFixo = vac.vacancy_type === 'Fixo'
            const hasFinancial = vac.salary_amount || vac.payment_day_1 || vac.monthly_hours || (vac.vacancy_units && vac.vacancy_units.length > 0)
            if (!hasFinancial) return null
            return (
              <div className="border-t pt-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Financeiro</p>
                {isFixo && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {vac.salary_amount != null && (
                      <div>
                        <span className="text-xs text-gray-400">Salário mensal</span>
                        <p className="font-semibold text-green-700">R$ {vac.salary_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>
                    )}
                    {vac.cost_assistance != null && vac.cost_assistance > 0 && (
                      <div>
                        <span className="text-xs text-gray-400">Ajuda de custo</span>
                        <p>R$ {vac.cost_assistance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                      </div>
                    )}
                    {vac.salary_amount != null && vac.cost_assistance != null && vac.cost_assistance > 0 && (
                      <div className="col-span-2 bg-green-50 rounded-lg px-3 py-2 text-xs text-green-800">
                        Total mensal estimado: <strong>R$ {(vac.salary_amount + vac.cost_assistance).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                      </div>
                    )}
                  </div>
                )}
                {isConsultoria && (() => {
                  const units = vac.vacancy_units || []
                  const avgRate = units.length ? units.reduce((s, u) => s + (Number(u.visit_rate) || 0), 0) / units.length : 0
                  return (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {vac.weekly_hours != null && (
                          <div>
                            <span className="text-xs text-gray-400">Horas/semana</span>
                            <p className="font-semibold text-orange-700">{vac.weekly_hours}h</p>
                          </div>
                        )}
                        {vac.monthly_hours != null && (
                          <div>
                            <span className="text-xs text-gray-400">Horas/mês (semana × 4)</span>
                            <p className="font-semibold text-orange-700">{vac.monthly_hours}h</p>
                          </div>
                        )}
                        <div className="col-span-2">
                          <span className="text-xs text-gray-400">Combinado de pagamento</span>
                          <p className="font-medium text-sm">{vac.monthly_hours != null ? `${vac.monthly_hours}h no mês` : '—'} — passar de 1h disso vai pra aprovação do gestor{vac.visits_per_week != null ? ` · meta de ${vac.visits_per_week} visita(s)/semana` : ''}</p>
                        </div>
                      </div>
                      {units.length > 0 && (
                        <div className="space-y-1.5">
                          {units.map((u, i) => (
                            <div key={i} className="bg-gray-50 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
                              <span className="font-medium">{u.unit_name}</span>
                              <span className="text-green-700 font-semibold">R$ {(Number(u.visit_rate) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / vistoria</span>
                            </div>
                          ))}
                          {avgRate > 0 && (
                            <div className="bg-green-50 rounded-lg px-3 py-2 text-xs text-green-800">
                              Estimativa mensal (média das unidades × 4 semanas): <strong>R$ {(avgRate * 4).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> — o valor real é calculado pelas horas da folha de ponto
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {vac.payment_day_1 && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-gray-400">1º pagamento</span>
                      <p className="font-medium">Dia {vac.payment_day_1}</p>
                    </div>
                    {vac.payment_day_2 && (
                      <div>
                        <span className="text-xs text-gray-400">2º pagamento</span>
                        <p className="font-medium">Dia {vac.payment_day_2}</p>
                      </div>
                    )}
                    {vac.payment_day_2 && (
                      <div className="col-span-2 text-xs text-gray-400 italic">
                        Dois pagamentos — cada um equivale à metade do valor mensal
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {vacancy.observations && <div><span className="text-xs text-gray-400">Observações</span><p className="text-sm mt-1">{vacancy.observations}</p></div>}
        </div>
      )}

      {/* INTERESSADOS */}
      {tab === 'interessados' && (
        <div className="space-y-3">
          {interests?.length === 0 && (
            <div className="card p-6 text-center text-gray-400 text-sm">
              Nenhum candidato ainda. Use a aba <strong>Match</strong> para adicionar.
            </div>
          )}
          {interests?.map(interest => {
            const c = (interest as { candidate?: { id: string; full_name: string; city?: string; state?: string; whatsapp?: string } }).candidate
            const deadline = interest.deadline ? new Date(interest.deadline) : null
            const hoursLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 3600000) : null
            const isOverdue = hoursLeft !== null && hoursLeft < 0

            return (
              <div key={interest.id} className={`card p-4 border-l-4 ${interest.status === 'Contratado' ? 'border-green-500' : interest.status === 'Em contrato' ? (isOverdue ? 'border-red-500' : 'border-amber-400') : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <p className="font-medium">{c?.full_name}</p>
                    <p className="text-xs text-gray-500">{[c?.city, c?.state].filter(Boolean).join(', ')}</p>

                    {interest.status === 'Em contrato' && deadline && (
                      <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                        <Clock size={12} />
                        {isOverdue
                          ? `⚠️ Prazo expirado há ${Math.abs(hoursLeft!)}h — gere o contrato urgente!`
                          : `${hoursLeft}h para gerar o contrato`}
                      </div>
                    )}
                    {interest.status === 'Contratado' && (
                      <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                        <CheckCircle size={12} /> Contratado em {formatDate(interest.hired_at)}
                      </p>
                    )}
                    {interest.status === 'Contratado' && !vacancy.salary_amount && !(vacancy.vacancy_units as unknown[])?.length && (
                      <p className="text-xs text-amber-600 mt-1">
                        ⚠ Valores não definidos na vaga — abra o colaborador → Vínculos → Editar e defina para aparecer em Pagamentos.
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 items-center flex-wrap">
                    <span className={`badge text-xs ${interest.status === 'Interessado' ? 'bg-amber-100 text-amber-700' : interest.status === 'Em contrato' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {interest.status}
                    </span>

                    {c?.whatsapp && (
                      <a href={formatWhatsApp(c.whatsapp)} target="_blank" rel="noreferrer" className="btn-ghost p-1.5">
                        <MessageCircle size={16} className="text-green-600" />
                      </a>
                    )}

                    {interest.status === 'Interessado' && (
                      (vacancy as { vacancy_type?: string }).vacancy_type !== 'Volante' && contractedCount >= totalPositions ? (
                        <span
                          title="Vaga cheia — edite a vaga para aumentar o número de posições"
                          className="text-xs text-red-600 font-semibold bg-red-50 border border-red-200 px-2 py-1 rounded-lg"
                        >
                          Vaga cheia
                        </span>
                      ) : (
                        <button className="btn-primary text-xs" onClick={() => {
                          const vac = vacancy as Record<string, unknown>
                          setDeadlineModal({ interestId: interest.id, candidateId: c!.id })
                          setHireDetails({
                            ...EMPTY_HIRE,
                            serviceType: (vac.vacancy_type as 'Fixo' | 'Consultoria') || 'Fixo',
                            workShift: (vac.shift as string) || '',
                            workSchedule: (vac.work_schedule_type as string) || '',
                            visitFrequency: (vac.visit_frequency as 'Semanal' | 'Quinzenal' | 'Mensal') || 'Semanal',
                            monthlyAmount: vac.salary_amount ? String(vac.salary_amount) : '',
                            costAssistance: vac.cost_assistance ? String(vac.cost_assistance) : '',
                          })
                        }}>
                          Contratar
                        </button>
                      )
                    )}

                    {interest.status === 'Em contrato' && (
                      <>
                        <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => setContractModal({ interest, candidate: c as Record<string, unknown> })}>
                          <FileText size={13} /> Gerar Contrato
                        </button>
                        <button className="btn-primary text-xs flex items-center gap-1" onClick={() => {
                          setCreateEmpModal({ interestId: interest.id, candidateId: c!.id })
                          setEmpForm(EMPTY_EMP)
                        }}>
                          <CheckCircle size={13} /> Assinado ✓
                        </button>
                        <button className="text-xs text-gray-400 hover:text-red-500 px-2" onClick={() => revertInterest.mutate({ interestId: interest.id, candidateId: c!.id })}>
                          Reverter
                        </button>
                      </>
                    )}

                    {interest.status === 'Contratado' && (
                      <button
                        className="btn-secondary text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => setConfirmDismiss({ interestId: interest.id, candidateId: c!.id, empName: c!.full_name })}
                      >
                        Desligar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MATCH */}
      {tab === 'match' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input className="input flex-1" placeholder="Buscar por nome..." value={matchSearch} onChange={e => setMatchSearch(e.target.value)} />
              <button onClick={() => setShowMatchFilters(!showMatchFilters)} className="flex items-center gap-1 text-sm text-primary-600 whitespace-nowrap">
                Filtros {showMatchFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {showMatchFilters && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Estado</label>
                  <select className="input" value={matchFilters.state} onChange={e => setMatchFilters(p => ({ ...p, state: e.target.value }))}>
                    <option value="">Todos</option>{BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Formação</label>
                  <select className="input" value={matchFilters.formation} onChange={e => setMatchFilters(p => ({ ...p, formation: e.target.value }))}>
                    <option value="">Todas</option>
                    <option>Técnico em Nutrição</option><option>Nutricionista</option><option>Ambos</option>
                  </select>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between text-sm text-gray-500">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={onlyCompatible} onChange={e => setOnlyCompatible(e.target.checked)} className="rounded" />
                Só 100% compatíveis
              </label>
              <span>{displayed.length} candidatos encontrados</span>
            </div>
          </div>

          {displayed.length === 0 && (
            <div className="card p-6 text-center text-gray-400 text-sm">Nenhum candidato encontrado com esses filtros.</div>
          )}

          {!onlyCompatible && perfect.filter(c => displayed.includes(c)).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-green-700 mb-2">✓ 100% Compatíveis ({perfect.filter(c => displayed.includes(c)).length})</h3>
              {perfect.filter(c => displayed.includes(c)).map(c => (
                <MatchCard key={c.id} candidate={c} onAdd={() => addInterest.mutate(c.id)} vacancy={vacancy} />
              ))}
            </div>
          )}
          {onlyCompatible && perfect.map(c => <MatchCard key={c.id} candidate={c} onAdd={() => addInterest.mutate(c.id)} vacancy={vacancy} />)}

          {!onlyCompatible && partial.filter(c => displayed.includes(c)).length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-amber-700 mt-4 mb-2">~ Parcialmente Compatíveis ({partial.filter(c => displayed.includes(c)).length})</h3>
              {partial.filter(c => displayed.includes(c)).map(c => (
                <MatchCard key={c.id} candidate={c} onAdd={() => addInterest.mutate(c.id)} vacancy={vacancy} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL 1: Deadline + Detalhes do Contrato ─── */}
      {deadlineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-lg">Iniciar Contratação</h3>

            {/* Tipo vem da vaga — só mostra, não edita */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${hireDetails.serviceType === 'Consultoria' ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
              {hireDetails.serviceType === 'Consultoria' ? '🔍' : '📅'}
              Tipo definido pela vaga: <strong>{hireDetails.serviceType}</strong>
            </div>

            {/* Escala só para Fixo */}
            {hireDetails.serviceType === 'Fixo' && (
              <div className="space-y-3 bg-gray-50 p-3 rounded-lg">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Escala de Trabalho <span className="text-primary-500 normal-case font-normal">• pré-preenchido da vaga</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Turno</label>
                    <select className="input" value={hireDetails.workShift} onChange={e => setHireDetails(p => ({ ...p, workShift: e.target.value }))}>
                      <option value="">-</option><option>Diurno</option><option>Noturno</option><option>Misto</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Escala</label>
                    <select className="input" value={hireDetails.workSchedule} onChange={e => setHireDetails(p => ({ ...p, workSchedule: e.target.value }))}>
                      <option value="">Selecionar</option>
                      <option>5x2</option><option>6x1</option><option>12x36</option><option>12x60</option><option>Plantão</option><option>Temporário</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {hireDetails.serviceType === 'Consultoria' && (
              <div className="space-y-2 bg-orange-50 rounded-lg p-3">
                <div>
                  <label className="label text-xs">Frequência de visita <span className="text-primary-500 font-normal">• da vaga</span></label>
                  <select className="input text-sm" value={hireDetails.visitFrequency} onChange={e => setHireDetails(p => ({ ...p, visitFrequency: e.target.value as 'Semanal' | 'Quinzenal' | 'Mensal' }))}>
                    <option value="Semanal">Semanal (4×/mês)</option>
                    <option value="Quinzenal">Quinzenal (2×/mês)</option>
                    <option value="Mensal">Mensal (1×/mês)</option>
                  </select>
                </div>
                <p className="text-xs text-orange-600">Unidades e valores serão configurados no perfil do colaborador → Vínculos → Editar após a contratação.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Data de Início</label>
                <input className="input" type="date" value={hireDetails.startDate} onChange={e => setHireDetails(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              {hireDetails.contractEndDate !== '__indeterminate__' && (
                <div>
                  <label className="label">Vencimento do Contrato</label>
                  <input className="input" type="date" value={hireDetails.contractEndDate} onChange={e => setHireDetails(p => ({ ...p, contractEndDate: e.target.value }))} />
                </div>
              )}
              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={hireDetails.contractEndDate === '__indeterminate__'}
                    onChange={e => setHireDetails(p => ({ ...p, contractEndDate: e.target.checked ? '__indeterminate__' : '' }))}
                  />
                  <span className="text-sm">Contrato por tempo indeterminado</span>
                </label>
              </div>
            </div>

            {/* Prazo para gerar o contrato */}
            <div>
              <label className="label">Prazo para gerar o contrato *</label>
              <div className="grid grid-cols-3 gap-2">
                {([24, 48, 72] as const).map(h => (
                  <button key={h} type="button"
                    className={`p-3 rounded-lg border-2 text-sm font-semibold transition-colors ${deadlineHours === h ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600'}`}
                    onClick={() => setDeadlineHours(h)}>
                    {h}h
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">Sistema alertará no Dashboard até o contrato ser assinado.</p>
            </div>

            <div className="flex gap-3 pt-2">
              <button className="btn-primary flex-1" onClick={() => startContractProcess.mutate(deadlineModal)} disabled={startContractProcess.isPending}>
                {startContractProcess.isPending ? 'Processando...' : 'Confirmar →'}
              </button>
              <button className="btn-ghost px-4" onClick={() => setDeadlineModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL 2: Template de Contrato ─── */}
      {contractModal && (
        <ContractTemplateModal
          candidate={contractModal.candidate}
          vacancy={vacancy}
          onClose={() => setContractModal(null)}
        />
      )}

      {/* ─── MODAL 3: Criar Colaborador após assinatura ─── */}
      {createEmpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <CheckCircle size={20} className="text-green-500" />
              <h3 className="font-semibold text-lg">Criar Colaborador</h3>
            </div>
            <p className="text-sm text-gray-500">Contrato assinado! Preencha os dados do colaborador — o que não souber agora pode completar depois na ficha.</p>

            {/* Identificação */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Identificação</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">CPF <span className="text-orange-400 text-xs">(login portal)</span></label>
                  <input className="input" placeholder="000.000.000-00" value={empForm.cpf} onChange={e => setEmpForm(p => ({ ...p, cpf: e.target.value }))} />
                </div>
                <div>
                  <label className="label">RG</label>
                  <input className="input" placeholder="00.000.000-0" value={empForm.rg} onChange={e => setEmpForm(p => ({ ...p, rg: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Data de Nascimento</label>
                  <input className="input" type="date" value={empForm.birth_date} onChange={e => setEmpForm(p => ({ ...p, birth_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Data de Admissão</label>
                  <input className="input" type="date" value={empForm.admission_date} onChange={e => setEmpForm(p => ({ ...p, admission_date: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Contato */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Contato</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Telefone</label>
                  <input className="input" placeholder="(00) 00000-0000" value={empForm.phone} onChange={e => setEmpForm(p => ({ ...p, phone: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Contato de Emergência</label>
                  <input className="input" placeholder="Nome e telefone" value={empForm.emergency_phone} onChange={e => setEmpForm(p => ({ ...p, emergency_phone: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Endereço */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Endereço</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Rua</label>
                  <input className="input" placeholder="Ex: Rua das Flores" value={empForm.address_street} onChange={e => setEmpForm(p => ({ ...p, address_street: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Número</label>
                  <input className="input" placeholder="123" value={empForm.address_number} onChange={e => setEmpForm(p => ({ ...p, address_number: e.target.value }))} />
                </div>
                <div>
                  <label className="label">CEP</label>
                  <input className="input" placeholder="00000-000" value={empForm.address_zip} onChange={e => setEmpForm(p => ({ ...p, address_zip: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Bairro</label>
                  <input className="input" value={empForm.address_neighborhood} onChange={e => setEmpForm(p => ({ ...p, address_neighborhood: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Cidade</label>
                  <input className="input" value={empForm.address_city} onChange={e => setEmpForm(p => ({ ...p, address_city: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Dados Bancários */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Dados Bancários</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Banco</label>
                  <input className="input" placeholder="Ex: Nubank, Itaú..." value={empForm.bank_name} onChange={e => setEmpForm(p => ({ ...p, bank_name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Agência</label>
                  <input className="input" placeholder="0000-0" value={empForm.bank_agency} onChange={e => setEmpForm(p => ({ ...p, bank_agency: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Conta Corrente</label>
                  <input className="input" placeholder="00000-0" value={empForm.bank_account} onChange={e => setEmpForm(p => ({ ...p, bank_account: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="label">Chave PIX</label>
                  <input className="input" placeholder="CPF, e-mail ou chave aleatória" value={empForm.pix} onChange={e => setEmpForm(p => ({ ...p, pix: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button className="btn-primary flex-1" onClick={() => finalizeHire.mutate(createEmpModal)} disabled={finalizeHire.isPending}>
                {finalizeHire.isPending ? 'Criando...' : 'Criar Colaborador →'}
              </button>
              <button className="btn-ghost px-4" onClick={() => setCreateEmpModal(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Match Card ───
function MatchCard({ candidate, onAdd, vacancy }: { candidate: Record<string, unknown> & { issues: string[]; score: number }; onAdd: () => void; vacancy: Record<string, unknown> }) {
  const msg = ((vacancy.whatsapp_message as string) || '').replace('[NOME]', candidate.full_name as string)
  return (
    <div className="card p-4 flex items-start justify-between gap-3 mb-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium">{candidate.full_name as string}</p>
          <span className={`badge text-xs ${candidate.score === 100 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{candidate.score}%</span>
        </div>
        <p className="text-xs text-gray-500">{[candidate.city, candidate.state].filter(Boolean).join(', ')}</p>
        <p className="text-xs text-gray-400">{candidate.formation as string}{candidate.experience_time ? ` · ${candidate.experience_time}` : ''}</p>
        {(candidate.issues as string[]).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {(candidate.issues as string[]).map((issue: string) => <span key={issue} className="badge bg-red-100 text-red-700 text-xs">{issue}</span>)}
          </div>
        )}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {candidate.whatsapp && (
          <a href={formatWhatsApp(candidate.whatsapp as string) + (msg ? `?text=${encodeURIComponent(msg)}` : '')} target="_blank" rel="noreferrer" className="btn-ghost p-2">
            <MessageCircle size={16} className="text-green-600" />
          </a>
        )}
        <button className="btn-primary text-xs px-3" onClick={onAdd}>+ Interessado</button>
      </div>
    </div>
  )
}

// ─── Contract Template Modal ───
function ContractTemplateModal({ candidate, vacancy, onClose }: {
  candidate: Record<string, unknown>
  vacancy: Record<string, unknown>
  onClose: () => void
}) {
  const clientName = (vacancy.client as { name?: string })?.name || vacancy.client_name || 'EMPRESA'
  const today = new Date().toLocaleDateString('pt-BR')

  const contractText = `
CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE NUTRIÇÃO

Pelo presente instrumento particular, as partes abaixo identificadas:

CONTRATANTE: ${clientName}
CNPJ/CPF: ___________________________
Endereço: ___________________________

CONTRATADO(A): ${candidate.full_name}
CPF: ___________________________
CRN: ${candidate.crn_number || '___________________________'}
Endereço: ___________________________

Têm entre si, justo e acordado, o seguinte:

CLÁUSULA 1ª – DO OBJETO
O(A) CONTRATADO(A) prestará serviços de nutrição para o CONTRATANTE, conforme requisitos da vaga "${vacancy.title}".

CLÁUSULA 2ª – DA REMUNERAÇÃO E PAGAMENTO
O valor e condições de pagamento serão conforme acordado entre as partes, com vencimento no dia 5 de cada mês.

CLÁUSULA 3ª – DO PRAZO
O presente contrato tem início em ${today} e vigorará conforme acordado.

CLÁUSULA 4ª – DAS OBRIGAÇÕES DO CONTRATADO(A)
a) Executar os serviços com zelo e competência;
b) Manter sigilo sobre informações do CONTRATANTE;
c) Registrar presença/visitas no sistema Time IN.

CLÁUSULA 5ª – DAS DISPOSIÇÕES GERAIS
Fica eleito o foro da comarca de São Paulo/SP para dirimir quaisquer dúvidas oriundas do presente contrato.

${today}

_____________________________          _____________________________
       CONTRATANTE                              CONTRATADO(A)
   ${clientName}                          ${candidate.full_name}
`

  const handlePrint = () => {
    const w = window.open('', '_blank')!
    w.document.write(`<html><head><title>Contrato – ${candidate.full_name}</title>
      <style>body{font-family:Arial,sans-serif;padding:40px;line-height:1.8;white-space:pre-wrap;font-size:14px}</style>
      </head><body>${contractText}</body></html>`)
    w.document.close()
    w.print()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl p-6 max-w-2xl w-full space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg flex items-center gap-2"><FileText size={20} /> Template de Contrato</h3>
          <button onClick={onClose} className="btn-ghost p-1 text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto border">
          {contractText}
        </div>
        <p className="text-xs text-gray-400">Revise os dados, clique em Baixar para imprimir como PDF, envie para o candidato assinar e depois clique em "Assinado ✓" na lista de interessados.</p>
        <div className="flex gap-3">
          <button className="btn-primary flex items-center gap-2" onClick={handlePrint}>
            <FileText size={16} /> Baixar / Imprimir PDF
          </button>
          <button className="btn-secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
