import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, X, Paperclip, ArrowRightLeft, Download, CheckCircle2, Clock, Wallet, CalendarClock, Ban, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { SignedLink } from '../../components/ui/SignedFile'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { baixarPlanilhaComAnexos } from '../../lib/planilhaComComprovantes'

/**
 * Aba Reembolsos (pedido de 16/10/2026: "preciso de uma visão mais clara dos
 * pagamentos, principalmente reembolsos"). Todo reembolso/gasto do mês num
 * lugar só: situação, ONDE é pago (no salário ou na segunda, junto da Ajuda de
 * custo), se já foi pago, nota, observação do RH. Dá para mudar de salário para
 * segunda (e o contrário) depois de aprovado — o gatilho da 093 cuida da Ajuda
 * de custo. Mudar não é permitido se o lado de onde sai já foi pago.
 */
type Gasto = {
  id: string; employee_id: string; client_id?: string | null; description: string; amount: number; category?: string | null
  notes?: string | null; obs_rh?: string | null; receipt_url?: string | null; status: 'pendente' | 'aprovado' | 'negado'
  created_at?: string; reviewed_at?: string | null; pagar_na_semana?: boolean | null; reference_month?: string
  employee?: { full_name: string } | null; client?: { name: string } | null
}
type Ajuda = { id: string; expense_id: string; inicio: string; status: 'Pendente' | 'Pago'; pago_em: string | null; valor: number; comprovante_url: string | null }
type Linha = Gasto & {
  onde: 'analisar' | 'salario' | 'segunda' | 'negado'
  ajuda?: Ajuda
  pago: boolean
  pagoTexto: string
  reembolso: boolean
}
type Filtro = 'todos' | 'analisar' | 'salario' | 'segunda' | 'negado'

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const proximaSegundaISO = () => { const d = new Date(hojeISO() + 'T12:00:00'); d.setDate(d.getDate() + ((8 - (d.getDay() || 7)) % 7)); return d.toISOString().slice(0, 10) }

export default function Reembolsos({ mes }: { mes: string }) {
  const qc = useQueryClient()
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [mexendo, setMexendo] = useState<string | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['reembolsos-mes', mes],
    queryFn: async () => {
      const sel = (comCliente: boolean) => supabase.from('employee_expenses')
        .select(`*, employee:employees(full_name)${comCliente ? ', client:clients(name)' : ''}`)
        .eq('reference_month', mes).order('created_at', { ascending: false })
      let { data: gastos, error } = await sel(true)
      if (error && /client/.test(error.message)) ({ data: gastos, error } = await sel(false))
      if (error) throw new Error(error.message)
      // Pedido esperando decisão em OUTRO mês também aparece aqui (26/10/2026:
      // um pedido do portal não aparecia porque estava em outro mês da tela)
      const { data: outros } = await supabase.from('employee_expenses')
        .select('*, employee:employees(full_name)').eq('status', 'pendente').neq('reference_month', mes)
        .order('created_at', { ascending: false })
      const lista = [...((outros || []) as unknown as Gasto[]), ...((gastos || []) as unknown as Gasto[])]
      const ids = lista.map(g => g.id)
      const pessoas = [...new Set(lista.map(g => g.employee_id))]
      const [aj, pg] = await Promise.all([
        ids.length ? supabase.from('ajudas_custo').select('id, expense_id, inicio, status, pago_em, valor, comprovante_url').in('expense_id', ids) : Promise.resolve({ data: [], error: null }),
        // Salário do mês já pago: reembolso no salário conta como pago junto
        pessoas.length ? supabase.from('payments').select('employee_id, status, paid_at').eq('reference_month', mes).eq('status', 'Pago').in('employee_id', pessoas) : Promise.resolve({ data: [], error: null }),
      ])
      const ajudas = new Map(((aj.data || []) as Ajuda[]).map(a => [a.expense_id, { ...a, valor: Number(a.valor) }]))
      const salarioPago = new Map<string, string | null>()
      for (const p of (pg.data || []) as { employee_id: string; paid_at?: string | null }[]) salarioPago.set(p.employee_id, p.paid_at ? String(p.paid_at).slice(0, 10) : null)
      return { lista, ajudas, salarioPago }
    },
  })

  const linhas: Linha[] = useMemo(() => (data?.lista || []).map(g => {
    const ajuda = data!.ajudas.get(g.id)
    const reembolso = (g.category || 'Reembolso') === 'Reembolso'
    if (g.status === 'pendente') return { ...g, onde: 'analisar', pago: false, pagoTexto: '', reembolso }
    if (g.status === 'negado') return { ...g, onde: 'negado', pago: false, pagoTexto: '', reembolso }
    if (ajuda) {
      const pago = ajuda.status === 'Pago'
      return { ...g, onde: 'segunda', ajuda, pago, pagoTexto: pago ? `Pago${ajuda.pago_em ? ' em ' + formatDate(ajuda.pago_em) : ''}` : 'A pagar', reembolso }
    }
    const pago = data!.salarioPago.has(g.employee_id)
    const quando = data!.salarioPago.get(g.employee_id)
    return { ...g, onde: 'salario', pago, pagoTexto: pago ? `Pago com o salário${quando ? ' em ' + formatDate(quando) : ''}` : 'A pagar', reembolso }
  }), [data])

  const sem = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const termo = sem(busca.trim())
  const ordem = { analisar: 0, salario: 1, segunda: 1, negado: 2 } as const
  const visiveis = linhas
    .filter(l => filtro === 'todos' || l.onde === filtro)
    .filter(l => !termo || sem([l.employee?.full_name, l.description, l.client?.name, l.notes].filter(Boolean).join(' ')).includes(termo))
    .sort((a, b) => ordem[a.onde] - ordem[b.onde])
  const outroMes = (l: Linha) => !!l.reference_month && l.reference_month !== mes
  const nomeDoMes = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const soma = (xs: Linha[]) => xs.reduce((t, l) => t + Number(l.amount), 0)
  const resumo = {
    analisar: linhas.filter(l => l.onde === 'analisar'),
    salario: linhas.filter(l => l.onde === 'salario'),
    segunda: linhas.filter(l => l.onde === 'segunda'),
    negado: linhas.filter(l => l.onde === 'negado'),
    pago: linhas.filter(l => l.pago),
  }

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['reembolsos-mes', mes] })
    qc.invalidateQueries({ queryKey: ['expenses', mes] })
    qc.invalidateQueries({ queryKey: ['ajudas-custo'] })
  }
  const salvar = async (id: string, mudar: Record<string, unknown>, ok: string) => {
    setMexendo(id)
    const { error } = await supabase.from('employee_expenses').update(mudar).eq('id', id)
    setMexendo(null)
    if (error) {
      toast.error(/obs_rh/.test(error.message) ? 'Rode a migração 095 no Supabase para salvar observações.'
        : /pagar_na_semana/.test(error.message) ? 'Rode a migração 093 no Supabase para escolher onde o reembolso é pago.' : error.message)
      return false
    }
    toast.success(ok); recarregar(); return true
  }
  const seg = dm(proximaSegundaISO())
  const aprovar = (l: Linha, naSemana: boolean) => salvar(l.id, { status: 'aprovado', reviewed_at: new Date().toISOString(), pagar_na_semana: naSemana },
    naSemana ? `Aprovado — pago na segunda ${seg}, com a ajuda de custo.` : 'Aprovado — entra no salário.')
  const negar = async (l: Linha) => {
    if (!(await confirmar({ titulo: 'Negar este reembolso?', texto: `${l.employee?.full_name} · ${l.description} · ${formatCurrency(Number(l.amount))}`, confirmar: 'Negar', perigo: true }))) return
    salvar(l.id, { status: 'negado', reviewed_at: new Date().toISOString() }, 'Reembolso negado.')
  }
  const reabrir = (l: Linha) => salvar(l.id, { status: 'pendente', reviewed_at: null }, 'Voltou para analisar.')
  const paraSegunda = async (l: Linha) => {
    if (l.pago) { toast.error('O salário deste mês já foi marcado como pago. Mudar agora pagaria duas vezes.'); return }
    if (!(await confirmar({ titulo: `Pagar na segunda ${seg}?`, texto: `Sai do salário e vai para a ajuda de custo da segunda ${seg}. ${formatCurrency(Number(l.amount))} · ${l.employee?.full_name}.`, confirmar: 'Mudar para a segunda' }))) return
    salvar(l.id, { pagar_na_semana: true }, `Mudou — pago na segunda ${seg}.`)
  }
  const paraSalario = async (l: Linha) => {
    if (l.pago) { toast.error('Já foi pago na segunda. Para mudar, desfaça o pagamento na aba Ajuda de custo.'); return }
    if (!(await confirmar({ titulo: 'Pagar no salário?', texto: `Sai da ajuda de custo da segunda ${l.ajuda ? dm(l.ajuda.inicio) : ''} e entra no salário do mês. ${formatCurrency(Number(l.amount))} · ${l.employee?.full_name}.`, confirmar: 'Mudar para o salário' }))) return
    salvar(l.id, { pagar_na_semana: false }, 'Mudou — entra no salário.')
  }

  const ondeTexto = (l: Linha) => l.onde === 'analisar' ? 'Para analisar' : l.onde === 'negado' ? 'Negado'
    : l.onde === 'segunda' ? `Na segunda ${l.ajuda ? dm(l.ajuda.inicio) : ''} (ajuda de custo)` : 'No salário do mês'

  // Só a planilha (.xlsx) e, à parte, os comprovantes num PDF (19/10/2026: o zip
  // não subia). Mesma ordem nos dois: o "Anexo N" da planilha é a página no PDF.
  const nomeMes = new Date(mes + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const emOrdem = () => linhas.filter(l => !outroMes(l)).sort((a, b) => (a.employee?.full_name || '').localeCompare(b.employee?.full_name || '', 'pt-BR')
    || String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const comprovanteDe = (l: Linha) => l.receipt_url || l.ajuda?.comprovante_url || null
  const situacaoTexto = (l: Linha) => l.status === 'pendente' ? 'Para analisar' : l.status === 'negado' ? 'Negado' : 'Aprovado'
  const baixar = async () => {
    setBaixando('Gerando…')
    try {
      await baixarPlanilhaComAnexos(`reembolsos_${mes}`, [{
        nome: 'Reembolsos', titulo: `Reembolsos · ${nomeMes}`,
        cabecalho: ['Colaborador', 'Cliente', 'O quê', 'Tipo', 'Valor', 'Pedido em', 'Situação', 'Onde é pago', 'Pagamento', 'Obs. da colaboradora', 'Observação do RH'],
        larguras: [28, 22, 30, 14, 13, 12, 14, 30, 24, 30, 30],
        colunasDinheiro: [4],
        linhas: emOrdem().map(l => ({
          valores: [l.employee?.full_name || '', l.client?.name || '', l.description, l.category || 'Reembolso', Number(l.amount),
            l.created_at ? formatDate(l.created_at.slice(0, 10)) : '', situacaoTexto(l),
            ondeTexto(l), l.onde === 'salario' || l.onde === 'segunda' ? l.pagoTexto : '', l.notes || '', l.obs_rh || ''],
          comprovante: comprovanteDe(l),
          cor: l.status === 'negado' ? 'cinza' as const : undefined,
        })),
      }])
      toast.success(`Planilha de ${nomeMes} baixada`)
    } catch (e) { toast.error('Não gerou a planilha: ' + (e as Error).message) }
    setBaixando(null)
  }
  const baixarComprovantes = async () => {
    const itens = emOrdem()
    const n = itens.filter(comprovanteDe).length
    if (!n) { toast.error('Nenhum comprovante anexado neste mês.'); return }
    setBaixando('Gerando PDF…')
    try {
      const { gerarPdfComprovantes, baixarBlob } = await import('../../lib/comprovantesPdf')
      const blob = await gerarPdfComprovantes({
        titulo: 'Comprovantes dos reembolsos', periodo: nomeMes,
        itens: itens.map(l => ({
          pessoa: l.employee?.full_name || 'Sem colaborador', descricao: l.description || l.category || 'Reembolso', valor: Number(l.amount) || 0,
          data: (l.created_at || '').slice(0, 10), caminho: comprovanteDe(l), extra: [situacaoTexto(l), l.client?.name].filter(Boolean).join(' · '),
          obs: [l.notes?.trim(), l.obs_rh?.trim() ? `RH: ${l.obs_rh.trim()}` : ''].filter(Boolean).join(' · '),
        })),
        aoProgredir: t => setBaixando(`Baixando ${t}…`),
      })
      baixarBlob(blob, `comprovantes_reembolsos_${mes}.pdf`)
      toast.success(`PDF com ${n} comprovante(s) baixado`)
    } catch (e) { toast.error('Não gerou os comprovantes: ' + (e as Error).message) }
    setBaixando(null)
  }

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>

  const cartoes: [Filtro, string, Linha[], string, typeof Clock][] = [
    ['analisar', 'Para analisar', resumo.analisar, 'text-amber-700', Clock],
    ['salario', 'No salário', resumo.salario, 'text-ink-900', Wallet],
    ['segunda', 'Na segunda', resumo.segunda, 'text-primary-800', CalendarClock],
    ['negado', 'Negados', resumo.negado, 'text-ink-400', Ban],
  ]

  return (
    <div className="space-y-4">
      {/* Resumo: tocar filtra */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {cartoes.map(([k, rotulo, xs, cor, Icone]) => (
          <button key={k} onClick={() => setFiltro(f => f === k ? 'todos' : k)}
            className={`card px-3 py-2.5 text-left transition-colors ${filtro === k ? 'border-primary-500 ring-1 ring-primary-200' : 'hover:border-ink-300'}`}>
            <p className="text-[11px] text-ink-500 flex items-center gap-1"><Icone size={12} />{rotulo} · {xs.length}</p>
            <p className={`text-lg font-semibold tnum ${cor}`}>{formatCurrency(soma(xs))}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[14rem] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input text-sm !py-1.5 !pl-8" placeholder="Procurar pessoa ou o quê (ex.: Hellen, Uber)" value={busca} onChange={e => setBusca(e.target.value)} />
        </label>
        <p className="text-xs text-ink-500 flex-1 min-w-[10rem]">
          <CheckCircle2 size={12} className="inline -mt-0.5 text-green-700" /> Já pago: <b className="text-ink-800">{formatCurrency(soma(resumo.pago))}</b>
          {filtro !== 'todos' && <> · <button className="text-primary-700 underline" onClick={() => setFiltro('todos')}>ver todos</button></>}
        </p>
        <button className="btn-secondary text-sm" disabled={!linhas.length || !!baixando} onClick={baixarComprovantes}
          title="Os comprovantes num PDF só, um por página, em ordem de nome">
          <Paperclip size={15} />Comprovantes (PDF)
        </button>
        <button className="btn-secondary text-sm" disabled={!linhas.length || !!baixando} onClick={baixar}>
          <Download size={15} />{baixando || 'Planilha'}
        </button>
      </div>

      {visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">{termo ? `Nada com "${busca.trim()}" neste mês. Troque o mês no topo para procurar em outro.` : linhas.length ? 'Nada neste filtro.' : 'Nenhum reembolso neste mês.'}</div>
      ) : (
        <div className="card overflow-hidden divide-y divide-ink-100">
          {visiveis.map(l => (
            <div key={l.id} className={`px-4 py-3 space-y-2 ${l.onde === 'negado' ? 'bg-ink-50/60' : l.onde === 'analisar' ? 'bg-amber-50/40' : ''}`}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-sm font-semibold text-ink-900">{l.employee?.full_name || '—'}
                    {l.client?.name && <span className="font-normal text-ink-500"> · {l.client.name}</span>}</p>
                  <p className="text-sm text-ink-700">{l.description}
                    {l.category && l.category !== 'Reembolso' && <span className="badge bg-ink-100 text-ink-600 text-[10px] ml-1.5">{l.category}</span>}</p>
                  <p className="text-[11px] text-ink-500">Pedido em {l.created_at ? formatDate(l.created_at.slice(0, 10)) : '—'}{l.notes ? ` · "${l.notes}"` : ''}
                    {outroMes(l) && <span className="ml-1.5 badge bg-amber-100 text-amber-800 text-[10px]">pedido de {nomeDoMes(l.reference_month!)}</span>}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-base font-semibold tnum ${l.onde === 'negado' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{formatCurrency(Number(l.amount))}</p>
                  {l.receipt_url || l.ajuda?.comprovante_url ? (
                    <SignedLink value={(l.receipt_url || l.ajuda?.comprovante_url)!} bucket="arquivos" className="text-xs text-primary-700 inline-flex items-center gap-1 hover:underline">
                      <Paperclip size={11} />Ver nota
                    </SignedLink>
                  ) : <span className="text-[11px] text-red-600">Sem nota</span>}
                </div>
              </div>

              {/* Onde é pago + ações */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                  l.onde === 'analisar' ? 'bg-amber-100 text-amber-800' : l.onde === 'negado' ? 'bg-ink-100 text-ink-500'
                  : l.onde === 'segunda' ? 'bg-primary-50 text-primary-800' : 'bg-ink-100 text-ink-800'}`}>{ondeTexto(l)}</span>
                {(l.onde === 'salario' || l.onde === 'segunda') && (
                  <span className={`text-xs font-medium ${l.pago ? 'text-green-700' : 'text-amber-700'}`}>{l.pago && <Check size={12} className="inline -mt-0.5" />} {l.pagoTexto}</span>
                )}
                <div className="flex gap-1.5 flex-wrap ml-auto">
                  {l.onde === 'analisar' && (
                    <>
                      <button className="btn-primary text-xs py-1.5" disabled={mexendo === l.id} onClick={() => aprovar(l, false)}><Check size={12} />Aprovar · no salário</button>
                      {l.reembolso && <button className="btn-secondary text-xs py-1.5" disabled={mexendo === l.id} onClick={() => aprovar(l, true)}><Check size={12} />Aprovar · segunda {seg}</button>}
                      <button className="btn-secondary text-xs py-1.5 text-red-600" disabled={mexendo === l.id} onClick={() => negar(l)}><X size={12} />Negar</button>
                    </>
                  )}
                  {l.onde === 'salario' && l.reembolso && !l.pago && (
                    <button className="btn-secondary text-xs py-1.5" disabled={mexendo === l.id} onClick={() => paraSegunda(l)}><ArrowRightLeft size={12} />Mudar para a segunda {seg}</button>
                  )}
                  {l.onde === 'segunda' && !l.pago && (
                    <button className="btn-secondary text-xs py-1.5" disabled={mexendo === l.id} onClick={() => paraSalario(l)}><ArrowRightLeft size={12} />Mudar para o salário</button>
                  )}
                  {l.onde === 'negado' && (
                    <button className="btn-ghost text-xs py-1.5" disabled={mexendo === l.id} onClick={() => reabrir(l)}>Analisar de novo</button>
                  )}
                </div>
              </div>

              <ObservacaoRH valor={l.obs_rh || ''} salvar={v => salvar(l.id, { obs_rh: v || null }, 'Observação salva')} />
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-500">
        <b>No salário</b>: sai junto com o pagamento do mês (dia 8, 15 ou 20 da pessoa). <b>Na segunda</b>: sai na ajuda de custo da segunda-feira indicada e não soma no salário.
        Só dá para mudar o que ainda não foi pago.
      </p>
    </div>
  )
}

/** Observação do RH: salva ao sair do campo */
function ObservacaoRH({ valor, salvar }: { valor: string; salvar: (v: string) => Promise<boolean> }) {
  const [txt, setTxt] = useState(valor)
  const [aberta, setAberta] = useState(!!valor)
  if (!aberta) return <button className="text-xs text-primary-700 hover:underline" onClick={() => setAberta(true)}>+ Observação</button>
  return (
    <input className="input text-sm !py-1.5" placeholder="Observação do RH (sai na planilha)" value={txt} autoFocus={!valor}
      onChange={e => setTxt(e.target.value)}
      onBlur={async () => { const v = txt.trim(); if (v === valor) { if (!v) setAberta(false); return } await salvar(v) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
