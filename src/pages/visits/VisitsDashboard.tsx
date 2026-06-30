import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp,
  User, DollarSign, AlertCircle, MessageCircle, Send, ClipboardList, Zap,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate } from '../../lib/utils'
import { SignedLink } from '../../components/ui/SignedFile'
import toast from 'react-hot-toast'

type VisitTab = 'consultoria' | 'fixos' | 'volantes' | 'duvidas'

export default function VisitsDashboard() {
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)
  const [tab, setTab] = useState<VisitTab>('consultoria')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [extraAmounts, setExtraAmounts] = useState<Record<string, string>>({})
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useAuth()
  const isChefe = role === 'chefe'

  const monthDate = new Date(month + '-15')
  const monthStart = format(startOfMonth(monthDate), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(monthDate), 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')
  // Consultoria: "faltou/incompleto" só notifica nas últimas 24h do mês (ela pode fechar as visitas até a véspera).
  // Mês já encerrado (negativo) também mostra. Mês futuro fica quieto.
  const showShortfall = (endOfMonth(monthDate).getTime() - Date.now()) <= 24 * 60 * 60 * 1000

  const { data: employees } = useQuery({
    queryKey: ['visits-employees'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('id, full_name, cpf, portal_pin, role, employee_type')
        .eq('status', 'Ativo')
        .order('full_name')
      if (error) throw error
      return data || []
    },
  })

  const { data: links } = useQuery({
    queryKey: ['visits-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('id, employee_id, client_id, service_type, monthly_amount, daily_rate, link_units, monthly_hours_quota, weekly_hours_quota, work_schedule_type, days_off, schedule_anchor_date, start_date, contract_end_date, client:clients(id, name)')
      if (error) throw error
      return data || []
    },
  })

  const { data: visits } = useQuery({
    queryKey: ['visits-month', month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('*')
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd)
        .order('visit_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: openVisits } = useQuery({
    queryKey: ['visits-open'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('id, employee_id, visit_date, check_in, client_id')
        .is('check_out', null)
        .not('check_in', 'is', null)
        .order('visit_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: lastVisits } = useQuery({
    queryKey: ['visits-last'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('employee_id, visit_date')
        .order('visit_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Avisos da agenda do portal: falta avisada e trocas de dia combinadas
  const { data: notices } = useQuery({
    queryKey: ['schedule-notices', month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_notices')
        .select('*, employee:employees(full_name)')
        .or(`and(notice_date.gte.${monthStart},notice_date.lte.${monthEnd}),and(swap_work_date.gte.${monthStart},swap_work_date.lte.${monthEnd})`)
        .order('notice_date')
      if (error) throw error
      return data || []
    },
  })

  const { data: duvidas } = useQuery({
    queryKey: ['employee-questions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_questions')
        .select('*, employee:employees(id, full_name)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data || []
    },
    enabled: tab === 'duvidas',
  })

  // Visitas extras — chefe decide: pagar ou não. isFixo=true usa extra_amount; false usa visit_rate (consultoria)
  const decideExtra = useMutation({
    mutationFn: async ({ visitId, approve, amount, isFixo }: { visitId: string; approve: boolean; amount: number | null; isFixo?: boolean }) => {
      const update = isFixo
        ? { extra_approval: approve ? 'aprovada' : 'negada', extra_amount: approve ? amount : null }
        : { extra_approval: approve ? 'aprovada' : 'negada', visit_rate: approve ? amount : null }
      const { error } = await supabase.from('nutritionist_visits').update(update).eq('id', visitId)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.approve ? 'Extra aprovado — valor liberado!' : 'Extra marcado como não remunerado.')
      qc.invalidateQueries({ queryKey: ['visits-month', month] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const responderDuvida = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const { error } = await supabase
        .from('employee_questions')
        .update({ answer, answered_at: new Date().toISOString(), answered_by: 'RH' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success('Resposta enviada!')
      qc.invalidateQueries({ queryKey: ['employee-questions'] })
      setAnswers(prev => { const n = { ...prev }; delete n[vars.id]; return n })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Split employees by service type
  const volantEmps = (employees || []).filter(e => (e as { employee_type?: string }).employee_type === 'Volante')
  const volantIds = new Set(volantEmps.map(e => e.id))

  const consultoriaEmpIds = new Set(
    (links || []).filter(l => l.service_type === 'Consultoria' || l.service_type === 'Ambos').map(l => l.employee_id).filter(eid => !volantIds.has(eid))
  )
  const fixoEmpIds = new Set(
    (links || []).filter(l => l.service_type !== 'Consultoria' && l.service_type !== 'Volante').map(l => l.employee_id).filter(eid => !volantIds.has(eid))
  )
  const consultoriaEmps = (employees || []).filter(e => consultoriaEmpIds.has(e.id))
  const fixoEmps = (employees || []).filter(e => fixoEmpIds.has(e.id))

  const getEmployeeLinks = (empId: string) => (links || []).filter(l => l.employee_id === empId)
  const getEmployeeVisitsThisMonth = (empId: string) => (visits || []).filter(v => v.employee_id === empId)
  const getOpenVisitsForEmployee = (empId: string) => (openVisits || []).filter(v => v.employee_id === empId)
  const getLastVisitDate = (empId: string) => (lastVisits || []).find(v => v.employee_id === empId)?.visit_date || null

  const getDaysSinceLastVisit = (empId: string) => {
    const last = getLastVisitDate(empId)
    if (!last) return null
    return differenceInDays(new Date(today), new Date(last))
  }

  // Saída menor que entrada = turno noturno que vira a meia-noite (ex: 19:00 → 07:00)
  const durMins = (checkIn?: string, checkOut?: string) => {
    if (!checkIn || !checkOut) return 0
    const [h1, m1] = checkIn.slice(0, 5).split(':').map(Number)
    const [h2, m2] = checkOut.slice(0, 5).split(':').map(Number)
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1)
    if (diff === 0) return 0
    return diff > 0 ? diff : diff + 24 * 60
  }

  const formatDuration = (checkIn: string, checkOut: string) => {
    const mins = durMins(checkIn, checkOut)
    if (mins <= 0) return ''
    return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''}`
  }

  const totalVisitsThisMonth = (visits || []).filter(v => consultoriaEmpIds.has(v.employee_id)).length
  const employeesWithVisit = new Set((visits || []).filter(v => consultoriaEmpIds.has(v.employee_id)).map(v => v.employee_id)).size
  const employeesWithoutVisit = consultoriaEmps.length - employeesWithVisit
  const totalEarningsThisMonth = (visits || []).filter(v => consultoriaEmpIds.has(v.employee_id)).reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
  const totalOpenVisits = (openVisits || []).length
  const pendingDuvidas = (duvidas || []).filter(d => !d.answered_at).length

  const renderConsultoriaEmployee = (emp: { id: string; full_name: string; role?: string; portal_pin?: string }) => {
    const empVisits = getEmployeeVisitsThisMonth(emp.id)
    const empLinks = getEmployeeLinks(emp.id)
    const openEmp = getOpenVisitsForEmployee(emp.id)
    const daysSince = getDaysSinceLastVisit(emp.id)
    const lastDate = getLastVisitDate(emp.id)
    const hasVisitThisMonth = empVisits.length > 0
    const isExpanded = expandedEmployee === emp.id
    const empEarnings = empVisits.reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
    const empMins = empVisits.reduce((s, v) => s + durMins(v.check_in, v.check_out), 0)
    const empHours = empMins / 60
    const consultLink = empLinks.find(l => l.service_type === 'Consultoria') as { monthly_hours_quota?: number; link_units?: { visit_rate?: number }[] } | undefined
    const monthlyQuota = Number(consultLink?.monthly_hours_quota) || null
    const noRate = consultLink && !(consultLink.link_units || []).some(u => Number(u.visit_rate) > 0)
    const hasNoPin = !emp.portal_pin
    const rawAlert = !hasVisitThisMonth ? (daysSince === null ? 'never' : daysSince > 7 ? 'danger' : 'warning') : 'ok'
    // Antes das últimas 24h do mês não cobra "sem visita" — ela tem até o fim do mês pra fechar
    const alertLevel = (!showShortfall && rawAlert !== 'ok') ? 'no_prazo' : rawAlert

    return (
      <div key={emp.id} className={`card overflow-hidden border-l-4 ${
        openEmp.length > 0 ? 'border-l-red-500' :
        alertLevel === 'ok' ? 'border-l-green-400' :
        alertLevel === 'danger' ? 'border-l-red-400' :
        alertLevel === 'never' || alertLevel === 'no_prazo' ? 'border-l-gray-300' : 'border-l-amber-400'
      }`}>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
              {emp.full_name.trim().split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  className="font-semibold text-gray-900 hover:text-primary-700 hover:underline text-left"
                  onClick={() => navigate(`/colaboradores/${emp.id}`)}
                >
                  {emp.full_name.trim()}
                </button>
                {emp.role && <span className="text-xs text-gray-500">{emp.role}</span>}
                {hasNoPin && (
                  <span className="badge bg-gray-100 text-gray-500 text-xs flex items-center gap-1">
                    <AlertTriangle size={10} /> sem portal
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {openEmp.length > 0 && (
                  <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                    <AlertCircle size={12} />{openEmp.length} ponto em aberto
                  </span>
                )}
                {openEmp.length === 0 && alertLevel === 'ok' && (
                  <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                    <CheckCircle size={12} />{empVisits.length} visita{empVisits.length !== 1 ? 's' : ''} este mês
                  </span>
                )}
                {empHours > 0 && (
                  <span className={`text-xs font-medium ${monthlyQuota && empHours >= monthlyQuota ? 'text-green-600' : 'text-gray-500'}`}>
                    ⏱ {Math.floor(empHours)}h{Math.round((empHours % 1) * 60) > 0 ? Math.round((empHours % 1) * 60) + 'min' : ''}{monthlyQuota ? ` de ${monthlyQuota}h/mês` : ''}
                  </span>
                )}
                {noRate && (
                  <span className="text-xs text-amber-600 font-medium">⚠ valores das unidades não definidos</span>
                )}
                {openEmp.length === 0 && alertLevel === 'warning' && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                    <Clock size={12} />Nenhuma visita este mês
                  </span>
                )}
                {openEmp.length === 0 && alertLevel === 'danger' && (
                  <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                    <AlertTriangle size={12} />Sem visita há {daysSince} dias
                  </span>
                )}
                {openEmp.length === 0 && alertLevel === 'never' && (
                  <span className="flex items-center gap-1 text-xs text-gray-400 font-medium">
                    <Clock size={12} />Nenhuma visita registrada ainda
                  </span>
                )}
                {openEmp.length === 0 && alertLevel === 'no_prazo' && (
                  <span className="flex items-center gap-1 text-xs text-gray-400 font-medium">
                    <Clock size={12} />{empVisits.length > 0 ? `${empVisits.length} visita(s) — ` : ''}no prazo (fecha até o fim do mês)
                  </span>
                )}
                {lastDate && alertLevel !== 'ok' && alertLevel !== 'no_prazo' && (
                  <span className="text-xs text-gray-400">última: {formatDate(lastDate)}</span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              {isChefe && empEarnings > 0 ? (
                <>
                  <p className="text-sm font-bold text-emerald-600">R$ {empEarnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  <p className="text-xs text-gray-400">a pagar</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-gray-400">{empLinks.length} cliente{empLinks.length !== 1 ? 's' : ''}</p>
                  {empLinks.length > 0 && (
                    <p className="text-xs text-gray-500 truncate max-w-[120px]">
                      {(empLinks[0] as { client?: { name: string } }).client?.name}
                    </p>
                  )}
                </>
              )}
            </div>
            {empVisits.length > 0 && (
              <button onClick={() => setExpandedEmployee(isExpanded ? null : emp.id)} className="ml-2 p-1 rounded hover:bg-gray-100 text-gray-400">
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        </div>
        {isExpanded && empVisits.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Visitas em {format(monthDate, 'MMMM yyyy', { locale: ptBR })}
              </span>
              {empEarnings > 0 && (
                <span className="text-xs font-bold text-emerald-600">Total: R$ {empEarnings.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {empVisits.map(v => {
                const clientLink = links?.find(l => l.client_id === v.client_id)
                const clientName = (clientLink as { client?: { name: string } } | undefined)?.client?.name || '—'
                const duration = formatDuration(v.check_in, v.check_out)
                const isOpen = !v.check_out
                return (
                  <div key={v.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${isOpen ? 'bg-red-50' : ''}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{formatDate(v.visit_date)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isOpen ? 'bg-red-100 text-red-700' : 'text-gray-500 bg-gray-100'}`}>
                          {v.check_in?.slice(0, 5)} — {isOpen ? '⚠ sem saída' : v.check_out?.slice(0, 5)}
                          {duration && ` (${duration})`}
                        </span>
                        {v.unit_name ? (
                          <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">{v.unit_name}</span>
                        ) : (
                          <span className="text-xs text-primary-600 font-medium">{clientName}</span>
                        )}
                        {(v as { extra_approval?: string }).extra_approval === 'pendente' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏳ extra — decidir</span>}
                        {(v as { extra_approval?: string }).extra_approval === 'aprovada' && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ extra aprovada</span>}
                        {(v as { extra_approval?: string }).extra_approval === 'negada' && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">extra não paga</span>}
                      </div>
                      {v.observations && <p className="text-xs text-gray-500 mt-1">{v.observations}</p>}
                      {(v as { report_url?: string }).report_url && (
                        <SignedLink value={(v as { report_url?: string }).report_url} bucket="arquivos" className="text-xs text-primary-600 underline mt-1 inline-block">📄 Ver relatório</SignedLink>
                      )}
                    </div>
                    {v.visit_rate && (
                      <span className="text-sm font-bold text-emerald-600 flex-shrink-0">R$ {Number(v.visit_rate).toFixed(2)}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Resumo financeiro mensal do colaborador Fixo: dias esperados × diária × desconto por faltas
  const getMonthWorkStats = (empId: string) => {
    type FixoLink = { client_id?: string; monthly_amount?: number; days_off?: number[]; work_schedule_type?: string; schedule_anchor_date?: string; start_date?: string }
    const fixoLinks = getEmployeeLinks(empId).filter(l => l.service_type !== 'Consultoria') as FixoLink[]
    const mStart = startOfMonth(monthDate)
    const mEnd = endOfMonth(monthDate)

    let totalExpected = 0, totalCovered = 0, totalMonthly = 0, totalDeduction = 0, totalDailyRate = 0

    for (const link of fixoLinks) {
      if (!link.monthly_amount) continue
      const has1236 = link.work_schedule_type === '12x36' && !!link.schedule_anchor_date
      if (!link.days_off?.length && !has1236) continue
      const monthly = Number(link.monthly_amount)
      totalMonthly += monthly

      // Começa do início do vínculo (não cobra antes de ser contratado)
      const linkStart = link.start_date ? new Date(link.start_date + 'T12:00:00') : mStart
      const effectiveStart = linkStart > mStart ? linkStart : mStart

      const isOff = (ds: string, wd: number) => {
        if (has1236) {
          const diff = Math.round((new Date(ds + 'T12:00:00').getTime() - new Date(link.schedule_anchor_date! + 'T12:00:00').getTime()) / 86400000)
          return ((diff % 2) + 2) % 2 === 1
        }
        return link.days_off!.includes(wd)
      }
      const linkVisits = (visits || []).filter(v => v.employee_id === empId && v.client_id === link.client_id)
      // Dias cobertos = ponto registrado (normal ou feriado) + atestado médico + dias trocados
      // Falta sem atestado = desconto. Falta com atestado = justificada, sem desconto.
      const filled = new Set(linkVisits.filter(v =>
        v.check_out ||
        (v as { is_holiday?: boolean }).is_holiday ||
        ((v as { is_unavailable?: boolean }).is_unavailable && (v as { atestado_url?: string }).atestado_url)
      ).map(v => v.visit_date))
      const swappedFrom = new Set(linkVisits.map(v => (v as { swapped_from?: string }).swapped_from).filter(Boolean))

      let exp = 0, cov = 0
      const d = new Date(effectiveStart)
      while (d <= mEnd) {
        const ds = d.toISOString().slice(0, 10)
        if (!isOff(ds, d.getDay())) {
          exp++
          if (filled.has(ds) || swappedFrom.has(ds)) cov++
        }
        d.setDate(d.getDate() + 1)
      }
      totalExpected += exp
      totalCovered += cov

      // 12x36: diária = salário / 15 | 5x2/6x1: diária = salário / 30
      const linkDailyRate = has1236 ? monthly / 15 : monthly / 30
      const linkAbsent = Math.max(0, exp - cov)
      totalDeduction += linkAbsent * linkDailyRate
      totalDailyRate += linkDailyRate
    }

    if (totalExpected === 0 || totalMonthly === 0) return null
    const dailyRate = totalDailyRate
    const absentDays = Math.max(0, totalExpected - totalCovered)
    const deduction = totalDeduction
    const extraTotal = getEmployeeVisitsThisMonth(empId)
      .filter(v => (v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'aprovada')
      .reduce((s, v) => s + (Number((v as { extra_amount?: number }).extra_amount) || 0), 0)
    return { expectedDays: totalExpected, coveredDays: totalCovered, absentDays, dailyRate, deduction, extraTotal, grossSalary: totalMonthly, netPay: totalMonthly - deduction + extraTotal }
  }

  // Dias da escala sem preenchimento até ontem — 5x2/6x1 (folga fixa) e 12x36 (âncora: dia sim, dia não).
  // Dias cobertos por "troca de dia" não contam como pendentes.
  const getPendingDaysForEmployee = (empId: string) => {
    const fixoLinks = getEmployeeLinks(empId).filter(l => l.service_type !== 'Consultoria') as { client_id?: string; days_off?: number[]; work_schedule_type?: string; schedule_anchor_date?: string; start_date?: string }[]
    const pending: string[] = []
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); yesterday.setHours(23, 59, 59, 0)
    const mStart = startOfMonth(monthDate)
    const mEnd = endOfMonth(monthDate)
    const limit = mEnd < yesterday ? mEnd : yesterday
    if (limit < mStart) return pending
    for (const link of fixoLinks) {
      const has1236Anchor = link.work_schedule_type === '12x36' && !!link.schedule_anchor_date
      if (!link.days_off?.length && !has1236Anchor) continue
      // Não cobrar dias anteriores ao início do vínculo
      const linkStart = link.start_date ? new Date(link.start_date + 'T12:00:00') : mStart
      const effectiveStart = linkStart > mStart ? linkStart : mStart
      if (limit < effectiveStart) continue
      const linkVisits = (visits || []).filter(v => v.employee_id === empId && v.client_id === link.client_id)
      const filled = new Set(linkVisits.map(v => v.visit_date))
      const swappedFrom = new Set(linkVisits.map(v => (v as { swapped_from?: string }).swapped_from).filter(Boolean))
      const noticed = new Set((notices || []).filter(n => n.employee_id === empId && n.client_id === link.client_id).map(n => n.notice_date))
      const isOff = (ds: string, weekday: number) => {
        if (has1236Anchor) {
          const diff = Math.round((new Date(ds + 'T12:00:00').getTime() - new Date(link.schedule_anchor_date + 'T12:00:00').getTime()) / 86400000)
          return ((diff % 2) + 2) % 2 === 1
        }
        return link.days_off!.includes(weekday)
      }
      const d = new Date(effectiveStart)
      while (d <= limit) {
        const ds = d.toISOString().slice(0, 10)
        if (!isOff(ds, d.getDay()) && !filled.has(ds) && !swappedFrom.has(ds) && !noticed.has(ds)) pending.push(ds)
        d.setDate(d.getDate() + 1)
      }
    }
    return pending.sort()
  }

  const renderFixoEmployee = (emp: { id: string; full_name: string; role?: string; portal_pin?: string }) => {
    const empVisits = getEmployeeVisitsThisMonth(emp.id)
    const isExpanded = expandedEmployee === emp.id + '_fixo'
    const workedDays = empVisits.filter(v => v.check_out && !v.is_holiday && !v.is_unavailable)
    const holidayDays = empVisits.filter(v => v.is_holiday)
    const unavailDays = empVisits.filter(v => v.is_unavailable)
    const extraDays = empVisits.filter(v => (v as { is_extra?: boolean }).is_extra)
    const pendingExtras = extraDays.filter(v => (v as { extra_approval?: string }).extra_approval === 'pendente')
    const extraTotal = extraDays.filter(v => (v as { extra_approval?: string }).extra_approval === 'aprovada').reduce((s, v) => s + (Number((v as { extra_amount?: number }).extra_amount) || 0), 0)
    const pendingDays = getPendingDaysForEmployee(emp.id)
    const oldPending = pendingDays.length > 0 && differenceInDays(new Date(today), new Date(pendingDays[0])) > 7
    const stats = getMonthWorkStats(emp.id)
    const empNotices = (notices || []).filter(n => n.employee_id === emp.id)
    const faltaNotices = empNotices.filter(n => n.type === 'falta')
    const trocaNotices = empNotices.filter(n => n.type === 'troca')
    const totalMins = workedDays.reduce((s, v) => s + durMins(v.check_in, v.check_out), 0)
    const totalH = Math.floor(totalMins / 60)
    const totalM = totalMins % 60
    const hasObservations = empVisits.some(v => v.observations)

    return (
      <div key={emp.id + '_fixo'} className={`card overflow-hidden border-l-4 ${oldPending ? 'border-l-red-500' : pendingDays.length > 0 ? 'border-l-amber-400' : 'border-l-blue-400'}`}>
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
              {emp.full_name.trim().split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <button
                className="font-semibold text-gray-900 hover:text-primary-700 hover:underline text-left"
                onClick={() => navigate(`/colaboradores/${emp.id}`)}
              >
                {emp.full_name.trim()}
              </button>
              {/* Fixo é controle: só destaca exceções (extra, falta, pendência) — sem exceção, "trabalhando normalmente" */}
              <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
                {unavailDays.length === 0 && extraDays.length === 0 && pendingDays.length === 0 && empNotices.length === 0 ? (
                  <span className="flex items-center gap-1 text-green-600 font-medium">
                    <CheckCircle size={12} />Trabalhando normalmente
                  </span>
                ) : (
                  <>
                    {pendingExtras.length > 0 && (
                      <span className="text-amber-600 font-medium">⏳ {pendingExtras.length} folga{pendingExtras.length !== 1 ? 's' : ''} trabalhada{pendingExtras.length !== 1 ? 's' : ''} — definir valor</span>
                    )}
                    {extraDays.length > pendingExtras.length && (
                      <span className="text-green-600 font-medium">⭐ {extraDays.length - pendingExtras.length} extra{extraDays.length - pendingExtras.length !== 1 ? 's' : ''} aprovado{extraDays.length - pendingExtras.length !== 1 ? 's' : ''}{extraTotal > 0 ? ` (+R$ ${extraTotal.toFixed(2)})` : ''}</span>
                    )}
                    {unavailDays.length > 0 && (
                      <span className="text-red-600 font-medium">{unavailDays.length} falta{unavailDays.length !== 1 ? 's' : ''} justificada{unavailDays.length !== 1 ? 's' : ''}</span>
                    )}
                  </>
                )}
                {hasObservations && (
                  <span className="text-purple-600 flex items-center gap-1"><MessageCircle size={11} />obs</span>
                )}
              </div>
              {/* Avisos feitos pela agenda do portal */}
              {faltaNotices.map(n => (
                <p key={n.id} className="text-xs font-medium mt-1 text-red-600">
                  🔔 Avisou falta em {formatDate(n.notice_date)}{n.reason ? ` — ${n.reason}` : ''}
                </p>
              ))}
              {trocaNotices.map(n => (
                <p key={n.id} className="text-xs font-medium mt-1 text-amber-600">
                  🔁 Troca combinada: folga {formatDate(n.notice_date)} → trabalha {n.swap_work_date ? formatDate(n.swap_work_date) : '?'}
                </p>
              ))}
              {pendingDays.length > 0 && (
                <p className={`text-xs font-medium mt-1 ${oldPending ? 'text-red-600' : 'text-amber-600'}`}>
                  ⚠ Não preencheu {pendingDays.length} dia{pendingDays.length !== 1 ? 's' : ''} da escala: {pendingDays.slice(0, 5).map(d => formatDate(d)).join(', ')}{pendingDays.length > 5 ? '…' : ''}
                  {oldPending ? ' — pendente há mais de 7 dias, cobrar!' : ''}
                </p>
              )}
            </div>
            {empVisits.length > 0 && (
              <button onClick={() => setExpandedEmployee(isExpanded ? null : emp.id + '_fixo')} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Resumo financeiro mensal */}
        {stats && (
          <div className="px-4 pb-4 pt-2">
            <div className={`rounded-xl p-3 text-xs space-y-1.5 ${stats.absentDays > 0 ? 'bg-red-50 border border-red-100' : 'bg-blue-50 border border-blue-100'}`}>
              <p className="font-semibold text-gray-700 mb-2">Resumo do mês — {format(monthDate, 'MMMM yyyy', { locale: ptBR })}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="text-gray-500">Dias previstos na escala</span>
                <span className="font-semibold text-right">{stats.expectedDays} dias</span>
                <span className="text-gray-500">Dias preenchidos</span>
                <span className="font-semibold text-right">{stats.coveredDays} dias</span>
                <span className="text-gray-500">Diária</span>
                <span className="font-semibold text-right">R$ {stats.dailyRate.toFixed(2)}</span>
              </div>
              {stats.absentDays > 0 && (
                <div className="pt-1.5 mt-1 border-t border-red-200 space-y-1">
                  <div className="flex justify-between text-red-600 font-semibold">
                    <span>Desconto por {stats.absentDays} falta{stats.absentDays !== 1 ? 's' : ''}</span>
                    <span>− R$ {stats.deduction.toFixed(2)}</span>
                  </div>
                </div>
              )}
              {stats.extraTotal > 0 && (
                <div className="flex justify-between text-green-600 font-semibold">
                  <span>Extras aprovados</span>
                  <span>+ R$ {stats.extraTotal.toFixed(2)}</span>
                </div>
              )}
              <div className={`flex justify-between font-bold pt-1.5 border-t ${stats.absentDays > 0 ? 'border-red-200 text-red-700' : 'border-blue-200 text-blue-800'}`}>
                <span>Salário líquido estimado</span>
                <span>R$ {stats.netPay.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        {isExpanded && empVisits.length > 0 && (
          <div className="border-t border-gray-100">
            <div className="px-4 py-2 bg-gray-50">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Folha de Ponto — {format(monthDate, 'MMMM yyyy', { locale: ptBR })}
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              {[...empVisits].sort((a, b) => a.visit_date.localeCompare(b.visit_date)).map(v => {
                const isHoliday = v.is_holiday
                const isUnavail = v.is_unavailable
                const clientLink = links?.find(l => l.client_id === v.client_id)
                const clientName = (clientLink as { client?: { name: string } } | undefined)?.client?.name || '—'
                return (
                  <div key={v.id} className={`px-4 py-3 flex items-start justify-between gap-3 ${isHoliday ? 'bg-amber-50' : isUnavail ? 'bg-red-50' : ''}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{formatDate(v.visit_date)}</span>
                        {isHoliday && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Feriado</span>}
                        {isUnavail && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Falta</span>}
                        {(v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'pendente' && (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏳ extra — definir valor</span>
                        )}
                        {(v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'aprovada' && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                            ⭐ extra aprovado{(v as { extra_amount?: number }).extra_amount ? ` +R$ ${Number((v as { extra_amount?: number }).extra_amount).toFixed(2)}` : ''}
                          </span>
                        )}
                        {(v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'negada' && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">extra não pago</span>
                        )}
                        {(v as { is_swap?: boolean }).is_swap && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            🔁 Troca de dia{(v as { swapped_from?: string }).swapped_from ? ` (no lugar de ${formatDate((v as { swapped_from?: string }).swapped_from!)})` : ''}
                          </span>
                        )}
                        {!isHoliday && !isUnavail && v.check_in && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                            {v.check_in.slice(0,5)} — {v.check_out?.slice(0,5) || '⚠ sem saída'}
                            {v.check_in && v.check_out ? ` (${formatDuration(v.check_in.slice(0,5), v.check_out.slice(0,5))})` : ''}
                          </span>
                        )}
                        <span className="text-xs text-primary-600">{clientName}</span>
                      </div>
                      {isUnavail && v.unavailability_reason && (
                        <p className="text-xs text-red-600 mt-0.5">Motivo: {v.unavailability_reason}</p>
                      )}
                      {v.atestado_url && (
                        <SignedLink value={v.atestado_url} bucket="arquivos" className="text-xs text-primary-600 underline mt-0.5 block">Ver atestado</SignedLink>
                      )}
                      {v.observations && (
                        <p className="text-xs text-blue-600 mt-0.5 italic">"{v.observations}"</p>
                      )}
                      {/* Aprovação inline de dia extra pendente — só chefe */}
                      {isChefe && (v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'pendente' && (
                        <div className="mt-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200 space-y-2">
                          <p className="text-xs font-semibold text-amber-800">Dia de folga trabalhado — definir pagamento:</p>
                          {(v as { proposed_amount?: number }).proposed_amount && (
                            <p className="text-xs text-amber-600">Sugestão (salário÷30): R$ {Number((v as { proposed_amount?: number }).proposed_amount).toFixed(2)}</p>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              type="number" step="0.01" placeholder="Valor R$"
                              className="input text-sm h-8 w-28"
                              value={extraAmounts[v.id] ?? ''}
                              onChange={e => setExtraAmounts(p => ({ ...p, [v.id]: e.target.value }))}
                            />
                            <button
                              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
                              disabled={!extraAmounts[v.id] || decideExtra.isPending}
                              onClick={() => decideExtra.mutate({ visitId: v.id, approve: true, amount: Number(extraAmounts[v.id]), isFixo: true })}
                            >Aprovar</button>
                            <button
                              className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300"
                              disabled={decideExtra.isPending}
                              onClick={() => decideExtra.mutate({ visitId: v.id, approve: false, amount: null, isFixo: true })}
                            >Não pagar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {empVisits.length === 0 && (
          <div className="px-4 pb-3 text-xs text-gray-400">Nenhum registro de ponto este mês.</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Operação</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Visitas & Ponto</h1>
          <p className="text-sm text-ink-500 mt-0.5">Acompanhe consultoria e fixos registrados pelo portal</p>
        </div>
        <input className="input w-40" type="month" value={month} onChange={e => setMonth(e.target.value)} />
      </div>

      {/* Open visits alert */}
      {totalOpenVisits > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-red-700 text-sm">{totalOpenVisits} ponto(s) em aberto — sem check-out registrado</p>
            <div className="mt-2 space-y-1">
              {(openVisits || []).slice(0, 5).map(v => {
                const emp = employees?.find(e => e.id === v.employee_id)
                const link = links?.find(l => l.client_id === v.client_id && l.employee_id === v.employee_id)
                const clientName = (link as { client?: { name: string } } | undefined)?.client?.name || '—'
                return (
                  <div key={v.id} className="flex items-center gap-2 text-xs text-red-700">
                    <span className="font-medium">{emp?.full_name || 'Colaborador'}</span>
                    <span className="text-red-400">·</span>
                    <span>{clientName}</span>
                    <span className="text-red-400">·</span>
                    <span>entrada {v.check_in?.slice(0, 5)} em {formatDate(v.visit_date)}</span>
                    {emp && (
                      <button className="underline ml-1" onClick={() => navigate(`/colaboradores/${emp.id}`)}>ver perfil</button>
                    )}
                  </div>
                )
              })}
              {totalOpenVisits > 5 && <p className="text-xs text-red-500">...e mais {totalOpenVisits - 5} registros em aberto</p>}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {([
          { key: 'consultoria', label: 'Consultoria', count: consultoriaEmps.length },
          { key: 'fixos', label: 'Fixos', count: fixoEmps.length },
          { key: 'volantes', label: 'Volantes', count: volantEmps.length },
          { key: 'duvidas', label: 'Dúvidas', count: pendingDuvidas },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setExpandedEmployee(null) }}
            className={`px-3.5 py-2 text-sm font-semibold rounded-xl transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap ${
              tab === t.key ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'
            }`}
          >
            {t.key === 'consultoria' && <DollarSign size={14} />}
            {t.key === 'fixos' && <ClipboardList size={14} />}
            {t.key === 'volantes' && <Zap size={14} />}
            {t.key === 'duvidas' && <MessageCircle size={14} />}
            {t.label}
            {t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                t.key === 'duvidas' && pendingDuvidas > 0 ? 'bg-red-100 text-red-700' : tab === t.key ? 'bg-white/25 text-white' : 'bg-ink-100 text-ink-600'
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ─── CONSULTORIA TAB ─── */}
      {tab === 'consultoria' && (
        <>
          {/* Visitas extras aguardando decisão do chefe */}
          {isChefe && (() => {
            const pendingExtras = (visits || []).filter(v => (v as { extra_approval?: string }).extra_approval === 'pendente')
            if (!pendingExtras.length) return null
            return (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
                <p className="font-semibold text-amber-800 text-sm flex items-center gap-2">
                  ⏳ {pendingExtras.length} visita{pendingExtras.length > 1 ? 's' : ''} extra{pendingExtras.length > 1 ? 's' : ''} aguardando sua decisão
                </p>
                {pendingExtras.map(v => {
                  const emp = employees?.find(e => e.id === v.employee_id)
                  const link = links?.find(l => l.client_id === v.client_id && l.employee_id === v.employee_id)
                  const clientName = (link as { client?: { name: string } } | undefined)?.client?.name || '—'
                  const proposed = Number((v as { proposed_amount?: number }).proposed_amount) || 0
                  return (
                    <div key={v.id} className="bg-white rounded-lg p-3 flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{emp?.full_name || 'Colaborador'}</p>
                        <p className="text-xs text-gray-500">
                          {formatDate(v.visit_date)} · {clientName}{v.unit_name ? ` · ${v.unit_name}` : ''}
                          {v.check_in && v.check_out ? ` · ${v.check_in.slice(0,5)}–${v.check_out.slice(0,5)} (${formatDuration(v.check_in.slice(0,5), v.check_out.slice(0,5))})` : ''}
                          {' '}· passou do combinado de horas do mês
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          className="btn-primary text-xs bg-green-600 hover:bg-green-700"
                          disabled={decideExtra.isPending}
                          onClick={() => decideExtra.mutate({ visitId: v.id, approve: true, amount: proposed || null })}
                        >
                          💰 Pagar{proposed ? ` R$ ${proposed.toFixed(2)}` : ''}
                        </button>
                        <button
                          className="btn-secondary text-xs text-gray-600"
                          disabled={decideExtra.isPending}
                          onClick={() => decideExtra.mutate({ visitId: v.id, approve: false, amount: null })}
                        >
                          Não pagar
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          <div className="grid grid-cols-4 gap-4">
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Visitas no mês</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{totalVisitsThisMonth}</p>
              <p className="text-xs text-gray-400 mt-1">{format(monthDate, 'MMMM yyyy', { locale: ptBR })}</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Com visita</p>
              <p className="text-3xl font-bold text-green-600 mt-1">{employeesWithVisit}</p>
              <p className="text-xs text-gray-400 mt-1">nutricionistas ativos este mês</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Sem visita</p>
              <p className="text-3xl font-bold text-red-500 mt-1">{employeesWithoutVisit}</p>
              <p className="text-xs text-gray-400 mt-1">sem registro este mês</p>
            </div>
            {isChefe && (
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide flex items-center gap-1"><DollarSign size={11} />A pagar</p>
              <p className="text-2xl font-bold text-emerald-600 mt-1">R$ {totalEarningsThisMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-gray-400 mt-1">total consultoria</p>
            </div>
            )}
          </div>

          {consultoriaEmps.length === 0 && (
            <div className="card p-8 text-center text-gray-400">
              <User size={32} className="mx-auto mb-2 opacity-40" />
              <p className="font-medium">Nenhum nutricionista de consultoria ativo</p>
            </div>
          )}

          <div className="space-y-3">
            {consultoriaEmps.map(emp => renderConsultoriaEmployee(emp))}
          </div>
        </>
      )}

      {/* ─── FIXOS TAB ─── */}
      {tab === 'fixos' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Nutricionistas fixos</p>
              <p className="text-3xl font-bold text-blue-700 mt-1">{fixoEmps.length}</p>
              <p className="text-xs text-gray-400 mt-1">ativos</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Com registro</p>
              <p className="text-3xl font-bold text-green-600 mt-1">
                {fixoEmps.filter(e => getEmployeeVisitsThisMonth(e.id).some(v => v.check_out)).length}
              </p>
              <p className="text-xs text-gray-400 mt-1">registraram ponto este mês</p>
            </div>
            <div className="card p-4">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Sem registro</p>
              <p className="text-3xl font-bold text-amber-500 mt-1">
                {fixoEmps.filter(e => !getEmployeeVisitsThisMonth(e.id).some(v => v.check_out)).length}
              </p>
              <p className="text-xs text-gray-400 mt-1">sem ponto registrado</p>
            </div>
          </div>

          {fixoEmps.length === 0 && (
            <div className="card p-8 text-center text-gray-400">
              <ClipboardList size={32} className="mx-auto mb-2 opacity-40" />
              <p className="font-medium">Nenhum nutricionista fixo ativo</p>
            </div>
          )}

          {(() => {
            const totalPending = fixoEmps.reduce((acc, emp) => {
              return acc + getEmployeeVisitsThisMonth(emp.id).filter(v => (v as { extra_approval?: string }).extra_approval === 'pendente').length
            }, 0)
            return totalPending > 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <AlertCircle size={20} className="text-amber-500 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">{totalPending} folga{totalPending > 1 ? 's' : ''} trabalhada{totalPending > 1 ? 's' : ''} aguardando decisão de valor</p>
                  <p className="text-xs text-amber-600 mt-0.5">Expanda o colaborador para aprovar ou negar o pagamento</p>
                </div>
              </div>
            ) : null
          })()}

          <div className="space-y-3">
            {fixoEmps.map(emp => renderFixoEmployee(emp))}
          </div>
        </>
      )}

      {/* ─── VOLANTES TAB ─── */}
      {tab === 'volantes' && (
        <div className="space-y-3">
          {volantEmps.length === 0 && (
            <div className="card p-10 text-center text-gray-400">
              <User size={32} className="mx-auto mb-2 opacity-40" />
              <p className="font-medium">Nenhum colaborador volante ativo</p>
              <p className="text-sm mt-1">Crie um colaborador com tipo "Volante" para vê-lo aqui.</p>
            </div>
          )}
          {volantEmps.map(emp => {
            const empLinks = (links || []).filter(l => l.employee_id === emp.id && l.service_type === 'Volante')
            const empVisits = getEmployeeVisitsThisMonth(emp.id)
            const workedDays = empVisits.filter(v => v.check_out && !v.is_holiday && !v.is_unavailable)
            return (
              <div key={emp.id} className="card p-4 border-l-4 border-l-orange-400">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <button className="font-semibold text-gray-900 hover:text-primary-700 hover:underline text-left" onClick={() => navigate(`/colaboradores/${emp.id}`)}>
                      {emp.full_name}
                    </button>
                    <div className="flex gap-2 mt-1 flex-wrap text-xs">
                      {empLinks.length === 0 && <span className="text-gray-400">Sem cobertura ativa</span>}
                      {empLinks.map(l => {
                        const end = (l as { contract_end_date?: string }).contract_end_date
                        const dr = (l as { daily_rate?: number }).daily_rate
                        return (
                          <span key={l.id} className="text-orange-700 font-medium">
                            ⚡ {(l as { client?: { name: string } }).client?.name}
                            {end ? ` até ${formatDate(end)}` : ''}
                            {dr ? ` · R$ ${Number(dr).toFixed(2)}/dia` : ''}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{workedDays.length} dia(s) trabalhado(s)</p>
                    {empLinks.some(l => (l as { daily_rate?: number }).daily_rate) && (
                      <p className="text-sm font-bold text-green-700">
                        R$ {empLinks.reduce((total, l) => {
                          const dr = (l as { daily_rate?: number }).daily_rate || 0
                          const linkVisits = workedDays.filter(v => v.client_id === l.client_id)
                          return total + linkVisits.length * dr
                        }, 0).toFixed(2)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── DÚVIDAS TAB ─── */}
      {tab === 'duvidas' && (
        <div className="space-y-3">
          {(duvidas || []).length === 0 && (
            <div className="card p-10 text-center text-gray-400">
              <MessageCircle size={36} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium">Nenhuma dúvida enviada ainda</p>
              <p className="text-sm mt-1">Quando os colaboradores enviarem perguntas pelo portal, elas aparecerão aqui.</p>
            </div>
          )}

          {(duvidas || []).map(d => {
            const emp = (d as { employee?: { id: string; full_name: string } }).employee
            const isAnswered = !!d.answered_at
            return (
              <div key={d.id} className={`card p-4 border-l-4 ${isAnswered ? 'border-l-green-400' : 'border-l-amber-400'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{emp?.full_name || 'Colaborador'}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(d.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isAnswered ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Respondida</span>
                      ) : (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pendente</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-lg px-3 py-2">{d.message}</p>

                    {isAnswered && d.answer && (
                      <div className="mt-2 bg-green-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-green-600 font-medium mb-1">Resposta do RH:</p>
                        <p className="text-sm text-gray-700">{d.answer}</p>
                      </div>
                    )}

                    {!isAnswered && (
                      <div className="mt-3 flex gap-2">
                        <input
                          className="input text-sm flex-1"
                          placeholder="Digite sua resposta..."
                          value={answers[d.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [d.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && (answers[d.id] || '').trim()) {
                              responderDuvida.mutate({ id: d.id, answer: answers[d.id].trim() })
                            }
                          }}
                        />
                        <button
                          className="btn-primary text-sm flex items-center gap-1.5"
                          disabled={!answers[d.id]?.trim() || responderDuvida.isPending}
                          onClick={() => {
                            if (answers[d.id]?.trim()) {
                              responderDuvida.mutate({ id: d.id, answer: answers[d.id].trim() })
                            }
                          }}
                        >
                          <Send size={14} />
                          Responder
                        </button>
                      </div>
                    )}
                  </div>
                  {emp && (
                    <button
                      className="text-xs text-primary-600 hover:underline flex-shrink-0"
                      onClick={() => navigate(`/colaboradores/${emp.id}`)}
                    >
                      ver perfil
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
