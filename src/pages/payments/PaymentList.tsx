import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Check, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, BarChart3, Trash2, FileSpreadsheet, X, Paperclip, Search, MoreHorizontal, Pencil, Wallet, ExternalLink } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatDate, formatCurrency, hojeISO, semAcento } from '../../lib/utils'
import { exportToCSV } from '../../lib/exportUtils'
import { SkeletonRows } from '../../components/ui/Skeleton'
import { SignedLink } from '../../components/ui/SignedFile'
import { format, startOfMonth, endOfMonth, getDaysInMonth, addDays } from 'date-fns'
import toast from 'react-hot-toast'
import { confirmar } from '../../components/ui/ConfirmDialog'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'

type Tab = 'folha' | 'pagos'
type WorkerGroup = 'consultoria' | 'fixo_plantao' | 'freela'

function workerGroup(serviceType: string | null): WorkerGroup {
  if (serviceType === 'Volante') return 'freela'
  if (serviceType === 'Consultoria') return 'consultoria'
  return 'fixo_plantao'
}

// Freela: dias previstos de trabalho no mês, dentro do período [start, end] do lançamento,
// respeitando a escala (12x36 pela data âncora; 5x2/6x1 pelos dias de folga)
function freelaExpectedDays(
  month: string,
  start: string | null,
  end: string | null,
  schedType: string | null,
  daysOff: number[] | null,
  anchor: string | null,
): number {
  const [yr, mo] = month.split('-').map(Number)
  const dim = getDaysInMonth(new Date(yr, mo - 1))
  const mStart = `${month}-01`
  const mEnd = `${month}-${String(dim).padStart(2, '0')}`
  const from = start && start > mStart ? start : mStart
  const to = end && end < mEnd ? end : mEnd
  if (from > to) return 0
  let count = 0
  const d = new Date(from + 'T12:00:00')
  const dEnd = new Date(to + 'T12:00:00')
  while (d <= dEnd) {
    let works = true
    if (schedType === '12x36' && anchor) {
      const diff = Math.round((d.getTime() - new Date(anchor + 'T12:00:00').getTime()) / 86400000)
      works = diff >= 0 && diff % 2 === 0
    } else if (daysOff && daysOff.length > 0) {
      works = !daysOff.includes(d.getDay())
    }
    if (works) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

// Dias de trabalho esperados no mês, pela escala do vínculo.
// ATENÇÃO: recebe work_schedule_TYPE (5x2/6x1/12x36/Plantão), que é o campo
// que o cadastro preenche. Antes recebia work_schedule (texto livre), que só
// existe em contratos e nunca é gravado no vínculo — vinha sempre nulo e todo
// mundo caía no fallback de 22 dias, inflando o valor-dia de quem faz 6x1.
function expectedDays(schedule: string | null, month: string): number {
  const [yr, mo] = month.split('-').map(Number)
  const totalDays = getDaysInMonth(new Date(yr, mo - 1))
  if (!schedule) return 22
  if (schedule.includes('6x1')) return Math.floor(totalDays * 6 / 7)
  if (schedule.includes('5x2')) return Math.floor(totalDays * 5 / 7)
  if (schedule.includes('12x36')) return Math.floor(totalDays * 1 / 3)
  if (schedule.toLowerCase().includes('plant')) return Math.floor(totalDays * 1 / 3)
  return 22
}

const CAT_COLORS: Record<string, string> = {
  Salário: 'bg-blue-100 text-blue-700',
  Fornecedor: 'bg-purple-100 text-purple-700',
  Imposto: 'bg-red-100 text-red-700',
  Outro: 'bg-gray-100 text-gray-600',
}
const STATUS_COLORS: Record<string, string> = {
  Pendente: 'bg-amber-100 text-amber-700',
  Pago: 'bg-green-100 text-green-700',
  Cancelado: 'bg-gray-100 text-gray-600',
}

// Etapas do pagamento de um vínculo, sempre nesta ordem:
//   lancar   → ainda não tem lançamento no mês
//   conferir → tem a previsão (Fixo/Freela); falta fechar pelo realizado
//   pagar    → lançamento final aberto; falta marcar como pago
//   pago     → tudo pago
// Consultoria/auditoria não têm "conferir": o lançamento já sai das visitas.
type Etapa = 'lancar' | 'conferir' | 'pagar' | 'pago'

function Etapas({ etapa, porTrabalho }: { etapa: Etapa; porTrabalho: boolean }) {
  const ordem: Etapa[] = ['lancar', 'conferir', 'pagar', 'pago']
  const passos: [Etapa, string][] = porTrabalho
    ? [['lancar', 'Lançar'], ['pagar', 'Pagar']]
    : [['lancar', 'Lançar'], ['conferir', 'Conferir'], ['pagar', 'Pagar']]
  const atualIdx = ordem.indexOf(etapa)
  return (
    <ol className="flex items-center text-[11px] font-semibold" aria-label="Etapas do pagamento">
      {passos.map(([k, rotulo], i) => {
        const feito = ordem.indexOf(k) < atualIdx
        const atual = k === etapa
        return (
          <li key={k} className="flex items-center">
            {i > 0 && <span className={`w-3 sm:w-4 h-0.5 rounded ${feito || atual ? 'bg-primary-300' : 'bg-ink-200'}`} />}
            <span className={`flex items-center gap-1 px-2 py-1 rounded-full whitespace-nowrap ${
              feito ? 'bg-primary-50 text-primary-700'
              : atual ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
              : 'bg-ink-100 text-ink-400'}`}>
              {feito ? <Check size={11} strokeWidth={3} /> : <span className="tnum">{i + 1}</span>}
              {rotulo}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function PaymentList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('folha')
  const [showCharts, setShowCharts] = useState(false)
  const [filterMonth, setFilterMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  // Filtro por etapa e busca da folha. O antigo filtro de status ia no banco e
  // escondia lançamentos: com "Pago" selecionado a linha achava que não havia
  // pendente, mostrava "Gerar" de novo e os totais saíam errados.
  const [filtroEtapa, setFiltroEtapa] = useState<'' | Etapa | 'semana' | 'atrasado'>('')
  const [busca, setBusca] = useState('')
  const [contaAberta, setContaAberta] = useState<string | null>(null)
  const [acoesDe, setAcoesDe] = useState<string | null>(null)
  // Formulário de gasto aberto: guarda o VÍNCULO (linha), não a pessoa —
  // senão quem tem dois vínculos abria o formulário nas duas linhas
  const [newExpenseEmpId, setNewExpenseEmpId] = useState<string | null>(null)
  const [confirmDelExpense, setConfirmDelExpense] = useState<string | null>(null)
  const [expForm, setExpForm] = useState({ description: '', amount: '', category: 'Reembolso', notes: '' })
  const [editAmountLink, setEditAmountLink] = useState<{ linkId: string; name: string; current: number } | null>(null)
  const [editAmountVal, setEditAmountVal] = useState('')

  const monthStart = format(startOfMonth(new Date(filterMonth + '-15')), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date(filterMonth + '-15')), 'yyyy-MM-dd')

  // ── Pagamentos — filter by reference_month (falls back to due_date range) ──
  const { data: payments, isLoading } = useQuery({
    queryKey: ['payments', filterMonth],
    queryFn: async () => {
      let q = supabase.from('payments').select('*, employee:employees(id,full_name,status)').order('due_date')
      // Try reference_month first, include records where it matches OR where due_date is in range and reference_month is null
      q = q.or(`reference_month.eq.${filterMonth},and(reference_month.is.null,due_date.gte.${monthStart},due_date.lte.${monthEnd})`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  // ── Expenses for this month ──
  const { data: expenses } = useQuery({
    queryKey: ['expenses', filterMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_expenses')
        .select('*, employee:employees(id,full_name)')
        .eq('reference_month', filterMonth)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const addExpense = useMutation({
    mutationFn: async ({ empId, clientId }: { empId: string; clientId?: string | null }) => {
      if (!expForm.description || !expForm.amount) throw new Error('Preencha descrição e valor')
      if (!(Number(expForm.amount) > 0)) throw new Error('Informe um valor maior que zero')
      const registro: Record<string, unknown> = {
        employee_id: empId,
        // De qual cliente é: quem tem dois vínculos aparecia em duas linhas e o
        // mesmo gasto entrava nas duas — pago em dobro.
        client_id: clientId || null,
        description: expForm.description,
        amount: Number(expForm.amount),
        category: expForm.category,
        notes: expForm.notes || null,
        reference_month: filterMonth,
        // Lançado aqui pelo RH já nasce aprovado: quem está lançando é quem aprova
        status: 'aprovado',
        reviewed_at: new Date().toISOString(),
      }
      let { error } = await supabase.from('employee_expenses').insert(registro)
      // Migração 053 ainda não rodada: a coluna client_id não existe. Grava sem
      // ela em vez de travar o lançamento.
      if (error && /client_id/i.test(error.message)) {
        const { client_id: _c, ...semCliente } = registro
        ;({ error } = await supabase.from('employee_expenses').insert(semCliente))
      }
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Gasto registrado!')
      qc.invalidateQueries({ queryKey: ['expenses', filterMonth] })
      setNewExpenseEmpId(null)
      setExpForm({ description: '', amount: '', category: 'Reembolso', notes: '' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Apagar um gasto lançado. Faltava: quem lançasse duas vezes por engano não
  // tinha como desfazer, e o valor duplicado seguia direto pro pagamento.
  const deleteExpense = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_expenses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Lançamento apagado.')
      qc.invalidateQueries({ queryKey: ['expenses', filterMonth] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Analisar reembolso pedido pelo portal. Sem isso, o que a colaboradora
  // digitava entrava sozinho no pagamento — o portal prometia uma aprovação
  // que não existia em lugar nenhum.
  const reviewExpense = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'aprovado' | 'negado' }) => {
      const { error } = await supabase.from('employee_expenses')
        .update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === 'aprovado' ? 'Reembolso aprovado — entra no pagamento.' : 'Reembolso negado.')
      qc.invalidateQueries({ queryKey: ['expenses', filterMonth] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // ── Folha de ponto: vínculos ativos + desligados com visitas pendentes ──
  const { data: folhaData, isLoading: folhaLoading } = useQuery({
    queryKey: ['folha-ponto', filterMonth],
    queryFn: async () => {
      // 1) Vínculos ativos
      const { data: rawLinks, error } = await supabase
        .from('employee_client_links')
        .select(`
          id, service_type, monthly_amount, work_schedule, expected_days_month, cost_assistance, start_date, pay_full_salary,
          coverage_type, daily_rate, contract_end_date, work_schedule_type, days_off, schedule_anchor_date,
          employee:employees!inner(id, full_name, status),
          client:clients(id, name),
          payment_dates:employee_payment_dates(day_of_month, amount)
        `)
      if (error) throw error
      // Vínculo encerrado ANTES do mês que está sendo pago não entra na folha.
      // Encerrado no meio do mês continua (tem dias a pagar). O histórico do
      // vínculo é preservado — desligar encerra, não apaga.
      const activeLinks = (rawLinks || []).filter(l => {
        if ((l as { employee?: { status?: string } }).employee?.status !== 'Ativo') return false
        const fim = (l as { contract_end_date?: string }).contract_end_date
        return !fim || fim >= monthStart
      })

      // 2) Visitas do mês de colaboradores desligados (sem vínculo ativo)
      const activeEmpIds = new Set(activeLinks.map(l => (l as { employee?: { id: string } }).employee?.id).filter(Boolean))
      // Paginado: o Supabase corta em 1000 linhas SEM avisar. Um mês de visitas
      // passa disso conforme a operação cresce, e a folha calcularia pagamento
      // com parte das visitas faltando, sem erro nenhum na tela.
      const monthVisits = await fetchAll<{
        employee_id: string; client_id: string; visit_date: string
        check_in?: string; check_out?: string; break_start?: string; break_end?: string
        visit_rate?: number; is_unavailable?: boolean; is_extra?: boolean
        extra_approval?: string; extra_amount?: number; observations?: string
        report_url?: string; is_holiday?: boolean
        atestado_url?: string; unavailability_reason?: string; unit_name?: string
      }>(() => supabase
        .from('nutritionist_visits')
        .select('employee_id, client_id, visit_date, check_in, check_out, break_start, break_end, visit_rate, is_unavailable, is_extra, extra_approval, extra_amount, observations, report_url, is_holiday, atestado_url, unavailability_reason, unit_name')
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd))

      // Dias combinados na agenda. Para FREELA avulso é daqui que sai a previsão:
      // ele não tem escala, os dias são marcados um a um. Sem isso a estimativa
      // contava TODOS os dias do período como se ele trabalhasse todo dia.
      const monthAgenda = await fetchAll<{ employee_id: string; client_id: string; planned_date: string }>(
        () => supabase
          .from('nutritionist_agenda')
          .select('employee_id, client_id, planned_date')
          .gte('planned_date', monthStart)
          .lte('planned_date', monthEnd))

      // Desligados com visitas neste mês que ainda não foram pagos
      const dismissedVisits = (monthVisits || []).filter(v => !activeEmpIds.has(v.employee_id))
      const dismissedEmpIds = [...new Set(dismissedVisits.map(v => v.employee_id))]

      // Busca nomes dos desligados e checa se já tem pagamento no mês
      let dismissedRows: typeof activeLinks = []
      if (dismissedEmpIds.length) {
        const { data: dismissedEmps } = await supabase
          .from('employees')
          .select('id, full_name, status')
          .in('id', dismissedEmpIds)
        const { data: paidCheck } = await supabase
          .from('payments')
          .select('employee_id')
          .in('employee_id', dismissedEmpIds)
          .eq('status', 'Pago')
          .or(`reference_month.eq.${filterMonth},and(reference_month.is.null,due_date.gte.${monthStart},due_date.lte.${monthEnd})`)

        const paidIds = new Set((paidCheck || []).map(p => p.employee_id))
        const unpaidDismissed = (dismissedEmps || []).filter(e => !paidIds.has(e.id))

        // Agrupa visitas por employee+client
        const groups = new Map<string, { employee_id: string; client_id: string }>()
        for (const v of dismissedVisits) {
          const key = `${v.employee_id}|${v.client_id}`
          if (!groups.has(key) && unpaidDismissed.some(e => e.id === v.employee_id)) {
            groups.set(key, { employee_id: v.employee_id, client_id: v.client_id })
          }
        }

        // Busca nomes dos clientes
        const clientIds = [...new Set([...groups.values()].map(g => g.client_id))]
        const { data: clientNames } = clientIds.length
          ? await supabase.from('clients').select('id, name').in('id', clientIds)
          : { data: [] }

        for (const [, g] of groups) {
          const emp = unpaidDismissed.find(e => e.id === g.employee_id)
          const client = (clientNames || []).find(c => c.id === g.client_id)
          if (emp) {
            dismissedRows.push({
              id: `dismissed-${g.employee_id}-${g.client_id}`,
              service_type: 'Consultoria',
              monthly_amount: null,
              work_schedule: null,
              expected_days_month: null,
              cost_assistance: 0,
              employee: { id: emp.id, full_name: emp.full_name + ' (inativo)', status: emp.status },
              client: client ? { id: client.id, name: client.name } : null,
              payment_dates: [],
            } as never)
          }
        }
      }

      const links = [...activeLinks, ...dismissedRows]
      if (!links?.length) return []

      // Fetch actual visits for this month for all employees
      const empIds = [...new Set(links.map(l => (l as { employee?: { id: string } }).employee?.id).filter(Boolean))]
      const visits = monthVisits?.filter(v => empIds.includes(v.employee_id)) || []

      // Check which have real payments already — por mês de referência (o vencimento
      // pode cair no mês seguinte quando o dia de pagamento já passou)
      const { data: realPayments } = await supabase
        .from('payments')
        .select('*')
        .eq('type', 'Real')
        // Real cancelado não conta — senão não dá para gerar de novo
        .neq('status', 'Cancelado')
        .or(`reference_month.eq.${filterMonth},and(reference_month.is.null,due_date.gte.${monthStart},due_date.lte.${monthEnd})`)

      // Fallback: get vacancy financial data for employees with null monthly_amount
      const nullAmtEmpIds = links
        .filter(l => !l.monthly_amount)
        .map(l => (l as { employee?: { id: string } }).employee?.id)
        .filter(Boolean) as string[]

      // A chave inclui o CLIENTE. Antes era só por pessoa: quem tinha vaga no
      // cliente A e um vínculo sem salário no cliente B recebia, no B, o salário
      // da vaga do A. Era improvável enquanto vincular exigia vaga; virou
      // provável quando vincular direto ficou fácil.
      let vacancyFallback: Record<string, { salary_amount: number | null; vacancy_units: { visit_rate: string | number }[] | null }> = {}
      if (nullAmtEmpIds.length) {
        const { data: interests } = await supabase
          .from('vacancy_interests')
          .select('employee_id, vacancy:vacancies(client_id, salary_amount, vacancy_units, vacancy_type)')
          .in('employee_id', nullAmtEmpIds)
          .eq('status', 'Contratado')
        if (interests) {
          for (const i of interests) {
            const v = (i as { vacancy?: { client_id?: string; salary_amount?: number; vacancy_units?: { visit_rate: string | number }[]; vacancy_type?: string } }).vacancy
            if (v && i.employee_id && v.client_id) {
              // Só salário fixo de vaga antiga. O ramo de consultoria multiplicava
              // por `visits_per_month`, um campo que nunca foi gravado: dava
              // sempre 0 e fingia ser um cálculo. Consultoria se paga pelas
              // visitas registradas, não por estimativa de vaga.
              const amt: number | null = v.salary_amount || null
              vacancyFallback[`${i.employee_id}|${v.client_id}`] = { salary_amount: amt, vacancy_units: v.vacancy_units ?? null }
            }
          }
        }
      }

      return (links || []).map(l => {
        const emp = (l as { employee?: { id: string; full_name: string } }).employee
        const client = (l as { client?: { id: string; name: string } }).client
        const isConsultoria = l.service_type === 'Consultoria'
        // Freela (Volante): trabalho avulso pago por diária (cobertura fixa) ou por visita (consultoria)
        const isFreela = l.service_type === 'Volante'
        const freelaConsultoria = isFreela && (l as { coverage_type?: string }).coverage_type === 'Consultoria'
        const dailyRate = Number((l as { daily_rate?: number }).daily_rate) || 0

        // A visita não guarda o vínculo que a originou — casa por colaborador +
        // cliente. Com DOIS vínculos no mesmo cliente (ex: consultoria fixa +
        // freela de cobertura), os dois enxergavam as MESMAS visitas e cada um
        // gerava pagamento: a pessoa recebia duas vezes pelo mesmo dia.
        // Regra de desempate: o freela é dono das visitas dentro do período dele
        // (start_date → contract_end_date); o vínculo fixo fica com o resto.
        const irmaos = (links || []).filter(o =>
          (o as { employee?: { id: string } }).employee?.id === emp?.id &&
          (o as { client?: { id: string } }).client?.id === client?.id)
        const janela = (o: typeof l) => ({
          id: o.id,
          de: (o as { start_date?: string }).start_date || '',
          ate: (o as { contract_end_date?: string }).contract_end_date || '9999-12-31',
        })
        const freelasIrmaos = irmaos.filter(o => o.service_type === 'Volante').map(janela)
        const dentroDaJanela = (d: string, j: { de: string; ate: string }) => (!j.de || d >= j.de) && d <= j.ate
        // Dono único de cada dia. Numa RENOVAÇÃO o fim de um freela e o início
        // do outro caem no mesmo dia (13/09 → 13/09): as duas janelas continham
        // aquela visita e os dois vínculos a pagavam. Agora o dia é do freela
        // mais recente que o contém.
        const donoFreela = (d: string) => freelasIrmaos
          .filter(j => dentroDaJanela(d, j))
          .sort((a, b) => b.de.localeCompare(a.de))[0]?.id

        const empVisits = (visits?.filter(v => v.employee_id === emp?.id && v.client_id === client?.id) ?? [])
          .filter(v => {
            if (irmaos.length <= 1) return true
            const dono = donoFreela(v.visit_date)
            // Freela só fica com os dias em que ele é o dono
            if (isFreela) return dono === l.id
            // Vínculo fixo abre mão do que pertence a algum freela
            return !dono
          })

        const visitHours = (v: { check_in?: string | null; check_out?: string | null; break_start?: string | null; break_end?: string | null }) => {
          if (!v.check_in || !v.check_out) return 0
          const [hi, mi] = v.check_in.slice(0,5).split(':').map(Number)
          const [ho, mo] = v.check_out.slice(0,5).split(':').map(Number)
          let min = ho * 60 + mo - hi * 60 - mi
          if (min < 0) min += 24 * 60
          if (v.break_start && v.break_end) {
            const [b1h, b1m] = v.break_start.slice(0,5).split(':').map(Number)
            const [b2h, b2m] = v.break_end.slice(0,5).split(':').map(Number)
            min -= Math.max(0, b2h * 60 + b2m - b1h * 60 - b1m)
          }
          return Math.max(0, min) / 60
        }

        // Dia EXTRA não conta como dia da escala: ele já é pago à parte (quando
        // aprovado). Contando aqui também, um extra "cobria" uma falta e ainda era
        // pago — e um extra NEGADO apagava uma falta de graça.
        const actualDays = !isConsultoria && !freelaConsultoria
          ? empVisits.filter(v => v.check_out
              && !(v as { is_unavailable?: boolean }).is_unavailable
              && !(v as { is_extra?: boolean }).is_extra).length
          : 0
        const actualVisits = (isConsultoria || freelaConsultoria) ? empVisits.length : 0
        // Consultoria: visit_rate JÁ é o valor final da visita (o portal grava
        // proporcional às horas combinadas) — aqui só soma, sem recalcular.
        // Freela cobrindo consultoria segue a mesma regra.
        const actualAmount = (isConsultoria || freelaConsultoria)
          ? empVisits.reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
          : null
        // Fixo: dias extras aprovados pelo chefe entram no pagamento
        const extrasAprovados = !isConsultoria
          ? empVisits
              .filter(v => (v as { is_extra?: boolean }).is_extra && (v as { extra_approval?: string }).extra_approval === 'aprovada')
              .reduce((s, v) => s + (Number((v as { extra_amount?: number }).extra_amount) || 0), 0)
          : 0
        // Extra/visita aguardando a decisão do chefe. Não entra no valor, mas
        // precisa aparecer: antes sumia da folha e o pagamento saía sem ele.
        const extrasPendentes = empVisits.filter(v =>
          (v as { extra_approval?: string }).extra_approval === 'pendente')

        // Relatório exigido: Consultoria sempre; Volante em qualquer cobertura. Fixo puro não.
        const reportRequired = l.service_type === 'Consultoria' || l.service_type === 'Volante'
        const visitasTrabalhadas = empVisits.filter(v =>
          v.check_in && !(v as { is_unavailable?: boolean }).is_unavailable && !(v as { is_holiday?: boolean }).is_holiday)
        const semRelatorio = reportRequired
          ? visitasTrabalhadas.filter(v => !(v as { report_url?: string }).report_url).length
          : 0

        // Freela é AVULSO: os dias combinados são os que estão na agenda dele.
        // Só quando não há agenda nenhuma é que caímos na escala (freela de
        // cobertura, que substitui alguém numa escala existente).
        const freelaDe = (l as { start_date?: string }).start_date || ''
        const freelaAte = (l as { contract_end_date?: string }).contract_end_date || '9999-12-31'
        const diasNaAgenda = isFreela
          ? new Set((monthAgenda || [])
              .filter(a => a.employee_id === emp?.id && a.client_id === client?.id)
              .filter(a => (!freelaDe || a.planned_date >= freelaDe) && a.planned_date <= freelaAte)
              .map(a => a.planned_date)).size
          : 0

        const expDays = isFreela
          ? (freelaConsultoria ? 0
            : diasNaAgenda > 0 ? diasNaAgenda
            : freelaExpectedDays(
              filterMonth,
              (l as { start_date?: string }).start_date || null,
              (l as { contract_end_date?: string }).contract_end_date || null,
              (l as { work_schedule_type?: string }).work_schedule_type || null,
              (l as { days_off?: number[] }).days_off || null,
              (l as { schedule_anchor_date?: string }).schedule_anchor_date || null,
            ))
          : !isConsultoria
            ? (l.expected_days_month
              || expectedDays((l as { work_schedule_type?: string }).work_schedule_type || l.work_schedule, filterMonth))
            : 0
        // Só cai no salário da vaga se a vaga for DO MESMO cliente deste vínculo
        const fallback = emp?.id && client?.id ? vacancyFallback[`${emp.id}|${client.id}`] : undefined
        // Freela: estimativa = dias previstos × diária (fixo) ou soma das visitas (consultoria).
        // Nunca usa salário mensal nem fallback de vaga.
        const monthlyAmt = isFreela
          ? (freelaConsultoria ? (actualAmount || 0) : Math.round(expDays * dailyRate * 100) / 100)
          : Number(l.monthly_amount) || Number(fallback?.salary_amount) || 0

        // Real gerado: casa por vínculo quando o lançamento tem link_id; senão por colaborador (legado)
        const hasRealPayment = realPayments?.some(rp => {
          const rpLink = (rp as { link_id?: string }).link_id
          return rpLink ? rpLink === l.id : rp.employee_id === emp?.id
        }) ?? false
        const costAssistance = Number((l as { cost_assistance?: number }).cost_assistance) || 0
        const group = workerGroup(l.service_type)
        const payDates = ((l as { payment_dates?: { day_of_month: number }[] }).payment_dates ?? [])
          .slice().sort((a, b) => a.day_of_month - b.day_of_month)
        // Fixo: um pagamento por mês (dia 8, 15 ou 20). Consultoria: sempre 8 e 20.
        // Freela: dia escolhido no lançamento (default 20 se não houver).
        const payDay = isConsultoria ? 20 : (payDates[0]?.day_of_month || (isFreela ? 20 : 5))
        const startDate = (l as { start_date?: string }).start_date || null
        const payFullSalary = (l as { pay_full_salary?: boolean }).pay_full_salary ?? false

        // Ciclo de pagamento para Fixo: payDay do mês anterior até payDay-1 do mês atual
        // Se o colaborador começou mid-cycle, calcula proporcional (a não ser que pay_full_salary = true)
        let cycleStart: string | null = null
        let cycleEnd: string | null = null
        let isPartialCycle = false
        let startsAfterCycle = false
        let proportionalFactor = 1

        // Freela não tem ciclo mensal: o período é o próprio lançamento (start → end)
        if (!isConsultoria && !isFreela && payDay) {
          const [yr, mo] = filterMonth.split('-').map(Number)
          const cEnd = new Date(yr, mo - 1, payDay - 1)
          const cStart = new Date(yr, mo - 2, payDay)
          cycleStart = cStart.toISOString().slice(0, 10)
          cycleEnd = cEnd.toISOString().slice(0, 10)

          if (startDate && startDate > cycleStart && startDate <= cycleEnd) {
            isPartialCycle = true
            if (!payFullSalary) {
              // A diária é sempre salário ÷ 30, mesmo em ciclo de 28 ou 31 dias.
              // Entrou no meio: paga os dias corridos de presença × diária, teto no
              // salário cheio. (Antes dividia pelo tamanho do ciclo, então o mesmo
              // dia de entrada valia diferente conforme o mês tivesse 28 ou 31 dias.)
              const diasPresente = Math.round((cEnd.getTime() - new Date(startDate).getTime()) / 86400000) + 1
              proportionalFactor = Math.min(1, diasPresente / 30)
            }
          } else if (startDate && startDate > cycleEnd) {
            // Começou depois do ciclo fechar: nada a pagar neste mês (1º pagamento no próximo ciclo)
            startsAfterCycle = true
            if (!payFullSalary) proportionalFactor = 0
          }
        }

        // Dias sem registro: tolerância de 4 dias antes de alertar (dá tempo de corrigir a folha)
        const today = new Date()
        const isCurrentMonth = filterMonth === format(today, 'yyyy-MM')
        let expDaysToDate = expDays
        if (isFreela) {
          if (freelaConsultoria || filterMonth > format(today, 'yyyy-MM')) {
            expDaysToDate = 0
          } else if (isCurrentMonth) {
            // Só cobra dias previstos até 4 dias atrás, dentro do período do freela
            const grace = new Date(today.getTime() - 4 * 86400000)
            const graceIso = format(grace, 'yyyy-MM-dd')
            const end = (l as { contract_end_date?: string }).contract_end_date || null
            expDaysToDate = freelaExpectedDays(
              filterMonth,
              (l as { start_date?: string }).start_date || null,
              end && end < graceIso ? end : graceIso,
              (l as { work_schedule_type?: string }).work_schedule_type || null,
              (l as { days_off?: number[] }).days_off || null,
              (l as { schedule_anchor_date?: string }).schedule_anchor_date || null,
            )
          }
        } else if (!isConsultoria && isCurrentMonth) {
          const dim = getDaysInMonth(new Date(filterMonth + '-15'))
          const graceDay = Math.max(0, today.getDate() - 4)
          expDaysToDate = Math.floor(expDays * (graceDay / dim))
        } else if (!isConsultoria && filterMonth > format(today, 'yyyy-MM')) {
          expDaysToDate = 0 // mês futuro: nada a cobrar ainda
        }

        const adjustedAmount = Math.round(monthlyAmt * proportionalFactor * 100) / 100
        // Fixo por dias: valor-dia = salário INTEIRO ÷ dias esperados; quem começou no meio
        // do mês já registra menos dias, então o proporcional sai naturalmente da contagem
        // Freela: realizado = dias com check-out × diária (fixo) ou soma das visitas (consultoria)
        // Fixo: o salário é fixo no mês — cumpriu a escala, recebe inteiro, tenha o
        // mês 28 ou 31 dias. Cada falta desconta UMA diária (salário ÷ 30).
        // Antes era (dias feitos ÷ dias esperados) × salário, o que fazia a diária
        // variar com a escala: num 12x36 (10 dias previstos) cada dia valia
        // salário ÷ 10 — o triplo do correto.
        const valorDia = monthlyAmt > 0 ? monthlyAmt / 30 : 0
        // FALTA SÓ CONTA DIA QUE JÁ PASSOU. Antes comparava com os dias do MÊS
        // INTEIRO: no dia 8 de setembro, quem tem escala de 10 dias aparecia com
        // "10 faltas" e desconto cheio, mesmo trabalhando normal — e o botão
        // Real geraria o pagamento com esse desconto. Agora o teto é o que já
        // venceu (expDaysToDate já respeita mês futuro e a tolerância de 4 dias).
        // "Pagar inteiro" marcado significa exatamente isso: não desconta.
        const diasCobraveis = Math.min(expDays, expDaysToDate)
        const faltas = !isConsultoria && !isFreela && !payFullSalary
          ? Math.max(0, diasCobraveis - actualDays)
          : 0

        // Ausências declaradas — separadas entre as que têm atestado anexado e as
        // que não têm. Estavam no banco mas nunca chegavam nesta tela: o RH não
        // conseguia ver, na folha, quem faltou justificando e quem simplesmente faltou.
        const ausencias = empVisits.filter(v => (v as { is_unavailable?: boolean }).is_unavailable)
        const ausenciasComAtestado = ausencias.filter(v => (v as { atestado_url?: string }).atestado_url)
        const presencaCompleta = !isConsultoria && !isFreela && expDays > 0 && actualDays >= expDays
        const realAmt = isFreela
          ? (freelaConsultoria ? (actualAmount || 0) : Math.round(actualDays * dailyRate * 100) / 100)
          : isConsultoria
            ? (actualAmount || 0)
            : Math.max(0, Math.round((adjustedAmount - faltas * valorDia) * 100) / 100)

        return {
          linkId: l.id,
          employee: emp,
          client,
          service_type: l.service_type,
          isFreela,
          freelaConsultoria,
          dailyRate,
          freelaStart: (l as { start_date?: string }).start_date || null,
          freelaEnd: (l as { contract_end_date?: string }).contract_end_date || null,
          work_schedule: l.work_schedule,
          monthly_amount: monthlyAmt,
          adjusted_amount: adjustedAmount,
          cost_assistance: costAssistance,
          actualDays,
          actualVisits,
          expDays,
          valorDia,
          faltas,
          actualAmount,
          realAmt,
          hasRealPayment,
          visits: empVisits,
          group,
          payDay,
          payDaysAll: payDates.map(p => p.day_of_month),
          startDate,
          payFullSalary,
          cycleStart,
          cycleEnd,
          isPartialCycle,
          startsAfterCycle,
          proportionalFactor,
          extrasAprovados,
          extrasPendentes,
          expDaysToDate,
          diasCobraveis,
          reportRequired,
          semRelatorio,
          ausencias,
          ausenciasComAtestado,
          presencaCompleta,
          visitHours,
        }
      })
    },
    // Always load so Estimativa tab can group correctly
    enabled: true,
  })

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payments').update({
        status: 'Pago',
        paid_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Marcado como pago!'); qc.invalidateQueries({ queryKey: ['payments'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const togglePayFull = useMutation({
    mutationFn: async ({ linkId, value }: { linkId: string; value: boolean }) => {
      const { error } = await supabase.from('employee_client_links').update({ pay_full_salary: value }).eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['folha-ponto'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Insere lançamento; se as colunas client_id/link_id ainda não existirem (migração 024
  // pendente), tenta de novo sem elas para não travar o pagamento.
  const insertPayment = async (record: Record<string, unknown>) => {
    const { error } = await supabase.from('payments').insert(record)
    if (error && /column|link_id|client_id/i.test(error.message)) {
      const { client_id: _c, link_id: _l, ...legacy } = record
      const { error: e2 } = await supabase.from('payments').insert(legacy)
      if (e2) throw e2
      return
    }
    if (error) throw error
  }

  type GenRow = {
    employee: { id: string; full_name: string } | undefined
    client: { id: string; name: string } | undefined
    linkId: string
    service_type: string
    monthly_amount: number
    adjusted_amount: number
    realAmt: number
    cost_assistance: number
    extrasAprovados: number
    payDay: number
    payDaysAll?: number[]
    visits: { visit_date: string; visit_rate?: number | null }[]
  }

  // Só reembolso APROVADO entra no pagamento. Antes somava tudo, inclusive
  // pedido do portal sem nota e sem ninguém ter olhado.
  // ADIANTAMENTO é dinheiro que a pessoa já recebeu antes: entra na mesma lista
  // de gastos, mas DESCONTA do pagamento em vez de somar.
  const ehAdiantamento = (e: unknown) => (e as { category?: string }).category === 'Adiantamento'
  // Cada gasto pertence a UMA linha da folha. Quem tem dois vínculos aparece em
  // duas linhas e, antes, o mesmo gasto entrava nas duas — pago em dobro. Vai
  // para a linha do cliente em que foi lançado; sem cliente, para a 1ª linha.
  const donoDoGasto = (e: unknown): string | undefined => {
    const g = e as { employee_id?: string; client_id?: string | null }
    const linhas = (folhaData ?? []).filter(r => r.employee?.id === g.employee_id)
    return (linhas.find(r => g.client_id && r.client?.id === g.client_id) ?? linhas[0])?.linkId
  }
  const gastosDaLinha = (linkId: string) => (expenses ?? []).filter(e => donoDoGasto(e) === linkId)
  const aprovadosDe = (linkId: string) => gastosDaLinha(linkId)
    .filter(e => ((e as { status?: string }).status ?? 'aprovado') === 'aprovado')
  // Líquido: gastos somam, adiantamentos subtraem
  const empExpensesTotal = (linkId: string) =>
    aprovadosDe(linkId).reduce((s, e) => s + (ehAdiantamento(e) ? -1 : 1) * (Number(e.amount) || 0), 0)
  const empGastos = (linkId: string) =>
    aprovadosDe(linkId).filter(e => !ehAdiantamento(e)).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const empAdiantamento = (linkId: string) =>
    aprovadosDe(linkId).filter(ehAdiantamento).reduce((s, e) => s + (Number(e.amount) || 0), 0)

  const expensesPendentes = (expenses ?? []).filter(e => (e as { status?: string }).status === 'pendente')

  const baseRecord = (row: GenRow) => ({
    status: 'Pendente',
    recurrence: 'Mensal',
    category: 'Salário',
    employee_id: row.employee!.id,
    client_id: row.client?.id ?? null,
    link_id: row.linkId.startsWith('dismissed-') ? null : row.linkId,
    reference_month: filterMonth,
  })

  const autoGeneratePayment = useMutation({
    mutationFn: async (row: GenRow) => {
      if (!row.employee) throw new Error('Sem colaborador')
      const monthLabel = new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      const who = `${row.employee.full_name}${row.client ? ` (${row.client.name})` : ''}`
      const extras = empExpensesTotal(row.linkId) + row.cost_assistance + row.extrasAprovados

      if (row.service_type === 'Consultoria') {
        // Consultoria: SÓ dia 20 (visitas da 1ª quinzena) e dia 8 do mês seguinte (2ª quinzena)
        const q1 = row.visits.filter(v => Number(v.visit_date.slice(8, 10)) <= 15).reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
        const q2 = row.visits.filter(v => Number(v.visit_date.slice(8, 10)) > 15).reduce((s, v) => s + (Number(v.visit_rate) || 0), 0)
        if (q1 <= 0 && q2 <= 0 && extras <= 0) throw new Error('Nenhuma visita registrada neste mês — nada a lançar.')
        const [yr, mo] = filterMonth.split('-').map(Number)
        const nextMonth = mo === 12 ? `${yr + 1}-01` : `${yr}-${String(mo + 1).padStart(2, '0')}`
        // Extras (aj. custo/gastos) entram no último lançamento do mês
        const extrasEmQ2 = q2 > 0 || q1 <= 0
        if (q1 > 0 || (!extrasEmQ2 && extras > 0)) {
          await insertPayment({
            ...baseRecord(row),
            type: 'Estimativa',
            description: `Honorários – ${who} – 1ª quinzena ${monthLabel}`,
            amount: Math.max(0, Math.round((q1 + (extrasEmQ2 ? 0 : extras)) * 100) / 100),
            due_date: `${filterMonth}-20`,
          })
        }
        if (q2 > 0 || (extrasEmQ2 && extras > 0)) {
          await insertPayment({
            ...baseRecord(row),
            type: 'Estimativa',
            description: `Honorários – ${who} – 2ª quinzena ${monthLabel}`,
            amount: Math.max(0, Math.round((q2 + (extrasEmQ2 ? extras : 0)) * 100) / 100),
            due_date: `${nextMonth}-08`,
          })
        }
      } else {
        // Fixo/Plantão/12x36 e Freela: um pagamento por mês no dia do contrato.
        // Se o vínculo tiver DOIS dias marcados, o valor é dividido entre eles
        // (quinzena) — o 2º dia cai no mês seguinte quando é menor que o 1º.
        const isFreela = row.service_type === 'Volante'
        // Adiantamento maior que o devido não vira pagamento negativo
        const amount = Math.max(0, Math.round((row.adjusted_amount + extras) * 100) / 100)
        if (isFreela && amount <= 0) throw new Error('Freela sem valor previsto neste mês — nada a lançar.')

        const dias = (row.payDaysAll || []).slice().sort((a, b) => a - b)
        const label = isFreela ? 'Freela' : 'Honorários'

        if (dias.length >= 2) {
          const metade = Math.round((amount / 2) * 100) / 100
          // Diferença de arredondamento vai na 1ª parcela
          const primeira = Math.round((amount - metade) * 100) / 100
          await insertPayment({
            ...baseRecord(row),
            type: 'Estimativa',
            description: `${label} – ${who} – 1ª quinzena ${monthLabel}`,
            amount: primeira,
            due_date: `${filterMonth}-${String(dias[0]).padStart(2, '0')}`,
          })
          await insertPayment({
            ...baseRecord(row),
            type: 'Estimativa',
            description: `${label} – ${who} – 2ª quinzena ${monthLabel}`,
            amount: metade,
            due_date: `${filterMonth}-${String(dias[1]).padStart(2, '0')}`,
          })
        } else {
          await insertPayment({
            ...baseRecord(row),
            type: 'Estimativa',
            description: `${label} – ${who} – ${monthLabel}`,
            amount,
            due_date: `${filterMonth}-${String(row.payDay || (isFreela ? 20 : 5)).padStart(2, '0')}`,
          })
        }
      }
    },
    onSuccess: () => {
      toast.success('Lançamento gerado!')
      qc.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateRealPayment = useMutation({
    mutationFn: async (row: GenRow) => {
      if (!row.employee) throw new Error('Sem colaborador')
      const now = new Date()
      const payDay = row.payDay || 5
      const dueDate = new Date(now.getFullYear(), now.getMonth(), payDay)
      if (dueDate < now) dueDate.setMonth(dueDate.getMonth() + 1)
      const monthLabel = new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      const extras = empExpensesTotal(row.linkId) + row.cost_assistance + row.extrasAprovados
      // O Real substitui a Estimativa do mês: o que já foi pago dela sai do
      // valor, e a parte ainda pendente é cancelada. Antes ficavam as duas
      // abertas e dava para pagar em dobro.
      const estimativas = lancamentosDaLinha(row).filter(p => p.type !== 'Real')
      const jaPago = estimativas.filter(p => p.status === 'Pago').reduce((s, p) => s + (Number(p.amount) || 0), 0)
      const pendentes = estimativas.filter(p => p.status === 'Pendente')
      await insertPayment({
        ...baseRecord(row),
        type: 'Real',
        description: `[REAL] ${row.service_type === 'Volante' ? 'Freela' : 'Honorários'} – ${row.employee.full_name}${row.client ? ` (${row.client.name})` : ''} – ${monthLabel}${jaPago > 0 ? ` (já pago ${formatCurrency(jaPago)})` : ''}`,
        amount: Math.max(0, Math.round((row.realAmt + extras - jaPago) * 100) / 100),
        due_date: `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`,
      })
      if (pendentes.length) {
        const { error } = await supabase.from('payments').update({ status: 'Cancelado' }).in('id', pendentes.map(p => p.id))
        if (error) throw new Error('Real gerado, mas não consegui cancelar a estimativa pendente: ' + error.message)
      }
    },
    onSuccess: () => {
      toast.success('Pagamento real gerado!')
      qc.invalidateQueries({ queryKey: ['folha-ponto', filterMonth] })
      qc.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateLinkAmount = useMutation({
    mutationFn: async ({ linkId, amount }: { linkId: string; amount: number }) => {
      const { error } = await supabase.from('employee_client_links').update({ monthly_amount: amount }).eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Valor atualizado!')
      qc.invalidateQueries({ queryKey: ['folha-ponto', filterMonth] })
      setEditAmountLink(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Baixar a folha em Excel. O mês na tela vai detalhado (resumo, dia a dia e
  // reembolsos); a aba de pagamentos traz TODOS os meses, que é o histórico
  // colaborador por colaborador.
  const [baixando, setBaixando] = useState(false)
  const baixarExcel = async () => {
    setBaixando(true)
    try {
      // Sem embed: payments.client_id e employee_id foram criados como uuid
      // solto, sem chave estrangeira, então o PostgREST não sabe ligar as
      // tabelas ("Could not find a relationship"). Buscamos os nomes à parte.
      const [{ data: pagRaw, error }, { data: emps }, { data: clis }] = await Promise.all([
        supabase.from('payments')
          .select('description, amount, due_date, status, type, reference_month, paid_at, employee_id, client_id')
          .order('due_date', { ascending: false }),
        supabase.from('employees').select('id, full_name'),
        supabase.from('clients').select('id, name'),
      ])
      if (error) throw error
      const nomeEmp = new Map((emps ?? []).map(e => [e.id, e.full_name]))
      const nomeCli = new Map((clis ?? []).map(c => [c.id, c.name]))
      const todosPagamentos = (pagRaw ?? []).map(p => ({
        ...p,
        employee: { full_name: nomeEmp.get((p as { employee_id?: string }).employee_id ?? '') ?? '' },
        client: { name: nomeCli.get((p as { client_id?: string }).client_id ?? '') ?? '' },
      }))
      const { exportFolhaExcel } = await import('../../lib/folhaExcel')
      await exportFolhaExcel(
        (folhaData ?? []) as unknown as Parameters<typeof exportFolhaExcel>[0],
        (expenses ?? []) as unknown as Parameters<typeof exportFolhaExcel>[1],
        (todosPagamentos ?? []) as unknown as Parameters<typeof exportFolhaExcel>[2],
        filterMonth,
      )
      toast.success('Planilha baixada!')
    } catch (e) {
      toast.error('Não foi possível gerar a planilha: ' + (e as Error).message)
    } finally {
      setBaixando(false)
    }
  }

  // Totals driven by active vinculos (folhaData), not by payments records
  // Consultoria e auditoria NÃO TÊM PREVISÃO: a data não é fixa, o trabalho
  // acontece quando o cliente libera. Somar uma "estimativa" deles inflava a
  // folha com dinheiro que talvez nem seja devido. Para esses vale o realizado;
  // previsão só existe para quem tem salário ou diária combinada.
  const porTrabalho = (r: { service_type: string; freelaConsultoria: boolean }) =>
    r.service_type === 'Consultoria' || r.freelaConsultoria
  const valorPrevisto = (r: typeof folhaData extends (infer U)[] | undefined ? U : never) =>
    porTrabalho(r) ? (r.actualAmount || 0) : (r.adjusted_amount ?? r.monthly_amount)
  const totalEstimativa = (folhaData ?? []).reduce((s, r) => s + valorPrevisto(r) + r.cost_assistance + (r.extrasAprovados || 0), 0)
  // Adiantamento não é gasto — fica fora deste total (ele reduz o pagamento)
  const totalExpenses = expenses?.filter(e => !ehAdiantamento(e)).reduce((s, e) => s + (Number(e.amount) || 0), 0) ?? 0
  const totalPago = payments?.filter(p => p.status === 'Pago').reduce((s, p) => s + (p.amount || 0), 0) ?? 0
  const totalAtrasado = payments?.filter(p => p.status === 'Pendente' && p.due_date < hojeISO()).reduce((s, p) => s + (p.amount || 0), 0) ?? 0

  // Lançamento do mês para um vínculo: casa por link_id quando existe (colaborador com
  // 2 clientes tem lançamentos separados); lançamentos antigos casam por colaborador
  const lancamentosDaLinha = (row: { linkId: string; employee?: { id: string } }) =>
    (payments ?? []).filter(p => {
      // Cancelado não conta: antes ele "ocupava" a linha e sumia o botão Gerar
      if (p.status === 'Cancelado') return false
      const plink = (p as { link_id?: string }).link_id
      return plink ? plink === row.linkId : p.employee_id === row.employee?.id
    })
  // O Real, quando existe, é o que vale. Antes a linha mostrava a Estimativa
  // (com botão "Pago") mesmo depois de gerado o Real — risco de pagar os dois.
  const payForLink = (row: { linkId: string; employee?: { id: string } }) => {
    const ls = lancamentosDaLinha(row)
    return ls.find(p => p.type === 'Real') ?? ls.find(p => p.status === 'Pendente') ?? ls[0]
  }

  type LinhaFolha = NonNullable<typeof folhaData>[number]
  const r2 = (v: number) => Math.round(v * 100) / 100

  // A conta do "A pagar", item por item — a mesma que o fechamento usa.
  // Antes a tela mostrava o salário CHEIO do Fixo mesmo com faltas, enquanto
  // o botão Real descontava: dois números diferentes para a mesma pessoa.
  const contaDaLinha = (row: LinhaFolha) => {
    const isFreela = row.service_type === 'Volante'
    const itens: { rotulo: string; valor: number; nota?: string }[] = []
    let baseFechamento: number
    if (porTrabalho(row)) {
      const n = row.actualVisits
      itens.push({ rotulo: `${n} visita${n !== 1 ? 's' : ''} registrada${n !== 1 ? 's' : ''}`, valor: row.actualAmount || 0 })
      baseFechamento = row.actualAmount || 0
    } else if (isFreela) {
      itens.push({
        rotulo: `${row.expDays} dia${row.expDays !== 1 ? 's' : ''} na agenda × ${formatCurrency(row.dailyRate || 0)}`,
        valor: row.adjusted_amount,
        nota: `Até agora: ${row.actualDays} dia${row.actualDays !== 1 ? 's' : ''} trabalhado${row.actualDays !== 1 ? 's' : ''} = ${formatCurrency(row.realAmt)}. O fechamento paga os dias trabalhados.`,
      })
      baseFechamento = row.realAmt
    } else {
      itens.push({
        rotulo: row.isPartialCycle && !row.payFullSalary
          ? `Salário proporcional (${Math.round(row.proportionalFactor * 100)}% do ciclo)`
          : 'Salário do mês',
        valor: row.adjusted_amount,
      })
      if (row.faltas > 0) {
        itens.push({ rotulo: `${row.faltas} falta${row.faltas > 1 ? 's' : ''} × ${formatCurrency(row.valorDia)} (salário ÷ 30)`, valor: -r2(row.faltas * row.valorDia) })
      }
      baseFechamento = row.realAmt
    }
    const extras: { rotulo: string; valor: number }[] = []
    if ((row.extrasAprovados || 0) > 0) extras.push({ rotulo: 'Extras aprovados', valor: row.extrasAprovados })
    if (row.cost_assistance > 0) extras.push({ rotulo: 'Ajuda de custo', valor: row.cost_assistance })
    const gastos = empGastos(row.linkId)
    if (gastos > 0) extras.push({ rotulo: 'Gastos e reembolsos aprovados', valor: gastos })
    const adiant = empAdiantamento(row.linkId)
    if (adiant > 0) extras.push({ rotulo: 'Adiantamento (já recebeu)', valor: -adiant })
    itens.push(...extras)
    const somaExtras = extras.reduce((s, i) => s + i.valor, 0)
    return {
      itens,
      total: Math.max(0, r2(itens.reduce((s, i) => s + i.valor, 0))),
      // O que o fechamento (botão Real) vai lançar hoje
      fechamento: Math.max(0, r2(baseFechamento + somaExtras)),
    }
  }

  const hojeStr = hojeISO()
  const em7dias = format(addDays(new Date(), 7), 'yyyy-MM-dd')

  const etapaDaLinha = (row: LinhaFolha) => {
    const ls = lancamentosDaLinha(row)
    const real = ls.find(p => p.type === 'Real')
    const pendentes = ls.filter(p => p.status === 'Pendente').sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    const pagos = ls.filter(p => p.status === 'Pago')
    const somaPaga = r2(pagos.reduce((s, p) => s + (Number(p.amount) || 0), 0))
    const somaPendente = r2(pendentes.reduce((s, p) => s + (Number(p.amount) || 0), 0))
    const etapa: Etapa = !ls.length ? 'lancar'
      : !pendentes.length ? 'pago'
      : !porTrabalho(row) && !real ? 'conferir'
      : 'pagar'
    const proximo = pendentes[0]
    const ultimoPago = pagos.map(p => (p as { paid_at?: string }).paid_at || '').sort().pop()
    return {
      etapa, real, pendentes, pagos, somaPaga, somaPendente, proximo, ultimoPago,
      atrasado: !!proximo && proximo.due_date < hojeStr,
      venceSemana: !!proximo && proximo.due_date >= hojeStr && proximo.due_date <= em7dias,
    }
  }

  // Tudo calculado uma vez por linha: a tela, os totais e os filtros usam o mesmo número
  const linhas = (folhaData ?? []).map(row => {
    const conta = contaDaLinha(row)
    const et = etapaDaLinha(row)
    const aberto = et.etapa === 'pago' ? 0
      : et.etapa === 'pagar' ? et.somaPendente
      : et.etapa === 'conferir' ? Math.max(0, r2(conta.fechamento - et.somaPaga))
      : conta.total
    // Lançado ≠ o que daria hoje (visita registrada depois, falta, gasto novo…)
    const lancado = r2(et.somaPaga + et.somaPendente)
    const divergente = (et.etapa === 'pagar' || et.etapa === 'pago') && Math.abs(lancado - conta.fechamento) >= 1
    return { row, conta, et, aberto, lancado, divergente }
  })
  type Linha = typeof linhas[number]

  const termoBusca = semAcento(busca.trim())
  const passaFiltro = (l: Linha) => {
    if (termoBusca && !semAcento(`${l.row.employee?.full_name || ''} ${l.row.client?.name || ''}`).includes(termoBusca)) return false
    if (!filtroEtapa) return true
    if (filtroEtapa === 'semana') return l.et.venceSemana
    if (filtroEtapa === 'atrasado') return l.et.atrasado
    return l.et.etapa === filtroEtapa
  }
  const contagem = {
    lancar: linhas.filter(l => l.et.etapa === 'lancar').length,
    conferir: linhas.filter(l => l.et.etapa === 'conferir').length,
    pagar: linhas.filter(l => l.et.etapa === 'pagar').length,
    pago: linhas.filter(l => l.et.etapa === 'pago').length,
    semana: linhas.filter(l => l.et.venceSemana).length,
    atrasado: linhas.filter(l => l.et.atrasado).length,
  }

  // Unlinked payment records (manual, no vínculo)
  const linkedEmpIds = new Set((folhaData ?? []).map(r => r.employee?.id).filter(Boolean))
  const unlinkedPayments = (payments ?? []).filter(p => {
    const eid = (p as { employee_id?: string }).employee_id
    return !eid || !linkedEmpIds.has(eid)
  })

  const cancelPayment = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase.from('payments').update({ status: 'Cancelado' }).eq('id', paymentId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Lançamento cancelado.'); qc.invalidateQueries({ queryKey: ['payments'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Excluir de vez — só permitido para lançamento já Cancelado (2 passos de segurança)
  const deletePayment = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase.from('payments').delete().eq('id', paymentId)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Lançamento excluído.'); qc.invalidateQueries({ queryKey: ['payments'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  // Helper: render a payment row table (used for unlinked/manual payments)
  const PaymentTable = ({ list }: { list: typeof unlinkedPayments }) => (
    list.length === 0
      ? <p className="text-sm text-gray-400 py-3 text-center">Nenhum lançamento.</p>
      : <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">COLABORADOR</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">VALOR</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">VENCIMENTO</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">STATUS</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    {(() => {
                      const emp = (p as { employee?: { id: string; full_name: string; status?: string } }).employee
                      return emp?.id ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            className="font-medium text-sm text-primary-700 hover:underline text-left"
                            onClick={() => navigate(`/colaboradores/${emp.id}`, { state: { tab: 'vinculos' } })}
                          >
                            {emp.full_name}
                          </button>
                          {emp.status && emp.status !== 'Ativo' && (
                            <span className="badge bg-red-100 text-red-600 text-xs">Inativo</span>
                          )}
                        </div>
                      ) : (
                        <p className="font-medium text-sm">{p.description}</p>
                      )
                    })()}
                    {p.category && <span className={`badge text-xs ml-1 ${CAT_COLORS[p.category] || 'bg-gray-100'}`}>{p.category}</span>}
                  </td>
                  <td className="px-3 py-2 font-semibold">{formatCurrency(p.amount)}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{formatDate(p.due_date)}</td>
                  <td className="px-3 py-2"><span className={`badge ${STATUS_COLORS[p.status] || 'bg-gray-100'}`}>{p.status}</span></td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      {p.status === 'Pendente' && (
                        <>
                          <button onClick={() => markPaid.mutate(p.id)} className="btn-primary text-xs flex items-center gap-1 py-1"><Check size={12} />Pago</button>
                          <button onClick={() => cancelPayment.mutate(p.id)} className="btn-ghost text-xs text-red-500 hover:text-red-700">Cancelar</button>
                        </>
                      )}
                      <button onClick={() => navigate(`/pagamentos/${p.id}/editar`)} className="btn-ghost text-xs">Editar</button>
                      {p.status === 'Cancelado' && (
                        <button
                          onClick={async () => { if (await confirmar({ titulo: 'Excluir este lançamento de vez?', texto: 'Não dá para desfazer.', perigo: true })) deletePayment.mutate(p.id) }}
                          className="btn-ghost text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                        ><Trash2 size={12} />Excluir</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Financeiro</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Pagamentos</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={baixarExcel} disabled={baixando} className="btn-secondary text-sm"
            title="Planilha com resumo, dia a dia, reembolsos e o histórico de pagamentos de todos os meses">
            <FileSpreadsheet size={16} /><span className="hidden sm:inline">{baixando ? 'Gerando...' : 'Baixar Excel'}</span>
          </button>
          <button onClick={() => exportToCSV(payments ?? [], 'pagamentos.csv')} className="btn-ghost text-sm hidden sm:inline-flex"><Download size={16} />CSV</button>
          <button onClick={() => navigate('/pagamentos/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
        </div>
      </div>

      {/* Resumo do mês: quanto é a folha, quanto já saiu e quanto falta.
          Antes eram 4 cartões aqui e outros 4 iguais dentro da aba — e o
          "Folha do mês" somava o salário cheio mesmo de quem tinha falta. */}
      {(() => {
        const folhaTotal = r2(linhas.reduce((s, l) => s + l.conta.total, 0))
        const outrosAbertos = unlinkedPayments.filter(p => p.status === 'Pendente').reduce((s, p) => s + (Number(p.amount) || 0), 0)
        const faltaPagar = r2(linhas.reduce((s, l) => s + l.aberto, 0) + outrosAbertos)
        const pct = totalPago + faltaPagar > 0 ? Math.round((totalPago / (totalPago + faltaPagar)) * 100) : 0
        return (
          <div className="card p-4 md:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-500 capitalize">
                  Folha de {new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </p>
                <p className="text-3xl md:text-4xl font-display font-extrabold text-ink-900 tnum mt-0.5">{formatCurrency(folhaTotal)}</p>
                <p className="text-xs text-ink-400 mt-0.5">{linhas.length} vínculo{linhas.length !== 1 ? 's' : ''} ativo{linhas.length !== 1 ? 's' : ''} no mês</p>
              </div>
              <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
                <div className="rounded-xl bg-green-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-green-700/80">Já pago</p>
                  <p className="text-sm md:text-base font-bold text-green-800 tnum">{formatCurrency(totalPago)}</p>
                </div>
                <div className="rounded-xl bg-amber-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700/80">Falta pagar</p>
                  <p className="text-sm md:text-base font-bold text-amber-800 tnum">{formatCurrency(faltaPagar)}</p>
                </div>
                <div className={`rounded-xl px-3 py-2 ${totalAtrasado > 0 ? 'bg-red-50' : 'bg-ink-50'}`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wide ${totalAtrasado > 0 ? 'text-red-700/80' : 'text-ink-400'}`}>Atrasado</p>
                  <p className={`text-sm md:text-base font-bold tnum ${totalAtrasado > 0 ? 'text-red-700' : 'text-ink-400'}`}>{formatCurrency(totalAtrasado)}</p>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                <div className="h-2 rounded-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-ink-400 mt-1">{pct}% pago
                {totalExpenses > 0 && <> · gastos e reembolsos no mês: {formatCurrency(totalExpenses)}</>}
                {expensesPendentes.length > 0 && <span className="text-amber-600 font-semibold"> · {expensesPendentes.length} reembolso{expensesPendentes.length > 1 ? 's' : ''} para analisar</span>}
              </p>
            </div>
          </div>
        )
      })()}

      {/* Reembolsos pedidos pelo portal, esperando decisão. O portal promete à
          colaboradora que o gestor vai aprovar — este é o lugar onde isso
          acontece. Sem aprovar, não entra no pagamento. */}
      {expensesPendentes.length > 0 && (
        <div className="card p-0 overflow-hidden border-l-4 border-l-amber-400">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-900">
              {expensesPendentes.length} reembolso{expensesPendentes.length > 1 ? 's' : ''} para analisar
            </p>
            <span className="text-xs text-amber-700">— só entra no pagamento depois que você aprovar</span>
          </div>
          <div className="divide-y divide-ink-100">
            {expensesPendentes.map(e => {
              const exp = e as {
                id: string; description: string; amount: number; category?: string
                receipt_url?: string; notes?: string; created_at?: string
                employee?: { full_name: string }
              }
              return (
                <div key={exp.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-900">{exp.employee?.full_name}</span>
                      <span className="text-sm text-ink-600">{exp.description}</span>
                      {exp.category && <span className="badge bg-ink-100 text-ink-600 text-xs">{exp.category}</span>}
                    </div>
                    <p className="text-xs text-ink-400 mt-0.5">
                      Pedido em {exp.created_at ? formatDate(exp.created_at.slice(0, 10)) : '—'}
                      {exp.notes ? ` · ${exp.notes}` : ''}
                    </p>
                  </div>
                  <span className="font-bold text-ink-900 tnum">{formatCurrency(Number(exp.amount))}</span>
                  {exp.receipt_url ? (
                    <SignedLink value={exp.receipt_url} bucket="arquivos"
                      className="btn-secondary text-xs inline-flex items-center gap-1 py-1">
                      <Paperclip size={12} /> Ver nota
                    </SignedLink>
                  ) : (
                    <span className="text-xs text-red-600 font-medium bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                      Sem nota anexada
                    </span>
                  )}
                  <div className="flex gap-1.5 w-full sm:w-auto">
                    <button onClick={() => reviewExpense.mutate({ id: exp.id, status: 'aprovado' })}
                      disabled={reviewExpense.isPending}
                      className="btn-primary text-xs py-2 flex-1 sm:flex-none"><Check size={12} />Aprovar</button>
                    <button onClick={() => reviewExpense.mutate({ id: exp.id, status: 'negado' })}
                      disabled={reviewExpense.isPending}
                      className="btn-secondary text-xs py-2 text-red-600 flex-1 sm:flex-none"><X size={12} />Negar</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mês + abas */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 card p-1">
          <button className="p-2 rounded-lg hover:bg-ink-100 active:scale-95" aria-label="Mês anterior"
            onClick={() => setFilterMonth(m => format(addDays(new Date(m + '-15'), -30), 'yyyy-MM'))}>
            <ChevronLeft size={18} />
          </button>
          <input className="bg-transparent text-sm font-semibold text-ink-800 px-1 py-1.5 w-[8.5rem] text-center outline-none" type="month"
            value={filterMonth} onChange={e => e.target.value && setFilterMonth(e.target.value)} aria-label="Mês" />
          <button className="p-2 rounded-lg hover:bg-ink-100 active:scale-95" aria-label="Próximo mês"
            onClick={() => setFilterMonth(m => format(addDays(new Date(m + '-15'), 30), 'yyyy-MM'))}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex gap-1.5 ml-auto">
          {([
            ['folha', 'Folha do mês'],
            ['pagos', 'Pagos'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filtro por etapa + busca — acha rápido quem falta lançar, conferir ou pagar */}
      {tab === 'folha' && linhas.length > 0 && (
        <div className="space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9 pr-9" placeholder="Buscar colaborador ou cliente…" value={busca}
              onChange={e => setBusca(e.target.value)} enterKeyHint="search" />
            {busca && (
              <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Limpar busca">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap">
            {([
              ['', 'Todos', linhas.length, 'bg-ink-800 text-white'],
              ['lancar', 'A lançar', contagem.lancar, 'bg-ink-800 text-white'],
              ['conferir', 'A conferir', contagem.conferir, 'bg-amber-500 text-white'],
              ['pagar', 'A pagar', contagem.pagar, 'bg-amber-500 text-white'],
              ['semana', 'Vence em 7 dias', contagem.semana, 'bg-blue-600 text-white'],
              ['atrasado', 'Atrasados', contagem.atrasado, 'bg-red-600 text-white'],
              ['pago', 'Pagos', contagem.pago, 'bg-green-600 text-white'],
            ] as const).filter(([k, , n]) => k === '' || n > 0 || filtroEtapa === k).map(([k, rotulo, n, corAtiva]) => (
              <button key={k || 'todos'} onClick={() => setFiltroEtapa(k)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all active:scale-95 ${
                  filtroEtapa === k ? `${corAtiva} shadow-soft` : 'bg-white border border-ink-100 text-ink-600 hover:border-ink-200'}`}>
                {rotulo}
                <span className={`tnum rounded-full px-1.5 py-px text-[10px] ${filtroEtapa === k ? 'bg-white/25' : k === 'atrasado' ? 'bg-red-100 text-red-700' : 'bg-ink-100 text-ink-500'}`}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── FOLHA DO MÊS ── */}
      {tab === 'folha' && (
        <div className="space-y-4">
          {isLoading || folhaLoading
            ? <SkeletonRows count={6} />
            : (folhaData?.length ?? 0) === 0 && unlinkedPayments.length === 0
              ? <div className="card p-8 text-center text-gray-400">Nenhum colaborador com vínculo ativo e valor definido. Adicione um vínculo com salário para aparecer aqui.</div>
              : <>
              {/* Sem vínculo ativo, mas existem lançamentos avulsos no mês —
                  mostra o aviso e deixa "Outros Lançamentos" visível abaixo */}
              {(folhaData?.length ?? 0) === 0 && (
                <div className="card p-5 text-center text-gray-400 text-sm">
                  Nenhum colaborador com vínculo ativo e valor definido — abaixo estão os lançamentos avulsos deste mês.
                </div>
              )}
              {/* Gráficos colapsáveis */}
              <button
                onClick={() => setShowCharts(!showCharts)}
                className="flex items-center gap-2 text-sm font-medium text-ink-500 hover:text-ink-700 transition-colors"
              >
                <BarChart3 size={15} />
                Gráficos
                {showCharts ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {showCharts && (() => {
                const groupTotals = [
                  { name: 'Consultoria', value: (folhaData ?? []).filter(r => r.group === 'consultoria').reduce((s, r) => s + valorPrevisto(r), 0), color: '#f97316' },
                  { name: 'Fixo / Plantão', value: (folhaData ?? []).filter(r => r.group === 'fixo_plantao').reduce((s, r) => s + valorPrevisto(r), 0), color: '#3b82f6' },
                  { name: 'Freelas', value: (folhaData ?? []).filter(r => r.group === 'freela').reduce((s, r) => s + valorPrevisto(r), 0), color: '#a855f7' },
                ].filter(g => g.value > 0)
                const byEmployee = (folhaData ?? []).map(r => ({
                  name: r.employee?.full_name?.split(' ').slice(0, 2).join(' ') || '-',
                  Estimativa: r.monthly_amount,
                  'Aj. Custo': r.cost_assistance,
                })).sort((a, b) => (b.Estimativa + b['Aj. Custo']) - (a.Estimativa + a['Aj. Custo'])).slice(0, 8)
                const totalGroups = groupTotals.reduce((s, g) => s + g.value, 0)
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="card p-4">
                      <p className="font-semibold text-gray-900 text-sm mb-3">Distribuição por tipo</p>
                      {groupTotals.length > 0 ? (
                        <>
                          <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={groupTotals} cx="50%" cy="50%" innerRadius={45} outerRadius={68} dataKey="value" paddingAngle={3}>
                                  {groupTotals.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                                </Pie>
                                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                                <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {groupTotals.map((g, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-2 rounded-full" style={{ width: `${(g.value / totalGroups) * 100}%`, backgroundColor: g.color }} />
                                </div>
                                <span className="text-xs font-medium text-gray-700 w-28 text-right">{formatCurrency(g.value)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : <p className="text-center text-sm text-gray-400 py-8">Sem dados</p>}
                    </div>
                    <div className="card p-4">
                      <p className="font-semibold text-gray-900 text-sm mb-3">Top colaboradores</p>
                      {byEmployee.length > 0 ? (
                        <div className="h-52">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={byEmployee} layout="vertical" margin={{ left: 0, right: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
                              <Tooltip formatter={(v: number) => formatCurrency(v)} />
                              <Bar dataKey="Estimativa" fill="#6366f1" radius={[0, 4, 4, 0]} />
                              <Bar dataKey="Aj. Custo" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      ) : <p className="text-center text-sm text-gray-400 py-8">Sem dados</p>}
                    </div>
                  </div>
                )
              })()}

              {/* Colaboradores agrupados por tipo. Cada linha mostra UMA próxima
                  ação (Lançar → Conferir → Pagar). Antes a mesma linha tinha
                  Gerar, Real, Pago e Editar juntos — fácil pagar a coisa errada. */}
              {linhas.filter(passaFiltro).length === 0 && (busca || filtroEtapa) && (
                <div className="card p-6 text-center">
                  <p className="text-sm font-semibold text-ink-700">Ninguém nesse filtro</p>
                  <button onClick={() => { setBusca(''); setFiltroEtapa('') }} className="text-xs text-primary-700 font-semibold mt-1 hover:underline">Limpar filtros</button>
                </div>
              )}
              {([
                { key: 'consultoria' as WorkerGroup, label: 'Consultoria', icon: '🏥', dot: 'bg-orange-400' },
                { key: 'fixo_plantao' as WorkerGroup, label: 'Fixos / Plantão', icon: '📅', dot: 'bg-blue-400' },
                { key: 'freela' as WorkerGroup, label: 'Freelas', icon: '⚡', dot: 'bg-purple-400' },
              ]).map(({ key, label, icon, dot }) => {
                const doGrupo = linhas.filter(l => l.row.group === key)
                const visiveis = doGrupo.filter(passaFiltro)
                if (!visiveis.length) return null
                const totalGrupo = r2(doGrupo.reduce((s, l) => s + l.conta.total, 0))
                const faltaGrupo = r2(doGrupo.reduce((s, l) => s + l.aberto, 0))
                return (
                  <div key={key} className="card overflow-hidden">
                    <div className="px-4 py-3 bg-ink-50/70 border-b border-ink-100 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-base">{icon}</span>
                        <span className="font-display font-bold text-ink-900">{label}</span>
                        <span className="badge bg-white border border-ink-200 text-ink-600 text-xs">{doGrupo.length}</span>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-ink-900 tnum">{formatCurrency(totalGrupo)}</p>
                        <p className="text-[11px] text-ink-400 tnum">{faltaGrupo > 0 ? `falta ${formatCurrency(faltaGrupo)}` : 'tudo pago'}</p>
                      </div>
                    </div>
                    <div className="divide-y divide-ink-100">
                      {visiveis.map(({ row, conta, et, lancado, divergente }) => {
                        const isFreela = row.service_type === 'Volante'
                        const isConsultoria = porTrabalho(row)
                        const diff = isConsultoria ? 0 : row.actualDays - row.expDaysToDate
                        const isShort = !isConsultoria && row.actualDays < row.expDaysToDate
                        const nome = row.employee?.full_name || '—'
                        const contaVisivel = contaAberta === row.linkId

                        // A ação principal da linha — só uma
                        const acao = et.etapa === 'lancar'
                          ? {
                              rotulo: isConsultoria ? 'Lançar pagamento' : 'Lançar previsão',
                              dica: isConsultoria ? 'Cria o pagamento pelas visitas registradas (dia 20 e dia 8)' : 'Cria a previsão do mês. Depois você confere pelo realizado.',
                              fazer: () => autoGeneratePayment.mutate(row),
                              ocupado: autoGeneratePayment.isPending,
                              icone: <Plus size={15} />,
                              estilo: 'btn-secondary',
                            }
                          : et.etapa === 'conferir'
                            ? {
                                rotulo: `Conferir e fechar · ${formatCurrency(Math.max(0, conta.fechamento - et.somaPaga))}`,
                                dica: isFreela
                                  ? `Fecha pelos dias trabalhados: ${row.actualDays} × ${formatCurrency(row.dailyRate || 0)}. A previsão pendente é cancelada.`
                                  : row.faltas > 0
                                    ? `Salário − ${row.faltas} falta(s) × ${formatCurrency(row.valorDia)}. A previsão pendente é cancelada.`
                                    : 'Escala cumprida: fecha pelo salário integral. A previsão pendente é cancelada.',
                                fazer: () => generateRealPayment.mutate(row),
                                ocupado: generateRealPayment.isPending,
                                icone: <RefreshCw size={15} />,
                                estilo: 'btn-secondary border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100',
                              }
                            : et.etapa === 'pagar' && et.proximo
                              ? {
                                  rotulo: `Marcar pago · ${formatCurrency(Number(et.proximo.amount) || 0)}`,
                                  dica: `${et.proximo.description || ''} — vence ${formatDate(et.proximo.due_date)}`,
                                  fazer: async () => {
                                    const p = et.proximo!
                                    if (await confirmar({
                                      titulo: `Confirmar pagamento de ${formatCurrency(Number(p.amount) || 0)}?`,
                                      texto: `${nome}${row.client ? ` · ${row.client.name}` : ''}\n${p.description || ''}`,
                                      confirmar: 'Sim, foi pago',
                                    })) markPaid.mutate(p.id)
                                  },
                                  ocupado: markPaid.isPending,
                                  icone: <Check size={15} />,
                                  estilo: 'btn-primary',
                                }
                              : null

                        return (
                          <div key={row.linkId} className="p-4 space-y-3">
                            {/* Quem é + quanto */}
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <button
                                  className="font-semibold text-ink-900 hover:text-primary-700 hover:underline text-left leading-snug"
                                  onClick={() => navigate(`/colaboradores/${row.employee?.id}`, { state: { tab: 'vinculos' } })}
                                >
                                  {nome}
                                </button>
                                <div className="flex items-center gap-1.5 flex-wrap mt-1 text-xs text-ink-500">
                                  {row.client?.name && <span className="font-medium text-ink-600">{row.client.name}</span>}
                                  {row.work_schedule && <span className="badge bg-ink-100 text-ink-600 text-[10px]">{row.work_schedule}</span>}
                                  {isFreela && <span className="badge bg-purple-100 text-purple-700 text-[10px]">⚡ Freela{row.freelaConsultoria ? ' · Consultoria' : ''}</span>}
                                  {isFreela && row.startDate
                                    ? <span className="text-ink-400">{formatDate(row.startDate)}{row.freelaEnd ? ` → ${formatDate(row.freelaEnd)}` : ''}</span>
                                    : row.startDate && <span className="text-ink-400">desde {formatDate(row.startDate)}</span>}
                                  {row.payFullSalary && !isConsultoria && <span className="badge bg-blue-50 text-blue-700 text-[10px]">Salário inteiro</span>}
                                </div>
                              </div>
                              <button
                                onClick={() => setContaAberta(contaVisivel ? null : row.linkId)}
                                className={`text-right shrink-0 rounded-xl px-3 py-1.5 transition-all active:scale-95 ${contaVisivel ? 'bg-primary-100' : 'bg-primary-50 hover:bg-primary-100'}`}
                                title="Ver a conta"
                                aria-expanded={contaVisivel}
                              >
                                <span className="flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary-700/80">
                                  A pagar {contaVisivel ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                </span>
                                <span className="block text-base md:text-lg font-display font-extrabold text-primary-800 tnum leading-tight">{formatCurrency(conta.total)}</span>
                              </button>
                            </div>

                            {/* Como está o mês */}
                            <div className="flex items-center gap-1.5 flex-wrap text-xs">
                              {isConsultoria ? (
                                <span className="rounded-lg bg-orange-50 text-orange-800 px-2 py-1 font-medium">
                                  {row.actualVisits} visita{row.actualVisits !== 1 ? 's' : ''} · {formatCurrency(row.actualAmount || 0)}
                                </span>
                              ) : isFreela ? (
                                <span className="rounded-lg bg-purple-50 text-purple-800 px-2 py-1 font-medium">
                                  {row.actualDays}/{row.expDays} dias · diária {formatCurrency(row.dailyRate || 0)}
                                </span>
                              ) : (
                                <>
                                  <span className="rounded-lg bg-ink-100 text-ink-700 px-2 py-1 font-medium">Salário {formatCurrency(row.monthly_amount)}</span>
                                  <span className={`rounded-lg px-2 py-1 font-semibold ${row.faltas > 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                                    {row.faltas > 0
                                      ? `${row.faltas} falta${row.faltas > 1 ? 's' : ''} · −${formatCurrency(row.faltas * row.valorDia)}`
                                      : row.payFullSalary ? 'Sem desconto' : row.presencaCompleta ? 'Foi todos os dias' : 'Escala OK'}
                                  </span>
                                  <span className="text-ink-400">{row.actualDays}/{row.faltas > 0 ? row.diasCobraveis : row.expDays} dias{row.faltas > 0 ? ' até hoje' : ''}</span>
                                </>
                              )}
                              {row.ausencias.length > 0 && (
                                <span className="text-ink-500">
                                  {row.ausenciasComAtestado.length > 0 && <span className="text-blue-600">{row.ausenciasComAtestado.length} c/ atestado</span>}
                                  {row.ausenciasComAtestado.length > 0 && row.ausencias.length > row.ausenciasComAtestado.length && ' · '}
                                  {row.ausencias.length > row.ausenciasComAtestado.length && <span className="text-red-500">{row.ausencias.length - row.ausenciasComAtestado.length} s/ atestado</span>}
                                </span>
                              )}
                              {isShort && row.faltas === 0 && <span className="text-amber-600 font-medium">{Math.abs(diff)} dia(s) sem registro</span>}
                              {row.reportRequired && row.semRelatorio > 0 && (
                                <span className="text-red-600 font-medium">📄 {row.semRelatorio} sem relatório</span>
                              )}
                              {row.reportRequired && row.semRelatorio === 0 && (row.actualVisits > 0 || row.actualDays > 0) && (
                                <span className="text-green-600">📄 Relatórios OK</span>
                              )}
                            </div>

                            {/* A conta, item por item */}
                            {contaVisivel && (
                              <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-sm space-y-1.5 animate-fade-in">
                                {conta.itens.map((i, idx) => (
                                  <div key={idx} className="flex items-start justify-between gap-3">
                                    <span className="text-ink-600 min-w-0">
                                      {i.rotulo}
                                      {i.nota && <span className="block text-[11px] text-ink-400 leading-snug">{i.nota}</span>}
                                    </span>
                                    <span className={`tnum font-semibold whitespace-nowrap ${i.valor < 0 ? 'text-red-600' : 'text-ink-800'}`}>
                                      {i.valor < 0 ? '− ' : ''}{formatCurrency(Math.abs(i.valor))}
                                    </span>
                                  </div>
                                ))}
                                <div className="border-t border-ink-200 pt-1.5 flex justify-between font-bold text-ink-900">
                                  <span>A pagar</span><span className="tnum">{formatCurrency(conta.total)}</span>
                                </div>
                                {et.somaPaga > 0 && (
                                  <div className="flex justify-between text-xs text-green-700 font-medium">
                                    <span>Já pago neste mês</span><span className="tnum">{formatCurrency(et.somaPaga)}</span>
                                  </div>
                                )}
                                {conta.fechamento !== conta.total && (
                                  <p className="text-[11px] text-ink-400">Pelo realizado até hoje o fechamento daria {formatCurrency(conta.fechamento)}.</p>
                                )}
                              </div>
                            )}

                            {/* Etapa + a próxima ação */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <Etapas etapa={et.etapa} porTrabalho={isConsultoria} />
                              <span className="text-[11px] text-ink-500">
                                {et.etapa === 'pago'
                                  ? <span className="text-green-700 font-semibold">✓ Pago{et.ultimoPago ? ` em ${formatDate(et.ultimoPago.slice(0, 10))}` : ''}</span>
                                  : et.atrasado ? <span className="text-red-600 font-semibold">Atrasado desde {formatDate(et.proximo!.due_date)}</span>
                                  : et.proximo ? <>Vence {formatDate(et.proximo.due_date)}{et.pendentes.length > 1 ? ` (+${et.pendentes.length - 1})` : ''}</>
                                  : null}
                              </span>
                              <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
                                {acao && (
                                  <button onClick={acao.fazer} disabled={acao.ocupado} title={acao.dica}
                                    className={`${acao.estilo} text-sm flex-1 sm:flex-none py-2`}>
                                    {acao.icone}{acao.rotulo}
                                  </button>
                                )}
                                <button onClick={() => setAcoesDe(row.linkId)} className="btn-secondary px-2.5 py-2" aria-label="Mais ações" title="Mais ações">
                                  <MoreHorizontal size={18} />
                                </button>
                              </div>
                            </div>
                            {acao && <p className="text-[11px] text-ink-400 -mt-1 sm:text-right">{acao.dica}</p>}

                            {/* Lançado não bate com o que daria hoje */}
                            {divergente && (
                              <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                                <span>
                                  <strong>O valor mudou depois do lançamento.</strong> Lançado {formatCurrency(lancado)}; pelo que está registrado hoje daria {formatCurrency(conta.fechamento)}.
                                  {et.proximo && <> <button className="underline font-semibold" onClick={() => navigate(`/pagamentos/${et.proximo!.id}/editar`)}>Ajustar lançamento</button></>}
                                </span>
                              </div>
                            )}

                            {/* Extra aguardando decisão. Ficava invisível aqui: só extra
                                APROVADO entra no valor, então quem lançou um extra via o
                                pagamento sair sem ele e sem nenhum aviso. */}
                            {(row.extrasPendentes?.length || 0) > 0 && (
                              <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                                <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                                  <AlertTriangle size={13} className="text-amber-600" />
                                  {row.extrasPendentes.length} extra{row.extrasPendentes.length > 1 ? 's' : ''} aguardando sua decisão
                                  <span className="font-normal text-amber-700">
                                    — {row.extrasPendentes.map(v => formatDate(v.visit_date)).join(', ')}. Só entra no pagamento depois de aprovar.
                                  </span>
                                </span>
                                <button onClick={() => navigate('/visitas')} className="text-xs font-semibold text-amber-900 underline whitespace-nowrap">
                                  Decidir agora →
                                </button>
                              </div>
                            )}

                            {/* Situações do ciclo que mudam o valor */}
                            {!isConsultoria && (row.isPartialCycle || row.startsAfterCycle) && (
                              <div className={`flex items-center justify-between gap-2 flex-wrap rounded-xl px-3 py-2 text-xs ${row.startsAfterCycle && !row.payFullSalary ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
                                <span className="flex items-center gap-1.5">
                                  <AlertTriangle size={13} />
                                  {row.startsAfterCycle && !row.payFullSalary
                                    ? `Começou ${formatDate(row.startDate!)}, depois do fechamento do ciclo — nada a pagar neste mês.`
                                    : `Entrou no meio do ciclo (${formatDate(row.startDate!)}) — ${row.payFullSalary ? 'pagando salário inteiro' : `proporcional: ${formatCurrency(row.adjusted_amount)}`}.`}
                                </span>
                                <button className="font-semibold underline whitespace-nowrap"
                                  onClick={() => togglePayFull.mutate({ linkId: row.linkId, value: !row.payFullSalary })}>
                                  {row.payFullSalary ? 'Voltar ao proporcional' : 'Pagar inteiro'}
                                </button>
                              </div>
                            )}

                            {/* Formulário de gasto / adiantamento */}
                            {newExpenseEmpId === row.linkId && (
                              <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm font-semibold text-ink-800">Lançar gasto ou adiantamento</p>
                                  <button className="p-1 rounded-lg text-ink-400 hover:bg-ink-100" onClick={() => setNewExpenseEmpId(null)} aria-label="Fechar"><X size={16} /></button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <input className="input text-sm sm:col-span-2" placeholder="Descrição *" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} />
                                  <input className="input text-sm" type="number" inputMode="decimal" placeholder="Valor R$ *" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} />
                                  <select className="input text-sm" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>
                                    <option>Reembolso</option><option>Ajuda de Custo</option><option>Vale Transporte</option>
                                    <option value="Adiantamento">Adiantamento (desconta do pagamento)</option>
                                    <option>Alimentação</option><option>Material</option><option>Outro</option>
                                  </select>
                                  <input className="input text-sm sm:col-span-2" placeholder="Observação (opcional)" value={expForm.notes} onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))} />
                                </div>
                                <div className="flex gap-2">
                                  <button className="btn-primary text-sm flex-1 sm:flex-none" onClick={() => addExpense.mutate({ empId: row.employee!.id, clientId: row.client?.id })} disabled={addExpense.isPending || !expForm.description || !expForm.amount}>Salvar</button>
                                  <button className="btn-ghost text-sm" onClick={() => setNewExpenseEmpId(null)}>Cancelar</button>
                                </div>
                              </div>
                            )}

                            <details>
                              <summary className="text-xs font-semibold text-primary-700 cursor-pointer hover:underline select-none">
                                {row.visits.length > 0 ? `${row.visits.length} registro${row.visits.length > 1 ? 's' : ''} de ponto` : 'Registros'}
                                {gastosDaLinha(row.linkId).length > 0 ? ` · ${gastosDaLinha(row.linkId).length} gasto${gastosDaLinha(row.linkId).length > 1 ? 's' : ''}` : ''}
                                {row.cycleStart && row.cycleEnd && !isConsultoria ? ` · ciclo ${formatDate(row.cycleStart)} – ${formatDate(row.cycleEnd)}` : ''}
                              </summary>
                              {row.visits.length > 0 && (
                                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
                                  {row.visits.slice(0, 31).map((v, i) => {
                                    const trabalhada = !!v.check_in && !(v as { is_unavailable?: boolean }).is_unavailable && !(v as { is_holiday?: boolean }).is_holiday
                                    return (
                                      <div key={i} className="text-xs bg-ink-50 rounded-lg px-2 py-1 flex items-center justify-between gap-1">
                                        <span className="text-ink-600">{formatDate(v.visit_date)}</span>
                                        <span className="text-ink-400">{v.check_in?.slice(0, 5)} – {v.check_out?.slice(0, 5) || '?'}</span>
                                        {row.reportRequired && trabalhada && (
                                          (v as { report_url?: string }).report_url
                                            ? <span className="text-green-600" title="Relatório anexado">📄✓</span>
                                            : <span className="text-red-500 font-medium" title="Relatório pendente">📄✗</span>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                              {isConsultoria && row.actualVisits > 0 && (row.visits as { observations?: string }[]).some(v => v.observations) && (
                                <p className="mt-2 text-xs text-amber-600">⚠ Há observações nos registros</p>
                              )}
                              <div className="mt-3 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-ink-500">Gastos / ajuda de custo</span>
                                  <button className="btn-secondary text-xs py-1" onClick={() => setNewExpenseEmpId(newExpenseEmpId === row.linkId ? null : row.linkId)}>
                                    <Plus size={12} /> Novo gasto
                                  </button>
                                </div>
                                {row.cost_assistance > 0 && (
                                  <div className="flex items-center justify-between text-xs bg-blue-50 rounded-lg px-2 py-1">
                                    <span className="text-blue-700">🚗 Ajuda de custo (contrato)</span>
                                    <span className="font-medium text-blue-800">{formatCurrency(row.cost_assistance)}</span>
                                  </div>
                                )}
                                {gastosDaLinha(row.linkId).map(e => {
                                  const exp = e as { id: string; description: string; category?: string; amount: number; status?: string }
                                  const pendente = exp.status === 'pendente'
                                  const negado = exp.status === 'negado'
                                  const adiant = exp.category === 'Adiantamento'
                                  return (
                                    <div key={exp.id} className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2 py-1.5 ${negado ? 'bg-ink-100 opacity-60' : adiant ? 'bg-emerald-50' : 'bg-orange-50'}`}>
                                      <span className={`min-w-0 ${negado ? 'text-ink-500 line-through' : adiant ? 'text-emerald-800' : 'text-orange-700'}`}>
                                        {adiant ? '↩' : '💸'} {exp.description} <span className="text-ink-400">({adiant ? 'adiantamento — desconta' : exp.category})</span>
                                        {/* Sem isso, pendente e aprovado ficavam iguais na tela
                                            e só o aprovado entra no pagamento. */}
                                        {pendente && <span className="ml-1 text-amber-700 font-semibold">— aguardando análise</span>}
                                        {negado && <span className="ml-1 text-ink-500">— negado</span>}
                                      </span>
                                      <span className="flex items-center gap-1.5 shrink-0">
                                        <span className={`font-medium ${negado ? 'text-ink-400' : adiant ? 'text-emerald-800' : 'text-orange-800'}`}>{adiant ? '−' : ''}{formatCurrency(Number(exp.amount))}</span>
                                        {confirmDelExpense === exp.id ? (
                                          <>
                                            <button onClick={() => { deleteExpense.mutate(exp.id); setConfirmDelExpense(null) }}
                                              className="text-[10px] bg-red-600 text-white px-1.5 py-0.5 rounded font-medium hover:bg-red-700">Apagar</button>
                                            <button onClick={() => setConfirmDelExpense(null)}
                                              className="text-[10px] text-ink-400 hover:text-ink-600">não</button>
                                          </>
                                        ) : (
                                          <button onClick={() => setConfirmDelExpense(exp.id)}
                                            title="Apagar este lançamento"
                                            className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                                            <Trash2 size={12} />
                                          </button>
                                        )}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </details>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Mais ações de uma linha — janela que sobe de baixo no celular */}
              {(() => {
                const l = linhas.find(x => x.row.linkId === acoesDe)
                if (!l) return null
                const { row, et } = l
                const porTrab = porTrabalho(row)
                const fechar = () => setAcoesDe(null)
                const Item = ({ onClick, children, perigo }: { onClick: () => void; children: React.ReactNode; perigo?: boolean }) => (
                  <button onClick={() => { fechar(); onClick() }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-medium active:scale-[0.99] transition-all ${perigo ? 'text-red-600 hover:bg-red-50' : 'text-ink-800 hover:bg-ink-50'}`}>
                    {children}
                  </button>
                )
                return (
                  <div className="modal-overlay" onClick={fechar}>
                    <div className="modal-box max-w-sm space-y-1" onClick={e => e.stopPropagation()}>
                      <div className="px-3 pb-2">
                        <p className="font-display font-bold text-ink-900">{row.employee?.full_name}</p>
                        <p className="text-xs text-ink-400">{row.client?.name}</p>
                      </div>
                      {et.proximo && (
                        <Item onClick={() => navigate(`/pagamentos/${et.proximo!.id}/editar`)}><Pencil size={16} className="text-ink-400" />Editar lançamento pendente</Item>
                      )}
                      {!porTrab && et.etapa === 'lancar' && (
                        <Item onClick={() => generateRealPayment.mutate(row)}><RefreshCw size={16} className="text-ink-400" />Fechar direto pelo realizado</Item>
                      )}
                      {et.etapa === 'conferir' && et.proximo && (
                        <Item onClick={async () => {
                          const p = et.proximo!
                          if (await confirmar({
                            titulo: 'Pagar a previsão sem conferir?',
                            texto: `${formatCurrency(Number(p.amount) || 0)} — faltas e dias registrados depois NÃO entram. O normal é "Conferir e fechar".`,
                            confirmar: 'Marcar previsão como paga',
                          })) markPaid.mutate(p.id)
                        }}><Check size={16} className="text-ink-400" />Marcar a previsão como paga</Item>
                      )}
                      <Item onClick={() => { setNewExpenseEmpId(row.linkId); setExpForm({ description: '', amount: '', category: 'Reembolso', notes: '' }) }}>
                        <Plus size={16} className="text-ink-400" />Lançar gasto ou adiantamento
                      </Item>
                      {!porTrab && (
                        <Item onClick={() => togglePayFull.mutate({ linkId: row.linkId, value: !row.payFullSalary })}>
                          <Wallet size={16} className="text-ink-400" />{row.payFullSalary ? 'Voltar a descontar faltas' : 'Pagar salário inteiro (sem descontar faltas)'}
                        </Item>
                      )}
                      <Item onClick={() => navigate(`/colaboradores/${row.employee?.id}`, { state: { tab: 'vinculos' } })}>
                        <ExternalLink size={16} className="text-ink-400" />Abrir ficha do colaborador
                      </Item>
                      {et.proximo && (
                        <Item perigo onClick={async () => {
                          const p = et.proximo!
                          if (await confirmar({
                            titulo: 'Cancelar este lançamento?',
                            texto: `${p.description || ''}\n${formatCurrency(Number(p.amount) || 0)} — a linha volta para a etapa anterior e dá para lançar de novo.`,
                            confirmar: 'Cancelar lançamento', cancelar: 'Voltar', perigo: true,
                          })) cancelPayment.mutate(p.id)
                        }}><X size={16} />Cancelar lançamento pendente</Item>
                      )}
                      <button onClick={fechar} className="btn-secondary w-full mt-2">Fechar</button>
                    </div>
                  </div>
                )
              })()}

              {/* Unlinked manual payments */}
              {unlinkedPayments.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base">📄</span>
                        <span className="font-semibold text-gray-700">Outros Lançamentos</span>
                        <span className="badge bg-gray-200 text-gray-600 text-xs">{unlinkedPayments.length}</span>
                      </div>
                      <p className="font-bold text-gray-700">{formatCurrency(unlinkedPayments.reduce((s, p) => s + (p.amount || 0), 0))}</p>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">Lançamentos manuais sem vínculo ativo.</p>
                  </div>
                  <PaymentTable list={unlinkedPayments} />
                </div>
              )}
            </>
          }
        </div>
      )}

      {/* ── PAGOS TAB ── */}
      {tab === 'pagos' && (
        <div className="space-y-4">
          {(() => {
            const paidList = (payments ?? []).filter(p => p.status === 'Pago')
            const totalReal = paidList.reduce((s, p) => s + (p.amount || 0), 0)
            if (!paidList.length) return (
              <div className="card p-8 text-center text-gray-400">
                Nenhum pagamento confirmado neste mês.<br />
                <span className="text-xs mt-1 block">Marque como <strong>Pago</strong> na aba Folha do Mês.</span>
              </div>
            )
            return (
              <div className="space-y-3">
                <div className="card p-4 bg-green-50 border-green-200 flex justify-between items-center">
                  <span className="text-sm font-medium text-green-800">Total Real Pago</span>
                  <span className="text-xl font-bold text-green-800">{formatCurrency(totalReal)}</span>
                </div>
                {/* Celular: cards — a tabela cortava o valor na lateral */}
                <div className="md:hidden space-y-2">
                  {paidList.map(p => {
                    const emp = (p as { employee?: { full_name: string } }).employee
                    return (
                      <div key={p.id} className="card p-3 cursor-pointer active:scale-[0.99] transition-transform"
                        onClick={() => navigate(`/pagamentos/${p.id}`)}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink-900 truncate">{emp?.full_name || '—'}</p>
                            <p className="text-xs text-ink-500 truncate">{p.description}</p>
                            <p className="text-xs text-ink-400 mt-0.5">Vence {formatDate(p.due_date)}</p>
                          </div>
                          <span className="font-bold text-green-700 whitespace-nowrap">{formatCurrency(p.amount || 0)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Computador: tabela */}
                <div className="hidden md:block card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Colaborador</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Descrição</th>
                        <th className="px-3 py-2 text-left text-xs text-gray-500 font-medium">Vencimento</th>
                        <th className="px-3 py-2 text-right text-xs text-gray-500 font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paidList.map(p => {
                        const emp = (p as { employee?: { full_name: string } }).employee
                        return (
                          <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/pagamentos/${p.id}`)}>
                            <td className="px-3 py-2 font-medium">{emp?.full_name || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{p.description}</td>
                            <td className="px-3 py-2 text-gray-500">{formatDate(p.due_date)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-green-700">{formatCurrency(p.amount || 0)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t">
                      <tr>
                        <td colSpan={3} className="px-3 py-2 text-xs font-semibold text-gray-600">Total</td>
                        <td className="px-3 py-2 text-right font-bold text-green-800">{formatCurrency(totalReal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}
        </div>
      )}


      {/* ── Modal: definir valor do vínculo ── */}
      {editAmountLink && (
        <div className="modal-overlay">
          <div className="modal-box max-w-sm space-y-4">
            <h3 className="font-bold text-lg">Definir valor mensal</h3>
            <p className="text-sm text-gray-600">{editAmountLink.name}</p>
            <div>
              <label className="label">Valor mensal (R$) *</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.01"
                placeholder="Ex: 600,00"
                value={editAmountVal}
                onChange={e => setEditAmountVal(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                className="btn-primary flex-1"
                disabled={!editAmountVal || updateLinkAmount.isPending}
                onClick={() => updateLinkAmount.mutate({ linkId: editAmountLink.linkId, amount: Number(editAmountVal) })}
              >
                {updateLinkAmount.isPending ? 'Salvando...' : 'Salvar'}
              </button>
              <button className="btn-ghost px-4" onClick={() => setEditAmountLink(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
