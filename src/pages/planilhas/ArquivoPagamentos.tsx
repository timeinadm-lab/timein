import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Archive, ChevronLeft, Download, FileDown, Plus, Trash2, ClipboardPaste, FileSpreadsheet, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { baixarExcelBonito } from '../../lib/excelBonito'
import type { CorLinha } from '../../lib/excelBonito'
import {
  DIAS_DE_PAGAMENTO, celulasExportacao, dataNoMes, diaDePagamento, filtrarRegistros, formatarDataPagamento,
  lerGrade, lerTexto, lerValor, resumir, validarEntrada, valorParaTexto,
} from '../../lib/arquivoPagamentos'
import type { DiaPagamento, EntradaArquivo, LeituraArquivo, LinhaLida, RegistroArquivo } from '../../lib/arquivoPagamentos'

/**
 * Histórico de pagamentos fechados (migração 111). Fica em Planilhas.
 * Consulta por mês (o seletor da página) e por dia 8, 15 ou 20.
 * A chefia cria e edita, inclusive colando ou importando as linhas.
 * A chave PIX fica na linha. PDF e Excel saem sem PIX por padrão.
 */
type RascunhoLinha = { chave: string; nome: string; valorTxt: string; observacao: string; pix: string }
type Rascunho = { id?: string; dia: DiaPagamento; observacao: string; linhas: RascunhoLinha[] }

const chave = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
const linhaVazia = (): RascunhoLinha => ({ chave: chave(), nome: '', valorTxt: '', observacao: '', pix: '' })
const aConfirmar = (obs?: string | null) => !!obs && /confirmar/i.test(obs)

function normalizar(row: Record<string, unknown>): RegistroArquivo {
  const brutas = (row.arquivo_pagamento_linhas || []) as Record<string, unknown>[]
  const linhas = brutas.map(l => ({
    id: String(l.id),
    ordem: Number(l.ordem) || 0,
    nome: String(l.nome || ''),
    valor: Number(l.valor) || 0,
    pix: l.pix ? String(l.pix) : null,
    observacao: l.observacao ? String(l.observacao) : null,
  })).sort((a, b) => a.ordem - b.ordem)
  const soma = resumir(linhas)
  return {
    id: String(row.id),
    data_pagamento: String(row.data_pagamento).slice(0, 10),
    observacao: row.observacao ? String(row.observacao) : null,
    total: linhas.length ? soma.total : Number(row.total) || 0,
    quantidade: linhas.length ? soma.quantidade : Number(row.quantidade) || 0,
    linhas,
  }
}

function mensagemErro(m: string): string {
  if (/arquivo_pagamento|schema cache|does not exist|Could not find|PGRST202|PGRST205/i.test(m)) {
    return 'Para usar o histórico, rode a migração 111 no Supabase. A 112 grava o pagamento de 20/11/2026.'
  }
  if (/já existe um registro/i.test(m) || /duplicate key|unique/i.test(m)) return 'Já existe um registro neste dia de pagamento.'
  if (/pix|cpf|bancár/i.test(m)) return m
  return m
}

function rascunhoDe(reg: RegistroArquivo | null, mes: string, dia: DiaPagamento): Rascunho {
  if (!reg) return { dia, observacao: '', linhas: [linhaVazia()] }
  return {
    id: reg.id,
    dia: diaDePagamento(reg.data_pagamento) || dia,
    observacao: reg.observacao || '',
    linhas: reg.linhas.length
      ? reg.linhas.map(l => ({ chave: l.id || chave(), nome: l.nome, valorTxt: valorParaTexto(l.valor), observacao: l.observacao || '', pix: l.pix || '' }))
      : [linhaVazia()],
  }
}

function entradaDoRascunho(r: Rascunho, mes: string): { entrada: EntradaArquivo | null; erro: string | null } {
  const data = dataNoMes(mes, r.dia)
  if (!data) return { entrada: null, erro: 'A data de pagamento precisa ser dia 8, 15 ou 20.' }
  const linhas = r.linhas.map(l => ({
    nome: l.nome.trim(),
    valor: lerValor(l.valorTxt),
    observacao: l.observacao.trim() || null,
    pix: l.pix.trim() || null,
  }))
  if (r.linhas.some(l => l.valorTxt.trim() && lerValor(l.valorTxt) == null)) {
    return { entrada: null, erro: 'Tem valor que não entendi. Use 1500,00.' }
  }
  if (linhas.some(l => l.valor == null && (l.nome || l.observacao || l.pix))) {
    return { entrada: null, erro: 'Tem linha com nome e sem valor.' }
  }
  const preenchidas = linhas.filter(l => l.nome || l.valor != null || l.observacao || l.pix) as EntradaArquivo['linhas']
  const entrada: EntradaArquivo = { id: r.id, data_pagamento: data, observacao: r.observacao.trim() || null, linhas: preenchidas.map(l => ({ ...l, valor: l.valor ?? 0 })) }
  return { entrada, erro: null }
}

export function ArquivoPagamentosVista({ mes, nomeMes, registros, carregando, avisoMigracao, erro, salvando, onSalvar, onExcluir }: {
  mes: string
  nomeMes: string
  registros: RegistroArquivo[]
  carregando: boolean
  avisoMigracao: boolean
  erro: string | null
  salvando: boolean
  onSalvar: (entrada: EntradaArquivo) => Promise<RegistroArquivo>
  onExcluir: (id: string) => Promise<void>
}) {
  const [dia, setDia] = useState<number | null>(null)
  const [aberto, setAberto] = useState<RegistroArquivo | null>(null)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const mesVisto = useRef(mes)

  useEffect(() => {
    if (mesVisto.current === mes) return
    mesVisto.current = mes
    setAberto(null)
    setEditando(null)
  }, [mes])

  const visiveis = filtrarRegistros(registros, mes, dia)
  const somaMes = resumir(visiveis.map(r => ({ valor: r.total })))
  const diaSugerido: DiaPagamento = (dia && (DIAS_DE_PAGAMENTO as readonly number[]).includes(dia) ? dia : 20) as DiaPagamento

  const baixarPdf = async (reg: RegistroArquivo, comPix: boolean) => {
    try {
      const { pdfDoArquivo } = await import('../../lib/arquivoPagamentosPdf')
      const blob = await pdfDoArquivo(reg, comPix)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pagamento_${reg.data_pagamento}${comPix ? '_com_pix' : ''}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 8000)
      toast.success(comPix ? 'PDF com PIX gerado' : 'PDF sem PIX gerado')
    } catch (e) { toast.error('Não gerou o PDF: ' + (e as Error).message) }
  }
  const baixarExcel = (reg: RegistroArquivo, comPix: boolean) => {
    const linhas = [...reg.linhas].sort((a, b) => a.ordem - b.ordem)
    const cols = comPix
      ? [{ titulo: 'Nome', largura: 36 }, { titulo: 'Chave PIX', largura: 32, tipo: 'texto' as const }, { titulo: 'Valor', largura: 16, tipo: 'dinheiro' as const }, { titulo: 'Observação', largura: 56, tipo: 'texto' as const }]
      : [{ titulo: 'Nome', largura: 38 }, { titulo: 'Valor', largura: 16, tipo: 'dinheiro' as const }, { titulo: 'Observação', largura: 72, tipo: 'texto' as const }]
    baixarExcelBonito(`pagamento_${reg.data_pagamento}${comPix ? '_com_pix' : ''}`, [{
      nome: 'Pagamento',
      titulo: `Pagamento de ${formatarDataPagamento(reg.data_pagamento)}`,
      subtitulo: `${linhas.length} pessoa(s) · ${comPix ? 'com PIX, uso interno' : 'sem PIX'}${reg.observacao ? ' · ' + reg.observacao : ''}`,
      colunas: cols,
      linhas: linhas.map(l => celulasExportacao(l, comPix)),
      cores: linhas.map(l => (aConfirmar(l.observacao) ? 'amarelo' : null) as CorLinha),
      total: comPix ? ['Total', '', resumir(linhas).total, ''] : ['Total', resumir(linhas).total, ''],
      rodape: comPix ? 'Uso interno. Contém a chave PIX. Sem CPF e sem dados bancários.' : 'Para compartilhar. Sem chave PIX, sem CPF e sem dados bancários.',
    }]).then(() => toast.success(comPix ? 'Excel com PIX baixado' : 'Excel sem PIX baixado')).catch(e => toast.error('Não gerou: ' + (e as Error).message))
  }

  const novo = () => {
    setAberto(null)
    setEditando(rascunhoDe(null, mes, diaSugerido))
  }
  const abrir = (reg: RegistroArquivo) => { setEditando(null); setAberto(reg) }
  const editar = (reg: RegistroArquivo) => { setAberto(null); setEditando(rascunhoDe(reg, mes, diaSugerido)) }

  const excluir = async (reg: RegistroArquivo) => {
    if (!(await confirmar({
      titulo: `Excluir o pagamento de ${formatarDataPagamento(reg.data_pagamento)}?`,
      texto: `${reg.quantidade} pessoa(s) · ${formatCurrency(reg.total)}. O cálculo de pagamentos não muda.`,
      confirmar: 'Excluir', perigo: true,
    }))) return
    try {
      await onExcluir(reg.id)
      setAberto(null)
      setEditando(null)
      toast.success('Registro excluído')
    } catch (e) { toast.error(mensagemErro((e as Error).message)) }
  }

  if (avisoMigracao) {
    return (
      <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">
        Para usar o histórico de pagamentos, rode a migração 111 no Supabase. A 112 grava o pagamento de 20/11/2026.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-ink-600">Pagamentos já fechados em <span className="first-letter:uppercase">{nomeMes}</span>. Nome, valor, observação e chave PIX.</p>
          <p className="text-xs text-ink-400 mt-0.5">Não entra no cálculo de pagamentos. CPF e dados bancários ficam de fora. O arquivo baixado sai sem PIX, a menos que você escolha a versão interna.</p>
        </div>
        {!editando && (
          <button className="btn-primary text-sm" onClick={novo}><Plus size={15} />Registrar pagamento</button>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit flex-wrap">
        {([null, 8, 15, 20] as const).map(d => (
          <button key={String(d)} onClick={() => setDia(d)}
            className={`px-3 h-8 rounded-lg text-sm font-medium ${dia === d ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>
            {d == null ? 'Todos os dias' : `Dia ${d}`}
          </button>
        ))}
      </div>

      {erro && <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">{mensagemErro(erro)}</div>}

      {editando ? (
        <EditorPagamento mes={mes} nomeMes={nomeMes} rascunho={editando} registros={registros} salvando={salvando}
          cancelar={() => setEditando(null)}
          abrirExistente={id => { const r = registros.find(x => x.id === id); if (r) abrir(r) }}
          salvar={async (entrada) => {
            const salvo = await onSalvar(entrada)
            setEditando(null)
            setAberto(salvo)
            toast.success(entrada.id ? 'Registro salvo' : 'Pagamento arquivado')
          }} />
      ) : aberto ? (
        <RegistroAberto reg={aberto} voltar={() => setAberto(null)} editar={() => editar(aberto)} excluir={() => excluir(aberto)} pdf={com => baixarPdf(aberto, com)} excel={com => baixarExcel(aberto, com)} />
      ) : carregando ? <p className="text-sm text-ink-500">Carregando…</p> : visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">
          Nenhum pagamento arquivado em {nomeMes}{dia ? ` no dia ${dia}` : ''}.
          <div className="mt-3"><button className="btn-primary text-sm" onClick={novo}><Plus size={15} />Registrar pagamento</button></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="card px-3 py-2.5"><p className="text-[11px] text-ink-500">Pagamentos no filtro</p><p className="text-lg font-semibold tnum text-ink-900">{visiveis.length}</p></div>
            <div className="card px-3 py-2.5"><p className="text-[11px] text-ink-500">Total</p><p className="text-lg font-semibold tnum text-ink-900">{formatCurrency(somaMes.total)}</p></div>
          </div>
          <div className="card overflow-hidden divide-y divide-ink-100">
            {visiveis.map(r => (
              <button key={r.id} onClick={() => abrir(r)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-ink-50/60">
                <span className="w-11 h-11 rounded-xl bg-primary-50 text-primary-800 font-semibold flex items-center justify-center shrink-0 tnum">{r.data_pagamento.slice(8, 10)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-ink-900">Pagamento de {formatarDataPagamento(r.data_pagamento)}</span>
                  <span className="block text-xs text-ink-500 truncate">{r.quantidade} pessoa(s){r.observacao ? ` · ${r.observacao}` : ''}</span>
                </span>
                <span className="text-sm font-semibold tnum text-ink-900 shrink-0">{formatCurrency(r.total)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RegistroAberto({ reg, voltar, editar, excluir, pdf, excel }: {
  reg: RegistroArquivo
  voltar: () => void
  editar: () => void
  excluir: () => void
  pdf: (comPix: boolean) => void
  excel: (comPix: boolean) => void
}) {
  const [comPix, setComPix] = useState(false)
  const linhas = [...reg.linhas].sort((a, b) => a.ordem - b.ordem)
  const soma = resumir(linhas)
  return (
    <div className="space-y-3">
      <button className="btn-ghost text-sm -ml-2" onClick={voltar}><ChevronLeft size={16} />Voltar para a lista</button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-ink-900 flex items-center gap-2"><Archive size={18} className="text-primary-700" />Pagamento de {formatarDataPagamento(reg.data_pagamento)}</h2>
          <p className="text-sm text-ink-500 mt-0.5">{soma.quantidade} pessoa(s) · {formatCurrency(soma.total)}</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70" role="group" aria-label="PIX no arquivo baixado">
            <button type="button" onClick={() => setComPix(false)} className={`px-3 h-8 rounded-lg text-sm font-medium ${comPix ? 'text-ink-500' : 'bg-white shadow-sm text-ink-900'}`}>Sem PIX</button>
            <button type="button" onClick={() => setComPix(true)} className={`px-3 h-8 rounded-lg text-sm font-medium ${comPix ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>Com PIX</button>
          </div>
          <button className="btn-primary text-sm" onClick={() => pdf(comPix)}><FileDown size={15} />Baixar PDF</button>
          <button className="btn-secondary text-sm" onClick={() => excel(comPix)}><Download size={15} />Excel</button>
          <button className="btn-secondary text-sm" onClick={editar}><Pencil size={15} />Editar</button>
          <button className="btn-ghost text-sm text-red-600" onClick={excluir}><Trash2 size={15} />Excluir</button>
        </div>
      </div>
      <p className="text-xs text-ink-400">{comPix ? 'Uso interno: o arquivo leva a chave PIX de cada pessoa.' : 'Para compartilhar: o arquivo sai sem chave PIX. Este é o padrão.'}</p>
      {reg.observacao && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span className="font-medium">Observação do pagamento: </span>{reg.observacao}
        </div>
      )}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-50">
                <th className="th">Nome</th>
                <th className="th">Chave PIX</th>
                <th className="th text-right">Valor</th>
                <th className="th">Observação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.id || l.ordem + l.nome} className="border-t border-ink-100">
                  <td className="px-4 py-2.5 text-ink-900">{l.nome}</td>
                  <td className="px-4 py-2.5 text-ink-600 font-mono text-xs">{l.pix || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium tnum text-ink-900 whitespace-nowrap">{formatCurrency(l.valor)}</td>
                  <td className={`px-4 py-2.5 ${aConfirmar(l.observacao) ? 'text-amber-800' : 'text-ink-600'}`}>{l.observacao || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-ink-200 bg-primary-50/60">
                <td className="px-4 py-2.5 font-semibold text-ink-900">Total · {soma.quantidade} pessoa(s)</td>
                <td />
                <td className="px-4 py-2.5 text-right font-semibold tnum text-ink-900">{formatCurrency(soma.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function EditorPagamento({ mes, nomeMes, rascunho, registros, salvando, cancelar, salvar, abrirExistente }: {
  mes: string
  nomeMes: string
  rascunho: Rascunho
  registros: RegistroArquivo[]
  salvando: boolean
  cancelar: () => void
  salvar: (entrada: EntradaArquivo) => Promise<void>
  abrirExistente: (id: string) => void
}) {
  const [f, setF] = useState(rascunho)
  const [tentou, setTentou] = useState(false)
  const [cola, setCola] = useState('')
  const [leitura, setLeitura] = useState<LeituraArquivo | null>(null)
  const [mostrandoCola, setMostrandoCola] = useState(false)
  const arqRef = useRef<HTMLInputElement>(null)
  const data = dataNoMes(mes, f.dia)
  const ocupado = registros.find(r => r.data_pagamento === data && r.id !== f.id)
  const previa = entradaDoRascunho(f, mes)
  const outras = registros.filter(r => r.id !== f.id).map(r => r.data_pagamento)
  const erro = ocupado ? 'Já existe um registro neste dia de pagamento.' : previa.erro || (previa.entrada ? validarEntrada(previa.entrada, outras) : 'Confira as linhas.')
  const soma = resumir((previa.entrada?.linhas || []).map(l => ({ valor: l.valor })))
  const temAlgo = f.observacao.trim().length > 0 || f.linhas.some(l => l.nome.trim() || l.valorTxt.trim() || l.observacao.trim() || l.pix.trim())

  const mudaLinha = (chaveId: string, m: Partial<RascunhoLinha>) => {
    setF(x => ({ ...x, linhas: x.linhas.map(l => l.chave === chaveId ? { ...l, ...m } : l) }))
  }
  const aplicar = (linhas: LinhaLida[], substituir: boolean) => {
    const novas = linhas.map(l => ({ chave: chave(), nome: l.nome, valorTxt: valorParaTexto(l.valor), observacao: l.observacao || '', pix: l.pix || '' }))
    setF(x => ({
      ...x,
      linhas: substituir || x.linhas.every(l => !l.nome.trim() && !l.valorTxt.trim()) ? novas : [...x.linhas.filter(l => l.nome.trim() || l.valorTxt.trim()), ...novas],
    }))
    setLeitura(null)
    setCola('')
    setMostrandoCola(false)
    toast.success(substituir ? 'Linhas substituídas' : 'Linhas acrescentadas')
  }
  const linhasVazias = f.linhas.every(x => !x.nome.trim() && !x.valorTxt.trim())
  const importarArquivo = async (file: File) => {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer())
      const grade = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }) as unknown[][]
      const l = lerGrade(grade)
      setLeitura(l)
      setMostrandoCola(true)
      if (!l.linhas.length) toast.error(l.erros[0] || 'Nenhuma pessoa encontrada.')
    } catch (e) { toast.error('Não li a planilha: ' + (e as Error).message) }
  }
  const gravar = async () => {
    if (!previa.entrada || erro) { toast.error(erro || 'Confira as linhas.'); return }
    try { await salvar(previa.entrada) }
    catch (e) { toast.error(mensagemErro((e as Error).message)) }
  }

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">{f.id ? 'Editar pagamento' : 'Registrar pagamento'}</h2>
          <p className="text-xs text-ink-500 mt-0.5 first-letter:uppercase">{nomeMes}. O dia segue o mês escolhido acima.</p>
        </div>
        <button className="btn-ghost text-sm" onClick={cancelar}>Cancelar</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Dia de pagamento</label>
          <select className="input" value={f.dia} onChange={e => setF(x => ({ ...x, dia: Number(e.target.value) as DiaPagamento }))}>
            {DIAS_DE_PAGAMENTO.map(d => <option key={d} value={d}>Dia {d} · {formatarDataPagamento(dataNoMes(mes, d) || '')}</option>)}
          </select>
          {ocupado && (
            <button type="button" className="text-xs text-primary-800 mt-1 underline" onClick={() => abrirExistente(ocupado.id)}>
              Já existe um registro neste dia. Abrir para editar.
            </button>
          )}
        </div>
        <div>
          <label className="label">Observação geral <span className="font-normal text-ink-400">— opcional</span></label>
          <input className="input" value={f.observacao} onChange={e => setF(x => ({ ...x, observacao: e.target.value }))} placeholder="Algo sobre o pagamento inteiro" />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button type="button" className="btn-secondary text-sm" onClick={() => setMostrandoCola(v => !v)}><ClipboardPaste size={15} />Colar linhas</button>
        <button type="button" className="btn-secondary text-sm" onClick={() => arqRef.current?.click()}><FileSpreadsheet size={15} />Importar Excel</button>
        <input ref={arqRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) importarArquivo(file); e.target.value = '' }} />
      </div>

      {mostrandoCola && (
        <div className="space-y-2">
          <textarea className="input font-mono text-xs" rows={5} value={cola} onChange={e => { setCola(e.target.value); setLeitura(null) }}
            placeholder={'Uma pessoa por linha. Tab ou ponto e vírgula:\nNome; valor; observação; chave PIX'} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setLeitura(lerTexto(cola))}>Ler linhas</button>
          </div>
          {leitura && (
            <div className="text-xs space-y-1">
              {leitura.avisos.map(a => <p key={a} className="text-amber-800">{a}</p>)}
              {leitura.erros.map(a => <p key={a} className="text-red-700">{a}</p>)}
              {leitura.linhas.length > 0 && (
                <div className="flex gap-2 pt-1">
                  <button type="button" className="btn-primary text-sm" onClick={() => aplicar(leitura.linhas, true)}>{linhasVazias ? `Usar ${leitura.linhas.length} linha(s)` : 'Substituir as linhas'}</button>
                  {!linhasVazias && <button type="button" className="btn-secondary text-sm" onClick={() => aplicar(leitura.linhas, false)}>Acrescentar</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {f.linhas.map((l, i) => (
          <div key={l.chave} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.1fr)_8rem_minmax(0,1fr)_minmax(0,0.9fr)_auto] gap-2 items-start">
            <input className="input" aria-label={`Nome da pessoa ${i + 1}`} value={l.nome} placeholder="Nome" onChange={e => mudaLinha(l.chave, { nome: e.target.value })} />
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">R$</span>
              <input className="input pl-9 tnum" aria-label={`Valor da pessoa ${i + 1}`} inputMode="decimal" value={l.valorTxt} placeholder="0,00" onChange={e => mudaLinha(l.chave, { valorTxt: e.target.value.replace(/[^\d,.]/g, '') })} />
            </div>
            <input className="input" aria-label={`Observação da pessoa ${i + 1}`} value={l.observacao} placeholder="Observação (opcional)" onChange={e => mudaLinha(l.chave, { observacao: e.target.value })} />
            <input className="input font-mono text-xs" aria-label={`Chave PIX da pessoa ${i + 1}`} value={l.pix} placeholder="Chave PIX (opcional)" onChange={e => mudaLinha(l.chave, { pix: e.target.value })} />
            <button type="button" className="btn-ghost text-ink-400 px-2" aria-label={`Remover pessoa ${i + 1}`} onClick={() => setF(x => ({ ...x, linhas: x.linhas.length === 1 ? [linhaVazia()] : x.linhas.filter(y => y.chave !== l.chave) }))}><Trash2 size={15} /></button>
          </div>
        ))}
        <button type="button" className="btn-ghost text-sm" onClick={() => setF(x => ({ ...x, linhas: [...x.linhas, linhaVazia()] }))}><Plus size={14} />Adicionar pessoa</button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-ink-100 pt-3">
        <p className="text-sm text-ink-700"><span className="font-semibold tnum">{formatCurrency(soma.total)}</span> · {soma.quantidade} pessoa(s)</p>
        <button className="btn-primary text-sm" disabled={salvando || !!erro} onClick={() => { setTentou(true); gravar() }}>{salvando ? 'Salvando…' : f.id ? 'Salvar' : 'Arquivar pagamento'}</button>
      </div>
      {erro && (temAlgo || ocupado || tentou) && <p className="text-xs text-red-700">{erro}</p>}
    </div>
  )
}

export default function ArquivoPagamentos({ mes, nomeMes }: { mes: string; nomeMes: string }) {
  const qc = useQueryClient()
  const [salvando, setSalvando] = useState(false)
  const fim = (() => { const [a, m] = mes.split('-').map(Number); return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}` })()

  const { data: registros = [], isLoading, error } = useQuery({
    queryKey: ['arquivo-pagamentos', mes],
    queryFn: async () => {
      const { data, error } = await supabase.from('arquivo_pagamentos')
        .select('id, data_pagamento, observacao, total, quantidade, arquivo_pagamento_linhas(id, ordem, nome, valor, pix, observacao)')
        .gte('data_pagamento', `${mes}-01`)
        .lte('data_pagamento', fim)
        .order('data_pagamento')
      if (error) throw new Error(error.message)
      return (data || []).map(row => normalizar(row as Record<string, unknown>))
    },
  })
  const avisoMigracao = !!error && /arquivo_pagamento|schema cache|does not exist|Could not find|PGRST/i.test((error as Error).message)

  const onSalvar = async (entrada: EntradaArquivo) => {
    setSalvando(true)
    try {
      const { data, error } = await supabase.rpc('salvar_arquivo_pagamento', {
        p: {
          id: entrada.id ?? null,
          data_pagamento: entrada.data_pagamento,
          observacao: entrada.observacao,
          linhas: entrada.linhas.map(l => ({ nome: l.nome, valor: l.valor, pix: l.pix, observacao: l.observacao })),
        },
      })
      if (error) throw new Error(error.message)
      const id = String(data)
      const { data: row, error: e2 } = await supabase.from('arquivo_pagamentos')
        .select('id, data_pagamento, observacao, total, quantidade, arquivo_pagamento_linhas(id, ordem, nome, valor, pix, observacao)')
        .eq('id', id)
        .single()
      if (e2) throw new Error(e2.message)
      await qc.invalidateQueries({ queryKey: ['arquivo-pagamentos'] })
      return normalizar(row as Record<string, unknown>)
    } finally { setSalvando(false) }
  }
  const onExcluir = async (id: string) => {
    const { error } = await supabase.from('arquivo_pagamentos').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await qc.invalidateQueries({ queryKey: ['arquivo-pagamentos'] })
  }

  return (
    <ArquivoPagamentosVista
      mes={mes} nomeMes={nomeMes} registros={registros} carregando={isLoading}
      avisoMigracao={avisoMigracao} erro={avisoMigracao ? null : error ? (error as Error).message : null}
      salvando={salvando} onSalvar={onSalvar} onExcluir={onExcluir}
    />
  )
}
