import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Clock, Calendar, Plus, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, CalendarDays, Trash2, CheckCircle2, Download, MessageCircle, Send, Home, CreditCard, TrendingUp, CheckCheck, AlertTriangle, Hourglass, Pencil, Repeat, Check, FileText, Paperclip } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatCurrency, getInitials, corDoAvatar, hojeISO, tipoDoVinculo, pagaPorDiaria, ehTemporario, recebeMensal, salarioConsultoria } from '../../lib/utils'
import { format, getDaysInMonth, startOfMonth, endOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { confirmar } from '../../components/ui/ConfirmDialog'
import JornadaAviso from './JornadaAviso'
import { jornadaDoVinculo, desvioDoDia, textoDoDesvio, TOLERANCIA_MIN, minutosLiquidos } from '../../lib/jornada'
import type { VinculoJornada } from '../../lib/jornada'

// Ela desistiu num diálogo de confirmação: não é erro, não mostra aviso
const CANCELADO = '__cancelado__'

type Tab = 'home' | 'folha' | 'agenda' | 'gastos' | 'duvidas'

export default function PortalHome() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const employeeId = localStorage.getItem('portal_employee_id')
  // localStorage pode devolver null (sessão antiga/limpa) — sem o fallback, o
  // .split() abaixo quebrava a tela toda
  const employeeName = localStorage.getItem('portal_employee_name') || ''
  const token = localStorage.getItem('portal_token')
  const [tab, setTab] = useState<Tab>('home')
  const [folhaMonth, setFolhaMonth] = useState(format(new Date(), 'yyyy-MM'))

  // Toda comunicação com o banco passa por funções portal_* validadas no servidor.
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      // Só sai do portal quando a SESSÃO acabou (código 28000). Antes qualquer
      // erro com "invalid" na mensagem derrubava o login — a pessoa entrava e
      // era jogada para fora sem saber por quê.
      const sessaoAcabou = (error as { code?: string }).code === '28000' || /sess[aã]o inv[aá]lida|expirad/i.test(error.message)
      console.error('[portal]', fn, error)
      if (sessaoAcabou) {
        toast.error('Sua sessão expirou. Entre de novo.')
        localStorage.removeItem('portal_token'); navigate('/portal')
      } else {
        toast.error('Erro no portal (' + fn + '): ' + error.message, { id: 'erro-' + fn, duration: 8000 })
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
  // Calendário único da agenda: dia aberto, filtro por cliente e a troca em andamento
  const [diaAgenda, setDiaAgenda] = useState<string | null>(null)
  const [agendaCliente, setAgendaCliente] = useState('')
  type AgendaItem = {
    id: string; planned_date: string; planned_time?: string | null; notes?: string | null; hours_expected?: number | null
    client_id?: string | null; unit_id?: string | null; unit?: { name: string } | null; created_by_admin?: boolean
    original_date?: string | null; original_client_id?: string | null
  }
  type ItemAgenda = {
    tipo: 'escala' | 'visita' | 'feita' | 'falta' | 'troca'
    clientId: string; linkId?: string; agenda?: AgendaItem; feita?: boolean; alterada?: boolean; horario?: string
    aviso?: { id: string; client_id: string; type: 'falta' | 'troca'; notice_date: string; swap_work_date?: string | null; reason?: string | null }
  }
  const [troca, setTroca] = useState<{ agenda: AgendaItem; modo: 'cliente' | 'dia'; cliente: string; unidade: string; data: string; motivo: string } | null>(null)
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
    if (baseError && ((baseError as { code?: string }).code === '28000' || /sess[aã]o inv[aá]lida|expirad/i.test((baseError as Error).message))) {
      sealClosed(); navigate('/portal')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseError])

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const links = base?.links as any[] | undefined
  const allUnits = base?.units as any[] | undefined
  // A agenda do portal_base só traz dias de hoje em diante: dia combinado que
  // já passou sem registro sumia. portal_agenda (migração 056) traz o mês
  // inteiro; juntamos as duas. Sem a migração, fica só a de hoje em diante.
  const { data: agendaDoMes } = useQuery({
    queryKey: ['portal-agenda-mes', employeeId, agendaMonth],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_agenda', { p_token: token, p_month: agendaMonth })
      if (error) { console.warn('portal_agenda:', error.message); return [] }
      return (data || []) as any[]
    },
    enabled: !!token,
  })
  // Agenda do mês que está na FOLHA (pode ser outro mês que o da aba Agenda):
  // o fixo de consultoria vê "consultorias realizadas × programadas"
  const { data: agendaDaFolha } = useQuery({
    queryKey: ['portal-agenda-mes', employeeId, folhaMonth],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_agenda', { p_token: token, p_month: folhaMonth })
      if (error) { console.warn('portal_agenda:', error.message); return [] }
      return (data || []) as any[]
    },
    enabled: !!token,
  })
  // Vínculo que vale no dia: começou e não terminou. Desvinculou/encerrou =
  // contract_end_date no último dia. Depois disso o cliente some do portal
  // (agenda e avisos inclusive); o histórico fica só no sistema do RH.
  const vinculoValeNoDia = (clientId: string | null | undefined, dia: string) =>
    !!clientId && (links || []).some((l: { client_id?: string; client?: { id: string }; start_date?: string | null; contract_end_date?: string | null }) =>
      (l.client_id || l.client?.id) === clientId
      && (!l.start_date || dia >= l.start_date)
      && (!l.contract_end_date || dia <= l.contract_end_date))
  const agenda = (() => {
    const futura = (base?.agenda as any[] | undefined) || []
    const doMes = agendaDoMes || []
    if (!base && !agendaDoMes) return undefined
    const vistos = new Set(futura.map(a => a.id))
    return [...doMes.filter(a => !vistos.has(a.id)), ...futura]
      .filter(a => vinculoValeNoDia(a.client_id, String(a.planned_date)))
      .sort((a, b) => String(a.planned_date).localeCompare(String(b.planned_date)))
  })()
  const notices = (base?.notices as any[] | undefined)
    ?.filter(n => vinculoValeNoDia(n.client_id, String(n.notice_date)))
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
      { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) }
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
      { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) }
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
      { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) }
      setAgendaForm(null)
      setAgendaEntry({ planned_date: '', unit_id: '', notes: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteAgenda = useMutation({
    mutationFn: async (id: string) => {
      await rpc('portal_delete_agenda', { p_token: token, p_id: id })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) },
  })

  // Remarcar a data de uma visita planejada — guarda a data original; o chefe vê na agenda dela
  const rescheduleAgenda = useMutation({
    mutationFn: async ({ id, newDate, currentDate, originalDate }: { id: string; newDate: string; currentDate: string; originalDate: string | null }) => {
      await rpc('portal_reschedule_agenda', { p_token: token, p_id: id, p_new_date: newDate, p_original: originalDate || currentDate })
    },
    onSuccess: () => {
      toast.success('Visita remarcada!')
      { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) }
      setReschedAgenda(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const trocarVisita = useMutation({
    mutationFn: async () => {
      if (!troca) return
      const a = troca.agenda
      await rpc('portal_trocar_visita', {
        p_token: token,
        p_id: a.id,
        p_nova_data: troca.modo === 'dia' ? troca.data : null,
        p_novo_cliente: troca.modo === 'cliente' ? troca.cliente : null,
        p_nova_unidade: troca.modo === 'cliente' ? (troca.unidade || null) : null,
        p_motivo: troca.motivo.trim() || null,
      })
    },
    onSuccess: () => {
      toast.success('Troca registrada. A equipe foi avisada.')
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] })
      setTroca(null)
    },
    onError: (e: Error) => toast.error(/portal_trocar_visita|function/i.test(e.message) ? 'Troca ainda não disponível — avise o RH (migração 060).' : e.message),
  })

  const registrarPonto = useMutation({
    mutationFn: async () => {
      if (!pontoForm.client_id) throw new Error('Selecione o cliente')
      if (!pontoForm.visit_date) throw new Error('Informe a data')
      const link = getLinkForClient(pontoForm.client_id, pontoForm.visit_date)
      const isConsultoria = effectiveType(link) === 'Consultoria'

      // Trabalhei / Folga / Faltei vale para Fixo e Consultoria (pedido de 29/09).
      // Folga e falta não têm horário, unidade nem valor.
      // Folga e Falta só para quem recebe mensal; os demais só registram trabalho
      const isNormal = !recebeMensal(link) || pontoForm.day_type === 'normal'
      if (isNormal && (!pontoForm.check_in || !pontoForm.check_out))
        throw new Error('Informe os horários de entrada e saída')
      // Folga/falta num dia que já é folga pela escala não faz sentido (e mascararia falta de outro dia)
      if (!isNormal && !isConsultoria && isDayOff(link, pontoForm.visit_date))
        throw new Error('Este dia já é sua folga pela escala. Não precisa registrar folga nem falta.')
      if (!isNormal && !pontoForm.unavailability_reason)
        throw new Error(pontoForm.day_type === 'feriado' ? 'Informe o motivo da folga' : 'Informe o motivo da falta')
      if (isConsultoria && isNormal && !pontoForm.unit_id && getLinkUnitsForClient(pontoForm.client_id).length > 0)
        throw new Error('Escolha a unidade')

      // Trabalhou menos que a jornada do vínculo? Ela confirma sabendo que o RH é informado
      if (isNormal) {
        const j = jornadaDoVinculo(link as VinculoJornada)
        const d = j ? desvioDoDia({ check_in: pontoForm.check_in, check_out: pontoForm.check_out }, j) : null
        if (j && d && (d.difMin < -TOLERANCIA_MIN || d.atrasoMin > TOLERANCIA_MIN || d.saidaCedoMin > TOLERANCIA_MIN)) {
          const ok = await confirmar({
            titulo: 'Você trabalhou menos que a jornada',
            texto: `${textoDoDesvio(d, j)}.\n\nAo confirmar, o RH será informado de que você trabalhou menos neste dia.`,
            confirmar: 'Confirmar e informar o RH',
            cancelar: 'Corrigir horário',
          })
          if (!ok) throw new Error(CANCELADO)
        }
      }

      // Registrou num dia que NÃO estava combinado, tendo dia em aberto no mesmo
      // cliente? Pergunta o que aconteceu. Sem isso o combinado ficava pendente
      // pra sempre e o painel acusava "não apareceu" sem saber que ela foi noutro dia.
      // Só Consultoria: o fixo trabalha pela escala, não troca dia de visita
      let trocarAgendaId: string | null = null
      if (isConsultoria && isNormal && !editingPontoId) {
        const doDia = (agenda || []).some(a =>
          a.planned_date === pontoForm.visit_date && (a as { client_id?: string }).client_id === pontoForm.client_id)
        if (!doDia) {
          const abertos = (agenda || [])
            .filter(a => (a as { client_id?: string }).client_id === pontoForm.client_id)
            .filter(a => !(folhaVisits || []).some(v =>
              v.visit_date === a.planned_date && v.client_id === pontoForm.client_id && v.check_out))
            .sort((a, b) => Math.abs(+new Date(a.planned_date) - +new Date(pontoForm.visit_date))
                          - Math.abs(+new Date(b.planned_date) - +new Date(pontoForm.visit_date)))
          const maisProximo = abertos[0]
          if (maisProximo) {
            // Antes era "OK = troquei / Cancelar = a mais" na caixinha do navegador:
            // ninguém sabia o que o Cancelar fazia. Agora cada botão diz o que é.
            const trocar = await confirmar({
              titulo: `Você tinha visita combinada em ${formatDate(maisProximo.planned_date)}`,
              texto: `Esta visita de ${formatDate(pontoForm.visit_date)} substitui aquela, ou é uma visita a mais?\n\nO RH é avisado nos dois casos.`,
              confirmar: 'Troquei o dia',
              cancelar: 'É uma visita a mais',
            })
            // A troca só é gravada DEPOIS que o registro salvar (antes, se o registro
            // desse erro, a agenda já tinha sido mexida)
            if (trocar) trocarAgendaId = maisProximo.id
          }
        }
      }

      // Relatório: consultoria sempre; Volante em qualquer cobertura (consultoria ou fixo).
      // NÃO bloqueia o check-in — sem anexo o registro fica com pendência visível
      // no portal, na ficha do colaborador e na tela de pagamento.
      // Cobertura por diária (antigo freela) também entrega relatório
      const isVolante = link?.service_type === 'Volante' || pagaPorDiaria(link)
      let reportPending = false
      if (isNormal && (isConsultoria || isVolante) && !reportFile) {
        const existing = editingPontoId
          ? (((monthFolha?.visits as { id: string; report_url?: string }[] | undefined) || []).find(v => v.id === editingPontoId))
          : null
        if (!existing?.report_url) reportPending = true
      }

      // Visitas do mesmo cliente/mês já carregadas (sem nova consulta ao banco)
      const sameMonthVisits = ((monthFolha?.visits as { id: string; client_id: string; visit_date: string; check_in?: string; check_out?: string }[] | undefined) || [])
        .filter(v => v.client_id === pontoForm.client_id && v.visit_date.slice(0, 7) === pontoForm.visit_date.slice(0, 7) && v.id !== editingPontoId)

      // Fixo: um registro por dia — duplicado infla horas e dias trabalhados (Consultoria pode ter 2+ visitas/dia)
      if (!isConsultoria && !editingPontoId && sameMonthVisits.some(v => v.visit_date === pontoForm.visit_date)) {
        throw new Error(`Já existe um registro em ${formatDate(pontoForm.visit_date)} — toque no lápis do registro para editar.`)
      }

      // Consultoria: valor da visita pela fórmula unidade × (horas ÷ semana cheia)
      let visitAmount: number | null = null
      let extraApproval: string | null = null
      let proposedAmount: number | null = null
      if (isConsultoria && isNormal) {
        const unit = getLinkUnitsForClient(pontoForm.client_id).find(u => u.id === pontoForm.unit_id)
        visitAmount = calcVisitAmount(unit?.visit_rate ?? null, pontoForm.check_in, pontoForm.check_out, Number(link?.weekly_hours_quota) || null)

        // Visita abaixo do combinado → desconto proporcional. Confirma com a pessoa antes de lançar.
        const quotaH = Number(link?.weekly_hours_quota) || null
        if (visitAmount != null && unit?.visit_rate && quotaH && visitAmount < Number(unit.visit_rate)) {
          const hrs = calcDurationMin(pontoForm.check_in, pontoForm.check_out) / 60
          const ok = await confirmar({
            titulo: `Visita com ${hrs.toFixed(1)}h de ${quotaH}h combinadas`,
            texto: `Valor proporcional: R$ ${visitAmount.toFixed(2)} (visita cheia: R$ ${Number(unit.visit_rate).toFixed(2)}).\n\nConfirmar o lançamento com esse valor?`,
            confirmar: 'Lançar assim',
            cancelar: 'Corrigir horário',
          })
          if (!ok) throw new Error('Lançamento cancelado — confira os horários e registre novamente.')
        }

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
        is_holiday: !isNormal && pontoForm.day_type === 'feriado',
        is_unavailable: !isNormal && pontoForm.day_type === 'indisponivel',
        // Motivo da falta ou da folga (o RH vê os dois)
        unavailability_reason: !isNormal ? pontoForm.unavailability_reason : null,
        observations: pontoForm.observations || null,
        unit_id: isConsultoria && isNormal ? (pontoForm.unit_id || null) : null,
        unit_name: isConsultoria && isNormal ? (pontoForm.unit_name || null) : null,
        visit_rate: isConsultoria && isNormal ? visitAmount : null,
        extra_approval: isConsultoria ? extraApproval : (isExtra ? 'pendente' : null),
        proposed_amount: isConsultoria ? proposedAmount : fixoProposedAmount,
        is_extra: isExtra,
        extra_amount: null, // admin define o valor no painel de Visitas
        is_swap: isSwap,
        swapped_from: isSwap ? pontoForm.swapped_from : null,
      }

      const recordId = await rpc<string>('portal_save_visit', { p_token: token, p_payload: payload })

      // Visita salva: agora sim move a visita combinada para este dia
      let trocaFalhou = false
      if (trocarAgendaId) {
        const { error: eTroca } = await supabase.rpc('portal_trocar_dia_agenda', { p_token: token, p_id: trocarAgendaId, p_nova_data: pontoForm.visit_date })
        if (eTroca) trocaFalhou = true
      }

      // Upload atestado (falta) ou relatório (consultoria) — o arquivo vai pro storage e a URL é gravada via função.
      // Se o envio falhar o registro já está salvo; antes a falha era engolida
      // e a pessoa achava que o atestado tinha ido.
      const anexosFalhos: string[] = []
      const enviar = async (file: File, pasta: string, campo: string, nome: string) => {
        try {
          const ext = file.name.split('.').pop()
          const path = `${pasta}/${employeeId}/${recordId}.${ext}`
          const { error: upErr } = await supabase.storage.from('arquivos').upload(path, file, { upsert: true })
          if (upErr) throw upErr
          await rpc('portal_set_visit_file', { p_token: token, p_id: recordId, p_field: campo, p_url: path })
        } catch {
          anexosFalhos.push(nome)
        }
      }
      if (atestadoFile && recordId) await enviar(atestadoFile, 'atestados', 'atestado_url', 'atestado')
      if (reportFile && recordId && (isConsultoria || link?.service_type === 'Volante' || pagaPorDiaria(link))) {
        await enviar(reportFile, 'relatorios', 'report_url', 'relatório')
      }

      return { reportPending, anexosFalhos, trocaFalhou }
    },
    onSuccess: (result) => {
      toast.success(editingPontoId ? 'Registro atualizado!' : pontoForm.day_type === 'feriado' ? 'Folga registrada!' : pontoForm.day_type === 'indisponivel' ? 'Falta registrada!' : 'Registro salvo!')
      if (result?.anexosFalhos?.length) {
        toast.error(`O registro foi salvo, mas o ${result.anexosFalhos.join(' e o ')} não foi enviado. Toque no lápis do registro e anexe de novo.`, { duration: 9000 })
      }
      if (result?.trocaFalhou) {
        toast('A visita foi salva, mas a troca de dia não foi registrada na agenda. Avise o RH.', { duration: 8000 })
      }
      if (result?.reportPending) {
        toast('Relatório pendente. Anexe depois tocando no lápis do registro.', { duration: 7000 })
      }
      qc.invalidateQueries({ queryKey: ['portal-month', employeeId] })
      qc.invalidateQueries({ queryKey: ['portal-base', employeeId] })
      qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] })
      setShowPontoModal(false)
      setPontoForm(EMPTY_PONTO)
      setAtestadoFile(null)
      setReportFile(null)
      setEditingPontoId(null)
    },
    onError: (e: Error) => { if (e.message !== CANCELADO) toast.error(e.message) },
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
    visit_date: hojeISO(),
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
  // Vínculo encerrado sai do portal — vale pra QUALQUER tipo, não só Volante.
  // Desligar passou a encerrar o vínculo (antes apagava, o que destruía o
  // histórico de pagamento); sem este filtro a pessoa continuaria vendo e
  // batendo ponto num cliente de onde já saiu.
  const _today = hojeISO()
  const folhaLinks = links?.filter((l: Record<string, unknown>) => {
    const end = (l.contract_end_date as string) || ''
    if (end && end < _today) return false
    if (!ehTemporario(l)) return true
    const start = (l.start_date as string) || ''
    return !start || start <= _today
  })

  type FolhaLink = { id: string; service_type: string; coverage_type?: string; pay_mode?: string; is_temporary?: boolean; start_date?: string; contract_end_date?: string; monthly_amount?: number; work_schedule?: string; work_schedule_type?: string; daily_hours?: number; work_start?: string | null; work_end?: string | null; break_minutes?: number | null; days_off?: number[]; schedule_anchor_date?: string; weekly_hours_quota?: number; monthly_hours_quota?: number; visits_per_week?: number; link_units?: { unit_id: string; unit_name: string; visit_rate?: number }[]; client?: { id: string; name: string } }

  // Pode haver mais de um vínculo no mesmo cliente (ex: consultoria fixa +
  // freela de cobertura). Nesse caso o dia manda: se a data cai dentro do
  // período do freela, o registro é do freela; fora dele, é do vínculo fixo.
  // Antes um .find() cru pegava sempre o primeiro e o outro ficava invisível.
  const getLinkForClient = (clientId: string, dateStr?: string) => {
    const doCliente = (folhaLinks as FolhaLink[] | undefined)?.filter(l => l.client?.id === clientId) || []
    if (doCliente.length <= 1) return doCliente[0]
    const dia = dateStr || hojeISO()
    const freelaDoDia = doCliente.find(l =>
      ehTemporario(l) &&
      (!l.start_date || dia >= l.start_date) &&
      (!l.contract_end_date || dia <= l.contract_end_date))
    return freelaDoDia || doCliente.find(l => !ehTemporario(l)) || doCliente[0]
  }

  // Volante: o comportamento do portal segue coverage_type (Fixo ou Consultoria), não service_type
  const effectiveType = (link: FolhaLink | undefined) => tipoDoVinculo(link)

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
        // Só reembolso: ajuda de custo e vale-transporte são de CLT, não se aplicam
        category: 'Reembolso',
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
    const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    const regs = (folhaVisits || []) as { visit_date: string; client_id: string; check_in?: string; check_out?: string; break_start?: string; break_end?: string
      is_unavailable?: boolean; is_holiday?: boolean; is_extra?: boolean; is_swap?: boolean; unavailability_reason?: string; observations?: string; unit_name?: string; client?: { name: string } }[]
    // Horas líquidas: desconta o intervalo do dia ou, sem ele, o do contrato
    const minDoDia = (v: typeof regs[number]) => minutosLiquidos(v, getLinkForClient(v.client_id, v.visit_date)?.break_minutes)
    const trabalhados = regs.filter(v => v.check_out && !v.is_unavailable && !v.is_holiday)
    const totalDias = trabalhados.length
    const totalMins = trabalhados.reduce((s, v) => s + minDoDia(v), 0)
    const totalH = Math.floor(totalMins / 60)
    const totalM = totalMins % 60
    const nFolgas = regs.filter(v => v.is_holiday && !v.is_unavailable).length
    const nFaltas = regs.filter(v => v.is_unavailable).length
    const tipo = (v: typeof regs[number]) => v.is_unavailable ? 'Falta' : v.is_holiday ? 'Folga' : v.is_extra ? 'Dia extra' : v.is_swap ? 'Troca' : 'Trabalho'

    const rows = regs.map(v => {
      const m = minDoDia(v)
      const intervalo = v.break_start && v.break_end ? `${v.break_start.slice(0, 5)}–${v.break_end.slice(0, 5)}`
        : v.check_in && Number(getLinkForClient(v.client_id, v.visit_date)?.break_minutes) > 0 ? `${getLinkForClient(v.client_id, v.visit_date)?.break_minutes} min` : '-'
      return `
      <tr>
        <td>${formatDate(v.visit_date)}</td>
        <td>${esc(v.client?.name || '-')}${v.unit_name ? `<br/><span class="muted">${esc(v.unit_name)}</span>` : ''}</td>
        <td>${tipo(v)}</td>
        <td>${v.check_in?.slice(0,5) || '-'}</td>
        <td>${v.check_out?.slice(0,5) || '-'}</td>
        <td>${intervalo}</td>
        <td>${m > 0 ? fmtHoras(m) : '-'}</td>
        <td>${esc([v.unavailability_reason, v.observations].filter(Boolean).join(' · '))}</td>
      </tr>`
    }).join('')

    const html = `
      <!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Folha de Ponto – ${monthLabel}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; color: #1a1a1a; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 14px; margin-bottom: 24px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f3f4f6; text-align: left; padding: 8px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e5e7eb; }
        td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; vertical-align: top; }
        .muted { color: #6b7280; font-size: 11px; }
        tr:last-child td { border-bottom: none; }
        .totals { margin-top: 20px; padding: 16px; background: #f9fafb; border-radius: 8px; display: flex; gap: 40px; }
        .total-item { }
        .total-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
        .total-value { font-size: 18px; font-weight: bold; margin-top: 2px; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; color: #9ca3af; }
        .assinatura { border-top: 1px solid #d1d5db; padding-top: 8px; width: 200px; text-align: center; }
      </style>
      </head><body>
      <h1>Folha de Ponto — ${esc(employeeName)}</h1>
      <div class="sub">${monthLabel}</div>
      <table>
        <thead><tr><th>Data</th><th>Local</th><th>Tipo</th><th>Entrada</th><th>Saída</th><th>Intervalo</th><th>Horas</th><th>Motivo / observação</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="color:#9ca3af">Nenhum registro</td></tr>'}</tbody>
      </table>
      <div class="totals">
        <div class="total-item"><div class="total-label">Dias trabalhados</div><div class="total-value">${totalDias}</div></div>
        <div class="total-item"><div class="total-label">Horas trabalhadas</div><div class="total-value">${totalH}h${totalM > 0 ? String(totalM).padStart(2, '0') : ''}</div></div>
        ${nFolgas ? `<div class="total-item"><div class="total-label">Folgas</div><div class="total-value">${nFolgas}</div></div>` : ''}
        ${nFaltas ? `<div class="total-item"><div class="total-label">Faltas</div><div class="total-value">${nFaltas}</div></div>` : ''}
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
      { qc.invalidateQueries({ queryKey: ['portal-base', employeeId] }); qc.invalidateQueries({ queryKey: ['portal-agenda-mes', employeeId] }) }
      setDuvidaText('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const logout = () => {
    if (token) Promise.resolve(supabase.rpc('portal_logout', { p_token: token })).catch(() => {})
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
  // A pessoa é vinculada ao CLIENTE e escolhe a unidade aqui (pedido de 29/09).
  // Valor da visita: o combinado no vínculo, se houver; senão o da unidade no
  // cadastro do cliente. Mesma regra do banco (valor_da_unidade, migração 064).
  const getLinkUnitsForClient = (clientId: string): { id: string; name: string; visit_rate: number | null }[] => {
    const link = (folhaLinks as FolhaLink[] | undefined)?.find(l => l.client?.id === clientId)
      || links?.find(l => (l as { client?: { id: string } }).client?.id === clientId)
    const lu = (link as { link_units?: { unit_id: string; unit_name: string; visit_rate?: number }[] } | undefined)?.link_units || []
    // Fixo de consultoria recebe salário: não existe valor por visita para ela ver
    const semValor = salarioConsultoria(link as FolhaLink | undefined)
    const valorVinculo = new Map(lu.filter(u => Number(u.visit_rate) > 0).map(u => [u.unit_id, Number(u.visit_rate)]))
    const doCliente = getUnitsForClient(clientId).map(u => ({
      id: u.id as string, name: u.name as string,
      visit_rate: semValor ? null : valorVinculo.get(u.id as string) ?? (Number(u.visit_rate) > 0 ? Number(u.visit_rate) : null),
    }))
    // Unidade que só existe no vínculo (cadastro antigo) continua aparecendo
    for (const x of lu) if (!doCliente.some(u => u.id === x.unit_id)) doCliente.push({ id: x.unit_id, name: x.unit_name, visit_rate: semValor ? null : Number(x.visit_rate) || null })
    return doCliente
  }

  // ── Registro já preenchido ────────────────────────────────────────────
  // Clientes em que ela pode registrar num dia: vínculo em vigor e já começado
  const clientesDoDia = (dia: string) => {
    const vistos = new Map<string, string>()
    for (const l of (folhaLinks as FolhaLink[] | undefined) || []) {
      if (!l.client || (l.start_date && dia < l.start_date) || (l.contract_end_date && dia > l.contract_end_date)) continue
      vistos.set(l.client.id, l.client.name)
    }
    return Array.from(vistos, ([id, name]) => ({ id, name }))
  }
  // Horário do contrato (quando o vínculo tem horário definido) — ela só ajusta se foi diferente
  const horarioDoContrato = (clientId: string, dia: string) => {
    const l = getLinkForClient(clientId, dia)
    return l?.work_start && l?.work_end ? { check_in: l.work_start.slice(0, 5), check_out: l.work_end.slice(0, 5) } : {}
  }
  // O que o dia pede: visita marcada na agenda, dia de escala do Fixo ou o único cliente dela
  const sugestaoDoDia = (dia: string): Partial<typeof EMPTY_PONTO> => {
    const validos = clientesDoDia(dia)
    const jaRegistrado = (cid: string) => (folhaVisits || []).some(v => v.client_id === cid && v.visit_date === dia)
    const ag = ((agenda || []) as AgendaItem[]).find(a => a.planned_date === dia && !!a.client_id
      && !jaRegistrado(a.client_id) && validos.some(c => c.id === a.client_id))
    if (ag?.client_id) {
      return { client_id: ag.client_id, unit_id: ag.unit_id || '', unit_name: ag.unit?.name || '',
        ...horarioDoContrato(ag.client_id, dia), ...(ag.planned_time ? { check_in: ag.planned_time.slice(0, 5) } : {}) }
    }
    const escala = ((folhaLinks as FolhaLink[] | undefined) || []).find(l => l.client && validos.some(c => c.id === l.client!.id)
      && effectiveType(l) === 'Fixo' && hasKnownSchedule(l) && !isDayOff(l, dia) && !jaRegistrado(l.client.id))
    if (escala?.client) return { client_id: escala.client.id, ...horarioDoContrato(escala.client.id, dia) }
    if (validos.length === 1) return { client_id: validos[0].id, ...horarioDoContrato(validos[0].id, dia) }
    return {}
  }
  const abrirRegistro = (dia: string = hojeISO()) => {
    setEditingPontoId(null)
    setPontoForm({ ...EMPTY_PONTO, visit_date: dia, ...sugestaoDoDia(dia) })
    setAtestadoFile(null); setReportFile(null)
    setShowPontoModal(true)
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}>
      {/* Topo verde da marca com a saudação em serifa (visual aprovado em 23/09) */}
      <div className="bg-primary-900 text-white px-4 pb-5" style={{ paddingTop: 'max(0.875rem, env(safe-area-inset-top))', paddingBottom: tab === 'home' ? undefined : '0.875rem' }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            {tab === 'home' ? (
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="" className="w-6 h-6 rounded-md" />
                <span className="text-xs text-white/60">Portal do Nutricionista</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-xs shrink-0 ${corDoAvatar(employeeName)}`}>{getInitials(employeeName)}</div>
                <span className="text-sm font-medium truncate">{employeeName}</span>
              </div>
            )}
            <button onClick={logout} aria-label="Sair"
              className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white px-2 py-1.5 -mr-2 rounded-lg hover:bg-white/10 active:scale-95 transition-all">
              <LogOut size={15} /> Sair
            </button>
          </div>
          {tab === 'home' && <div className="flex items-center gap-3 mt-4">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center font-semibold text-sm shrink-0 ${corDoAvatar(employeeName)}`}>
              {getInitials(employeeName)}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white/60 first-letter:uppercase">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
              <h1 className="font-serif text-[1.75rem] leading-tight truncate !text-white">
                {saudacao()}, <span className="italic">{employeeName.split(' ')[0] || ''}</span>
              </h1>
            </div>
          </div>}
        </div>
      </div>

      {/* Barra de abas embaixo, onde o polegar alcança (respeita a área do iPhone) */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-ink-100"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="max-w-lg mx-auto flex">
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
                window.scrollTo({ top: 0 })
              }}
              className={`flex-1 pt-2.5 pb-2 flex flex-col items-center gap-1 text-[11px] font-medium relative transition-colors ${tab === key ? 'text-primary-700' : 'text-ink-400 active:text-ink-600'}`}
            >
              {tab === key && <span className="absolute top-0 inset-x-5 h-0.5 rounded-full bg-primary-700" />}
              <Icon size={20} strokeWidth={tab === key ? 2 : 1.75} />
              <span className="leading-none">{label}</span>
              {(badge ?? 0) > 0 && (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-[16px] h-4 bg-red-600 text-white text-[10px] font-semibold rounded-full flex items-center justify-center px-1 tnum">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <div className="max-w-lg mx-auto p-4 space-y-4">

        {/* ─── HOME TAB ─── */}
        {tab === 'home' && (() => {
          const todayStr = hojeISO()
          const allVisits = (monthFolha?.visits as { client_id?: string; check_out?: string; is_unavailable?: boolean; visit_date?: string }[] | undefined) || []
          const daysWorkedTotal = allVisits.filter(v => v.check_out && !v.is_unavailable).length
          const pendingAll = (folhaLinks as FolhaLink[] | undefined)?.flatMap(l => getPendingDays(l)) ?? []
          const monthLabel = new Date(folhaMonth + '-15').toLocaleDateString('pt-BR', { month: 'long' })
          // Minigráfico: um traço por dia do mês — registrado, falta, pendente ou nada
          const dim = getDaysInMonth(new Date(folhaMonth + '-15'))
          const pendSet = new Set(pendingAll)
          const diasMes = Array.from({ length: dim }, (_, i) => {
            const ds = `${folhaMonth}-${String(i + 1).padStart(2, '0')}`
            const doDia = allVisits.filter(v => v.visit_date === ds)
            const estado = doDia.some(v => v.check_out && !v.is_unavailable) ? 'feito'
              : doDia.some(v => v.is_unavailable) ? 'falta'
              : pendSet.has(ds) ? 'pendente'
              : 'vazio'
            return { ds, estado }
          })
          const next = (agenda as { planned_date?: string; planned_time?: string; client?: { name: string }; notes?: string }[] | undefined)
            ?.filter(a => (a.planned_date || '') >= todayStr)
            .sort((a, b) => (a.planned_date || '').localeCompare(b.planned_date || ''))[0]
          const avisos: { chave: string; icone: typeof Clock; titulo: string; sub: string; cor: string; acao: () => void }[] = []
          if (unreadChats > 0) avisos.push({
            chave: 'chat', icone: MessageCircle, cor: 'text-primary-700',
            titulo: unreadChats === 1 ? 'Nova mensagem do RH' : `${unreadChats} mensagens do RH`, sub: 'Toque para ler',
            acao: () => { setTab('duvidas'); markChatSeen() },
          })
          if (pendingAll.length > 0) avisos.push({
            chave: 'pend', icone: AlertTriangle, cor: 'text-amber-600',
            titulo: `${pendingAll.length} dia${pendingAll.length > 1 ? 's' : ''} sem registro`, sub: `O mais antigo: ${formatDate(pendingAll[0])}`,
            acao: () => setTab('folha'),
          })
          if (next) avisos.push({
            chave: 'next', icone: CalendarDays, cor: 'text-ink-500',
            titulo: 'Próxima visita',
            sub: `${next.planned_date === todayStr ? 'Hoje' : new Date(next.planned_date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}${next.planned_time ? ` às ${next.planned_time.slice(0, 5)}` : ''} · ${next.client?.name || next.notes || ''}`,
            acao: () => setTab('agenda'),
          })
          return (
            <div className="space-y-4">
              <button onClick={() => abrirRegistro()}
                className="btn-primary w-full py-3.5 text-base">
                <Plus size={18} /> Registrar hoje
              </button>

              {/* Seu mês: números + minigráfico dos dias */}
              <div className="card p-4">
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-medium text-ink-800">Seu mês <span className="text-ink-400 font-normal">· {monthLabel}</span></p>
                  <button onClick={() => setTab('folha')} className="text-xs text-primary-700 font-medium">Ver folha</button>
                </div>
                <div className="grid grid-cols-2 mt-3 divide-x divide-ink-100">
                  <div>
                    <p className="text-3xl font-semibold text-ink-900 tnum leading-none">{daysWorkedTotal}</p>
                    <p className="text-xs text-ink-500 mt-1.5">dia{daysWorkedTotal !== 1 ? 's' : ''} registrado{daysWorkedTotal !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="pl-4">
                    <p className={`text-3xl font-semibold tnum leading-none ${pendingAll.length ? 'text-amber-600' : 'text-ink-900'}`}>{pendingAll.length}</p>
                    <p className="text-xs text-ink-500 mt-1.5">{pendingAll.length ? `pendente${pendingAll.length > 1 ? 's' : ''}` : 'pendências'}</p>
                  </div>
                </div>
                <div className="flex items-end gap-[3px] h-6 mt-4" aria-hidden="true">
                  {diasMes.map(d => (
                    <span key={d.ds} className={`flex-1 rounded-sm ${
                      d.estado === 'feito' ? 'h-full bg-primary-600'
                      : d.estado === 'falta' ? 'h-full bg-red-500'
                      : d.estado === 'pendente' ? 'h-full bg-amber-400'
                      : d.ds === todayStr ? 'h-2/3 bg-ink-300'
                      : 'h-1/3 bg-ink-200'}`} />
                  ))}
                </div>
                <div className="flex gap-3 mt-2 text-[11px] text-ink-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary-600" />registrado</span>
                  {pendingAll.length > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400" />pendente</span>}
                  {diasMes.some(d => d.estado === 'falta') && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" />falta</span>}
                </div>
              </div>

              {avisos.length > 0 ? (
                <div className="card divide-y divide-ink-100 overflow-hidden">
                  {avisos.map(a => (
                    <button key={a.chave} onClick={a.acao} className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-ink-50 transition-colors">
                      <a.icone size={18} className={`shrink-0 ${a.cor}`} strokeWidth={1.75} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-900">{a.titulo}</p>
                        <p className="text-xs text-ink-500 truncate">{a.sub}</p>
                      </div>
                      {a.chave === 'chat' && <span className="min-w-[20px] h-5 px-1 bg-red-600 text-white text-[11px] font-semibold rounded-full flex items-center justify-center tnum">{unreadChats}</span>}
                      <ChevronRight size={16} className="text-ink-300 shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="card px-4 py-3.5 flex items-center gap-3">
                  <CheckCheck size={18} className="text-primary-600 shrink-0" />
                  <p className="text-sm text-ink-700">Tudo em dia. Nenhuma pendência.</p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ─── FOLHA DE PONTO TAB ─── */}
        {tab === 'folha' && (
          <>
            <div className="space-y-3">
              <h2 className="font-serif text-[1.75rem] leading-tight text-ink-900">Folha de ponto</h2>
              <div className="flex items-center gap-2">
                <MesSeletor value={folhaMonth} onChange={setFolhaMonth} />
                <button onClick={downloadFolha} className="btn-secondary text-sm px-3 shrink-0" aria-label="Baixar PDF">
                  <Download size={16} /> PDF
                </button>
              </div>
              <button onClick={() => abrirRegistro()}
                className="btn-primary text-sm w-full py-3">
                <Plus size={16} /> Registrar dia
              </button>
            </div>

            {/* Resumo por cliente. Mostra o valor da visita por unidade (pedido em 29/09),
                mas não a soma "a receber" do mês (decisão de 23/09). */}
            {(folhaLinks as FolhaLink[] | undefined)?.map(link => {
              const client = link.client
              const clientVisits = folhaVisits?.filter(v => v.client_id === client?.id) ?? []
              const daysWorked = clientVisits.filter(v => v.check_out && !(v as { is_unavailable?: boolean }).is_unavailable).length
              const isConsultoria = effectiveType(link) === 'Consultoria'
              const pendingDays = !isConsultoria ? getPendingDays(link) : []
              const extraDays = !isConsultoria ? clientVisits.filter(v => (v as { is_extra?: boolean }).is_extra) : []
              const faltas = clientVisits.filter(v => (v as { is_unavailable?: boolean }).is_unavailable)
              const monthlyQuota = Number(link.monthly_hours_quota) || null
              const weeklyQuota = Number(link.weekly_hours_quota) || null
              const weeklyCapMins = weeklyQuota ? weeklyQuota * 60 : Infinity
              // Horas do dia descontando o intervalo (o do dia ou, sem ele, o do contrato)
              const liquido = (v: { check_in?: string; check_out?: string; break_start?: string; break_end?: string }) =>
                minutosLiquidos(v, link.break_minutes)
              const validas = clientVisits.filter(v => v.check_in && v.check_out && !(v as { is_unavailable?: boolean }).is_unavailable)
              const mensal = recebeMensal(link)
              const salario = salarioConsultoria(link)
              const folgas = clientVisits.filter(v => (v as { is_holiday?: boolean }).is_holiday && !(v as { is_unavailable?: boolean }).is_unavailable)
              // Fixo de consultoria: quantas consultorias a agenda do RH programou no mês
              const programadas = salario
                ? ((agendaDaFolha || []) as { client_id?: string; planned_date: string }[])
                    .filter(a => a.client_id === client?.id && vinculoValeNoDia(a.client_id, String(a.planned_date))).length
                : 0
              // Consultoria: cada visita conta no máximo a cota semanal (excesso vai para aprovação)
              const totalMins = validas.reduce((s, v) => s + (isConsultoria ? Math.min(liquido(v), weeklyCapMins) : liquido(v)), 0)
              // Horas a mais que ainda esperam o RH (migração 062). Depois que o RH
              // decide (paga ou não), o aviso sai daqui — antes ficava para sempre.
              const temDecisao = validas.some(v => 'excesso_status' in (v as object))
              const excessMins = isConsultoria && !salario
                ? validas.filter(v => !temDecisao || (v as { excesso_status?: string | null }).excesso_status === 'pendente')
                    .reduce((s, v) => s + Math.max(0, liquido(v) - weeklyCapMins), 0)
                : 0
              const monthHours = totalMins / 60
              const unidades = isConsultoria && client ? getLinkUnitsForClient(client.id) : []
              // Fixo: horas além da jornada diária
              const dailyHours = !isConsultoria ? (Number(link.daily_hours) || null) : null
              const extraHours = dailyHours
                ? validas.filter(v => !(v as { is_extra?: boolean }).is_extra)
                    .reduce((s, v) => s + Math.max(0, liquido(v) / 60 - dailyHours), 0)
                : 0
              const escala = (link as { work_schedule_type?: string }).work_schedule_type

              return (
                <div key={link.id} className="card overflow-hidden">
                  <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900 leading-snug">{client?.name}</p>
                      <p className="text-xs text-ink-500 mt-0.5">
                        {[salario ? 'Consultoria · salário mensal' : effectiveType(link), pagaPorDiaria(link) ? 'por diária' : null, !isConsultoria ? escala : null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-3xl font-semibold leading-none text-ink-900 tnum">{isConsultoria ? validas.length : daysWorked}</p>
                      <p className="text-[11px] text-ink-400 mt-1">{isConsultoria ? (validas.length === 1 ? 'visita' : 'visitas') : (daysWorked === 1 ? 'dia' : 'dias')}</p>
                    </div>
                  </div>

                  <div className="px-4 pb-4 space-y-3">
                    {salario ? (
                      // Fixo de consultoria: acompanha o programado × realizado; não há valor por visita
                      <div className="divide-y divide-ink-100 text-sm">
                        <div className="py-2 first:pt-0">
                          <div className="flex items-baseline justify-between">
                            <span className="text-ink-500">Consultorias no mês</span>
                            <span className="font-semibold text-ink-900 tnum">
                              {validas.length}{programadas > 0 ? <span className="font-normal text-ink-400"> de {programadas} programadas</span> : null}
                            </span>
                          </div>
                          {programadas > 0 && (
                            <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-2">
                              <div className="h-full bg-primary-600 rounded-full transition-all" style={{ width: `${Math.min(100, (validas.length / programadas) * 100)}%` }} />
                            </div>
                          )}
                        </div>
                        <div className="flex justify-between py-2">
                          <span className="text-ink-500">Horas no mês</span>
                          <span className="font-semibold text-ink-900 tnum">{fmtHoras(validas.reduce((s, v) => s + liquido(v), 0))}</span>
                        </div>
                        {folgas.length > 0 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Folgas</span>
                            <span className="font-semibold text-ink-900 tnum">{folgas.length}</span>
                          </div>
                        )}
                        {faltas.length > 0 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Faltas</span>
                            <span className="font-semibold text-red-600 tnum">{faltas.length}</span>
                          </div>
                        )}
                        {unidades.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-2.5">
                            {unidades.map(u => (
                              <span key={u.id} className="text-xs text-ink-600 bg-ink-50 border border-ink-100 px-2.5 py-1 rounded-full">{u.name}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : isConsultoria ? (
                      <>
                        <div>
                          <div className="flex items-baseline justify-between text-sm">
                            <span className="text-ink-500">Horas no mês</span>
                            <span className="font-semibold text-ink-900 tnum">
                              {fmtHoras(totalMins)}{monthlyQuota ? <span className="font-normal text-ink-400"> de {fmtHoras(monthlyQuota * 60)}</span> : null}
                            </span>
                          </div>
                          {monthlyQuota && (
                            <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-2">
                              <div className="h-full bg-primary-600 rounded-full transition-all" style={{ width: `${Math.min(100, (monthHours / monthlyQuota) * 100)}%` }} />
                            </div>
                          )}
                          <p className="text-xs text-ink-400 mt-1.5">
                            {[weeklyQuota ? `Até ${fmtHoras(weeklyQuota * 60)} por visita` : null,
                              (link as { visit_frequency?: string }).visit_frequency === 'Avulso' ? 'avulso'
                                : (link as { visit_frequency?: string }).visit_frequency ? `frequência ${(link as { visit_frequency?: string }).visit_frequency!.toLowerCase()}` : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {excessMins > 0 && (
                          <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                            <Hourglass size={14} className="shrink-0 mt-px" />
                            {fmtHoras(excessMins)} acima do combinado. A visita é paga pelo valor inteiro e o RH avalia as horas a mais.
                          </p>
                        )}
                        {unidades.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {unidades.map(u => (
                              <span key={u.id} className="text-xs text-ink-600 bg-ink-50 border border-ink-100 px-2.5 py-1 rounded-full">
                                {u.name}{u.visit_rate ? <span className="text-ink-900 font-medium tnum"> · {formatCurrency(u.visit_rate)}</span> : null}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="divide-y divide-ink-100 text-sm">
                        <div className="flex justify-between py-2 first:pt-0">
                          <span className="text-ink-500">Horas no mês</span>
                          <span className="font-semibold text-ink-900 tnum">{fmtHoras(totalMins)}</span>
                        </div>
                        {extraDays.length > 0 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Dias extras</span>
                            <span className="font-semibold text-ink-900 tnum">{extraDays.length}</span>
                          </div>
                        )}
                        {extraHours > 0.05 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Hora extra</span>
                            <span className="font-semibold text-ink-900 tnum">{fmtHoras(extraHours * 60)}</span>
                          </div>
                        )}
                        {mensal && folgas.length > 0 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Folgas</span>
                            <span className="font-semibold text-ink-900 tnum">{folgas.length}</span>
                          </div>
                        )}
                        {faltas.length > 0 && (
                          <div className="flex justify-between py-2">
                            <span className="text-ink-500">Faltas</span>
                            <span className="font-semibold text-red-600 tnum">{faltas.length}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {pendingDays.length > 0 && (
                      <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                        <p className="flex items-center gap-2 text-sm font-medium text-amber-800">
                          <AlertTriangle size={14} className="shrink-0" /> {pendingDays.length} dia{pendingDays.length > 1 ? 's' : ''} da escala sem registro
                        </p>
                        <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                          {pendingDays.slice(0, 6).map(d => formatDate(d)).join(', ')}{pendingDays.length > 6 ? '…' : ''}. Registre o dia ou a falta com o motivo.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Registros do mês */}
            {folhaVisits && folhaVisits.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink-800 px-1 pt-2">Registros</p>
                <div className="card divide-y divide-ink-100 overflow-hidden">
                {folhaVisits.map(v => {
                  const isHoliday = (v as { is_holiday?: boolean }).is_holiday
                  const isUnavailable = (v as { is_unavailable?: boolean }).is_unavailable
                  const unavailReason = (v as { unavailability_reason?: string }).unavailability_reason
                  const atestadoUrl = (v as { atestado_url?: string }).atestado_url
                  const breakStart = (v as { break_start?: string }).break_start
                  const breakEnd = (v as { break_end?: string }).break_end
                  // Líquido: desconta o intervalo do dia ou, sem ele, o do contrato
                  const dur = minutosLiquidos(v, getLinkForClient(v.client_id, v.visit_date)?.break_minutes)
                  const extraApproval = (v as { extra_approval?: string }).extra_approval
                  const abrirEdicao = () => {
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
                  }
                  // Relatório pendente: consultoria sempre; cobertura por diária também
                  const relatorioPendente = (() => {
                    if ((v as { report_url?: string }).report_url || isHoliday || isUnavailable || !v.check_in) return false
                    const vlink = getLinkForClient(v.client_id, v.visit_date)
                    return !!vlink && (vlink.service_type === 'Volante' || pagaPorDiaria(vlink) || effectiveType(vlink) === 'Consultoria')
                  })()
                  const dia = new Date(v.visit_date + 'T12:00:00')
                  return (
                    <div key={v.id} className="px-4 py-3.5 flex gap-3">
                      {/* Data em bloco */}
                      <div className="w-10 shrink-0 text-center pt-0.5">
                        <p className="text-[11px] text-ink-400 uppercase leading-none">{dia.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</p>
                        <p className="text-xl font-semibold text-ink-900 tnum leading-tight">{dia.getDate()}</p>
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink-900 truncate">{(v as { client?: { name: string } }).client?.name}</p>
                            {v.unit_name && <p className="text-xs text-ink-500 truncate">{v.unit_name}</p>}
                          </div>
                          <div className="flex items-center -mr-1.5 -mt-1 shrink-0">
                            <button className="text-ink-400 hover:text-ink-800 p-2 rounded-lg active:bg-ink-100" aria-label="Editar" onClick={abrirEdicao}>
                              <Pencil size={15} />
                            </button>
                            <button className="text-ink-300 hover:text-red-600 p-2 rounded-lg active:bg-red-50" aria-label="Excluir"
                              onClick={async () => { if (await confirmar({ titulo: `Excluir o registro de ${formatDate(v.visit_date)}?`, texto: 'O RH deixa de ver esse dia.', perigo: true })) deletePonto.mutate(v.id) }}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>

                        {v.check_in && !isHoliday && !isUnavailable && (
                          <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm text-ink-700 tnum">
                            {v.check_in.slice(0,5)} – {v.check_out?.slice(0,5) || '…'}
                            {dur > 0 && <span className="text-ink-400"> · {fmtHoras(dur)}</span>}
                            {breakStart && breakEnd && <span className="text-ink-400"> · intervalo {breakStart.slice(0,5)}–{breakEnd.slice(0,5)}</span>}
                          </p>
                          {/* Valor da visita (já é o valor final gravado; o portal não recalcula) */}
                          {Number(v.visit_rate) > 0 && <span className="text-sm font-semibold text-ink-900 tnum shrink-0">{formatCurrency(Number(v.visit_rate))}</span>}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1.5">
                          {isHoliday && <span className="badge bg-amber-50 text-amber-700">Folga{unavailReason ? ` · ${unavailReason}` : ''}</span>}
                          {isUnavailable && <span className="badge bg-red-50 text-red-700">Falta{unavailReason ? ` · ${unavailReason}` : ''}</span>}
                          {(v as { is_extra?: boolean }).is_extra && <span className="badge bg-ink-100 text-ink-700">Dia extra</span>}
                          {(v as { is_swap?: boolean }).is_swap && <span className="badge bg-ink-100 text-ink-700 inline-flex items-center gap-1"><Repeat size={11} /> Troca{(v as { swapped_from?: string }).swapped_from ? ` de ${formatDate((v as { swapped_from?: string }).swapped_from!)}` : ''}</span>}
                          {extraApproval === 'pendente' && <span className="badge bg-amber-50 text-amber-700">Aguardando gestor</span>}
                          {(v as { excesso_status?: string }).excesso_status === 'pendente' && <span className="badge bg-amber-50 text-amber-700">Horas a mais em análise</span>}
                          {(v as { excesso_status?: string }).excesso_status === 'pago' && <span className="badge bg-primary-50 text-primary-700">Hora extra paga{Number((v as { excesso_valor?: number }).excesso_valor) > 0 ? ` · ${formatCurrency(Number((v as { excesso_valor?: number }).excesso_valor))}` : ''}</span>}
                          {(v as { excesso_status?: string }).excesso_status === 'nao_pago' && <span className="badge bg-ink-100 text-ink-500">Horas a mais não pagas</span>}
                          {extraApproval === 'aprovada' && <span className="badge bg-primary-50 text-primary-700">Extra aprovada</span>}
                          {extraApproval === 'negada' && <span className="badge bg-ink-100 text-ink-500">Extra não remunerada</span>}
                          {atestadoUrl && <span className="badge bg-primary-50 text-primary-700 inline-flex items-center gap-1"><Check size={11} /> Atestado</span>}
                          {(v as { report_url?: string }).report_url && <span className="badge bg-primary-50 text-primary-700 inline-flex items-center gap-1"><Check size={11} /> Relatório</span>}
                          {relatorioPendente && (
                            <button onClick={abrirEdicao} className="badge bg-red-50 text-red-700 inline-flex items-center gap-1 active:bg-red-100">
                              <FileText size={11} /> Relatório pendente · anexar
                            </button>
                          )}
                        </div>

                        {(v as { observations?: string }).observations && <p className="text-xs text-ink-500">{(v as { observations?: string }).observations}</p>}
                      </div>
                    </div>
                  )
                })}
                </div>
              </div>
            )}

            {folhaVisits?.length === 0 && (
              <div className="card p-8 text-center">
                <Clock size={26} className="mx-auto mb-2 text-ink-300" strokeWidth={1.5} />
                <p className="text-ink-600 text-sm font-medium">Nenhum registro neste mês</p>
                <p className="text-ink-400 text-xs mt-0.5">Toque em Registrar dia para começar.</p>
              </div>
            )}

          </>
        )}

        {/* ─── GASTOS TAB ─── */}
        {tab === 'gastos' && (
          <>
            <div className="space-y-3">
              <div>
                <h2 className="font-serif text-[1.75rem] leading-tight text-ink-900">Gastos e reembolsos</h2>
                <p className="text-sm text-ink-500 mt-0.5">Peça o reembolso do que você pagou e anexe o comprovante.</p>
              </div>
              <MesSeletor value={folhaMonth} onChange={setFolhaMonth} />
              {!showExpForm && (
                <button className="btn-primary text-sm w-full py-3" onClick={() => setShowExpForm(true)}>
                  <Plus size={16} /> Pedir reembolso
                </button>
              )}
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
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-ink-900">Pedido de reembolso</h3>
                  <button className="p-1.5 -mr-1.5 text-ink-400" aria-label="Fechar" onClick={() => setShowExpForm(false)}><X size={18} /></button>
                </div>
                <div>
                  <label className="label">Descrição</label>
                  <input className="input w-full !text-base" placeholder="Ex.: Uber até o cliente" value={expenseForm.description} onChange={e => setExpenseForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <div>
                  <div>
                    <label className="label">Valor (R$)</label>
                    <input className="input !text-base tnum" type="number" inputMode="decimal" placeholder="0,00" value={expenseForm.amount} onChange={e => setExpenseForm(p => ({ ...p, amount: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="label">Observação (opcional)</label>
                  <input className="input w-full !text-base" value={expenseForm.notes} onChange={e => setExpenseForm(p => ({ ...p, notes: e.target.value }))} />
                </div>
                <button className="btn-primary w-full py-3" onClick={() => submitExpense.mutate()}
                  disabled={submitExpense.isPending || !expenseForm.description || !expenseForm.amount}>
                  {submitExpense.isPending ? 'Enviando…' : 'Registrar'}
                </button>
              </div>
            )}

            {myExpenses && myExpenses.length > 0 ? (
              <div className="card divide-y divide-ink-100 overflow-hidden">
                {myExpenses.map(e => (
                  <div key={e.id} className="px-4 py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{e.description}</p>
                      <p className="text-xs text-ink-500 truncate">{[e.category, e.notes].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-sm font-semibold text-ink-900 tnum">{formatCurrency(Number(e.amount))}</span>
                      {(e as { receipt_url?: string }).receipt_url ? (
                        <span className="text-[11px] text-primary-700 inline-flex items-center gap-1"><Check size={11} /> comprovante</span>
                      ) : (
                        <button className="text-[11px] font-medium text-red-700 inline-flex items-center gap-1 active:opacity-70"
                          disabled={uploadingExpId === e.id}
                          onClick={() => { setPendingExpenseUpload(e.id); expReceiptRef.current?.click() }}>
                          <Paperclip size={11} /> {uploadingExpId === e.id ? 'Enviando…' : 'Anexar comprovante'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="px-4 py-3 flex justify-between items-center bg-ink-50/60">
                  <span className="text-sm text-ink-500">Total do mês</span>
                  <span className="text-sm font-semibold text-ink-900 tnum">{formatCurrency(myExpenses.reduce((s, e) => s + Number(e.amount), 0))}</span>
                </div>
              </div>
            ) : !showExpForm && (
              <div className="card p-8 text-center">
                <CreditCard size={26} className="mx-auto mb-2 text-ink-300" strokeWidth={1.5} />
                <p className="text-ink-600 text-sm font-medium">Nenhum gasto neste mês</p>
              </div>
            )}
          </>
        )}

        {/* ─── CHAT (DÚVIDAS) TAB ─── */}
        {tab === 'duvidas' && (
          <>
            <div>
              <h2 className="font-serif text-[1.75rem] leading-tight text-ink-900">Chat com o RH</h2>
              <p className="text-sm text-ink-500 mt-0.5">As respostas aparecem aqui.</p>
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
            <div className="sticky bg-white border border-ink-200 rounded-2xl shadow-lift p-2 flex items-end gap-2" style={{ bottom: "calc(4.75rem + env(safe-area-inset-bottom))" }}>
              <textarea
                className="input flex-1 resize-none !text-base border-0 focus:ring-0 shadow-none"
                rows={1}
                placeholder="Mensagem para o RH"
                value={duvidaText}
                onChange={e => setDuvidaText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && duvidaText.trim()) { e.preventDefault(); enviarDuvida.mutate(duvidaText.trim()) } }}
              />
              <button
                className="btn-primary h-11 w-11 p-0 shrink-0 rounded-xl"
                aria-label="Enviar"
                disabled={!duvidaText.trim() || enviarDuvida.isPending}
                onClick={() => { if (duvidaText.trim()) enviarDuvida.mutate(duvidaText.trim()) }}
              >
                <Send size={17} />
              </button>
            </div>
          </>
        )}

        {/* ─── AGENDA TAB ─── */}
        {tab === 'agenda' && (() => {
          // ── UM calendário só (antes eram um por vínculo + a lista de planejadas) ──
          // Mostra tudo dela no mês: dias de escala, visitas da agenda, o que já
          // registrou, faltas e trocas. Filtra por cliente. Toque num dia para ver
          // o cliente, o horário (se tiver) e registrar ou trocar.
          const monthDate = new Date(agendaMonth + '-15')
          const daysInMonth = getDaysInMonth(monthDate)
          const firstDow = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay()
          const hojeStr = hojeISO()
          const vinculos = (folhaLinks as FolhaLink[] | undefined) || []
          const clientesDela = Array.from(new Map(vinculos.filter(l => l.client).map(l => [l.client!.id, l.client!.name])).entries())
          const nomeDoCliente = (id?: string | null) => {
            if (!id) return ''
            const l = ((links as FolhaLink[] | undefined) || []).find(x => x.client?.id === id)
            return l?.client?.name || 'Cliente'
          }
          const filtroOk = (clientId?: string | null) => !agendaCliente || clientId === agendaCliente
          const itensDoDia = (ds: string): ItemAgenda[] => {
            const out: ItemAgenda[] = []
            // Escala (fixo com escala cadastrada)
            for (const l of vinculos) {
              if (!hasKnownSchedule(l) || effectiveType(l) === 'Consultoria' || !filtroOk(l.client?.id)) continue
              if ((l.start_date && ds < l.start_date) || (l.contract_end_date && ds > l.contract_end_date)) continue
              if (!isDayOff(l, ds)) out.push({ tipo: 'escala', clientId: l.client?.id || '', linkId: l.id })
            }
            // Visitas da agenda
            for (const a of (agenda || []) as AgendaItem[]) {
              if (a.planned_date !== ds || !filtroOk(a.client_id)) continue
              const feita = (agendaVisits || []).some(v => v.visit_date === ds && v.client_id === a.client_id && v.check_out && !v.is_unavailable)
              const alterada = !!a.original_client_id || (!!a.original_date && a.original_date !== a.planned_date)
              out.push({ tipo: 'visita', clientId: a.client_id || '', agenda: a, feita, alterada })
            }
            // O que ela registrou (e não está na agenda)
            for (const v of (agendaVisits || []) as { id: string; visit_date: string; client_id: string; check_in?: string; check_out?: string; is_unavailable?: boolean }[]) {
              if (v.visit_date !== ds || !filtroOk(v.client_id)) continue
              if (v.is_unavailable) { out.push({ tipo: 'falta', clientId: v.client_id }); continue }
              if (!v.check_out) continue
              if (out.some(i => i.tipo === 'visita' && i.clientId === v.client_id)) continue
              out.push({ tipo: 'feita', clientId: v.client_id, horario: `${v.check_in?.slice(0, 5) || ''}–${v.check_out?.slice(0, 5) || ''}` })
            }
            // Avisos: falta e troca de dia da escala
            for (const n of (notices as Notice[] | undefined) || []) {
              if (!filtroOk(n.client_id)) continue
              if (n.type === 'falta' && n.notice_date === ds && !out.some(i => i.tipo === 'falta' && i.clientId === n.client_id)) out.push({ tipo: 'falta', clientId: n.client_id, aviso: n })
              if (n.type === 'troca' && (n.notice_date === ds || n.swap_work_date === ds)) out.push({ tipo: 'troca', clientId: n.client_id, aviso: n })
            }
            // Mesmo cliente no mesmo dia já na agenda (ex.: "Primeiro dia no cliente")
            // ou já registrado: o dia da escala é o mesmo compromisso, não aparece de novo
            return out.filter(i => i.tipo !== 'escala'
              || !out.some(o => (o.tipo === 'visita' || o.tipo === 'feita') && o.clientId === i.clientId))
          }
          const corDoItem = (i: ItemAgenda) =>
            i.tipo === 'visita' ? (i.feita ? 'bg-green-600' : i.alterada ? 'bg-pink-500' : 'bg-amber-500')
            : i.tipo === 'feita' ? 'bg-green-600'
            : i.tipo === 'falta' ? 'bg-red-500'
            : i.tipo === 'troca' ? 'bg-orange-400'
            : 'bg-sky-500'
          const podeAgendar = vinculos.some(l => effectiveType(l) === 'Consultoria' && (l as { agenda_mode?: string }).agenda_mode !== 'gestor')

          return (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-serif text-[1.75rem] leading-tight text-ink-900">Minha agenda</h2>
                  <p className="text-sm text-ink-500 mt-0.5">Toque num dia para registrar ou trocar.</p>
                </div>
                {podeAgendar && (
                  <button className="btn-primary text-sm shrink-0" onClick={() => {
                    const l = vinculos.find(x => effectiveType(x) === 'Consultoria' && (x as { agenda_mode?: string }).agenda_mode !== 'gestor')
                    if (l?.client) { setAgendaForm({ clientId: l.client.id, clientName: l.client.name }); setAgendaEntry(p => ({ ...p, planned_date: '' })) }
                  }}><Plus size={16} /> Agendar</button>
                )}
              </div>

              <div className="space-y-2">
                <MesSeletor value={agendaMonth} onChange={setAgendaMonth} />
                {clientesDela.length > 1 && (
                  <select className="input !text-base w-full" value={agendaCliente} onChange={e => setAgendaCliente(e.target.value)}>
                    <option value="">Todos os clientes</option>
                    {clientesDela.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
                  </select>
                )}
              </div>

              <div className="card p-3">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={i} className="text-center text-[11px] text-ink-400 font-medium">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const ds = `${agendaMonth}-${String(i + 1).padStart(2, '0')}`
                    const itens = itensDoDia(ds)
                    const ehHoje = ds === hojeStr
                    return (
                      <button key={ds} onClick={() => setDiaAgenda(ds)}
                        className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-1 active:scale-95 transition-all ${ehHoje ? 'border-primary-600 bg-primary-50' : itens.length ? 'border-ink-200 bg-white' : 'border-ink-100 bg-ink-50/40'}`}>
                        <span className={`text-xs ${ehHoje ? 'font-bold text-primary-700' : itens.length ? 'font-semibold text-ink-800' : 'text-ink-400'}`}>{i + 1}</span>
                        {itens.length > 0 && (
                          <span className="flex gap-0.5">
                            {itens.slice(0, 3).map((it, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full ${corDoItem(it)}`} />)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-ink-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Visita marcada</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-600" />Feita</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-pink-500" />Trocada</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" />Dia de escala</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Falta</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" />Troca de folga</span>
                </div>
              </div>

              {vinculos.length === 0 && (
                <div className="card p-8 text-center">
                  <CalendarDays size={28} className="mx-auto mb-2 text-ink-200" />
                  <p className="text-ink-400 text-sm font-medium">Você ainda não tem agenda. O RH vai montar os seus dias.</p>
                </div>
              )}

              {/* Dia aberto */}
              {diaAgenda && (() => {
                const ds = diaAgenda
                const itens = itensDoDia(ds)
                const futuro = ds > hojeStr
                const registrarNoDia = (clientId: string, a?: AgendaItem) => {
                  setEditingPontoId(null)
                  setPontoForm({ ...EMPTY_PONTO, visit_date: ds, client_id: clientId, unit_id: a?.unit_id || '', unit_name: a?.unit?.name || '',
                    ...horarioDoContrato(clientId, ds), ...(a?.planned_time ? { check_in: a.planned_time.slice(0, 5) } : {}) })
                  setAtestadoFile(null); setReportFile(null)
                  setDiaAgenda(null)
                  setShowPontoModal(true)
                }
                return (
                  <div className="modal-overlay" onClick={() => setDiaAgenda(null)}>
                    <div className="modal-box max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-ink-900 first-letter:uppercase">
                          {new Date(ds + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </h3>
                        <button onClick={() => setDiaAgenda(null)} className="p-1.5 rounded-lg text-ink-400" aria-label="Fechar"><X size={18} /></button>
                      </div>
                      {itens.length === 0 && <p className="text-sm text-ink-400">Nada neste dia.</p>}
                      <div className="space-y-2">
                        {itens.map((it, k) => {
                          const nome = nomeDoCliente(it.clientId)
                          if (it.tipo === 'visita' && it.agenda) {
                            const a = it.agenda
                            return (
                              <div key={k} className={`rounded-xl border p-3 space-y-2 ${it.alterada ? 'border-pink-200 bg-pink-50/50' : 'border-ink-200'}`}>
                                <div className="flex items-start gap-2">
                                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${corDoItem(it)}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-ink-900">{nome}</p>
                                    <p className="text-xs text-ink-500">
                                      {[a.unit?.name, a.planned_time ? `às ${a.planned_time.slice(0, 5)}` : null, a.hours_expected ? `${a.hours_expected}h` : null].filter(Boolean).join(' · ') || 'Sem horário definido'}
                                    </p>
                                    {a.notes && a.notes !== a.unit?.name && <p className="text-xs text-ink-500">{a.notes}</p>}
                                    {it.alterada && (
                                      <p className="text-xs text-pink-700 mt-0.5">
                                        Trocada{a.original_client_id ? ` — antes: ${nomeDoCliente(a.original_client_id)}` : ''}
                                        {a.original_date && a.original_date !== a.planned_date ? ` — era ${formatDate(a.original_date)}` : ''}
                                      </p>
                                    )}
                                    {it.feita && <p className="text-xs text-green-700 font-medium mt-0.5">Registrada</p>}
                                  </div>
                                </div>
                                {!it.feita && (
                                  <div className="flex gap-2">
                                    <button className="btn-primary text-xs py-2 flex-1" disabled={futuro}
                                      title={futuro ? 'Disponível no dia da visita' : undefined}
                                      onClick={() => registrarNoDia(a.client_id || '', a)}>Registrar</button>
                                    <button className="btn-secondary text-xs py-2 flex-1" onClick={() => {
                                      setDiaAgenda(null)
                                      setTroca({ agenda: a, modo: 'cliente', cliente: '', unidade: '', data: a.planned_date, motivo: '' })
                                    }}>Trocar</button>
                                    {!a.created_by_admin && (
                                      <button className="btn-ghost text-xs py-2 px-2 text-red-600" aria-label="Excluir"
                                        onClick={async () => { if (await confirmar({ titulo: 'Tirar esta visita da agenda?', perigo: true, confirmar: 'Tirar' })) deleteAgenda.mutate(a.id) }}>
                                        <Trash2 size={14} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          }
                          if (it.tipo === 'escala') {
                            return (
                              <div key={k} className="rounded-xl border border-ink-200 p-3 space-y-2">
                                <div className="flex items-start gap-2">
                                  <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-sky-500" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-ink-900">{nome}</p>
                                    <p className="text-xs text-ink-500">Dia de trabalho pela escala</p>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button className="btn-primary text-xs py-2 flex-1" disabled={futuro} onClick={() => registrarNoDia(it.clientId)}>Registrar</button>
                                  <button className="btn-secondary text-xs py-2 flex-1" onClick={() => {
                                    setDiaAgenda(null)
                                    setDayModal({ date: ds, linkId: it.linkId! }); setNoticeAction(''); setNoticeForm({ reason: '', otherDate: '' })
                                  }}>Avisar falta ou trocar</button>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={k} className="rounded-xl border border-ink-100 bg-ink-50/50 px-3 py-2.5 flex items-start gap-2">
                              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${corDoItem(it)}`} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink-900">{nome}</p>
                                <p className="text-xs text-ink-500">
                                  {it.tipo === 'feita' ? `Registrado ${it.horario || ''}`
                                    : it.tipo === 'falta' ? `Falta${it.aviso?.reason ? ` — ${it.aviso.reason}` : ''}`
                                    : it.aviso?.notice_date === ds ? `Folga por troca — trabalha em ${it.aviso?.swap_work_date ? formatDate(it.aviso.swap_work_date) : '?'}`
                                    : `Trabalha no lugar de ${it.aviso ? formatDate(it.aviso.notice_date) : ''}`}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                      {podeAgendar && ds >= hojeStr && (
                        <button className="btn-ghost text-sm w-full" onClick={() => {
                          const l = vinculos.find(x => effectiveType(x) === 'Consultoria' && (x as { agenda_mode?: string }).agenda_mode !== 'gestor')
                          if (l?.client) { setAgendaForm({ clientId: l.client.id, clientName: l.client.name }); setAgendaEntry(p => ({ ...p, planned_date: ds })); setDiaAgenda(null) }
                        }}><Plus size={15} /> Agendar visita neste dia</button>
                      )}
                    </div>
                  </div>
                )
              })()}
            </>
          )
        })()}
      </div>

      {/* ── Trocar visita (cliente/unidade ou dia) — só para vínculos dela ── */}
      {troca && (() => {
        const a = troca.agenda
        const vinculosNoDia = ((folhaLinks as FolhaLink[] | undefined) || []).filter(l => l.client
          && (!l.start_date || troca.data >= l.start_date) && (!l.contract_end_date || troca.data <= l.contract_end_date))
        const clientesTroca = Array.from(new Map(vinculosNoDia.map(l => [l.client!.id, l.client!.name])).entries())
        const clienteAlvo = troca.modo === 'cliente' ? troca.cliente : (a.client_id || '')
        const unidades = clienteAlvo ? getLinkUnitsForClient(clienteAlvo) : []
        const nomeAtual = ((links as FolhaLink[] | undefined) || []).find(l => l.client?.id === a.client_id)?.client?.name || 'Cliente'
        const valido = troca.modo === 'cliente'
          ? !!troca.cliente && (troca.cliente !== a.client_id || (!!troca.unidade && troca.unidade !== a.unit_id))
          : !!troca.data && troca.data !== a.planned_date
        return (
          <div className="modal-overlay" onClick={() => setTroca(null)}>
            <div className="modal-box max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
              <div>
                <h3 className="text-lg font-semibold text-ink-900">Trocar visita</h3>
                <p className="text-xs text-ink-500">{nomeAtual}{a.unit?.name ? ` · ${a.unit.name}` : ''} · {formatDate(a.planned_date)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {([['cliente', 'Outro cliente', 'no mesmo dia'], ['dia', 'Outro dia', 'mesmo cliente']] as const).map(([m, t, d]) => (
                  <button key={m} type="button" onClick={() => setTroca(p => p ? { ...p, modo: m, data: m === 'cliente' ? a.planned_date : p.data } : p)}
                    className={`text-left p-2.5 rounded-lg border-2 transition-colors ${troca.modo === m ? 'border-primary-600 bg-primary-50' : 'border-ink-200'}`}>
                    <p className="text-sm font-medium text-ink-900">{t}</p>
                    <p className="text-[11px] text-ink-500">{d}</p>
                  </button>
                ))}
              </div>

              {troca.modo === 'cliente' ? (
                <>
                  <div>
                    <label className="label">Vai para qual cliente? *</label>
                    <select className="input" value={troca.cliente} onChange={e => setTroca(p => p ? { ...p, cliente: e.target.value, unidade: '' } : p)}>
                      <option value="">Escolha…</option>
                      {clientesTroca.map(([id, nome]) => <option key={id} value={id}>{nome}{id === a.client_id ? ' (mesmo cliente, outra unidade)' : ''}</option>)}
                    </select>
                    <p className="text-[11px] text-ink-400 mt-1">Só aparecem os clientes em que você atua.</p>
                  </div>
                  {troca.cliente && unidades.length > 0 && (
                    <div>
                      <label className="label">Unidade{troca.cliente === a.client_id ? ' *' : ''}</label>
                      <select className="input" value={troca.unidade} onChange={e => setTroca(p => p ? { ...p, unidade: e.target.value } : p)}>
                        <option value="">{troca.cliente === a.client_id ? 'Escolha…' : 'Qualquer unidade'}</option>
                        {unidades.filter(u => troca.cliente !== a.client_id || u.id !== a.unit_id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <label className="label">Novo dia *</label>
                  <input type="date" className="input" min={hojeISO()} value={troca.data} onChange={e => setTroca(p => p ? { ...p, data: e.target.value } : p)} />
                </div>
              )}

              <div>
                <label className="label">Motivo</label>
                <textarea className="input" rows={2} placeholder="Opcional" value={troca.motivo} onChange={e => setTroca(p => p ? { ...p, motivo: e.target.value } : p)} />
              </div>

              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                Essa troca será notificada aos responsáveis no sistema.
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2">
                <button className="btn-secondary flex-1" onClick={() => setTroca(null)}>Cancelar</button>
                <button className="btn-primary flex-1" disabled={!valido || trocarVisita.isPending} onClick={() => trocarVisita.mutate()}>
                  {trocarVisita.isPending ? 'Salvando…' : 'Confirmar troca'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ─── AGENDA ADD MODAL ─── */}
      {agendaForm && (
        <div className="modal-overlay">
          <div className="modal-box max-w-sm space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900">Planejar visita</h3>
              <p className="text-xs text-gray-400 mt-0.5">Escolha só o dia que pretende ir. O horário você lança no dia, ao registrar.</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                {/* Só cliente de consultoria e ainda em vigor: `links` cru trazia
                    cliente de onde ela já saiu e cliente de escala fixa, onde
                    planejar visita não existe. */}
                {(folhaLinks as FolhaLink[] | undefined)?.filter(l =>
                  effectiveType(l) === 'Consultoria' && (l as { agenda_mode?: string }).agenda_mode !== 'gestor'
                ).map(l => {
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
          <div className="modal-overlay">
            <div className="modal-box max-w-sm space-y-4">
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
                        Vou faltar neste dia
                        <span className="block text-xs font-normal text-red-500">Avisa o RH com antecedência</span>
                      </button>
                      <button className="w-full text-left px-4 py-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium hover:border-amber-400 transition-colors"
                        onClick={() => setNoticeAction('troca-folgar')}>
                        Quero trocar este dia
                        <span className="block text-xs font-normal text-amber-600">Folgo aqui e trabalho em outro dia no lugar</span>
                      </button>
                    </>
                  )}
                  {off && (
                    <button className="w-full text-left px-4 py-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-800 text-sm font-medium hover:border-amber-400 transition-colors"
                      onClick={() => setNoticeAction('troca-trabalhar')}>
                      Vou trabalhar nesta folga
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
        const modalLink = getLinkForClient(pontoForm.client_id, pontoForm.visit_date)
        const isConsultoria = effectiveType(modalLink) === 'Consultoria'
        const mensal = recebeMensal(modalLink)
        const dayIsOff = !isConsultoria && pontoForm.day_type === 'normal' && isDayOff(modalLink, pontoForm.visit_date)
        const noFixedSchedule = !isConsultoria && modalLink && !hasKnownSchedule(modalLink)
        const extraDayValue = modalLink?.monthly_amount ? Math.round((Number(modalLink.monthly_amount) / 30) * 100) / 100 : null
        return (
        <div className="modal-overlay">
          <div className="modal-box max-w-md space-y-4">
            <h3 className="font-bold text-lg">{editingPontoId ? 'Editar registro' : 'Registrar dia'}</h3>

            {/* Quando: a data vem primeiro — ela define em quais clientes dá para registrar */}
            <div>
              <label className="label">Dia *</label>
              <div className="flex gap-2">
                {(() => {
                  const hoje = hojeISO()
                  const d = new Date(hoje + 'T12:00:00'); d.setDate(d.getDate() - 1)
                  const ontem = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                  return ([[hoje, 'Hoje'], [ontem, 'Ontem']] as const).map(([dia, rotulo]) => (
                    <button key={dia} type="button"
                      onClick={() => setPontoForm(p => p.visit_date === dia ? p : ({ ...p, visit_date: dia }))}
                      className={`px-3.5 rounded-xl border text-sm font-medium shrink-0 transition-colors ${pontoForm.visit_date === dia ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-ink-200 text-ink-600 active:bg-ink-50'}`}>
                      {rotulo}
                    </button>
                  ))
                })()}
                <input className="input flex-1 min-w-0" type="date" value={pontoForm.visit_date} onChange={e => setPontoForm(p => ({ ...p, visit_date: e.target.value }))} />
              </div>
            </div>

            {/* Onde: só os clientes com vínculo valendo no dia. Poucos = botões grandes. */}
            {(() => {
              const opcoes = clientesDoDia(pontoForm.visit_date)
              // O registro em edição pode ser de um cliente que já não está na lista
              const lista = pontoForm.client_id && !opcoes.some(c => c.id === pontoForm.client_id)
                ? [...opcoes, { id: pontoForm.client_id, name: ((links as FolhaLink[] | undefined) || []).find(l => l.client?.id === pontoForm.client_id)?.client?.name || 'Cliente' }]
                : opcoes
              const escolher = (cid: string) => setPontoForm(p => {
                if (p.client_id === cid) return p
                // Sugere o horário do contrato só quando ela ainda não digitou nada
                const horario = !p.check_in && !p.check_out ? horarioDoContrato(cid, p.visit_date) : {}
                const ag = ((agenda || []) as AgendaItem[]).find(a => a.client_id === cid && a.planned_date === p.visit_date)
                return { ...p, client_id: cid, unit_id: ag?.unit_id || '', unit_name: ag?.unit?.name || '', is_extra: false, is_swap: false, swapped_from: '',
                  day_type: 'normal', unavailability_reason: '', ...horario,
                  ...(ag?.planned_time && !p.check_in ? { check_in: ag.planned_time.slice(0, 5) } : {}) }
              })
              return (
                <div>
                  <label className="label">Cliente *</label>
                  {lista.length === 0 ? (
                    <p className="text-sm text-ink-500 bg-ink-50 rounded-xl px-3 py-2.5">Nenhum cliente com vínculo valendo nesse dia.</p>
                  ) : lista.length <= 4 ? (
                    <div className="grid grid-cols-1 gap-1.5">
                      {lista.map(c => (
                        <button key={c.id} type="button" onClick={() => escolher(c.id)}
                          className={`text-left px-3.5 py-3 rounded-xl border text-sm transition-colors ${pontoForm.client_id === c.id ? 'border-primary-600 bg-primary-50 text-primary-900 font-medium' : 'border-ink-200 text-ink-700 active:bg-ink-50'}`}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <select className="input" value={pontoForm.client_id} onChange={e => escolher(e.target.value)}>
                      <option value="">Selecionar...</option>
                      {lista.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                  {modalLink && (
                    <p className="text-xs text-ink-400 mt-1.5">
                      {isConsultoria
                        ? (salarioConsultoria(modalLink) ? 'Consultoria (salário mensal) — registre a consultoria com a unidade' : 'Consultoria — registre a visita com a unidade')
                        : `Fixo${modalLink.work_schedule_type ? ` · escala ${modalLink.work_schedule_type}` : ''}${Number(modalLink.daily_hours) > 0 ? ` · jornada de ${modalLink.daily_hours}h por dia` : ''}${modalLink.work_start && modalLink.work_end ? ` · das ${modalLink.work_start.slice(0, 5)} às ${modalLink.work_end.slice(0, 5)}` : ''}${Number(modalLink.break_minutes) > 0 ? ` · ${modalLink.break_minutes}min de intervalo` : ''}`}
                    </p>
                  )}
                </div>
              )
            })()}

            {/* ── Tipo do dia: só para quem recebe mensal (Fixo mensal e consultoria com salário) ── */}
            {modalLink && mensal && (
            <div>
              <label className="label">O que aconteceu neste dia? *</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'normal', label: 'Trabalhei', color: 'border-green-300 bg-green-50 text-green-800', active: 'border-green-500 bg-green-100' },
                  { value: 'feriado', label: 'Folga', color: 'border-amber-300 bg-amber-50 text-amber-800', active: 'border-amber-500 bg-amber-100' },
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

            {/* ── CONSULTORIA: unidade + horários + valor + relatório (só quando trabalhou) ── */}
            {isConsultoria && (!mensal || pontoForm.day_type === 'normal') && (
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Início *</label>
                    <input className="input" type="time" value={pontoForm.check_in} onChange={e => setPontoForm(p => ({ ...p, check_in: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Fim *</label>
                    <input className="input" type="time" value={pontoForm.check_out} onChange={e => setPontoForm(p => ({ ...p, check_out: e.target.value }))} />
                  </div>
                </div>
                <JornadaAviso vinculo={modalLink} entrada={pontoForm.check_in} saida={pontoForm.check_out} />
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
                {/* Relatório — obrigatório para consultoria */}
                <div>
                  <label className="label">Relatório da visita <span className="text-red-500 font-normal">— obrigatório</span></label>
                  <input ref={reportRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
                    onChange={e => setReportFile(e.target.files?.[0] || null)} />
                  <button
                    type="button"
                    onClick={() => reportRef.current?.click()}
                    className={`w-full border-2 border-dashed rounded-xl px-4 py-3 text-sm transition-colors text-center ${reportFile ? 'border-green-300 text-green-700 bg-green-50' : 'border-red-200 text-gray-500 hover:border-primary-400 hover:text-primary-600'}`}
                  >
                    {reportFile ? `✓ ${reportFile.name}` : '+ Anexar relatório (PDF ou foto) *'}
                  </button>
                  <p className="text-xs text-ink-400 mt-1">Dá para registrar sem o anexo, mas a visita fica marcada como <strong>relatório pendente</strong> até você anexar.</p>
                  {reportFile && (
                    <button type="button" onClick={() => setReportFile(null)} className="text-xs text-red-400 mt-1 hover:underline">Remover arquivo</button>
                  )}
                </div>
              </>
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
                  Foi um <strong>dia extra</strong>
                  <span className="text-xs text-gray-500">(valor definido pelo gestor)</span>
                </label>
                <label className={`flex items-center gap-2 text-sm cursor-pointer rounded-lg px-2 py-1.5 ${pontoForm.is_swap ? 'bg-blue-100 text-blue-800 font-medium' : 'text-green-700'}`}>
                  <input type="radio" name="folga-opt" checked={pontoForm.is_swap}
                    onChange={() => setPontoForm(p => ({ ...p, is_swap: true, is_extra: false }))} />
                  <strong>Troquei o dia</strong> — trabalhei hoje no lugar de outro dia da escala
                </label>
                {pontoForm.is_swap && (
                  <div className="pl-6">
                    <label className="label text-xs">Qual dia da escala você trocou? *</label>
                    <input className="input text-sm" type="date" value={pontoForm.swapped_from}
                      onChange={e => setPontoForm(p => ({ ...p, swapped_from: e.target.value }))} />
                    <p className="text-xs text-blue-600 mt-1">O dia trocado não fica pendente na sua folha. Troca de dia não gera pagamento extra.</p>
                  </div>
                )}
                {pontoForm.is_extra && <p className="text-xs text-amber-600">Dia extra registrado — o gestor será notificado e vai definir o valor a receber.</p>}
                {!pontoForm.is_extra && !pontoForm.is_swap && <p className="text-xs text-gray-500">Sem escolher, o dia é registrado como trabalho normal.</p>}
              </div>
            )}
            {/* Escala sem dias conhecidos (Plantão, 12x36 sem âncora): ela marca manualmente */}
            {!dayIsOff && noFixedSchedule && pontoForm.day_type === 'normal' && (
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer bg-gray-50 rounded-xl px-4 py-3">
                <input type="checkbox" className="rounded" checked={pontoForm.is_extra}
                  onChange={e => setPontoForm(p => ({ ...p, is_extra: e.target.checked }))} />
                Dia extra — trabalhei fora da minha escala
                {pontoForm.is_extra && extraDayValue ? <span className="font-bold text-green-700">+ R$ {extraDayValue.toFixed(2)}</span> : null}
              </label>
            )}

            {/* Normal: entrada / saída / intervalo */}
            {modalLink && !isConsultoria && pontoForm.day_type === 'normal' && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  if (raw <= 0) return null
                  const intervalo = Number(modalLink.break_minutes) || 0
                  const liquido = minutosLiquidos({ check_in: pontoForm.check_in, check_out: pontoForm.check_out }, intervalo)
                  return (
                    <div className="space-y-0.5">
                      <p className="text-xs text-ink-600 font-medium tnum">
                        Total: {fmtHoras(liquido)}{intervalo > 0 && <span className="font-normal text-ink-400"> (já descontado {fmtHoras(intervalo)} de intervalo)</span>}
                      </p>
                      <JornadaAviso vinculo={modalLink} entrada={pontoForm.check_in} saida={pontoForm.check_out} />
                    </div>
                  )
                })()}
              </>
            )}

            {/* Dia que já é folga pela escala: não se registra folga nem falta */}
            {modalLink && mensal && !isConsultoria && pontoForm.day_type !== 'normal' && isDayOff(modalLink, pontoForm.visit_date) && (
              <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-4 py-3">
                Este dia já é sua folga pela escala — não precisa registrar folga nem falta.
              </p>
            )}

            {/* Folga: foi dispensada (não é falta). Motivo obrigatório — o RH vê. */}
            {modalLink && mensal && pontoForm.day_type === 'feriado' && !(!isConsultoria && isDayOff(modalLink, pontoForm.visit_date)) && (
              <div className="space-y-2">
                <div>
                  <label className="label">Motivo da folga *</label>
                  <select className="input" value={pontoForm.unavailability_reason} onChange={e => setPontoForm(p => ({ ...p, unavailability_reason: e.target.value }))}>
                    <option value="">Selecionar motivo...</option>
                    <option value="Feriado">Feriado</option>
                    <option value="Cliente fechado">Cliente fechado</option>
                    <option value="Liberada pelo gestor">Liberada pelo gestor</option>
                    <option value="Cliente pediu para não ir">Cliente pediu para não ir</option>
                    <option value="Outro">Outro</option>
                  </select>
                </div>
                <p className="bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-700">
                  Folga é quando você foi dispensada. Não conta como falta nem como dia trabalhado, e o RH é avisado. Se foi você que não pôde ir, marque Faltei.
                </p>
              </div>
            )}

            {/* Volante cobrindo Fixo: relatório do dia é obrigatório também */}
            {modalLink && !isConsultoria && pontoForm.day_type === 'normal' && (modalLink?.service_type === 'Volante' || pagaPorDiaria(modalLink)) && (
              <div>
                <label className="label">Relatório do dia <span className="text-red-500 font-normal">— obrigatório</span></label>
                <input ref={reportRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="hidden"
                  onChange={e => setReportFile(e.target.files?.[0] || null)} />
                <button
                  type="button"
                  onClick={() => reportRef.current?.click()}
                  className={`w-full border-2 border-dashed rounded-xl px-4 py-3 text-sm transition-colors text-center ${reportFile ? 'border-green-300 text-green-700 bg-green-50' : 'border-red-200 text-gray-500 hover:border-primary-400 hover:text-primary-600'}`}
                >
                  {reportFile ? `✓ ${reportFile.name}` : '+ Anexar relatório (PDF ou foto) *'}
                </button>
                <p className="text-xs text-ink-400 mt-1">Dá para registrar sem o anexo, mas o dia fica marcado como <strong>relatório pendente</strong> até você anexar.</p>
                {reportFile && (
                  <button type="button" onClick={() => setReportFile(null)} className="text-xs text-red-400 mt-1 hover:underline">Remover arquivo</button>
                )}
              </div>
            )}

            {/* Falta: motivo + atestado — aparece para o RH cobrar/acompanhar */}
            {modalLink && mensal && pontoForm.day_type === 'indisponivel' && (
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

// ── Peças visuais do portal ────────────────────────────────────────────────

function saudacao() {
  const h = new Date().getHours()
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

// Minutos → "4h30", "2h", "0h" (antes aparecia "2.5h" e "4h30min")
function fmtHoras(mins: number) {
  const m = Math.round(mins)
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}

// Troca de mês com setas. O <input type="month"> do iPhone empurrava o título
// e saía da tela.
function MesSeletor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const d = new Date(value + '-15')
  const mover = (n: number) => onChange(format(new Date(d.getFullYear(), d.getMonth() + n, 15), 'yyyy-MM'))
  return (
    <div className="flex items-center flex-1 min-w-0 bg-white border border-ink-200 rounded-xl">
      <button type="button" className="p-2.5 text-ink-500 active:bg-ink-50 rounded-l-xl" aria-label="Mês anterior" onClick={() => mover(-1)}><ChevronLeft size={18} /></button>
      <span className="flex-1 text-center text-sm font-medium text-ink-800 first-letter:uppercase truncate">
        {d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
      </span>
      <button type="button" className="p-2.5 text-ink-500 active:bg-ink-50 rounded-r-xl" aria-label="Próximo mês" onClick={() => mover(1)}><ChevronRight size={18} /></button>
    </div>
  )
}
