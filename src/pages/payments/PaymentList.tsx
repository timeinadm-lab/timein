import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Download, Check, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatCurrency } from '../../lib/utils'
import { exportToCSV } from '../../lib/exportUtils'
import { SkeletonRows } from '../../components/ui/Skeleton'
import { format, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns'
import toast from 'react-hot-toast'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'

type Tab = 'folha' | 'pagos'
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
  const [tab, setTab] = useState<Tab>('folha')
  const [showCharts, setShowCharts] = useState(false)
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
          id, service_type, monthly_amount, work_schedule, expected_days_month, cost_assistance, start_date, pay_full_salary,
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

        const visitHours = (v: { check_in?: string | null; check_out?: string | null }) => {
          if (!v.check_in || !v.check_out) return 0
          const [hi, mi] = v.check_in.slice(0,5).split(':').map(Number)
          const [ho, mo] = v.check_out.slice(0,5).split(':').map(Number)
          return (ho * 60 + mo - hi * 60 - mi) / 60
        }

        const actualDays = !isConsultoria ? empVisits.filter(v => v.check_out).length : 0
        const actualVisits = isConsultoria ? empVisits.length : 0
        const actualAmount = isConsultoria
          ? empVisits.reduce((s, v) => {
              const rate = Number(v.visit_rate) || 0
              if (!rate) return s
              const hours = visitHours(v)
              const earned = hours > 0 && hours < 4 ? (hours / 4) * rate : rate
              return s + earned
            }, 0)
          : null

        const expDays = !isConsultoria ? (l.expected_days_month || expectedDays(l.work_schedule, filterMonth)) : 0
        const fallback = emp?.id ? vacancyFallback[emp.id] : undefined
        const monthlyAmt = Number(l.monthly_amount) || Number(fallback?.salary_amount) || 0

        const hasRealPayment = realPayments?.some(rp => rp.employee_id === emp?.id) ?? false
        const costAssistance = Number((l as { cost_assistance?: number }).cost_assistance) || 0
        const group = workerGroup(l.service_type, l.work_schedule)
        const payDates = (l as { payment_dates?: { day_of_month: number }[] }).payment_dates ?? []
        const payDay = payDates[0]?.day_of_month || 5
        const startDate = (l as { start_date?: string }).start_date || null
        const payFullSalary = (l as { pay_full_salary?: boolean }).pay_full_salary ?? false

        // Ciclo de pagamento para Fixo: payDay do mês anterior até payDay-1 do mês atual
        // Se o colaborador começou mid-cycle, calcula proporcional (a não ser que pay_full_salary = true)
        let cycleDays = expDays
        let cycleStart: string | null = null
        let cycleEnd: string | null = null
        let isPartialCycle = false
        let proportionalFactor = 1

        if (!isConsultoria && payDay) {
          const [yr, mo] = filterMonth.split('-').map(Number)
          const cEnd = new Date(yr, mo - 1, payDay - 1)
          const cStart = new Date(yr, mo - 2, payDay)
          cycleStart = cStart.toISOString().slice(0, 10)
          cycleEnd = cEnd.toISOString().slice(0, 10)

          if (startDate && startDate > cycleStart && startDate <= cycleEnd) {
            isPartialCycle = true
            if (!payFullSalary) {
              const totalCycleDays = Math.round((cEnd.getTime() - cStart.getTime()) / 86400000) + 1
              const workedCycleDays = Math.round((cEnd.getTime() - new Date(startDate).getTime()) / 86400000) + 1
              proportionalFactor = totalCycleDays > 0 ? workedCycleDays / totalCycleDays : 1
            }
          }
        }

        const adjustedAmount = Math.round(monthlyAmt * proportionalFactor * 100) / 100
        const realAmt = isConsultoria
          ? (actualAmount || 0)
          : expDays > 0 ? Math.round((actualDays / expDays) * adjustedAmount * 100) / 100 : 0

        return {
          linkId: l.id,
          employee: emp,
          client,
          service_type: l.service_type,
          work_schedule: l.work_schedule,
          monthly_amount: monthlyAmt,
          adjusted_amount: adjustedAmount,
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
          startDate,
          payFullSalary,
          cycleStart,
          cycleEnd,
          isPartialCycle,
          proportionalFactor,
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

  const autoGeneratePayment = useMutation({
    mutationFn: async (row: { employee: { id: string; full_name: string } | undefined; client: { id: string; name: string } | undefined; monthly_amount: number; adjusted_amount?: number; payDay?: number }) => {
      if (!row.employee) throw new Error('Sem colaborador')
      const dueDate = new Date(filterMonth + '-15')
      dueDate.setDate(row.payDay || 5)
      const monthLabel = new Date(filterMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      const { error } = await supabase.from('payments').insert({
        description: `Honorários – ${row.employee.full_name}${row.client ? ` (${row.client.name})` : ''} – ${monthLabel}`,
        amount: row.adjusted_amount ?? row.monthly_amount,
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
            ['folha', 'Folha do Mês'],
            ['pagos', 'Pagos'],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3.5 py-2 text-sm font-semibold whitespace-nowrap rounded-xl transition-all active:scale-95 ${tab === k ? 'bg-primary-600 text-white shadow-soft' : 'bg-white border border-ink-100 text-ink-500 hover:text-ink-800 hover:border-ink-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── FOLHA DO MÊS ── */}
      {tab === 'folha' && (
        <div className="space-y-4">
          {isLoading || folhaLoading
            ? <SkeletonRows count={6} />
            : (folhaData?.length ?? 0) === 0
              ? <div className="card p-8 text-center text-gray-400">Nenhum colaborador com vínculo ativo e valor definido. Adicione um vínculo com salário para aparecer aqui.</div>
              : <>
              {/* Resumo cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Estimativa', value: totalEstimativa, color: 'bg-blue-50 text-blue-800', sub: `${folhaData?.length ?? 0} colaboradores` },
                  { label: 'Gastos extras', value: totalExpenses, color: 'bg-orange-50 text-orange-800', sub: `${expenses?.length || 0} lançamentos` },
                  { label: 'Total Pago', value: totalPago, color: 'bg-green-50 text-green-800', sub: 'confirmados' },
                  { label: 'Atrasado', value: totalAtrasado, color: 'bg-red-50 text-red-800', sub: 'vencidos' },
                ].map((c, i) => (
                  <div key={i} className={`rounded-xl p-3 ${c.color}`}>
                    <p className="text-xs font-medium opacity-70">{c.label}</p>
                    <p className="text-xl font-bold mt-0.5">{formatCurrency(c.value)}</p>
                    <p className="text-xs opacity-60 mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>

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
                  { name: 'Consultoria', value: (folhaData ?? []).filter(r => r.group === 'consultoria').reduce((s, r) => s + r.monthly_amount, 0), color: '#f97316' },
                  { name: 'Fixo / Plantão', value: (folhaData ?? []).filter(r => r.group === 'fixo_plantao').reduce((s, r) => s + r.monthly_amount, 0), color: '#3b82f6' },
                  { name: 'Temporário', value: (folhaData ?? []).filter(r => r.group === 'temporario').reduce((s, r) => s + r.monthly_amount, 0), color: '#f59e0b' },
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

              {/* Colaboradores agrupados — estimativa + realizado lado a lado */}
              {([
                { key: 'consultoria' as WorkerGroup, label: 'Consultoria', icon: '🏥', colors: { bg: 'bg-orange-50', text: 'text-orange-800', badge: 'bg-orange-100 text-orange-700', exp: 'text-orange-700 bg-orange-50' } },
                { key: 'fixo_plantao' as WorkerGroup, label: 'Fixos / Plantão', icon: '📅', colors: { bg: 'bg-blue-50', text: 'text-blue-800', badge: 'bg-blue-100 text-blue-700', exp: 'text-blue-700 bg-blue-50' } },
                { key: 'temporario' as WorkerGroup, label: 'Temporários', icon: '⏱', colors: { bg: 'bg-amber-50', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-700', exp: 'text-amber-700 bg-amber-50' } },
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
                        <span className={`badge ${colors.badge} text-xs`}>{group.length}</span>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${colors.text}`}>{formatCurrency(totalSalaries + caTotal + totalExp)}</p>
                        {(totalExp > 0 || caTotal > 0) && (
                          <p className="text-xs text-gray-500">
                            {formatCurrency(totalSalaries)} base{caTotal > 0 ? ` + ${formatCurrency(caTotal)} aj.custo` : ''}{totalExp > 0 ? ` + ${formatCurrency(totalExp)} gastos` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {group.map(row => {
                        const pay = payForEmp(row.employee?.id || '')
                        const isConsultoria = row.service_type === 'Consultoria'
                        const salarioBase = isConsultoria ? (row.actualAmount || 0) : row.adjusted_amount
                        const empExpAmt = (expenses?.filter(e => (e as { employee_id?: string }).employee_id === row.employee?.id) ?? []).reduce((s, e) => s + Number(e.amount), 0)
                        const totalAPagar = salarioBase + empExpAmt + row.cost_assistance
                        const diff = isConsultoria ? 0 : row.actualDays - row.expDays
                        const isShort = !isConsultoria && row.actualDays < row.expDays

                        return (
                          <div key={row.linkId} className="p-4">
                            <div className="flex items-center gap-4 flex-wrap">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    className="font-semibold text-sm text-primary-700 hover:underline text-left truncate"
                                    onClick={() => navigate(`/colaboradores/${row.employee?.id}`, { state: { tab: 'vinculos' } })}
                                  >
                                    {row.employee?.full_name}
                                  </button>
                                  <span className="text-xs text-gray-400">{row.client?.name}</span>
                                  {row.work_schedule && <span className="badge bg-gray-100 text-gray-600 text-xs">{row.work_schedule}</span>}
                                  {row.startDate && <span className="text-xs text-gray-400">Início: {formatDate(row.startDate)}</span>}
                                </div>
                              </div>

                              <div className="flex items-center gap-3 flex-shrink-0">
                                <div className="text-center px-3">
                                  <p className="text-xs text-gray-400">Salário</p>
                                  <p className="text-sm font-semibold text-gray-700">{formatCurrency(row.monthly_amount)}</p>
                                  {row.isPartialCycle && !row.payFullSalary && (
                                    <p className="text-xs text-amber-600">{Math.round(row.proportionalFactor * 100)}% ciclo</p>
                                  )}
                                </div>
                                {isConsultoria ? (
                                  <div className="text-center px-3 border-l border-gray-100">
                                    <p className="text-xs text-gray-400">{row.actualVisits} visita{row.actualVisits !== 1 ? 's' : ''}</p>
                                    <p className="text-sm font-bold text-orange-700">{formatCurrency(row.actualAmount || 0)}</p>
                                  </div>
                                ) : (
                                  <div className="text-center px-3 border-l border-gray-100">
                                    <p className="text-xs text-gray-400">{row.actualDays}/{row.expDays} dias</p>
                                    <p className={`text-sm font-bold ${isShort ? 'text-red-600' : 'text-green-600'}`}>
                                      {isShort ? `${Math.abs(diff)} faltam` : 'OK'}
                                    </p>
                                  </div>
                                )}
                                <div className="text-center px-3 border-l border-gray-100 bg-purple-50 rounded-lg py-1">
                                  <p className="text-xs text-purple-500">A pagar</p>
                                  <p className="text-sm font-bold text-purple-800">{formatCurrency(totalAPagar)}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                {pay ? (
                                  <>
                                    <span className={`badge ${STATUS_COLORS[pay.status] || 'bg-gray-100'}`}>{pay.status}</span>
                                    {pay.status === 'Pendente' && (
                                      <button onClick={() => markPaid.mutate(pay.id)} className="btn-primary text-xs flex items-center gap-1 py-1"><Check size={12} />Pago</button>
                                    )}
                                    <button onClick={() => navigate(`/pagamentos/${pay.id}/editar`)} className="btn-ghost text-xs">Editar</button>
                                  </>
                                ) : (
                                  <>
                                    <span className="badge bg-gray-100 text-gray-500 text-xs">Sem lançamento</span>
                                    <button
                                      onClick={() => autoGeneratePayment.mutate(row)}
                                      disabled={autoGeneratePayment.isPending}
                                      className="btn-secondary text-xs py-1"
                                    >Gerar</button>
                                  </>
                                )}
                                {!row.hasRealPayment && (
                                  <button
                                    className="btn-ghost text-xs text-green-600 flex items-center gap-1"
                                    onClick={() => generateRealPayment.mutate({ ...row, realAmt: isConsultoria ? row.realAmt : row.adjusted_amount })}
                                    disabled={generateRealPayment.isPending}
                                    title="Gerar pagamento real baseado na folha"
                                  >
                                    <RefreshCw size={12} />Real
                                  </button>
                                )}
                                {row.hasRealPayment && (
                                  <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><Check size={12} />Real</span>
                                )}
                              </div>
                            </div>

                            {/* Info extras: ciclo, proporcional, pay full, alertas */}
                            <div className="mt-2 flex items-center gap-3 flex-wrap text-xs">
                              {!isConsultoria && row.cycleStart && row.cycleEnd && (
                                <span className="text-gray-400">Ciclo: {formatDate(row.cycleStart)} – {formatDate(row.cycleEnd)}</span>
                              )}
                              {!isConsultoria && row.isPartialCycle && (
                                <span className="text-amber-600 flex items-center gap-1">
                                  <AlertTriangle size={11} />
                                  Ciclo parcial (início {formatDate(row.startDate!)})
                                  {row.payFullSalary ? ' — salário inteiro' : ` — proporcional: ${formatCurrency(row.adjusted_amount)}`}
                                </span>
                              )}
                              {!isConsultoria && (
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={row.payFullSalary}
                                    onChange={() => togglePayFull.mutate({ linkId: row.linkId, value: !row.payFullSalary })}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                  />
                                  <span className="text-gray-500">Pagar inteiro</span>
                                </label>
                              )}
                              {row.cost_assistance > 0 && <span className="text-blue-600">🚗 Aj.custo: {formatCurrency(row.cost_assistance)}</span>}
                              {empExpAmt > 0 && <span className="text-orange-600">💸 Gastos: {formatCurrency(empExpAmt)}</span>}
                              {isShort && (
                                <span className="text-red-500 flex items-center gap-1">
                                  <AlertTriangle size={11} />{Math.abs(diff)} dia(s) sem registro
                                </span>
                              )}
                              {isConsultoria && row.actualVisits > 0 && (row.visits as { observations?: string }[]).some(v => v.observations) && (
                                <span className="text-amber-600">⚠ Há observações nos registros</span>
                              )}
                            </div>

                            <details className="mt-2">
                              <summary className="text-xs text-primary-600 cursor-pointer hover:underline">
                                {row.visits.length > 0 ? `${row.visits.length} registro(s) de ponto` : 'Gastos'}
                              </summary>
                              {row.visits.length > 0 && (
                                <div className="mt-2 grid grid-cols-3 gap-1">
                                  {row.visits.slice(0, 30).map((v, i) => (
                                    <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1 flex items-center justify-between">
                                      <span className="text-gray-600">{formatDate(v.visit_date)}</span>
                                      <span className="text-gray-400">{v.check_in?.slice(0, 5)} – {v.check_out?.slice(0, 5) || '?'}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-500">Gastos / Ajuda de Custo</span>
                                  <button
                                    className="btn-secondary text-xs flex items-center gap-1 py-0.5"
                                    onClick={() => setNewExpenseEmpId(newExpenseEmpId === row.employee?.id ? null : (row.employee?.id ?? null))}
                                  ><Plus size={11} /> Novo Gasto</button>
                                </div>
                                {row.cost_assistance > 0 && (
                                  <div className="flex items-center justify-between text-xs bg-blue-50 rounded px-2 py-1">
                                    <span className="text-blue-700">🚗 Ajuda de Custo (contrato)</span>
                                    <span className="font-medium text-blue-800">{formatCurrency(row.cost_assistance)}</span>
                                  </div>
                                )}
                                {(expenses?.filter(e => (e as { employee_id?: string }).employee_id === row.employee?.id) ?? []).map(e => (
                                  <div key={e.id} className="flex items-center justify-between text-xs bg-orange-50 rounded px-2 py-1">
                                    <span className="text-orange-700">💸 {e.description} <span className="text-gray-400">({e.category})</span></span>
                                    <span className="font-medium text-orange-800">{formatCurrency(Number(e.amount))}</span>
                                  </div>
                                ))}
                                {newExpenseEmpId === row.employee?.id && (
                                  <div className="bg-gray-50 rounded-lg p-3 space-y-2 mt-2">
                                    <p className="text-xs font-semibold text-gray-600">Registrar gasto</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input className="input text-sm col-span-2" placeholder="Descrição *" value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} />
                                      <input className="input text-sm" type="number" placeholder="Valor R$ *" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} />
                                      <select className="input text-sm" value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))}>
                                        <option>Reembolso</option><option>Ajuda de Custo</option><option>Vale Transporte</option>
                                        <option>Alimentação</option><option>Material</option><option>Outro</option>
                                      </select>
                                      <input className="input text-sm col-span-2" placeholder="Observação (opcional)" value={expForm.notes} onChange={e => setExpForm(p => ({ ...p, notes: e.target.value }))} />
                                    </div>
                                    <div className="flex gap-2">
                                      <button className="btn-primary text-xs py-1" onClick={() => addExpense.mutate(row.employee!.id)} disabled={addExpense.isPending || !expForm.description || !expForm.amount}>Salvar</button>
                                      <button className="btn-ghost text-xs" onClick={() => setNewExpenseEmpId(null)}>Cancelar</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </details>
                          </div>
                        )
                      })}
                    </div>
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
