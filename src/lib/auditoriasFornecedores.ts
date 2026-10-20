// ============================================================
// Auditoria GR — auditorias de fornecedores da GRSA (migrações 087 e 100).
// 08/10/2026: a planilha "Status Auditorias Fornecedores GRSA" dentro do sistema.
// 20/10/2026 (aprovado pela chefe): vira "Auditoria GR" em Planilhas, uma
// planilha/relatório de uso interno, para controle operacional e financeiro.
// Ganha o bloco Financeiro (quem paga, forma, nota fiscal, comprovante e o
// auditor terceirizado — 101), a ficha "em aberto – faltam X", as etapas
// ("em que pé está"), o filtro por mês e o Excel bonito em 4 abas.
// Sem React e sem banco: testado em auditoriasFornecedores.test.ts.
// ============================================================

import type { AbaExcel, CelulaExcel, CorLinha } from './excelBonito'
import { letraDaColuna, PRIMEIRA_LINHA_EXCEL } from './excelBonito'

export const STATUS_FORNECEDOR = [
  'Em elaboração de orçamento', 'Aguardando aprovação', 'Aguardando retorno do fornecedor',
  'Aguardando definição de laboratório', 'Aguardando pagamento', 'Aguardando comprovante',
  'Agendada', 'Aguardando relatório', 'Concluída',
  'Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente',
] as const
export const STATUS_INICIAL = 'Em elaboração de orçamento'
export const PAGAMENTO_OPCOES = ['Não pago', 'Aguardando comprovante', 'Pago', 'Não se aplica'] as const
export const FORMAS_PAGAMENTO = ['Pix na conta da empresa', 'Boleto', 'Transferência', 'Faturado na GR'] as const
/** Quem paga: o valor gravado é o mesmo da planilha da GR */
export const QUEM_PAGA = ['Unidade GRSA', 'Fornecedor'] as const
export const ROTULO_QUEM_PAGA: Record<string, string> = { 'Unidade GRSA': 'GR (unidade)', Fornecedor: 'Fornecedor' }
export const RESULTADOS = ['Aprovado', 'Aprovado com ressalvas', 'Reprovado'] as const
export const AUDITOR_PAGAMENTO = ['A pagar', 'Pago'] as const
export const ENCERRADOS = ['Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente']
export const VALIDADE_ANOS = 3
export const NAO_INFORMADO = 'Não informado'

export type AuditoriaFornecedor = {
  id?: string
  codigo: string; fornecedor: string; planta: string | null; status: string; proxima_acao: string | null
  cnpj: string | null; categoria: string | null; produtos: string | null; tipo: 'Inicial' | 'Renovação' | null
  cidade: string | null; uf: string | null; endereco: string | null; contato: string | null; email: string | null; telefone: string | null
  comprador: string | null; unidade_grsa: string | null; cr: string | null; responsavel_pagamento: string | null
  valor_auditoria: number | null; deslocamento: number | null; cidade_polo: string | null
  orcamento_enviado_em: string | null; aprovado_em: string | null
  pagamento: string; pago_em: string | null; comprovante_enviado: boolean; comprovante_recebido_em: string | null
  agendada_para: string | null; horario: string | null; realizada_em: string | null; auditor: string | null
  nota: number | null; resultado: string | null; validade: string | null
  auditoria_id?: string | null; observacoes?: string | null
  // Financeiro (100) — opcionais para funcionar antes de rodar a migração
  local_auditoria?: string | null; forma_pagamento?: string | null; precisa_nota?: boolean | null
  nota_numero?: string | null; nota_emitida_em?: string | null; comprovante_url?: string | null; obs_financeiro?: string | null
  // Auditor terceirizado (101) — só interno, nunca no relatório do cliente
  valor_auditor?: number | null; auditor_pix?: string | null; auditor_pagamento?: string | null; auditor_pago_em?: string | null
  criado_em?: string | null
}

type Campo = { chave: keyof AuditoriaFornecedor; titulo: string; tipo?: 'data' | 'moeda' | 'numero' | 'simnao' }

/** As 36 colunas da planilha da GR, na mesma ordem. "Total orçamento" é calculado. */
export const COLUNAS: (Campo | { chave: 'total'; titulo: string; tipo: 'moeda' })[] = [
  { chave: 'codigo', titulo: 'ID' },
  { chave: 'fornecedor', titulo: 'Fornecedor / razão social' },
  { chave: 'planta', titulo: 'Planta' },
  { chave: 'status', titulo: 'Status atual' },
  { chave: 'proxima_acao', titulo: 'Próxima ação' },
  { chave: 'cnpj', titulo: 'CNPJ' },
  { chave: 'categoria', titulo: 'Categoria' },
  { chave: 'produtos', titulo: 'Produtos / escopo' },
  { chave: 'tipo', titulo: 'Tipo de auditoria' },
  { chave: 'cidade', titulo: 'Cidade' },
  { chave: 'uf', titulo: 'UF' },
  { chave: 'endereco', titulo: 'Endereço' },
  { chave: 'contato', titulo: 'Contato' },
  { chave: 'email', titulo: 'E-mail fornecedor' },
  { chave: 'telefone', titulo: 'Telefone' },
  { chave: 'comprador', titulo: 'Comprador GRSA' },
  { chave: 'unidade_grsa', titulo: 'Unidade GRSA' },
  { chave: 'cr', titulo: 'CR' },
  { chave: 'responsavel_pagamento', titulo: 'Responsável pelo pagamento' },
  { chave: 'valor_auditoria', titulo: 'Valor auditoria (R$)', tipo: 'moeda' },
  { chave: 'deslocamento', titulo: 'Deslocamento (R$)', tipo: 'moeda' },
  { chave: 'total', titulo: 'Total orçamento (R$)', tipo: 'moeda' },
  { chave: 'cidade_polo', titulo: 'Cidade polo' },
  { chave: 'orcamento_enviado_em', titulo: 'Orçamento enviado em', tipo: 'data' },
  { chave: 'aprovado_em', titulo: 'Aprovação / autorização em', tipo: 'data' },
  { chave: 'pagamento', titulo: 'Pagamento' },
  { chave: 'pago_em', titulo: 'Pago em', tipo: 'data' },
  { chave: 'comprovante_enviado', titulo: 'Comprovante enviado', tipo: 'simnao' },
  { chave: 'comprovante_recebido_em', titulo: 'Comprovante recebido em', tipo: 'data' },
  { chave: 'agendada_para', titulo: 'Auditoria agendada para', tipo: 'data' },
  { chave: 'horario', titulo: 'Horário' },
  { chave: 'realizada_em', titulo: 'Auditoria realizada em', tipo: 'data' },
  { chave: 'auditor', titulo: 'Auditor' },
  { chave: 'nota', titulo: 'Nota (0–100)', tipo: 'numero' },
  { chave: 'resultado', titulo: 'Resultado' },
  { chave: 'validade', titulo: 'Validade da nova auditoria', tipo: 'data' },
]

export const totalOrcamento = (a: Pick<AuditoriaFornecedor, 'valor_auditoria' | 'deslocamento'>) =>
  Math.round(((Number(a.valor_auditoria) || 0) + (Number(a.deslocamento) || 0)) * 100) / 100
const centavos = (v: number) => Math.round(v * 100) / 100
const encerrada = (a: Pick<AuditoriaFornecedor, 'status'>) => ENCERRADOS.includes(a.status)
/** Comprovante: anexado no sistema ou marcado como enviado (planilha importada) */
export const temComprovante = (a: Pick<AuditoriaFornecedor, 'comprovante_url' | 'comprovante_enviado'>) => !!a.comprovante_url || !!a.comprovante_enviado
/** Local da auditoria: o digitado ou, se vazio, a cidade/UF do fornecedor */
export const localDaAuditoria = (a: Pick<AuditoriaFornecedor, 'local_auditoria' | 'cidade' | 'uf'>) =>
  a.local_auditoria?.trim() || [a.cidade, a.uf].filter(Boolean).join('/') || null

const limpar = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return !s || /^n[ãa]o informado$/i.test(s) ? null : s
}

/** Data da planilha (número do Excel, dd/mm/aaaa ou ISO) → yyyy-MM-dd */
export function lerData(v: unknown): string | null {
  const s = limpar(v)
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    if (serial < 20000 || serial > 80000) return null
    return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10)
  }
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/)
  return iso ? iso[0] : null
}

const lerNumero = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  const s = limpar(v)
  if (!s) return null
  const n = Number(s.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return isNaN(n) ? null : n
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Pagamento escrito na planilha da GR → as 4 opções do sistema */
export function lerPagamento(v: unknown): { pagamento: string; comprovante?: boolean } {
  const s = norm(v)
  if (s.startsWith('informado') || s.startsWith('confirmado') || s === 'pago') return { pagamento: 'Pago', comprovante: s.startsWith('informado') || undefined }
  if (s.startsWith('aguardando')) return { pagamento: 'Aguardando comprovante' }
  if (s.startsWith('nao aplic') || s.startsWith('nao se aplica')) return { pagamento: 'Não se aplica' }
  return { pagamento: 'Não pago' }
}

/**
 * Lê a planilha (linhas cruas, como o sheet_to_json com header: 1 devolve).
 * Acha o cabeçalho pela coluna "ID" + "Fornecedor"; "Não informado" vira vazio.
 */
export function lerPlanilha(linhas: unknown[][]): { registros: AuditoriaFornecedor[]; erro?: string } {
  const iCab = linhas.findIndex(l => l.some(c => norm(c) === 'id') && l.some(c => norm(c).startsWith('fornecedor')))
  if (iCab < 0) return { registros: [], erro: 'Não achei o cabeçalho (colunas "ID" e "Fornecedor / razão social").' }
  const cab = linhas[iCab].map(norm)
  const pos = new Map<string, number>()
  for (const c of COLUNAS) { const i = cab.indexOf(norm(c.titulo)); if (i >= 0) pos.set(c.chave, i) }
  const registros: AuditoriaFornecedor[] = []
  for (const l of linhas.slice(iCab + 1)) {
    const v = (k: string) => { const i = pos.get(k); return i === undefined ? null : l[i] }
    const codigo = limpar(v('codigo')), fornecedor = limpar(v('fornecedor'))
    if (!codigo || !fornecedor) continue
    const r: Record<string, unknown> = { codigo, fornecedor }
    for (const c of COLUNAS) {
      if (c.chave === 'codigo' || c.chave === 'fornecedor' || c.chave === 'total') continue
      const bruto = v(c.chave)
      r[c.chave] = c.tipo === 'data' ? lerData(bruto)
        : c.tipo === 'moeda' || c.tipo === 'numero' ? lerNumero(bruto)
        : c.tipo === 'simnao' ? /^sim/i.test(String(bruto ?? '').trim())
        : limpar(bruto)
    }
    const status = STATUS_FORNECEDOR.find(s => norm(s) === norm(r.status))
    r.status = status || STATUS_INICIAL
    const pag = lerPagamento(v('pagamento'))
    r.pagamento = pag.pagamento
    if (pag.comprovante) r.comprovante_enviado = true
    r.tipo = norm(r.tipo).startsWith('renov') ? 'Renovação' : r.tipo ? 'Inicial' : null
    const quem = QUEM_PAGA.find(q => norm(q) === norm(r.responsavel_pagamento))
    r.responsavel_pagamento = quem || null
    registros.push(r as AuditoriaFornecedor)
  }
  return { registros }
}

/** Números do topo: operação e dinheiro */
export function numerosDoTopo(lista: AuditoriaFornecedor[]) {
  const fornecedores = new Set(lista.map(a => (a.cnpj || '').replace(/\D/g, '') || norm(a.fornecedor))).size
  const ativos = lista.filter(a => !encerrada(a))
  const soma = (l: AuditoriaFornecedor[]) => centavos(l.reduce((s, a) => s + totalOrcamento(a), 0))
  const pagos = lista.filter(a => a.pagamento === 'Pago')
  const aReceber = ativos.filter(a => a.pagamento === 'Não pago' || a.pagamento === 'Aguardando comprovante')
  // Auditor: o que já foi pago conta mesmo se a auditoria foi encerrada depois
  const valorAuditor = (l: AuditoriaFornecedor[]) => centavos(l.reduce((s, a) => s + (Number(a.valor_auditor) || 0), 0))
  const auditorPago = lista.filter(a => a.auditor_pagamento === 'Pago')
  const auditorAPagar = ativos.filter(a => a.auditor_pagamento !== 'Pago' && Number(a.valor_auditor) > 0)
  const custoAuditor = centavos(valorAuditor(auditorPago) + valorAuditor(auditorAPagar))
  return {
    custoAuditor, pagoAuditor: valorAuditor(auditorPago), aPagarAuditor: valorAuditor(auditorAPagar), qtdAPagarAuditor: auditorAPagar.length,
    sobra: centavos(soma(ativos) - valorAuditor(ativos)),
    fornecedores,
    registros: lista.length,
    emAndamento: ativos.filter(a => a.status !== 'Concluída').length,
    concluidas: lista.filter(a => a.status === 'Concluída').length,
    agendadas: lista.filter(a => a.status === 'Agendada').length,
    encerradas: lista.length - ativos.length,
    orcamentosAtivos: soma(ativos),
    recebido: soma(pagos), qtdRecebido: pagos.length,
    aReceber: soma(aReceber), qtdAReceber: aReceber.length,
  }
}

// ── Ficha "em aberto": o que falta em cada bloco ───────────────────────────

export type BlocoFicha = 'fornecedor' | 'pedido' | 'orcamento' | 'financeiro' | 'agenda' | 'resultado'
export const BLOCOS_FICHA: BlocoFicha[] = ['fornecedor', 'pedido', 'orcamento', 'financeiro', 'agenda', 'resultado']

/**
 * Campos que ainda faltam, por bloco. Cancelada/encerrada não cobra nada.
 * Financeiro: com "Não se aplica" só pede o local; nota fiscal só se precisar;
 * pago pede a data e o comprovante; não pago ainda conta como pendente.
 */
export function faltandoNaFicha(a: AuditoriaFornecedor): Record<BlocoFicha, string[]> {
  const f: Record<BlocoFicha, string[]> = { fornecedor: [], pedido: [], orcamento: [], financeiro: [], agenda: [], resultado: [] }
  if (encerrada(a)) return f
  const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim())
  const exige = (b: BlocoFicha, pares: [unknown, string][]) => { for (const [v, nome] of pares) if (vazio(v)) f[b].push(nome) }
  exige('fornecedor', [[a.fornecedor, 'Razão social'], [a.cnpj, 'CNPJ'], [a.categoria, 'Categoria'], [a.produtos, 'Produtos'],
    [a.cidade, 'Cidade'], [a.uf, 'UF'], [a.endereco, 'Endereço'], [a.contato, 'Contato'], [a.email, 'E-mail'], [a.telefone, 'Telefone']])
  exige('pedido', [[a.comprador, 'Comprador'], [a.unidade_grsa, 'Unidade GRSA'], [a.cr, 'CR'], [a.tipo, 'Tipo']])
  exige('orcamento', [[a.valor_auditoria, 'Valor'], [a.deslocamento, 'Deslocamento'], [a.cidade_polo, 'Cidade polo'],
    [a.orcamento_enviado_em, 'Enviado em'], [a.aprovado_em, 'Aprovado em']])
  exige('financeiro', [[localDaAuditoria(a), 'Local']])
  if (a.pagamento !== 'Não se aplica') {
    exige('financeiro', [[a.responsavel_pagamento, 'Quem paga'], [a.forma_pagamento, 'Forma de pagamento']])
    if (a.precisa_nota === null || a.precisa_nota === undefined) f.financeiro.push('Nota fiscal?')
    else if (a.precisa_nota) exige('financeiro', [[a.nota_numero, 'Nº da nota'], [a.nota_emitida_em, 'Nota emitida em']])
    if (a.pagamento === 'Pago') {
      exige('financeiro', [[a.pago_em, 'Pago em']])
      if (!temComprovante(a)) f.financeiro.push('Comprovante')
    } else f.financeiro.push('Pagamento')
  }
  // Auditor terceirizado: quanto recebe; depois da auditoria feita, pagar
  exige('financeiro', [[a.valor_auditor, 'Valor do auditor']])
  if (a.auditor_pagamento === 'Pago') exige('financeiro', [[a.auditor_pago_em, 'Auditor pago em']])
  else if (a.realizada_em) f.financeiro.push('Pagar o auditor')
  exige('agenda', [[a.agendada_para, 'Data'], [a.horario, 'Horário'], [a.auditor, 'Auditor'], [a.realizada_em, 'Realizada em']])
  exige('resultado', [[a.nota, 'Nota'], [a.resultado, 'Resultado'], [a.validade, 'Validade']])
  return f
}
export const quantoFalta = (a: AuditoriaFornecedor) => Object.values(faltandoNaFicha(a)).reduce((s, l) => s + l.length, 0)

/** Validade da próxima auditoria: 3 anos depois da realizada */
export function validadePadrao(realizadaEm: string | null): string | null {
  if (!realizadaEm || !/^\d{4}-\d{2}-\d{2}$/.test(realizadaEm)) return null
  const [a, m, d] = realizadaEm.split('-').map(Number)
  const dt = new Date(Date.UTC(a + VALIDADE_ANOS, m - 1, d))
  if (dt.getUTCDate() !== d) dt.setUTCDate(0)        // 29/02 → 28/02
  return dt.toISOString().slice(0, 10)
}

/** Aviso de validade: vencida ou vencendo em até 60 dias */
export function avisoValidade(validade: string | null, hoje: string): { tipo: 'vencida' | 'vencendo'; dias: number } | null {
  if (!validade) return null
  const dias = Math.round((Date.parse(validade + 'T00:00:00Z') - Date.parse(hoje + 'T00:00:00Z')) / 86400000)
  if (dias < 0) return { tipo: 'vencida', dias }
  if (dias <= 60) return { tipo: 'vencendo', dias }
  return null
}

// ── Em que pé está: as 6 etapas do processo ─────────────────────────────────

export const ETAPAS = ['Orçamento', 'Aprovação', 'Pagamento', 'Agendada', 'Realizada', 'Resultado'] as const

/** Cada etapa feita ou não (pelas datas e pelo pagamento, não pelo status) */
export function etapasDoProcesso(a: AuditoriaFornecedor): boolean[] {
  return [
    !!a.orcamento_enviado_em,
    !!a.aprovado_em,
    a.pagamento === 'Pago' || a.pagamento === 'Não se aplica',
    !!a.agendada_para,
    !!a.realizada_em,
    !!a.resultado || a.nota !== null && a.nota !== undefined,
  ]
}
export const etapasFeitas = (a: AuditoriaFornecedor) => etapasDoProcesso(a).filter(Boolean).length

/**
 * Mês da auditoria, para o filtro "auditorias do mês": a data em que foi
 * realizada; se ainda não foi, a agendada; sem agenda, a do orçamento
 * (ou de quando a ficha foi criada).
 */
export function mesDoProcesso(a: AuditoriaFornecedor): string | null {
  const d = a.realizada_em || a.agendada_para || a.orcamento_enviado_em || a.aprovado_em || a.criado_em || null
  return d ? d.slice(0, 7) : null
}

// ── Relatório em Excel (uso interno, 20/10/2026: "não vai para o cliente") ──
// Resumo, Andamento, Acompanhamento (as 36 colunas da GR) e Financeiro, com
// o auditor terceirizado (valor, situação) e a sobra.

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const ordenar = (lista: AuditoriaFornecedor[]) => [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
const moeda = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const nomeDoMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`

export const corDoStatus = (s: string): CorLinha =>
  s === 'Concluída' ? 'verde'
    : s === 'Agendada' || s === 'Aguardando relatório' ? 'azul'
    : ENCERRADOS.includes(s) ? 'cinza'
    : 'amarelo'
export const corDoPagamento = (p: string): CorLinha =>
  p === 'Pago' ? 'verde' : p === 'Não se aplica' ? 'cinza' : p === 'Aguardando comprovante' ? 'azul' : 'amarelo'

/** filtro: ex. "outubro de 2026 · Em andamento" (vai no subtítulo) */
export function abasRelatorioGR(lista: AuditoriaFornecedor[], hoje: string, op: { filtro?: string } = {}): AbaExcel[] {
  const ord = ordenar(lista)
  const n = numerosDoTopo(lista)
  const consolidado = `Consolidado em ${br(hoje)}${op.filtro ? ' · ' + op.filtro : ''} · ${n.fornecedores} fornecedor(es), ${n.registros} registro(s)`
  const ativos = lista.filter(a => !encerrada(a))
  const soma = (l: AuditoriaFornecedor[]) => centavos(l.reduce((s, a) => s + totalOrcamento(a), 0))
  const daGR = ativos.filter(a => a.responsavel_pagamento === 'Unidade GRSA')
  const doForn = ativos.filter(a => a.responsavel_pagamento === 'Fornecedor')
  const notas = ativos.filter(a => a.precisa_nota && !a.nota_numero?.trim())
  const L = PRIMEIRA_LINHA_EXCEL

  // Resumo
  const resumo: CelulaExcel[][] = [
    ['Fornecedores', n.fornecedores, null],
    ['Registros / plantas', n.registros, null],
    ['Em andamento', n.emAndamento, null],
    ['Agendadas', n.agendadas, null],
    ['Concluídas', n.concluidas, null],
    ['Canceladas / encerradas', n.encerradas, null],
    ['Total orçado (sem canceladas e encerradas)', ativos.length, n.orcamentosAtivos],
    ['Já recebido (pago)', n.qtdRecebido, n.recebido],
    ['A receber', n.qtdAReceber, n.aReceber],
    ['Quem paga: GR (unidade)', daGR.length, soma(daGR)],
    ['Quem paga: fornecedor', doForn.length, soma(doForn)],
    ['Notas fiscais a emitir', notas.length, soma(notas)],
    ['Auditores (terceirizados): custo total', null, n.custoAuditor],
    ['Auditores: já pago', null, n.pagoAuditor],
    ['Auditores: a pagar', n.qtdAPagarAuditor, n.aPagarAuditor],
    ['Sobra para a Time IN (orçado − auditores)', null, n.sobra],
  ]
  const coresResumo: CorLinha[] = [null, null, null, null, null, null, null, 'verde', 'amarelo', null, null, notas.length ? 'vermelho' : null,
    null, 'verde', n.aPagarAuditor ? 'amarelo' : null, 'azul']
  resumo.push(['Por status', null, null]); coresResumo.push('cinza')
  for (const s of STATUS_FORNECEDOR) {
    const doStatus = lista.filter(a => a.status === s)
    if (!doStatus.length) continue
    resumo.push([s, doStatus.length, soma(doStatus)])
    coresResumo.push(corDoStatus(s))
  }

  // Andamento: em que pé está cada um
  const marca = (feito: boolean, data?: string | null) => feito ? (data ? br(data) : '✓') : '—'
  const andamento = ord.map((a): CelulaExcel[] => {
    const e = etapasDoProcesso(a)
    return [
      a.codigo, a.fornecedor, a.planta || '—', a.status, a.proxima_acao || '—', `${e.filter(Boolean).length} de ${ETAPAS.length}`,
      marca(e[0], a.orcamento_enviado_em), marca(e[1], a.aprovado_em),
      a.pagamento === 'Não se aplica' ? 'Não se aplica' : marca(e[2], a.pago_em),
      marca(e[3], a.agendada_para), marca(e[4], a.realizada_em),
      e[5] ? [a.resultado, a.nota != null ? `nota ${a.nota}` : null].filter(Boolean).join(' · ') : '—',
    ]
  })

  // Acompanhamento: as 36 colunas da GR
  const iValor = COLUNAS.findIndex(c => c.chave === 'valor_auditoria') + 1
  const iDesl = COLUNAS.findIndex(c => c.chave === 'deslocamento') + 1
  const iTotal = COLUNAS.findIndex(c => c.chave === 'total') + 1
  const acomp = ord.map((a, i): CelulaExcel[] => COLUNAS.map(c => {
    if (c.chave === 'total') return { formula: `${letraDaColuna(iValor)}${L + i}+${letraDaColuna(iDesl)}${L + i}`, result: totalOrcamento(a) }
    const v = a[c.chave]
    if (c.chave === 'responsavel_pagamento') return v ? String(v) : NAO_INFORMADO
    if (c.tipo === 'simnao') return temComprovante(a) ? 'Sim' : 'Não'
    if (v === null || v === undefined || v === '') return c.tipo === 'moeda' ? 0 : NAO_INFORMADO
    if (c.tipo === 'data') return br(String(v))
    if (c.tipo === 'moeda' || c.tipo === 'numero') return Number(v)
    return v as string
  }))
  const largura: Record<string, number> = { codigo: 11, fornecedor: 34, planta: 16, status: 26, proxima_acao: 34, cnpj: 20, produtos: 30, endereco: 40, email: 28, responsavel_pagamento: 18 }
  const fim = L + ord.length - 1
  const somaCol = (col: number, v: number): CelulaExcel => ord.length ? { formula: `SUM(${letraDaColuna(col)}${L}:${letraDaColuna(col)}${fim})`, result: v } : 0
  const somaCampo = (k: 'valor_auditoria' | 'deslocamento' | 'valor_auditor') => centavos(ord.reduce((s, a) => s + (Number(a[k]) || 0), 0))
  const totalAcomp: CelulaExcel[] = COLUNAS.map((_, i) =>
    i === 0 ? 'Total' : i + 1 === iValor ? somaCol(iValor, somaCampo('valor_auditoria')) : i + 1 === iDesl ? somaCol(iDesl, somaCampo('deslocamento')) : i + 1 === iTotal ? somaCol(iTotal, soma(ord)) : null)

  // Financeiro (G valor, H deslocamento, I total, P auditor, T sobra)
  const fin = ord.map((a, i): CelulaExcel[] => [
      a.codigo, a.fornecedor, a.planta || '—', localDaAuditoria(a) || NAO_INFORMADO,
      a.responsavel_pagamento ? ROTULO_QUEM_PAGA[a.responsavel_pagamento] || a.responsavel_pagamento : NAO_INFORMADO,
      a.forma_pagamento || NAO_INFORMADO,
      Number(a.valor_auditoria) || 0, Number(a.deslocamento) || 0,
      { formula: `G${L + i}+H${L + i}`, result: totalOrcamento(a) },
      a.pagamento, a.pago_em ? br(a.pago_em) : '—',
      a.precisa_nota === true ? 'Sim' : a.precisa_nota === false ? 'Não' : NAO_INFORMADO,
      a.nota_numero || '—', a.nota_emitida_em ? br(a.nota_emitida_em) : '—',
      temComprovante(a) ? 'Sim' : 'Não',
      Number(a.valor_auditor) || 0, a.auditor || NAO_INFORMADO, a.auditor_pagamento || 'A pagar',
      a.auditor_pago_em ? br(a.auditor_pago_em) : '—',
      // Cancelada/encerrada não gera receita: sem sobra (a soma do Excel ignora o "—")
      encerrada(a) ? '—' : { formula: `I${L + i}-P${L + i}`, result: centavos(totalOrcamento(a) - (Number(a.valor_auditor) || 0)) },
  ])
  const colsFin: AbaExcel['colunas'] = [
    { titulo: 'ID', largura: 11 }, { titulo: 'Fornecedor', largura: 34 }, { titulo: 'Planta', largura: 14 }, { titulo: 'Local da auditoria', largura: 22 },
    { titulo: 'Quem paga', largura: 15, tipo: 'centro' }, { titulo: 'Forma de pagamento', largura: 22 },
    { titulo: 'Valor auditoria', largura: 15, tipo: 'dinheiro' }, { titulo: 'Deslocamento', largura: 14, tipo: 'dinheiro' }, { titulo: 'Total', largura: 15, tipo: 'dinheiro' },
    { titulo: 'Situação', largura: 22, tipo: 'centro' }, { titulo: 'Pago em', largura: 12, tipo: 'data' },
    { titulo: 'Nota fiscal?', largura: 12, tipo: 'centro' }, { titulo: 'Nº da nota', largura: 13, tipo: 'centro' }, { titulo: 'Nota emitida em', largura: 14, tipo: 'data' },
    { titulo: 'Comprovante', largura: 13, tipo: 'centro' },
    { titulo: 'Pago ao auditor', largura: 15, tipo: 'dinheiro' }, { titulo: 'Auditor', largura: 22 }, { titulo: 'Auditor: situação', largura: 15, tipo: 'centro' },
    { titulo: 'Auditor pago em', largura: 14, tipo: 'data' }, { titulo: 'Sobra', largura: 15, tipo: 'dinheiro' },
  ]
  const somaFin = (col: string, v: number): CelulaExcel => ord.length ? { formula: `SUM(${col}${L}:${col}${fim})`, result: v } : 0
  const totalFin: CelulaExcel[] = ['Total', null, null, null, null, null,
    somaFin('G', somaCampo('valor_auditoria')), somaFin('H', somaCampo('deslocamento')), somaFin('I', soma(ord)), null, null, null, null, null, null,
    somaFin('P', somaCampo('valor_auditor')), null, null, null, somaFin('T', n.sobra)]

  const titulo = (t: string) => `Auditoria GR — ${t}`
  return [
    {
      nome: 'Resumo', titulo: titulo('Resumo'), subtitulo: consolidado,
      colunas: [{ titulo: 'Indicador', largura: 46 }, { titulo: 'Quantidade', largura: 13, tipo: 'numero' }, { titulo: 'Valor (R$)', largura: 18, tipo: 'dinheiro' }],
      linhas: resumo, cores: coresResumo,
      rodape: 'A receber = auditorias em andamento ou concluídas com pagamento "Não pago" ou "Aguardando comprovante". Valor = auditoria + deslocamento.'
        + ' Sobra = total orçado (sem canceladas e encerradas) − valor dos auditores.',
    },
    {
      nome: 'Andamento', titulo: titulo('Em que pé está cada auditoria'), subtitulo: consolidado,
      colunas: [
        { titulo: 'ID', largura: 11 }, { titulo: 'Fornecedor', largura: 34 }, { titulo: 'Planta', largura: 14 }, { titulo: 'Status', largura: 26 },
        { titulo: 'Próxima ação', largura: 36 }, { titulo: 'Etapas', largura: 10, tipo: 'centro' },
        ...ETAPAS.map(e => ({ titulo: e, largura: e === 'Resultado' ? 22 : 13, tipo: 'centro' as const })),
      ],
      linhas: andamento, cores: ord.map(a => corDoStatus(a.status)),
      rodape: 'Etapas: orçamento enviado → aprovação → pagamento → agendada → realizada → resultado. A data é quando a etapa aconteceu; "—" ainda não aconteceu.',
    },
    {
      nome: 'Acompanhamento', titulo: 'GRSA – Auditorias de fornecedores', subtitulo: consolidado,
      colunas: COLUNAS.map(c => ({
        titulo: c.titulo, largura: largura[c.chave] ?? (c.tipo === 'data' ? 14 : c.tipo === 'moeda' ? 15 : 17),
        tipo: c.tipo === 'moeda' ? 'dinheiro' as const : c.tipo === 'numero' ? 'numero' as const : c.tipo === 'data' || c.tipo === 'simnao' || c.chave === 'uf' ? 'centro' as const : 'texto' as const,
      })),
      linhas: acomp, cores: ord.map(a => corDoStatus(a.status)), total: totalAcomp,
      rodape: 'Filtros no cabeçalho. “Não informado” indica ausência de evidência. Data de pagamento não é a data de envio do comprovante.',
    },
    {
      nome: 'Financeiro', titulo: titulo('Financeiro'), subtitulo: consolidado,
      colunas: colsFin, linhas: fin, cores: ord.map(a => encerrada(a) ? 'cinza' : corDoPagamento(a.pagamento)), total: totalFin,
      rodape: `Já recebido: ${moeda(n.recebido)} · A receber: ${moeda(n.aReceber)} · Auditores: pago ${moeda(n.pagoAuditor)}, a pagar ${moeda(n.aPagarAuditor)} · Sobra: ${moeda(n.sobra)}`
        + '. Verde: pago · Azul: aguardando comprovante · Amarelo: não pago · Cinza: não se aplica, cancelada ou encerrada.',
    },
  ]
}

/** Nome do arquivo: Auditoria_GR_20.10.26 (geral) ou Auditoria_GR_outubro-2026 (mês) */
export const nomeRelatorioGR = (hoje: string, mes?: string | null) =>
  `Auditoria_GR_${mes ? nomeDoMes(mes).replace(' de ', '-') : `${hoje.slice(8, 10)}.${hoje.slice(5, 7)}.${hoje.slice(2, 4)}`}`
