// ============================================================
// Auditorias de fornecedores GRSA (migração 087) — pedido de 08/10/2026.
// A planilha "Status Auditorias Fornecedores GRSA" dentro do sistema:
// leitura da planilha, números do topo, validade (3 anos) e o Excel
// de volta no mesmo formato para mandar ao cliente.
// Sem React e sem banco: testado em auditoriasFornecedores.test.ts.
// ============================================================

export const STATUS_FORNECEDOR = [
  'Aguardando aprovação', 'Aguardando retorno do fornecedor', 'Aguardando definição de laboratório',
  'Agendada', 'Concluída', 'Cancelada', 'Encerrada – outro prestador', 'Encerrada – auditoria vigente',
] as const
export const PAGAMENTO_OPCOES = ['Não confirmado', 'Informado – comprovante enviado', 'Pago'] as const
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
}

type Campo = { chave: keyof AuditoriaFornecedor; titulo: string; tipo?: 'data' | 'moeda' | 'numero' | 'simnao' }

/** As 36 colunas da planilha, na mesma ordem. "Total orçamento" é calculado. */
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

const limpar = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return !s || /^n[ãa]o informado$/i.test(s) || /^n[ãa]o confirmado$/i.test(s) ? null : s
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
    r.status = status || 'Aguardando aprovação'
    const pag = PAGAMENTO_OPCOES.find(p => norm(p) === norm(v('pagamento')))
    r.pagamento = pag || 'Não confirmado'
    r.tipo = norm(r.tipo).startsWith('renov') ? 'Renovação' : r.tipo ? 'Inicial' : null
    registros.push(r as AuditoriaFornecedor)
  }
  return { registros }
}

/** Os 6 números do topo da planilha */
export function numerosDoTopo(lista: AuditoriaFornecedor[]) {
  const fornecedores = new Set(lista.map(a => (a.cnpj || '').replace(/\D/g, '') || norm(a.fornecedor))).size
  const ativos = lista.filter(a => !ENCERRADOS.includes(a.status))
  return {
    fornecedores,
    registros: lista.length,
    concluidas: lista.filter(a => a.status === 'Concluída').length,
    agendadas: lista.filter(a => a.status === 'Agendada').length,
    orcamentosAtivos: Math.round(ativos.reduce((s, a) => s + totalOrcamento(a), 0) * 100) / 100,
    pagamentoInformado: Math.round(lista.filter(a => a.pagamento !== 'Não confirmado').reduce((s, a) => s + totalOrcamento(a), 0) * 100) / 100,
  }
}

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

/** Excel no mesmo formato da planilha que vai para o cliente */
export async function exportarPlanilhaGRSA(lista: AuditoriaFornecedor[], hoje: string) {
  const XLSX = await import('xlsx')
  const n = numerosDoTopo(lista)
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  const serial = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000 + 25569
  const linhas: unknown[][] = [
    [],
    ['GRSA – Auditorias de fornecedores'],
    [`Consolidado em ${br(hoje)}`],
    [],
    ['Fornecedores consolidados', 'Registros / plantas', 'Concluídas', 'Plantas agendadas', 'Orçamentos ativos (R$)', 'Pagamento informado (R$)'],
    [n.fornecedores, n.registros, n.concluidas, n.agendadas, n.orcamentosAtivos, n.pagamentoInformado],
    [],
    ['Filtros no cabeçalho. “Não informado” indica ausência de evidência. Data de pagamento não é a data de envio do comprovante.'],
    COLUNAS.map(c => c.titulo),
  ]
  const ordenada = [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  for (const a of ordenada) {
    linhas.push(COLUNAS.map(c => {
      if (c.chave === 'total') return totalOrcamento(a)
      const v = a[c.chave]
      if (c.chave === 'pagamento') return v || 'Não confirmado'
      if (c.tipo === 'simnao') return v ? 'Sim' : NAO_INFORMADO
      if (v === null || v === undefined || v === '') return NAO_INFORMADO
      if (c.tipo === 'data') return serial(String(v))
      if (c.tipo === 'moeda' || c.tipo === 'numero') return Number(v)
      return v
    }))
  }
  const ws = XLSX.utils.aoa_to_sheet(linhas)
  const MOEDA = '"R$" #,##0.00'
  // Formatos: moeda no topo e nas colunas de valor; data dd/mm/aaaa
  for (const c of [4, 5]) { const ref = XLSX.utils.encode_cell({ r: 5, c }); if (ws[ref]) ws[ref].z = MOEDA }
  COLUNAS.forEach((col, c) => {
    if (col.tipo !== 'moeda' && col.tipo !== 'data') return
    for (let r = 9; r < linhas.length; r++) {
      const cel = ws[XLSX.utils.encode_cell({ r, c })]
      if (cel && cel.t === 'n') cel.z = col.tipo === 'moeda' ? MOEDA : 'dd/mm/yyyy'
    }
  })
  ws['!cols'] = COLUNAS.map((c, i) => ({ wch: [12, 42, 25, 30, 44, 22, 18, 35, 18, 18, 18, 54, 18, 37, 18, 28, 24][i] ?? 18 }))
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 8, c: 0 }, e: { r: Math.max(8, linhas.length - 1), c: COLUNAS.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Acompanhamento')
  XLSX.writeFile(wb, `Status_Auditorias_Fornecedores_GRSA_${br(hoje).replace(/\//g, '.').replace(/\.(\d{2})(\d{2})$/, '.$2')}.xlsx`)
}
