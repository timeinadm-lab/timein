import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Check, RefreshCw, AlertTriangle, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatCurrency } from '../../lib/utils'
import { exportToCSV } from '../../lib/exportUtils'
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns'
import toast from 'react-hot-toast'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'

type Tab = 'estimativa' | 'real' | 'analise'
type WorkerGroup = 'consultoria' | 'fixo_plantao' | 'temporario'

function workerGroup(serviceType: string | null, schedule: string | null): WorkerGroup {
  if (serviceType === 'Consultoria') return 'consultoria'
  if (schedule?.toLowerCase().includes('tempor')) return 'temporario'
  return 'fixo_plantao'
}

// Expected days by work schedule
function expectedDays(schedule: string | null, month: string): number {
  const [yr, mo] = month.split('-').map(Number)
  const totalDays = getDaysInMonth(new Date(yr, mo - 1))
  if (!schedule) return 22
  if (schedule.includes('6x1')) return Math.floor(totalDays * 6 / 7)
  if (schedule.includes('5x2')) return Math.floor(totalDays * 5 / 7)
  if (schedule.includes('12x36')) return Math.floor(totalDays * 1 / 3)
  if (schedule.toLowerCase().includes('tempor')) return totalDays
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

export default function PaymentList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('estimativa')
  const [filterMonth, setFilterMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [filterStatus, setFilterStatus] = useState('')
  const [newExpenseEmpId, setNewExpenseEmpId] = useState<string | null>(null)
  const [expForm, setExpForm] = useState({ description: '', amount: '', category: 'Reembolso', notes: '' })
  const [editAmountLink, setEditAmountLink] = useState<{ linkId: string; name: string; current: number } | null>(null)
  const [editAmountVal, setEditAmountVal] = useState('')

  const monthStart = format(startOfMonth(new Date(filterMonth + '-15')), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date(filterMonth + '-15')), 'yyyy-MM-dd')

  // ── Pagamentos — filter by reference_month (falls back to due_date range) ──
  const { data: payments, isLoading } = useQuery({
    queryKey: ['payments', filterMonth, filterStatus],
    queryFn: async () => {
      let q = supabase.from('payments').select('*, employee:employees(id,full_name,status)').order('due_date')
      // Try reference_month first, include records where it matches OR where due_date is in range and reference_month is null
      q = q.or(`reference_month.eq.${filterMonth},and(reference_month.is.null,due_date.gte.${monthStart},due_date.lte.${monthEnd})`)
      if (filterStatus) q = q.eq('status', filterStatus)
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
    mutationFn: async (empId: string) => {
      if (!expForm.description || !expForm.amount) throw new Error('Preencha descrição e valor')
      const { error } = await supabase.from('employee_expenses').insert({
        employee_id: empId,
        description: expForm.description,
        amount: Number(expForm.amount),
        category: expForm.category,
        notes: expForm.notes || null,
        reference_month: filterMonth,
      })
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

  // ── Folha de ponto: vínculos ativos + desligados com visitas pendentes ──
  const { data: folhaData, isLoading: folhaLoading } = useQuery({
    queryKey: ['folha-ponto', filterMonth],
    queryFn: async () => {
      // 1) Vínculos ativos
      const { data: rawLinks, error } = await supabase
        .from('employee_client_links')
        .select(`
          id, service_type, monthly_amount, work_schedule, expected_days_month, cost_assistance,
          employee:employees!inner(id, full_name, status),
          client:clients(id, name),
          payment_dates:employee_payment_dates(day_of_month, amount)
        `)
      if (error) throw error
      const activeLinks = (rawLinks || []).filter(l => (l as { employee?: { status?: string } }).employee?.status === 'Ativo')

      // 2) Visitas do mês de colaboradores desligados (sem vínculo ativo)
      const activeEmpIds = new Set(activeLinks.map(l => (l as { employee?: { id: string } }).employee?.id).filter(Boolean))
      const { data: monthVisits } = await supabase
        .from('nutritionist_visits')
        .select('employee_id, client_id, visit_date, check_in, check_out, visit_rate')
        .gte('visit_date', monthStart)
        .lte('visit_date', monthEnd)

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

      // Check which have real payments already
      const { data: realPayments } = await supabase
        .from('payments')
        .select('employee_id, amount, status')
        .eq('type', 'Real')
        .gte('due_date', monthStart)
        .lte('due_date', monthEnd)

      // Fallback: get vacancy financial data for employees with null monthly_amount
      const nullAmtEmpIds = links
        .filter(l => !l.monthly_amount)
        .map(l => (l as { employee?: { id: string } }).employee?.id)
        .filter(Boolean) as string[]

      let vacancyFallback: Record<string, { salary_amount: number | null; vacancy_units: { visit_rate: string | number; visits_per_month: string | number }[] | null }> = {}
      if (nullAmtEmpIds.length) {
        const { data: interests } = await supabase
          .from('vacancy_interests')
          .select('employee_id, vacancy:vacancies(salary_amount, vacancy_units, vacancy_type)')
          .in('employee_id', nullAmtEmpIds)
          .eq('status', 'Contratado')
        if (interests) {
          for (const i of interests) {
            const v = (i as { vacancy?: { salary_amount?: number; vacancy_units?: { visit_rate: string | number; visits_per_month: string | number }[]; vacancy_type?: string } }).vacancy
            if (v && i.employee_id) {
              let amt: number | null = null
              if (v.salary_amount) {
                amt = v.salary_amount
              } else if (v.vacancy_units?.length) {
                amt = v.vacancy_units.reduce((s, u) => s + (Number(u.visit_rate) || 0) * (Number(u.visits_per_month) || 0), 0)
              }
              vacancyFallback[i.employee_id] = { salary_amount: amt, vacancy_units: v.vacancy_units ?? null }
            }
          }
        }
      }

      return (links || []).map(l => {
        const emp = (l as { employee?: { id: string; full_name: string } }).employee
        const client = (l as { client?: { id: string; name: string } }).client
        const isConsultoria = l.service_type === 'Consultoria'
        const empVisits = visits?.filter(v => v.employee_id === emp?.id && v.client_id === client?.id) ?? []

        // Helper: duration in hours for a visit
        const visitHours = (v: { check_in?: string | null; check_out?: string | null }) => {
          if (!v.check_in || !v.check_out) return 0
          const [hi, mi] = v.check_in.slice(0,5).split(':').map(Number)
          const [ho, mo] = v.check_out.slice(0,5).split(':').map(Number)
          return (ho * 60 + mo - hi * 60 - mi) / 60
        }

        // Actual — for consultoria, visits <4h get proportional pay
        const actualDays = !isConsultoria ? empVisits.filter(v => v.check_out).length : 0
        const actualVisits = isConsultoria ? empVisits.length : 0
        const actualAmount = isConsultoria
          ? empVisits.reduce((s, v) => {
              const rate = Number(v.visit_rate) || 0
              if (!rate) return s
              const hours = visitHours(v)
              // <4h: proportional (hours/4 * rate); >=4h: full rate
              const earned = hours > 0 && hours < 4 ? (hours / 4) * rate : rate
              return s + earned
            }, 0)
          : null

        // Expected
        const expDays = !isConsultoria ? (l.expected_days_month || expectedDays(l.work_schedule, filterMonth)) : 0
        const fallback = emp?.id ? vacancyFallback[emp.id] : undefined
        const monthlyAmt = Number(l.monthly_amount) || Number(fallback?.salary_amount) || 0

        // Real amount for fixed = (actualDays / expDays) * monthly
        const realAmt = isConsultoria
          ? (actualAmount || 0)
          : expDays > 0 ? Math.round((actualDays / expDays) * monthlyAmt * 100) / 100 : 0

        const hasRealPayment = realPayments?.some(rp => rp.employee_id === emp?.id) ?? false

        const costAssistance = Number((l as { cost_assistance?: number }).cost_assistance) || 0
        const group = workerGroup(l.service_type, l.work_schedule)
        const payDates = (l as { payment_dates?: { day_of_month: number }[] }).payment_dates ?? []
        const payDay = payDates[0]?.day_of_month || 5

        return {
          linkId: l.id,
          employee: emp,
          client,
          service_type: l.service_type,
          work_schedule: l.work_schedule,
          monthly_amount: monthlyAmt,
          cost_assistance: costAssistance,
          actualDays,
          actualVisits,
          expDays,
          actualAmount,
          realAmt,
          hasRealPayment,
          visits: empVisits,
          group,
          payDay,
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

  const autoGeneratePayment = useMutation({
    mutationFn: async (row: { employee: { id: string; full_name: string } | undefined; client: { id: string; name: string } | undefined; monthly_amount: number; payDay?: number }) => {
      if (!row.employee) throw new Error('Sem colaborador')
      const dueDate = new Date(filterMonth + '-15')
      dueDate.setDate(row.payDay || 5)
      const monthLabel = new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      const { error } = await supabase.from('payments').insert({
        description: `Honorários – ${row.employee.full_name}${row.client ? ` (${row.client.name})` : ''} – ${monthLabel}`,
        amount: row.monthly_amount,
        due_date: dueDate.toISOString().slice(0, 10),
        status: 'Pendente',
        recurrence: 'Mensal',
        category: 'Salário',
        type: 'Estimativa',
        employee_id: row.employee.id,
        reference_month: filterMonth,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Lançamento gerado!')
      qc.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateRealPayment = useMutation({
    mutationFn: async (row: { employee: { id: string; full_name: string } | undefined; client: { id: string; name: string } | undefined; realAmt: number; linkId: string; payDay?: number }) => {
      if (!row.employee) throw new Error('Sem colaborador')
      const now = new Date()
      const payDay = row.payDay || 5
      const dueDate = new Date(now.getFullYear(), now.getMonth(), payDay)
      if (dueDate < now) dueDate.setMonth(dueDate.getMonth() + 1)
      const monthLabel = new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      const { error } = await supabase.from('payments').insert({
        description: `[REAL] Honorários – ${row.employee.full_name}${row.client ? ` (${row.client.name})` : ''} – ${monthLabel}`,
        amount: row.realAmt,
        due_date: dueDate.toISOString().slice(0, 10),
        status: 'Pendente',
        recurrence: 'Mensal',
        category: 'Salário',
        employee_id: row.employee.id,
        type: 'Real',
        reference_month: filterMonth,
      })
      if (error) throw error
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

  // Totals driven by active vinculos (folhaData), not by payments records
  const totalEstimativa = (folhaData ?? []).reduce((s, r) => s + r.monthly_amount + r.cost_assistance, 0)
  const totalExpenses = expenses?.reduce((s, e) => s + (Number(e.amount) || 0), 0) ?? 0
  const totalPago = payments?.filter(p => p.status === 'Pago').reduce((s, p) => s + (p.amount || 0), 0) ?? 0
  const totalAtrasado = payments?.filter(p => p.status === 'Pendente' && p.due_date < new Date().toISOString().slice(0, 10)).reduce((s, p) => s + (p.amount || 0), 0) ?? 0

  // Find payment record for a given employee this month
  const payForEmp = (empId: string) =>
    payments?.find(p => p.employee_id === empId && (!p.type || p.type !== 'Real'))

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
          <button onClick={() => exportToCSV(payments ?? [], 'pagamentos.csv')} className="btn-secondary text-sm"><Download size={16} />CSV</button>
          <button onClick={() => navigate('/pagamentos/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-l-blue-400">
          <p className="text-xs text-ink-500 font-semibold">Estimativa Salários</p>
          <p className="text-2xl font-display font-extrabold text-ink-900 mt-1 tnum">{formatCurrency(totalEstimativa)}</p>
          <p className="text-xs text-ink-400 mt-0.5">{folhaData?.length ?? 0} colaboradores</p>
        </div>
        <div className="card p-4 border-l-4 border-l-orange-400">
          <p className="text-xs text-ink-500 font-semibold">Gastos / Reembolsos</p>
          <p className="text-2xl font-display font-extrabold text-ink-900 mt-1 tnum">{formatCurrency(totalExpenses)}</p>
          <p className="text-xs text-ink-400 mt-0.5">{expenses?.length || 0} lançamentos</p>
        </div>
        <div className="card p-4 border-l-4 border-l-primary-400">
          <p className="text-xs text-ink-500 font-semibold">Total Pago</p>
          <p className="text-2xl font-display font-extrabold text-primary-700 mt-1 tnum">{formatCurrency(totalPago)}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-red-400">
          <p className="text-xs text-ink-500 font-semibold">Atrasado</p>
          <p className="text-2xl font-display font-extrabold text-red-600 mt-1 tnum">{formatCurrency(totalAtrasado)}</p>
        </div>
      </div>

      {/* Filters + Tabs */}
      <div className="space-y-3">
        <div className="card p-3 flex gap-2.5 flex-wrap items-center">
          <input className="input w-36" type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
          <select className="input w-36" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Todos status</option>
            <option>Pendente</option><option>Pago</option><option>Cancelado</option>
          </select>
          <span className="text-xs text-ink-400 ml-auto capitalize">
            {new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {([
            ['estimativa', 'Estimativa'],
            ['real', 'Real'],
            ['analise', 'Análise da Folha'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── ESTIMATIVA TAB ── */}
      {tab === 'estimativa' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
            <TrendingUp size={16} />
            Valores esperados para o mês. Gerados automaticamente ao criar vínculos.
          </div>

          {/* ── Gráficos ── */}
          {!isLoading && (folhaData?.length ?? 0) > 0 && (() => {
            // Distribuição por grupo — baseado nos vínculos ativos
            const groupTotals = [
              { name: 'Consultoria', value: (folhaData ?? []).filter(r => r.group === 'consultoria').reduce((s, r) => s + r.monthly_amount, 0), color: '#f97316' },
              { name: 'Fixo / Plantão', value: (folhaData ?? []).filter(r => r.group === 'fixo_plantao').reduce((s, r) => s + r.monthly_amount, 0), color: '#3b82f6' },
              { name: 'Temporário', value: (folhaData ?? []).filter(r => r.group === 'temporario').reduce((s, r) => s + r.monthly_amount, 0), color: '#f59e0b' },
            ].filter(g => g.value > 0)

            // Top colaboradores por custo
            const byEmployee = (folhaData ?? []).map(r => ({
              name: r.employee?.full_name?.split(' ').slice(0, 2).join(' ') || '-',
              Estimativa: r.monthly_amount,
              'Aj. Custo': r.cost_assistance,
            })).sort((a, b) => (b.Estimativa + b['Aj. Custo']) - (a.Estimativa + a['Aj. Custo'])).slice(0, 8)

            const totalGroups = groupTotals.reduce((s, g) => s + g.value, 0)

            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Donut — para onde vai o dinheiro */}
                <div className="card p-4">
                  <p className="font-semibold text-gray-900 text-sm mb-1">Para onde vai o dinheiro</p>
                  <p className="text-xs text-gray-400 mb-3">Distribuição por tipo de contrato — {format(new Date(filterMonth + '-15'), 'MMMM yyyy', { locale: undefined })}</p>
                  {groupTotals.length > 0 ? (
                    <>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={groupTotals} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={3}>
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
                            <span className="text-xs text-gray-400 w-8">{Math.round((g.value / totalGroups) * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-center text-sm text-gray-400 py-8">Sem lançamentos</p>
                  )}
                </div>

                {/* Bar — custo por colaborador */}
                <div className="card p-4">
                  <p className="font-semibold text-gray-900 text-sm mb-1">Custo por Colaborador</p>
                  <p className="text-xs text-gray-400 mb-3">Top {byEmployee.length} por valor estimado</p>
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
                  ) : (
                    <p className="text-center text-sm text-gray-400 py-8">Sem dados</p>
                  )}
                </div>

                {/* Status cards */}
                <div className="lg:col-span-2 grid grid-cols-4 gap-3">
                  {[
                    { label: 'Total Estimado', value: totalEstimativa, color: 'bg-blue-50 text-blue-800', sub: `${folhaData?.length ?? 0} colaboradores` },
                    { label: 'Reembolsos / Gastos', value: totalExpenses, color: 'bg-orange-50 text-orange-800', sub: `${expenses?.length || 0} lançamentos` },
                    { label: 'Total Pago', value: totalPago, color: 'bg-green-50 text-green-800', sub: '✓ confirmados' },
                    { label: 'Atrasado', value: totalAtrasado, color: 'bg-red-50 text-red-800', sub: '⚠ vencidos' },
                  ].map((c, i) => (
                    <div key={i} className={`rounded-xl p-3 ${c.color}`}>
                      <p className="text-xs font-medium opacity-70">{c.label}</p>
                      <p className="text-xl font-bold mt-0.5">{formatCurrency(c.value)}</p>
                      <p className="text-xs opacity-60 mt-0.5">{c.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {isLoading
            ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
            : (folhaData?.length ?? 0) === 0
              ? <div className="card p-8 text-center text-gray-400">Nenhum colaborador com vínculo ativo e valor definido. Adicione um vínculo com salário para aparecer aqui.</div>
              : <>
              {/* Render groups based on folhaData (active vinculos), not payments table */}
              {([
                { key: 'consultoria' as WorkerGroup, label: 'Nutricionistas Consultoria', icon: '🏥', colors: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700', sub: 'text-orange-500', exp: 'text-orange-700 bg-orange-50' } },
                { key: 'fixo_plantao' as WorkerGroup, label: 'Nutricionistas Fixos / Plantão', icon: '📅', colors: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-700', sub: 'text-blue-500', exp: 'text-blue-700 bg-blue-50' } },
                { key: 'temporario' as WorkerGroup, label: 'Contratos Temporários', icon: '⏱', colors: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-700', sub: 'text-amber-500', exp: 'text-amber-700 bg-amber-50' } },
              ]).map(({ key, label, icon, colors }) => {
                const group = folhaData?.filter(r => r.group === key) ?? []
                if (!group.length) return null
                const totalSalaries = group.reduce((s, r) => s + r.monthly_amount, 0)
                const caTotal = group.reduce((s, r) => s + r.cost_assistance, 0)
                const expGroup = expenses?.filter(e => group.some(r => r.employee?.id === (e as { employee?: { id: string } }).employee?.id)) ?? []
                const totalExp = expGroup.reduce((s, e) => s + (Number(e.amount) || 0), 0)
                return (
                  <div key={key} className="card overflow-hidden">
                    <div className={`px-4 py-3 ${colors.bg} border-b flex items-center justify-between`}>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{icon}</span>
                        <span className={`font-semibold ${colors.text}`}>{label}</span>
                        <span className={`badge ${colors.badge} text-xs`}>{group.length} nutri</span>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${colors.text}`}>{formatCurrency(totalSalaries + caTotal + totalExp)}</p>
                        {(totalExp > 0 || caTotal > 0) && (
                          <p className={`text-xs ${colors.sub}`}>
                            {formatCurrency(totalSalaries)} honorários{caTotal > 0 ? ` + ${formatCurrency(caTotal)} aj.custo` : ''}{totalExp > 0 ? ` + ${formatCurrency(totalExp)} gastos` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                          <tr>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">COLABORADOR</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">CLIENTE</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">VALOR</th>
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">STATUS</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {group.map(row => {
                            const pay = payForEmp(row.employee?.id || '')
                            return (
                              <tr key={row.linkId} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <button
                                    className="font-medium text-sm text-primary-700 hover:underline text-left"
                                    onClick={() => navigate(`/colaboradores/${row.employee?.id}`, { state: { tab: 'vinculos' } })}
                                  >
                                    {row.employee?.full_name}
                                  </button>
                                </td>
                                <td className="px-3 py-2 text-gray-500 text-xs">{row.client?.name}</td>
                                <td className="px-3 py-2 font-semibold">{formatCurrency(row.monthly_amount)}</td>
                                <td className="px-3 py-2">
                                  {pay
                                    ? <span className={`badge ${STATUS_COLORS[pay.status] || 'bg-gray-100'}`}>{pay.status}</span>
                                    : <span className="badge bg-gray-100 text-gray-500 text-xs">Sem lançamento</span>
                                  }
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex gap-1 justify-end">
                                    {pay?.status === 'Pendente' && (
                                      <button onClick={() => markPaid.mutate(pay.id)} className="btn-primary text-xs flex items-center gap-1 py-1"><Check size={12} />Pago</button>
                                    )}
                                    {!pay && (
                                      <button
                                        onClick={() => autoGeneratePayment.mutate(row)}
                                        disabled={autoGeneratePayment.isPending}
                                        className="btn-secondary text-xs py-1"
                                      >
                                        Gerar
                                      </button>
                                    )}
                                    {pay && (
                                      <button onClick={() => navigate(`/pagamentos/${pay.id}/editar`)} className="btn-ghost text-xs">Editar</button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    {(expGroup.length > 0 || caTotal > 0) && (
                      <div className="border-t px-4 py-2 space-y-1">
                        {caTotal > 0 && (
                          <div className={`flex items-center justify-between text-xs ${colors.exp} rounded px-2 py-1`}>
                            <span>🚗 Ajuda de Custo total</span>
                            <span className="font-medium">{formatCurrency(caTotal)}</span>
                          </div>
                        )}
                        {expGroup.map(e => (
                          <div key={e.id} className={`flex items-center justify-between text-xs ${colors.exp} rounded px-2 py-1`}>
                            <span>💸 {e.description} <span className="text-gray-400">({e.category})</span></span>
                            <span className="font-medium">{formatCurrency(Number(e.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

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
                    <p className="text-xs text-gray-400 mt-1">Lançamentos manuais ou de colaboradores que não possuem mais vínculo ativo.</p>
                  </div>
                  <PaymentTable list={unlinkedPayments} />
                </div>
              )}
            </>
          }
        </div>
      )}

      {/* ── REAL TAB ── */}
      {tab === 'real' && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 flex items-center gap-2">
            <Check size={16} />
            Pagamentos confirmados como realizados. Somente lançamentos com status <strong>Pago</strong>.
          </div>
          {(() => {
            const paidList = (payments ?? []).filter(p => p.status === 'Pago')
            const totalReal = paidList.reduce((s, p) => s + (p.amount || 0), 0)
            if (!paidList.length) return (
              <div className="card p-8 text-center text-gray-400">
                Nenhum pagamento confirmado neste mês.<br />
                <span className="text-xs mt-1 block">Marque um pagamento como <strong>Pago</strong> para ele aparecer aqui.</span>
              </div>
            )
            return (
              <div className="space-y-3">
                <div className="card p-4 bg-green-50 border-green-200 flex justify-between items-center">
                  <span className="text-sm font-medium text-green-800">Total Real Pago</span>
                  <span className="text-xl font-bold text-green-800">{formatCurrency(totalReal)}</span>
                </div>
                <div className="card overflow-hidden">
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

      {/* ── ANÁLISE FOLHA DE PONTO ── */}
      {tab === 'analise' && (
        <div className="space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-600">
            Compare dias/visitas realizadas vs esperadas. Gere o pagamento real com base na folha.
          </div>

          {folhaLoading && (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
          )}

          {!folhaLoading && folhaData?.length === 0 && (
            <div className="card p-8 text-center text-gray-400">Nenhum colaborador com vínculo ativo e valor definido.</div>
          )}

          {folhaData?.map(row => {
            const isConsultoria = row.service_type === 'Consultoria'
            const diff = isConsultoria
              ? (row.actualVisits - 0)
              : (row.actualDays - row.expDays)
            const pct = isConsultoria
              ? 100
              : row.expDays > 0 ? Math.round((row.actualDays / row.expDays) * 100) : 0
            const isShort = !isConsultoria && row.actualDays < row.expDays
            const isOver = !isConsultoria && row.actualDays > row.expDays

            return (
              <div key={row.linkId} className={`card p-4 border-l-4 ${isShort ? 'border-red-400' : isOver ? 'border-blue-400' : 'border-green-400'}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {row.employee?.id ? (
                        <button
                          className="font-semibold text-primary-700 hover:underline text-left"
                          onClick={() => navigate(`/colaboradores/${row.employee!.id}`, { state: { tab: 'vinculos' } })}
                        >
                          {row.employee.full_name}
                        </button>
                      ) : (
                        <p className="font-semibold">{row.employee?.full_name || '-'}</p>
                      )}
                      <span className={`badge text-xs ${isConsultoria ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{row.service_type}</span>
                      {row.work_schedule && <span className="badge bg-gray-100 text-gray-600 text-xs">{row.work_schedule}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{row.client?.name}</p>

                    {/* Stats */}
                    <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                      {!isConsultoria ? (
                        <>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-gray-800">{row.actualDays}</p>
                            <p className="text-xs text-gray-400">dias realizados</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-gray-500">{row.expDays}</p>
                            <p className="text-xs text-gray-400">dias esperados</p>
                          </div>
                          <div className={`rounded-lg p-2 ${isShort ? 'bg-red-50' : 'bg-green-50'}`}>
                            <p className={`text-lg font-bold ${isShort ? 'text-red-600' : 'text-green-600'}`}>{pct}%</p>
                            <p className={`text-xs ${isShort ? 'text-red-400' : 'text-green-400'}`}>{isShort ? `${Math.abs(diff)} dias faltam` : 'completo'}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-gray-800">{row.actualVisits}</p>
                            <p className="text-xs text-gray-400">visitas</p>
                          </div>
                          <div className="bg-orange-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-orange-700">{formatCurrency(row.actualAmount || 0)}</p>
                            <p className="text-xs text-orange-400">a receber</p>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-gray-500">{formatCurrency(row.monthly_amount)}</p>
                            <p className="text-xs text-gray-400">estimativa</p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Custo total do mês */}
                    {(() => {
                      const empExpAmt = (expenses?.filter(e => (e as { employee_id?: string }).employee_id === row.employee?.id) ?? [])
                        .reduce((s, e) => s + Number(e.amount), 0)
                      // Fixo: sempre salário cheio. Consultoria: visitas realizadas.
                      const salarioReal = isConsultoria ? row.realAmt : row.monthly_amount
                      const totalReal = salarioReal + empExpAmt + row.cost_assistance
                      return (
                        <div className="mt-3 flex items-center gap-3">
                          <div className="flex-1 bg-purple-50 rounded-lg px-3 py-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-purple-600 font-medium">A pagar este mês</span>
                              <span className="font-bold text-purple-800">{formatCurrency(totalReal)}</span>
                            </div>
                            <div className="flex gap-3 mt-1 flex-wrap">
                              <span className="text-xs text-purple-500">
                                {isConsultoria ? `${row.actualVisits} visita(s): ` : 'Salário fixo: '}
                                {formatCurrency(salarioReal)}
                              </span>
                              {row.cost_assistance > 0 && <span className="text-xs text-blue-500">Aj.custo: {formatCurrency(row.cost_assistance)}</span>}
                              {empExpAmt > 0 && <span className="text-xs text-orange-500">Gastos: {formatCurrency(empExpAmt)}</span>}
                            </div>
                            {!isConsultoria && isShort && (
                              <p className="text-xs mt-1 text-gray-400 italic">
                                {Math.abs(diff)} dia(s) sem registro — folha de ponto incompleta. Salário gerado normalmente.
                              </p>
                            )}
                            {isConsultoria && row.actualVisits > 0 && (row.visits as { observations?: string }[]).some(v => v.observations) && (
                              <p className="text-xs mt-1 text-amber-600 font-medium">
                                ⚠ Há observações nos registros — verifique se há horas extras a pagar.
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {/* Action */}
                  <div className="flex flex-col gap-2 items-end">
                    {row.hasRealPayment ? (
                      <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium">
                        <Check size={16} /> Gerado
                      </div>
                    ) : (
                      <button
                        className="btn-primary text-sm flex items-center gap-1.5 whitespace-nowrap"
                        onClick={() => generateRealPayment.mutate({ ...row, realAmt: isConsultoria ? row.realAmt : row.monthly_amount })}
                        disabled={generateRealPayment.isPending}
                      >
                        <RefreshCw size={14} />
                        Gerar Pagamento Real
                      </button>
                    )}
                    {isConsultoria && isShort && (
                      <div className="flex items-center gap-1 text-xs text-orange-500">
                        <AlertTriangle size={12} />
                        Menos visitas que o previsto
                      </div>
                    )}
                    {!isConsultoria && isShort && (
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <AlertTriangle size={12} />
                        {Math.abs(diff)} dia(s) sem registro
                      </div>
                    )}
                  </div>
                </div>

                {/* Visit detail (expandable summary) */}
                {row.visits.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-primary-600 cursor-pointer hover:underline">
                      Ver {row.visits.length} registro(s) de ponto
                    </summary>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      {row.visits.slice(0, 30).map((v, i) => (
                        <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1 flex items-center justify-between">
                          <span className="text-gray-600">{formatDate(v.visit_date)}</span>
                          <span className="text-gray-400">{v.check_in?.slice(0, 5)} – {v.check_out?.slice(0, 5) || '?'}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Expenses for this employee */}
                {(() => {
                  const empExpenses = expenses?.filter(e => (e as { employee_id?: string }).employee_id === row.employee?.id) ?? []
                  const caAmt = row.cost_assistance
                  return (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-500">Gastos / Ajuda de Custo</span>
                        <button
                          className="btn-secondary text-xs flex items-center gap-1 py-0.5"
                          onClick={() => setNewExpenseEmpId(newExpenseEmpId === row.employee?.id ? null : (row.employee?.id ?? null))}
                        >
                          <Plus size={11} /> Novo Gasto
                        </button>
                      </div>
                      {caAmt > 0 && (
                        <div className="flex items-center justify-between text-xs bg-blue-50 rounded px-2 py-1">
                          <span className="text-blue-700">🚗 Ajuda de Custo (contrato)</span>
                          <span className="font-medium text-blue-800">{formatCurrency(caAmt)}</span>
                        </div>
                      )}
                      {empExpenses.map(e => (
                        <div key={e.id} className="flex items-center justify-between text-xs bg-orange-50 rounded px-2 py-1">
                          <span className="text-orange-700">💸 {e.description} <span className="text-gray-400">({e.category})</span></span>
                          <span className="font-medium text-orange-800">{formatCurrency(Number(e.amount))}</span>
                        </div>
                      ))}
                      {empExpenses.length === 0 && caAmt === 0 && (
                        <p className="text-xs text-gray-400">Nenhum gasto registrado este mês.</p>
                      )}

                      {/* New expense form */}
                      {newExpenseEmpId === row.employee?.id && (
                        <div className="bg-gray-50 rounded-lg p-3 space-y-2 mt-2">
                          <p className="text-xs font-semibold text-gray-600">Registrar gasto</p>
                          <div className="grid grid-cols-2 gap-2">
                            <input className="input text-sm col-span-2" placeholder="Descrição *" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} />
                            <input className="input text-sm" type="number" placeholder="Valor R$ *" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} />
                            <select className="input text-sm" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>
                              <option>Reembolso</option>
                              <option>Ajuda de Custo</option>
                              <option>Vale Transporte</option>
                              <option>Alimentação</option>
                              <option>Material</option>
                              <option>Outro</option>
                            </select>
                            <input className="input text-sm col-span-2" placeholder="Observação (opcional)" value={expForm.notes} onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))} />
                          </div>
                          <div className="flex gap-2">
                            <button className="btn-primary text-xs py-1" onClick={() => addExpense.mutate(row.employee!.id)} disabled={addExpense.isPending || !expForm.description || !expForm.amount}>
                              Salvar
                            </button>
                            <button className="btn-ghost text-xs" onClick={() => setNewExpenseEmpId(null)}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal: definir valor do vínculo ── */}
      {editAmountLink && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm space-y-4">
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
