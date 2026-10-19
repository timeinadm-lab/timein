import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Download, X, Paperclip, CheckCircle2, Trash2, Home, Car, Fuel, UtensilsCrossed, Receipt, Undo2, Check, Table2, List, Wallet } from 'lucide-react'
import { format, addDays, startOfWeek, endOfMonth, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { extensaoDoArquivo, comprimirImagem } from '../../lib/imagem'
import { ptBR } from 'date-fns/locale'

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
  // Reembolso aprovado entra sozinho (migração 090); dá para lançar à mão também
  { nome: 'Reembolso', dica: 'Uber, ônibus', Icone: Wallet },
  { nome: 'Outro', dica: '', Icone: Receipt },
] as const

type Ajuda = {
  id: string; employee_id: string | null; client_id: string | null; periodo: 'semana' | 'mes'
  inicio: string; fim: string; tipo: string; descricao: string | null; valor: number
  status: 'Pendente' | 'Pago'; pago_em: string | null; comprovante_url: string | null; link_id?: string | null
  expense_id?: string | null   // reembolso aprovado (090)
  observacao?: string | null   // observação do RH (095)
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
    .select('id, employee_id, client_id, cost_assistance, cost_assistance_periodo, start_date, contract_end_date, employee:employees(status, dismissal_date)')
    .gt('cost_assistance', 0).eq('cost_assistance_periodo', 'semana')
  if (error || !links?.length) return   // sem a migração 085 ou sem contrato semanal
  const esperadas: { link_id: string; employee_id: string; client_id: string; inicio: string; fim: string; valor: number }[] = []
  for (const l of links || []) {
    // Desligada: nada depois da saída (092). Sem isso a aba recriava as semanas dela toda vez que abria
    const emp = (Array.isArray(l.employee) ? l.employee[0] : l.employee) as { status?: string; dismissal_date?: string | null } | null
    const saida = emp?.status === 'Inativo' ? (emp.dismissal_date || hojeISO()) : null
    for (let d = parseISO(segunda(ini)); iso(d) <= fimMes; d = addDays(d, 7)) {
      const seg = iso(d), dom = iso(addDays(d, 6))
      if (seg < ini) continue                                         // segunda do mês anterior
      if (l.start_date && l.start_date > dom) continue                // contrato ainda não começou
      if (l.contract_end_date && l.contract_end_date < seg) continue  // contrato já acabou
      if (saida && saida < seg) continue                              // pessoa já tinha saído
      esperadas.push({ link_id: l.id, employee_id: l.employee_id, client_id: l.client_id, inicio: seg, fim: dom, valor: Number(l.cost_assistance) })
    }
  }
  if (!esperadas.length) return
  const novas = esperadas.map(x => ({ ...x, periodo: 'semana', tipo: 'Outro', descricao: 'Ajuda de custo do contrato', status: 'Pendente' }))
  // Já existe (link_id, inicio)? Não mexe — índice único da 085
  await supabase.from('ajudas_custo').upsert(novas, { onConflict: 'link_id,inicio', ignoreDuplicates: true })
}

/**
 * Ficha do colaborador mudou a ajuda do contrato: ajusta as semanas a pagar dali pra frente.
 * Com valorAntigo, só muda a semana que ainda está com ele: a que o RH editou na
 * tabela (ex.: proporcional da 1ª semana) fica como está.
 */
export async function ajustarSemanasDoContrato(linkIds: string[], valorSemanal: number | null, valorAntigo?: number) {
  if (!linkIds.length) return
  const desde = segunda(hojeISO())
  const q = supabase.from('ajudas_custo')
  if (valorSemanal && valorSemanal > 0 && valorSemanal === valorAntigo) return
  let upd = q.update({ valor: valorSemanal }).in('link_id', linkIds).eq('status', 'Pendente').gte('inicio', desde)
  if (valorAntigo != null) upd = upd.eq('valor', valorAntigo)
  const { error } = valorSemanal && valorSemanal > 0
    ? await upd
    : await q.delete().in('link_id', linkIds).eq('status', 'Pendente').gte('inicio', desde)
  if (error && !/link_id/.test(error.message)) throw new Error(error.message)
}

/**
 * Datas do contrato mudaram (encerrou, venceu antes, começou depois, foi apagado):
 * tira as semanas a pagar que ficaram fora dele. Sem isso a segunda depois do
 * encerramento continuava "Pendente" na aba e podia ser paga. Pago nunca sai.
 */
export async function limparSemanasForaDoContrato(linkId: string, inicio: string | null, fim: string | null) {
  const base = () => supabase.from('ajudas_custo').delete().eq('link_id', linkId).eq('status', 'Pendente')
  const erros = [
    fim ? (await base().gt('inicio', fim)).error : null,          // semana começa depois do último dia
    inicio ? (await base().lt('fim', inicio)).error : null,       // semana acabou antes do início
  ].filter(e => e && !/link_id/.test(e.message))
  if (erros.length) throw new Error(erros[0]!.message)
}

type Vinculo = { employee_id: string; client_id: string; start_date: string | null; contract_end_date: string | null }
/**
 * Último dia em que a pessoa tem vínculo no cliente: null = sem fim (segue),
 * '' = nenhum vínculo. Mesma regra do banco (092, ultimo_dia_do_vinculo).
 */
function ultimoDia(vinculos: Vinculo[], emp: string | null, cli: string | null): string | null {
  const dela = vinculos.filter(v => v.employee_id === emp && v.client_id === cli)
  if (!dela.length) return ''
  if (dela.some(v => !v.contract_end_date)) return null
  return dela.map(v => v.contract_end_date!).sort().pop()!
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
        supabase.from('employees').select('id, full_name, status, dismissal_date, pix').order('full_name'),
        supabase.from('clients').select('id, name').order('name'),
        supabase.from('employee_client_links').select('employee_id, client_id, start_date, contract_end_date'),
      ])
      if (a.error) throw new Error(a.error.message)
      return {
        ajudas: (a.data || []).map(x => ({ ...x, valor: Number(x.valor) })) as Ajuda[],
        pessoas: (e.data || []).filter(x => x.status === 'Ativo').map(x => ({ id: x.id, nome: x.full_name })) as Nome[],
        todasPessoas: new Map((e.data || []).map(x => [x.id, x.full_name as string])),
        pixDe: new Map((e.data || []).map(x => [x.id as string, ((x as { pix?: string | null }).pix || '') as string])),
        clientes: (c.data || []).map(x => ({ id: x.id, nome: x.name })) as Nome[],
        vinculos: (l.data || []) as Vinculo[],
        saidas: new Map((e.data || []).filter(x => x.status === 'Inativo').map(x => [x.id as string, (x as { dismissal_date?: string | null }).dismissal_date || null])),
      }
    },
  })
  const [form, setForm] = useState<Partial<Ajuda> | null>(null)
  const [filtroCliente, setFiltroCliente] = useState('')
  // Tabela (planilha editável) é o padrão; a lista continua para quem preferir
  const [modo, setModoEstado] = useState<'tabela' | 'lista'>(() => { try { return localStorage.getItem('ajuda-modo') === 'lista' ? 'lista' : 'tabela' } catch { return 'tabela' } })
  const setModo = (m: 'tabela' | 'lista') => { setModoEstado(m); try { localStorage.setItem('ajuda-modo', m) } catch { /* sem armazenamento */ } }
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

  // Planilha (pedido de 19/10/2026): escolhe o mês inteiro ou uma semana; sai
  // apresentável (Para pagar por pessoa com PIX e total, Lançamentos e uma aba
  // por cliente). Só o .xlsx — o zip com pasta não subia. Os comprovantes saem
  // à parte num PDF único (um por página, por nome); o "Anexo N" da planilha é
  // a página no PDF. Reembolso que entrou sozinho usa a nota do portal.
  const [baixando, setBaixando] = useState<string | null>(null)
  const [painelPlanilha, setPainelPlanilha] = useState(false)
  const [escolhaPlanilha, setEscolhaPlanilha] = useState('mes')   // 'mes' ou o início da semana
  const prepararPlanilha = async () => {
    const { filtrarPeriodo } = await import('../../lib/planilhaAjudaCusto')
    const { numerarAnexos } = await import('../../lib/comprovantesPdf')
    const sem = semanas.find(s => s.de === escolhaPlanilha)
    const escolha = sem ? { tipo: 'semana' as const, de: sem.de, ate: sem.ate } : { tipo: 'mes' as const }
    const itens = filtrarPeriodo(lista, escolha) as Ajuda[]
    if (!itens.length) { toast.error('Nada lançado nesse período.'); return null }
    const nomeMes = format(parseISO(ini), "MMMM 'de' yyyy", { locale: ptBR })
    const tituloPeriodo = sem ? `semana de ${curto(sem.de)} a ${curto(sem.ate)}` : nomeMes
    const arquivo = `${sem ? `semana_${sem.de.slice(8, 10)}-${sem.de.slice(5, 7)}` : mes}${filtroCliente ? `_${(nomeCli.get(filtroCliente) || '').replace(/[^\w]+/g, '_').slice(0, 30)}` : ''}`
    const base = {
      tituloPeriodo: filtroCliente ? `${tituloPeriodo} · ${nomeCli.get(filtroCliente) || ''}` : tituloPeriodo, ajudas: itens,
      nome: (id: string | null) => data?.todasPessoas.get(id || '') || '',
      pix: (id: string | null) => data?.pixDe.get(id || '') || '',
      cliente: (id: string | null) => nomeCli.get(id || '') || '',
    }
    const idsReemb = itens.map(a => a.expense_id).filter(Boolean) as string[]
    const notas = new Map<string, string>()
    if (idsReemb.length) {
      const { data: ex } = await supabase.from('employee_expenses').select('id, receipt_url').in('id', idsReemb)
      for (const e of ex || []) if (e.receipt_url) notas.set(e.id as string, e.receipt_url as string)
    }
    const caminho = (a: Ajuda) => a.comprovante_url || (a.expense_id ? notas.get(a.expense_id) : null) || null
    // Ordem do PDF: por nome e data. A ajuda do contrato sem comprovante não entra (não tem o que mostrar)
    const ordemPdf = itens.filter(a => caminho(a) || !a.link_id)
      .sort((x, y) => base.nome(x.employee_id).localeCompare(base.nome(y.employee_id), 'pt-BR') || x.inicio.localeCompare(y.inicio))
    const anexos = numerarAnexos(ordemPdf.map(a => ({ caminho: caminho(a) })))
    const anexoDe = new Map(ordemPdf.map((a, i) => [a.id, anexos[i]]))
    return { base, arquivo, caminho, ordemPdf, anexoDe }
  }
  const baixarPlanilha = async () => {
    setBaixando('Gerando…')
    try {
      const p = await prepararPlanilha()
      if (!p) return
      const { abasAjudaCusto } = await import('../../lib/planilhaAjudaCusto')
      const { baixarExcelBonito } = await import('../../lib/excelBonito')
      await baixarExcelBonito(`ajuda_de_custo_${p.arquivo}`, abasAjudaCusto({ ...p.base, comprovante: a => {
        const n = p.anexoDe.get(a.id)
        return n ? `Anexo ${n}` : 'Sem comprovante'
      } }))
      toast.success('Planilha baixada')
    } catch (e) { toast.error('Não gerou a planilha: ' + (e as Error).message) }
    finally { setBaixando(null) }
  }
  const baixarComprovantes = async () => {
    setBaixando('Gerando PDF…')
    try {
      const p = await prepararPlanilha()
      if (!p) return
      const n = p.ordemPdf.filter(a => p.caminho(a)).length
      if (!n) { toast.error('Nenhum comprovante anexado nesse período.'); return }
      const { tipoTexto, periodoTexto } = await import('../../lib/planilhaAjudaCusto')
      const { gerarPdfComprovantes, baixarBlob } = await import('../../lib/comprovantesPdf')
      const blob = await gerarPdfComprovantes({
        titulo: 'Comprovantes da ajuda de custo', periodo: p.base.tituloPeriodo,
        itens: p.ordemPdf.map(a => ({
          pessoa: p.base.nome(a.employee_id) || 'Sem colaborador', descricao: [tipoTexto(a), a.descricao].filter(Boolean).join(' · '),
          valor: a.valor, data: a.inicio, caminho: p.caminho(a), extra: [periodoTexto(a), p.base.cliente(a.client_id)].filter(Boolean).join(' · '),
        })),
        aoProgredir: t => setBaixando(`Baixando ${t}…`),
      })
      baixarBlob(blob, `comprovantes_ajuda_de_custo_${p.arquivo}.pdf`)
      toast.success(`PDF com ${n} comprovante(s) baixado`)
    } catch (e) { toast.error('Não gerou os comprovantes: ' + (e as Error).message) }
    finally { setBaixando(null) }
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
        <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70">
          {([['tabela', 'Tabela', Table2], ['lista', 'Lista', List]] as const).map(([k, t, I]) => (
            <button key={k} type="button" onClick={() => setModo(k)} className={`h-8 px-2.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${modo === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}><I size={14} />{t}</button>
          ))}
        </div>
        <button className={`btn-secondary text-sm ${painelPlanilha ? 'ring-2 ring-primary-200' : ''}`} disabled={!lista.length} onClick={() => setPainelPlanilha(v => !v)}><Download size={15} />Planilha</button>
        <button className="btn-primary text-sm" onClick={() => setForm({ periodo: 'semana', inicio: segunda(hojeISO() < ini || hojeISO() > fimMes ? ini : hojeISO()), tipo: 'Hospedagem', status: 'Pendente' })}><Plus size={15} />Lançar</button>
      </div>

      {/* Escolha da planilha: mês inteiro ou uma semana */}
      {painelPlanilha && (
        <div className="card p-4 space-y-3 border-primary-200">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-900">Baixar planilha da ajuda de custo</p>
            <button className="p-1 text-ink-400 hover:text-ink-700" onClick={() => setPainelPlanilha(false)} title="Fechar"><X size={16} /></button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[{ k: 'mes', t: 'Mês inteiro', s: format(parseISO(ini), 'MMMM', { locale: ptBR }) },
              ...semanas.map((s, i) => ({ k: s.de, t: `Semana ${i + 1}`, s: `${curto(s.de)} a ${curto(s.ate)}` }))].map(o => {
              const qtd = o.k === 'mes' ? lista.filter(a => a.valor > 0 || a.status === 'Pago').length
                : lista.filter(a => a.periodo === 'semana' && a.inicio === o.k && (a.valor > 0 || a.status === 'Pago')).length
              return (
                <button key={o.k} type="button" onClick={() => setEscolhaPlanilha(o.k)} disabled={!qtd}
                  className={`px-3 py-2 rounded-xl border text-left min-w-[7.5rem] disabled:opacity-40 ${escolhaPlanilha === o.k ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-200' : 'border-ink-200 hover:border-ink-300'}`}>
                  <p className="text-sm font-medium text-ink-900">{o.t}</p>
                  <p className="text-[11px] text-ink-500">{o.s} · {qtd} lanç.</p>
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-ink-500">
            A planilha sai sozinha (.xlsx): <b>Para pagar</b> (uma linha por pessoa, com PIX, ajuda do contrato, reembolsos, outros custos e total), <b>Lançamentos</b> e uma aba por cliente.
            Os comprovantes saem à parte num PDF, um por página — o "Anexo" da planilha é o número no PDF.
            {filtroCliente ? <> Só o cliente filtrado: <b>{nomeCli.get(filtroCliente)}</b>.</> : null}
          </p>
          <div className="flex justify-end gap-2 flex-wrap">
            <button className="btn-secondary text-sm" disabled={!!baixando} onClick={baixarComprovantes}><Paperclip size={15} />Comprovantes (PDF)</button>
            <button className="btn-primary text-sm" disabled={!!baixando} onClick={baixarPlanilha}><Download size={15} />{baixando || 'Baixar planilha'}</button>
          </div>
        </div>
      )}

      {modo === 'tabela' && porCliente.length > 0 ? (
        <TabelaSemanas lista={lista} semanas={semanas} pessoas={data.todasPessoas} nomeCli={nomeCli} vinculos={data.vinculos} saidas={data.saidas}
          abrir={a => setForm(a)} mudou={() => qc.invalidateQueries({ queryKey: ['ajudas-custo'] })} />
      ) : !porCliente.length ? (
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
                      const T = TIPOS_AJUDA.find(t => t.nome === a.tipo) || TIPOS_AJUDA.find(t => t.nome === 'Outro')!
                      return (
                        <button key={a.id} onClick={() => setForm(a)} className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-ink-50/60">
                          <span className="w-8 h-8 rounded-lg bg-ink-100 text-ink-600 flex items-center justify-center shrink-0"><T.Icone size={15} /></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink-900 truncate">{data.todasPessoas.get(a.employee_id || '') || '—'}</p>
                            <p className="text-xs text-ink-500 truncate">{a.link_id ? 'Contrato · paga na segunda' : <>{a.tipo}{a.descricao ? ` · ${a.descricao}` : ''}</>}</p>
                            {a.observacao && <p className="text-[11px] text-primary-800 truncate">Obs.: {a.observacao}</p>}
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
  inicial: Partial<Ajuda>; pessoas: Nome[]; clientes: Nome[]; vinculos: Vinculo[]
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
  // Só cliente com vínculo valendo (o banco recusa o resto, 092)
  const daPessoa = new Set(vinculos.filter(v => v.employee_id === f.employee_id && (!v.contract_end_date || v.contract_end_date >= hojeISO())).map(v => v.client_id))
  const clientesOrdem = [...clientes.filter(c => daPessoa.has(c.id)), ...clientes.filter(c => !daPessoa.has(c.id))]
  const valor = Number(valorTxt.replace(/\./g, '').replace(',', '.'))
  const periodoDe = f.periodo === 'mes' ? `${(f.inicio || fimMes).slice(0, 7)}-01` : segunda(f.inicio || hojeISO())
  const periodoAte = f.periodo === 'mes' ? iso(endOfMonth(parseISO(periodoDe))) : iso(addDays(parseISO(periodoDe), 6))
  const doContrato = !!f.link_id   // semana criada pelo contrato semanal (085)
  const doReembolso = !!f.expense_id   // reembolso aprovado que entrou sozinho (090)
  const falta = !f.employee_id ? 'Escolha o colaborador.' : !f.client_id ? 'Escolha o cliente.' : !(valor > 0 || ((doContrato || doReembolso) && valor === 0)) ? 'Informe o valor.' : ''
  const verNota = async () => {
    const { data: e } = await supabase.from('employee_expenses').select('receipt_url').eq('id', f.expense_id!).maybeSingle()
    if (!e?.receipt_url) { toast('Ela não anexou nota neste pedido.'); return }
    const u = await getSignedUrl(e.receipt_url, 'arquivos'); if (u) window.open(u, '_blank')
  }

  const salvar = async () => {
    if (falta) { toast.error(falta); return }
    setSalvando(true)
    const base: Record<string, unknown> = { employee_id: f.employee_id, client_id: f.client_id, periodo: f.periodo, tipo: f.tipo || 'Outro', descricao: f.descricao?.trim() || null, valor }
    // Observação (095): só manda se mexeu, para não travar quem ainda não rodou a migração
    if ((f.observacao || '') !== (inicial.observacao || '')) base.observacao = f.observacao?.trim() || null
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
    if (error && /observacao/.test(error.message)) { toast.error('Para salvar observação, rode a migração 095 no Supabase.'); return }
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
          {f.employee_id && f.client_id && daPessoa.size > 0 && !daPessoa.has(f.client_id)
            ? <p className="text-[11px] text-amber-700 mt-1">A pessoa não tem vínculo com este cliente. Confira: os clientes dela têm ★.</p>
            : f.employee_id && daPessoa.size > 0 && <p className="text-[11px] text-ink-400 mt-1">★ clientes em que a pessoa tem vínculo</p>}</div>

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

        {doReembolso ? (
          <div className="rounded-xl bg-primary-50 border border-primary-100 px-3 py-2.5 text-sm text-primary-900">
            <p className="font-medium">Reembolso aprovado · semana de {formatDate(f.inicio!)} a {formatDate(f.fim!)}</p>
            <p className="text-xs mt-0.5 text-primary-800">Entrou sozinho quando o pedido foi aprovado e não soma no salário. Para não pagar, deixe o valor em 0.</p>
            <button type="button" className="text-xs font-medium text-primary-700 underline mt-1" onClick={verNota}>Ver nota do pedido</button>
          </div>
        ) : doContrato ? (
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
        <div><label className="label">Observação <span className="font-normal text-ink-400">— sai na planilha</span></label>
          <input className="input" value={f.observacao || ''} onChange={e => muda({ observacao: e.target.value })} placeholder="Ex.: pago metade porque começou na quarta" /></div>
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
          {editando && !doContrato && !doReembolso && <button className="btn-ghost text-red-600 text-sm mr-auto" onClick={excluir}><Trash2 size={15} />Excluir</button>}
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={salvando || !!falta} onClick={salvar}>{salvando ? 'Salvando…' : editando ? 'Salvar' : 'Lançar'}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * Tabela da ajuda de custo (pedido de 13/10/2026: "como se fosse um Excel e eu
 * pudesse editar"). Uma linha por pessoa e cliente, uma coluna por semana. O
 * valor muda na própria célula — ex.: 1ª semana proporcional porque ela começou
 * na terça. Semana editada aqui não volta ao valor do contrato sozinha.
 */
function TabelaSemanas({ lista, semanas, pessoas, nomeCli, vinculos, saidas, abrir, mudou }: {
  lista: Ajuda[]; semanas: { de: string; ate: string }[]; pessoas: Map<string, string>; nomeCli: Map<string, string>
  vinculos: Vinculo[]; saidas: Map<string, string | null>
  abrir: (a: Partial<Ajuda>) => void; mudou: () => void
}) {
  type Linha = { chave: string; employee_id: string | null; client_id: string | null; link_id: string | null; rotulo: string; porSemana: Map<string, Ajuda> }
  const linhas = useMemo(() => {
    const m = new Map<string, Linha>()
    for (const a of lista.filter(x => x.periodo === 'semana')) {
      const extra = a.link_id ? 'contrato' : `${a.tipo}|${a.descricao || ''}`
      let chave = `${a.client_id}|${a.employee_id}|${a.link_id || extra}`
      // Dois lançamentos iguais na mesma semana (ex.: dois "Uber") viram linhas separadas
      for (let n = 2; m.get(chave)?.porSemana.has(segunda(a.inicio)); n++) chave = `${chave.replace(/#\d+$/, '')}#${n}`
      if (!m.has(chave)) m.set(chave, { chave, employee_id: a.employee_id, client_id: a.client_id, link_id: a.link_id || null,
        rotulo: a.link_id ? 'Contrato' : `${a.tipo}${a.descricao ? ' · ' + a.descricao : ''}`, porSemana: new Map() })
      m.get(chave)!.porSemana.set(segunda(a.inicio), a)
    }
    const nome = (l: Linha) => `${nomeCli.get(l.client_id || '') || ''}|${pessoas.get(l.employee_id || '') || ''}`
    return [...m.values()].sort((x, y) => nome(x).localeCompare(nome(y)))
  }, [lista, pessoas, nomeCli])
  const custosMes = lista.filter(a => a.periodo === 'mes')
  // Até quando a pessoa vale neste cliente: fim do vínculo ou desligamento, o que vier antes.
  // Semana que começa depois disso não aceita valor (o banco também recusa, 092).
  const fimDaLinha = (l: Linha): { dia: string | null; motivo: string } => {
    const fimV = ultimoDia(vinculos, l.employee_id, l.client_id)
    const saiu = l.employee_id && saidas.has(l.employee_id) ? (saidas.get(l.employee_id) || hojeISO()) : null
    if (fimV === '') return { dia: '', motivo: 'sem vínculo neste cliente' }
    if (saiu && (!fimV || saiu < fimV)) return { dia: saiu, motivo: `desligamento em ${curto(saiu)}` }
    return fimV ? { dia: fimV, motivo: `vínculo encerrado em ${curto(fimV)}` } : { dia: null, motivo: '' }
  }

  const salvarValor = async (a: Ajuda, valor: number) => {
    const { error } = await supabase.from('ajudas_custo').update({ valor }).eq('id', a.id)
    if (error) { toast.error('Não salvou: ' + error.message); return }
    mudou()
  }
  // Semana do contrato sem linha (ex.: antes do início): digitar cria
  const criar = async (l: Linha, sem: { de: string; ate: string }, valor: number) => {
    const { error } = await supabase.from('ajudas_custo').insert({ employee_id: l.employee_id, client_id: l.client_id, link_id: l.link_id, periodo: 'semana',
      inicio: sem.de, fim: sem.ate, tipo: 'Outro', descricao: 'Ajuda de custo do contrato', valor, status: 'Pendente' })
    if (error) { toast.error('Não salvou: ' + error.message); return }
    mudou()
  }
  const pagar = async (ids: string[], total: number, quando: string) => {
    if (!ids.length) return
    if (ids.length > 1 && !(await confirmar({ titulo: `Marcar ${ids.length} como pagos?`, texto: `${formatCurrency(total)} da semana de ${quando}.`, confirmar: 'Marcar pago' }))) return
    const { error } = await supabase.from('ajudas_custo').update({ status: 'Pago', pago_em: hojeISO() }).in('id', ids)
    if (error) { toast.error(error.message); return }
    toast.success(ids.length > 1 ? 'Semana marcada como paga' : 'Marcado como pago'); mudou()
  }
  const somaLinha = (l: Linha) => [...l.porSemana.values()].reduce((t, a) => t + a.valor, 0)

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-ink-50 text-[11px] text-ink-500">
                <th className="text-left font-medium px-3 py-2 sticky left-0 bg-ink-50 min-w-[11rem]">Pessoa · cliente</th>
                {semanas.map((sem, i) => {
                  const pend = linhas.map(l => l.porSemana.get(sem.de)).filter((a): a is Ajuda => !!a && a.status !== 'Pago' && a.valor > 0)
                  return (
                    <th key={sem.de} className="font-medium px-2 py-2 text-right min-w-[8rem] align-top">
                      <div className="text-ink-700">Semana {i + 1}</div>
                      <div>{curto(sem.de)} a {curto(sem.ate)}</div>
                      {pend.length > 0 && (
                        <button className="mt-1 text-[11px] font-semibold text-primary-700 hover:underline"
                          onClick={() => pagar(pend.map(a => a.id), pend.reduce((t, a) => t + a.valor, 0), curto(sem.de))}>Pagar semana</button>
                      )}
                    </th>
                  )
                })}
                <th className="font-medium px-3 py-2 text-right align-top">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {linhas.map(l => {
                const fim = fimDaLinha(l)
                // Já saiu (contrato que ainda vai acabar não é "desvinculada")
                const encerrada = fim.dia === '' || (!!fim.dia && fim.dia < hojeISO())
                return (
                <tr key={l.chave} className={encerrada ? 'bg-ink-50/60' : ''}>
                  <td className={`px-3 py-1.5 sticky left-0 ${encerrada ? 'bg-ink-50' : 'bg-white'}`}>
                    <p className={`font-medium truncate max-w-[14rem] ${encerrada ? 'text-ink-500' : 'text-ink-900'}`}>{pessoas.get(l.employee_id || '') || '—'}</p>
                    <p className="text-[11px] text-ink-500 truncate max-w-[14rem]">{nomeCli.get(l.client_id || '') || 'Sem cliente'} · {l.rotulo}</p>
                    {encerrada && <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500 mt-0.5">{fim.motivo} · só histórico</p>}
                  </td>
                  {semanas.map(sem => {
                    const a = l.porSemana.get(sem.de)
                    // Semana que começa depois do último dia: não é dela
                    const fora = fim.dia !== null && sem.de > fim.dia
                    const pagoFora = fora && a?.status === 'Pago'
                    return (
                      <td key={sem.de} className={`px-1.5 py-1 text-right ${pagoFora ? 'bg-red-50' : a?.status === 'Pago' ? 'bg-green-50' : ''} ${a?.observacao ? 'border-r-2 border-r-primary-300' : ''}`}
                        title={pagoFora ? `Pago por semana depois do fim (${fim.motivo}) — confira` : a?.observacao ? `Obs.: ${a.observacao}` : undefined}>
                        {a?.status === 'Pago' ? (
                          <button className="w-full text-right tnum text-green-800 font-medium px-1.5 py-1 rounded hover:bg-green-100"
                            title={`Pago${a.pago_em ? ' em ' + formatDate(a.pago_em) : ''} — toque para desfazer ou anexar comprovante`} onClick={() => abrir(a)}>
                            <Check size={12} className="inline -mt-0.5 mr-0.5" />{formatCurrency(a.valor)}
                          </button>
                        ) : a ? (
                          <div className="flex items-center gap-1 justify-end">
                            <CelulaValor valor={a.valor} salvar={v => salvarValor(a, v)} />
                            <button className={`p-1 rounded ${a.valor > 0 ? 'text-ink-400 hover:text-green-700 hover:bg-green-50' : 'invisible'}`}
                              title="Marcar pago" onClick={() => pagar([a.id], a.valor, curto(sem.de))}><Check size={14} /></button>
                          </div>
                        ) : l.link_id && !fora ? (
                          <div className="flex items-center gap-1 justify-end">
                            <CelulaValor valor={null} salvar={v => criar(l, sem, v)} />
                            <span className="p-1 invisible"><Check size={14} /></span>
                          </div>
                        ) : <span className="text-ink-300 px-2">—</span>}
                      </td>
                    )
                  })}
                  <td className="px-3 py-1.5 text-right font-semibold tnum text-ink-900">{formatCurrency(somaLinha(l))}</td>
                </tr>
              ) })}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 font-semibold text-ink-800">
                <td className="px-3 py-2 sticky left-0 bg-ink-50">Total</td>
                {semanas.map(sem => (
                  <td key={sem.de} className="px-3 py-2 text-right tnum">{formatCurrency(linhas.reduce((t, l) => t + (l.porSemana.get(sem.de)?.valor || 0), 0))}</td>
                ))}
                <td className="px-3 py-2 text-right tnum">{formatCurrency(linhas.reduce((t, l) => t + somaLinha(l), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="px-3 py-2 text-[11px] text-ink-500 border-t border-ink-100">
          Digite o valor e saia da célula (ou Enter) para salvar — ex.: semana proporcional. 0 = não paga essa semana. Verde = pago; toque para desfazer ou pôr observação. Traço verde à direita = tem observação (passe o mouse para ler). Cinza = vínculo encerrado (fica só o histórico; o que estava a pagar depois do último dia sai sozinho).
        </p>
      </div>
      {custosMes.length > 0 && (
        <div className="card overflow-hidden">
          <p className="px-4 py-2 bg-ink-50 border-b border-ink-100 text-xs font-semibold text-ink-700">Custos do mês</p>
          <div className="divide-y divide-ink-100">
            {custosMes.map(a => (
              <button key={a.id} onClick={() => abrir(a)} className="w-full px-4 py-2 flex items-center gap-3 text-left hover:bg-ink-50/60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{pessoas.get(a.employee_id || '') || '—'}</p>
                  <p className="text-xs text-ink-500 truncate">{nomeCli.get(a.client_id || '') || 'Sem cliente'} · {a.tipo}{a.descricao ? ` · ${a.descricao}` : ''}</p>
                </div>
                <p className="text-sm font-semibold tnum">{formatCurrency(a.valor)}</p>
                <p className={`text-[11px] font-medium w-14 text-right ${a.status === 'Pago' ? 'text-green-700' : 'text-amber-700'}`}>{a.status === 'Pago' ? 'Pago' : 'A pagar'}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Célula editável: salva ao sair (ou Enter); Esc desfaz */
function CelulaValor({ valor, salvar }: { valor: number | null; salvar: (v: number) => void }) {
  const fmt = (v: number | null) => v == null ? '' : v.toFixed(2).replace('.', ',')
  const [txt, setTxt] = useState(fmt(valor))
  const [foco, setFoco] = useState(false)
  const cancelou = useRef(false)
  const sair = () => {
    setFoco(false)
    if (cancelou.current) { cancelou.current = false; return }
    if (txt.trim() === '') return
    // "1.234,50" (ponto de milhar) ou "675.5" (ponto decimal)
    const v = Number(txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt)
    if (!Number.isFinite(v) || v < 0) { toast.error('Valor inválido'); return }
    if (valor != null && Math.abs(v - valor) < 0.005) return
    salvar(Math.round(v * 100) / 100)
  }
  return (
    <input className={`w-24 h-8 rounded-md border border-ink-200 bg-white px-2 text-right text-sm tnum focus:border-primary-500 focus:outline-none ${valor === 0 ? 'text-ink-400' : 'text-ink-900'}`}
      inputMode="decimal" placeholder="—" value={foco ? txt : fmt(valor)}
      onFocus={e => { setTxt(fmt(valor)); setFoco(true); const el = e.target; requestAnimationFrame(() => el.select()) }}
      onChange={e => setTxt(e.target.value.replace(/[^\d,.]/g, ''))}
      onBlur={sair}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { cancelou.current = true; e.currentTarget.blur() }
      }} />
  )
}
