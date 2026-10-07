import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Download, X, Paperclip, CheckCircle2, Trash2, Home, Car, Fuel, UtensilsCrossed, Receipt, Undo2 } from 'lucide-react'
import { format, addDays, startOfWeek, endOfMonth, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { extensaoDoArquivo, comprimirImagem } from '../../lib/imagem'

/**
 * Ajuda de custo (migração 083) — pedido de 05/10/2026: a planilha de custos
 * do projeto que ia para o Wilson. Um lançamento = colaborador + cliente +
 * semana (ou mês) + tipo + valor. Controle próprio de pago e comprovante:
 * NÃO entra na conta da folha (lá já existe a ajuda de custo do vínculo).
 */

export const TIPOS_AJUDA = [
  { nome: 'Hospedagem', dica: 'Airbnb, hotel', Icone: Home },
  { nome: 'Carro', dica: 'Localiza, aluguel', Icone: Car },
  { nome: 'Combustível', dica: 'Gasolina', Icone: Fuel },
  { nome: 'Alimentação', dica: 'Refeições', Icone: UtensilsCrossed },
  { nome: 'Outro', dica: '', Icone: Receipt },
] as const

type Ajuda = {
  id: string; employee_id: string | null; client_id: string | null; periodo: 'semana' | 'mes'
  inicio: string; fim: string; tipo: string; descricao: string | null; valor: number
  status: 'Pendente' | 'Pago'; pago_em: string | null; comprovante_url: string | null; link_id?: string | null
}
type Nome = { id: string; nome: string }

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const segunda = (ds: string) => iso(startOfWeek(parseISO(ds), { weekStartsOn: 1 }))
const curto = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`

/**
 * Ajuda de custo SEMANAL do contrato (migração 085, pedido de 07/10/2026:
 * "pagamos semanalmente, toda segunda-feira"). Cria uma linha por segunda-feira
 * do mês para cada contrato semanal, para marcar pago aqui. Só cria o que
 * falta: semana editada à mão fica como está. Mudar valor ou voltar a mensal
 * (na ficha do colaborador) ajusta as semanas a pagar dali pra frente.
 */
async function sincronizarSemanasDoContrato(ini: string, fimMes: string) {
  const { data: links, error } = await supabase.from('employee_client_links')
    .select('id, employee_id, client_id, cost_assistance, cost_assistance_periodo, start_date, contract_end_date')
    .gt('cost_assistance', 0).eq('cost_assistance_periodo', 'semana')
  if (error || !links?.length) return   // sem a migração 085 ou sem contrato semanal
  const esperadas: { link_id: string; employee_id: string; client_id: string; inicio: string; fim: string; valor: number }[] = []
  for (const l of links || []) {
    for (let d = parseISO(segunda(ini)); iso(d) <= fimMes; d = addDays(d, 7)) {
      const seg = iso(d), dom = iso(addDays(d, 6))
      if (seg < ini) continue                                         // segunda do mês anterior
      if (l.start_date && l.start_date > dom) continue                // contrato ainda não começou
      if (l.contract_end_date && l.contract_end_date < seg) continue  // contrato já acabou
      esperadas.push({ link_id: l.id, employee_id: l.employee_id, client_id: l.client_id, inicio: seg, fim: dom, valor: Number(l.cost_assistance) })
    }
  }
  if (!esperadas.length) return
  const novas = esperadas.map(x => ({ ...x, periodo: 'semana', tipo: 'Outro', descricao: 'Ajuda de custo do contrato', status: 'Pendente' }))
  // Já existe (link_id, inicio)? Não mexe — índice único da 085
  await supabase.from('ajudas_custo').upsert(novas, { onConflict: 'link_id,inicio', ignoreDuplicates: true })
}

/** Ficha do colaborador mudou a ajuda do contrato: ajusta as semanas a pagar dali pra frente */
export async function ajustarSemanasDoContrato(linkIds: string[], valorSemanal: number | null) {
  if (!linkIds.length) return
  const desde = segunda(hojeISO())
  const q = supabase.from('ajudas_custo')
  const { error } = valorSemanal && valorSemanal > 0
    ? await q.update({ valor: valorSemanal }).in('link_id', linkIds).eq('status', 'Pendente').gte('inicio', desde)
    : await q.delete().in('link_id', linkIds).eq('status', 'Pendente').gte('inicio', desde)
  if (error && !/link_id/.test(error.message)) throw new Error(error.message)
}

export default function AjudaDeCusto({ mes }: { mes: string }) {
  const qc = useQueryClient()
  const ini = `${mes}-01`, fimMes = iso(endOfMonth(parseISO(ini)))
  const { data, isLoading, error } = useQuery({
    queryKey: ['ajudas-custo', mes],
    queryFn: async () => {
      await sincronizarSemanasDoContrato(ini, fimMes)
      const [a, e, c, l] = await Promise.all([
        supabase.from('ajudas_custo').select('*').lte('inicio', fimMes).gte('fim', ini).order('inicio'),
        supabase.from('employees').select('id, full_name, status').order('full_name'),
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('employee_client_links').select('employee_id, client_id'),
      ])
      if (a.error) throw new Error(a.error.message)
      return {
        ajudas: (a.data || []).map(x => ({ ...x, valor: Number(x.valor) })) as Ajuda[],
        pessoas: (e.data || []).filter(x => x.status === 'Ativo').map(x => ({ id: x.id, nome: x.full_name })) as Nome[],
        todasPessoas: new Map((e.data || []).map(x => [x.id, x.full_name as string])),
        clientes: (c.data || []).map(x => ({ id: x.id, nome: x.name })) as Nome[],
        vinculos: (l.data || []) as { employee_id: string; client_id: string }[],
      }
    },
  })
  const [form, setForm] = useState<Partial<Ajuda> | null>(null)
  const [filtroCliente, setFiltroCliente] = useState('')
  const semMigracao = error && /ajudas_custo/.test((error as Error).message)

  const nomeCli = useMemo(() => new Map((data?.clientes || []).map(c => [c.id, c.nome])), [data])
  const lista = (data?.ajudas || []).filter(a => !filtroCliente || a.client_id === filtroCliente)
  const total = lista.reduce((s, a) => s + a.valor, 0)
  const pago = lista.filter(a => a.status === 'Pago').reduce((s, a) => s + a.valor, 0)

  // Semanas que tocam o mês (segunda a domingo)
  const semanas = useMemo(() => {
    const out: { de: string; ate: string }[] = []
    for (let d = parseISO(segunda(ini)); iso(d) <= fimMes; d = addDays(d, 7)) out.push({ de: iso(d), ate: iso(addDays(d, 6)) })
    return out
  }, [ini, fimMes])

  // Por cliente → seções (semanas + mês inteiro)
  const porCliente = useMemo(() => {
    const m = new Map<string, Ajuda[]>()
    for (const a of lista) { const k = a.client_id || ''; m.set(k, [...(m.get(k) || []), a]) }
    return [...m.entries()].map(([cid, itens]) => ({ cid, nome: nomeCli.get(cid) || 'Sem cliente', itens }))
      .sort((x, y) => x.nome.localeCompare(y.nome))
  }, [lista, nomeCli])

  const baixarPlanilha = async () => {
    const XLSX = await import('xlsx')
    const linhas: (string | number)[][] = [['Cliente', 'Período', 'Colaborador', 'Tipo', 'Descrição', 'Valor', 'Status', 'Pago em']]
    for (const g of porCliente) {
      for (const a of [...g.itens].sort((x, y) => x.inicio.localeCompare(y.inicio))) {
        linhas.push([g.nome, a.periodo === 'mes' ? 'Mês inteiro' : `Semana ${curto(a.inicio)} a ${curto(a.fim)}`,
          data?.todasPessoas.get(a.employee_id || '') || '', a.tipo, a.descricao || '', a.valor, a.status, a.pago_em ? formatDate(a.pago_em) : ''])
      }
      linhas.push(['', '', '', '', `Total ${g.nome}`, g.itens.reduce((s, a) => s + a.valor, 0), '', ''], [])
    }
    linhas.push(['', '', '', '', 'TOTAL DO MÊS', total, '', ''])
    const ws = XLSX.utils.aoa_to_sheet(linhas)
    ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 26 }, { wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Todos')
    // Uma aba por cliente no formato da planilha do contador ("Custo Ponta Grossa"):
    // custos do mês (Airbnb, carro…) e o CONTROLE de cada semana, nutri por nutri
    const nomesUsados = new Set<string>(['Todos'])
    for (const g of porCliente) {
      const pessoa = (a: Ajuda) => data?.todasPessoas.get(a.employee_id || '') || ''
      const soma = (xs: Ajuda[]) => xs.reduce((t, a) => t + a.valor, 0)
      const custos = g.itens.filter(a => a.periodo === 'mes')
      const l: (string | number)[][] = [[g.nome], []]
      if (custos.length) {
        l.push(['Custos do mês', '', '', '', ''], ['Descrição', 'Nutri', 'Tipo', 'Valor', 'Situação'])
        for (const a of custos) l.push([a.descricao || a.tipo, pessoa(a), a.tipo, a.valor, a.status === 'Pago' ? 'Pago' : 'A pagar'])
        l.push(['Total', '', '', soma(custos), ''], [])
      }
      semanas.forEach((sem, i) => {
        const itens = g.itens.filter(a => a.periodo === 'semana' && a.inicio >= sem.de && a.inicio <= sem.ate)
        if (!itens.length) return
        l.push([`CONTROLE Semana ${i + 1} (${curto(sem.de)} a ${curto(sem.ate)})`, '', '', '', ''], ['DATA', 'NUTRI', 'TIPO', 'AJ DE CUSTO', 'SITUAÇÃO'])
        for (const a of [...itens].sort((x, y) => pessoa(x).localeCompare(pessoa(y)))) {
          l.push([curto(a.inicio), pessoa(a), a.link_id ? 'Contrato' : `${a.tipo}${a.descricao ? ' · ' + a.descricao : ''}`, a.valor, a.status === 'Pago' ? 'Pago' : a.valor === 0 ? 'Sem ajuda' : 'A pagar'])
        }
        l.push(['TOTAL', '', '', soma(itens), ''], [])
      })
      l.push(['TOTAL DO CLIENTE NO MÊS', '', '', soma(g.itens), ''])
      const wsC = XLSX.utils.aoa_to_sheet(l)
      wsC['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 26 }, { wch: 14 }, { wch: 12 }]
      for (const k of Object.keys(wsC)) { const c = wsC[k] as { t?: string; z?: string }; if (!k.startsWith('!') && c.t === 'n') c.z = '"R$" #,##0.00' }
      let nome = g.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sem cliente'
      for (let n = 2; nomesUsados.has(nome); n++) nome = `${nome.slice(0, 26)} ${n}`
      nomesUsados.add(nome)
      XLSX.utils.book_append_sheet(wb, wsC, nome)
    }
    XLSX.writeFile(wb, `ajuda_de_custo_${mes}.xlsx`)
  }

  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Para usar a Ajuda de custo, rode a migração 083 no Supabase.</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>

  return (
    <div className="space-y-4">
      {/* Resumo + ações */}
      <div className="grid grid-cols-3 gap-2">
        {[['Total do mês', total, 'text-ink-900'], ['Pago', pago, 'text-green-700'], ['A pagar', total - pago, 'text-amber-700']].map(([r, v, c]) => (
          <div key={r as string} className="card px-3 py-2.5">
            <p className="text-[11px] text-ink-500">{r as string}</p>
            <p className={`text-base sm:text-xl font-semibold tnum ${c}`}>{formatCurrency(v as number)}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <select className="input w-auto flex-1 min-w-[10rem]" value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
          <option value="">Todos os clientes</option>
          {[...new Set(data.ajudas.map(a => a.client_id).filter(Boolean))].map(id => <option key={id!} value={id!}>{nomeCli.get(id!)}</option>)}
        </select>
        <button className="btn-secondary text-sm" disabled={!lista.length} onClick={baixarPlanilha}><Download size={15} />Planilha</button>
        <button className="btn-primary text-sm" onClick={() => setForm({ periodo: 'semana', inicio: segunda(hojeISO() < ini || hojeISO() > fimMes ? ini : hojeISO()), tipo: 'Hospedagem', status: 'Pendente' })}><Plus size={15} />Lançar</button>
      </div>

      {!porCliente.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">Nenhuma ajuda de custo neste mês. Toque em <b>Lançar</b>.</div>
      ) : porCliente.map(g => {
        const secoes = [
          ...semanas.map((s, i) => ({ titulo: `Semana ${i + 1}`, sub: `${curto(s.de)} a ${curto(s.ate)}`, itens: g.itens.filter(a => a.periodo === 'semana' && a.inicio >= s.de && a.inicio <= s.ate) })),
          { titulo: 'Custos do mês', sub: 'Airbnb, carro e outros do mês', itens: g.itens.filter(a => a.periodo === 'mes') },
        ].filter(s => s.itens.length)
        const totalCli = g.itens.reduce((s, a) => s + a.valor, 0)
        return (
          <div key={g.cid} className="card overflow-hidden">
            <div className="px-4 py-3 bg-primary-900 text-white flex items-center justify-between gap-3">
              <p className="font-semibold truncate">{g.nome}</p>
              <p className="font-semibold tnum shrink-0">{formatCurrency(totalCli)}</p>
            </div>
            {secoes.map(s => {
              const st = s.itens.reduce((t, a) => t + a.valor, 0)
              return (
                <div key={s.titulo}>
                  <div className="px-4 py-2 bg-ink-50 border-y border-ink-100 flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink-700">{s.titulo} {s.sub && <span className="font-normal text-ink-500">· {s.sub}</span>}</span>
                    <span className="font-semibold text-ink-700 tnum">{formatCurrency(st)}</span>
                  </div>
                  <div className="divide-y divide-ink-100">
                    {s.itens.map(a => {
                      const T = TIPOS_AJUDA.find(t => t.nome === a.tipo) || TIPOS_AJUDA[4]
                      return (
                        <button key={a.id} onClick={() => setForm(a)} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-ink-50/60">
                          <span className="w-8 h-8 rounded-lg bg-ink-100 text-ink-600 flex items-center justify-center shrink-0"><T.Icone size={15} /></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink-900 truncate">{data.todasPessoas.get(a.employee_id || '') || '—'}</p>
                            <p className="text-xs text-ink-500 truncate">{a.link_id ? 'Contrato · paga na segunda' : <>{a.tipo}{a.descricao ? ` · ${a.descricao}` : ''}</>}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(a.valor)}</p>
                            <p className={`text-[11px] font-medium ${a.status === 'Pago' ? 'text-green-700' : a.valor === 0 ? 'text-ink-400' : 'text-amber-700'}`}>
                              {a.status === 'Pago' ? 'Pago' : a.valor === 0 ? 'Sem ajuda' : 'A pagar'}{a.comprovante_url && <Paperclip size={10} className="inline ml-1 -mt-0.5" />}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {form && <FormAjuda inicial={form} pessoas={data.pessoas} clientes={data.clientes} vinculos={data.vinculos} fimMes={fimMes}
        fechar={() => setForm(null)} salvo={() => { setForm(null); qc.invalidateQueries({ queryKey: ['ajudas-custo'] }) }} />}
    </div>
  )
}

function FormAjuda({ inicial, pessoas, clientes, vinculos, fimMes, fechar, salvo }: {
  inicial: Partial<Ajuda>; pessoas: Nome[]; clientes: Nome[]; vinculos: { employee_id: string; client_id: string }[]
  fimMes: string; fechar: () => void; salvo: () => void
}) {
  const editando = !!inicial.id
  const [f, setF] = useState<Partial<Ajuda>>(inicial)
  const [valorTxt, setValorTxt] = useState(inicial.valor != null ? String(inicial.valor).replace('.', ',') : '')
  const [repetir, setRepetir] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const arqRef = useRef<HTMLInputElement>(null)
  const muda = (m: Partial<Ajuda>) => setF(x => ({ ...x, ...m }))

  // Clientes da pessoa primeiro
  const daPessoa = new Set(vinculos.filter(v => v.employee_id === f.employee_id).map(v => v.client_id))
  const clientesOrdem = [...clientes.filter(c => daPessoa.has(c.id)), ...clientes.filter(c => !daPessoa.has(c.id))]
  const valor = Number(valorTxt.replace(/\./g, '').replace(',', '.'))
  const periodoDe = f.periodo === 'mes' ? `${(f.inicio || fimMes).slice(0, 7)}-01` : segunda(f.inicio || hojeISO())
  const periodoAte = f.periodo === 'mes' ? iso(endOfMonth(parseISO(periodoDe))) : iso(addDays(parseISO(periodoDe), 6))
  const doContrato = !!f.link_id   // semana criada pelo contrato semanal (085)
  const falta = !f.employee_id ? 'Escolha o colaborador.' : !f.client_id ? 'Escolha o cliente.' : !(valor > 0 || (doContrato && valor === 0)) ? 'Informe o valor.' : ''

  const salvar = async () => {
    if (falta) { toast.error(falta); return }
    setSalvando(true)
    const base = { employee_id: f.employee_id, client_id: f.client_id, periodo: f.periodo, tipo: f.tipo || 'Outro', descricao: f.descricao?.trim() || null, valor }
    let error
    if (editando) {
      ({ error } = await supabase.from('ajudas_custo').update({ ...base, inicio: periodoDe, fim: periodoAte }).eq('id', f.id!))
    } else {
      // Semanal com "repetir": uma linha por semana até o fim do mês
      const linhas = [{ ...base, inicio: periodoDe, fim: periodoAte }]
      if (f.periodo === 'semana' && repetir) {
        for (let d = addDays(parseISO(periodoDe), 7); iso(d) <= fimMes; d = addDays(d, 7)) linhas.push({ ...base, inicio: iso(d), fim: iso(addDays(d, 6)) })
      }
      ({ error } = await supabase.from('ajudas_custo').insert(linhas))
    }
    setSalvando(false)
    if (error) { toast.error('Não salvou: ' + error.message); return }
    toast.success(editando ? 'Salvo' : 'Lançado')
    salvo()
  }
  const marcarPago = async (pagoSim: boolean) => {
    const { error } = await supabase.from('ajudas_custo').update(pagoSim ? { status: 'Pago', pago_em: hojeISO() } : { status: 'Pendente', pago_em: null }).eq('id', f.id!)
    if (error) { toast.error(error.message); return }
    toast.success(pagoSim ? 'Marcado como pago' : 'Voltou para a pagar'); salvo()
  }
  const anexar = async (arquivo: File | undefined) => {
    if (!arquivo || !f.id) return
    try {
      const file = arquivo.type.startsWith('image/') ? await comprimirImagem(arquivo) : arquivo
      const caminho = `comprovantes/ajuda/${f.id}_${Date.now()}.${extensaoDoArquivo(file)}`
      const { error } = await supabase.storage.from('arquivos').upload(caminho, file, { upsert: false, contentType: file.type || undefined })
      if (error) throw error
      const { error: e2 } = await supabase.from('ajudas_custo').update({ comprovante_url: caminho }).eq('id', f.id)
      if (e2) throw e2
      toast.success('Comprovante anexado'); salvo()
    } catch (e) { toast.error('Não anexou: ' + (e as Error).message) }
  }
  const verComprovante = async () => { const u = await getSignedUrl(f.comprovante_url!, 'arquivos'); if (u) window.open(u, '_blank') }
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este lançamento?', confirmar: 'Excluir', perigo: true }))) return
    const { error } = await supabase.from('ajudas_custo').delete().eq('id', f.id!)
    if (error) { toast.error(error.message); return }
    salvo()
  }

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-900">{editando ? 'Ajuda de custo' : 'Lançar ajuda de custo'}</h3>
          <button onClick={fechar} className="p-2 -mr-2 text-ink-400" aria-label="Fechar"><X size={18} /></button>
        </div>

        {editando && (
          <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 ${f.status === 'Pago' ? 'bg-green-50' : 'bg-amber-50'}`}>
            <p className={`text-sm font-semibold ${f.status === 'Pago' ? 'text-green-800' : 'text-amber-800'}`}>
              {f.status === 'Pago' ? `Pago${f.pago_em ? ' em ' + formatDate(f.pago_em) : ''}` : 'A pagar'}
            </p>
            {f.status === 'Pago'
              ? <button className="btn-ghost text-xs" onClick={() => marcarPago(false)}><Undo2 size={13} />Desfazer</button>
              : <button className="btn-primary text-xs" onClick={() => marcarPago(true)}><CheckCircle2 size={14} />Marcar pago</button>}
          </div>
        )}

        <div><label className="label">Colaborador *</label>
          <select className="input" value={f.employee_id || ''} onChange={e => muda({ employee_id: e.target.value })}>
            <option value="">Escolha…</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select></div>
        <div><label className="label">Cliente *</label>
          <select className="input" value={f.client_id || ''} onChange={e => muda({ client_id: e.target.value })}>
            <option value="">Escolha…</option>
            {clientesOrdem.map((c, i) => <option key={c.id} value={c.id}>{c.nome}{i < daPessoa.size ? ' ★' : ''}</option>)}
          </select>
          {f.employee_id && daPessoa.size > 0 && <p className="text-[11px] text-ink-400 mt-1">★ clientes em que a pessoa tem vínculo</p>}</div>

        <div>
          <label className="label">Tipo</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            {TIPOS_AJUDA.map(t => (
              <button key={t.nome} type="button" onClick={() => muda({ tipo: t.nome })}
                className={`rounded-xl border px-1 py-2 flex flex-col items-center gap-1 text-[11px] font-medium ${f.tipo === t.nome ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-ink-200 text-ink-600'}`}>
                <t.Icone size={17} />{t.nome}
              </button>
            ))}
          </div>
        </div>
        <div><label className="label">Descrição</label><input className="input" value={f.descricao || ''} onChange={e => muda({ descricao: e.target.value })} placeholder={TIPOS_AJUDA.find(t => t.nome === f.tipo)?.dica || 'Ex.: Airbnb Hellen'} /></div>

        {doContrato ? (
          <div className="rounded-xl bg-primary-50 border border-primary-100 px-3 py-2.5 text-sm text-primary-900">
            <p className="font-medium">Ajuda de custo do contrato · semana de {formatDate(f.inicio!)} a {formatDate(f.fim!)}</p>
            <p className="text-xs mt-0.5 text-primary-800">Criada sozinha toda semana (paga na segunda). Para não pagar esta semana, deixe o valor em 0. O valor fixo muda na ficha do colaborador.</p>
          </div>
        ) : (
        <div>
          <label className="label">Período</label>
          <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 mb-2">
            {([['semana', 'Semana'], ['mes', 'Mês inteiro']] as const).map(([k, t]) => (
              <button key={k} type="button" onClick={() => muda({ periodo: k })} className={`flex-1 h-9 rounded-lg text-sm font-medium ${f.periodo === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
            ))}
          </div>
          {f.periodo === 'semana' ? (
            <>
              <input className="input" type="date" value={f.inicio || ''} onChange={e => e.target.value && muda({ inicio: e.target.value })} />
              <p className="text-xs text-ink-500 mt-1">Semana de <b>{formatDate(periodoDe)}</b> a <b>{formatDate(periodoAte)}</b> (segunda a domingo)</p>
              {!editando && (
                <label className="flex items-center gap-2 mt-2 text-sm text-ink-700 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-primary-700" checked={repetir} onChange={e => setRepetir(e.target.checked)} />
                  Repetir o mesmo valor nas próximas semanas do mês
                </label>
              )}
            </>
          ) : (
            <input className="input" type="month" value={(f.inicio || '').slice(0, 7)} onChange={e => e.target.value && muda({ inicio: e.target.value + '-01' })} />
          )}
        </div>
        )}
        <div><label className="label">Valor *</label>
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">R$</span>
            <input className="input pl-9 tnum" inputMode="decimal" value={valorTxt} onChange={e => setValorTxt(e.target.value.replace(/[^\d,.]/g, ''))} placeholder="0,00" /></div></div>

        {editando && (
          <div className="flex items-center gap-2 flex-wrap">
            {f.comprovante_url && <button className="btn-secondary text-sm" onClick={verComprovante}><Paperclip size={14} />Ver comprovante</button>}
            <button className="btn-ghost text-sm" onClick={() => arqRef.current?.click()}><Paperclip size={14} />{f.comprovante_url ? 'Trocar comprovante' : 'Anexar comprovante'}</button>
            <input ref={arqRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => anexar(e.target.files?.[0])} />
          </div>
        )}

        <div className="flex gap-2">
          {editando && !doContrato && <button className="btn-ghost text-red-600 text-sm mr-auto" onClick={excluir}><Trash2 size={15} />Excluir</button>}
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={salvando || !!falta} onClick={salvar}>{salvando ? 'Salvando…' : editando ? 'Salvar' : 'Lançar'}</button>
        </div>
      </div>
    </div>
  )
}
