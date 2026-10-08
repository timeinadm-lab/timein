import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Upload, Download, Search, AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import {
  STATUS_FORNECEDOR, PAGAMENTO_OPCOES, ENCERRADOS, lerPlanilha, numerosDoTopo, totalOrcamento,
  validadePadrao, avisoValidade, exportarPlanilhaGRSA,
} from '../../lib/auditoriasFornecedores'
import type { AuditoriaFornecedor } from '../../lib/auditoriasFornecedores'

/**
 * Auditorias de fornecedores GRSA (migração 087) — pedido de 08/10/2026.
 * A planilha "Status Auditorias Fornecedores GRSA" dentro do sistema: do
 * orçamento à validade da próxima auditoria. Uso interno (o portal não vê).
 * "Baixar Excel" devolve a planilha no mesmo formato, para mandar ao cliente.
 */

type Registro = AuditoriaFornecedor & { id: string }
const semMigracao = (m: string) => /auditorias_fornecedores/.test(m) && /does not exist|schema cache|relation/i.test(m)

const corStatus = (s: string) =>
  s === 'Concluída' ? 'bg-green-50 text-green-700'
    : s === 'Agendada' ? 'bg-blue-50 text-blue-700'
    : ENCERRADOS.includes(s) ? 'bg-ink-100 text-ink-500'
    : 'bg-amber-50 text-amber-700'

export default function FornecedoresGRSA() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const hoje = hojeISO()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'abertas' | 'todas' | string>('abertas')
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
  const faltaMigracao = error && semMigracao((error as Error).message)
  const n = numerosDoTopo(lista)

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista
      .filter(a => filtro === 'todas' ? true : filtro === 'abertas' ? !ENCERRADOS.includes(a.status) && a.status !== 'Concluída' : a.status === filtro)
      .filter(a => !t || [a.codigo, a.fornecedor, a.planta, a.cidade, a.uf, a.cnpj, a.comprador, a.categoria].some(v => (v || '').toLowerCase().includes(t)))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  }, [lista, busca, filtro])

  // Renovações vencidas ou vencendo: aparecem em cima, em destaque
  const avisos = lista.map(a => ({ a, aviso: avisoValidade(a.validade, hoje) })).filter(x => x.aviso && !ENCERRADOS.includes(x.a.status))

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
          if (error) throw new Error(`${r.codigo}: ${error.message}`)
          atualizados++
        } else {
          const { error } = await supabase.from('auditorias_fornecedores').insert(r)
          if (error) throw new Error(`${r.codigo}: ${error.message}`)
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

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <button onClick={() => navigate('/auditorias')} className="eyebrow mb-1 inline-flex items-center gap-1 hover:text-ink-700"><ArrowLeft size={13} />Auditorias</button>
          <h1 className="page-title">Fornecedores GRSA</h1>
          <p className="text-sm text-ink-500 mt-1">Do orçamento à validade da próxima auditoria. Uso interno.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={arquivo} type="file" accept=".xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && importar.mutate(e.target.files[0])} />
          <button className="btn-secondary text-sm" disabled={!!faltaMigracao || importar.isPending} onClick={() => arquivo.current?.click()}>
            <Upload size={15} />{importar.isPending ? 'Importando…' : 'Importar planilha'}
          </button>
          <button className="btn-secondary text-sm" disabled={!lista.length} onClick={() => exportarPlanilhaGRSA(lista, hoje).catch(e => toast.error(String(e?.message || e)))}>
            <Download size={15} />Relatório para o cliente
          </button>
          <button className="btn-primary text-sm" disabled={!!faltaMigracao} onClick={() => setAberto('novo')}><Plus size={15} />Novo fornecedor</button>
        </div>
      </div>

      {faltaMigracao ? (
        <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-800">Para usar este controle, rode a migração 087 no Supabase.</div>
      ) : error ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
      ) : isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {([
              ['Fornecedores', String(n.fornecedores)],
              ['Registros / plantas', String(n.registros)],
              ['Concluídas', String(n.concluidas)],
              ['Plantas agendadas', String(n.agendadas)],
              ['Orçamentos ativos', formatCurrency(n.orcamentosAtivos)],
              ['Pagamento informado', formatCurrency(n.pagamentoInformado)],
            ] as const).map(([t, v]) => (
              <div key={t} className="card px-3 py-2.5">
                <p className="text-[11px] text-ink-500">{t}</p>
                <p className="text-lg font-semibold text-ink-900 tnum">{v}</p>
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
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar fornecedor, cidade, CNPJ, comprador…" />
            </div>
            <select className="input w-auto" value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="abertas">Em andamento</option>
              <option value="todas">Todas</option>
              {STATUS_FORNECEDOR.map(s => <option key={s} value={s}>{s} ({lista.filter(a => a.status === s).length})</option>)}
            </select>
          </div>

          {!lista.length ? (
            <div className="card p-8 text-center text-sm text-ink-500">Nenhum fornecedor ainda. Use <b>Importar planilha</b> para trazer a planilha atual, ou <b>Novo fornecedor</b>.</div>
          ) : !visiveis.length ? (
            <div className="card p-6 text-center text-sm text-ink-500">Nada nesse filtro.</div>
          ) : (
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {visiveis.map(a => (
                <button key={a.id} onClick={() => setAberto(a)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/70">
                  <span className="w-20 shrink-0 text-xs font-medium text-ink-500 tnum">{a.codigo}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-900 truncate">{a.fornecedor}{a.planta ? <span className="font-normal text-ink-500"> · {a.planta}</span> : null}</p>
                    <p className="text-xs text-ink-500 truncate">{[[a.cidade, a.uf].filter(Boolean).join('/'), a.tipo, a.proxima_acao].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <p className="text-xs text-ink-700 tnum">{formatCurrency(totalOrcamento(a))}</p>
                    <p className="text-[11px] text-ink-400">{a.agendada_para && a.status === 'Agendada' ? `dia ${formatDate(a.agendada_para)}` : a.nota != null ? `nota ${a.nota}` : ''}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 max-w-[9rem] truncate ${corStatus(a.status)}`}>{a.status}</span>
                  <ChevronRight size={16} className="text-ink-300 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {aberto && <FichaFornecedor registro={aberto === 'novo' ? null : aberto} lista={lista} fechar={() => setAberto(null)} />}
    </div>
  )
}

// ── Ficha: os 6 blocos da planilha ─────────────────────────────────────────

type Tipo = 'texto' | 'data' | 'moeda' | 'numero' | 'simnao' | { opcoes: readonly string[] }
type Def = [keyof AuditoriaFornecedor, string, Tipo?]
const BLOCOS: { titulo: string; campos: Def[] }[] = [
  { titulo: 'Situação', campos: [['status', 'Status atual', { opcoes: STATUS_FORNECEDOR }], ['proxima_acao', 'Próxima ação']] },
  { titulo: 'Fornecedor', campos: [
    ['fornecedor', 'Fornecedor / razão social *'], ['planta', 'Planta'], ['cnpj', 'CNPJ'], ['categoria', 'Categoria'], ['produtos', 'Produtos / escopo'],
    ['cidade', 'Cidade'], ['uf', 'UF'], ['endereco', 'Endereço'], ['contato', 'Contato'], ['email', 'E-mail'], ['telefone', 'Telefone'],
  ] },
  { titulo: 'Cliente GRSA', campos: [
    ['comprador', 'Comprador GRSA'], ['unidade_grsa', 'Unidade GRSA'], ['cr', 'CR'],
    ['responsavel_pagamento', 'Responsável pelo pagamento', { opcoes: ['Unidade GRSA', 'Fornecedor'] }],
  ] },
  { titulo: 'Orçamento', campos: [
    ['valor_auditoria', 'Valor auditoria (R$)', 'moeda'], ['deslocamento', 'Deslocamento (R$)', 'moeda'], ['cidade_polo', 'Cidade polo'],
    ['orcamento_enviado_em', 'Orçamento enviado em', 'data'], ['aprovado_em', 'Aprovação / autorização em', 'data'],
  ] },
  { titulo: 'Pagamento', campos: [
    ['pagamento', 'Pagamento', { opcoes: PAGAMENTO_OPCOES }], ['pago_em', 'Pago em', 'data'],
    ['comprovante_enviado', 'Comprovante enviado', 'simnao'], ['comprovante_recebido_em', 'Comprovante recebido em', 'data'],
  ] },
  { titulo: 'Agenda', campos: [
    ['tipo', 'Tipo de auditoria', { opcoes: ['Inicial', 'Renovação'] }], ['agendada_para', 'Agendada para', 'data'], ['horario', 'Horário'],
  ] },
  { titulo: 'Resultado', campos: [
    ['realizada_em', 'Realizada em', 'data'], ['auditor', 'Auditor'], ['nota', 'Nota (0–100)', 'numero'],
    ['resultado', 'Resultado', { opcoes: ['Aprovado', 'Aprovado com ressalvas', 'Reprovado'] }], ['validade', 'Validade da nova auditoria', 'data'],
  ] },
]

const VAZIO: Omit<AuditoriaFornecedor, 'codigo'> = {
  fornecedor: '', planta: null, status: 'Aguardando aprovação', proxima_acao: null, cnpj: null, categoria: null, produtos: null, tipo: null,
  cidade: null, uf: null, endereco: null, contato: null, email: null, telefone: null, comprador: null, unidade_grsa: null, cr: null,
  responsavel_pagamento: null, valor_auditoria: null, deslocamento: null, cidade_polo: null, orcamento_enviado_em: null, aprovado_em: null,
  pagamento: 'Não confirmado', pago_em: null, comprovante_enviado: false, comprovante_recebido_em: null, agendada_para: null, horario: null,
  realizada_em: null, auditor: null, nota: null, resultado: null, validade: null, auditoria_id: null, observacoes: null,
}

function proximoCodigo(lista: AuditoriaFornecedor[]) {
  const max = Math.max(0, ...lista.map(a => Number(a.codigo.match(/(\d+)/)?.[1] || 0)))
  return `GRSA-${String(max + 1).padStart(3, '0')}`
}

type AuditoriaFeita = { id: string; titulo: string; data: string; nota: number | null; auditor_nome: string | null; unidade: string | null; client?: { name?: string } | null }

function FichaFornecedor({ registro, lista, fechar }: { registro: Registro | null; lista: Registro[]; fechar: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<AuditoriaFornecedor>(() => registro ? { ...registro } : { ...VAZIO, codigo: proximoCodigo(lista) })
  const set = <K extends keyof AuditoriaFornecedor>(k: K, v: AuditoriaFornecedor[K]) => setF(x => {
    const novo = { ...x, [k]: v }
    // Realizada mudou: a validade acompanha (3 anos), se não foi digitada à mão
    if (k === 'realizada_em' && (!x.validade || x.validade === validadePadrao(x.realizada_em))) novo.validade = validadePadrao(v as string | null)
    return novo
  })

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

  const codigoRepetido = lista.some(a => a.codigo.trim().toLowerCase() === f.codigo.trim().toLowerCase() && a.id !== registro?.id)
  const falta = !f.codigo.trim() ? 'Informe o ID.' : codigoRepetido ? 'Já existe um fornecedor com esse ID.' : !f.fornecedor.trim() ? 'Informe o fornecedor.' : ''

  const salvar = useMutation({
    mutationFn: async () => {
      if (falta) throw new Error(falta)
      const { id: _id, criado_em: _c, atualizado_em: _a, ...resto } = f as Registro & { criado_em?: string; atualizado_em?: string }
      const linha = Object.fromEntries(Object.entries({ ...resto, codigo: f.codigo.trim(), fornecedor: f.fornecedor.trim() })
        .map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]))
      const { error } = registro
        ? await supabase.from('auditorias_fornecedores').update({ ...linha, atualizado_em: new Date().toISOString() }).eq('id', registro.id)
        : await supabase.from('auditorias_fornecedores').insert(linha)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Salvo'); qc.invalidateQueries({ queryKey: ['auditorias-fornecedores'] }); fechar() },
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

  const campo = ([k, rotulo, tipo = 'texto']: Def) => {
    const v = f[k]
    const largo = ['fornecedor', 'proxima_acao', 'endereco', 'produtos'].includes(k as string)
    let input
    if (typeof tipo === 'object') {
      input = (
        <select className="input" value={(v as string) ?? ''} onChange={e => set(k, (e.target.value || null) as never)}>
          {!['status', 'pagamento'].includes(k as string) && <option value="">Não informado</option>}
          {tipo.opcoes.map(o => <option key={o} value={o}>{o}</option>)}
          {typeof v === 'string' && v && !tipo.opcoes.includes(v) && <option value={v}>{v}</option>}
        </select>
      )
    } else if (tipo === 'simnao') {
      input = (
        <label className="flex items-center gap-2 h-[42px] text-sm text-ink-700">
          <input type="checkbox" checked={!!v} onChange={e => set(k, e.target.checked as never)} />Sim
        </label>
      )
    } else if (tipo === 'data') {
      input = <input className="input" type="date" value={(v as string) ?? ''} onChange={e => set(k, (e.target.value || null) as never)} />
    } else if (tipo === 'moeda' || tipo === 'numero') {
      input = <input className="input tnum" type="number" inputMode="decimal" step="0.01" min="0" value={v == null ? '' : String(v)}
        onChange={e => set(k, (e.target.value === '' ? null : Number(e.target.value)) as never)} placeholder="Não informado" />
    } else {
      input = <input className="input" value={(v as string) ?? ''} onChange={e => set(k, e.target.value as never)} placeholder="Não informado" />
    }
    return <div key={k as string} className={largo ? 'sm:col-span-2' : ''}><label className="label">{rotulo}</label>{input}</div>
  }

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-2xl space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-ink-900 truncate">{registro ? f.fornecedor || 'Fornecedor' : 'Novo fornecedor'}</h3>
            <p className="text-xs text-ink-500">Campo vazio sai como "Não informado" no relatório.</p>
          </div>
          <div className="w-32 shrink-0"><label className="label">ID *</label><input className="input" value={f.codigo} onChange={e => set('codigo', e.target.value)} /></div>
        </div>

        {BLOCOS.map(b => (
          <section key={b.titulo} className="space-y-3">
            <h4 className="section-title border-b border-ink-100 pb-1.5">{b.titulo}
              {b.titulo === 'Orçamento' && <span className="ml-auto text-xs font-normal text-ink-500">Total: <b className="text-ink-900 tnum">{formatCurrency(totalOrcamento(f))}</b></span>}
            </h4>
            {b.titulo === 'Resultado' && (
              <div>
                <label className="label">Auditoria feita no sistema</label>
                <select className="input" value={f.auditoria_id || ''} onChange={e => ligar(e.target.value)}>
                  <option value="">— nenhuma (preencher à mão) —</option>
                  {feitas.map(a => <option key={a.id} value={a.id}>{formatDate(a.data)} · {[a.client?.name, a.unidade, a.titulo].filter(Boolean).join(' · ')}{a.nota != null ? ` · ${Math.round(Number(a.nota))}%` : ''}</option>)}
                </select>
                <p className="text-[11px] text-ink-500 mt-1">Escolhendo, a data, o auditor, a nota e a validade (3 anos) entram sozinhos.</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{b.campos.map(campo)}</div>
          </section>
        ))}

        <section className="space-y-2">
          <h4 className="section-title border-b border-ink-100 pb-1.5">Observações internas</h4>
          <textarea className="input text-sm" rows={2} value={f.observacoes ?? ''} onChange={e => set('observacoes', e.target.value)} placeholder="Não vai para o relatório do cliente" />
        </section>

        {falta && <p className="text-xs text-amber-700">{falta}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:items-center">
          {registro && (confirmarExcluir
            ? <button className="btn-danger text-sm" disabled={excluir.isPending} onClick={() => excluir.mutate()}>Confirmar exclusão</button>
            : <button className="p-2 text-ink-400 hover:text-red-600 self-start" title="Excluir" onClick={() => setConfirmarExcluir(true)}><Trash2 size={16} /></button>)}
          <div className="flex-1" />
          <button className="btn-secondary" onClick={fechar}>Cancelar</button>
          <button className="btn-primary" disabled={salvar.isPending || !!falta} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
