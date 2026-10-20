import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Upload, Download, Search, AlertTriangle, ChevronRight, Trash2, Check, Paperclip, ExternalLink, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { comprimirImagem, extensaoDoArquivo } from '../../lib/imagem'
import { baixarExcelBonito } from '../../lib/excelBonito'
import {
  STATUS_FORNECEDOR, STATUS_INICIAL, PAGAMENTO_OPCOES, FORMAS_PAGAMENTO, QUEM_PAGA, ROTULO_QUEM_PAGA, RESULTADOS, ENCERRADOS,
  lerPlanilha, numerosDoTopo, totalOrcamento, validadePadrao, avisoValidade, faltandoNaFicha, quantoFalta, localDaAuditoria,
  temComprovante, corDoStatus, corDoPagamento, abasRelatorioGR, nomeRelatorioGR,
} from '../../lib/auditoriasFornecedores'
import type { AuditoriaFornecedor, BlocoFicha } from '../../lib/auditoriasFornecedores'
import type { CorLinha } from '../../lib/excelBonito'

/**
 * Auditoria GR (pedido de 20/10/2026, aprovado pela chefe): planilha/relatório
 * das auditorias de fornecedores da GRSA. Cada fornecedor é uma ficha em 6
 * blocos — dá para salvar faltando e completar depois ("faltam X"). O Excel
 * sai em 3 abas (Resumo, Acompanhamento igual ao da GR e Financeiro) para
 * controle e para apresentar ao cliente. Fica em Planilhas e em Auditorias.
 */

type Registro = AuditoriaFornecedor & { id: string }
const semTabela = (m: string) => /auditorias_fornecedores/.test(m) && /does not exist|schema cache|relation/i.test(m)
const semMigracao100 = (m: string) => /aud_forn_|local_auditoria|forma_pagamento|precisa_nota|nota_numero|nota_emitida_em|comprovante_url|obs_financeiro/i.test(m)
const erroAmigavel = (m: string) => semMigracao100(m) ? 'Falta rodar a migração 100 no Supabase (financeiro da Auditoria GR).' : m

const CLASSE_COR: Record<Exclude<CorLinha, null>, string> = {
  verde: 'bg-green-50 text-green-700 border-green-200', azul: 'bg-blue-50 text-blue-700 border-blue-200',
  amarelo: 'bg-amber-50 text-amber-800 border-amber-200', cinza: 'bg-ink-100 text-ink-500 border-ink-200', vermelho: 'bg-red-50 text-red-700 border-red-200',
}
const classe = (c: CorLinha) => CLASSE_COR[c || 'cinza']

type Filtro = 'andamento' | 'aberto' | 'receber' | 'concluidas' | 'todas'
const FILTROS: [Filtro, string][] = [['andamento', 'Em andamento'], ['aberto', 'Faltam dados'], ['receber', 'A receber'], ['concluidas', 'Concluídas'], ['todas', 'Todas']]

export default function AuditoriaGR() {
  const qc = useQueryClient()
  const hoje = hojeISO()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('andamento')
  const [aberto, setAberto] = useState<Registro | 'novo' | null>(null)
  const arquivo = useRef<HTMLInputElement>(null)

  const { data: lista = [], isLoading, error } = useQuery({
    queryKey: ['auditorias-fornecedores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auditorias_fornecedores').select('*').order('codigo')
      if (error) throw new Error(error.message)
      return (data || []) as Registro[]
    },
  })
  const faltaTabela = error && semTabela((error as Error).message)
  const n = numerosDoTopo(lista)
  const encerrada = (a: Registro) => ENCERRADOS.includes(a.status)

  const contagem: Record<Filtro, number> = {
    andamento: lista.filter(a => !encerrada(a) && a.status !== 'Concluída').length,
    aberto: lista.filter(a => quantoFalta(a) > 0).length,
    receber: n.qtdAReceber,
    concluidas: n.concluidas,
    todas: lista.length,
  }
  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista
      .filter(a => filtro === 'todas' ? true
        : filtro === 'andamento' ? !encerrada(a) && a.status !== 'Concluída'
        : filtro === 'aberto' ? quantoFalta(a) > 0
        : filtro === 'receber' ? !encerrada(a) && (a.pagamento === 'Não pago' || a.pagamento === 'Aguardando comprovante')
        : a.status === 'Concluída')
      .filter(a => !t || [a.codigo, a.fornecedor, a.planta, a.cidade, a.uf, a.cnpj, a.comprador, a.categoria, a.unidade_grsa].some(v => (v || '').toLowerCase().includes(t)))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [lista, busca, filtro])

  // Renovações vencidas ou vencendo: aparecem em cima, em destaque
  const avisos = lista.map(a => ({ a, aviso: avisoValidade(a.validade, hoje) })).filter(x => x.aviso && !encerrada(x.a))

  const importar = useMutation({
    mutationFn: async (file: File) => {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) as unknown[][]
      const { registros, erro } = lerPlanilha(linhas)
      if (erro) throw new Error(erro)
      if (!registros.length) throw new Error('A planilha não tem nenhum fornecedor.')
      const existentes = new Map(lista.map(a => [a.codigo, a.id]))
      let novos = 0, atualizados = 0
      for (const r of registros) {
        const id = existentes.get(r.codigo)
        if (id) {
          // Célula vazia na planilha não apaga o que já foi preenchido no sistema
          const campos = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== ''))
          const { error } = await supabase.from('auditorias_fornecedores').update({ ...campos, atualizado_em: new Date().toISOString() }).eq('id', id)
          if (error) throw new Error(`${r.codigo}: ${erroAmigavel(error.message)}`)
          atualizados++
        } else {
          const { error } = await supabase.from('auditorias_fornecedores').insert(r)
          if (error) throw new Error(`${r.codigo}: ${erroAmigavel(error.message)}`)
          novos++
        }
      }
      return { novos, atualizados }
    },
    onSuccess: ({ novos, atualizados }) => {
      toast.success(`${novos} novo(s) · ${atualizados} atualizado(s)`)
      qc.invalidateQueries({ queryKey: ['auditorias-fornecedores'] })
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => { if (arquivo.current) arquivo.current.value = '' },
  })

  const [baixando, setBaixando] = useState(false)
  const baixar = async () => {
    setBaixando(true)
    try { await baixarExcelBonito(nomeRelatorioGR(hoje), abasRelatorioGR(lista, hoje)) }
    catch (e) { toast.error(String((e as Error)?.message || e)) }
    setBaixando(false)
  }

  if (faltaTabela) return <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-800">Para usar a Auditoria GR, rode a migração 087 no Supabase.</div>
  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Auditoria GR</h2>
          <p className="text-xs text-ink-500">Auditorias de fornecedores da GRSA: uma ficha por fornecedor. Pode salvar faltando e completar depois.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={arquivo} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && importar.mutate(e.target.files[0])} />
          <button className="btn-secondary text-sm" disabled={importar.isPending} onClick={() => arquivo.current?.click()} title="Trazer a planilha da GR (atualiza pelo ID)">
            <Upload size={15} />{importar.isPending ? 'Importando…' : 'Importar'}
          </button>
          <button className="btn-secondary text-sm" disabled={!lista.length || baixando} onClick={baixar}>
            <Download size={15} />{baixando ? 'Gerando…' : 'Relatório (Excel)'}
          </button>
          <button className="btn-primary text-sm" onClick={() => setAberto('novo')}><Plus size={15} />Novo</button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {([
              ['Fornecedores', String(n.fornecedores), ''],
              ['Agendadas', String(n.agendadas), ''],
              ['Concluídas', String(n.concluidas), ''],
              ['Total orçado', formatCurrency(n.orcamentosAtivos), ''],
              ['Já recebido', formatCurrency(n.recebido), 'text-green-700'],
              ['A receber', formatCurrency(n.aReceber), n.aReceber ? 'text-amber-700' : ''],
            ] as const).map(([t, v, cor]) => (
              <div key={t} className="card px-3 py-2.5">
                <p className="text-[11px] text-ink-500">{t}</p>
                <p className={`text-lg font-semibold tnum ${cor || 'text-ink-900'}`}>{v}</p>
              </div>
            ))}
          </div>

          {avisos.length > 0 && (
            <div className="card p-3 border-amber-200 bg-amber-50 space-y-1">
              {avisos.map(({ a, aviso }) => (
                <button key={a.id} onClick={() => setAberto(a)} className="w-full flex items-center gap-2 text-left text-sm text-amber-800 hover:underline">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span className="truncate"><b>{a.fornecedor}</b>{a.planta ? ` · ${a.planta}` : ''}: auditoria {aviso!.tipo === 'vencida' ? `vencida há ${-aviso!.dias} dia(s)` : `vence em ${aviso!.dias} dia(s)`} ({formatDate(a.validade)})</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex gap-1 flex-wrap">
              {FILTROS.map(([k, t]) => (
                <button key={k} onClick={() => setFiltro(k)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${filtro === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-ink-600 border-ink-200 hover:border-ink-300'}`}>
                  {t} <span className={filtro === k ? 'text-primary-100' : 'text-ink-400'}>{contagem[k]}</span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar fornecedor, cidade, CNPJ, comprador…" />
            </div>
          </div>

          {!lista.length ? (
            <div className="card p-8 text-center text-sm text-ink-500">Nenhum fornecedor ainda. Toque em <b>Novo</b> para criar a primeira ficha, ou <b>Importar</b> para trazer a planilha da GR.</div>
          ) : !visiveis.length ? (
            <div className="card p-6 text-center text-sm text-ink-500">Nada nesse filtro.</div>
          ) : (
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {visiveis.map(a => {
                const falta = quantoFalta(a)
                return (
                  <button key={a.id} onClick={() => setAberto(a)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/70">
                    <span className="w-20 shrink-0 text-xs font-medium text-ink-500 tnum hidden sm:block">{a.codigo}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink-900 truncate">{a.fornecedor}{a.planta ? <span className="font-normal text-ink-500"> · {a.planta}</span> : null}</p>
                      <p className="text-xs text-ink-500 truncate">
                        <span className="sm:hidden">{a.codigo} · </span>
                        {[localDaAuditoria(a), a.status === 'Agendada' && a.agendada_para ? `dia ${formatDate(a.agendada_para)}` : null, a.proxima_acao].filter(Boolean).join(' · ')}
                      </p>
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${classe(corDoStatus(a.status))}`}>{a.status}</span>
                        {!encerrada(a) && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${classe(corDoPagamento(a.pagamento))}`}>{a.pagamento}</span>}
                        {encerrada(a) ? null : falta
                          ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-dashed border-amber-300 text-amber-700">Em aberto · faltam {falta}</span>
                          : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-green-200 text-green-700 inline-flex items-center gap-0.5"><Check size={10} />Completa</span>}
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-ink-800 tnum shrink-0">{formatCurrency(totalOrcamento(a))}</p>
                    <ChevronRight size={16} className="text-ink-300 shrink-0" />
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {aberto && <FichaFornecedor registro={aberto === 'novo' ? null : aberto} lista={lista} fechar={() => setAberto(null)} />}
    </div>
  )
}

// ── Ficha: 6 blocos, cada um com ✓ quando completo ─────────────────────────

const VAZIO: Omit<AuditoriaFornecedor, 'codigo'> = {
  fornecedor: '', planta: null, status: STATUS_INICIAL, proxima_acao: null, cnpj: null, categoria: null, produtos: null, tipo: null,
  cidade: null, uf: null, endereco: null, contato: null, email: null, telefone: null, comprador: null, unidade_grsa: null, cr: null,
  responsavel_pagamento: null, valor_auditoria: null, deslocamento: null, cidade_polo: null, orcamento_enviado_em: null, aprovado_em: null,
  pagamento: 'Não pago', pago_em: null, comprovante_enviado: false, comprovante_recebido_em: null, agendada_para: null, horario: null,
  realizada_em: null, auditor: null, nota: null, resultado: null, validade: null, auditoria_id: null, observacoes: null,
  local_auditoria: null, forma_pagamento: null, precisa_nota: null, nota_numero: null, nota_emitida_em: null, comprovante_url: null, obs_financeiro: null,
}

function proximoCodigo(lista: AuditoriaFornecedor[]) {
  const max = Math.max(0, ...lista.map(a => Number(a.codigo.match(/(\d+)/)?.[1] || 0)))
  return `GRSA-${String(max + 1).padStart(3, '0')}`
}

type AuditoriaFeita = { id: string; titulo: string; data: string; nota: number | null; auditor_nome: string | null; unidade: string | null; client?: { name?: string } | null }

const TITULO_BLOCO: Record<BlocoFicha, string> = {
  fornecedor: 'Fornecedor', pedido: 'Pedido da GR', orcamento: 'Orçamento', financeiro: 'Financeiro', agenda: 'Agenda', resultado: 'Resultado',
}

function FichaFornecedor({ registro, lista, fechar }: { registro: Registro | null; lista: Registro[]; fechar: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<AuditoriaFornecedor>(() => registro ? { ...VAZIO, ...registro } : { ...VAZIO, codigo: proximoCodigo(lista) })
  const set = <K extends keyof AuditoriaFornecedor>(k: K, v: AuditoriaFornecedor[K]) => setF(x => {
    const novo = { ...x, [k]: v }
    // Realizada mudou: a validade acompanha (3 anos), se não foi digitada à mão
    if (k === 'realizada_em' && (!x.validade || x.validade === validadePadrao(x.realizada_em))) novo.validade = validadePadrao(v as string | null)
    // Marcou pago: a data de hoje entra sozinha (dá para trocar)
    if (k === 'pagamento' && v === 'Pago' && !x.pago_em) novo.pago_em = hojeISO()
    return novo
  })
  const faltando = faltandoNaFicha(f)
  const totalFalta = Object.values(faltando).reduce((s, l) => s + l.length, 0)
  const encerrada = ENCERRADOS.includes(f.status)

  // Auditorias finalizadas na aba Auditorias, para ligar o resultado
  const { data: feitas = [] } = useQuery({
    queryKey: ['auditorias-finalizadas-lista'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auditorias').select('id, titulo, data, nota, auditor_nome, unidade, client:clients(name)')
        .eq('status', 'finalizada').order('data', { ascending: false }).limit(200)
      if (error) throw error
      return (data || []) as unknown as AuditoriaFeita[]
    },
  })
  const ligar = (id: string) => {
    const a = feitas.find(x => x.id === id)
    if (!a) { setF(x => ({ ...x, auditoria_id: null })); return }
    setF(x => ({
      ...x, auditoria_id: a.id, realizada_em: a.data, auditor: a.auditor_nome || x.auditor,
      nota: a.nota != null ? Math.round(Number(a.nota) * 10) / 10 : x.nota,
      validade: validadePadrao(a.data), status: ENCERRADOS.includes(x.status) ? x.status : 'Concluída',
    }))
  }

  // Comprovante: foto ou PDF no bucket "arquivos"
  const [subindo, setSubindo] = useState(false)
  const comprovanteRef = useRef<HTMLInputElement>(null)
  const anexar = async (arq: File | undefined) => {
    if (!arq) return
    setSubindo(true)
    try {
      const file = arq.type.startsWith('image/') ? await comprimirImagem(arq) : arq
      const pasta = (f.codigo || 'sem-id').replace(/[^\w-]/g, '_')
      const caminho = `auditoria-gr/${pasta}/comprovante_${Date.now()}.${extensaoDoArquivo(file)}`
      const { error } = await supabase.storage.from('arquivos').upload(caminho, file, { upsert: false, contentType: file.type || undefined })
      if (error) throw error
      setF(x => ({ ...x, comprovante_url: caminho, comprovante_enviado: true, comprovante_recebido_em: x.comprovante_recebido_em || hojeISO() }))
      toast.success('Comprovante anexado. Não esqueça de salvar.')
    } catch (e) { toast.error('O comprovante não subiu: ' + (e as Error).message) }
    setSubindo(false)
    if (comprovanteRef.current) comprovanteRef.current.value = ''
  }
  const verComprovante = async () => {
    const url = f.comprovante_url ? await getSignedUrl(f.comprovante_url, 'arquivos') : null
    if (url) window.open(url, '_blank'); else toast.error('Não consegui abrir o comprovante.')
  }

  const codigoRepetido = lista.some(a => a.codigo.trim().toLowerCase() === f.codigo.trim().toLowerCase() && a.id !== registro?.id)
  const falta = !f.codigo.trim() ? 'Informe o ID.' : codigoRepetido ? 'Já existe um fornecedor com esse ID.' : !f.fornecedor.trim() ? 'Informe o nome do fornecedor.' : ''

  const salvar = useMutation({
    mutationFn: async () => {
      if (falta) throw new Error(falta)
      const { id: _id, criado_em: _c, atualizado_em: _a, ...resto } = f as Registro & { criado_em?: string; atualizado_em?: string }
      const linha = Object.fromEntries(Object.entries({ ...resto, codigo: f.codigo.trim(), fornecedor: f.fornecedor.trim() })
        .map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]))
      const { error } = registro
        ? await supabase.from('auditorias_fornecedores').update({ ...linha, atualizado_em: new Date().toISOString() }).eq('id', registro.id)
        : await supabase.from('auditorias_fornecedores').insert(linha)
      if (error) throw new Error(erroAmigavel(error.message))
    },
    onSuccess: () => {
      toast.success(totalFalta && !encerrada ? `Salvo · ficha em aberto, faltam ${totalFalta}` : 'Salvo')
      qc.invalidateQueries({ queryKey: ['auditorias-fornecedores'] }); fechar()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const [confirmarExcluir, setConfirmarExcluir] = useState(false)
  const excluir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('auditorias_fornecedores').delete().eq('id', registro!.id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Excluído'); qc.invalidateQueries({ queryKey: ['auditorias-fornecedores'] }); fechar() },
    onError: (e: Error) => toast.error(e.message),
  })

  // Campos
  const texto = (k: keyof AuditoriaFornecedor, rotulo: string, extra?: { largo?: boolean; placeholder?: string }) => (
    <div key={k} className={extra?.largo ? 'sm:col-span-2' : ''}>
      <label className="label">{rotulo}</label>
      <input className="input" value={(f[k] as string) ?? ''} onChange={e => set(k, e.target.value as never)} placeholder={extra?.placeholder || 'Não informado'} />
    </div>
  )
  const data = (k: keyof AuditoriaFornecedor, rotulo: string) => (
    <div key={k}><label className="label">{rotulo}</label>
      <input className="input" type="date" value={(f[k] as string) ?? ''} onChange={e => set(k, (e.target.value || null) as never)} /></div>
  )
  const numero = (k: keyof AuditoriaFornecedor, rotulo: string, moeda = true) => (
    <div key={k}><label className="label">{rotulo}</label>
      <input className="input tnum" type="number" inputMode="decimal" step={moeda ? '0.01' : '0.1'} min="0" max={moeda ? undefined : 100}
        value={f[k] == null ? '' : String(f[k])} onChange={e => set(k, (e.target.value === '' ? null : Number(e.target.value)) as never)} placeholder={moeda ? 'R$ 0,00' : '0 a 100'} /></div>
  )
  const escolha = (k: keyof AuditoriaFornecedor, rotulo: string, opcoes: readonly string[], cfg?: { rotulos?: Record<string, string>; obrigatorio?: boolean; largo?: boolean }) => (
    <div key={k} className={cfg?.largo ? 'sm:col-span-2' : ''}>
      <label className="label">{rotulo}</label>
      <Chips opcoes={opcoes} valor={(f[k] as string) ?? null} rotulos={cfg?.rotulos}
        mudar={v => set(k, (v ?? (cfg?.obrigatorio ? f[k] : null)) as never)} />
    </div>
  )
  const simNao = (k: 'precisa_nota', rotulo: string) => (
    <div key={k}>
      <label className="label">{rotulo}</label>
      <Chips opcoes={['Sim', 'Não']} valor={f[k] === true ? 'Sim' : f[k] === false ? 'Não' : null} mudar={v => set(k, v === 'Sim' ? true : v === 'Não' ? false : null)} />
    </div>
  )

  // Função (não componente): assim os campos não perdem o foco a cada letra
  const bloco = (b: BlocoFicha, n: number, children: React.ReactNode, destaque = false) => {
    const faltam = faltando[b]
    return (
      <section key={b} className={`rounded-xl border p-4 space-y-3 ${destaque ? 'border-amber-300 bg-amber-50/40' : 'border-ink-200'}`}>
        <header className="flex items-center gap-2.5">
          <span className={`w-7 h-7 rounded-lg grid place-items-center text-sm font-bold shrink-0 ${destaque ? 'bg-amber-600 text-white' : 'bg-primary-50 text-primary-700'}`}>{n}</span>
          <h4 className="font-semibold text-ink-900">{TITULO_BLOCO[b]}</h4>
          <span className="ml-auto">
            {encerrada ? null : faltam.length
              ? <span className="text-[11px] text-amber-700" title={faltam.join(', ')}>faltam {faltam.length}: {faltam.slice(0, 3).join(', ')}{faltam.length > 3 ? '…' : ''}</span>
              : <span className="text-[11px] font-medium text-green-700 inline-flex items-center gap-0.5"><Check size={13} />completo</span>}
          </span>
        </header>
        {children}
      </section>
    )
  }

  const local = localDaAuditoria({ ...f, local_auditoria: null })

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-3xl space-y-4 !p-0" onClick={e => e.stopPropagation()}>
        {/* Topo fixo: nome, ID e status */}
        <div className="sticky top-0 z-10 bg-white border-b border-ink-100 px-5 sm:px-6 pt-5 pb-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-ink-900 truncate">{registro ? f.fornecedor || 'Fornecedor' : 'Novo fornecedor'}</h3>
              <p className="text-xs text-ink-500">
                {encerrada ? 'Encerrada: nada mais a preencher.'
                  : totalFalta ? <>Ficha <b className="text-amber-700">em aberto</b>: faltam {totalFalta} campo(s). Pode salvar e completar depois.</>
                  : <span className="text-green-700 font-medium">Ficha completa.</span>}
              </p>
            </div>
            <div className="w-28 shrink-0"><label className="label">ID</label><input className="input" value={f.codigo} onChange={e => set('codigo', e.target.value)} /></div>
            <button onClick={fechar} className="p-1.5 text-ink-400 hover:text-ink-700 -mr-2" aria-label="Fechar"><X size={18} /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Status</label>
              <select className={`input font-medium ${classe(corDoStatus(f.status))}`} value={f.status} onChange={e => set('status', e.target.value)}>
                {STATUS_FORNECEDOR.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {texto('proxima_acao', 'Próxima ação', { placeholder: 'Ex.: cobrar data com o fornecedor' })}
          </div>
        </div>

        <div className="px-5 sm:px-6 space-y-4">
          {bloco('fornecedor', 1, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {texto('fornecedor', 'Razão social *', { largo: true, placeholder: 'Nome do fornecedor' })}
              {texto('planta', 'Planta')}{texto('cnpj', 'CNPJ', { placeholder: '00.000.000/0000-00' })}
              {texto('categoria', 'Categoria')}{texto('produtos', 'Produtos / escopo')}
              {texto('cidade', 'Cidade')}{texto('uf', 'UF', { placeholder: 'SP' })}
              {texto('endereco', 'Endereço', { largo: true })}
              {texto('contato', 'Contato')}{texto('telefone', 'Telefone')}
              {texto('email', 'E-mail', { largo: true })}
            </div>
          </>)}

          {bloco('pedido', 2, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {texto('comprador', 'Comprador GRSA')}{texto('unidade_grsa', 'Unidade GRSA')}
              {texto('cr', 'CR')}{escolha('tipo', 'Tipo de auditoria', ['Inicial', 'Renovação'])}
            </div>
          </>)}

          {bloco('orcamento', 3, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {numero('valor_auditoria', 'Valor da auditoria')}{numero('deslocamento', 'Deslocamento')}
              <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-primary-50 px-3 py-2 text-sm">
                <span className="text-primary-800">Total (automático)</span>
                <b className="text-primary-900 tnum">{formatCurrency(totalOrcamento(f))}</b>
              </div>
              {texto('cidade_polo', 'Cidade polo')}
              <div className="hidden sm:block" />
              {data('orcamento_enviado_em', 'Orçamento enviado em')}{data('aprovado_em', 'Aprovado em')}
            </div>
          </>)}

          {bloco('financeiro', 4, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {texto('local_auditoria', 'Local da auditoria', { placeholder: local || 'Cidade/UF' })}
              <div>
                <label className="label">Valor a receber</label>
                <p className="input bg-white/70 font-semibold tnum flex items-center">{formatCurrency(totalOrcamento(f))}</p>
              </div>
              {escolha('pagamento', 'Situação do pagamento', PAGAMENTO_OPCOES, { obrigatorio: true, largo: true })}
              {f.pagamento !== 'Não se aplica' && <>
                {escolha('responsavel_pagamento', 'Quem paga', QUEM_PAGA, { rotulos: ROTULO_QUEM_PAGA })}
                {f.pagamento === 'Pago' ? data('pago_em', 'Pago em') : <div className="hidden sm:block" />}
                {escolha('forma_pagamento', 'Forma de pagamento', FORMAS_PAGAMENTO, { largo: true })}
                {simNao('precisa_nota', 'Precisa nota fiscal?')}
                <div className="hidden sm:block" />
                {f.precisa_nota && <>{texto('nota_numero', 'Nº da nota')}{data('nota_emitida_em', 'Nota emitida em')}</>}
                <div className="sm:col-span-2">
                  <label className="label">Comprovante</label>
                  <input ref={comprovanteRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => anexar(e.target.files?.[0])} />
                  <div className="flex items-center gap-2 flex-wrap">
                    {f.comprovante_url ? <>
                      <button type="button" className="btn-secondary text-sm" onClick={verComprovante}><ExternalLink size={14} />Ver comprovante</button>
                      <button type="button" className="text-xs text-ink-500 underline" onClick={() => comprovanteRef.current?.click()}>trocar</button>
                      <button type="button" className="text-xs text-red-600 underline" onClick={() => setF(x => ({ ...x, comprovante_url: null }))}>tirar</button>
                    </> : (
                      <button type="button" className="btn-secondary text-sm" disabled={subindo} onClick={() => comprovanteRef.current?.click()}>
                        <Paperclip size={14} />{subindo ? 'Enviando…' : 'Anexar foto ou PDF'}
                      </button>
                    )}
                    {!f.comprovante_url && temComprovante(f) && <span className="text-xs text-ink-500">marcado como enviado (planilha)</span>}
                    {f.comprovante_recebido_em && <span className="text-xs text-ink-500">recebido em {formatDate(f.comprovante_recebido_em)}</span>}
                  </div>
                </div>
              </>}
              <div className="sm:col-span-2">
                <label className="label">Observação financeira</label>
                <textarea className="input text-sm" rows={2} value={f.obs_financeiro ?? ''} onChange={e => set('obs_financeiro', e.target.value)} placeholder="Ex.: Pix na conta da Time IN, CNPJ…" />
              </div>
            </div>
          </>, true)}

          {bloco('agenda', 5, <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data('agendada_para', 'Data agendada')}{texto('horario', 'Horário', { placeholder: '09:00' })}
              {texto('auditor', 'Auditor')}{data('realizada_em', 'Realizada em')}
            </div>
          </>)}

          {bloco('resultado', 6, <>
            <div>
              <label className="label">Auditoria feita no sistema</label>
              <select className="input" value={f.auditoria_id || ''} onChange={e => ligar(e.target.value)}>
                <option value="">— nenhuma (preencher à mão) —</option>
                {feitas.map(a => <option key={a.id} value={a.id}>{formatDate(a.data)} · {[a.client?.name, a.unidade, a.titulo].filter(Boolean).join(' · ')}{a.nota != null ? ` · ${Math.round(Number(a.nota))}%` : ''}</option>)}
              </select>
              <p className="text-[11px] text-ink-500 mt-1">Escolhendo, a data, o auditor, a nota e a validade (3 anos) entram sozinhos.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {numero('nota', 'Nota (0–100)', false)}{data('validade', 'Validade (3 anos, automática)')}
              {escolha('resultado', 'Resultado', RESULTADOS, { largo: true })}
            </div>
          </>)}

          <section className="space-y-1.5">
            <label className="label">Observações internas</label>
            <textarea className="input text-sm" rows={2} value={f.observacoes ?? ''} onChange={e => set('observacoes', e.target.value)} placeholder="Não vai para o relatório" />
          </section>
        </div>

        {/* Rodapé fixo */}
        <div className="sticky bottom-0 bg-white border-t border-ink-100 px-5 sm:px-6 py-3 flex flex-col-reverse sm:flex-row gap-2 sm:items-center">
          {registro && (confirmarExcluir
            ? <button className="btn-danger text-sm" disabled={excluir.isPending} onClick={() => excluir.mutate()}>Confirmar exclusão</button>
            : <button className="p-2 text-ink-400 hover:text-red-600 self-start" title="Excluir" onClick={() => setConfirmarExcluir(true)}><Trash2 size={16} /></button>)}
          {falta && <p className="text-xs text-amber-700">{falta}</p>}
          <div className="flex-1" />
          <button className="btn-secondary" onClick={fechar}>Cancelar</button>
          <button className="btn-primary" disabled={salvar.isPending || !!falta || subindo} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

/** Opções de tocar: toca de novo para desmarcar */
function Chips({ opcoes, valor, mudar, rotulos }: { opcoes: readonly string[]; valor: string | null; mudar: (v: string | null) => void; rotulos?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5 min-h-[42px] items-center">
      {opcoes.map(o => (
        <button key={o} type="button" onClick={() => mudar(valor === o ? null : o)}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${valor === o ? 'bg-primary-600 text-white border-primary-600 font-medium' : 'bg-white text-ink-700 border-ink-200 hover:border-ink-300'}`}>
          {rotulos?.[o] || o}
        </button>
      ))}
    </div>
  )
}
