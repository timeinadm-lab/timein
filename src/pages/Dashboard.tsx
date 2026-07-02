import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import {
  Users, Briefcase, UserPlus, AlertTriangle, CheckCircle,
  Calendar, Plus, TrendingUp, Clock, Clipboard, Download, X,
  BarChart3, Activity, Check, Database, FolderDown, ChevronDown,
  MessageSquare, FileWarning,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatCurrency, formatDateTime } from '../lib/utils'
import { addDays, startOfMonth, endOfMonth, isBefore, parseISO, isAfter, differenceInDays, subMonths } from 'date-fns'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'

const BACKUP_TABLES = [
  'user_profiles', 'clients', 'client_locations', 'client_units', 'client_contracts',
  'employees', 'employee_documents', 'employee_client_links', 'employee_payment_dates',
  'employee_payment_checks', 'employee_history', 'employee_expenses', 'employee_questions',
  'contracts', 'contract_templates', 'vacancies', 'vacancy_interests',
  'candidates', 'candidate_contacts', 'interviews',
  'payments', 'supervision_visits', 'inspections', 'inspection_links',
  'nutritionist_visits', 'nutritionist_agenda', 'chat_messages',
  'shared_documents', 'link_history', 'placements_history', 'app_security',
]

const FILE_SOURCES: { table: string; col: string; bucket: string; label: string }[] = [
  { table: 'employee_documents', col: 'file_url', bucket: 'arquivos', label: 'Docs colaboradores' },
  { table: 'employee_client_links', col: 'contract_file_url', bucket: 'arquivos', label: 'Contratos vínculos' },
  { table: 'employee_expenses', col: 'receipt_url', bucket: 'arquivos', label: 'Comprovantes gastos' },
  { table: 'client_contracts', col: 'file_url', bucket: 'arquivos', label: 'Contratos clientes' },
  { table: 'shared_documents', col: 'file_url', bucket: 'arquivos', label: 'Docs compartilhados' },
  { table: 'employees', col: 'photo_url', bucket: 'fotos de funcionários', label: 'Fotos colaboradores' },
]

export default function Dashboard() {
  const { role, profile } = useAuth()
  const [backingUp, setBackingUp] = useState(false)
  const [backingUpDocs, setBackingUpDocs] = useState(false)
  const [docProgress, setDocProgress] = useState('')
  const [showBackupMenu, setShowBackupMenu] = useState(false)

  const handleBackupData = async () => {
    setShowBackupMenu(false)
    setBackingUp(true)
    try {
      const backup: Record<string, unknown[]> = {}
      for (const table of BACKUP_TABLES) {
        const rows: unknown[] = []
        let from = 0
        const pageSize = 1000
        while (true) {
          const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1)
          if (error) { console.warn(`Backup skip ${table}:`, error.message); break }
          if (!data?.length) break
          rows.push(...data)
          if (data.length < pageSize) break
          from += pageSize
        }
        backup[table] = rows
      }
      backup._meta = [{ exported_at: new Date().toISOString(), tables: Object.keys(backup).length, total_rows: Object.values(backup).reduce((s, r) => s + (r as unknown[]).length, 0) }]
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `timein-backup-dados-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup de dados exportado!')
    } catch (e) {
      toast.error('Erro ao exportar: ' + String(e))
    } finally {
      setBackingUp(false)
    }
  }

  const handleBackupDocs = async () => {
    setShowBackupMenu(false)
    setBackingUpDocs(true)
    setDocProgress('Carregando lista de arquivos...')
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const allFiles: { path: string; bucket: string; folder: string }[] = []
      for (const src of FILE_SOURCES) {
        const { data, error } = await supabase.from(src.table).select(`id,${src.col}`)
        if (error) { console.warn(`Skip ${src.table}:`, error.message); continue }
        for (const row of (data || [])) {
          const val = (row as Record<string, string>)[src.col]
          if (!val || val.startsWith('http')) continue
          allFiles.push({ path: val, bucket: src.bucket, folder: src.label })
        }
      }

      if (allFiles.length === 0) {
        toast('Nenhum documento encontrado para backup.', { icon: '📂' })
        return
      }

      let done = 0
      let errors = 0
      for (const file of allFiles) {
        done++
        setDocProgress(`Baixando ${done}/${allFiles.length} — ${file.folder}`)
        try {
          const { data } = await supabase.storage.from(file.bucket).download(file.path)
          if (data) {
            const fileName = file.path.split('/').pop() || `file_${done}`
            zip.file(`${file.folder}/${fileName}`, data)
          } else { errors++ }
        } catch { errors++ }
      }

      setDocProgress('Gerando ZIP...')
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `timein-backup-documentos-${new Date().toISOString().slice(0, 10)}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Backup de documentos exportado! ${done - errors} arquivos${errors ? ` (${errors} com erro)` : ''}`)
    } catch (e) {
      toast.error('Erro ao exportar documentos: ' + String(e))
    } finally {
      setBackingUpDocs(false)
      setDocProgress('')
    }
  }
  const navigate = useNavigate()
  const now = new Date()
  const in15 = addDays(now, 15)
  const in40 = addDays(now, 40)
  const monthStart = startOfMonth(now).toISOString()
  const monthEnd = endOfMonth(now).toISOString()

  const { data: employees } = useQuery({
    queryKey: ['dashboard-employees'],
    queryFn: async () => {
      const { data } = await supabase.from('employees').select('id,status,dismissal_date,full_name,employee_type')
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

  // Contratos pendentes de anexação — Fixo/Consultoria: amarelo após 24h, vermelho após 48h
  const { data: pendingContractFiles } = useQuery({
    queryKey: ['dashboard-pending-contract-files'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('id,created_at,service_type,employee_id,employee:employees(id,full_name,status),client:clients(name)')
        .in('service_type', ['Fixo', 'Consultoria'])
        .is('contract_file_url', null)
      return (data || []).filter((l: { employee?: { status?: string } }) => l.employee?.status === 'Ativo')
    },
  })

  // Todos os vínculos que exigem contrato (exceto Volante) — para a pizza de Contratos:
  // quantos já têm contrato anexado vs. quantos faltam
  const { data: contractLinks } = useQuery({
    queryKey: ['dashboard-contract-links'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('id,contract_file_url,service_type,employee:employees(status)')
        .neq('service_type', 'Volante')
      return (data || []).filter((l: { employee?: { status?: string } }) => l.employee?.status === 'Ativo')
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
        .select('*,candidate:candidates(full_name),vacancy:vacancies(title),employee:employees(full_name)')
        .gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true }).limit(8)
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
        .select('id,employee_id,client_id,monthly_hours_quota,weekly_hours_quota,visits_per_week,start_date,created_at,employee:employees(full_name,status),client:clients(name)')
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
        .select('employee_id,client_id,visit_date,check_in,check_out,break_start,break_end,is_unavailable')
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
        .select('employee_id,client_id,visit_date,check_in,check_out,break_start,break_end,is_unavailable')
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

  // Contratações por mês (últimos 6 meses) — para gráfico de barras
  const { data: hiringTimeline } = useQuery({
    queryKey: ['dashboard-hiring-timeline'],
    queryFn: async () => {
      const sixAgo = subMonths(now, 5)
      const from = startOfMonth(sixAgo).toISOString().slice(0, 10)
      const { data } = await supabase
        .from('employee_client_links')
        .select('id,created_at')
        .gte('created_at', from)
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Volantes: vínculos ativos para saber quais estão atuando
  const { data: volanteLinks } = useQuery({
    queryKey: ['dashboard-volante-links'],
    queryFn: async () => {
      const { data } = await supabase
        .from('employee_client_links')
        .select('employee_id,contract_end_date')
        .eq('service_type', 'Volante')
      return data || []
    },
    enabled: role === 'chefe',
  })

  // ── Derived ──────────────────────────────────────────────────────────────────
  const activeEmployees = employees?.filter(e => e.status === 'Ativo').length ?? 0
  const totalEmployees = employees?.length ?? 1
  const dismissedThisMonth = employees?.filter(e =>
    e.status === 'Inativo' && e.dismissal_date &&
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

  // Enriquecimento dos KPIs
  const linksThisMonth = hiringTimeline?.filter(h => h.created_at?.slice(0, 7) === currentMonthStr).length ?? 0
  const openPositions = (vacanciesExpiring || []).reduce((s, v) =>
    s + Math.max(0, ((v as { positions_count?: number }).positions_count ?? 1) - ((v as { hired_count?: number }).hired_count ?? 0)), 0)

  // Pagamentos atrasados — usados só nos alertas (detalhes financeiros ficam na aba Pagamentos)
  const overdue = payments?.filter(p => p.status === 'Pendente' && p.due_date < now.toISOString().slice(0, 10)) ?? []

  // Pendências operacionais somadas — 4º KPI
  const pendDocs = pendingDocs?.length ?? 0
  const pendContratos = pendingContractFiles?.length ?? 0
  const pendChat = unreadChatCount ?? 0
  const pendExtras = pendingExtras?.length ?? 0
  const pendComprovantes = pendingExpenses?.length ?? 0
  const pendenciasCount = pendDocs + pendContratos + pendChat + pendExtras + pendComprovantes

  // Vagas: distribuição por status
  const vagasPie = [
    { name: 'Abertas', value: vacancies?.filter(v => v.status === 'Aberta').length ?? 0, color: '#f59e0b' },
    { name: 'Atuando', value: vacancies?.filter(v => v.status === 'Atuando').length ?? 0, color: '#22c55e' },
    { name: 'Preenchidas', value: vacancies?.filter(v => v.status === 'Preenchida').length ?? 0, color: '#22c55e' },
  ].filter(d => d.value > 0)
  const vagasTotal = vagasPie.reduce((s, d) => s + d.value, 0)

  // Contratos: anexados vs pendentes — 1 contrato por vínculo (exceto Volante)
  // Ex: 20 vinculados, 17 com contrato anexado → 17 anexados, 3 pendentes
  const contratosAnexados = (contractLinks || []).filter(l => (l as { contract_file_url?: string }).contract_file_url).length
  const contratosPendentes = (contractLinks || []).filter(l => !(l as { contract_file_url?: string }).contract_file_url).length
  const contratosPie = [
    { name: 'Anexados', value: contratosAnexados, color: '#22c55e' },
    { name: 'Pendentes', value: contratosPendentes, color: '#f59e0b' },
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

  // Hiring timeline — bar chart data (últimos 6 meses)
  const hiringBarData = (() => {
    const months: { month: string; contratacoes: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const m = subMonths(now, i)
      const key = m.toISOString().slice(0, 7)
      const label = m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
      const count = hiringTimeline?.filter(h => h.created_at?.slice(0, 7) === key).length ?? 0
      months.push({ month: label.charAt(0).toUpperCase() + label.slice(1), contratacoes: count })
    }
    return months
  })()

  // Status breakdown dos colaboradores
  const empStatusData = [
    { name: 'Ativos', value: employees?.filter(e => e.status === 'Ativo').length ?? 0, color: '#22c55e' },
    { name: 'Ociosos', value: employees?.filter(e => e.status === 'Ocioso').length ?? 0, color: '#f59e0b' },
    { name: 'Inativos', value: employees?.filter(e => e.status === 'Inativo').length ?? 0, color: '#94a3b8' },
  ].filter(d => d.value > 0)

  // Volantes: disponíveis vs. atuando
  const volantesAll = employees?.filter(e => (e as { employee_type?: string }).employee_type === 'Volante' && e.status !== 'Inativo') ?? []
  const today = now.toISOString().slice(0, 10)
  const volantesAtuandoIds = new Set(
    (volanteLinks || [])
      .filter(l => !l.contract_end_date || l.contract_end_date >= today)
      .map(l => l.employee_id)
  )
  const volantesAtuando = volantesAll.filter(v => volantesAtuandoIds.has(v.id)).length
  const volantesDisp = volantesAll.length - volantesAtuando
  const volantesPie = [
    { name: 'Atuando', value: volantesAtuando, color: '#f97316' },
    { name: 'Disponíveis', value: volantesDisp, color: '#22c55e' },
  ].filter(d => d.value > 0)
  const volantesTotal = volantesPie.reduce((s, d) => s + d.value, 0)

  // Alerts grouped by severity — dismiss = esconder temporariamente, resolve = check-in "resolvido"
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('timein_dismissed_alerts') || '[]')) } catch { return new Set() }
  })
  const [resolvedAlerts, setResolvedAlerts] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('timein_resolved_alerts') || '[]')) } catch { return new Set() }
  })
  const dismissAlert = (key: string) => {
    setDismissedAlerts(prev => {
      const next = new Set(prev); next.add(key)
      localStorage.setItem('timein_dismissed_alerts', JSON.stringify([...next]))
      return next
    })
  }
  const resolveAlert = (key: string) => {
    setResolvedAlerts(prev => {
      const next = new Set(prev); next.add(key)
      localStorage.setItem('timein_resolved_alerts', JSON.stringify([...next]))
      return next
    })
  }

  const redAlerts: { text: string; action?: string; path?: string; key?: string }[] = []
  const amberAlerts: { text: string; action?: string; path?: string; key?: string }[] = []

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

  // Contrato não anexado — Fixo/Consultoria: aparece imediatamente, vermelho após 48h
  pendingContractFiles?.forEach(l => {
    const created = (l as { created_at?: string }).created_at
    if (!created) return
    const hours = Math.floor((now.getTime() - new Date(created).getTime()) / 3600000)
    const empId = (l as { employee?: { id: string } }).employee?.id
    const name = (l as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const client = (l as { client?: { name: string } }).client?.name || ''
    const path = empId ? `/colaboradores/${empId}?tab=vinculos` : '/colaboradores'
    const label = `Contrato pendente: ${name}${client ? ' – ' + client : ''} — anexar contrato assinado${hours > 0 ? ` (há ${hours}h)` : ''}`
    if (hours >= 48) redAlerts.push({ text: label, path })
    else amberAlerts.push({ text: label, path })
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
    const daysInMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    consultoriaLinks.forEach((link: { id: string; employee_id: string; client_id: string; monthly_hours_quota?: number; weekly_hours_quota?: number; start_date?: string; created_at?: string; employee?: { full_name?: string }; client?: { name?: string } }) => {
      const weeklyQuota = Number(link.weekly_hours_quota) || 0
      const fullMonthlyQuota = Number(link.monthly_hours_quota) || 0
      const name = link.employee?.full_name || 'Colaborador'
      const client = link.client?.name || 'cliente'
      const linkStart = link.start_date || (link.created_at ? link.created_at.slice(0, 10) : null)

      const linkVisits = consultoriaVisits.filter(
        (v: { employee_id: string; client_id: string; is_unavailable?: boolean }) =>
          v.employee_id === link.employee_id && v.client_id === link.client_id && !v.is_unavailable
      )

      // Alerta por visita: qualquer visita que exceda o combinado semanal
      if (weeklyQuota > 0) {
        linkVisits.forEach((v: { check_in?: string; check_out?: string; break_start?: string; break_end?: string }) => {
          const durH = calcDurH(v.check_in, v.check_out, v.break_start, v.break_end)
          if (durH > weeklyQuota + 0.1) {
            const key = `visit-excess-${link.id}-${(v as { check_in?: string }).check_in}`
            amberAlerts.push({
              key,
              text: `Consultoria: ${name} – ${client} registrou visita de ${fmtH(durH)} (combinado semanal: ${fmtH(weeklyQuota)}) — verificar e aprovar excedente`,
              path: '/colaboradores',
            })
          }
        })
      }

      // Alerta de déficit: só no dia 1, verificando o mês que fechou
      // Proporcionaliza a cota se o vínculo começou no meio do mês
      if (isFirstOfMonth && fullMonthlyQuota > 0 && consultoriaPrevVisits) {
        const prevLinkVisits = (consultoriaPrevVisits as { employee_id: string; client_id: string; is_unavailable?: boolean; check_in?: string; check_out?: string; break_start?: string; break_end?: string }[]).filter(
          v => v.employee_id === link.employee_id && v.client_id === link.client_id && !v.is_unavailable
        )
        const totalDays = daysInMonth(prevMonth)
        let effectiveDays = totalDays
        if (linkStart) {
          const startDate = parseISO(linkStart)
          const prevStart = startOfMonth(prevMonth)
          const prevEnd = endOfMonth(prevMonth)
          if (isAfter(startDate, prevEnd)) effectiveDays = 0
          else if (isAfter(startDate, prevStart)) effectiveDays = differenceInDays(prevEnd, startDate) + 1
        }
        const proportionalQuota = fullMonthlyQuota * (effectiveDays / totalDays)
        if (effectiveDays === 0) return

        const prevTotalH = prevLinkVisits.reduce((s, v) =>
          s + Math.min(calcDurH(v.check_in, v.check_out, v.break_start, v.break_end), weeklyQuota > 0 ? weeklyQuota : Infinity), 0)
        if (prevTotalH < proportionalQuota - 0.1) {
          const key = `deficit-${link.id}-${prevMonthStr}`
          redAlerts.push({
            key,
            text: `Consultoria: ${name} – ${client} fechou o mês com ${fmtH(proportionalQuota - prevTotalH)} abaixo do combinado (${fmtH(prevTotalH)} de ${fmtH(proportionalQuota)}${effectiveDays < totalDays ? ` — proporcional: ${effectiveDays}/${totalDays} dias` : ''}) — aplicar desconto proporcional`,
            path: '/colaboradores',
          })
        }
      }
    })
  }

  // Consultoria quinzenal: detecta visitas concentradas numa só quinzena
  if (role === 'chefe' && consultoriaLinks?.length && consultoriaVisits) {
    const currentDay = now.getDate()
    consultoriaLinks.forEach((link: { id: string; employee_id: string; client_id: string; employee?: { full_name?: string }; client?: { name?: string } }) => {
      const name = link.employee?.full_name || 'Colaborador'
      const client = link.client?.name || 'cliente'
      const linkVisits = (consultoriaVisits as { employee_id: string; client_id: string; visit_date: string; is_unavailable?: boolean }[]).filter(
        v => v.employee_id === link.employee_id && v.client_id === link.client_id && !v.is_unavailable
      )
      if (linkVisits.length < 2) return
      const q1 = linkVisits.filter(v => parseInt(v.visit_date.slice(8, 10)) <= 15).length
      const q2 = linkVisits.filter(v => parseInt(v.visit_date.slice(8, 10)) >= 16).length
      // Se já passamos da 1ª quinzena e todas as visitas estão na mesma
      if (currentDay >= 16 && q1 > 0 && q2 === 0) {
        const key = `quinzena-dist-${link.id}-${currentMonthStr}`
        amberAlerts.push({ key, text: `Consultoria quinzenal: ${name} – ${client} tem ${q1} visita(s) apenas na 1ª quinzena — falta visita na 2ª quinzena`, path: '/visitas' })
      }
      // Se o mês acabou (ou quase) e todas na 2ª quinzena
      if (q2 > 0 && q1 === 0) {
        const key = `quinzena-dist-${link.id}-${currentMonthStr}`
        amberAlerts.push({ key, text: `Consultoria quinzenal: ${name} – ${client} tem ${q2} visita(s) apenas na 2ª quinzena — nenhuma visita na 1ª quinzena (irregularidade)`, path: '/visitas' })
      }
    })
  }

  // Auto-assign keys to all alerts for check-in/resolve tracking
  redAlerts.forEach((a, i) => { if (!a.key) a.key = `red-${i}-${a.text.slice(0, 30)}` })
  amberAlerts.forEach((a, i) => { if (!a.key) a.key = `amber-${i}-${a.text.slice(0, 30)}` })

  const isHidden = (a: { key?: string }) => a.key && (dismissedAlerts.has(a.key) || resolvedAlerts.has(a.key))
  const filteredRed = redAlerts.filter(a => !isHidden(a))
  const filteredAmber = amberAlerts.filter(a => !isHidden(a))
  const allAlerts = [...filteredRed, ...filteredAmber]
  const resolvedCount = [...redAlerts, ...amberAlerts].filter(a => a.key && resolvedAlerts.has(a.key)).length

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
        <div className="flex items-center gap-3">
          {role === 'chefe' && (
            <div className="relative">
              <button
                onClick={() => setShowBackupMenu(p => !p)}
                disabled={backingUp || backingUpDocs}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                <Download size={14} />
                {backingUp ? 'Exportando dados...' : backingUpDocs ? docProgress || 'Exportando docs...' : 'Backup'}
                {!backingUp && !backingUpDocs && <ChevronDown size={12} />}
              </button>
              {showBackupMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBackupMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 w-72 bg-white rounded-xl shadow-lg border border-ink-100 overflow-hidden">
                    <button
                      onClick={handleBackupData}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-ink-50 transition-colors text-left"
                    >
                      <Database size={18} className="text-blue-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-ink-900">Backup do Sistema</p>
                        <p className="text-xs text-ink-400 mt-0.5">Todos os dados (clientes, vagas, colaboradores, pagamentos...) em JSON</p>
                      </div>
                    </button>
                    <div className="border-t border-ink-100" />
                    <button
                      onClick={handleBackupDocs}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-ink-50 transition-colors text-left"
                    >
                      <FolderDown size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-ink-900">Backup dos Documentos</p>
                        <p className="text-xs text-ink-400 mt-0.5">Todos os PDFs, contratos, comprovantes e fotos em ZIP</p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <p className="text-sm text-ink-400 capitalize">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      {/* ── Prioridades + Agenda do RH — o que importa primeiro ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 items-start">
        {/* Prioridades (urgências) */}
        <div className="lg:col-span-2 space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="section-title text-base">
              <AlertTriangle size={16} className={filteredRed.length > 0 ? 'text-red-500' : filteredAmber.length > 0 ? 'text-amber-500' : 'text-primary-600'} />
              Prioridades
            </h2>
            <div className="flex items-center gap-1.5">
              {filteredRed.length > 0 && <span className="badge bg-red-100 text-red-700">{filteredRed.length} crítico{filteredRed.length > 1 ? 's' : ''}</span>}
              {filteredAmber.length > 0 && <span className="badge bg-amber-100 text-amber-700">{filteredAmber.length} atenção</span>}
            </div>
          </div>

          {allAlerts.length === 0 && (
            <div className="card p-6 flex items-center gap-4 border-primary-100 bg-primary-50/40">
              <div className="w-11 h-11 rounded-2xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle size={22} className="text-primary-700" />
              </div>
              <div>
                <p className="font-semibold text-ink-900">Tudo em dia!</p>
                <p className="text-sm text-ink-500">Nenhuma pendência urgente agora{resolvedCount > 0 ? ` — ${resolvedCount} resolvida${resolvedCount > 1 ? 's' : ''}` : ''}.</p>
              </div>
            </div>
          )}

          {filteredRed.length > 0 && (
            <div className="rounded-2xl border border-red-200 overflow-hidden shadow-card bg-white">
              <div className="bg-red-600 px-4 py-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-white" />
                <span className="text-sm font-semibold text-white">{filteredRed.length} Problema{filteredRed.length > 1 ? 's' : ''} Crítico{filteredRed.length > 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-red-100">
                {filteredRed.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                    <p className={`text-sm text-red-800 flex-1 ${a.path ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => a.path && navigate(a.path)}>{a.text}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {a.key && (
                        <button onClick={() => resolveAlert(a.key!)} className="text-green-400 hover:text-green-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" title="Marcar como resolvido">
                          <Check size={14} />
                        </button>
                      )}
                      {a.key && (
                        <button onClick={() => dismissAlert(a.key!)} className="text-red-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" title="Dispensar alerta">
                          <X size={14} />
                        </button>
                      )}
                      {a.path && <span className="text-xs text-red-400">→</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredAmber.length > 0 && (
            <div className="rounded-2xl border border-amber-200 overflow-hidden shadow-card bg-white">
              <div className="bg-amber-500 px-4 py-2 flex items-center gap-2">
                <Clock size={14} className="text-white" />
                <span className="text-sm font-semibold text-white">{filteredAmber.length} Atenção</span>
              </div>
              <div className="divide-y divide-amber-100">
                {filteredAmber.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 group">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                    <p className={`text-sm text-amber-800 flex-1 ${a.path ? 'cursor-pointer hover:underline' : ''}`}
                      onClick={() => a.path && navigate(a.path)}>{a.text}</p>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {a.key && (
                        <button onClick={() => resolveAlert(a.key!)} className="text-green-400 hover:text-green-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" title="Marcar como resolvido">
                          <Check size={14} />
                        </button>
                      )}
                      {a.key && (
                        <button onClick={() => dismissAlert(a.key!)} className="text-amber-300 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded" title="Dispensar alerta">
                          <X size={14} />
                        </button>
                      )}
                      {a.path && <span className="text-xs text-amber-400">→</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolvedCount > 0 && allAlerts.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 rounded-xl border border-green-200">
              <CheckCircle size={14} className="text-green-600" />
              <span className="text-sm text-green-700 font-medium">{resolvedCount} pendência{resolvedCount > 1 ? 's' : ''} resolvida{resolvedCount > 1 ? 's' : ''}</span>
              <button onClick={() => {
                setResolvedAlerts(new Set())
                localStorage.removeItem('timein_resolved_alerts')
              }} className="text-xs text-green-500 hover:text-green-700 ml-auto">Limpar</button>
            </div>
          )}
        </div>

        {/* Agenda do RH */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="section-title text-base">
              <Calendar size={16} className="text-primary-600" />
              Agenda do RH
            </h2>
            <button onClick={() => navigate('/agenda')} className="text-xs text-primary-600 hover:underline font-medium">Ver tudo →</button>
          </div>
          <div className="card p-3">
            {interviews?.length === 0 ? (
              <div className="text-center py-8">
                <Calendar size={28} className="text-ink-200 mx-auto mb-2" />
                <p className="text-sm text-ink-400">Nenhum compromisso agendado</p>
                <button onClick={() => navigate('/agenda/nova')} className="text-xs text-primary-600 font-semibold hover:underline mt-2">+ Agendar compromisso</button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {interviews?.map((i: { id: string; title?: string; candidate?: { full_name: string }; employee?: { full_name: string }; scheduled_at: string; end_date?: string; modality: string; status: string; vacancy?: { title: string } }) => {
                  const d = new Date(i.scheduled_at)
                  const isToday = d.toDateString() === now.toDateString()
                  const isTomorrow = d.toDateString() === addDays(now, 1).toDateString()
                  return (
                    <div key={i.id}
                      className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer border transition-colors ${isToday ? 'border-primary-200 bg-primary-50/60 hover:bg-primary-50' : 'border-ink-100 hover:bg-ink-50'}`}
                      onClick={() => navigate('/agenda')}>
                      <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center flex-shrink-0 ${isToday ? 'bg-primary-600 text-white' : 'bg-primary-50 text-primary-700'}`}>
                        {isToday || isTomorrow ? (
                          <span className="text-[9px] font-extrabold uppercase leading-none">{isToday ? 'Hoje' : 'Amanhã'}</span>
                        ) : (
                          <span className="text-sm font-bold leading-none">{d.getDate()}</span>
                        )}
                        <span className={`text-[9px] leading-none mt-1 ${isToday ? 'text-primary-100' : 'text-primary-400'}`}>
                          {isToday || isTomorrow ? formatDate(i.scheduled_at, 'HH:mm') : d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink-900 truncate">{i.title || i.candidate?.full_name || 'Compromisso'}</p>
                        <p className="text-xs text-ink-400 truncate">
                          {formatDateTime(i.scheduled_at)}
                          {i.employee?.full_name ? ` · ${i.employee.full_name}` : ''}
                          {i.candidate?.full_name ? ` · ${i.candidate.full_name}` : ''}
                        </p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span className={`badge text-[10px] ${MODAL_COLORS[i.modality] || 'bg-gray-100 text-gray-700'}`}>{i.modality}</span>
                          <span className={`badge text-[10px] ${STATUS_COLORS[i.status] || 'bg-gray-100 text-gray-700'}`}>{i.status}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
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
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {linksThisMonth > 0 && <p className="text-xs text-green-600 font-medium">↑ {linksThisMonth} contratação{linksThisMonth > 1 ? 'ões' : ''} no mês</p>}
            {dismissedThisMonth > 0 && <p className="text-xs text-red-500">↓ {dismissedThisMonth} inativado{dismissedThisMonth > 1 ? 's' : ''}</p>}
          </div>
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
          <p className="text-xs text-gray-400 mt-1.5">
            {openPositions > 0
              ? <span className="text-amber-600 font-medium">{openPositions} posição{openPositions > 1 ? 'ões' : ''} a preencher</span>
              : `${totalVacancies > 0 ? Math.round((filledVacancies / totalVacancies) * 100) : 0}% das vagas preenchidas`}
          </p>
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

        {/* Pendências operacionais */}
        <div className={`card p-5 ${pendenciasCount > 0 ? 'border-amber-200 bg-amber-50/30' : ''}`}>
          <div className="flex items-start justify-between mb-2">
            <div>
              <p className="text-xs text-gray-500 font-medium">Pendências</p>
              <p className={`text-3xl font-display font-extrabold mt-1 tnum ${pendenciasCount > 0 ? 'text-amber-600' : 'text-primary-600'}`}>
                {pendenciasCount}
              </p>
              <p className="text-xs text-gray-400">para resolver</p>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${pendenciasCount > 0 ? 'bg-amber-100' : 'bg-green-100'}`}>
              {pendenciasCount === 0
                ? <CheckCircle size={20} className="text-green-600" />
                : <FileWarning size={20} className="text-amber-600" />
              }
            </div>
          </div>
          {pendenciasCount === 0 ? (
            <p className="text-xs text-green-600 font-medium">Nada pendente!</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {pendDocs > 0 && <span className="badge bg-amber-100 text-amber-700 text-[10px] cursor-pointer" onClick={() => navigate('/colaboradores')}>{pendDocs} doc{pendDocs > 1 ? 's' : ''}</span>}
              {pendContratos > 0 && <span className="badge bg-red-100 text-red-700 text-[10px] cursor-pointer" onClick={() => navigate('/colaboradores')}>{pendContratos} contrato{pendContratos > 1 ? 's' : ''}</span>}
              {pendChat > 0 && <span className="badge bg-blue-100 text-blue-700 text-[10px] cursor-pointer" onClick={() => navigate('/chat')}><MessageSquare size={9} /> {pendChat}</span>}
              {pendExtras > 0 && <span className="badge bg-purple-100 text-purple-700 text-[10px] cursor-pointer" onClick={() => navigate('/visitas')}>{pendExtras} extra{pendExtras > 1 ? 's' : ''}</span>}
              {pendComprovantes > 0 && <span className="badge bg-gray-100 text-gray-600 text-[10px] cursor-pointer" onClick={() => navigate('/pagamentos')}>{pendComprovantes} comprovante{pendComprovantes > 1 ? 's' : ''}</span>}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        {/* ── Contratações (últimos 6 meses) + Status dos Colaboradores ── */}
        {role === 'chefe' && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <BarChart3 size={16} className="text-primary-600" />
              Contratações — Últimos 6 meses
            </h2>
            {hiringBarData.some(d => d.contratacoes > 0) ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hiringBarData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={false} tickLine={false} width={24} />
                    <Tooltip formatter={(v: number) => [v, 'Contratações']} />
                    <Bar dataKey="contratacoes" fill="#1b8552" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-sm text-gray-400 py-8">Sem contratações no período</p>
            )}
          </div>
        )}

        {role === 'chefe' && empStatusData.length > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Activity size={16} className="text-primary-600" />
              Status dos Colaboradores
            </h2>
            <div className="h-48 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={empStatusData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3} stroke="none">
                    {empStatusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-display font-extrabold text-ink-900 tnum">{employees?.length ?? 0}</span>
                <span className="text-[10px] text-ink-400">total</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Volantes ── */}
        {role === 'chefe' && volantesTotal > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-4">
              <Users size={16} className="text-orange-500" />
              Volantes
            </h2>
            <div className="h-48 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={volantesPie} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3} stroke="none">
                    {volantesPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-display font-extrabold text-ink-900 tnum">{volantesTotal}</span>
                <span className="text-[10px] text-ink-400">volantes</span>
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
                  onClick={() => navigate(`/colaboradores/${(d as { employee?: { id: string } }).employee?.id}?tab=arquivos`)}>
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
            { label: 'Novo Compromisso', path: '/agenda/nova', color: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
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
                <span className="font-semibold text-ink-800 tnum">
                  {d.value} <span className="text-ink-400 font-normal">· {Math.round((d.value / total) * 100)}%</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : <p className="text-center text-xs text-ink-400 py-10">{empty}</p>}
    </div>
  )
}
