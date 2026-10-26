// ============================================================
// Auditoria GR — auditorias de fornecedores da GRSA (migrações 087 e 100).
// 08/10/2026: a planilha "Status Auditorias Fornecedores GRSA" dentro do sistema.
// 20/10/2026 (aprovado pela chefe): vira "Auditoria GR" em Planilhas, uma
// planilha/relatório de uso interno, para controle operacional e financeiro.
// Ganha o bloco Financeiro (quem paga, forma, nota fiscal, comprovante e o
// auditor terceirizado — 101), a ficha "em aberto – faltam X", as etapas
// ("em que pé está"), o filtro por mês e o Excel bonito em 4 abas.
// Acompanhamento (102, "o mais importante é o que está faltando"): os 7
// documentos que se coletam em cada processo, cada um com seus arquivos e a
// observação embaixo. Relatório de UMA auditoria = PDF (auditoriaGRPdf.ts);
// relatório do mês = Excel simples (Resumo, Auditorias e a planilha da GR).
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
// Próxima auditoria pelo resultado (22/10/2026, a cliente: "aprovado, é só daqui
// dois anos, dependendo da categoria; aprovado com restrições, daqui seis meses").
// É só a sugestão: a data continua editável na ficha.
export const VALIDADE_ANOS = 2
export const MESES_COM_RESSALVAS = 6
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
  // Anexos (102): quantos quiser, cada um com observação
  anexos?: AnexoGR[] | null
  // Cobranças e envio do resultado (104)
  cobrancas?: Cobranca[] | null
  resultado_enviado_em?: string | null
  // Auditor da equipe (105): a auditoria aparece no calendário dele (escritório e portal)
  auditor_id?: string | null
  criado_em?: string | null
}

// ── Documentos do processo (20/10/2026): o que vai sendo coletado ─────────

export type DocChave = 'orcamento' | 'aprovacao' | 'comprovante' | 'nota' | 'agendamento' | 'relatorio' | 'auditor'
export const DOCUMENTOS: { chave: DocChave; nome: string; dica: string }[] = [
  { chave: 'orcamento', nome: 'Orçamento enviado', dica: 'o orçamento que foi enviado' },
  { chave: 'aprovacao', nome: 'Aprovação do comprador', dica: 'print ou PDF do e-mail' },
  { chave: 'comprovante', nome: 'Comprovante de pagamento', dica: 'Pix, boleto pago, transferência' },
  { chave: 'nota', nome: 'Nota fiscal', dica: 'quando precisa' },
  { chave: 'agendamento', nome: 'Agendamento confirmado', dica: 'data e horário (arquivo opcional)' },
  { chave: 'relatorio', nome: 'Relatório da auditoria', dica: 'o relatório final' },
  { chave: 'auditor', nome: 'Pagamento ao auditor', dica: 'comprovante do que pagamos ao auditor' },
]
/** Arquivo anexado: de qual documento é (ou "outro") e a observação que vai embaixo */
/** Cobrança de retorno (104): quando e, se quiser, como foi ("e-mail", "WhatsApp") */
export type Cobranca = { data: string; obs: string | null }
export const cobrancasDe = (a: Pick<AuditoriaFornecedor, 'cobrancas'>): Cobranca[] =>
  (Array.isArray(a.cobrancas) ? a.cobrancas : []).filter(c => c && c.data).sort((x, y) => x.data.localeCompare(y.data))
export type AnexoGR = { caminho: string; nome: string; tipo: DocChave | 'outro'; obs: string | null; em: string }
export const nomeDoTipo = (t: string) => DOCUMENTOS.find(d => d.chave === t)?.nome || 'Outro'
export const anexosDe = (a: Pick<AuditoriaFornecedor, 'anexos'>): AnexoGR[] => Array.isArray(a.anexos) ? a.anexos : []

/** Documento pelo nome do arquivo (dá para trocar na ficha) */
export function tipoDoAnexo(nome: string): DocChave | 'outro' {
  const s = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/(^|[^a-z])(nf|nfe|nfs|nfse|danfe)([^a-z]|$)|nota fiscal|nota_fiscal/.test(s)) return 'nota'
  if (/relatorio/.test(s)) return 'relatorio'
  if (/orcamento|proposta/.test(s)) return 'orcamento'
  if (/aprova/.test(s)) return 'aprovacao'
  if (/auditor/.test(s)) return 'auditor'
  if (/agenda/.test(s)) return 'agendamento'
  if (/comprov|pix|recibo|boleto|pagamento|transf/.test(s)) return 'comprovante'
  return 'outro'
}

export type EstadoDoc = 'ok' | 'sem_arquivo' | 'falta' | 'nao_se_aplica'
export type ItemDoc = { chave: DocChave; nome: string; estado: EstadoDoc; detalhe: string; anexos: AnexoGR[] }
export const ROTULO_ESTADO: Record<EstadoDoc, string> = { ok: 'Ok', sem_arquivo: 'Falta o arquivo', falta: 'Falta', nao_se_aplica: 'Não se aplica' }

/**
 * Os 7 documentos e em que pé está cada um:
 * ok = arquivo anexado (agendamento: basta a data) · sem_arquivo = a etapa
 * aconteceu, mas o documento não foi anexado · falta · não se aplica.
 */
export function documentosDoProcesso(a: AuditoriaFornecedor): ItemDoc[] {
  const anx = anexosDe(a)
  const dm = (iso?: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''
  const junta = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(' · ')
  const item = (chave: DocChave, estado: EstadoDoc, detalhe: string): ItemDoc =>
    ({ chave, nome: DOCUMENTOS.find(d => d.chave === chave)!.nome, estado, detalhe, anexos: anx.filter(x => x.tipo === chave) })
  const tem = (k: DocChave) => anx.some(x => x.tipo === k)
  const pelo = (k: DocChave, aconteceu: boolean): EstadoDoc => tem(k) ? 'ok' : aconteceu ? 'sem_arquivo' : 'falta'
  const semPagamento = a.pagamento === 'Não se aplica'
  const total = totalOrcamento(a)
  return [
    item('orcamento', pelo('orcamento', !!a.orcamento_enviado_em),
      junta(total ? moeda(total) : null, a.orcamento_enviado_em ? `enviado em ${dm(a.orcamento_enviado_em)}` : 'ainda não enviado')),
    item('aprovacao', pelo('aprovacao', !!a.aprovado_em),
      junta(a.aprovado_em ? `aprovado em ${dm(a.aprovado_em)}` : 'aguardando aprovação', a.comprador)),
    semPagamento ? item('comprovante', 'nao_se_aplica', 'pagamento não se aplica')
      : item('comprovante', pelo('comprovante', a.pagamento === 'Pago' || !!a.comprovante_enviado),
        junta(a.pagamento === 'Pago' ? `pago${a.pago_em ? ' em ' + dm(a.pago_em) : ''}` : a.pagamento.toLowerCase(),
          a.responsavel_pagamento ? `paga: ${ROTULO_QUEM_PAGA[a.responsavel_pagamento] || a.responsavel_pagamento}` : null, a.forma_pagamento)),
    semPagamento || a.precisa_nota === false ? item('nota', 'nao_se_aplica', 'não precisa de nota')
      : a.precisa_nota == null ? item('nota', tem('nota') ? 'ok' : 'falta', 'definir no Financeiro se precisa de nota')
      : item('nota', pelo('nota', !!a.nota_numero?.trim()),
        a.nota_numero?.trim() ? junta(`nº ${a.nota_numero.trim()}`, a.nota_emitida_em ? `emitida em ${dm(a.nota_emitida_em)}` : null) : 'nota ainda não emitida'),
    item('agendamento', a.agendada_para || tem('agendamento') ? 'ok' : 'falta',
      a.agendada_para ? junta(`dia ${dm(a.agendada_para)}${a.horario ? ' às ' + a.horario : ''}`, a.auditor) : 'sem data marcada'),
    item('relatorio', tem('relatorio') || a.auditoria_id ? 'ok' : 'falta',
      a.auditoria_id && !tem('relatorio') ? 'auditoria feita no sistema'
        : a.realizada_em ? junta(`realizada em ${dm(a.realizada_em)}`, a.resultado, a.nota != null ? `nota ${a.nota}` : null) : 'auditoria ainda não realizada'),
    a.valor_auditor === 0 ? item('auditor', 'nao_se_aplica', 'sem auditor terceirizado')
      : item('auditor', pelo('auditor', a.auditor_pagamento === 'Pago'),
        junta(a.valor_auditor ? moeda(Number(a.valor_auditor)) : 'valor não informado',
          a.auditor_pagamento === 'Pago' ? `pago${a.auditor_pago_em ? ' em ' + dm(a.auditor_pago_em) : ''}` : 'a pagar')),
  ]
}
const resolvido = (i: ItemDoc) => i.estado === 'ok' || i.estado === 'nao_se_aplica'
/** "4 de 7" e o que falta (cancelada/encerrada não cobra nada) */
export function andamentoDocs(a: AuditoriaFornecedor) {
  const itens = documentosDoProcesso(a)
  const faltam = encerrada(a) ? [] : itens.filter(i => !resolvido(i))
  return { feitos: itens.filter(resolvido).length, total: itens.length, faltam: faltam.map(i => i.nome), itens }
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
export const temComprovante = (a: Pick<AuditoriaFornecedor, 'comprovante_url' | 'comprovante_enviado' | 'anexos'>) =>
  !!a.comprovante_url || !!a.comprovante_enviado || anexosDe(a).some(x => x.tipo === 'comprovante')
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
  // Ano fora de 2000–2099 é erro de digitação (planilha de 22/10/2026: "19/10/0206"): fica vazio, não vira o ano 206
  const anoOk = (a: string) => Number(a) >= 2000 && Number(a) <= 2099
  if (br) return anoOk(br[3]) ? `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : null
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/)
  return iso && anoOk(iso[0].slice(0, 4)) ? iso[0] : null
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
  exige('resultado', [[a.nota, 'Nota'], [a.resultado, 'Resultado'], [a.validade, 'Próxima auditoria']])
  if (a.resultado) exige('resultado', [[a.resultado_enviado_em, 'Resultado enviado em']])
  return f
}
export const quantoFalta = (a: AuditoriaFornecedor) => Object.values(faltandoNaFicha(a)).reduce((s, l) => s + l.length, 0)

/**
 * Próxima auditoria sugerida: aprovado (ou sem resultado ainda) 2 anos depois
 * da realizada; aprovado com ressalvas, 6 meses; reprovado fica em branco
 * (combinar com a GR).
 */
/** "Aprovado com ressalvas" ou como a planilha da GR escreve ("Aprovado com restrições documentais") */
export const comRessalvas = (resultado?: string | null) => /ressalva|restri/i.test(resultado || '')
export function validadePadrao(realizadaEm: string | null, resultado?: string | null): string | null {
  if (!realizadaEm || !/^\d{4}-\d{2}-\d{2}$/.test(realizadaEm)) return null
  if (/reprov/i.test(resultado || '')) return null
  const [a, m, d] = realizadaEm.split('-').map(Number)
  const ressalvas = comRessalvas(resultado)
  const dt = new Date(Date.UTC(a + (ressalvas ? 0 : VALIDADE_ANOS), m - 1 + (ressalvas ? MESES_COM_RESSALVAS : 0), d))
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

// ── Fases (21/10/2026: "ter noção do pé que cada uma está") ─────────────────
// Agrupam os status em 5 passos do fluxo + as que saíram dele.
export type FaseChave = 'orcamento' | 'acerto' | 'agendada' | 'relatorio' | 'concluida' | 'encerrada'
export const FASES: { chave: FaseChave; nome: string; status: readonly string[] }[] = [
  { chave: 'orcamento', nome: 'Orçamento e aprovação', status: ['Em elaboração de orçamento', 'Aguardando aprovação', 'Aguardando definição de laboratório'] },
  { chave: 'acerto', nome: 'Acertando data e pagamento', status: ['Aguardando retorno do fornecedor', 'Aguardando pagamento', 'Aguardando comprovante'] },
  { chave: 'agendada', nome: 'Agendada', status: ['Agendada'] },
  { chave: 'relatorio', nome: 'Aguardando relatório', status: ['Aguardando relatório'] },
  { chave: 'concluida', nome: 'Concluída', status: ['Concluída'] },
  { chave: 'encerrada', nome: 'Encerradas e canceladas', status: ENCERRADOS },
]
export const faseDe = (a: Pick<AuditoriaFornecedor, 'status'>): FaseChave => FASES.find(f => f.status.includes(a.status))?.chave ?? 'orcamento'

/**
 * Última vez que o processo andou: a data mais recente (até hoje) entre as
 * datas que a pessoa informa na ficha — orçamento enviado, aprovação,
 * pagamento, agenda, realização, nota emitida e pagamento do auditor.
 * Não conta quando a ficha foi mexida, importada ou o arquivo anexado (21/10:
 * "a pessoa coloca a data"); a criação só vale se não tiver nenhuma data.
 * Agenda no futuro volta em "proxima".
 */
export function ultimoMovimento(a: AuditoriaFornecedor, hoje: string): { data: string | null; dias: number | null; proxima: string | null } {
  const valida = (d: string | null | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d)
  const datas = [a.orcamento_enviado_em, a.aprovado_em, a.pago_em, a.agendada_para, a.realizada_em, a.nota_emitida_em, a.auditor_pago_em, a.resultado_enviado_em]
    .filter(valida).map(d => d.slice(0, 10))
  const passadas = datas.filter(d => d <= hoje).sort()
  const criada = valida(a.criado_em) && a.criado_em.slice(0, 10) <= hoje ? a.criado_em.slice(0, 10) : null
  const data = passadas.length ? passadas[passadas.length - 1] : datas.length ? null : criada
  const dias = data ? Math.round((Date.parse(hoje + 'T00:00:00Z') - Date.parse(data + 'T00:00:00Z')) / 86400000) : null
  const proxima = a.agendada_para && a.agendada_para > hoje && !a.realizada_em ? a.agendada_para : null
  return { data, dias, proxima }
}

/**
 * Mês da auditoria, para o filtro "auditorias do mês": a data em que foi
 * realizada; se ainda não foi, a agendada; sem agenda, a do orçamento
 * (ou de quando a ficha foi criada).
 */
export function mesDoProcesso(a: AuditoriaFornecedor): string | null {
  const d = a.realizada_em || a.agendada_para || a.orcamento_enviado_em || a.aprovado_em || a.criado_em || null
  return d ? d.slice(0, 7) : null
}

/**
 * Entra no mês? Pelo mês da auditoria (acima) e, se ainda está em aberto
 * (nem concluída nem encerrada), em todo mês desde que começou até hoje
 * (21/10/2026: orçamento de setembro ainda parado tem que aparecer em outubro).
 */
export function noMes(a: AuditoriaFornecedor, mes: string, hoje: string): boolean {
  if (mesDoProcesso(a) === mes) return true
  if (encerrada(a) || a.status === 'Concluída') return false
  const inicio = [a.orcamento_enviado_em, a.aprovado_em, a.agendada_para, a.criado_em].filter(Boolean).map(d => d!.slice(0, 7)).sort()[0]
  return !!inicio && inicio <= mes && mes <= hoje.slice(0, 7)
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

/**
 * Relatório do mês (ou do que está na tela), simples: Resumo (quantas, quanto
 * entrou, quanto foi pago aos auditores, sobra), Auditorias (uma linha por
 * processo: documentos, o que falta e o dinheiro) e a Planilha GR completa.
 * filtro: ex. "outubro de 2026 · Em andamento" (vai no subtítulo).
 */
export function abasRelatorioGR(lista: AuditoriaFornecedor[], hoje: string, op: { filtro?: string } = {}): AbaExcel[] {
  const ord = ordenar(lista)
  const n = numerosDoTopo(lista)
  const consolidado = `Gerado em ${br(hoje)}${op.filtro ? ' · ' + op.filtro : ''} · ${n.registros} auditoria(s)`
  const ativos = lista.filter(a => !encerrada(a))
  const soma = (l: AuditoriaFornecedor[]) => centavos(l.reduce((s, a) => s + totalOrcamento(a), 0))
  const pagos = lista.filter(a => a.pagamento === 'Pago')
  const daGR = pagos.filter(a => a.responsavel_pagamento === 'Unidade GRSA')
  const doForn = pagos.filter(a => a.responsavel_pagamento === 'Fornecedor')
  const notas = ativos.filter(a => a.precisa_nota && !a.nota_numero?.trim())
  const comFalta = ativos.filter(a => andamentoDocs(a).faltam.length > 0)
  const L = PRIMEIRA_LINHA_EXCEL

  // Resumo
  const resumo: CelulaExcel[][] = [
    ['Auditorias no período', n.registros, null],
    ['Em andamento', n.emAndamento, null],
    ['Concluídas', n.concluidas, null],
    ['Canceladas / encerradas', n.encerradas, null],
    ['Com documento faltando', comFalta.length, null],
    ['Total orçado (sem canceladas e encerradas)', ativos.length, n.orcamentosAtivos],
    ['Entrou (já pago)', n.qtdRecebido, n.recebido],
    ['   pago pela GR (unidade)', daGR.length, soma(daGR)],
    ['   pago pelo fornecedor', doForn.length, soma(doForn)],
    ['A receber', n.qtdAReceber, n.aReceber],
    ['Pago aos auditores', null, n.pagoAuditor],
    ['A pagar aos auditores', n.qtdAPagarAuditor, n.aPagarAuditor],
    ['Sobra para a Time IN (orçado − auditores)', null, n.sobra],
    ['Notas fiscais a emitir', notas.length, soma(notas)],
  ]
  const coresResumo: CorLinha[] = [null, null, 'verde', 'cinza', comFalta.length ? 'amarelo' : null, null, 'verde', null, null,
    n.aReceber ? 'amarelo' : null, 'verde', n.aPagarAuditor ? 'amarelo' : null, 'azul', notas.length ? 'vermelho' : null]

  // Auditorias: uma linha por processo (G total, I recebido, K auditor, M sobra)
  const linhas = ord.map((a, i): CelulaExcel[] => {
    const d = andamentoDocs(a)
    const enc = encerrada(a)
    return [
      a.codigo, a.fornecedor + (a.planta ? ` · ${a.planta}` : ''), localDaAuditoria(a) || NAO_INFORMADO, a.status,
      enc ? '—' : `${d.feitos} de ${d.total}`, enc ? '—' : d.faltam.length ? d.faltam.join(', ') : 'Nada, completo',
      totalOrcamento(a), a.pagamento, a.pagamento === 'Pago' ? totalOrcamento(a) : 0,
      a.auditor || NAO_INFORMADO, Number(a.valor_auditor) || 0, a.auditor_pagamento || 'A pagar',
      enc ? '—' : { formula: `G${L + i}-K${L + i}`, result: centavos(totalOrcamento(a) - (Number(a.valor_auditor) || 0)) },
    ]
  })
  const fim = L + ord.length - 1
  const somaCol = (col: string, v: number): CelulaExcel => ord.length ? { formula: `SUM(${col}${L}:${col}${fim})`, result: v } : 0
  const somaCampo = (k: 'valor_auditoria' | 'deslocamento' | 'valor_auditor') => centavos(ord.reduce((s, a) => s + (Number(a[k]) || 0), 0))

  // Planilha GR: as 36 colunas, como a planilha deles
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
  const somaColN = (col: number, v: number): CelulaExcel => somaCol(letraDaColuna(col), v)
  const totalAcomp: CelulaExcel[] = COLUNAS.map((_, i) =>
    i === 0 ? 'Total' : i + 1 === iValor ? somaColN(iValor, somaCampo('valor_auditoria')) : i + 1 === iDesl ? somaColN(iDesl, somaCampo('deslocamento')) : i + 1 === iTotal ? somaColN(iTotal, soma(ord)) : null)

  return [
    {
      nome: 'Resumo', titulo: 'Auditoria GR — Resumo', subtitulo: consolidado,
      colunas: [{ titulo: 'Indicador', largura: 46 }, { titulo: 'Quantidade', largura: 13, tipo: 'numero' }, { titulo: 'Valor (R$)', largura: 18, tipo: 'dinheiro' }],
      linhas: resumo, cores: coresResumo,
      rodape: 'Valor = auditoria + deslocamento. A receber = em andamento ou concluídas ainda não pagas. Sobra = total orçado (sem canceladas e encerradas) − valor dos auditores.',
    },
    {
      nome: 'Auditorias', titulo: 'Auditoria GR — Em que pé está cada uma', subtitulo: consolidado,
      colunas: [
        { titulo: 'ID', largura: 11 }, { titulo: 'Fornecedor', largura: 32 }, { titulo: 'Local', largura: 18 }, { titulo: 'Status', largura: 24 },
        { titulo: 'Documentos', largura: 11, tipo: 'centro' }, { titulo: 'O que falta', largura: 40 },
        { titulo: 'Total', largura: 14, tipo: 'dinheiro' }, { titulo: 'Pagamento', largura: 20, tipo: 'centro' }, { titulo: 'Entrou', largura: 14, tipo: 'dinheiro' },
        { titulo: 'Auditor', largura: 20 }, { titulo: 'Pago ao auditor', largura: 15, tipo: 'dinheiro' }, { titulo: 'Auditor: situação', largura: 15, tipo: 'centro' },
        { titulo: 'Sobra', largura: 14, tipo: 'dinheiro' },
      ],
      linhas, cores: ord.map(a => encerrada(a) ? 'cinza' : andamentoDocs(a).faltam.length ? 'amarelo' : 'verde'),
      total: ['Total', null, null, null, null, null, somaCol('G', soma(ord)), null, somaCol('I', soma(pagos.filter(a => ord.includes(a)))),
        null, somaCol('K', somaCampo('valor_auditor')), null, somaCol('M', n.sobra)],
      rodape: 'Documentos: orçamento, aprovação, comprovante, nota fiscal, agendamento, relatório e pagamento ao auditor. Verde: completo · Amarelo: falta documento · Cinza: cancelada ou encerrada.',
    },
    {
      nome: 'Planilha GR', titulo: 'GRSA – Auditorias de fornecedores', subtitulo: consolidado,
      colunas: COLUNAS.map(c => ({
        titulo: c.titulo, largura: largura[c.chave] ?? (c.tipo === 'data' ? 14 : c.tipo === 'moeda' ? 15 : 17),
        tipo: c.tipo === 'moeda' ? 'dinheiro' as const : c.tipo === 'numero' ? 'numero' as const : c.tipo === 'data' || c.tipo === 'simnao' || c.chave === 'uf' ? 'centro' as const : 'texto' as const,
      })),
      linhas: acomp, cores: ord.map(a => corDoStatus(a.status)), total: totalAcomp,
      rodape: 'A planilha completa no formato da GR. “Não informado” indica ausência de evidência.',
    },
  ]
}

/** Nome do arquivo: Auditoria_GR_20.10.26 (geral) ou Auditoria_GR_outubro-2026 (mês) */
export const nomeRelatorioGR = (hoje: string, mes?: string | null) =>
  `Auditoria_GR_${mes ? nomeDoMes(mes).replace(' de ', '-') : `${hoje.slice(8, 10)}.${hoje.slice(5, 7)}.${hoje.slice(2, 4)}`}`
