import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, FileText, Briefcase, UserPlus, AlertTriangle, CheckCircle,
  Calendar, Plus, TrendingUp, Clock, CreditCard, Clipboard,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatCurrency, formatDateTime } from '../lib/utils'
import { addDays, startOfMonth, endOfMonth, isBefore, parseISO, isAfter, differenceInDays, subMonths } from 'date-fns'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899']

export default function Dashboard() {
  const { role, profile } = useAuth()
  const navigate = useNavigate()
  const now = new Date()
  const in15 = addDays(now, 15)
  const in40 = addDays(now, 40)
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  const { data: employees } = useQuery({
    queryKey: ['dashboard-employees'],
    queryFn: async () => {
      const { data } = await supabase.from('employees').select('id,status,dismissal_date,full_name')
      return data || []
    },
  })

  const { data: contracts } = useQuery({
    queryKey: ['dashboard-contracts'],
    queryFn: async () => {
      const { data } = await supabase.from('contracts').select('id,end_date,signed,signed_at')
      return data || []
    },
  })

  const { data: vacancies } = useQuery({
    queryKey: ['dashboard-vacancies'],
    queryFn: async () => {
      const { data } = await supabase.from('vacancies').select('id,status,hired_count,positions_count,title')
      return data || []
    },
  })

  const { data: candidates } = useQuery({
    queryKey: ['dashboard-candidates'],
    queryFn: async () => {
      // Só conta candidatos vinculados a vagas abertas ou em andamento
      const { data: activeVacs } = await supabase
        .from('vacancies').select('id').in('status', ['Aberta', 'Atuando'])
      if (!activeVacs?.length) return []

      const { data: interests } = await supabase
        .from('vacancy_interests').select('candidate_id').in('vacancy_id', activeVacs.map(v => v.id))
      if (!interests?.length) return []

      const ids = [...new Set(interests.map((i: { candidate_id: string }) => i.candidate_id))]
      const { data } = await supabase
        .from('candidates').select('id,pipeline_stage,updated_at,full_name')
        .in('id', ids)
        .not('pipeline_stage', 'in', '("Contratado","Inativo")')
        .limit(2000)
      return data || []
    },
  })

  const { data: vacanciesExpiring } = useQuery({
    queryKey: ['dashboard-vacancies-expiring'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vacancies')
        .select('id,title,deadline,hired_count,positions_count')
        .eq('status', 'Aberta')
      return data || []
    },
  })

  const { data: clientContractsExpiring } = useQuery({
    queryKey: ['dashboard-client-contracts-expiring'],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients').select('id,name,contract_end')
        .not('contract_end', 'is', null)
        .lte('contract_end', in40.toISOString().slice(0, 10))
      return data || []
    },
  })

  const { data: pendingContractInterests } = useQuery({
    queryKey: ['dashboard-pending-contract-interests'],
    queryFn: async () => {
      const { data } = await supabase
        .from('vacancy_interests')
        .select('id,deadline,candidate:candidates(full_name),vacancy:vacancies(title)')
        .eq('status', 'Em contrato').not('deadline', 'is', null)
      return data || []
    },
  })

  const { data: employeeContractsExpiring } = useQuery({
    queryKey: ['dashboard-employee-contracts-expiring'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('id,contract_end_date,employee:employees(full_name),client:clients(name)')
        .not('contract_end_date', 'is', null)
        .lte('contract_end_date', in40.toISOString().slice(0, 10))
      return data || []
    },
  })

  const { data: approvedCount } = useQuery({
    queryKey: ['dashboard-approved-count'],
    queryFn: async () => {
      const { count } = await supabase.from('candidates')
        .select('id', { count: 'exact', head: true }).eq('pipeline_stage', 'Aprovado')
      return count ?? 0
    },
  })

  const { data: payments } = useQuery({
    queryKey: ['dashboard-payments'],
    queryFn: async () => {
      const twoMonthsAgo = addDays(startOfMonth(now), -60).toISOString().slice(0, 10)
      const twoMonthsAhead = addDays(endOfMonth(now), 60).toISOString().slice(0, 10)
      const { data } = await supabase
        .from('payments')
        .select('id,description,amount,due_date,status,employee_id,category,type')
        .gte('due_date', twoMonthsAgo)
        .lte('due_date', twoMonthsAhead)
      return data || []
    },
    enabled: role === 'chefe',
  })

  const { data: pendingExpenses } = useQuery({
    queryKey: ['dashboard-pending-expenses'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_expenses')
        .select('id,description,amount,employee:employees(full_name)')
        .is('receipt_url', null)
        .gte('created_at', addDays(now, -30).toISOString())
      return data || []
    },
    enabled: role === 'chefe',
  })

  const { data: unreadChatCount } = useQuery({
    queryKey: ['dashboard-unread-chat'],
    queryFn: async () => {
      const { count } = await supabase.from('employee_questions')
        .select('id', { count: 'exact', head: true }).is('answer', null)
      return count ?? 0
    },
  })

  const { data: pendingExtras } = useQuery({
    queryKey: ['dashboard-pending-extras'],
    queryFn: async () => {
      const { data } = await supabase.from('nutritionist_visits')
        .select('id,employee:employees(full_name),client:clients(name)')
        .eq('extra_approval', 'pendente')
      return data || []
    },
    enabled: role === 'chefe',
  })

  const { data: volantesExpiring } = useQuery({
    queryKey: ['dashboard-volantes-expiring'],
    queryFn: async () => {
      const { data } = await supabase.from('employee_client_links')
        .select('id,contract_end_date,employee:employees(full_name),client:clients(name)')
        .eq('service_type', 'Volante')
        .not('contract_end_date', 'is', null)
        .gte('contract_end_date', now.toISOString().slice(0, 10))
        .lte('contract_end_date', in15.toISOString().slice(0, 10))
      return data || []
    },
  })

  const { data: pendingDocs } = useQuery({
    queryKey: ['dashboard-pending-docs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_documents')
        .select('id,name,status,employee:employees(id,full_name,status)')
        .is('file_url', null)
        .eq('status', 'Pendente')
      return (data || []).filter((d: { employee?: { status?: string } }) => d.employee?.status === 'Ativo')
    },
    enabled: role === 'chefe',
  })

  const { data: interviews } = useQuery({
    queryKey: ['dashboard-interviews', profile?.id],
    queryFn: async () => {
      let q = supabase.from('interviews')
        .select('*,candidate:candidates(full_name),vacancy:vacancies(title)')
        .gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true }).limit(5)
      if (role === 'recrutador' && profile?.id) q = q.eq('recruiter_id', profile.id)
      const { data } = await q
      return data || []
    },
  })

  const currentMonthStr = now.toISOString().slice(0, 7) // 'yyyy-MM'
  const monthStartStr = startOfMonth(now).toISOString().slice(0, 10)
  const monthEndStr = endOfMonth(now).toISOString().slice(0, 10)
  const isFirstOfMonth = now.getDate() === 1
  const prevMonth = subMonths(now, 1)
  const prevMonthStr = prevMonth.toISOString().slice(0, 7)
  const prevMonthStartStr = startOfMonth(prevMonth).toISOString().slice(0, 10)
  const prevMonthEndStr = endOfMonth(prevMonth).toISOString().slice(0, 10)

  // Consultoria: busca vínculos com cota de horas e as visitas do mês atual
  const { data: consultoriaLinks } = useQuery({
    queryKey: ['dashboard-consultoria-links'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('id,employee_id,client_id,monthly_hours_quota,weekly_hours_quota,visits_per_week,employee:employees(full_name,status),client:clients(name)')
        .eq('service_type', 'Consultoria')
        .not('monthly_hours_quota', 'is', null)
      return (data || []).filter((l: { employee?: { status?: string } }) => l.employee?.status === 'Ativo')
    },
    enabled: role === 'chefe',
  })

  const { data: consultoriaVisits } = useQuery({
    queryKey: ['dashboard-consultoria-visits', currentMonthStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('nutritionist_visits')
        .select('employee_id,client_id,check_in,check_out,break_start,break_end,is_unavailable')
        .gte('visit_date', monthStartStr)
        .lte('visit_date', monthEndStr)
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Visitas do mês anterior — só usadas no dia 1 para checar déficit do mês fechado
  const { data: consultoriaPrevVisits } = useQuery({
    queryKey: ['dashboard-consultoria-prev-visits', prevMonthStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('nutritionist_visits')
        .select('employee_id,client_id,check_in,check_out,break_start,break_end,is_unavailable')
        .gte('visit_date', prevMonthStartStr)
        .lte('visit_date', prevMonthEndStr)
      return data || []
    },
    enabled: role === 'chefe' && isFirstOfMonth,
  })

  // Vínculos ativos por tipo (Consultoria × Fixo) — para o gráfico de colaboradores
  const { data: allLinks } = useQuery({
    queryKey: ['dashboard-all-links'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('service_type,employee:employees(status)')
      return (data || []).filter((l: { employee?: { status?: string } }) => l.employee?.status === 'Ativo')
    },
    enabled: role === 'chefe',
  })

  // Agenda do mês — para o gráfico de visitas (planejadas)
  const { data: agendaThisMonth } = useQuery({
    queryKey: ['dashboard-agenda-month', currentMonthStr],
    queryFn: async () => {
      const { data } = await supabase
        .from('nutritionist_agenda')
        .select('id,planned_date')
        .gte('planned_date', monthStartStr)
        .lte('planned_date', monthEndStr)
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Documentos entregues (com arquivo) — para o gráfico de documentos
  const { data: deliveredDocsCount } = useQuery({
    queryKey: ['dashboard-delivered-docs'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_documents')
        .select('id,file_url,employee:employees(status)')
        .not('file_url', 'is', null)
      return (data || []).filter((d: { employee?: { status?: string } }) => d.employee?.status === 'Ativo').length
    },
    enabled: role === 'chefe',
  })

  // ── Derived ──────────────────────────────────────────────────────────────────
  const activeEmployees = employees?.filter(e => e.status === 'Ativo').length ?? 0
  const totalEmployees = employees?.length ?? 1
  const dismissedThisMonth = employees?.filter(e =>
    e.status === 'Desligado' && e.dismissal_date &&
    e.dismissal_date >= monthStart && e.dismissal_date <= monthEnd
  ).length ?? 0

  const contractsExpiring = contracts?.filter(c =>
    c.end_date && isAfter(parseISO(c.end_date), now) && isBefore(parseISO(c.end_date), in15)
  ).length ?? 0

  const openVacancies = vacancies?.filter(v => v.status === 'Aberta').length ?? 0
  const filledVacancies = vacancies?.filter(v => v.status === 'Preenchida').length ?? 0
  const totalVacancies = (vacancies?.length ?? 0) || 1

  const inProcess = candidates?.filter(c =>
    ['Novo', 'Em contato', 'Entrevista Agendada', 'Aprovado', 'Em Processo de Contratação'].includes(c.pipeline_stage)
  ).length ?? 0

  const monthPayments = payments?.filter(p =>
    p.due_date >= monthStart.slice(0, 10) && p.due_date <= monthEnd.slice(0, 10)
  ) ?? []
  const toPay = monthPayments.filter(p => p.status === 'Pendente' && p.due_date >= now.toISOString().slice(0, 10))
  const overdue = payments?.filter(p => p.status === 'Pendente' && p.due_date < now.toISOString().slice(0, 10)) ?? []
  const paid = monthPayments.filter(p => p.status === 'Pago')

  const totalToPay = toPay.reduce((s, p) => s + (p.amount || 0), 0)
  const totalOverdue = overdue.reduce((s, p) => s + (p.amount || 0), 0)
  const totalPaid = paid.reduce((s, p) => s + (p.amount || 0), 0)
  const totalMonth = totalToPay + totalOverdue + totalPaid

  // Pie chart data for financeiro
  const pieData = [
    ...(totalPaid > 0 ? [{ name: 'Pago', value: totalPaid, color: '#22c55e' }] : []),
    ...(totalToPay > 0 ? [{ name: 'A Pagar', value: totalToPay, color: '#f59e0b' }] : []),
    ...(totalOverdue > 0 ? [{ name: 'Atrasado', value: totalOverdue, color: '#ef4444' }] : []),
  ]

  // Vagas: distribuição por status
  const vagasPie = [
    { name: 'Abertas', value: vacancies?.filter(v => v.status === 'Aberta').length ?? 0, color: '#f59e0b' },
    { name: 'Atuando', value: vacancies?.filter(v => v.status === 'Atuando').length ?? 0, color: '#22c55e' },
    { name: 'Preenchidas', value: vacancies?.filter(v => v.status === 'Preenchida').length ?? 0, color: '#22c55e' },
  ].filter(d => d.value > 0)
  const vagasTotal = vagasPie.reduce((s, d) => s + d.value, 0)

  // Contratos: entregues (assinados) vs pendentes
  const contratosPie = [
    { name: 'Entregues', value: contracts?.filter(c => c.signed).length ?? 0, color: '#22c55e' },
    { name: 'Pendentes', value: contracts?.filter(c => !c.signed).length ?? 0, color: '#f59e0b' },
  ].filter(d => d.value > 0)
  const contratosTotal = contratosPie.reduce((s, d) => s + d.value, 0)

  // Colaboradores ativos por tipo de vínculo
  const colaboradoresPie = [
    { name: 'Consultoria', value: allLinks?.filter(l => l.service_type === 'Consultoria').length ?? 0, color: '#f97316' },
    { name: 'Fixo', value: allLinks?.filter(l => l.service_type !== 'Consultoria').length ?? 0, color: '#3b82f6' },
  ].filter(d => d.value > 0)
  const colaboradoresTotal = colaboradoresPie.reduce((s, d) => s + d.value, 0)

  // Visitas do mês: realizadas (com saída) × planejadas (agenda)
  const visitasPie = [
    { name: 'Realizadas', value: (consultoriaVisits || []).filter((v: { check_out?: string; is_unavailable?: boolean }) => v.check_out && !v.is_unavailable).length, color: '#22c55e' },
    { name: 'Planejadas', value: agendaThisMonth?.length ?? 0, color: '#f59e0b' },
  ].filter(d => d.value > 0)
  const visitasTotal = visitasPie.reduce((s, d) => s + d.value, 0)

  // Documentos: entregues × pendentes
  const documentosPie = [
    { name: 'Entregues', value: deliveredDocsCount ?? 0, color: '#22c55e' },
    { name: 'Pendentes', value: pendingDocs?.length ?? 0, color: '#f59e0b' },
  ].filter(d => d.value > 0)
  const documentosTotal = documentosPie.reduce((s, d) => s + d.value, 0)

  // Alerts grouped by severity
  const redAlerts: { text: string; action?: string; path?: string }[] = []
  const amberAlerts: { text: string; action?: string; path?: string }[] = []

  overdue.forEach(p =>
    redAlerts.push({ text: `Pagamento atrasado: ${p.description} — ${formatCurrency(p.amount)}`, path: '/pagamentos' })
  )
  pendingContractInterests?.forEach(pc => {
    const deadline = pc.deadline ? new Date(pc.deadline) : null
    const hoursLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 3600000) : null
    const candidateName = (pc as { candidate?: { full_name: string } }).candidate?.full_name || 'Candidato'
    const isOverdue = hoursLeft !== null && hoursLeft < 0
    if (isOverdue)
      redAlerts.push({ text: `Contrato expirado: ${candidateName} — prazo venceu há ${Math.abs(hoursLeft!)}h`, path: '/vagas' })
    else
      amberAlerts.push({ text: `Contrato aguardando assinatura: ${candidateName} — ${hoursLeft}h restantes`, path: '/vagas' })
  })
  vacanciesExpiring?.forEach(v => {
    const hired = (v as { hired_count?: number }).hired_count ?? 0
    const total = (v as { positions_count?: number }).positions_count ?? 1
    const unfilled = total - hired
    if (unfilled <= 0) return
    const vagaPath = `/vagas/${v.id}`
    if (!v.deadline) {
      amberAlerts.push({ text: `Vaga "${v.title}" — ${unfilled} posição(ões) em aberto — sem prazo definido`, path: vagaPath })
      return
    }
    const days = differenceInDays(parseISO(v.deadline), now)
    const when = days < 0 ? `prazo vencido há ${Math.abs(days)}d` : days === 0 ? 'prazo vence hoje!' : `faltam ${days}d`
    const msg = `Vaga "${v.title}" — ${unfilled} posição(ões) em aberto — ${when}`
    if (days <= 7) redAlerts.push({ text: msg, path: vagaPath })
    else amberAlerts.push({ text: msg, path: vagaPath })
  })
  clientContractsExpiring?.forEach(c => {
    const dateStr = (c as { contract_end?: string }).contract_end
    if (!dateStr) return
    const days = differenceInDays(parseISO(dateStr), now)
    const when = days < 0 ? `vencido há ${Math.abs(days)}d` : days === 0 ? 'vence hoje!' : `faltam ${days}d`
    if (days <= 10) redAlerts.push({ text: `Cliente "${(c as { name?: string }).name}" — contrato ${when}`, path: '/clientes' })
    else amberAlerts.push({ text: `Cliente "${(c as { name?: string }).name}" — contrato ${when}`, path: '/clientes' })
  })
  employeeContractsExpiring?.forEach(l => {
    const days = differenceInDays(parseISO(l.contract_end_date), now)
    const name = (l as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const client = (l as { client?: { name: string } }).client?.name || ''
    const when = days < 0 ? `vencido há ${Math.abs(days)}d` : days === 0 ? 'vence hoje!' : `faltam ${days}d`
    if (days <= 10) redAlerts.push({ text: `${name}${client ? ' – ' + client : ''} — contrato ${when}` })
    else amberAlerts.push({ text: `${name}${client ? ' – ' + client : ''} — contrato ${when}` })
  })
  contracts?.forEach(c => {
    if (c.end_date && isAfter(parseISO(c.end_date), now) && isBefore(parseISO(c.end_date), in15))
      amberAlerts.push({ text: `Contrato vencendo em ${formatDate(c.end_date)}` })
  })
  if ((approvedCount ?? 0) > 0)
    amberAlerts.push({ text: `${approvedCount} candidato${approvedCount! > 1 ? 's' : ''} aprovado${approvedCount! > 1 ? 's' : ''} aguardando alocação`, path: '/candidatos' })
  const staleCount = candidates?.filter(c =>
    ['Novo', 'Em contato'].includes(c.pipeline_stage) &&
    c.updated_at && isBefore(parseISO(c.updated_at), addDays(now, -7))
  ).length ?? 0
  if (staleCount > 0)
    amberAlerts.push({ text: `${staleCount} candidato(s) sem atualização há +7 dias`, path: '/candidatos' })
  if (role === 'chefe' && (pendingExpenses?.length ?? 0) > 0)
    amberAlerts.push({ text: `${pendingExpenses!.length} gasto(s) sem comprovante aguardando revisão`, path: '/pagamentos' })
  if ((unreadChatCount ?? 0) > 0)
    amberAlerts.push({ text: `${unreadChatCount} mensagem(ns) de colaborador(es) sem resposta`, path: '/chat' })
  if (role === 'chefe' && (pendingExtras?.length ?? 0) > 0)
    amberAlerts.push({ text: `${pendingExtras!.length} hora(s) extra pendente(s) de aprovação`, path: '/visitas' })
  volantesExpiring?.forEach(l => {
    const days = differenceInDays(parseISO(l.contract_end_date), now)
    const name = (l as { employee?: { full_name: string } }).employee?.full_name || 'Volante'
    const client = (l as { client?: { name: string } }).client?.name || ''
    const when = days === 0 ? 'vence hoje!' : `faltam ${days}d`
    amberAlerts.push({ text: `Cobertura Volante: ${name}${client ? ' – ' + client : ''} — ${when}`, path: '/colaboradores' })
  })

  // Alertas de consultoria: visita que excede o combinado semanal + déficit mensal na última semana
  if (role === 'chefe' && consultoriaLinks?.length && consultoriaVisits) {
    const calcDurH = (ci?: string, co?: string, bs?: string, be?: string) => {
      if (!ci || !co) return 0
      const [h1, m1] = ci.slice(0, 5).split(':').map(Number)
      const [h2, m2] = co.slice(0, 5).split(':').map(Number)
      let d = (h2 * 60 + m2) - (h1 * 60 + m1)
      if (d < 0) d += 24 * 60
      if (bs && be) {
        const [b1h, b1m] = bs.slice(0, 5).split(':').map(Number)
        const [b2h, b2m] = be.slice(0, 5).split(':').map(Number)
        d -= Math.max(0, (b2h * 60 + b2m) - (b1h * 60 + b1m))
      }
      return Math.max(0, d) / 60
    }
    const fmtH = (h: number) => `${Math.floor(h)}h${Math.round((h % 1) * 60) > 0 ? Math.round((h % 1) * 60) + 'min' : ''}`
    consultoriaLinks.forEach((link: { id: string; employee_id: string; client_id: string; monthly_hours_quota?: number; weekly_hours_quota?: number; employee?: { full_name?: string }; client?: { name?: string } }) => {
      const weeklyQuota = Number(link.weekly_hours_quota) || 0
      const monthlyQuota = Number(link.monthly_hours_quota) || 0
      const name = link.employee?.full_name || 'Colaborador'
      const client = link.client?.name || 'cliente'

      const linkVisits = consultoriaVisits.filter(
        (v: { employee_id: string; client_id: string; is_unavailable?: boolean }) =>
          v.employee_id === link.employee_id && v.client_id === link.client_id && !v.is_unavailable
      )

      // Alerta por visita: qualquer visita que exceda o combinado semanal
      if (weeklyQuota > 0) {
        linkVisits.forEach((v: { check_in?: string; check_out?: string; break_start?: string; break_end?: string }) => {
          const durH = calcDurH(v.check_in, v.check_out, v.break_start, v.break_end)
          if (durH > weeklyQuota + 0.1) {
            amberAlerts.push({
              text: `Consultoria: ${name} – ${client} registrou visita de ${fmtH(durH)} (combinado semanal: ${fmtH(weeklyQuota)}) — verificar e aprovar excedente`,
              path: '/colaboradores',
            })
          }
        })
      }

      // Alerta de déficit: só no dia 1, verificando o mês que fechou
      if (isFirstOfMonth && monthlyQuota > 0 && consultoriaPrevVisits) {
        const prevLinkVisits = (consultoriaPrevVisits as { employee_id: string; client_id: string; is_unavailable?: boolean; check_in?: string; check_out?: string; break_start?: string; break_end?: string }[]).filter(
          v => v.employee_id === link.employee_id && v.client_id === link.client_id && !v.is_unavailable
        )
        const prevTotalH = prevLinkVisits.reduce((s, v) =>
          s + Math.min(calcDurH(v.check_in, v.check_out, v.break_start, v.break_end), weeklyQuota > 0 ? weeklyQuota : Infinity), 0)
        if (prevTotalH < monthlyQuota - 0.1) {
          redAlerts.push({
            text: `Consultoria: ${name} – ${client} fechou o mês com ${fmtH(monthlyQuota - prevTotalH)} abaixo do combinado (${fmtH(prevTotalH)} de ${fmtH(monthlyQuota)}) — aplicar desconto proporcional`,
            path: '/colaboradores',
          })
        }
      }
    })
  }

  const allAlerts = [...redAlerts, ...amberAlerts]

  const MODAL_COLORS: Record<string, string> = {
    'Online': 'bg-blue-100 text-blue-700',
    'Presencial': 'bg-green-100 text-green-700',
    'Telefone': 'bg-gray-100 text-gray-700',
  }
  const STATUS_COLORS: Record<string, string> = {
    'Agendada': 'bg-amber-100 text-amber-700',
    'Realizada': 'bg-green-100 text-green-700',
    'Cancelada': 'bg-gray-100 text-gray-700',
    'Falta': 'bg-red-100 text-red-700',
  }

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'
  const firstName = (profile?.full_name || '').split(' ')[0]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <p className="eyebrow mb-1">{greeting}{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Dashboard</h1>
        </div>
        <p className="text-sm text-ink-400 capitalize">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Colaboradores */}
        <div className="card card-interactive p-5" onClick={() => navigate('/colaboradores')}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Colaboradores</p>
              <p className="text-3xl font-display font-extrabold text-ink-900 mt-1 tnum">{activeEmployees}</p>
              <p className="text-xs text-gray-400">de {totalEmployees} cadastrados</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Users size={20} className="text-blue-600" />
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (activeEmployees / totalEmployees) * 100)}%` }} />
          </div>
          {dismissedThisMonth > 0 && <p className="text-xs text-red-500 mt-1.5">↓ {dismissedThisMonth} desligado{dismissedThisMonth > 1 ? 's' : ''} este mês</p>}
        </div>

        {/* Vagas */}
        <div className="card card-interactive p-5" onClick={() => navigate('/vagas')}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Vagas Abertas</p>
              <p className="text-3xl font-display font-extrabold text-ink-900 mt-1 tnum">{openVacancies}</p>
              <p className="text-xs text-gray-400">{filledVacancies} preenchidas</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center">
              <Briefcase size={20} className="text-green-600" />
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: totalVacancies > 0 ? `${(filledVacancies / totalVacancies) * 100}%` : '0%' }} />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">{totalVacancies > 0 ? Math.round((filledVacancies / totalVacancies) * 100) : 0}% das vagas preenchidas</p>
        </div>

        {/* Candidatos */}
        <div className="card card-interactive p-5" onClick={() => navigate('/candidatos')}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Em Processo</p>
              <p className="text-3xl font-display font-extrabold text-ink-900 mt-1 tnum">{inProcess}</p>
              <p className="text-xs text-gray-400">{approvedCount ?? 0} aprovados aguardando</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
              <UserPlus size={20} className="text-purple-600" />
            </div>
          </div>
          {(approvedCount ?? 0) > 0 && (
            <div className="bg-purple-50 rounded-lg px-2 py-1 text-xs text-purple-700 font-medium">
              ⚡ {approvedCount} pronto{approvedCount! > 1 ? 's' : ''} para alocar
            </div>
          )}
        </div>

        {/* Alertas */}
        <div className={`card card-interactive p-5 ${redAlerts.length > 0 ? 'border-red-200 bg-red-50/40' : amberAlerts.length > 0 ? 'border-amber-200 bg-amber-50/40' : ''}`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-xs text-gray-500 font-medium">Alertas</p>
              <p className={`text-3xl font-display font-extrabold mt-1 tnum ${redAlerts.length > 0 ? 'text-red-600' : amberAlerts.length > 0 ? 'text-amber-600' : 'text-primary-600'}`}>
                {allAlerts.length}
              </p>
              <p className="text-xs text-gray-400">{redAlerts.length} crítico{redAlerts.length !== 1 ? 's' : ''}</p>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${redAlerts.length > 0 ? 'bg-red-100' : amberAlerts.length > 0 ? 'bg-amber-100' : 'bg-green-100'}`}>
              {allAlerts.length === 0
                ? <CheckCircle size={20} className="text-green-600" />
                : <AlertTriangle size={20} className={redAlerts.length > 0 ? 'text-red-600' : 'text-amber-600'} />
              }
            </div>
          </div>
          {allAlerts.length === 0 && <p className="text-xs text-green-600 font-medium">✓ Tudo em dia!</p>}
          {allAlerts.length > 0 && <p className="text-xs text-gray-500">Veja abaixo ↓</p>}
        </div>
      </div>

      {/* ── Alertas Críticos ── */}
      {allAlerts.length > 0 && (
        <div className="space-y-2">
          {redAlerts.length > 0 && (
            <div className="rounded-xl border border-red-200 overflow-hidden">
              <div className="bg-red-600 px-4 py-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-white" />
                <span className="text-sm font-semibold text-white">{redAlerts.length} Problema{redAlerts.length > 1 ? 's' : ''} Crítico{redAlerts.length > 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-red-100 bg-white">
                {redAlerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 px-4 py-2.5 ${a.path ? 'cursor-pointer hover:bg-red-50' : ''}`}
                    onClick={() => a.path && navigate(a.path)}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <p className="text-sm text-red-800 flex-1">{a.text}</p>
                    {a.path && <span className="text-xs text-red-400">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {amberAlerts.length > 0 && (
            <div className="rounded-xl border border-amber-200 overflow-hidden">
              <div className="bg-amber-500 px-4 py-2 flex items-center gap-2">
                <Clock size={14} className="text-white" />
                <span className="text-sm font-semibold text-white">{amberAlerts.length} Atenção</span>
              </div>
              <div className="divide-y divide-amber-100 bg-white">
                {amberAlerts.map((a, i) => (
                  <div key={i} className={`flex items-start gap-3 px-4 py-2.5 ${a.path ? 'cursor-pointer hover:bg-amber-50' : ''}`}
                    onClick={() => a.path && navigate(a.path)}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                    <p className="text-sm text-amber-800 flex-1">{a.text}</p>
                    {a.path && <span className="text-xs text-amber-400">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Financeiro (chefe) ── */}
        {role === 'chefe' && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <CreditCard size={16} className="text-primary-600" />
                Financeiro do Mês
              </h2>
              <button onClick={() => navigate('/pagamentos')} className="text-xs text-primary-600 hover:underline">Ver tudo →</button>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="text-center bg-green-50 rounded-xl p-3">
                <p className="text-lg font-bold text-green-700">{formatCurrency(totalPaid)}</p>
                <p className="text-xs text-green-500 mt-0.5">Pago</p>
                <p className="text-xs text-gray-400">{paid.length} lançamentos</p>
              </div>
              <div className="text-center bg-amber-50 rounded-xl p-3">
                <p className="text-lg font-bold text-amber-700">{formatCurrency(totalToPay)}</p>
                <p className="text-xs text-amber-500 mt-0.5">A Pagar</p>
                <p className="text-xs text-gray-400">{toPay.length} lançamentos</p>
              </div>
              <div className="text-center bg-red-50 rounded-xl p-3">
                <p className="text-lg font-bold text-red-700">{formatCurrency(totalOverdue)}</p>
                <p className="text-xs text-red-500 mt-0.5">Atrasado</p>
                <p className="text-xs text-gray-400">{overdue.length} lançamentos</p>
              </div>
            </div>

            {pieData.length > 0 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                      dataKey="value" paddingAngle={3}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-6">Sem movimentação no mês</p>
            )}

            {totalMonth > 0 && (
              <div className="mt-2 border-t pt-3">
                <p className="text-xs text-gray-500 mb-1.5">Distribuição do mês</p>
                <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                  {pieData.map((d, i) => (
                    <div key={i} style={{ width: `${(d.value / totalMonth) * 100}%`, backgroundColor: d.color }} />
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">Total: {formatCurrency(totalMonth)}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Vagas & Contratos ── */}
        <div className="card p-5">
          <h2 className="section-title text-base mb-4">
            <Briefcase size={16} className="text-primary-600" />
            Vagas & Contratos
          </h2>
          <div className="grid grid-cols-2 gap-5">
            <MiniDonut title="Vagas" data={vagasPie} total={vagasTotal} empty="Nenhuma vaga" />
            <div className="sm:border-l sm:border-ink-100 sm:pl-5">
              <MiniDonut title="Contratos" data={contratosPie} total={contratosTotal} empty="Nenhum contrato" />
            </div>
          </div>
        </div>

        {/* ── Equipe & Operação (chefe) ── */}
        {role === 'chefe' && (
          <div className="card p-5 lg:col-span-2">
            <h2 className="section-title text-base mb-4">
              <Users size={16} className="text-primary-600" />
              Equipe & Operação
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 divide-y sm:divide-y-0 sm:divide-x divide-ink-100">
              <div className="sm:pr-5">
                <MiniDonut title="Colaboradores" data={colaboradoresPie} total={colaboradoresTotal} empty="Nenhum colaborador" />
              </div>
              <div className="pt-5 sm:pt-0 sm:px-5">
                <MiniDonut title="Visitas do mês" data={visitasPie} total={visitasTotal} empty="Sem visitas" />
              </div>
              <div className="pt-5 sm:pt-0 sm:pl-5">
                <MiniDonut title="Documentos" data={documentosPie} total={documentosTotal} empty="Sem documentos" />
              </div>
            </div>
          </div>
        )}

        {/* ── Pendências de Documentação (chefe) ── */}
        {role === 'chefe' && (pendingDocs?.length ?? 0) > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Clipboard size={16} className="text-amber-500" />
                Documentos Pendentes
                <span className="badge bg-amber-100 text-amber-700">{pendingDocs!.length}</span>
              </h2>
              <button onClick={() => navigate('/colaboradores')} className="text-xs text-primary-600 hover:underline">Ver colaboradores →</button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {pendingDocs?.slice(0, 15).map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 bg-amber-50 rounded-lg cursor-pointer hover:bg-amber-100"
                  onClick={() => navigate(`/colaboradores/${(d as { employee?: { id: string } }).employee?.id}`)}>
                  <div>
                    <p className="text-xs font-medium text-amber-800">{(d as { employee?: { full_name: string } }).employee?.full_name}</p>
                    <p className="text-xs text-amber-600">{d.name}</p>
                  </div>
                  <span className="text-xs text-amber-400">→</span>
                </div>
              ))}
              {(pendingDocs?.length ?? 0) > 15 && (
                <p className="text-xs text-gray-400 text-center">+{(pendingDocs?.length ?? 0) - 15} mais…</p>
              )}
            </div>
          </div>
        )}

        {/* ── Próximas Entrevistas ── */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Calendar size={16} className="text-primary-600" />
              Próximas Entrevistas
            </h2>
            <button onClick={() => navigate('/agenda')} className="text-xs text-primary-600 hover:underline">Ver agenda →</button>
          </div>
          {interviews?.length === 0 ? (
            <div className="text-center py-6">
              <Calendar size={28} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Nenhuma entrevista agendada</p>
            </div>
          ) : (
            <div className="space-y-2">
              {interviews?.map((i: { id: string; candidate?: { full_name: string }; scheduled_at: string; modality: string; status: string; vacancy?: { title: string } }) => (
                <div key={i.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 cursor-pointer border border-gray-100">
                  <div className="w-9 h-9 rounded-xl bg-primary-50 flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary-700 leading-none">{new Date(i.scheduled_at).getDate()}</span>
                    <span className="text-xs text-primary-400 leading-none">{new Date(i.scheduled_at).toLocaleDateString('pt-BR', { month: 'short' })}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{i.candidate?.full_name}</p>
                    <p className="text-xs text-gray-500">{formatDateTime(i.scheduled_at)} · {i.vacancy?.title || 'Sem vaga'}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
                    <span className={`badge text-xs ${MODAL_COLORS[i.modality] || 'bg-gray-100 text-gray-700'}`}>{i.modality}</span>
                    <span className={`badge text-xs ${STATUS_COLORS[i.status] || 'bg-gray-100 text-gray-700'}`}>{i.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-600" />
          Atalhos Rápidos
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Novo Colaborador', path: '/colaboradores/novo', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' },
            { label: 'Nova Vaga', path: '/vagas/nova', color: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
            { label: 'Novo Candidato', path: '/candidatos/novo', color: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100' },
            { label: 'Pipeline Kanban', path: '/candidatos/kanban', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' },
            { label: 'Nova Entrevista', path: '/agenda/nova', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
            { label: 'Novo Contrato', path: '/contratos/novo', color: 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100' },
          ].map(q => (
            <button key={q.path} onClick={() => navigate(q.path)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors ${q.color}`}>
              <Plus size={13} />
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Donut compacto reutilizável (rosca com total no centro + legenda)
function MiniDonut({ title, data, total, empty }: {
  title: string
  data: { name: string; value: number; color: string }[]
  total: number
  empty: string
}) {
  return (
    <div className="flex flex-col">
      <p className="text-xs font-semibold text-ink-500 mb-1 text-center">{title}</p>
      {total > 0 ? (
        <>
          <div className="h-32 relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={34} outerRadius={54} dataKey="value" paddingAngle={3} stroke="none">
                  {data.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-display font-extrabold text-ink-900 tnum">{total}</span>
              <span className="text-[10px] text-ink-400">total</span>
            </div>
          </div>
          <div className="space-y-1 mt-2">
            {data.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-ink-600"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.name}</span>
                <span className="font-semibold text-ink-800 tnum">{d.value}</span>
              </div>
            ))}
          </div>
        </>
      ) : <p className="text-center text-xs text-ink-400 py-10">{empty}</p>}
    </div>
  )
}
