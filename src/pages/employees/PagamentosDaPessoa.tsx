import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Paperclip, Upload, ArrowRight } from 'lucide-react'
import { endOfMonth, parseISO, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { extensaoDoArquivo, comprimirImagem } from '../../lib/imagem'

/**
 * Pagamentos da pessoa, separados (pedido de 05/10/2026: "dividir a área de
 * reembolsos, a mensalidade… sem ficar difícil de achar"). Estes dois blocos
 * entram como sub-abas em Colaborador → Pagamentos.
 */

const statusCor: Record<string, string> = { Pago: 'bg-green-50 text-green-700', Pendente: 'bg-amber-50 text-amber-700', Cancelado: 'bg-ink-100 text-ink-500' }

/** Ajuda de custo da pessoa no mês (Pagamentos → Ajuda de custo, migração 083) */
export function AjudaDaPessoa({ employeeId, mes }: { employeeId: string; mes: string }) {
  const navigate = useNavigate()
  const ini = `${mes}-01`, fim = format(endOfMonth(parseISO(ini)), 'yyyy-MM-dd')
  const { data, error, isLoading } = useQuery({
    queryKey: ['ajudas-pessoa', employeeId, mes],
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from('ajudas_custo').select('*').eq('employee_id', employeeId).lte('inicio', fim).gte('fim', ini).order('inicio'),
        supabase.from('clients').select('id, name'),
      ])
      if (a.error) throw new Error(a.error.message)
      const cli = new Map((c.data || []).map(x => [x.id, x.name as string]))
      return (a.data || []).map(x => ({ ...x, valor: Number(x.valor), cliente: cli.get(x.client_id) || '—' }))
    },
  })
  if (error) return <p className="text-sm text-amber-700">{/ajudas_custo/.test((error as Error).message) ? 'Rode a migração 083 para usar a ajuda de custo.' : (error as Error).message}</p>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>
  const total = data.reduce((s, a) => s + a.valor, 0), pago = data.filter(a => a.status === 'Pago').reduce((s, a) => s + a.valor, 0)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[['Total', total, 'text-ink-900'], ['Pago', pago, 'text-green-700'], ['A pagar', total - pago, 'text-amber-700']].map(([r, v, c]) => (
          <div key={r as string} className="rounded-xl border border-ink-100 px-3 py-2"><p className="text-[11px] text-ink-500">{r as string}</p><p className={`font-semibold tnum ${c}`}>{formatCurrency(v as number)}</p></div>
        ))}
      </div>
      {!data.length ? <p className="text-sm text-ink-400">Nenhuma ajuda de custo neste mês.</p> : (
        <div className="divide-y divide-ink-100 rounded-xl border border-ink-100 overflow-hidden">
          {data.map(a => (
            <div key={a.id} className="px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">{a.tipo}{a.descricao ? ` · ${a.descricao}` : ''}</p>
                <p className="text-xs text-ink-500 truncate">{a.cliente} · {a.periodo === 'mes' ? 'mês inteiro' : `semana ${formatDate(a.inicio)} a ${formatDate(a.fim)}`}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold tnum">{formatCurrency(a.valor)}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusCor[a.status] || ''}`}>{a.status === 'Pago' ? 'Pago' : 'A pagar'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="btn-ghost text-sm" onClick={() => navigate('/pagamentos?aba=ajuda')}>Lançar ou marcar pago em Pagamentos <ArrowRight size={14} /></button>
    </div>
  )
}

type Lanc = { id: string; description: string; amount: number; due_date: string; status: string; reference_month: string | null; paid_at: string | null; comprovante_url?: string | null }

/** Todos os lançamentos da pessoa (últimos), com o comprovante de cada um */
export function LancamentosDaPessoa({ employeeId }: { employeeId: string }) {
  const qc = useQueryClient()
  const { data, error, isLoading } = useQuery({
    queryKey: ['lancamentos-pessoa', employeeId],
    queryFn: async () => {
      const cols = 'id, description, amount, due_date, status, reference_month, paid_at'
      const buscar = async (c: string) => {
        const { data, error } = await supabase.from('payments').select(c).eq('employee_id', employeeId).order('due_date', { ascending: false }).limit(60)
        return { data: data as unknown as Lanc[] | null, error }
      }
      let r = await buscar(cols + ', comprovante_url')
      if (r.error && /comprovante_url/.test(r.error.message)) r = await buscar(cols)   // sem a migração 083
      if (r.error) throw new Error(r.error.message)
      return r.data || []
    },
  })
  if (error) return <p className="text-sm text-red-700">{(error as Error).message}</p>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>
  if (!data.length) return <p className="text-sm text-ink-400">Nenhum lançamento ainda. Eles são criados na folha (Pagamentos → Folha do mês).</p>
  const temColuna = data.some(p => 'comprovante_url' in p)
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">Últimos {data.length} lançamentos · o que já saiu e o que falta pagar</p>
      <div className="divide-y divide-ink-100 rounded-xl border border-ink-100 overflow-hidden">
        {data.map(p => <LinhaLanc key={p.id} p={p} temColuna={temColuna} atualizou={() => qc.invalidateQueries({ queryKey: ['lancamentos-pessoa', employeeId] })} />)}
      </div>
    </div>
  )
}

function LinhaLanc({ p, temColuna, atualizou }: { p: Lanc; temColuna: boolean; atualizou: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const anexar = async (arq: File | undefined) => {
    if (!arq) return
    setEnviando(true)
    try {
      const file = arq.type.startsWith('image/') ? await comprimirImagem(arq) : arq
      const caminho = `comprovantes/pagamentos/${p.id}_${Date.now()}.${extensaoDoArquivo(file)}`
      const { error } = await supabase.storage.from('arquivos').upload(caminho, file, { upsert: false, contentType: file.type || undefined })
      if (error) throw error
      const { error: e2 } = await supabase.from('payments').update({ comprovante_url: caminho }).eq('id', p.id)
      if (e2) throw e2
      toast.success('Comprovante anexado'); atualizou()
    } catch (e) { toast.error('Não anexou: ' + (e as Error).message) } finally { setEnviando(false); if (ref.current) ref.current.value = '' }
  }
  const ver = async () => { const u = await getSignedUrl(p.comprovante_url!, 'arquivos'); if (u) window.open(u, '_blank') }
  return (
    <div className="px-3 py-2.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{p.description}</p>
        <p className="text-xs text-ink-500">{p.status === 'Pago' && p.paid_at ? `Pago em ${formatDate(p.paid_at.slice(0, 10))}` : `Vence ${formatDate(p.due_date)}`}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold tnum">{formatCurrency(Number(p.amount) || 0)}</p>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusCor[p.status] || ''}`}>{p.status}</span>
      </div>
      {temColuna && p.status === 'Pago' && (
        p.comprovante_url
          ? <button className="p-2 text-primary-700 shrink-0" onClick={ver} title="Ver comprovante"><Paperclip size={16} /></button>
          : <button className="p-2 text-ink-400 hover:text-primary-700 shrink-0" disabled={enviando} onClick={() => ref.current?.click()} title="Anexar comprovante">{enviando ? '…' : <Upload size={16} />}</button>
      )}
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => anexar(e.target.files?.[0])} />
    </div>
  )
}
