import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  Briefcase, UserPlus, UserCheck, CheckCircle, Calendar, Plus, Download, X, Check,
  Database, FolderDown, FileWarning, Flag, Video, MapPin, ChevronRight, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase, fetchAll } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, formatCurrency, formatLocalTime, parseLocal, isMeetingLink, mapsUrl, hojeISO } from '../lib/utils'
import { addDays, startOfMonth, endOfMonth, isBefore, parseISO, isAfter, differenceInDays, subMonths } from 'date-fns'

const BACKUP_TABLES = [
  'user_profiles', 'clients', 'client_locations', 'client_units', 'client_contracts',
  'employees', 'employee_documents', 'employee_client_links', 'employee_payment_dates',
  'employee_payment_checks', 'employee_history', 'employee_expenses', 'employee_questions',
  'contracts', 'contract_templates', 'vacancies', 'vacancy_interests',
  'candidates', 'candidate_contacts', 'interviews',
  'payments', 'supervision_visits', 'inspections', 'inspection_links',
  'nutritionist_visits', 'nutritionist_agenda', 'schedule_notices', 'chat_messages',
  'shared_documents', 'link_history', 'placements_history', 'app_security',
  // Financeiro e operação — ficaram de fora até 08/2026 e o backup saía "completo" sem eles
  'financial_entries', 'financial_confirmations',
  'activity_logs', 'activity_types', 'custom_priorities',
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
  const qc = useQueryClient()
  const [backingUp, setBackingUp] = useState(false)
  const [backingUpDocs, setBackingUpDocs] = useState(false)
  const [docProgress, setDocProgress] = useState('')
  const [showBackupMenu, setShowBackupMenu] = useState(false)
  const [showPriorityForm, setShowPriorityForm] = useState(false)
  const [priorityText, setPriorityText] = useState('')
  const [priorityLevel, setPriorityLevel] = useState<'red' | 'amber'>('amber')
  const [showNovoMenu, setShowNovoMenu] = useState(false)
  const [mostrarTodos, setMostrarTodos] = useState(false)

  // Consulta que falha deixava o card em zero — visualmente igual a "não tem nada".
  // Agora todas lançam erro e este observador do cache mostra o que não carregou.
  const [failedQueries, setFailedQueries] = useState<string[]>([])
  useEffect(() => {
    const cache = qc.getQueryCache()
    const update = () => {
      const errs = Array.from(new Set(
        cache.getAll()
          .filter(q => q.state.status === 'error')
          .map(q => String(Array.isArray(q.queryKey) ? q.queryKey[0] : q.queryKey))
          .filter(k => k.startsWith('dashboard') || k === 'custom-priorities')
      )).sort()
      setFailedQueries(prev => (prev.join('|') === errs.join('|') ? prev : errs))
    }
    update()
    return cache.subscribe(update)
  }, [qc])

  const handleBackupData = async () => {
    setShowBackupMenu(false)
    setBackingUp(true)
    try {
      const backup: Record<string, unknown[]> = {}
      // Tabela que falha é pulada pra não abortar o backup inteiro — mas precisa
      // ser reportada: backup que diz "pronto" escondendo buraco é pior que erro.
      const skipped: { table: string; reason: string }[] = []
      for (const table of BACKUP_TABLES) {
        const rows: unknown[] = []
        let from = 0
        const pageSize = 1000
        let failed: string | null = null
        while (true) {
          const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1)
          if (error) { failed = error.message; console.warn(`Backup skip ${table}:`, error.message); break }
          if (!data?.length) break
          rows.push(...data)
          if (data.length < pageSize) break
          from += pageSize
        }
        if (failed) { skipped.push({ table, reason: failed }); continue }
        backup[table] = rows
      }
      backup._meta = [{
        exported_at: new Date().toISOString(),
        tables: Object.keys(backup).length,
        total_rows: Object.values(backup).reduce((s, r) => s + (r as unknown[]).length, 0),
        skipped_tables: skipped,
      }]
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `timein-backup-dados-${hojeISO()}.json`
      a.click()
      URL.revokeObjectURL(url)
      if (skipped.length) {
        toast.error(
          `Backup INCOMPLETO — ${skipped.length} tabela(s) fora: ${skipped.map(s => s.table).join(', ')}. ` +
          `Confira o campo _meta.skipped_tables no arquivo.`,
          { duration: 12000 }
        )
      } else {
        toast.success('Backup de dados exportado!')
      }
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
        toast('Nenhum documento encontrado para backup.')
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
      a.download = `timein-backup-documentos-${hojeISO()}.zip`
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
      const { data, error } = await supabase.from('employees').select('id,status,dismissal_date,full_name,birth_date,is_favorite')
      if (error) throw error
      return data || []
    },
  })

  const { data: contracts } = useQuery({
    queryKey: ['dashboard-contracts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contracts').select('id,end_date,signed,signed_at')
      if (error) throw error
      return data || []
    },
  })

  const { data: vacancies } = useQuery({
    queryKey: ['dashboard-vacancies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vacancies').select('id,status,hired_count,positions_count,title')
      if (error) throw error
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
      const { data, error } = await supabase
        .from('candidates').select('id,pipeline_stage,updated_at,full_name')
        .in('id', ids)
        .not('pipeline_stage', 'in', '("Contratado","Inativo")')
        .limit(2000)
      if (error) throw error
      return data || []
    },
  })

  const { data: vacanciesExpiring } = useQuery({
    queryKey: ['dashboard-vacancies-expiring'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancies')
        .select('id,title,deadline,hired_count,positions_count')
        .eq('status', 'Aberta')
      if (error) throw error
      return data || []
    },
  })

  const { data: clientContractsExpiring } = useQuery({
    queryKey: ['dashboard-client-contracts-expiring'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients').select('id,name,contract_end')
        .not('contract_end', 'is', null)
        .lte('contract_end', in40.toISOString().slice(0, 10))
      if (error) throw error
      return data || []
    },
  })

  const { data: pendingContractInterests } = useQuery({
    queryKey: ['dashboard-pending-contract-interests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vacancy_interests')
        .select('id,deadline,vacancy_id,candidate:candidates(full_name),vacancy:vacancies(title)')
        .eq('status', 'Em contrato').not('deadline', 'is', null)
      if (error) throw error
      return data || []
    },
  })

  const { data: employeeContractsExpiring } = useQuery({
    queryKey: ['dashboard-employee-contracts-expiring'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('id,contract_end_date,employee:employees(full_name),client:clients(name)')
        .not('contract_end_date', 'is', null)
        .lte('contract_end_date', in40.toISOString().slice(0, 10))
      if (error) throw error
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
      const { data, error } = await supabase
        .from('payments')
        .select('id,description,amount,due_date,status,employee_id,category,type')
        .gte('due_date', twoMonthsAgo)
        .lte('due_date', twoMonthsAhead)
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  const { data: pendingExpenses } = useQuery({
    queryKey: ['dashboard-pending-expenses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_expenses')
        .select('id,description,amount,employee:employees(full_name)')
        .is('receipt_url', null)
        .gte('created_at', addDays(now, -30).toISOString())
      if (error) throw error
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
      const { data, error } = await supabase.from('nutritionist_visits')
        .select('id,employee:employees(full_name),client:clients(name)')
        .eq('extra_approval', 'pendente')
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  const { data: volantesExpiring } = useQuery({
    queryKey: ['dashboard-volantes-expiring'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_client_links')
        .select('id,contract_end_date,employee:employees(full_name),client:clients(name)')
        .eq('service_type', 'Volante')
        .not('contract_end_date', 'is', null)
        .gte('contract_end_date', now.toISOString().slice(0, 10))
        .lte('contract_end_date', in15.toISOString().slice(0, 10))
      if (error) throw error
      return data || []
    },
  })

  // Contratos pendentes de anexação — Fixo/Consultoria: amarelo após 24h, vermelho após 48h
  const { data: pendingContractFiles } = useQuery({
    queryKey: ['dashboard-pending-contract-files'],
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('id,contract_file_url,service_type,employee:employees(status)')
        .neq('service_type', 'Volante')
      return (data || []).filter((l: { employee?: { status?: string } }) => l.employee?.status === 'Ativo')
    },
  })

  const { data: pendingDocs } = useQuery({
    queryKey: ['dashboard-pending-docs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_documents')
        .select('id,name,status,employee:employees(id,full_name,status)')
        .is('file_url', null)
        .eq('status', 'Pendente')
      return (data || []).filter((d: { employee?: { status?: string } }) => d.employee?.status === 'Ativo')
    },
    enabled: role === 'chefe',
  })

  // Agenda compartilhada: todo mundo vê todos os compromissos (o responsável é só informativo)
  const { data: interviews } = useQuery({
    queryKey: ['dashboard-interviews'],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews')
        .select('*,candidate:candidates(full_name),vacancy:vacancies(title),employee:employees(full_name)')
        .gte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true }).limit(8)
      if (error) throw error
      return data || []
    },
  })

  // Meus itens "a agendar" (sem data) — pra eu lembrar que preciso definir a data
  const { data: myPending } = useQuery({
    queryKey: ['dashboard-pending', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews')
        .select('id,title,category,target_month,client:clients(name)')
        .is('scheduled_at', null).eq('status', 'Agendada')
        .or(`recruiter_id.eq.${profile?.id},participant_ids.cs.{${profile?.id}}`)
      if (error) throw error
      return data || []
    },
    enabled: !!profile?.id,
  })

  // Minhas visitas com data chegando (~3 dias antes) — volta a lembrar
  const { data: myUpcomingVisits } = useQuery({
    queryKey: ['dashboard-upcoming-visits', profile?.id],
    queryFn: async () => {
      const in3 = new Date(now); in3.setDate(in3.getDate() + 3)
      const { data, error } = await supabase.from('interviews')
        .select('id,title,scheduled_at,client:clients(name)')
        .or(`recruiter_id.eq.${profile?.id},participant_ids.cs.{${profile?.id}}`)
        .eq('category', 'Visita').eq('status', 'Agendada')
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', now.toISOString()).lte('scheduled_at', in3.toISOString())
      if (error) throw error
      return data || []
    },
    enabled: !!profile?.id,
  })

  // Compromissos da semana atual — alimenta o mini calendário no topo do dashboard
  const weekStart = (() => { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d })()
  const weekEnd = (() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d })()
  const { data: weekEvents } = useQuery({
    queryKey: ['dashboard-week', weekStart.toDateString()],
    queryFn: async () => {
      const { data, error } = await supabase.from('interviews')
        .select('id,title,category,scheduled_at,status,client:clients(name)')
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', weekStart.toISOString()).lt('scheduled_at', weekEnd.toISOString())
        .neq('status', 'Cancelada')
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  // Prioridades manuais — criadas por qualquer usuário, aparecem para todos
  const { data: customPriorities } = useQuery({
    queryKey: ['custom-priorities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('custom_priorities')
        .select('*').eq('resolved', false).order('created_at', { ascending: false })
      if (error) { console.warn('custom_priorities:', error.message); return [] }
      return data || []
    },
  })

  // Minhas atividades de hoje (checklist do administrativo)
  const { data: myActivities } = useQuery({
    queryKey: ['dashboard-my-activities', profile?.id],
    queryFn: async () => {
      const today = now.toISOString().slice(0, 10)
      const { data, error } = await supabase.from('activity_logs')
        .select('id,activity_name,done').eq('user_id', profile?.id).eq('activity_date', today)
      if (error) { console.warn('activity_logs:', error.message); return [] }
      return data || []
    },
    enabled: !!profile?.id,
  })

  const addPriority = useMutation({
    mutationFn: async () => {
      if (!priorityText.trim()) throw new Error('Escreva a prioridade')
      const { error } = await supabase.from('custom_priorities').insert({
        text: priorityText.trim(),
        level: priorityLevel,
        created_by_name: profile?.full_name || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-priorities'] })
      setPriorityText(''); setPriorityLevel('amber'); setShowPriorityForm(false)
      toast.success('Prioridade criada — visível para todos.')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resolvePriority = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('custom_priorities').update({ resolved: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['custom-priorities'] }); toast.success('Prioridade concluída.') },
    onError: (e: Error) => toast.error(e.message),
  })

  // Marcar atividade feito/desfeito direto no dashboard
  const toggleActivity = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean | null }) => {
      const { error } = await supabase.from('activity_logs').update({ done }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-my-activities', profile?.id] }),
    onError: (e: Error) => toast.error(e.message),
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('employee_id,client_id,visit_date,check_in,check_out,break_start,break_end,is_unavailable')
        .gte('visit_date', monthStartStr)
        .lte('visit_date', monthEndStr)
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Visitas do mês anterior — só usadas no dia 1 para checar déficit do mês fechado
  const { data: consultoriaPrevVisits } = useQuery({
    queryKey: ['dashboard-consultoria-prev-visits', prevMonthStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nutritionist_visits')
        .select('employee_id,client_id,visit_date,check_in,check_out,break_start,break_end,is_unavailable')
        .gte('visit_date', prevMonthStartStr)
        .lte('visit_date', prevMonthEndStr)
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe' && isFirstOfMonth,
  })

  // Vínculos ativos por tipo (Consultoria × Fixo) — para o gráfico de colaboradores
  const { data: allLinks } = useQuery({
    queryKey: ['dashboard-all-links'],
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from('nutritionist_agenda')
        .select('id,planned_date')
        .gte('planned_date', monthStartStr)
        .lte('planned_date', monthEndStr)
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Agendou e não apareceu — a ÚNICA cobrança quando a frequência é "em aberto".
  // Dia planejado que já passou (1 dia de tolerância) e não virou visita registrada.
  const { data: agendaNaoCumprida } = useQuery({
    queryKey: ['dashboard-agenda-nao-cumprida'],
    queryFn: async () => {
      const ontem = new Date(now); ontem.setDate(ontem.getDate() - 1)
      const ate = ontem.toISOString().slice(0, 10)
      const desde = new Date(now); desde.setDate(desde.getDate() - 30)
      const de = desde.toISOString().slice(0, 10)

      const { data: planejados, error } = await supabase
        .from('nutritionist_agenda')
        .select('id,planned_date,employee_id,client_id,employee:employees(id,full_name,status),client:clients(name)')
        .gte('planned_date', de).lte('planned_date', ate)
      if (error) throw error
      if (!planejados?.length) return []

      // Paginado: 30 dias de visitas passa de 1000 linhas conforme a equipe cresce,
      // e o Supabase corta em silencio — o alerta passaria a acusar quem foi.
      const feitas = await fetchAll<{ employee_id: string; client_id: string; visit_date: string }>(
        () => supabase.from('nutritionist_visits')
          .select('employee_id,client_id,visit_date')
          .gte('visit_date', de).lte('visit_date', ate))

      // Conta como cumprida a visita da mesma pessoa, no mesmo cliente, no mesmo dia
      const feitasSet = new Set(feitas.map(v => `${v.employee_id}|${v.client_id}|${v.visit_date}`))
      // Falta avisada (atestado/troca) não é cobrança
      const { data: avisos } = await supabase
        .from('schedule_notices')
        .select('employee_id,client_id,notice_date')
        .gte('notice_date', de).lte('notice_date', ate)
      const avisadas = new Set((avisos || []).map(n => `${n.employee_id}|${n.client_id}|${n.notice_date}`))

      return planejados
        .filter(a => (a as { employee?: { status?: string } }).employee?.status === 'Ativo')
        .filter(a => {
          const chave = `${a.employee_id}|${a.client_id}|${a.planned_date}`
          return !feitasSet.has(chave) && !avisadas.has(chave)
        })
    },
  })

  // Vínculo que exige contrato assinado e está sem o arquivo. Enquanto isso o
  // portal da pessoa não abre, então é pendência que trava o trabalho dela.
  const { data: contratosVinculoPendentes } = useQuery({
    queryKey: ['dashboard-contrato-vinculo-pendente'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('id,contract_deadline,employee:employees(id,full_name,status),client:clients(name)')
        .eq('contract_required', true)
        .is('contract_file_url', null)
      if (error) throw error
      return (data || []).filter(l => (l as { employee?: { status?: string } }).employee?.status === 'Ativo')
    },
  })

  // Documento com validade chegando. 10 dias porque há contrato de 30 dias —
  // avisar com 30/40 dispararia antes do documento sequer começar a valer.
  const { data: docsVencendo } = useQuery({
    queryKey: ['dashboard-docs-vencendo'],
    queryFn: async () => {
      const em10 = new Date(now); em10.setDate(em10.getDate() + 10)
      const { data, error } = await supabase
        .from('employee_documents')
        .select('id,name,expires_at,employee:employees(id,full_name,status)')
        .not('expires_at', 'is', null)
        .lte('expires_at', em10.toISOString().slice(0, 10))
      if (error) throw error
      return (data || []).filter(d => (d as { employee?: { status?: string } }).employee?.status === 'Ativo')
    },
  })

  // Contratado mas sem vínculo nenhum. A contratação pela vaga agora cria só a
  // pessoa e manda definir o vínculo na ficha — se pararem no meio, ela fica
  // fora da folha e do portal sem ninguém perceber.
  const { data: semVinculo } = useQuery({
    queryKey: ['dashboard-contratado-sem-vinculo'],
    queryFn: async () => {
      const { data: emps, error } = await supabase
        .from('employees').select('id,full_name,created_at').eq('status', 'Ativo')
      if (error) throw error
      if (!emps?.length) return []
      const { data: links } = await supabase.from('employee_client_links').select('employee_id')
      const comVinculo = new Set((links || []).map(l => l.employee_id))
      // 1 dia de tolerância: dá tempo de concluir o cadastro sem alarme falso
      const ontem = new Date(now); ontem.setDate(ontem.getDate() - 1)
      return emps.filter(e => !comVinculo.has(e.id) && new Date(e.created_at) < ontem)
    },
  })

  // Ela não seguiu o combinado da agenda: trocou o dia, ou fez uma visita a mais.
  // Nos dois casos o RH precisa saber — foi ela que decidiu, não o RH.
  const { data: fugasDoCombinado } = useQuery({
    queryKey: ['dashboard-fora-do-combinado'],
    queryFn: async () => {
      const desde = new Date(now); desde.setDate(desde.getDate() - 30)
      const de = desde.toISOString().slice(0, 10)
      const ate = now.toISOString().slice(0, 10)

      // Trocas: a agenda guarda o dia original quando ela declara a troca
      const { data: trocadas } = await supabase
        .from('nutritionist_agenda')
        .select('id,planned_date,original_date,rescheduled_at,employee_id,employee:employees(id,full_name,status),client:clients(name)')
        .not('rescheduled_at', 'is', null)
        .gte('planned_date', de)

      // Visitas registradas em dia que não estava na agenda daquele cliente
      const feitas = await fetchAll<{ id: string; visit_date: string; employee_id: string; client_id: string; employee?: { id: string; full_name: string; status?: string }; client?: { name: string } }>(
        () => supabase.from('nutritionist_visits')
          .select('id,visit_date,employee_id,client_id,employee:employees(id,full_name,status),client:clients(name)')
          .gte('visit_date', de).lte('visit_date', ate)
          .not('check_out', 'is', null))
      const { data: planejadas } = await supabase
        .from('nutritionist_agenda')
        .select('employee_id,client_id,planned_date,created_by_admin')
        .gte('planned_date', de)
      const combinadas = new Set((planejadas || []).map(a => `${a.employee_id}|${a.client_id}|${a.planned_date}`))
      // Só existe "fora do combinado" onde o RH monta a agenda. Quem monta a
      // própria não tem combinado a quebrar — senão cada visita dela viraria alerta.
      const temCombinado = new Set(
        (planejadas || []).filter(a => a.created_by_admin).map(a => `${a.employee_id}|${a.client_id}`))

      return {
        trocas: (trocadas || []).filter(a =>
          (a as { employee?: { status?: string } }).employee?.status === 'Ativo'
          && a.original_date && a.original_date !== a.planned_date),
        aMais: feitas.filter(v =>
          (v as { employee?: { status?: string } }).employee?.status === 'Ativo'
          && temCombinado.has(`${v.employee_id}|${v.client_id}`)
          && !combinadas.has(`${v.employee_id}|${v.client_id}|${v.visit_date}`)),
      }
    },
  })

  // Documentos entregues (com arquivo) — para o gráfico de documentos
  const { data: deliveredDocsCount } = useQuery({
    queryKey: ['dashboard-delivered-docs'],
    queryFn: async () => {
      const { data, error } = await supabase
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
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('id,created_at')
        .gte('created_at', from)
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  // Volantes: vínculos ativos para saber quais estão atuando
  const { data: volanteLinks } = useQuery({
    queryKey: ['dashboard-volante-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_client_links')
        .select('employee_id,contract_end_date')
        .eq('service_type', 'Volante')
      if (error) throw error
      return data || []
    },
    enabled: role === 'chefe',
  })

  // ── Derived ──────────────────────────────────────────────────────────────────
  const activeEmployees = employees?.filter(e => e.status === 'Ativo').length ?? 0
  const totalEmployees = employees?.length ?? 0
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

  // 'Novo' e 'Em contato' não existem no sistema — os nomes são 'Em Avaliação' e
  // 'Contato Feito'. O contador vinha ignorando essas duas etapas há tempo.
  const inProcess = candidates?.filter(c =>
    ['Em Avaliação', 'Contato Feito', 'Entrevista Agendada', 'Aprovado', 'Em Processo de Contratação'].includes(c.pipeline_stage)
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
    { name: 'Fixo', value: allLinks?.filter(l => l.service_type !== 'Consultoria' && l.service_type !== 'Volante').length ?? 0, color: '#3b82f6' },
    { name: 'Freela', value: allLinks?.filter(l => l.service_type === 'Volante').length ?? 0, color: '#a855f7' },
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

  // Freelas: atuando (com link ativo) vs. favoritos disponíveis
  const today = now.toISOString().slice(0, 10)
  const freelaAtuandoIds = new Set(
    (volanteLinks || [])
      .filter(l => !l.contract_end_date || l.contract_end_date >= today)
      .map(l => l.employee_id)
  )
  const freelaAtuando = freelaAtuandoIds.size
  const favoritosDisp = (employees || []).filter(e =>
    (e as { is_favorite?: boolean }).is_favorite && e.status !== 'Inativo' && !freelaAtuandoIds.has(e.id)
  ).length
  const freelasPie = [
    { name: 'Atuando', value: freelaAtuando, color: '#a855f7' },
    { name: 'Favoritos livres', value: favoritosDisp, color: '#22c55e' },
  ].filter(d => d.value > 0)
  const freelasTotal = freelasPie.reduce((s, d) => s + d.value, 0)

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

  type AlertItem = { text: string; action?: string; path?: string; key?: string; customId?: string }
  const redAlerts: AlertItem[] = []
  const amberAlerts: AlertItem[] = []

  // Prioridades manuais entram no topo da lista (vermelho ou amarelo conforme criadas)
  ;(customPriorities || []).forEach(p => {
    const item: AlertItem = { text: `${p.text}`, key: `custom-${p.id}`, customId: p.id }
    if (p.level === 'red') redAlerts.push(item)
    else amberAlerts.push(item)
  })

  // Meus itens sem data ainda — lembrete pra DEFINIR A DATA (fica até resolver)
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  ;(myPending || []).forEach(p => {
    const isVisita = (p as { category?: string }).category === 'Visita'
    const cli = (p as { client?: { name: string } }).client?.name
    const tm = (p as { target_month?: string }).target_month
    const mesTxt = tm ? ` (${MESES[Number(String(tm).slice(5, 7)) - 1]}/${String(tm).slice(0, 4)})` : ''
    amberAlerts.push({
      text: `Definir data d${isVisita ? 'a visita' : 'o compromisso'}: "${p.title || 'Compromisso'}"${cli ? ` — ${cli}` : ''}${mesTxt}`,
      path: '/agenda',
    })
  })

  // Trocou o dia combinado
  ;(fugasDoCombinado?.trocas || []).forEach(a => {
    const nome = (a as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const empId = (a as { employee?: { id: string } }).employee?.id
    const cli = (a as { client?: { name: string } }).client?.name
    amberAlerts.push({
      text: `${nome} trocou a visita de ${formatDate(a.original_date)} para ${formatDate(a.planned_date)}${cli ? ` — ${cli}` : ''}`,
      path: empId ? `/colaboradores/${empId}?tab=agenda` : '/visitas',
      key: `troca-${a.id}-${a.planned_date}`,
    })
  })

  // Fez visita em dia que não estava combinado
  ;(fugasDoCombinado?.aMais || []).forEach(v => {
    const nome = (v as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const empId = (v as { employee?: { id: string } }).employee?.id
    const cli = (v as { client?: { name: string } }).client?.name
    amberAlerts.push({
      text: `${nome} registrou visita fora do combinado em ${formatDate(v.visit_date)}${cli ? ` — ${cli}` : ''}`,
      path: empId ? `/colaboradores/${empId}?tab=visitas` : '/visitas',
      key: `fora-combinado-${v.id}`,
    })
  })

  // Contratado e sem vínculo: fica fora da folha e do portal
  ;(semVinculo || []).forEach(e => {
    amberAlerts.push({
      text: `${e.full_name} está cadastrada mas não está em nenhum cliente — não entra na folha nem no portal`,
      path: `/colaboradores/${e.id}?tab=vinculos`,
      key: `sem-vinculo-${e.id}`,
    })
  })

  // Contrato exigido e não anexado — o portal da pessoa fica bloqueado até lá
  ;(contratosVinculoPendentes || []).forEach(l => {
    const nome = (l as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const empId = (l as { employee?: { id: string } }).employee?.id
    const cli = (l as { client?: { name: string } }).client?.name
    const prazo = l.contract_deadline ? new Date(l.contract_deadline) : null
    const venceu = prazo ? prazo.getTime() < now.getTime() : false
    const texto = `Contrato de ${nome}${cli ? ` — ${cli}` : ''} ainda não foi anexado`
      + (venceu ? ' — prazo VENCIDO' : prazo ? ` — prazo até ${formatDate(prazo.toISOString().slice(0, 10))}` : '')
      + '. O portal dela está bloqueado.'
    const item = { text: texto, path: empId ? `/colaboradores/${empId}` : '/colaboradores', key: `contrato-vinculo-${l.id}` }
    if (venceu) redAlerts.push(item)
    else amberAlerts.push(item)
  })

  // Documento vencendo (10 dias) ou já vencido
  ;(docsVencendo || []).forEach(d => {
    const nome = (d as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const empId = (d as { employee?: { id: string } }).employee?.id
    const dias = Math.ceil((new Date(d.expires_at + 'T12:00:00').getTime() - now.getTime()) / 86400000)
    const item = {
      text: dias < 0
        ? `${d.name} de ${nome} venceu há ${Math.abs(dias)} dia(s)`
        : `${d.name} de ${nome} vence ${dias === 0 ? 'hoje' : `em ${dias} dia(s)`} (${formatDate(d.expires_at)})`,
      path: empId ? `/colaboradores/${empId}?tab=arquivos` : '/colaboradores',
      key: `doc-vence-${d.id}`,
    }
    if (dias < 0) redAlerts.push(item)
    else amberAlerts.push(item)
  })

  // Agendou e não apareceu. É a única cobrança de quem está com frequência
  // "em aberto": mês sem visita é normal, mas dia marcado que não aconteceu não.
  ;(agendaNaoCumprida || []).forEach(a => {
    const nome = (a as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const empId = (a as { employee?: { id: string } }).employee?.id
    const cli = (a as { client?: { name: string } }).client?.name
    const dias = Math.max(1, Math.round((now.getTime() - new Date(a.planned_date + 'T12:00:00').getTime()) / 86400000))
    amberAlerts.push({
      text: `${nome} tinha visita marcada em ${formatDate(a.planned_date)}${cli ? ` — ${cli}` : ''} e não registrou (há ${dias}d)`,
      path: empId ? `/colaboradores/${empId}` : '/visitas',
      key: `agenda-nao-cumprida-${a.id}`,
    })
  })

  // Minhas visitas chegando (~3 dias) — volta a lembrar
  ;(myUpcomingVisits || []).forEach(v => {
    const d = new Date(v.scheduled_at as string)
    const dias = Math.max(0, Math.ceil((d.getTime() - now.getTime()) / 86400000))
    const cli = (v as { client?: { name: string } }).client?.name
    amberAlerts.push({
      text: `Visita ${dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`}: "${v.title || 'Visita'}"${cli ? ` — ${cli}` : ''}`,
      path: '/agenda',
    })
  })

  overdue.forEach(p =>
    redAlerts.push({ text: `Pagamento atrasado: ${p.description} — ${formatCurrency(p.amount)}`, path: '/pagamentos' })
  )
  // Candidato escolhido numa vaga, contrato enviado e ainda não assinado.
  // Não é o contrato de trabalho vencendo — é o PRAZO DE ASSINATURA.
  pendingContractInterests?.forEach(pc => {
    const deadline = pc.deadline ? new Date(pc.deadline) : null
    const hoursLeft = deadline ? Math.round((deadline.getTime() - Date.now()) / 3600000) : null
    const candidateName = (pc as { candidate?: { full_name: string } }).candidate?.full_name || 'Candidato'
    const vagaTitle = (pc as { vacancy?: { title: string } }).vacancy?.title
    const vagaId = (pc as { vacancy_id?: string }).vacancy_id
    // "venceu há 169h" não diz nada — acima de 2 dias a pessoa pensa em dias
    const humanize = (h: number) => {
      const a = Math.abs(h)
      return a >= 48 ? `${Math.round(a / 24)} dias` : `${a}h`
    }
    // Leva direto pra vaga; sem isso caía na lista de 13 vagas sem dizer qual
    const path = vagaId ? `/vagas/${vagaId}` : '/vagas'
    const ondeVaga = vagaTitle ? ` na vaga "${vagaTitle}"` : ''
    // key permite marcar como resolvido/dispensar. Sem isso o alerta ficava preso
    // pra sempre quando a contratação acontecia por fora do fluxo da vaga.
    const key = `contract-${pc.id}`
    const isOverdue = hoursLeft !== null && hoursLeft < 0
    if (isOverdue)
      redAlerts.push({
        text: `${candidateName} não devolveu o contrato assinado${ondeVaga} — prazo venceu há ${humanize(hoursLeft!)}`,
        path, key,
      })
    else
      amberAlerts.push({
        text: `Aguardando ${candidateName} assinar o contrato${ondeVaga} — faltam ${humanize(hoursLeft!)}`,
        path, key,
      })
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
    const name = (l as { employee?: { full_name: string } }).employee?.full_name || 'Colaborador'
    const client = (l as { client?: { name: string } }).client?.name || ''
    const when = days === 0 ? 'vence hoje!' : `faltam ${days}d`
    amberAlerts.push({ text: `Freela: ${name}${client ? ' – ' + client : ''} — ${when}`, path: '/colaboradores' })
  })

  // Aniversários dos colaboradores — só hoje e amanhã (avisa 1 dia antes) 
  employees?.forEach(e => {
    const bd = (e as { birth_date?: string }).birth_date
    if (!bd || e.status === 'Inativo') return
    const [, bm, bdd] = bd.split('-').map(Number)
    if (!bm || !bdd) return
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let next = new Date(now.getFullYear(), bm - 1, bdd)
    if (next < todayMid) next = new Date(now.getFullYear() + 1, bm - 1, bdd)
    const days = Math.round((next.getTime() - todayMid.getTime()) / 86400000)
    if (days > 1) return
    const when = days === 0 ? 'é hoje' : days === 1 ? 'é amanhã' : `${String(bdd).padStart(2, '0')}/${String(bm).padStart(2, '0')} — em ${days} dias`
    amberAlerts.push({
      key: `bday-${e.id}-${next.getFullYear()}`,
      text: `Aniversário de ${e.full_name} ${when}`,
      path: `/colaboradores/${e.id}`,
    })
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
  // Agrupa alerta repetitivo. Cada fonte gera UMA linha por registro; com a base
  // crescendo, "visita fora do combinado" e afins viram dezenas de linhas iguais
  // e afogam o que é único e urgente. A partir de 4 do mesmo tipo, vira resumo.
  const LIMITE_POR_TIPO = 3
  const agrupar = (lista: AlertItem[]): AlertItem[] => {
    const porTipo: Record<string, AlertItem[]> = {}
    const soltos: AlertItem[] = []
    for (const a of lista) {
      // O prefixo da key identifica a família (ex: "fora-combinado-<id>")
      const familia = a.key?.replace(/-[0-9a-f-]{8,}.*$/i, '') || ''
      if (!familia) { soltos.push(a); continue }
      ;(porTipo[familia] ||= []).push(a)
    }
    const saida = [...soltos]
    for (const [familia, itens] of Object.entries(porTipo)) {
      if (itens.length <= LIMITE_POR_TIPO) { saida.push(...itens); continue }
      saida.push(...itens.slice(0, LIMITE_POR_TIPO))
      saida.push({
        text: `+ ${itens.length - LIMITE_POR_TIPO} situação(ões) do mesmo tipo — abrir para ver todas`,
        path: itens[0].path,
        key: `resumo-${familia}`,
      })
    }
    return saida
  }

  const filteredRed = agrupar(redAlerts.filter(a => !isHidden(a)))
  const filteredAmber = agrupar(amberAlerts.filter(a => !isHidden(a)))
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

  // Lista única "Precisa de atenção": crítico primeiro, com um pontinho de cor.
  // Antes eram duas faixas coloridas (vermelha e amarela) disputando a tela.
  const atencao = [
    ...filteredRed.map(a => ({ ...a, nivel: 'red' as const })),
    ...filteredAmber.map(a => ({ ...a, nivel: 'amber' as const })),
  ]
  const atencaoVisivel = mostrarTodos ? atencao : atencao.slice(0, 7)

  // Agenda: o que tem hoje e o resumo da semana
  const hojeEventos = (interviews || []).filter((i: { scheduled_at: string }) => {
    const d = parseLocal(i.scheduled_at) ?? new Date(i.scheduled_at)
    return d.toDateString() === now.toDateString()
  })
  const proximosEventos = hojeEventos.length ? hojeEventos : (interviews || []).slice(0, 3)
  const eventosSemana = (weekEvents || []).length

  // Panorama em barras de uma linha (antes: 5 gráficos de rosca lado a lado)
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const vagasPreenchidas = (vacancies || []).filter(v => v.status === 'Preenchida' || v.status === 'Atuando').length
  const visitasRealizadas = visitasPie.find(p => p.name === 'Realizadas')?.value ?? 0
  const visitasPlanejadas = visitasPie.find(p => p.name === 'Planejadas')?.value ?? 0
  const panorama = [
    { rotulo: 'Contratos anexados', valor: `${contratosAnexados}/${contratosAnexados + contratosPendentes}`, p: pct(contratosAnexados, contratosAnexados + contratosPendentes), caminho: '/colaboradores' },
    ...(role === 'chefe' ? [{ rotulo: 'Documentos entregues', valor: `${pct(deliveredDocsCount ?? 0, (deliveredDocsCount ?? 0) + (pendingDocs?.length ?? 0))}%`, p: pct(deliveredDocsCount ?? 0, (deliveredDocsCount ?? 0) + (pendingDocs?.length ?? 0)), caminho: '/colaboradores' }] : []),
    { rotulo: 'Vagas preenchidas', valor: `${vagasPreenchidas}/${vacancies?.length ?? 0}`, p: pct(vagasPreenchidas, vacancies?.length ?? 0), caminho: '/vagas' },
    ...(role === 'chefe' ? [{ rotulo: 'Visitas do mês', valor: `${visitasRealizadas} de ${Math.max(visitasRealizadas, visitasPlanejadas)}`, p: pct(visitasRealizadas, Math.max(visitasRealizadas, visitasPlanejadas)), caminho: '/visitas' }] : []),
  ]
  const maxContratacoes = Math.max(1, ...hiringBarData.map(h => h.contratacoes))

  const ATALHOS = [
    { label: 'Colaborador', path: '/colaboradores/novo', icon: UserCheck },
    { label: 'Vaga', path: '/vagas/nova', icon: Briefcase },
    { label: 'Candidato', path: '/candidatos/novo', icon: UserPlus },
    { label: 'Compromisso', path: '/agenda/nova', icon: Calendar },
    { label: 'Contrato', path: '/contratos/novo', icon: FileText },
  ]

  const Kpi = ({ rotulo, valor, sub, subCor, onClick, extra }: {
    rotulo: string; valor: number | string; sub?: React.ReactNode; subCor?: string; onClick?: () => void; extra?: React.ReactNode
  }) => (
    <button onClick={onClick} className="text-left p-4 md:px-5 hover:bg-ink-50/60 transition-colors min-w-0">
      <p className="text-xs text-ink-500">{rotulo}</p>
      <div className="flex items-end justify-between gap-2 mt-1">
        <p className="text-2xl md:text-[28px] font-semibold text-ink-900 tnum leading-none">{valor}</p>
        {extra}
      </div>
      {sub && <p className={`text-xs mt-1.5 truncate ${subCor || 'text-ink-400'}`}>{sub}</p>}
    </button>
  )

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Cabeçalho: data, saudação em serifa e ações */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-400 first-letter:uppercase">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="page-title mt-1">{greeting}{firstName ? <>, <em className="text-primary-700">{firstName}</em></> : ''}</h1>
        </div>
        <div className="flex items-center gap-2">
          {role === 'chefe' && (
            <div className="relative">
              <button
                onClick={() => setShowBackupMenu(p => !p)}
                disabled={backingUp || backingUpDocs}
                className="btn-ghost text-sm"
                title="Backup"
              >
                <Download size={15} />
                <span className={backingUp || backingUpDocs ? '' : 'hidden sm:inline'}>{backingUp ? 'Exportando dados...' : backingUpDocs ? docProgress || 'Exportando docs...' : 'Backup'}</span>
              </button>
              {showBackupMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBackupMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 w-72 bg-white rounded-xl shadow-lift border border-ink-200 overflow-hidden">
                    <button onClick={handleBackupData} className="w-full flex items-start gap-3 px-4 py-3 hover:bg-ink-50 transition-colors text-left">
                      <Database size={16} className="text-ink-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-ink-900">Backup do sistema</p>
                        <p className="text-xs text-ink-400 mt-0.5">Todos os dados em JSON</p>
                      </div>
                    </button>
                    <div className="border-t border-ink-100" />
                    <button onClick={handleBackupDocs} className="w-full flex items-start gap-3 px-4 py-3 hover:bg-ink-50 transition-colors text-left">
                      <FolderDown size={16} className="text-ink-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-ink-900">Backup dos documentos</p>
                        <p className="text-xs text-ink-400 mt-0.5">PDFs, contratos, comprovantes e fotos em ZIP</p>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {/* "+ Novo": os atalhos num lugar só */}
          <div className="relative">
            <button onClick={() => setShowNovoMenu(v => !v)} className="btn-primary text-sm">
              <Plus size={16} />Novo
            </button>
            {showNovoMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowNovoMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 w-52 bg-white rounded-xl shadow-lift border border-ink-200 p-1">
                  {ATALHOS.map(a => (
                    <button key={a.path} onClick={() => { setShowNovoMenu(false); navigate(a.path) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-ink-800 hover:bg-ink-50 text-left">
                      <a.icon size={16} className="text-ink-400" />{a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Algo não carregou — sem isto o card ficaria em zero sem avisar ninguém */}
      {failedQueries.length > 0 && (
        <div className="card p-4 border-red-200 bg-red-50 flex items-start gap-3">
          <FileWarning size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-800">
              {failedQueries.length > 1 ? `${failedQueries.length} informações não carregaram` : '1 informação não carregou'}
            </p>
            <p className="text-xs text-red-600 mt-0.5">Alguns números abaixo podem estar incompletos. Recarregue a página; se continuar, avise o suporte.</p>
          </div>
          <button onClick={() => qc.refetchQueries()} className="btn-secondary text-xs flex-shrink-0">Tentar de novo</button>
        </div>
      )}

      {/* Números principais numa faixa só, com linhas finas */}
      <div className="card grid grid-cols-2 lg:grid-cols-4 divide-ink-100 [&>*]:border-ink-100 [&>*:nth-child(2n)]:border-l lg:[&>*:not(:first-child)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+3)]:border-t-0 overflow-hidden">
        <Kpi rotulo="Colaboradores ativos" valor={activeEmployees}
          sub={linksThisMonth > 0 ? `+${linksThisMonth} no mês${dismissedThisMonth > 0 ? ` · −${dismissedThisMonth}` : ''}` : `de ${totalEmployees} cadastrados`}
          subCor={linksThisMonth > 0 ? 'text-green-700' : undefined}
          onClick={() => navigate('/colaboradores')}
          extra={
            // Minigráfico: contratações dos últimos 6 meses
            <svg width="56" height="24" viewBox="0 0 56 24" className="shrink-0" aria-hidden="true">
              {hiringBarData.map((h, i) => {
                const alt = Math.max(2, Math.round((h.contratacoes / maxContratacoes) * 22))
                return <rect key={i} x={i * 9.6} y={24 - alt} width="6" height={alt} rx="1.5" fill={i === hiringBarData.length - 1 ? '#1b8552' : '#d3d2cd'} />
              })}
            </svg>
          } />
        <Kpi rotulo="Vagas abertas" valor={openVacancies}
          sub={openPositions > 0 ? `${openPositions} posição${openPositions > 1 ? 'ões' : ''} a preencher` : `${filledVacancies} preenchidas`}
          onClick={() => navigate('/vagas')} />
        <Kpi rotulo="Em processo" valor={inProcess}
          sub={(approvedCount ?? 0) > 0 ? `${approvedCount} aprovado${approvedCount! > 1 ? 's' : ''} para alocar` : 'candidatos'}
          subCor={(approvedCount ?? 0) > 0 ? 'text-primary-700' : undefined}
          onClick={() => navigate('/candidatos')} />
        <Kpi rotulo="Pendências" valor={pendenciasCount}
          sub={pendenciasCount === 0 ? 'nada pendente' : [
            pendDocs && `${pendDocs} doc`, pendContratos && `${pendContratos} contrato`, pendExtras && `${pendExtras} extra`,
            pendComprovantes && `${pendComprovantes} comprov.`, pendChat && `${pendChat} chat`,
          ].filter(Boolean).join(' · ')}
          subCor={pendenciasCount > 0 ? 'text-amber-700' : 'text-green-700'}
          onClick={() => navigate(pendExtras ? '/visitas' : pendChat ? '/chat' : '/colaboradores')} />
      </div>

      {/* Precisa de atenção + Hoje */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-start">
        <section className="lg:col-span-3 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-title">
              Precisa de atenção
              {atencao.length > 0 && <span className="text-ink-400 font-normal tnum">{atencao.length}</span>}
            </h2>
            <button onClick={() => setShowPriorityForm(v => !v)} className="btn-ghost text-xs px-2 py-1">
              <Flag size={13} /> Criar
            </button>
          </div>

          {showPriorityForm && (
            <div className="card p-3 space-y-2.5 mb-3">
              <input
                className="input text-sm"
                placeholder="Ex.: ligar para o cliente X sobre a renovação"
                value={priorityText}
                autoFocus
                onChange={e => setPriorityText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && priorityText.trim()) addPriority.mutate() }}
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex gap-1.5">
                  <button onClick={() => setPriorityLevel('amber')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${priorityLevel === 'amber' ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-ink-200 text-ink-500'}`}>
                    <span className="dot bg-amber-500" />Atenção
                  </button>
                  <button onClick={() => setPriorityLevel('red')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${priorityLevel === 'red' ? 'border-red-400 bg-red-50 text-red-800' : 'border-ink-200 text-ink-500'}`}>
                    <span className="dot bg-red-600" />Crítico
                  </button>
                </div>
                <div className="flex gap-1.5 ml-auto">
                  <button onClick={() => { setShowPriorityForm(false); setPriorityText('') }} className="btn-ghost text-xs">Cancelar</button>
                  <button onClick={() => addPriority.mutate()} disabled={!priorityText.trim() || addPriority.isPending} className="btn-primary text-xs py-1.5">
                    {addPriority.isPending ? 'Criando...' : 'Criar'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-ink-400">Aparece para toda a equipe até alguém concluir.</p>
            </div>
          )}

          {atencao.length === 0 ? (
            <div className="card px-4 py-6 flex items-center gap-3">
              <CheckCircle size={20} className="text-primary-700 shrink-0" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-medium text-ink-900">Tudo em dia</p>
                <p className="text-xs text-ink-500">Nenhuma pendência urgente agora{resolvedCount > 0 ? ` · ${resolvedCount} resolvida${resolvedCount > 1 ? 's' : ''} hoje` : ''}.</p>
              </div>
            </div>
          ) : (
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {atencaoVisivel.map((a, i) => (
                <div key={a.key || i} className="flex items-center gap-3 px-4 py-3 group">
                  <span className={`dot ${a.nivel === 'red' ? 'bg-red-600' : 'bg-amber-500'}`} />
                  <p className={`text-sm text-ink-800 flex-1 min-w-0 ${a.path ? 'cursor-pointer hover:text-ink-950' : ''}`}
                    onClick={() => a.path && navigate(a.path)}>{a.text}</p>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {a.customId ? (
                      <button onClick={() => resolvePriority.mutate(a.customId!)} className="p-1.5 rounded-md text-ink-400 hover:text-green-700 hover:bg-green-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity" title="Concluir">
                        <Check size={15} />
                      </button>
                    ) : a.key && (
                      <>
                        <button onClick={() => resolveAlert(a.key!)} className="p-1.5 rounded-md text-ink-400 hover:text-green-700 hover:bg-green-50 md:opacity-0 md:group-hover:opacity-100 transition-opacity" title="Marcar como resolvido">
                          <Check size={15} />
                        </button>
                        <button onClick={() => dismissAlert(a.key!)} className="p-1.5 rounded-md text-ink-400 hover:text-ink-700 hover:bg-ink-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" title="Dispensar">
                          <X size={15} />
                        </button>
                      </>
                    )}
                    {a.path && (
                      <button onClick={() => navigate(a.path!)} className="p-1.5 rounded-md text-ink-300 hover:text-ink-700" aria-label="Abrir">
                        <ChevronRight size={15} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {atencao.length > 7 && (
                <button onClick={() => setMostrarTodos(!mostrarTodos)} className="w-full px-4 py-2.5 text-xs font-medium text-ink-500 hover:bg-ink-50 text-left">
                  {mostrarTodos ? 'Mostrar menos' : `Ver mais ${atencao.length - 7}`}
                </button>
              )}
            </div>
          )}
          {resolvedCount > 0 && atencao.length > 0 && (
            <p className="text-xs text-ink-400 mt-2">
              {resolvedCount} resolvida{resolvedCount > 1 ? 's' : ''} ·{' '}
              <button onClick={() => { setResolvedAlerts(new Set()); try { localStorage.removeItem('timein_resolved_alerts') } catch { /* sem armazenamento */ } }}
                className="underline hover:text-ink-600">limpar</button>
            </p>
          )}
        </section>

        <section className="lg:col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-title">{hojeEventos.length ? 'Hoje' : 'Próximos compromissos'}</h2>
            <button onClick={() => navigate('/calendario')} className="text-xs text-ink-500 hover:text-ink-800">Calendário <ChevronRight size={12} className="inline" /></button>
          </div>
          <div className="card divide-y divide-ink-100 overflow-hidden">
            {proximosEventos.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-ink-500">Nada marcado</p>
                <button onClick={() => navigate('/agenda/nova')} className="text-xs text-primary-700 font-medium hover:underline mt-1">Agendar compromisso</button>
              </div>
            ) : proximosEventos.map((i: { id: string; title?: string; candidate?: { full_name: string }; employee?: { full_name: string }; scheduled_at: string; modality?: string; link_or_address?: string }) => {
              const d = parseLocal(i.scheduled_at) ?? new Date(i.scheduled_at)
              const eHoje = d.toDateString() === now.toDateString()
              return (
                <div key={i.id} className="flex gap-3 px-4 py-3 cursor-pointer hover:bg-ink-50/60" onClick={() => navigate('/agenda')}>
                  <div className="w-12 shrink-0 text-right">
                    <p className="text-sm font-medium text-ink-900 tnum">{formatLocalTime(i.scheduled_at)}</p>
                    {!eHoje && <p className="text-[11px] text-ink-400">{d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}</p>}
                  </div>
                  <div className="flex-1 min-w-0 border-l border-ink-100 pl-3">
                    <p className="text-sm text-ink-900 truncate">{i.title || i.candidate?.full_name || 'Compromisso'}</p>
                    <p className="text-xs text-ink-400 truncate">
                      {[i.modality, i.employee?.full_name, i.candidate?.full_name].filter(Boolean).join(' · ')}
                    </p>
                    {i.link_or_address && (
                      isMeetingLink(i.link_or_address) ? (
                        <a href={i.link_or_address} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-primary-700 hover:underline">
                          <Video size={12} /> Entrar na reunião
                        </a>
                      ) : (
                        <a href={mapsUrl(i.link_or_address)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-ink-500 hover:underline max-w-full">
                          <MapPin size={11} className="flex-shrink-0" /><span className="truncate">{i.link_or_address}</span>
                        </a>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-ink-400 mt-2">
            Esta semana: {eventosSemana} compromisso{eventosSemana !== 1 ? 's' : ''} ·{' '}
            <button onClick={() => navigate('/agenda')} className="underline hover:text-ink-600">ver reuniões</button>
          </p>
        </section>
      </div>

      {/* Atividades + Panorama */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 items-start">
        {(myActivities?.length ?? 0) > 0 && (() => {
          const total = myActivities!.length
          const feitas = myActivities!.filter(a => (a as { done?: boolean }).done === true).length
          return (
            <section className="lg:col-span-3 min-w-0">
              <div className="flex items-center justify-between mb-2">
                <h2 className="section-title">Minhas atividades de hoje</h2>
                <span className="text-xs text-ink-400 tnum">{feitas} de {total}</span>
              </div>
              <div className="card p-4">
                <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden mb-3">
                  <div className="h-1.5 rounded-full bg-primary-600 transition-all duration-500" style={{ width: `${pct(feitas, total)}%` }} />
                </div>
                <div className="space-y-0.5">
                  {myActivities!.slice(0, 7).map(a => {
                    const done = (a as { done?: boolean }).done === true
                    return (
                      <button key={a.id}
                        onClick={() => toggleActivity.mutate({ id: a.id, done: done ? null : true })}
                        className="w-full flex items-center gap-2.5 text-sm text-left py-1.5 rounded-md hover:bg-ink-50 px-1 -mx-1">
                        <span className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center shrink-0 transition-colors ${done ? 'bg-primary-600 border-primary-600' : 'border-ink-300'}`}>
                          {done && <Check size={11} className="text-white" strokeWidth={3} />}
                        </span>
                        <span className={`truncate ${done ? 'text-ink-400 line-through' : 'text-ink-800'}`}>{(a as { activity_name: string }).activity_name}</span>
                      </button>
                    )
                  })}
                  {total > 7 && (
                    <button onClick={() => navigate('/atividades')} className="text-xs text-ink-500 hover:text-ink-800 pt-1">+{total - 7} atividade(s) · abrir</button>
                  )}
                </div>
              </div>
            </section>
          )
        })()}

        <section className={`${(myActivities?.length ?? 0) > 0 ? 'lg:col-span-2' : 'lg:col-span-5'} min-w-0`}>
          <h2 className="section-title mb-2">Panorama</h2>
          <div className="card p-4 space-y-3.5">
            {panorama.map(p => (
              <button key={p.rotulo} onClick={() => navigate(p.caminho)} className="w-full grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center text-left group">
                <span className="text-sm text-ink-600 group-hover:text-ink-900">{p.rotulo}</span>
                <span className="text-sm font-medium text-ink-900 tnum text-right">{p.valor}</span>
                <span className="col-span-2 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                  <span className="block h-1.5 rounded-full bg-ink-500" style={{ width: `${p.p}%` }} />
                </span>
              </button>
            ))}
            {role === 'chefe' && colaboradoresTotal > 0 && (
              <p className="text-xs text-ink-400 pt-1 border-t border-ink-100">
                Vínculos: {colaboradoresPie.map(c => `${c.value} ${c.name.toLowerCase()}`).join(' · ')}
                {freelasTotal > 0 && <> · {freelaAtuando} freela{freelaAtuando !== 1 ? 's' : ''} atuando, {favoritosDisp} favorito{favoritosDisp !== 1 ? 's' : ''} livre{favoritosDisp !== 1 ? 's' : ''}</>}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
