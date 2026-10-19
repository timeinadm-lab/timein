// ============================================================
// Planilha da Ajuda de custo (pedido do Gabriel, 19/10/2026: "mais organizada,
// eu escolho a semana ou o mês, com o PIX, com o total, com cores, bem
// apresentável"). Três partes:
//   · Para pagar: uma linha por pessoa — nome, PIX, clientes, ajuda do
//     contrato, reembolsos, outros custos, total (fórmula), situação, observação.
//   · Lançamentos: cada lançamento, com o link do comprovante.
//   · Uma aba por cliente (o controle que vai para o contador), semana a semana.
// Sem banco e sem React: testada em planilhaAjudaCusto.test.ts.
// ============================================================
import type { AbaExcel, CelulaExcel, CorLinha } from './excelBonito'
import { letraDaColuna } from './excelBonito'

export type AjudaPlanilha = {
  id: string; employee_id: string | null; client_id: string | null; periodo: 'semana' | 'mes'
  inicio: string; fim: string; tipo: string; descricao: string | null; valor: number
  status: string; pago_em: string | null; link_id?: string | null; expense_id?: string | null; observacao?: string | null
}
export type Grupo = 'contrato' | 'reembolso' | 'outros'
export type Escolha = { tipo: 'mes' } | { tipo: 'semana'; de: string; ate: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const curto = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`
const dataBR = (ds: string | null) => ds ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}` : ''

export const grupoDa = (a: AjudaPlanilha): Grupo => a.link_id ? 'contrato' : a.expense_id || a.tipo === 'Reembolso' ? 'reembolso' : 'outros'
export const tipoTexto = (a: AjudaPlanilha) => a.link_id ? 'Ajuda do contrato' : a.tipo
export const periodoTexto = (a: AjudaPlanilha) => a.periodo === 'mes' ? 'Mês inteiro' : `Semana ${curto(a.inicio)} a ${curto(a.fim)}`

/** O que entra na planilha escolhida (semana: só os lançamentos semanais que começam nela) */
export function filtrarPeriodo(ajudas: AjudaPlanilha[], e: Escolha): AjudaPlanilha[] {
  const valem = ajudas.filter(a => a.valor > 0 || a.status === 'Pago')
  return e.tipo === 'mes' ? valem : valem.filter(a => a.periodo === 'semana' && a.inicio >= e.de && a.inicio <= e.ate)
}

export type LinhaPessoa = {
  employee_id: string | null; nome: string; clientes: string[]
  contrato: number; reembolso: number; outros: number; total: number
  pago: number; obs: string[]
}

/** Uma linha por pessoa, em ordem de nome */
export function porPessoa(ajudas: AjudaPlanilha[], nome: (id: string | null) => string, cliente: (id: string | null) => string): LinhaPessoa[] {
  const m = new Map<string, LinhaPessoa>()
  for (const a of ajudas) {
    const k = a.employee_id || 'sem'
    const l = m.get(k) ?? { employee_id: a.employee_id, nome: nome(a.employee_id) || 'Sem colaborador', clientes: [], contrato: 0, reembolso: 0, outros: 0, total: 0, pago: 0, obs: [] }
    l[grupoDa(a)] += a.valor
    l.total += a.valor
    if (a.status === 'Pago') l.pago += a.valor
    const c = cliente(a.client_id)
    if (c && !l.clientes.includes(c)) l.clientes.push(c)
    const o = grupoDa(a) === 'outros' ? `${a.tipo}${a.descricao ? ` (${a.descricao})` : ''}` : grupoDa(a) === 'reembolso' && a.descricao ? `Reembolso: ${a.descricao}` : ''
    for (const x of [o, a.observacao || '']) if (x && !l.obs.includes(x)) l.obs.push(x)
    m.set(k, l)
  }
  return [...m.values()].map(l => ({ ...l, contrato: r2(l.contrato), reembolso: r2(l.reembolso), outros: r2(l.outros), total: r2(l.total), pago: r2(l.pago) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

const situacao = (total: number, pago: number) => pago >= total && total > 0 ? 'Pago' : pago > 0 ? 'Parcial' : 'A pagar'

export function abasAjudaCusto(opts: {
  tituloPeriodo: string                       // "outubro de 2026" ou "semana de 13/10 a 19/10"
  ajudas: AjudaPlanilha[]                     // já filtradas pelo período
  nome: (id: string | null) => string
  pix: (id: string | null) => string          // '' = sem PIX
  cliente: (id: string | null) => string
  comprovante?: (a: AjudaPlanilha) => CelulaExcel   // sem = planilha sem a coluna
}): AbaExcel[] {
  const { tituloPeriodo, ajudas, nome, pix, cliente, comprovante } = opts
  const abas: AbaExcel[] = []
  const pixOu = (id: string | null) => pix(id) || 'SEM PIX NO CADASTRO'

  // 1. Para pagar
  const pessoas = porPessoa(ajudas, nome, cliente)
  const L = 5, U = L + pessoas.length - 1
  const soma = (col: string, v: number): CelulaExcel => ({ formula: `SUM(${col}${L}:${col}${U})`, result: r2(v) })
  abas.push({
    nome: 'Para pagar',
    titulo: `Ajuda de custo · ${tituloPeriodo}`,
    subtitulo: `${pessoas.length} pessoa(s) · total ${pessoas.reduce((s, p) => s + p.total, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · edite os valores: o Total recalcula`,
    colunas: [
      { titulo: 'Nome completo', largura: 32 }, { titulo: 'PIX', largura: 28, tipo: 'texto' }, { titulo: 'Cliente(s)', largura: 28, tipo: 'texto' },
      { titulo: 'Ajuda do contrato', largura: 15, tipo: 'dinheiro' }, { titulo: 'Reembolsos', largura: 14, tipo: 'dinheiro' },
      { titulo: 'Outros custos', largura: 14, tipo: 'dinheiro' }, { titulo: 'Total', largura: 15, tipo: 'dinheiro' },
      { titulo: 'Situação', largura: 11, tipo: 'centro' }, { titulo: 'Observação', largura: 46, tipo: 'texto' },
    ],
    linhas: pessoas.map((p, i): CelulaExcel[] => [
      p.nome, pixOu(p.employee_id), p.clientes.join(', '), p.contrato, p.reembolso, p.outros,
      { formula: `D${L + i}+E${L + i}+F${L + i}`, result: p.total }, situacao(p.total, p.pago), p.obs.join(' · '),
    ]),
    cores: pessoas.map(p => (situacao(p.total, p.pago) === 'Pago' ? 'verde' : !pix(p.employee_id) ? 'amarelo' : null) as CorLinha),
    total: pessoas.length ? ['Total', '', '',
      soma('D', pessoas.reduce((s, p) => s + p.contrato, 0)), soma('E', pessoas.reduce((s, p) => s + p.reembolso, 0)),
      soma('F', pessoas.reduce((s, p) => s + p.outros, 0)), soma('G', pessoas.reduce((s, p) => s + p.total, 0)), '', ''] : undefined,
    rodape: 'Verde = já pago. Amarelo = sem PIX no cadastro. "Outros custos" = hospedagem, carro, combustível, alimentação e outros lançados à mão.',
  })

  // 2. Lançamentos (com comprovante)
  const ordem = [...ajudas].sort((a, b) => cliente(a.client_id).localeCompare(cliente(b.client_id), 'pt-BR') || a.inicio.localeCompare(b.inicio) || nome(a.employee_id).localeCompare(nome(b.employee_id), 'pt-BR'))
  const colVal = 7
  const colunasLanc = [
    { titulo: 'Cliente', largura: 26, tipo: 'texto' as const }, { titulo: 'Período', largura: 22 }, { titulo: 'Nome completo', largura: 30 },
    { titulo: 'PIX', largura: 26, tipo: 'texto' as const }, { titulo: 'Tipo', largura: 17 }, { titulo: 'Descrição', largura: 28, tipo: 'texto' as const },
    { titulo: 'Valor', largura: 13, tipo: 'dinheiro' as const }, { titulo: 'Situação', largura: 11, tipo: 'centro' as const },
    { titulo: 'Pago em', largura: 11, tipo: 'data' as const }, { titulo: 'Observação', largura: 30, tipo: 'texto' as const },
    ...(comprovante ? [{ titulo: 'Comprovante', largura: 22 }] : []),
  ]
  abas.push({
    nome: 'Lançamentos',
    titulo: `Lançamentos da ajuda de custo · ${tituloPeriodo}`,
    subtitulo: `${ordem.length} lançamento(s)${comprovante ? ' · clique em "Abrir comprovante" (descompacte o zip antes)' : ''}`,
    colunas: colunasLanc,
    linhas: ordem.map((a): CelulaExcel[] => [
      cliente(a.client_id) || 'Sem cliente', periodoTexto(a), nome(a.employee_id), pixOu(a.employee_id), tipoTexto(a), a.descricao || '',
      a.valor, a.status === 'Pago' ? 'Pago' : 'A pagar', dataBR(a.pago_em), a.observacao || '',
      ...(comprovante ? [comprovante(a)] : []),
    ]),
    cores: ordem.map(a => (a.status === 'Pago' ? 'verde' : null) as CorLinha),
    total: ordem.length ? colunasLanc.map((_, c): CelulaExcel => c === 0 ? 'Total' : c === colVal - 1
      ? { formula: `SUM(${letraDaColuna(colVal)}5:${letraDaColuna(colVal)}${4 + ordem.length})`, result: r2(ordem.reduce((s, a) => s + a.valor, 0)) } : '') : undefined,
    rodape: 'Verde = já pago.',
  })

  // 3. Uma aba por cliente: semana a semana (faixas alternadas por semana)
  const clientes = [...new Set(ordem.map(a => a.client_id || ''))]
  const usados = new Set(abas.map(a => a.nome))
  for (const cid of clientes) {
    const itens = ordem.filter(a => (a.client_id || '') === cid)
    const nomeCli = cliente(cid || null) || 'Sem cliente'
    let nomeAba = nomeCli.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sem cliente'
    for (let n = 2; usados.has(nomeAba); n++) nomeAba = `${nomeAba.slice(0, 26)} ${n}`
    usados.add(nomeAba)
    const periodos = [...new Set(itens.map(periodoTexto))]
    abas.push({
      nome: nomeAba,
      titulo: `${nomeCli} · ${tituloPeriodo}`,
      subtitulo: `${itens.length} lançamento(s) · ${periodos.length} período(s)`,
      colunas: [
        { titulo: 'Período', largura: 22 }, { titulo: 'Nome completo', largura: 30 }, { titulo: 'PIX', largura: 26, tipo: 'texto' },
        { titulo: 'Tipo', largura: 17 }, { titulo: 'Descrição', largura: 28, tipo: 'texto' }, { titulo: 'Valor', largura: 13, tipo: 'dinheiro' },
        { titulo: 'Situação', largura: 11, tipo: 'centro' },
      ],
      linhas: itens.map((a): CelulaExcel[] => [periodoTexto(a), nome(a.employee_id), pixOu(a.employee_id), tipoTexto(a), a.descricao || '', a.valor, a.status === 'Pago' ? 'Pago' : 'A pagar']),
      cores: itens.map(a => (a.status === 'Pago' ? 'verde' : periodos.indexOf(periodoTexto(a)) % 2 ? 'cinza' : null) as CorLinha),
      total: ['Total do cliente', '', '', '', '', { formula: `SUM(F5:F${4 + itens.length})`, result: r2(itens.reduce((s, a) => s + a.valor, 0)) }, ''],
      rodape: 'Verde = já pago. Faixas cinza separam os períodos (semanas).',
    })
  }
  return abas
}
