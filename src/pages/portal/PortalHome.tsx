import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Clock, Calendar, Plus, ChevronDown, ChevronUp, CalendarDays, Trash2, CheckCircle2, Download, MessageCircle, Send, Home, CreditCard, TrendingUp, CheckCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { format, getDaysInMonth, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'

type Tab = 'home' | 'folha' | 'agenda' | 'gastos' | 'duvidas'

export default function PortalHome() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const employeeId = localStorage.getItem('portal_employee_id')
  const employeeName = localStorage.getItem('portal_employee_name')
  const token = localStorage.getItem('portal_token')
  const [tab, setTab] = useState<Tab>('home')
  const [folhaMonth, setFolhaMonth] = useState(format(new Date(), 'yyyy-MM'))

  // Toda comunicação com o banco passa por funções portal_* validadas no servidor.
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      if (/sess[aã]o|28000|JWT|invalid/i.test(error.message)) {
        localStorage.removeItem('portal_token'); navigate('/portal')
      }
      throw error
    }
    return data as T
  }
  const sealClosed = () => {
    localStorage.removeItem('portal_token')
    localStorage.removeItem('portal_employee_id')
    localStorage.removeItem('portal_employee_name')
    localStorage.removeItem('portal_session_ts')
  }

  const [reportFile, setReportFile] = useState<File | null>(null)
  const reportRef = useRef<HTMLInputElement>(null)

  // Agenda state
  const [agendaForm, setAgendaForm] = useState<{ clientId: string; clientName: string } | null>(null)
  const [agendaEntry, setAgendaEntry] = useState({ planned_date: '', unit_id: '', notes: '' })
  const [reschedAgenda, setReschedAgenda] = useState<{ id: string; date: string } | null>(null)
  const [agendaMonth, setAgendaMonth] = useState(format(new Date(), 'yyyy-MM'))
  // Modal do dia clicado no calendário da escala (avisar falta / trocar dia)
  const [dayModal, setDayModal] = useState<{ date: string; linkId: string } | null>(null)
  const [noticeAction, setNoticeAction] = useState<'' | 'falta' | 'troca-folgar' | 'troca-trabalhar'>('')
  const [noticeForm, setNoticeForm] = useState({ reason: '', otherDate: '' })

  useEffect(() => {
    if (!token) { navigate('/portal'); return }
    const ts = Number(localStorage.getItem('portal_session_ts') || '0')
    const eightHours = 8 * 60 * 60 * 1000
    if (Date.now() - ts > eightHours) {
      sealClosed()
      toast('Sessão expirada. Faça login novamente.')
      navigate('/portal')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate])

  // Tudo num só lugar, validado no servidor: vínculos, unidades, agenda, avisos, mensagens
  type PortalBase = {
    links: Record<string, unknown>[]
    units: Record<string, unknown>[]
    notices: Record<string, unknown>[]
    questions: Record<string, unknown>[]
    agenda: Record<string, unknown>[]
  }
  const { data: base, error: baseError } = useQuery({
    queryKey: ['portal-base', employeeId],
    queryFn: () => rpc<PortalBase>('portal_base', { p_token: token }),
    enabled: !!token,
  })

  useEffect(() => {
    if (baseError && /sess[aã]o|28000/i.test((baseError as Error).message)) {
      sealClosed(); navigate('/portal')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseError])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const links = base?.links as any[] | undefined
  const allUnits = base?.units as any[] | undefined
  const agenda = base?.agenda as any[] | undefined
  const notices = base?.notices as any[] | undefined
  const myDuvidas = base?.questions as any[] | undefined

  type Notice = { id: string; client_id: string; type: 'falta' | 'troca'; notice_date: string; swap_work_date?: string | null; reason?: string | null }

  const lastChatSeen = Number(localStorage.getItem(`portal_chat_seen_${employeeId}`) || '0')
  const unreadChats = myDuvidas?.filter(d => {
    if ((d as { initiated_by_admin?: boolean }).initiated_by_admin) return true
    const answeredAt = (d as { answered_at?: string }).answered_at
    return !!answeredAt && new Date(answeredAt).getTime() > lastChatSeen
  }).length ?? 0
  const markChatSeen = () => localStorage.setItem(`portal_chat_seen_${employeeId}`, Date.now().toString())

  const addNotice = useMutation({
    mutationFn: async (n: { client_id: string; type: 'falta' | 'troca'; notice_date: string; swap_work_date?: string | null; reason?: string | null }) => {
      await rpc('portal_save_notice', { p_token: token, p_payload: n })
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.type === 'falta' ? 'Falta avisada! O RH foi notificado.' : 'Troca de dia registrada!')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      setDayModal(null)
      setNoticeAction('')
      setNoticeForm({ reason: '', otherDate: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteNotice = useMutation({
    mutationFn: async (noticeId: string) => {
      await rpc('portal_delete_notice', { p_token: token, p_id: noticeId })
    },
    onSuccess: () => {
      toast.success('Aviso removido.')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Dados de um mês (visitas + gastos), validados no servidor
  type PortalMonth = { visits: Record<string, unknown>[]; expenses: Record<string, unknown>[] }
  const { data: monthFolha } = useQuery({
    queryKey: ['portal-month', employeeId, folhaMonth],
    queryFn: () => rpc<PortalMonth>('portal_month', { p_token: token, p_month: folhaMonth }),
    enabled: !!token,
  })
  const { data: monthAgenda } = useQuery({
    queryKey: ['portal-month', employeeId, agendaMonth],
    queryFn: () => rpc<PortalMonth>('portal_month', { p_token: token, p_month: agendaMonth }),
    enabled: !!token && tab === 'agenda',
  })
  const agendaVisits = monthAgenda?.visits as any[] | undefined

  // Valor da visita (Consultoria) = valor da vistoria da unidade × (horas da visita ÷ horas da semana), limitado ao valor cheio.
  // Semana cheia em uma unidade só = valor inteiro daquela unidade; dividiu entre unidades = proporcional em cada.
  const calcVisitAmount = (unitRate: number | null, checkIn: string, checkOut: string, weeklyQuota: number | null) => {
    if (!unitRate) return null
    const hours = calcDurationMin(checkIn, checkOut) / 60
    if (hours <= 0) return null
    const factor = weeklyQuota && weeklyQuota > 0 ? Math.min(1, hours / weeklyQuota) : 1
    return Math.round(unitRate * factor * 100) / 100
  }

  const addAgenda = useMutation({
    mutationFn: async () => {
      if (!agendaForm || !agendaEntry.planned_date) throw new Error('Selecione um dia')
      const unit = (allUnits as { id: string; name: string }[] | undefined)?.find(u => u.id === agendaEntry.unit_id)
      // Consultoria planeja só o DIA (sem horário) + observação opcional. O horário é preenchido ao confirmar a visita.
      await rpc('portal_save_agenda', { p_token: token, p_payload: {
        client_id: agendaForm.clientId,
        unit_id: agendaEntry.unit_id || null,
        planned_date: agendaEntry.planned_date,
        notes: agendaEntry.notes || (unit ? unit.name : null),
      } })
    },
    onSuccess: () => {
      toast.success('Agenda atualizada!')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      setAgendaForm(null)
      setAgendaEntry({ planned_date: '', unit_id: '', notes: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAgenda = useMutation({
    mutationFn: async (id: string) => {
      await rpc('portal_delete_agenda', { p_token: token, p_id: id })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }),
  })

  // Remarcar a data de uma visita planejada — guarda a data original; o chefe vê na agenda dela
  const rescheduleAgenda = useMutation({
    mutationFn: async ({ id, newDate, currentDate, originalDate }: { id: string; newDate: string; currentDate: string; originalDate: string | null }) => {
      await rpc('portal_reschedule_agenda', { p_token: token, p_id: id, p_new_date: newDate, p_original: originalDate || currentDate })
    },
    onSuccess: () => {
      toast.success('Visita remarcada!')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      setReschedAgenda(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const registrarPonto = useMutation({
    mutationFn: async () => {
      if (!pontoForm.client_id) throw new Error('Selecione o cliente')
      if (!pontoForm.visit_date) throw new Error('Informe a data')
      const link = getLinkForClient(pontoForm.client_id)
      const isConsultoria = effectiveType(link) === 'Consultoria'

      if ((isConsultoria || pontoForm.day_type === 'normal') && (!pontoForm.check_in || !pontoForm.check_out))
        throw new Error('Informe os horários de entrada e saída')
      if (!isConsultoria && pontoForm.day_type === 'indisponivel' && !pontoForm.unavailability_reason)
        throw new Error('Informe o motivo da falta')

      const isNormal = isConsultoria || pontoForm.day_type === 'normal'

      // Visitas do mesmo cliente/mês já carregadas (sem nova consulta ao banco)
      const sameMonthVisits = ((monthFolha?.visits as { id: string; client_id: string; visit_date: string; check_in?: string; check_out?: string }[] | undefined) || [])
        .filter(v => v.client_id === pontoForm.client_id && v.visit_date.slice(0, 7) === pontoForm.visit_date.slice(0, 7) && v.id !== editingPontoId)

      // Fixo: um registro por dia — duplicado infla horas e dias trabalhados (Consultoria pode ter 2+ visitas/dia)
      if (!isConsultoria && !editingPontoId && sameMonthVisits.some(v => v.visit_date === pontoForm.visit_date)) {
        throw new Error(`Já existe um registro em ${formatDate(pontoForm.visit_date)} — toque no ✏️ do registro para editá-lo.`)
      }

      // Consultoria: valor da visita pela fórmula unidade × (horas ÷ semana cheia)
      let visitAmount: number | null = null
      let extraApproval: string | null = null
      let proposedAmount: number | null = null
      if (isConsultoria) {
        const unit = getLinkUnitsForClient(pontoForm.client_id).find(u => u.id === pontoForm.unit_id)
        visitAmount = calcVisitAmount(unit?.visit_rate ?? null, pontoForm.check_in, pontoForm.check_out, Number(link?.weekly_hours_quota) || null)

        // Acima do combinado de HORAS no mês (tolerância de 1h): a visita registra, mas o
        // pagamento fica "aguardando" — o chefe é notificado e decide se paga o excedente.
        const monthlyQuota = Number((link as { monthly_hours_quota?: number } | undefined)?.monthly_hours_quota) || null
        const thisHours = calcDurationMin(pontoForm.check_in, pontoForm.check_out) / 60
        if (visitAmount != null && monthlyQuota && thisHours > 0) {
          const hoursSoFar = sameMonthVisits.reduce((s, v) => s + calcDurationMin((v.check_in || '').slice(0,5), (v.check_out || '').slice(0,5)) / 60, 0)
          if (hoursSoFar + thisHours > monthlyQuota + 1) {
            extraApproval = 'pendente'
            proposedAmount = visitAmount
            visitAmount = null
          }
        }
      }

      // Fixo: troca de dia (sem pagamento extra) ou dia extra (pago a salário ÷ 30) — mutuamente exclusivos
      const isSwap = !isConsultoria && isNormal && pontoForm.is_swap && !!pontoForm.swapped_from
      const isExtra = !isConsultoria && isNormal && pontoForm.is_extra && !isSwap
      // Fixo: valor não calculado automaticamente — admin define no painel de visitas
      const fixoProposedAmount = isExtra && link?.monthly_amount ? Math.round((Number(link.monthly_amount) / 30) * 100) / 100 : null

      const payload: Record<string, unknown> = {
        ...(editingPontoId ? { id: editingPontoId } : {}),
        client_id: pontoForm.client_id,
        visit_date: pontoForm.visit_date,
        check_in: isNormal ? pontoForm.check_in : null,
        check_out: isNormal ? pontoForm.check_out : null,
        break_start: isNormal && !isConsultoria ? (pontoForm.break_start || null) : null,
        break_end: isNormal && !isConsultoria ? (pontoForm.break_end || null) : null,
        is_holiday: !isConsultoria && pontoForm.day_type === 'feriado',
        is_unavailable: !isConsultoria && pontoForm.day_type === 'indisponivel',
        unavailability_reason: !isConsultoria && pontoForm.day_type === 'indisponivel' ? pontoForm.unavailability_reason : null,
        observations: pontoForm.observations || null,
        unit_id: isConsultoria ? (pontoForm.unit_id || null) : null,
        unit_name: isConsultoria ? (pontoForm.unit_name || null) : null,
        visit_rate: isConsultoria ? visitAmount : null,
        extra_approval: isConsultoria ? extraApproval : (isExtra ? 'pendente' : null),
        proposed_amount: isConsultoria ? proposedAmount : fixoProposedAmount,
        is_extra: isExtra,
        extra_amount: null, // admin define o valor no painel de Visitas
        is_swap: isSwap,
        swapped_from: isSwap ? pontoForm.swapped_from : null,
      }

      const recordId = await rpc<string>('portal_save_visit', { p_token: token, p_payload: payload })

      // Upload atestado (falta) ou relatório (consultoria) — o arquivo vai pro storage e a URL é gravada via função
      if (atestadoFile && recordId) {
        const ext = atestadoFile.name.split('.').pop()
        const path = `atestados/${employeeId}/${recordId}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(path, atestadoFile, { upsert: true })
        if (!upErr) {
          await rpc('portal_set_visit_file', { p_token: token, p_id: recordId, p_field: 'atestado_url', p_url: path })
        }
      }
      if (reportFile && recordId && isConsultoria) {
        const ext = reportFile.name.split('.').pop()
        const path = `relatorios/${employeeId}/${recordId}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(path, reportFile, { upsert: true })
        if (!upErr) {
          await rpc('portal_set_visit_file', { p_token: token, p_id: recordId, p_field: 'report_url', p_url: path })
        }
      }
    },
    onSuccess: () => {
      toast.success(editingPontoId ? 'Registro atualizado!' : pontoForm.day_type === 'feriado' ? 'Feriado registrado!' : pontoForm.day_type === 'indisponivel' ? 'Falta registrada!' : 'Registro salvo!')
      qc.invalidateQueries({ queryKey: ['portal-month', employeeId] })
      setShowPontoModal(false)
      setPontoForm(EMPTY_PONTO)
      setAtestadoFile(null)
      setReportFile(null)
      setEditingPontoId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deletePonto = useMutation({
    mutationFn: async (visitId: string) => {
      await rpc('portal_delete_visit', { p_token: token, p_id: visitId })
    },
    onSuccess: () => {
      toast.success('Registro excluído.')
      qc.invalidateQueries({ queryKey: ['portal-month', employeeId] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showPontoModal, setShowPontoModal] = useState(false)
  const [editingPontoId, setEditingPontoId] = useState<string | null>(null)
  const EMPTY_PONTO = {
    visit_date: new Date().toISOString().slice(0, 10),
    client_id: '',
    day_type: 'normal' as 'normal' | 'feriado' | 'indisponivel',
    check_in: '', check_out: '',
    break_start: '', break_end: '',
    unavailability_reason: '',
    observations: '',
    unit_id: '', unit_name: '',
    is_extra: false,
    is_swap: false, swapped_from: '',
  }
  const [pontoForm, setPontoForm] = useState(EMPTY_PONTO)
  const [atestadoFile, setAtestadoFile] = useState<File | null>(null)
  const atestadoRef = useRef<HTMLInputElement>(null)
  const [expenseForm, setExpenseForm] = useState({ description: '', amount: '', category: 'Reembolso', notes: '' })
  const [showExpForm, setShowExpForm] = useState(false)
  const [uploadingExpId, setUploadingExpId] = useState<string | null>(null)
  const expReceiptRef = useRef<HTMLInputElement>(null)
  const [pendingExpenseUpload, setPendingExpenseUpload] = useState<string | null>(null)

  // Mesmos vínculos do base (portal_base devolve todas as colunas do vínculo)
  // Volante: só mostra coberturas dentro do período ativo (start_date ≤ hoje ≤ contract_end_date)
  const _today = new Date().toISOString().slice(0, 10)
  const folhaLinks = links?.filter((l: Record<string, unknown>) => {
    if (l.service_type !== 'Volante') return true
    const start = (l.start_date as string) || ''
    const end = (l.contract_end_date as string) || ''
    return (!start || start <= _today) && (!end || end >= _today)
  })

  type FolhaLink = { id: string; service_type: string; coverage_type?: string; start_date?: string; contract_end_date?: string; monthly_amount?: number; work_schedule?: string; work_schedule_type?: string; daily_hours?: number; days_off?: number[]; schedule_anchor_date?: string; weekly_hours_quota?: number; monthly_hours_quota?: number; visits_per_week?: number; pay_extra_visits?: boolean; link_units?: { unit_id: string; unit_name: string; visit_rate?: number }[]; client?: { id: string; name: string } }

  const getLinkForClient = (clientId: string) => (folhaLinks as FolhaLink[] | undefined)?.find(l => l.client?.id === clientId)

  // Volante: o comportamento do portal segue coverage_type (Fixo ou Consultoria), não service_type
  const effectiveType = (link: FolhaLink | undefined) =>
    link?.service_type === 'Volante' ? (link.coverage_type || 'Fixo') : (link?.service_type || 'Fixo')

  // Dia de folga pela escala: 5x2/6x1 = dias fixos da semana; 12x36 = alterna a partir da âncora (dia sim, dia não)
  const isDayOff = (link: FolhaLink | undefined, dateStr: string) => {
    if (!link || !dateStr) return false
    if (effectiveType(link) === 'Consultoria') return false
    if (link.work_schedule_type === '12x36' && link.schedule_anchor_date) {
      const diff = Math.round((new Date(dateStr + 'T12:00:00').getTime() - new Date(link.schedule_anchor_date + 'T12:00:00').getTime()) / 86400000)
      return ((diff % 2) + 2) % 2 === 1 // âncora é dia de trabalho; o seguinte é folga
    }
    if (!link.days_off?.length) return false
    const weekday = new Date(dateStr + 'T12:00:00').getDay()
    return link.days_off.includes(weekday)
  }

  // A escala tem dias de trabalho conhecidos? (5x2/6x1 com folga fixa, ou 12x36 com âncora)
  const hasKnownSchedule = (link: FolhaLink | undefined) =>
    !!link && effectiveType(link) !== 'Consultoria' &&
    (!!link.days_off?.length || (link.work_schedule_type === '12x36' && !!link.schedule_anchor_date))

  // Dias da escala sem preenchimento (até ontem). Dias cobertos por "troca de dia" não contam como pendentes.
  const getPendingDays = (link: FolhaLink | undefined) => {
    if (!link || !hasKnownSchedule(link)) return []
    const monthStart = startOfMonth(new Date(folhaMonth + '-15'))
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(23, 59, 59, 0)
    const monthEnd = endOfMonth(new Date(folhaMonth + '-15'))
    const limit = monthEnd < yesterday ? monthEnd : yesterday
    // Só conta a partir da data de início do vínculo (não cobra dias antes de ser contratado)
    const linkStart = link.start_date ? new Date(link.start_date + 'T12:00:00') : monthStart
    const effectiveStart = linkStart > monthStart ? linkStart : monthStart
    if (limit < effectiveStart) return []
    const clientVisits = (folhaVisits || []).filter(v => v.client_id === link.client?.id)
    const filled = new Set(clientVisits.map(v => v.visit_date))
    const swappedFrom = new Set(clientVisits.map(v => (v as { swapped_from?: string }).swapped_from).filter(Boolean))
    // Dias com aviso (falta avisada ou troca combinada) não são cobrados como pendentes
    const noticed = new Set((notices || []).filter(n => n.client_id === link.client?.id).map(n => n.notice_date))
    const pending: string[] = []
    const d = new Date(effectiveStart)
    while (d <= limit) {
      const ds = d.toISOString().slice(0, 10)
      if (!isDayOff(link, ds) && !filled.has(ds) && !swappedFrom.has(ds) && !noticed.has(ds)) pending.push(ds)
      d.setDate(d.getDate() + 1)
    }
    return pending
  }

  // Troca combinada pela agenda: ao registrar ponto no dia trocado, pré-preenche a troca
  useEffect(() => {
    if (!showPontoModal || editingPontoId || !pontoForm.visit_date || !pontoForm.client_id) return
    const trocaNotice = (notices as Notice[] | undefined)?.find(n =>
      n.type === 'troca' && n.client_id === pontoForm.client_id && n.swap_work_date === pontoForm.visit_date)
    if (trocaNotice && !pontoForm.is_swap && !pontoForm.is_extra) {
      setPontoForm(p => ({ ...p, is_swap: true, swapped_from: trocaNotice.notice_date }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPontoModal, pontoForm.visit_date, pontoForm.client_id, notices])

  const folhaVisits = monthFolha?.visits as any[] | undefined
  const myExpenses = monthFolha?.expenses as any[] | undefined

  const submitExpense = useMutation({
    mutationFn: async () => {
      if (!expenseForm.description || !expenseForm.amount) throw new Error('Preencha descrição e valor')
      return await rpc<string>('portal_add_expense', { p_token: token, p_payload: {
        description: expenseForm.description,
        amount: Number(expenseForm.amount),
        category: expenseForm.category,
        notes: expenseForm.notes || null,
        reference_month: folhaMonth,
      } })
    },
    onSuccess: () => {
      toast.success('Gasto registrado! Aguardando aprovação do gestor.')
      qc.invalidateQueries({ queryKey: ['portal-month', employeeId] })
      setExpenseForm({ description: '', amount: '', category: 'Reembolso', notes: '' })
      setShowExpForm(false)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const uploadReceipt = async (expenseId: string, file: File) => {
    setUploadingExpId(expenseId)
    try {
      const ext = file.name.split('.').pop()
      const path = `receipts/${employeeId}/${expenseId}.${ext}`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
      if (upErr) { toast.error('Erro ao enviar: ' + upErr.message); return }
      await rpc('portal_set_expense_receipt', { p_token: token, p_id: expenseId, p_url: path })
      qc.invalidateQueries({ queryKey: ['portal-month', employeeId] })
      toast.success('Comprovante enviado!')
    } finally {
      setUploadingExpId(null)
      setPendingExpenseUpload(null)
    }
  }

  // Saída menor que entrada = turno que vira a meia-noite (ex: 12x36 noturno 19:00 → 07:00)
  const calcDurationMin = (ci: string, co: string) => {
    if (!ci || !co || ci === co) return 0
    const [h1, m1] = ci.split(':').map(Number)
    const [h2, m2] = co.split(':').map(Number)
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    return diff > 0 ? diff : diff + 24 * 60
  }

  const downloadFolha = () => {
    const monthLabel = new Date(folhaMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    const totalDias = (folhaVisits || []).filter(v => v.check_out).length
    const totalMins = (folhaVisits || []).reduce((s, v) => s + (v.check_in && v.check_out ? calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5)) : 0), 0)
    const totalH = Math.floor(totalMins / 60)
    const totalM = totalMins % 60

    const rows = (folhaVisits || []).map(v => `
      <tr>
        <td>${formatDate(v.visit_date)}</td>
        <td>${v.check_in?.slice(0,5) || '-'}</td>
        <td>${v.check_out?.slice(0,5) || '-'}</td>
        <td>${v.check_in && v.check_out ? `${Math.floor(calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))/60)}h${calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))%60>0?calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))%60+'min':''}` : '-'}</td>
        <td>${(v as { client?: { name: string } }).client?.name || '-'}</td>
        <td>${v.observations || ''}</td>
      </tr>
    `).join('')

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Folha de Ponto – ${monthLabel}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #1a1a1a; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 14px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f3f4f6; text-align: left; padding: 8px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e5e7eb; }
        td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
        tr:last-child td { border-bottom: none; }
        .totals { margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; display: flex; gap: 40px; }
        .total-item { }
        .total-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
        .total-value { font-size: 18px; font-weight: bold; margin-top: 2px; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; color: #9ca3af; }
        .assinatura { border-top: 1px solid #d1d5db; padding-top: 8px; width: 200px; text-align: center; }
      </style>
      </head><body>
      <h1>Folha de Ponto — ${employeeName}</h1>
      <div class="sub">${monthLabel}</div>
      <table>
        <thead><tr><th>Data</th><th>Entrada</th><th>Saída</th><th>Duração</th><th>Local</th><th>Observações</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="color:#9ca3af">Nenhum registro</td></tr>'}</tbody>
      </table>
      <div class="totals">
        <div class="total-item"><div class="total-label">Dias Trabalhados</div><div class="total-value">${totalDias}</div></div>
        <div class="total-item"><div class="total-label">Horas Totais</div><div class="total-value">${totalH}h${totalM > 0 ? totalM + 'min' : ''}</div></div>
      </div>
      <div class="footer">
        <div class="assinatura">_____________________<br/>Colaborador</div>
        <div class="assinatura">_____________________<br/>Gestor</div>
      </div>
      <script>window.print()</script>
      </body></html>
    `
    const w = window.open('', '_blank')!
    w.document.write(html)
    w.document.close()
  }

  // ── Dúvidas ── (myDuvidas vem do portal_base)
  const [duvidaText, setDuvidaText] = useState('')

  const enviarDuvida = useMutation({
    mutationFn: async (message: string) => {
      await rpc('portal_ask_question', { p_token: token, p_message: message })
    },
    onSuccess: () => {
      toast.success('Mensagem enviada! O RH vai responder em breve.')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      setDuvidaText('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const logout = () => {
    if (token) supabase.rpc('portal_logout', { p_token: token }).catch(() => {})
    sealClosed()
    navigate('/portal')
  }

  const getUnitsForClient = (clientId: string) =>
    allUnits?.filter(u => u.client_id === clientId) ?? []

  const calcDuration = (ci: string, co: string) => {
    const mins = calcDurationMin(ci, co)
    if (mins <= 0) return ''
    return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''}`
  }

  // Unidades do vínculo (link_units) com valor da vistoria; se não configuradas, as do cliente (sem valor)
  const getLinkUnitsForClient = (clientId: string): { id: string; name: string; visit_rate: number | null }[] => {
    const link = links?.find(l => (l as { client?: { id: string } }).client?.id === clientId)
    const lu = (link as { link_units?: { unit_id: string; unit_name: string; visit_rate?: number }[] } | undefined)?.link_units
    if (lu?.length) {
      return lu.map(u => ({ id: u.unit_id, name: u.unit_name, visit_rate: Number(u.visit_rate) || null }))
    }
    return getUnitsForClient(clientId).map(u => ({ id: u.id as string, name: u.name as string, visit_rate: null }))
  }

  return (
    <div className="min-h-screen overflow-x-hidden pb-8" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
      {/* Header com faixa de marca */}
      <div className="bg-gradient-to-br from-primary-600 to-primary-700 text-white px-4 pt-5 pb-4" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center text-white font-display font-extrabold ring-1 ring-white/25">
              {employeeName.split(' ').map(n => n[0]).slice(0, 2).join('')}
            </div>
            <div>
              <p className="font-display font-bold text-base leading-tight">{employeeName}</p>
              <p className="text-xs text-white/70">TIN · Portal do Nutricionista</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white px-2.5 py-1.5 rounded-xl hover:bg-white/10 active:scale-95 transition-all">
            <LogOut size={16} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>

      {/* Tabs — 5 abas compactas */}
      <div className="sticky top-0 z-20 bg-[#f6f7f6]/90 backdrop-blur border-b border-ink-100">
        <div className="max-w-lg mx-auto flex gap-1 p-2">
          {([
            ['home',    Home,          'Início',   null],
            ['folha',   Clock,         'Ponto',    null],
            ['agenda',  CalendarDays,  'Agenda',   null],
            ['gastos',  CreditCard,    'Gastos',   null],
            ['duvidas', MessageCircle, 'Chat',     unreadChats],
          ] as const).map(([key, Icon, label, badge]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key as Tab)
                if (key === 'duvidas') markChatSeen()
              }}
              className={`flex-1 py-2 px-1 text-xs font-semibold flex flex-col items-center gap-0.5 rounded-xl transition-all active:scale-[0.97] relative ${tab === key ? 'bg-white text-primary-700 shadow-soft' : 'text-ink-500 hover:bg-white/60'}`}
            >
              <Icon size={17} />
              <span className="leading-none">{label}</span>
              {(badge ?? 0) > 0 && (
                <span className="absolute top-1 right-2 min-w-[16px] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4">

        {/* ─── HOME TAB ─── */}
        {tab === 'home' && (() => {
          const todayStr = new Date().toISOString().slice(0, 10)
          const currentMonth = format(new Date(), 'yyyy-MM')
          const allVisits = (monthFolha?.visits as { client_id?: string; check_out?: string; is_unavailable?: boolean; visit_date?: string }[] | undefined) || []
          const daysWorkedTotal = allVisits.filter(v => v.check_out && !v.is_unavailable).length
          const pendingAll = (folhaLinks as FolhaLink[] | undefined)?.flatMap(l => getPendingDays(l)) ?? []
          const monthLabel = new Date(currentMonth + '-15').toLocaleDateString('pt-BR', { month: 'long' })
          return (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl p-4 shadow-soft border border-ink-100">
                <p className="text-xs text-ink-400 mb-1">Olá,</p>
                <h2 className="text-xl font-display font-extrabold text-ink-900 leading-tight">{employeeName.split(' ')[0]} 👋</h2>
                <p className="text-xs text-ink-400 mt-0.5">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>

              {/* Stats do mês */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-2xl p-4 border border-blue-100">
                  <p className="text-3xl font-display font-extrabold text-blue-700 leading-none">{daysWorkedTotal}</p>
                  <p className="text-xs text-blue-500 mt-1 font-medium">dias registrados</p>
                  <p className="text-[10px] text-blue-400 capitalize">{monthLabel}</p>
                </div>
                <div className={`rounded-2xl p-4 border ${pendingAll.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-100'}`}>
                  {pendingAll.length > 0 ? (
                    <>
                      <p className="text-3xl font-display font-extrabold text-amber-600 leading-none">{pendingAll.length}</p>
                      <p className="text-xs text-amber-500 mt-1 font-medium">dias pendentes</p>
                      <p className="text-[10px] text-amber-400">preencha a folha</p>
                    </>
                  ) : (
                    <>
                      <div className="text-green-500 mb-1"><CheckCheck size={22} /></div>
                      <p className="text-xs text-green-700 font-semibold">Folha em dia!</p>
                      <p className="text-[10px] text-green-400">nenhum dia pendente</p>
                    </>
                  )}
                </div>
              </div>

              {/* Alertas rápidos */}
              {unreadChats > 0 && (
                <button
                  onClick={() => { setTab('duvidas'); markChatSeen() }}
                  className="w-full flex items-center gap-3 bg-primary-50 border border-primary-200 rounded-2xl p-4 text-left active:scale-[0.99] transition-all"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white flex-shrink-0">
                    <MessageCircle size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-primary-800">
                      {unreadChats === 1 ? 'O RH te enviou uma mensagem' : `${unreadChats} mensagens do RH`}
                    </p>
                    <p className="text-xs text-primary-500">Toque para ver</p>
                  </div>
                  <span className="w-5 h-5 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">{unreadChats}</span>
                </button>
              )}

              {pendingAll.length > 0 && (
                <button
                  onClick={() => setTab('folha')}
                  className="w-full flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-left active:scale-[0.99] transition-all"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center text-white flex-shrink-0">
                    <Clock size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-800">{pendingAll.length} dia{pendingAll.length > 1 ? 's' : ''} sem preenchimento</p>
                    <p className="text-xs text-amber-500">Próximo: {formatDate(pendingAll[0])}</p>
                  </div>
                </button>
              )}

              {/* Próxima visita agendada */}
              {(() => {
                const next = (agenda as { planned_date?: string; client?: { name: string }; notes?: string }[] | undefined)
                  ?.filter(a => (a.planned_date || '') >= todayStr)
                  .sort((a, b) => (a.planned_date || '').localeCompare(b.planned_date || ''))[0]
                if (!next) return null
                return (
                  <button onClick={() => setTab('agenda')} className="w-full flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-2xl p-4 text-left active:scale-[0.99] transition-all">
                    <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white flex-shrink-0">
                      <CalendarDays size={18} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-orange-800">Próxima visita planejada</p>
                      <p className="text-xs text-orange-500">{formatDate(next.planned_date || '')} · {next.notes || next.client?.name}</p>
                    </div>
                  </button>
                )
              })()}

              {/* Ações rápidas */}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setEditingPontoId(null); setPontoForm(EMPTY_PONTO); setAtestadoFile(null); setReportFile(null); setShowPontoModal(true) }}
                  className="btn-primary py-3 flex-col h-auto gap-1 rounded-2xl">
                  <Plus size={20} />
                  <span className="text-sm">Registrar dia</span>
                </button>
                <button onClick={() => setTab('agenda')}
                  className="btn-secondary py-3 flex-col h-auto gap-1 rounded-2xl">
                  <CalendarDays size={20} />
                  <span className="text-sm">Ver agenda</span>
                </button>
              </div>
            </div>
          )
        })()}

        {/* ─── FOLHA DE PONTO TAB ─── */}
        {tab === 'folha' && (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title text-lg">Folha de Ponto</h2>
                  <p className="text-xs text-ink-400 mt-0.5">Seus registros de ponto do mês.</p>
                </div>
                <input className="input w-36 text-sm shrink-0" type="month" value={folhaMonth} onChange={e => setFolhaMonth(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowPontoModal(true)} className="btn-primary text-sm flex-1">
                  <Plus size={16} /> Registrar dia
                </button>
                <button onClick={downloadFolha} className="btn-secondary text-sm">
                  <Download size={16} />PDF
                </button>
              </div>
            </div>

            {/* Summary */}
            {(folhaLinks as FolhaLink[] | undefined)?.map(link => {
              const client = link.client
              const clientVisits = folhaVisits?.filter(v => v.client_id === client?.id) ?? []
              const daysWorked = clientVisits.filter(v => v.check_out && !(v as { is_unavailable?: boolean }).is_unavailable).length
              const isConsultoria = effectiveType(link) === 'Consultoria'
              const earnings = isConsultoria ? clientVisits.reduce((s, v) => s + (Number(v.visit_rate) || 0), 0) : null
              const pendingDays = !isConsultoria ? getPendingDays(link) : []
              const extraDays = !isConsultoria ? clientVisits.filter(v => (v as { is_extra?: boolean }).is_extra) : []
              const extraTotal = extraDays.reduce((s, v) => s + (Number((v as { extra_amount?: number }).extra_amount) || 0), 0)
              const faltas = clientVisits.filter(v => (v as { is_unavailable?: boolean }).is_unavailable)
              const monthlyQuota = Number(link.monthly_hours_quota) || null
              const weeklyQuota = Number(link.weekly_hours_quota) || null
              const weeklyCapMins = weeklyQuota ? weeklyQuota * 60 : Infinity

              // Consultoria: cada visita conta no máximo a cota semanal (excesso vai para aprovação)
              const totalMins = clientVisits.reduce((s, v) => {
                if (!v.check_in || !v.check_out || (v as { is_unavailable?: boolean }).is_unavailable) return s
                const raw = calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))
                const bs = (v as { break_start?: string }).break_start, be = (v as { break_end?: string }).break_end
                const brk = bs && be ? calcDurationMin(bs.slice(0,5), be.slice(0,5)) : 0
                const net = Math.max(0, raw - brk)
                return s + (isConsultoria ? Math.min(net, weeklyCapMins) : net)
              }, 0)
              const excessMins = isConsultoria ? clientVisits.reduce((s, v) => {
                if (!v.check_in || !v.check_out || (v as { is_unavailable?: boolean }).is_unavailable) return s
                const raw = calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))
                const bs = (v as { break_start?: string }).break_start, be = (v as { break_end?: string }).break_end
                const brk = bs && be ? calcDurationMin(bs.slice(0,5), be.slice(0,5)) : 0
                const net = Math.max(0, raw - brk)
                return s + Math.max(0, net - weeklyCapMins)
              }, 0) : 0
              const monthHours = totalMins / 60
              const fmtH = (h: number) => `${Math.floor(h)}h${Math.round((h % 1) * 60) > 0 ? Math.round((h % 1) * 60) + 'min' : ''}`
              const linkUnits = isConsultoria && client ? getLinkUnitsForClient(client.id).filter(u => u.visit_rate) : []

              // Fixo: horas extras = horas trabalhadas além da jornada diária. Valor/hora = salário ÷ dias trabalhados ÷ jornada diária.
              const dailyHours = !isConsultoria ? (Number(link.daily_hours) || null) : null
              let extraHours = 0
              if (dailyHours) {
                for (const v of clientVisits) {
                  if ((v as { is_unavailable?: boolean }).is_unavailable || (v as { is_extra?: boolean }).is_extra) continue
                  if (!v.check_in || !v.check_out) continue
                  const raw = calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5))
                  const bs = (v as { break_start?: string }).break_start, be = (v as { break_end?: string }).break_end
                  const brk = bs && be ? calcDurationMin(bs.slice(0,5), be.slice(0,5)) : 0
                  const net = Math.max(0, raw - brk) / 60
                  if (net > dailyHours) extraHours += net - dailyHours
                }
              }
              // Dias de trabalho do mês pela escala (não pelos registros — senão o valor-hora infla no começo do mês)
              let scheduledDays: number | null = null
              if (!isConsultoria && hasKnownSchedule(link)) {
                const dim = getDaysInMonth(new Date(folhaMonth + '-15'))
                scheduledDays = 0
                for (let i = 1; i <= dim; i++) {
                  if (!isDayOff(link, `${folhaMonth}-${String(i).padStart(2, '0')}`)) scheduledDays++
                }
              }
              const baseDays = scheduledDays || daysWorked
              const hourlyRate = (!isConsultoria && Number(link.monthly_amount) && baseDays && dailyHours)
                ? Number(link.monthly_amount) / baseDays / dailyHours : null
              const extraHoursValue = hourlyRate ? Math.round(extraHours * hourlyRate * 100) / 100 : null

              return (
                <div key={link.id} className="card overflow-hidden">
                  {/* Cabeçalho do cliente */}
                  <div className={`px-4 py-3.5 flex items-center justify-between ${isConsultoria ? 'bg-orange-50/60' : 'bg-blue-50/60'} border-b ${isConsultoria ? 'border-orange-100' : 'border-blue-100'}`}>
                    <div className="min-w-0">
                      <p className="font-display font-bold text-ink-900 truncate">{client?.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`badge text-[10px] ${isConsultoria ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{effectiveType(link)}{link.service_type === 'Volante' ? ' (Volante)' : ''}</span>
                        {(link as { work_schedule?: string }).work_schedule && <span className="badge bg-white text-ink-500 text-[10px]">{(link as { work_schedule?: string }).work_schedule}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-3">
                      <p className={`text-3xl font-display font-extrabold leading-none tnum ${isConsultoria ? 'text-orange-600' : 'text-blue-600'}`}>{isConsultoria ? clientVisits.length : daysWorked}</p>
                      <p className="text-[11px] text-ink-400 mt-1">{isConsultoria ? 'visitas' : 'dias'}</p>
                    </div>
                  </div>

                  <div className="p-4 space-y-2.5">
                  {!isConsultoria && (
                    <>
                      <div className="rounded-xl bg-ink-50 px-3.5 py-2.5 flex items-center justify-between">
                        <span className="text-sm text-ink-500 font-medium">Total de horas</span>
                        <span className="font-display font-bold text-ink-900 tnum">{Math.floor(totalMins/60)}h{totalMins%60>0?totalMins%60+'min':''}</span>
                      </div>
                      {extraDays.length > 0 && (
                        <div className="rounded-xl bg-primary-50 px-3.5 py-2.5 flex items-center justify-between">
                          <span className="text-sm text-primary-700 font-medium">⭐ {extraDays.length} dia(s) extra{extraDays.length > 1 ? 's' : ''}</span>
                          <span className="font-bold text-primary-700 tnum">+ R$ {extraTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {extraHours > 0.05 && (
                        <div className="rounded-xl bg-primary-50 px-3.5 py-2.5 flex items-center justify-between">
                          <span className="text-sm text-primary-700 font-medium">⏱ {fmtH(extraHours)} de hora extra{hourlyRate ? ` · R$ ${hourlyRate.toFixed(2)}/h` : ''}</span>
                          {extraHoursValue ? <span className="font-bold text-primary-700 tnum">+ R$ {extraHoursValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span> : null}
                        </div>
                      )}
                      {faltas.length > 0 && (
                        <div className="rounded-xl bg-red-50 px-3.5 py-2.5 flex items-center justify-between">
                          <span className="text-sm text-red-600 font-medium">Faltas justificadas</span>
                          <span className="font-bold text-red-700 tnum">{faltas.length}</span>
                        </div>
                      )}
                      {pendingDays.length > 0 && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                          <p className="text-amber-700 font-semibold text-sm">⚠ {pendingDays.length} dia(s) da escala sem preenchimento</p>
                          <p className="text-xs text-amber-600 mt-1 leading-relaxed">
                            {pendingDays.slice(0, 6).map(d => formatDate(d)).join(', ')}{pendingDays.length > 6 ? '…' : ''} — preencha ou registre a falta com o motivo.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {isConsultoria && (
                    <>
                      <div className="rounded-xl bg-orange-50 px-3.5 py-3 space-y-2">
                        <div className="flex items-end justify-between">
                          <span className="text-sm text-orange-700 font-medium">Horas este mês</span>
                          <span className="font-display font-extrabold text-orange-800 text-lg leading-none tnum">{fmtH(monthHours)}{monthlyQuota ? <span className="text-sm font-semibold text-orange-500"> / {monthlyQuota}h</span> : null}</span>
                        </div>
                        {monthlyQuota && (
                          <div className="h-2 bg-orange-200/70 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all" style={{ width: `${Math.min(100, (monthHours / monthlyQuota) * 100)}%` }} />
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {weeklyQuota ? <p className="text-[11px] text-orange-500">Por visita: até {weeklyQuota}h</p> : null}
                          {monthlyQuota ? <p className="text-[11px] text-orange-500">No mês: {monthlyQuota}h combinado</p> : null}
                        </div>
                        {excessMins > 0 && (
                          <p className="text-xs text-amber-700 font-medium bg-amber-100/70 rounded-lg px-2 py-1.5">
                            ⚠ {fmtH(excessMins / 60)} acima do combinado por visita — aguardando aprovação do gestor
                          </p>
                        )}
                      </div>
                      {earnings !== null && earnings > 0 && (
                        <div className="rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 px-3.5 py-3 flex items-center justify-between text-white shadow-glow">
                          <span className="text-sm font-medium text-white/90">💰 A receber este mês</span>
                          <span className="font-display font-extrabold text-lg tnum">R$ {earnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {linkUnits.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {linkUnits.map(u => (
                            <span key={u.id} className="text-xs bg-white border border-orange-200 text-orange-700 px-2.5 py-1 rounded-full font-medium tnum">
                              {u.name} · R$ {u.visit_rate!.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">⚠ Valores das unidades ainda não definidos pelo RH — as visitas ficam registradas e o valor é calculado depois.</p>
                      )}
                    </>
                  )}
                  </div>
                </div>
              )
            })}

            {/* Detailed list — vertical cards */}
            {folhaVisits && folhaVisits.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-400 uppercase tracking-wide px-1">Registros detalhados</p>
                {folhaVisits.map(v => {
                  const isHoliday = (v as { is_holiday?: boolean }).is_holiday
                  const isUnavailable = (v as { is_unavailable?: boolean }).is_unavailable
                  const unavailReason = (v as { unavailability_reason?: string }).unavailability_reason
                  const atestadoUrl = (v as { atestado_url?: string }).atestado_url
                  const breakStart = (v as { break_start?: string }).break_start
                  const breakEnd = (v as { break_end?: string }).break_end
                  const rawDur = v.check_in && v.check_out ? calcDurationMin(v.check_in.slice(0,5), v.check_out.slice(0,5)) : 0
                  const breakDur = breakStart && breakEnd ? calcDurationMin(breakStart.slice(0,5), breakEnd.slice(0,5)) : 0
                  const dur = Math.max(0, rawDur - breakDur)
                  const extraApproval = (v as { extra_approval?: string }).extra_approval
                  return (
                    <div key={v.id} className={`card p-3.5 space-y-2.5 ${isHoliday ? 'border-amber-200 bg-amber-50/40' : isUnavailable ? 'border-red-200 bg-red-50/40' : ''}`}>
                      {/* Row 1: date + client + actions */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-ink-900">{formatDate(v.visit_date)}</p>
                          <p className="text-xs text-ink-400">{(v as { client?: { name: string } }).client?.name}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button className="text-ink-300 hover:text-primary-600 p-1.5 rounded-lg hover:bg-primary-50 transition-colors"
                            title="Editar" onClick={() => {
                              setEditingPontoId(v.id)
                              setPontoForm({
                                visit_date: v.visit_date,
                                client_id: v.client_id,
                                day_type: isHoliday ? 'feriado' : isUnavailable ? 'indisponivel' : 'normal',
                                check_in: v.check_in?.slice(0,5) || '',
                                check_out: v.check_out?.slice(0,5) || '',
                                break_start: breakStart?.slice(0,5) || '',
                                break_end: breakEnd?.slice(0,5) || '',
                                unavailability_reason: unavailReason || '',
                                observations: (v as { observations?: string }).observations || '',
                                unit_id: (v as { unit_id?: string }).unit_id || '',
                                unit_name: v.unit_name || '',
                                is_extra: !!(v as { is_extra?: boolean }).is_extra,
                                is_swap: !!(v as { is_swap?: boolean }).is_swap,
                                swapped_from: (v as { swapped_from?: string }).swapped_from || '',
                              })
                              setAtestadoFile(null); setReportFile(null); setShowPontoModal(true)
                            }}>✏️</button>
                          <button className="text-ink-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            title="Excluir" onClick={() => { if (window.confirm(`Excluir o registro de ${formatDate(v.visit_date)}?`)) deletePonto.mutate(v.id) }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Row 2: tags */}
                      <div className="flex flex-wrap gap-1.5">
                        {isHoliday && <span className="badge bg-amber-100 text-amber-700">Feriado</span>}
                        {isUnavailable && <span className="badge bg-red-100 text-red-700">Falta</span>}
                        {(v as { is_extra?: boolean }).is_extra && <span className="badge bg-green-100 text-green-700">⭐ Dia extra</span>}
                        {(v as { is_swap?: boolean }).is_swap && <span className="badge bg-blue-100 text-blue-700">🔁 Troca{(v as { swapped_from?: string }).swapped_from ? ` ← ${formatDate((v as { swapped_from?: string }).swapped_from!)}` : ''}</span>}
                        {v.unit_name && <span className="badge bg-orange-100 text-orange-700">{v.unit_name}</span>}
                        {extraApproval === 'pendente' && <span className="badge bg-amber-100 text-amber-700">⏳ Aguardando gestor</span>}
                        {extraApproval === 'aprovada' && <span className="badge bg-green-100 text-green-700">✓ Extra aprovada</span>}
                        {extraApproval === 'negada' && <span className="badge bg-gray-100 text-gray-500">Extra não remunerada</span>}
                        {atestadoUrl && <span className="badge bg-green-50 text-green-600">✓ Atestado</span>}
                        {(v as { report_url?: string }).report_url && <span className="badge bg-green-50 text-green-600">✓ Relatório</span>}
                      </div>

                      {/* Row 3: horários + duração + valor */}
                      {(v.check_in || dur > 0 || v.visit_rate || (v as { extra_amount?: number }).extra_amount) && (
                        <div className="flex items-center gap-3 bg-ink-50 rounded-xl px-3 py-2 text-sm">
                          {v.check_in && !isHoliday && (
                            <span className="text-ink-600 font-medium tnum">{v.check_in.slice(0,5)} → {v.check_out?.slice(0,5) || '...'}</span>
                          )}
                          {dur > 0 && <span className="text-ink-500 font-semibold tnum">{Math.floor(dur/60)}h{dur%60>0?String(dur%60).padStart(2,'0')+'m':''}</span>}
                          {breakStart && breakEnd && <span className="text-xs text-ink-400">intervalo {breakStart.slice(0,5)}–{breakEnd.slice(0,5)}</span>}
                          <div className="flex-1" />
                          {v.visit_rate && <span className="font-bold text-green-700 tnum">R$ {Number(v.visit_rate).toFixed(2)}</span>}
                          {(v as { extra_amount?: number }).extra_amount ? <span className="font-bold text-green-700 tnum">+R$ {Number((v as { extra_amount?: number }).extra_amount).toFixed(2)}</span> : null}
                        </div>
                      )}

                      {/* Row 4: motivo/observação */}
                      {isUnavailable && unavailReason && <p className="text-xs text-red-600">Motivo: {unavailReason}</p>}
                      {(v as { observations?: string }).observations && <p className="text-xs text-blue-600 italic">"{(v as { observations?: string }).observations}"</p>}
                    </div>
                  )
                })}
              </div>
            )}

            {folhaVisits?.length === 0 && (
              <div className="card p-8 text-center">
                <Clock size={28} className="mx-auto mb-2 text-ink-200" />
                <p className="text-ink-400 text-sm font-medium">Nenhum registro de ponto neste mês.</p>
                <p className="text-ink-300 text-xs mt-0.5">Toque em "Registrar dia" para começar.</p>
              </div>
            )}

          </>
        )}

        {/* ─── GASTOS TAB ─── */}
        {tab === 'gastos' && (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="section-title text-lg">Gastos & Reembolsos</h2>
                  <p className="text-xs text-ink-400 mt-0.5">Envie comprovantes para reembolso.</p>
                </div>
                <input className="input w-36 text-sm shrink-0" type="month" value={folhaMonth} onChange={e => setFolhaMonth(e.target.value)} />
              </div>
              <button className="btn-primary text-sm w-full" onClick={() => setShowExpForm(p => !p)}>
                <Plus size={16} /> Registrar novo gasto
              </button>
            </div>

            {/* Hidden file input for receipt upload */}
            <input ref={expReceiptRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && pendingExpenseUpload) uploadReceipt(pendingExpenseUpload, file)
                e.target.value = ''
              }}
            />

            {showExpForm && (
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-sm text-ink-800">Novo gasto</h3>
                <input className="input w-full" placeholder="Descrição *" value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Valor (R$) *</label>
                    <input className="input" type="number" placeholder="0,00" value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Categoria</label>
                    <select className="input" value={expenseForm.category} onChange={e => setExpenseForm(p => ({ ...p, category: e.target.value }))}>
                      <option>Reembolso</option>
                      <option>Ajuda de Custo</option>
                      <option>Vale Transporte</option>
                      <option>Alimentação</option>
                      <option>Material</option>
                      <option>Outro</option>
                    </select>
                  </div>
                </div>
                <input className="input w-full" placeholder="Observação (opcional)" value={expenseForm.notes} onChange={e => setExpenseForm(p => ({ ...p, notes: e.target.value }))} />
                <div className="flex gap-2">
                  <button className="btn-primary flex-1" onClick={() => submitExpense.mutate()}
                    disabled={submitExpense.isPending || !expenseForm.description || !expenseForm.amount}>
                    {submitExpense.isPending ? 'Enviando...' : 'Registrar'}
                  </button>
                  <button className="btn-ghost px-4" onClick={() => setShowExpForm(false)}>Cancelar</button>
                </div>
              </div>
            )}

            {myExpenses && myExpenses.length > 0 ? (
              <div className="space-y-2">
                {myExpenses.map(e => (
                  <div key={e.id} className="card p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink-900 truncate">{e.description}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="badge bg-orange-100 text-orange-700">{e.category}</span>
                        {e.notes && <span className="text-xs text-ink-400">{e.notes}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-bold text-orange-700 tnum">R$ {Number(e.amount).toFixed(2)}</span>
                      {(e as { receipt_url?: string }).receipt_url ? (
                        <span className="badge bg-green-100 text-green-700">✓ enviado</span>
                      ) : (
                        <button className="btn-secondary text-xs py-1 px-2"
                          disabled={uploadingExpId === e.id}
                          onClick={() => { setPendingExpenseUpload(e.id); expReceiptRef.current?.click() }}>
                          {uploadingExpId === e.id ? '...' : '📎'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                  <span className="text-sm text-orange-700 font-medium">Total do mês</span>
                  <span className="font-display font-bold text-orange-800 tnum">R$ {myExpenses.reduce((s, e) => s + Number(e.amount), 0).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="card p-8 text-center">
                <CreditCard size={28} className="mx-auto mb-2 text-ink-200" />
                <p className="text-ink-400 text-sm font-medium">Nenhum gasto registrado este mês.</p>
              </div>
            )}
          </>
        )}

        {/* ─── CHAT (DÚVIDAS) TAB ─── */}
        {tab === 'duvidas' && (
          <>
            <div>
              <h2 className="section-title text-lg">Chat com o RH</h2>
              <p className="text-xs text-ink-400 mt-0.5">As respostas do RH aparecem aqui em tempo real.</p>
            </div>

            {/* Histórico de mensagens — bolhas estilo chat */}
            {myDuvidas && myDuvidas.length > 0 ? (
              <div className="space-y-4">
                {myDuvidas.map(d => {
                  const isAdminInitiated = !!(d as { initiated_by_admin?: boolean }).initiated_by_admin
                  const fmtTs = (ts: string) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                  return (
                    <div key={d.id} className="space-y-2">
                      {/* Mensagem do colaborador (direita) */}
                      {d.message && !isAdminInitiated && (
                        <div className="flex justify-end">
                          <div className="max-w-[80%] space-y-1">
                            <div className="bg-primary-600 text-white rounded-2xl rounded-br-sm px-4 py-2.5 shadow-sm">
                              <p className="text-sm leading-relaxed">{d.message}</p>
                            </div>
                            <p className="text-[10px] text-ink-400 text-right px-1">{fmtTs(d.created_at)}</p>
                          </div>
                        </div>
                      )}

                      {/* Mensagem do RH / resposta (esquerda) */}
                      {d.answer && (
                        <div className="flex justify-start gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-xs flex-shrink-0 mt-1">RH</div>
                          <div className="max-w-[80%] space-y-1">
                            {isAdminInitiated && (
                              <p className="text-[10px] text-ink-500 font-semibold px-1">RH</p>
                            )}
                            <div className="bg-white border border-ink-100 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
                              <p className="text-sm text-ink-800 leading-relaxed">{d.answer}</p>
                            </div>
                            <p className="text-[10px] text-ink-400 px-1">{fmtTs(d.answered_at)}</p>
                          </div>
                        </div>
                      )}

                      {/* Mensagem do colaborador sem resposta ainda */}
                      {d.message && !isAdminInitiated && !d.answer && (
                        <div className="flex justify-end">
                          <span className="text-[10px] text-amber-500 flex items-center gap-1 px-1">
                            <Clock size={10} /> aguardando resposta
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="card p-8 text-center">
                <MessageCircle size={28} className="mx-auto mb-2 text-ink-200" />
                <p className="text-ink-400 text-sm font-medium">Nenhuma mensagem ainda.</p>
                <p className="text-ink-300 text-xs mt-0.5">Envie uma mensagem para o RH abaixo.</p>
              </div>
            )}

            {/* Caixa de envio — fixada embaixo visualmente */}
            <div className="sticky bottom-4 bg-white/95 backdrop-blur border border-ink-100 rounded-2xl shadow-lg p-3 space-y-2">
              <textarea
                className="input w-full resize-none text-sm"
                rows={2}
                placeholder="Escreva sua mensagem para o RH..."
                value={duvidaText}
                onChange={e => setDuvidaText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && duvidaText.trim()) { e.preventDefault(); enviarDuvida.mutate(duvidaText.trim()) } }}
              />
              <button
                className="btn-primary w-full text-sm"
                disabled={!duvidaText.trim() || enviarDuvida.isPending}
                onClick={() => { if (duvidaText.trim()) enviarDuvida.mutate(duvidaText.trim()) }}
              >
                <Send size={14} />
                {enviarDuvida.isPending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </>
        )}

        {/* ─── AGENDA TAB ─── */}
        {tab === 'agenda' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="section-title text-lg">Minha Agenda</h2>
                <p className="text-xs text-ink-400 mt-0.5">Veja sua escala. Toque num dia para avisar falta ou trocar.</p>
              </div>
              <input className="input w-32 text-sm shrink-0" type="month" value={agendaMonth} onChange={e => setAgendaMonth(e.target.value)} />
            </div>

            {/* Legenda */}
            <div className="card px-3.5 py-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Trabalho</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-ink-200 inline-block" /> Folga</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-primary-500 inline-block" /> Registrado</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> Falta</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Troca</span>
            </div>

            {/* Calendário de escala — por vínculo Fixo com escala conhecida */}
            {(folhaLinks as FolhaLink[] | undefined)?.filter(l => hasKnownSchedule(l)).map(link => {
              const client = link.client!
              const monthDate = new Date(agendaMonth + '-15')
              const daysInMonth = getDaysInMonth(monthDate)
              const firstDow = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay()
              const todayStr = new Date().toISOString().slice(0, 10)
              const clientVisits = (agendaVisits || []).filter(v => v.client_id === client.id)
              const filledSet = new Set(clientVisits.map(v => v.visit_date))
              const clientNotices = (notices as Notice[] | undefined)?.filter(n => n.client_id === client.id) ?? []
              const faltaSet = new Set(clientNotices.filter(n => n.type === 'falta').map(n => n.notice_date))
              const trocaFolgaSet = new Set(clientNotices.filter(n => n.type === 'troca').map(n => n.notice_date))
              const trocaTrabSet = new Set(clientNotices.filter(n => n.type === 'troca').map(n => n.swap_work_date).filter(Boolean) as string[])
              const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
              return (
                <div key={link.id} className="card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{client.name}</p>
                    <span className="badge bg-blue-100 text-blue-700 text-xs">{link.work_schedule || link.work_schedule_type || 'Fixo'}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {DOW.map((d, i) => <div key={i} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>)}
                    {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1
                      const ds = `${agendaMonth}-${String(day).padStart(2, '0')}`
                      const off = isDayOff(link, ds)
                      const filled = filledSet.has(ds)
                      const isFalta = faltaSet.has(ds)
                      const isTrocaFolga = trocaFolgaSet.has(ds)
                      const isTrocaTrab = trocaTrabSet.has(ds)
                      const isToday = ds === todayStr
                      const isPast = ds < todayStr
                      let cls = 'text-gray-500 bg-gray-100'
                      if (filled) cls = 'bg-green-500 text-white'
                      else if (isFalta) cls = 'bg-red-400 text-white'
                      else if (isTrocaFolga) cls = 'bg-amber-400 text-white line-through'
                      else if (isTrocaTrab) cls = 'bg-amber-400 text-white'
                      else if (!off) cls = 'bg-blue-500 text-white'
                      else cls = 'bg-gray-200 text-gray-400'
                      return (
                        <button
                          key={day}
                          disabled={isPast && !filled && !isFalta && !isTrocaFolga && !isTrocaTrab}
                          onClick={() => { setDayModal({ date: ds, linkId: link.id }); setNoticeAction(''); setNoticeForm({ reason: '', otherDate: '' }) }}
                          className={`aspect-square flex items-center justify-center rounded-lg text-xs font-medium transition-all relative ${cls} ${isToday ? 'ring-2 ring-primary-500' : ''} ${isPast && !filled ? 'opacity-50' : 'hover:scale-105'}`}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Avisos ativos (faltas e trocas combinadas) */}
            {(notices as Notice[] | undefined)?.filter(n => n.notice_date >= agendaMonth + '-01' && n.notice_date <= agendaMonth + '-31').length ? (
              <div className="card p-4 space-y-2">
                <h3 className="font-semibold text-sm">Avisos do mês</h3>
                {(notices as Notice[]).filter(n => n.notice_date >= agendaMonth + '-01' && n.notice_date <= agendaMonth + '-31').map(n => {
                  const cName = (folhaLinks as FolhaLink[] | undefined)?.find(l => l.client?.id === n.client_id)?.client?.name
                  return (
                    <div key={n.id} className={`flex items-center gap-3 p-2.5 rounded-lg ${n.type === 'falta' ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <span className="text-lg">{n.type === 'falta' ? '🚫' : '🔁'}</span>
                      <div className="flex-1 min-w-0">
                        {n.type === 'falta' ? (
                          <p className="text-sm font-medium text-red-800">Falta avisada — {formatDate(n.notice_date)}</p>
                        ) : (
                          <p className="text-sm font-medium text-amber-800">Troca: folga {formatDate(n.notice_date)} → trabalha {n.swap_work_date ? formatDate(n.swap_work_date) : '?'}</p>
                        )}
                        <p className="text-xs text-gray-400">{cName}{n.reason ? ` · ${n.reason}` : ''}</p>
                      </div>
                      <button onClick={() => deleteNotice.mutate(n.id)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* Consultoria: calendário visual de visitas planejadas */}
            {(folhaLinks as FolhaLink[] | undefined)?.filter(l => effectiveType(l) === 'Consultoria').map(link => {
              const client = link.client!
              const monthDate = new Date(agendaMonth + '-15')
              const daysInMonth = getDaysInMonth(monthDate)
              const firstDow = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay()
              const todayStr2 = new Date().toISOString().slice(0, 10)
              const DOW2 = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
              const clientAgenda = (agenda || []).filter(a => (a as { client_id?: string }).client_id === client.id)
              const plannedSet = new Set(clientAgenda.map(a => a.planned_date))
              const doneSet = new Set(
                (agendaVisits || []).filter(v => v.client_id === client.id && v.check_out).map(v => v.visit_date)
              )
              return (
                <div key={`cal-consult-${link.id}`} className="card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{client.name}</p>
                    <span className="badge bg-orange-100 text-orange-700 text-xs">Consultoria</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-400 inline-block" /> Planejado</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Realizado</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" /> Livre</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {DOW2.map((d, i) => <div key={i} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>)}
                    {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1
                      const ds = `${agendaMonth}-${String(day).padStart(2,'0')}`
                      const done = doneSet.has(ds)
                      const planned = plannedSet.has(ds)
                      const isToday2 = ds === todayStr2
                      let cls = 'bg-gray-100 text-gray-400'
                      if (done) cls = 'bg-green-500 text-white'
                      else if (planned) cls = 'bg-orange-400 text-white'
                      return (
                        <div key={day} className={`aspect-square flex items-center justify-center rounded-lg text-xs font-medium relative ${cls} ${isToday2 ? 'ring-2 ring-primary-500' : ''}`}>
                          {day}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Consultoria: planejamento de visitas (mantém o agendar livre) */}
            {(folhaLinks as FolhaLink[] | undefined)?.some(l => effectiveType(l) === 'Consultoria') && (
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="section-title text-base">Visitas planejadas</h3>
                    <p className="text-xs text-ink-400">Organize suas próximas visitas.</p>
                  </div>
                  <button
                    onClick={() => {
                      const consult = (links || []).find(l => effectiveType(l as FolhaLink) === 'Consultoria')
                      const client = (consult as { client?: { id: string; name: string } } | undefined)?.client
                      if (client) setAgendaForm({ clientId: client.id, clientName: client.name })
                    }}
                    className="btn-primary text-sm shrink-0"
                  >
                    <Plus size={16} /> Agendar
                  </button>
                </div>
                <p className="text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2">No dia da visita, toque em <strong className="text-primary-700">Registrar</strong> para confirmar e lançar a hora de entrada e saída.</p>
                {agenda?.length === 0 && (
                  <div className="text-center py-6">
                    <CalendarDays size={26} className="mx-auto mb-1.5 text-ink-200" />
                    <p className="text-sm text-ink-400">Nenhuma visita planejada.</p>
                  </div>
                )}
                <div className="space-y-2">
                  {agenda?.map(a => {
                    const unitName = (a as { unit?: { name: string } }).unit?.name || a.notes
                    const clientName = (a as { client?: { name: string } }).client?.name
                    const aClientId = (a as { client_id?: string }).client_id || ''
                    const done = (agendaVisits || []).some(v => v.visit_date === a.planned_date && v.client_id === aClientId && v.check_out)
                    const isFuture = a.planned_date > new Date().toISOString().slice(0, 10)
                    const original = (a as { original_date?: string }).original_date
                    const wasRescheduled = original && original !== a.planned_date
                    const editing = reschedAgenda?.id === a.id
                    const isFixed = (a as { created_by_admin?: boolean }).created_by_admin === true
                    const hoursExp = (a as { hours_expected?: number }).hours_expected
                    return (
                      <div key={a.id} className={`flex items-center gap-3 p-2.5 rounded-xl border ${done ? 'bg-primary-50/50 border-primary-100' : isFixed ? 'bg-blue-50/40 border-blue-100' : 'bg-white border-ink-100'}`}>
                        <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isFixed ? 'bg-blue-100' : 'bg-orange-50'}`}>
                          <span className={`text-sm font-display font-extrabold leading-none ${isFixed ? 'text-blue-700' : 'text-orange-700'}`}>{new Date(a.planned_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit' })}</span>
                          <span className={`text-[10px] uppercase mt-0.5 ${isFixed ? 'text-blue-500' : 'text-orange-500'}`}>{new Date(a.planned_date + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-semibold text-ink-900 truncate">{unitName || clientName}</p>
                            {isFixed && <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">🔒 RH</span>}
                            {hoursExp && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{hoursExp}h</span>}
                          </div>
                          <p className="text-xs text-ink-400 truncate">{clientName}{a.notes && a.notes !== unitName ? ` · ${a.notes}` : ''}</p>
                          {wasRescheduled && <p className="text-xs text-amber-600">🔁 remarcada (era {formatDate(original!)})</p>}
                          {editing && (
                            <div className="flex items-center gap-1.5 mt-1">
                              <input className="input text-xs py-1 w-36" type="date" value={reschedAgenda!.date}
                                onChange={e => setReschedAgenda({ id: a.id, date: e.target.value })} />
                              <button className="text-xs bg-primary-600 text-white px-2 py-1 rounded" disabled={!reschedAgenda!.date || rescheduleAgenda.isPending}
                                onClick={() => rescheduleAgenda.mutate({ id: a.id, newDate: reschedAgenda!.date, currentDate: a.planned_date, originalDate: original || null })}>OK</button>
                              <button className="text-xs text-gray-400 px-1" onClick={() => setReschedAgenda(null)}>×</button>
                            </div>
                          )}
                        </div>
                        {done ? (
                          <span className="badge bg-primary-100 text-primary-700 flex items-center gap-1"><CheckCircle2 size={13} /> registrada</span>
                        ) : (
                          <>
                            {!editing && !isFixed && (
                              <button onClick={() => setReschedAgenda({ id: a.id, date: a.planned_date })} className="text-ink-400 hover:text-amber-600 p-1.5" title="Remarcar data"><CalendarDays size={15} /></button>
                            )}
                            <button
                              onClick={() => {
                                setEditingPontoId(null)
                                setPontoForm({
                                  ...EMPTY_PONTO,
                                  visit_date: a.planned_date,
                                  client_id: aClientId,
                                  unit_id: (a as { unit_id?: string }).unit_id || '',
                                  unit_name: (a as { unit?: { name: string } }).unit?.name || '',
                                })
                                setAtestadoFile(null); setReportFile(null)
                                setShowPontoModal(true)
                              }}
                              className={`text-xs px-3.5 py-2 rounded-xl font-semibold transition-all active:scale-95 ${isFuture ? 'bg-ink-100 text-ink-400' : 'bg-primary-600 text-white hover:bg-primary-700 shadow-soft'}`}
                              disabled={isFuture}
                              title={isFuture ? 'Disponível no dia da visita' : 'Registrar visita'}
                            >
                              Registrar
                            </button>
                          </>
                        )}
                        {!isFixed && (
                          <button onClick={() => deleteAgenda.mutate(a.id)} className="text-ink-300 hover:text-red-500 p-1.5">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!(folhaLinks as FolhaLink[] | undefined)?.some(l => hasKnownSchedule(l) || effectiveType(l) === 'Consultoria') && (
              <div className="card p-8 text-center">
                <CalendarDays size={28} className="mx-auto mb-2 text-ink-200" />
                <p className="text-ink-400 text-sm font-medium">Sua escala ainda não foi configurada pelo RH.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── AGENDA ADD MODAL ─── */}
      {agendaForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm space-y-4 p-5">
            <div>
              <h3 className="font-semibold text-gray-900">Planejar visita</h3>
              <p className="text-xs text-gray-400 mt-0.5">Escolha só o dia que pretende ir. O horário você lança no dia, ao registrar.</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {links?.map(l => {
                  const c = (l as { client?: { id: string; name: string } }).client
                  if (!c) return null
                  return (
                    <button
                      key={l.id}
                      onClick={() => setAgendaForm({ clientId: c.id, clientName: c.name })}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${agendaForm.clientId === c.id ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-600 hover:border-primary-300'}`}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {getUnitsForClient(agendaForm.clientId).length > 0 && (
              <div>
                <label className="label">Unidade</label>
                <select className="input" value={agendaEntry.unit_id} onChange={e => setAgendaEntry(p => ({ ...p, unit_id: e.target.value }))}>
                  <option value="">Qualquer unidade</option>
                  {getUnitsForClient(agendaForm.clientId).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="label">Dia *</label>
              <input className="input" type="date" value={agendaEntry.planned_date} onChange={e => setAgendaEntry(p => ({ ...p, planned_date: e.target.value }))} />
            </div>

            <div>
              <label className="label">Observação <span className="text-gray-400 font-normal">— opcional</span></label>
              <input className="input" placeholder="Ex: aula de cozinha, avaliação..." value={agendaEntry.notes} onChange={e => setAgendaEntry(p => ({ ...p, notes: e.target.value }))} />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                className="btn-primary flex-1"
                onClick={() => addAgenda.mutate()}
                disabled={addAgenda.isPending || !agendaEntry.planned_date}
              >
                {addAgenda.isPending ? 'Salvando...' : 'Salvar na agenda'}
              </button>
              <button className="btn-secondary" onClick={() => setAgendaForm(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Dia da agenda (avisar falta / trocar dia) ── */}
      {dayModal && (() => {
        const link = (folhaLinks as FolhaLink[] | undefined)?.find(l => l.id === dayModal.linkId)
        const off = link ? isDayOff(link, dayModal.date) : false
        const existing = (notices as Notice[] | undefined)?.find(n =>
          n.client_id === link?.client?.id && (n.notice_date === dayModal.date || n.swap_work_date === dayModal.date))
        return (
          <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm space-y-4 p-5">
              <div>
                <h3 className="font-bold text-lg">{formatDate(dayModal.date)}</h3>
                <p className="text-sm text-gray-500">{link?.client?.name} · {off ? 'Dia de folga pela escala' : 'Dia de trabalho pela escala'}</p>
              </div>

              {existing ? (
                <div className={`rounded-xl px-4 py-3 text-sm ${existing.type === 'falta' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {existing.type === 'falta'
                    ? <p>Você já avisou que vai <strong>faltar</strong> neste dia.</p>
                    : <p>Troca combinada: folga em <strong>{formatDate(existing.notice_date)}</strong> e trabalha em <strong>{existing.swap_work_date ? formatDate(existing.swap_work_date) : '?'}</strong>.</p>}
                  <button className="text-xs underline mt-2" onClick={() => deleteNotice.mutate(existing.id)}>Cancelar este aviso</button>
                </div>
              ) : noticeAction === '' ? (
                <div className="space-y-2">
                  {!off && (
                    <>
                      <button className="w-full text-left px-4 py-3 rounded-xl border-2 border-red-200 bg-red-50 text-red-800 text-sm font-medium hover:border-red-400 transition-colors"
                        onClick={() => setNoticeAction('falta')}>
                        🚫 Vou faltar neste dia
                        <span className="block text-xs font-normal text-red-500">Avisa o RH com antecedência</span>
                      </button>
                      <button className="w-full text-left px-4 py-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium hover:border-amber-400 transition-colors"
                        onClick={() => setNoticeAction('troca-folgar')}>
                        🔁 Quero trocar este dia
                        <span className="block text-xs font-normal text-amber-600">Folgo aqui e trabalho em outro dia no lugar</span>
                      </button>
                    </>
                  )}
                  {off && (
                    <button className="w-full text-left px-4 py-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium hover:border-amber-400 transition-colors"
                      onClick={() => setNoticeAction('troca-trabalhar')}>
                      🔁 Vou trabalhar nesta folga
                      <span className="block text-xs font-normal text-amber-600">No lugar de um dia de trabalho da escala</span>
                    </button>
                  )}
                </div>
              ) : noticeAction === 'falta' ? (
                <div className="space-y-3">
                  <div>
                    <label className="label">Motivo da falta *</label>
                    <select className="input" value={noticeForm.reason} onChange={e => setNoticeForm(p => ({ ...p, reason: e.target.value }))}>
                      <option value="">Selecionar...</option>
                      <option value="Atestado médico">Atestado médico</option>
                      <option value="Consulta médica">Consulta médica</option>
                      <option value="Emergência familiar">Emergência familiar</option>
                      <option value="Compromisso pessoal">Compromisso pessoal</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1 bg-red-600 hover:bg-red-700" disabled={!noticeForm.reason || addNotice.isPending}
                      onClick={() => addNotice.mutate({ client_id: link!.client!.id, type: 'falta', notice_date: dayModal.date, reason: noticeForm.reason })}>
                      {addNotice.isPending ? 'Enviando...' : 'Avisar falta'}
                    </button>
                    <button className="btn-ghost px-4" onClick={() => setNoticeAction('')}>Voltar</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {noticeAction === 'troca-folgar'
                      ? <>Você folga em <strong>{formatDate(dayModal.date)}</strong>. Qual dia vai <strong>trabalhar</strong> no lugar?</>
                      : <>Você trabalha em <strong>{formatDate(dayModal.date)}</strong>. Qual dia de trabalho vai <strong>folgar</strong> no lugar?</>}
                  </p>
                  <input className="input" type="date" value={noticeForm.otherDate} onChange={e => setNoticeForm(p => ({ ...p, otherDate: e.target.value }))} />
                  <p className="text-xs text-amber-600">Troca não gera pagamento extra — é só um remanejamento da escala.</p>
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700" disabled={!noticeForm.otherDate || addNotice.isPending}
                      onClick={() => {
                        const folgaDate = noticeAction === 'troca-folgar' ? dayModal.date : noticeForm.otherDate
                        const workDate = noticeAction === 'troca-folgar' ? noticeForm.otherDate : dayModal.date
                        addNotice.mutate({ client_id: link!.client!.id, type: 'troca', notice_date: folgaDate, swap_work_date: workDate })
                      }}>
                      {addNotice.isPending ? 'Salvando...' : 'Registrar troca'}
                    </button>
                    <button className="btn-ghost px-4" onClick={() => setNoticeAction('')}>Voltar</button>
                  </div>
                </div>
              )}

              <button className="btn-ghost w-full text-sm text-gray-400" onClick={() => { setDayModal(null); setNoticeAction('') }}>Fechar</button>
            </div>
          </div>
        )
      })()}

      {/* ── Modal: Registrar dia (Fixo: ponto/falta/feriado + dia extra · Consultoria: visita com valor) ── */}
      {showPontoModal && (() => {
        const modalLink = getLinkForClient(pontoForm.client_id)
        const isConsultoria = effectiveType(modalLink) === 'Consultoria'
        const dayIsOff = !isConsultoria && pontoForm.day_type === 'normal' && isDayOff(modalLink, pontoForm.visit_date)
        const noFixedSchedule = !isConsultoria && modalLink && !hasKnownSchedule(modalLink)
        const extraDayValue = modalLink?.monthly_amount ? Math.round((Number(modalLink.monthly_amount) / 30) * 100) / 100 : null
        return (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md space-y-4 p-5 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg">{editingPontoId ? 'Editar registro' : 'Registrar dia'}</h3>

            {/* Cliente */}
            <div>
              <label className="label">Cliente *</label>
              <select className="input" value={pontoForm.client_id} onChange={e => setPontoForm(p => ({ ...p, client_id: e.target.value, unit_id: '', unit_name: '', is_extra: false }))}>
                <option value="">Selecionar...</option>
                {folhaLinks?.map(l => {
                  const c = (l as { client?: { id: string; name: string } }).client
                  return c ? <option key={c.id} value={c.id}>{c.name}</option> : null
                })}
              </select>
              {modalLink && (
                <p className="text-xs text-gray-400 mt-1">
                  {isConsultoria ? 'Consultoria — registre a visita com a unidade' : `Fixo${modalLink.work_schedule_type ? ` · escala ${modalLink.work_schedule_type}` : ''}`}
                </p>
              )}
            </div>

            {/* Data */}
            <div>
              <label className="label">Data *</label>
              <input className="input" type="date" value={pontoForm.visit_date} onChange={e => setPontoForm(p => ({ ...p, visit_date: e.target.value }))} />
            </div>

            {/* ── CONSULTORIA: unidade + horários + valor + relatório ── */}
            {isConsultoria && (
              <>
                {getLinkUnitsForClient(pontoForm.client_id).length > 0 && (
                  <div>
                    <label className="label">Unidade *</label>
                    <select
                      className="input"
                      value={pontoForm.unit_id}
                      onChange={e => {
                        const unit = getLinkUnitsForClient(pontoForm.client_id).find(u => u.id === e.target.value)
                        setPontoForm(p => ({ ...p, unit_id: e.target.value, unit_name: unit?.name || '' }))
                      }}
                    >
                      <option value="">Selecionar unidade...</option>
                      {getLinkUnitsForClient(pontoForm.client_id).map(u => (
                        <option key={u.id} value={u.id}>{u.name}{u.visit_rate ? ` — vistoria R$ ${u.visit_rate.toFixed(2)}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Combinado de HORAS no mês: aviso leve — quem decide o pagamento do excedente é o chefe */}
                {(() => {
                  const monthlyQuota = Number((modalLink as { monthly_hours_quota?: number } | undefined)?.monthly_hours_quota) || null
                  if (!monthlyQuota || !pontoForm.check_in || !pontoForm.check_out) return null
                  const mPrefix = pontoForm.visit_date.slice(0, 7)
                  const hoursSoFar = (folhaVisits || []).filter(v =>
                    v.client_id === pontoForm.client_id && v.visit_date.slice(0, 7) === mPrefix && v.id !== editingPontoId)
                    .reduce((s, v) => s + calcDurationMin((v.check_in || '').slice(0,5), (v.check_out || '').slice(0,5)) / 60, 0)
                  const thisHours = calcDurationMin(pontoForm.check_in, pontoForm.check_out) / 60
                  const total = hoursSoFar + thisHours
                  const fmt = (h: number) => `${Math.floor(h)}h${Math.round((h % 1) * 60) > 0 ? Math.round((h % 1) * 60) + 'm' : ''}`
                  return total > monthlyQuota + 1 ? (
                    <p className="text-xs text-blue-600">Com esta visita você chega a {fmt(total)} no mês (combinado: {monthlyQuota}h). O excedente vai para aprovação do gestor.</p>
                  ) : (
                    <p className="text-xs text-gray-400">{fmt(total)} de {monthlyQuota}h combinadas no mês.</p>
                  )
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Início *</label>
                    <input className="input" type="time" value={pontoForm.check_in} onChange={e => setPontoForm(p => ({ ...p, check_in: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Fim *</label>
                    <input className="input" type="time" value={pontoForm.check_out} onChange={e => setPontoForm(p => ({ ...p, check_out: e.target.value }))} />
                  </div>
                </div>
                {pontoForm.check_in && pontoForm.check_out && pontoForm.check_in !== pontoForm.check_out && (() => {
                  const weeklyQuota = Number(modalLink?.weekly_hours_quota) || null
                  const unit = getLinkUnitsForClient(pontoForm.client_id).find(u => u.id === pontoForm.unit_id)
                  const amount = calcVisitAmount(unit?.visit_rate ?? null, pontoForm.check_in, pontoForm.check_out, weeklyQuota)
                  const hours = calcDurationMin(pontoForm.check_in, pontoForm.check_out) / 60
                  const pct = weeklyQuota ? Math.min(100, Math.round((hours / weeklyQuota) * 100)) : null
                  return (
                    <div className="bg-green-50 text-green-700 text-sm rounded-lg px-3 py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2"><Clock size={14} />{calcDuration(pontoForm.check_in, pontoForm.check_out)} de visita</span>
                        {amount != null && <span className="font-bold">R$ {amount.toFixed(2)}</span>}
                      </div>
                      {amount != null && unit?.visit_rate && pct != null && (
                        <p className="text-xs text-green-600">
                          {pct >= 100
                            ? `✓ Semana cheia (${weeklyQuota}h) — valor inteiro da vistoria`
                            : `${pct}% da semana cheia (${weeklyQuota}h) → R$ ${unit.visit_rate.toFixed(2)} × ${pct}%`}
                        </p>
                      )}
                    </div>
                  )
                })()}
                {/* Relatório opcional */}
                <div>
                  <label className="label">Relatório da visita <span className="text-gray-400 font-normal">— opcional</span></label>
                  <input ref={reportRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
                    onChange={e => setReportFile(e.target.files?.[0] || null)} />
                  <button
                    type="button"
                    onClick={() => reportRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors text-center"
                  >
                    {reportFile ? `✓ ${reportFile.name}` : '+ Anexar relatório (PDF ou foto)'}
                  </button>
                  {reportFile && (
                    <button type="button" onClick={() => setReportFile(null)} className="text-xs text-red-400 mt-1 hover:underline">Remover arquivo</button>
                  )}
                </div>
              </>
            )}

            {/* ── FIXO: tipo do dia ── */}
            {!isConsultoria && (
            <div>
              <label className="label">O que aconteceu neste dia? *</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'normal', label: 'Trabalhei', color: 'border-green-300 bg-green-50 text-green-800', active: 'border-green-500 bg-green-100' },
                  { value: 'feriado', label: 'Feriado', color: 'border-amber-300 bg-amber-50 text-amber-800', active: 'border-amber-500 bg-amber-100' },
                  { value: 'indisponivel', label: 'Faltei', color: 'border-red-300 bg-red-50 text-red-800', active: 'border-red-500 bg-red-100' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPontoForm(p => ({ ...p, day_type: opt.value, is_extra: opt.value === 'normal' ? p.is_extra : false }))}
                    className={`border-2 rounded-xl p-3 text-sm font-medium transition-all ${pontoForm.day_type === opt.value ? opt.active + ' border-2' : opt.color + ' border'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            )}

            {/* ── FIXO: folga da escala detectada → dia extra OU troca de dia ── */}
            {dayIsOff && (
              <div className="bg-green-50 border border-green-300 rounded-xl px-4 py-3 space-y-2">
                <p className="text-sm font-medium text-green-800">
                  Este dia é sua <strong>folga</strong> pela escala. Trabalhou mesmo assim? Escolha o que aconteceu:
                </p>
                <label className={`flex items-center gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 ${pontoForm.is_extra ? 'bg-green-100 text-green-800 font-medium' : 'text-green-700'}`}>
                  <input type="radio" name="folga-opt" checked={pontoForm.is_extra}
                    onChange={() => setPontoForm(p => ({ ...p, is_extra: true, is_swap: false, swapped_from: '' }))} />
                  ⭐ Foi um <strong>dia extra</strong>
                  <span className="text-xs text-gray-500">(valor definido pelo gestor)</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 ${pontoForm.is_swap ? 'bg-blue-100 text-blue-800 font-medium' : 'text-green-700'}`}>
                  <input type="radio" name="folga-opt" checked={pontoForm.is_swap}
                    onChange={() => setPontoForm(p => ({ ...p, is_swap: true, is_extra: false }))} />
                  🔁 <strong>Troquei o dia</strong> — trabalhei hoje no lugar de outro dia da escala
                </label>
                {pontoForm.is_swap && (
                  <div className="pl-6">
                    <label className="label text-xs">Qual dia da escala você trocou? *</label>
                    <input className="input text-sm" type="date" value={pontoForm.swapped_from}
                      onChange={e => setPontoForm(p => ({ ...p, swapped_from: e.target.value }))} />
                    <p className="text-xs text-blue-600 mt-1">O dia trocado não fica pendente na sua folha. Troca de dia não gera pagamento extra.</p>
                  </div>
                )}
                {pontoForm.is_extra && <p className="text-xs text-amber-600">⏳ Dia extra registrado — o gestor será notificado e vai definir o valor a receber.</p>}
                {!pontoForm.is_extra && !pontoForm.is_swap && <p className="text-xs text-gray-500">Sem escolher, o dia é registrado como trabalho normal.</p>}
              </div>
            )}
            {/* Escala sem dias conhecidos (Plantão, 12x36 sem âncora): ela marca manualmente */}
            {!dayIsOff && noFixedSchedule && pontoForm.day_type === 'normal' && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer bg-gray-50 rounded-xl px-4 py-3">
                <input type="checkbox" className="rounded" checked={pontoForm.is_extra}
                  onChange={e => setPontoForm(p => ({ ...p, is_extra: e.target.checked }))} />
                ⭐ Dia extra — trabalhei fora da minha escala
                {pontoForm.is_extra && extraDayValue ? <span className="font-bold text-green-700">+ R$ {extraDayValue.toFixed(2)}</span> : null}
              </label>
            )}

            {/* Normal: entrada / saída / intervalo */}
            {!isConsultoria && pontoForm.day_type === 'normal' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Entrada *</label>
                    <input className="input" type="time" value={pontoForm.check_in} onChange={e => setPontoForm(p => ({ ...p, check_in: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Saída *</label>
                    <input className="input" type="time" value={pontoForm.check_out} onChange={e => setPontoForm(p => ({ ...p, check_out: e.target.value }))} />
                  </div>
                </div>
                {pontoForm.check_in && pontoForm.check_out && (() => {
                  const raw = calcDurationMin(pontoForm.check_in, pontoForm.check_out)
                  return raw > 0 ? (
                    <p className="text-xs text-blue-600 font-medium">
                      Total: {Math.floor(raw/60)}h{raw%60>0?String(raw%60).padStart(2,'0')+'min':''}
                    </p>
                  ) : null
                })()}
              </>
            )}

            {/* Feriado: só confirmação */}
            {!isConsultoria && pontoForm.day_type === 'feriado' && (
              <div className="bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-700">
                O dia será registrado como feriado — não conta como falta nem como dia trabalhado.
              </div>
            )}

            {/* Falta: motivo + atestado — aparece para o RH cobrar/acompanhar */}
            {!isConsultoria && pontoForm.day_type === 'indisponivel' && (
              <div className="space-y-3">
                <div>
                  <label className="label">Motivo da falta *</label>
                  <select className="input" value={pontoForm.unavailability_reason} onChange={e => setPontoForm(p => ({ ...p, unavailability_reason: e.target.value }))}>
                    <option value="">Selecionar motivo...</option>
                    <option value="Atestado médico">Atestado médico</option>
                    <option value="Doença sem atestado">Doença sem atestado</option>
                    <option value="Emergência familiar">Emergência familiar</option>
                    <option value="Licença maternidade/paternidade">Licença maternidade/paternidade</option>
                    <option value="Licença especial">Licença especial</option>
                    <option value="Problema no transporte">Problema no transporte</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>

                {/* Anexar atestado */}
                <div>
                  <label className="label">Atestado ou comprovante <span className="text-gray-400 font-normal">— opcional</span></label>
                  <input ref={atestadoRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                    onChange={e => setAtestadoFile(e.target.files?.[0] || null)} />
                  <button
                    type="button"
                    onClick={() => atestadoRef.current?.click()}
                    className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors text-center"
                  >
                    {atestadoFile ? `✓ ${atestadoFile.name}` : '+ Anexar PDF ou foto'}
                  </button>
                  {atestadoFile && (
                    <button type="button" onClick={() => setAtestadoFile(null)} className="text-xs text-red-400 mt-1 hover:underline">Remover arquivo</button>
                  )}
                </div>
              </div>
            )}

            {/* Observação — sempre disponível */}
            <div>
              <label className="label">Observação <span className="text-gray-400 font-normal">— opcional</span></label>
              <input className="input" placeholder="Ex: fiz horas extras, precisei sair mais cedo..." value={pontoForm.observations} onChange={e => setPontoForm(p => ({ ...p, observations: e.target.value }))} />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                className="btn-primary flex-1"
                onClick={() => registrarPonto.mutate()}
                disabled={registrarPonto.isPending || !pontoForm.client_id || !pontoForm.visit_date || (isConsultoria && getLinkUnitsForClient(pontoForm.client_id).length > 0 && !pontoForm.unit_id) || (pontoForm.is_swap && !pontoForm.swapped_from)}
              >
                {registrarPonto.isPending ? 'Salvando...' : editingPontoId ? 'Salvar alterações' : 'Salvar'}
              </button>
              <button className="btn-ghost px-4" onClick={() => { setShowPontoModal(false); setPontoForm(EMPTY_PONTO); setAtestadoFile(null); setReportFile(null); setEditingPontoId(null) }}>Cancelar</button>
            </div>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
