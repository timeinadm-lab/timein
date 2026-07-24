import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, TrendingUp, TrendingDown, Wallet, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatCurrency, formatDate } from '../../lib/utils'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import toast from 'react-hot-toast'

type Kind = 'entrada' | 'saida'
type Entry = {
  id: string; kind: Kind; description: string; amount: number; category: string | null
  client_id: string | null; entry_date: string; recurrence: 'unica' | 'mensal' | 'ate_data'
  recurrence_until: string | null; client?: { name: string } | null
}

const EMPTY = { description: '', amount: '', category: '', client_id: '', entry_date: format(new Date(), 'yyyy-MM-dd'), recurrence: 'unica' as Entry['recurrence'], recurrence_until: '' }

export default function FinanceiroPage() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [showForm, setShowForm] = useState<Kind | null>(null)
  const [form, setForm] = useState(EMPTY)

  const mStart = format(startOfMonth(new Date(month + '-15')), 'yyyy-MM-dd')
  const mEnd = format(endOfMonth(new Date(month + '-15')), 'yyyy-MM-dd')

  const { data: entries } = useQuery({
    queryKey: ['financial-entries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('financial_entries')
        .select('*, client:clients(name)').order('entry_date', { ascending: false })
      if (error) throw error
      return (data || []) as Entry[]
    },
  })

  const { data: clients } = useQuery({
    queryKey: ['clients-fin'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  // Folha do mês = salários efetivamente pagos (saída realizada, sem duplicar Estimativa/Real)
  const { data: folhaPaga } = useQuery({
    queryKey: ['financial-folha', month],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments').select('amount,status,reference_month,due_date')
        .eq('status', 'Pago')
        .or(`reference_month.eq.${month},and(reference_month.is.null,due_date.gte.${mStart},due_date.lte.${mEnd})`)
      if (error) throw error
      return (data || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
    },
  })

  // Um lançamento se aplica a este mês? (recorrência calculada na hora — nada é duplicado)
  const appliesToMonth = (e: Entry) => {
    const startM = e.entry_date.slice(0, 7)
    if (e.recurrence === 'unica') return startM === month
    if (e.recurrence === 'mensal') return startM <= month
    if (e.recurrence === 'ate_data') return startM <= month && (!e.recurrence_until || month <= e.recurrence_until.slice(0, 7))
    return false
  }

  const monthEntries = (entries || []).filter(appliesToMonth)
  const entradas = monthEntries.filter(e => e.kind === 'entrada')
  const despesas = monthEntries.filter(e => e.kind === 'saida')
  const totalEntradas = entradas.reduce((s, e) => s + Number(e.amount), 0)
  const totalDespesas = despesas.reduce((s, e) => s + Number(e.amount), 0)
  const folha = folhaPaga ?? 0
  const saldo = totalEntradas - folha - totalDespesas

  const addEntry = useMutation({
    mutationFn: async (kind: Kind) => {
      if (!form.description.trim()) throw new Error('Descreva o lançamento')
      if (!form.amount || Number(form.amount) <= 0) throw new Error('Informe um valor válido')
      if (form.recurrence === 'ate_data' && !form.recurrence_until) throw new Error('Escolha até quando repete')
      const { error } = await supabase.from('financial_entries').insert({
        kind,
        description: form.description.trim(),
        amount: Number(form.amount),
        category: form.category.trim() || null,
        client_id: kind === 'entrada' && form.client_id ? form.client_id : null,
        entry_date: form.entry_date,
        recurrence: form.recurrence,
        recurrence_until: form.recurrence === 'ate_data' ? form.recurrence_until : null,
        created_by: user?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Lançamento registrado!')
      qc.invalidateQueries({ queryKey: ['financial-entries'] })
      setShowForm(null); setForm(EMPTY)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('financial_entries').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Removido.'); qc.invalidateQueries({ queryKey: ['financial-entries'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const recLabel = (e: Entry) => e.recurrence === 'mensal' ? '🔁 mensal' : e.recurrence === 'ate_data' ? `🔁 até ${e.recurrence_until ? formatDate(e.recurrence_until) : ''}` : ''

  const List = ({ list, kind }: { list: Entry[]; kind: Kind }) => (
    <div className="space-y-2">
      {list.length === 0 && <p className="text-sm text-ink-400">Nenhum lançamento neste mês.</p>}
      {list.map(e => (
        <div key={e.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-ink-100">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-800">{e.description}</p>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {e.category && <span className="badge bg-ink-100 text-ink-500 text-[10px]">{e.category}</span>}
              {e.client?.name && <span className="badge bg-blue-50 text-blue-600 text-[10px]">{e.client.name}</span>}
              {e.recurrence !== 'unica' && <span className="text-[11px] text-primary-600">{recLabel(e)}</span>}
              <span className="text-[11px] text-ink-400">{formatDate(e.entry_date)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-bold tnum text-sm ${kind === 'entrada' ? 'text-green-700' : 'text-red-600'}`}>
              {kind === 'entrada' ? '+' : '−'} {formatCurrency(Number(e.amount))}
            </span>
            <button onClick={() => delEntry.mutate(e.id)} className="text-ink-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Contabilidade</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900 flex items-center gap-2">
            <Wallet size={26} className="text-primary-600" /> Financeiro
          </h1>
        </div>
        <input type="month" className="input w-auto text-sm" value={month} onChange={e => setMonth(e.target.value)} />
      </div>

      {/* Fluxo de caixa */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-l-green-400">
          <p className="text-xs text-ink-500 font-semibold flex items-center gap-1"><TrendingUp size={13} className="text-green-500" /> Entrou</p>
          <p className="text-2xl font-display font-extrabold text-green-700 mt-1 tnum">{formatCurrency(totalEntradas)}</p>
        </div>
        <div className="card p-4 border-l-4 border-l-red-400">
          <p className="text-xs text-ink-500 font-semibold flex items-center gap-1"><TrendingDown size={13} className="text-red-500" /> Folha (salários)</p>
          <p className="text-2xl font-display font-extrabold text-red-600 mt-1 tnum">{formatCurrency(folha)}</p>
          <p className="text-[10px] text-ink-400">pagos no mês</p>
        </div>
        <div className="card p-4 border-l-4 border-l-orange-400">
          <p className="text-xs text-ink-500 font-semibold flex items-center gap-1"><TrendingDown size={13} className="text-orange-500" /> Despesas</p>
          <p className="text-2xl font-display font-extrabold text-orange-600 mt-1 tnum">{formatCurrency(totalDespesas)}</p>
        </div>
        <div className={`card p-4 border-l-4 ${saldo >= 0 ? 'border-l-primary-400' : 'border-l-red-500'}`}>
          <p className="text-xs text-ink-500 font-semibold">Saldo do mês</p>
          <p className={`text-2xl font-display font-extrabold mt-1 tnum ${saldo >= 0 ? 'text-primary-700' : 'text-red-600'}`}>{formatCurrency(saldo)}</p>
          <p className="text-[10px] text-ink-400">entrou − folha − despesas</p>
        </div>
      </div>

      {/* Entradas */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title text-base"><TrendingUp size={16} className="text-green-600" /> Entradas</h2>
          <button onClick={() => { setShowForm('entrada'); setForm(EMPTY) }} className="btn-secondary text-sm border-green-200 text-green-700 hover:bg-green-50"><Plus size={15} /> Nova entrada</button>
        </div>
        <List list={entradas} kind="entrada" />
      </div>

      {/* Despesas */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title text-base"><TrendingDown size={16} className="text-red-500" /> Despesas <span className="text-xs font-normal text-ink-400">(fora da folha)</span></h2>
          <button onClick={() => { setShowForm('saida'); setForm(EMPTY) }} className="btn-secondary text-sm border-red-200 text-red-600 hover:bg-red-50"><Plus size={15} /> Nova despesa</button>
        </div>
        <List list={despesas} kind="saida" />
      </div>

      {/* Modal de lançamento */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={() => setShowForm(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{showForm === 'entrada' ? 'Nova entrada (dinheiro que entra)' : 'Nova despesa'}</h3>
              <button onClick={() => setShowForm(null)} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
            </div>
            <div>
              <label className="label">Descrição *</label>
              <input className="input" placeholder={showForm === 'entrada' ? 'Ex: Pagamento Cliente X' : 'Ex: Aluguel, ferramenta...'} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Valor (R$) *</label>
                <input className="input" type="number" step="0.01" placeholder="0,00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">Data</label>
                <input className="input" type="date" value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} />
              </div>
              <div>
                <label className="label">Categoria <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input className="input" placeholder="Ex: Mensalidade, Imposto..." value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} />
              </div>
              {showForm === 'entrada' && (
                <div>
                  <label className="label">Cliente <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={form.client_id} onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}>
                    <option value="">Nenhum</option>
                    {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className="label">Repetição</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([['unica', 'Só esse mês'], ['mensal', 'Todo mês'], ['ate_data', 'Todo mês até...']] as const).map(([v, t]) => (
                  <button key={v} type="button" onClick={() => setForm(p => ({ ...p, recurrence: v }))}
                    className={`p-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${form.recurrence === v ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    {t}
                  </button>
                ))}
              </div>
              {form.recurrence === 'ate_data' && (
                <input className="input mt-2" type="date" value={form.recurrence_until} onChange={e => setForm(p => ({ ...p, recurrence_until: e.target.value }))} />
              )}
            </div>
            <button className="btn-primary w-full" disabled={addEntry.isPending} onClick={() => addEntry.mutate(showForm)}>
              {addEntry.isPending ? 'Salvando...' : 'Registrar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
