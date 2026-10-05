import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Paperclip, Search, X, CheckCircle2, Upload } from 'lucide-react'
import { endOfMonth, parseISO, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, semAcento } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { extensaoDoArquivo, comprimirImagem } from '../../lib/imagem'

/**
 * Comprovantes de pagamento (migração 083) — pedido de 05/10/2026: um lugar
 * só para guardar o comprovante de cada pagamento feito. Lista o que foi
 * pago no mês (folha e ajuda de custo); toca em "Anexar" e escolhe o arquivo.
 */

type Linha = {
  chave: string; tabela: 'payments' | 'ajudas_custo'; id: string
  nome: string; descricao: string; valor: number; data: string | null; comprovante: string | null
}

export default function Comprovantes({ mes }: { mes: string }) {
  const qc = useQueryClient()
  const ini = `${mes}-01`, fim = format(endOfMonth(parseISO(ini)), 'yyyy-MM-dd')
  const { data, isLoading, error } = useQuery({
    queryKey: ['comprovantes', mes],
    queryFn: async () => {
      const [p, a, e, c] = await Promise.all([
        supabase.from('payments').select('id, description, amount, due_date, paid_at, comprovante_url, employee:employees(full_name)')
          .eq('status', 'Pago')
          .or(`reference_month.eq.${mes},and(reference_month.is.null,due_date.gte.${ini},due_date.lte.${fim})`)
          .order('due_date'),
        supabase.from('ajudas_custo').select('id, employee_id, client_id, tipo, descricao, valor, pago_em, inicio, fim, comprovante_url')
          .eq('status', 'Pago').lte('inicio', fim).gte('fim', ini),
        supabase.from('employees').select('id, full_name'),
        supabase.from('clients').select('id, name'),
      ])
      if (p.error) throw new Error(p.error.message)
      const pessoa = new Map((e.data || []).map(x => [x.id, x.full_name as string]))
      const cliente = new Map((c.data || []).map(x => [x.id, x.name as string]))
      const linhas: Linha[] = [
        ...(p.data || []).map(x => ({
          chave: 'p' + x.id, tabela: 'payments' as const, id: x.id,
          nome: (x as unknown as { employee?: { full_name?: string } | null }).employee?.full_name || '—',
          descricao: x.description, valor: Number(x.amount) || 0,
          data: (x.paid_at as string | null)?.slice(0, 10) || x.due_date, comprovante: x.comprovante_url,
        })),
        // Sem a migração 083 a tabela não existe: segue só com os pagamentos
        ...(a.error ? [] : (a.data || []).map(x => ({
          chave: 'a' + x.id, tabela: 'ajudas_custo' as const, id: x.id,
          nome: pessoa.get(x.employee_id || '') || '—',
          descricao: `Ajuda de custo · ${x.tipo}${x.descricao ? ' · ' + x.descricao : ''}${x.client_id ? ' · ' + (cliente.get(x.client_id) || '') : ''}`,
          valor: Number(x.valor) || 0, data: x.pago_em, comprovante: x.comprovante_url,
        }))),
      ]
      return linhas.sort((x, y) => x.nome.localeCompare(y.nome))
    },
  })
  const [filtro, setFiltro] = useState<'falta' | 'com' | 'todos'>('falta')
  const [busca, setBusca] = useState('')
  const semMigracao = error && /comprovante_url/.test((error as Error).message)

  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Para guardar comprovantes, rode a migração 083 no Supabase.</div>
  if (error) return <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>

  const semComp = data.filter(l => !l.comprovante).length
  const b = semAcento(busca.trim().toLowerCase())
  const lista = data
    .filter(l => filtro === 'todos' || (filtro === 'falta' ? !l.comprovante : !!l.comprovante))
    .filter(l => !b || semAcento(`${l.nome} ${l.descricao}`.toLowerCase()).includes(b))

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${semComp ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
          {semComp ? <Paperclip size={18} /> : <CheckCircle2 size={18} />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{semComp ? `${semComp} pagamento(s) sem comprovante` : 'Todos os pagamentos têm comprovante'}</p>
          <p className="text-xs text-ink-500">{data.length} pago(s) neste mês · folha e ajuda de custo</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70">
          {([['falta', `Sem comprovante (${semComp})`], ['com', `Com (${data.length - semComp})`], ['todos', 'Todos']] as const).map(([k, t]) => (
            <button key={k} onClick={() => setFiltro(k)} className={`px-3 h-9 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap ${filtro === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9 pr-9" placeholder="Buscar pessoa…" value={busca} onChange={e => setBusca(e.target.value)} />
          {busca && <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-400" aria-label="Limpar"><X size={14} /></button>}
        </div>
      </div>

      {!lista.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">
          {data.length ? 'Nada aqui.' : <>Nenhum pagamento marcado como pago neste mês.<br /><span className="text-xs">Quando marcar como Pago na folha, ele aparece aqui para anexar o comprovante.</span></>}
        </div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {lista.map(l => <LinhaComprovante key={l.chave} l={l} atualizou={() => qc.invalidateQueries({ queryKey: ['comprovantes'] })} />)}
        </div>
      )}
    </div>
  )
}

function LinhaComprovante({ l, atualizou }: { l: Linha; atualizou: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const anexar = async (arquivo: File | undefined) => {
    if (!arquivo) return
    setEnviando(true)
    try {
      const file = arquivo.type.startsWith('image/') ? await comprimirImagem(arquivo) : arquivo
      const caminho = `comprovantes/${l.tabela === 'payments' ? 'pagamentos' : 'ajuda'}/${l.id}_${Date.now()}.${extensaoDoArquivo(file)}`
      const { error } = await supabase.storage.from('arquivos').upload(caminho, file, { upsert: false, contentType: file.type || undefined })
      if (error) throw error
      const { error: e2 } = await supabase.from(l.tabela).update({ comprovante_url: caminho }).eq('id', l.id)
      if (e2) throw e2
      toast.success('Comprovante anexado')
      atualizou()
    } catch (e) { toast.error('Não anexou: ' + (e as Error).message) } finally {
      setEnviando(false); if (ref.current) ref.current.value = ''
    }
  }
  const ver = async () => { const u = await getSignedUrl(l.comprovante!, 'arquivos'); if (u) window.open(u, '_blank'); else toast.error('Não abriu o arquivo') }
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink-900 truncate">{l.nome}</p>
        <p className="text-xs text-ink-500 truncate">{l.descricao}</p>
        <p className="text-[11px] text-ink-400">{l.data ? `Pago em ${formatDate(l.data)}` : 'Pago'} · <span className="tnum font-medium text-ink-700">{formatCurrency(l.valor)}</span></p>
      </div>
      {l.comprovante && <button className="btn-secondary text-xs shrink-0" onClick={ver}><Paperclip size={13} />Ver</button>}
      <button className={`${l.comprovante ? 'btn-ghost' : 'btn-primary'} text-xs shrink-0`} disabled={enviando} onClick={() => ref.current?.click()}>
        <Upload size={13} />{enviando ? 'Enviando…' : l.comprovante ? 'Trocar' : 'Anexar'}
      </button>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => anexar(e.target.files?.[0])} />
    </div>
  )
}
