// ============================================================
// Relatório do mês de pagamentos (Excel) — pedido do Gabriel, 30/09/2026.
// Abas no formato da planilha do contador (07/10/2026: "Controle pagamentos"),
// abertas em 14/10/2026 ("o salário + reembolso + observação + ajuda de custo"):
//   DIA 8 · DIA 15 · DIA 20 · Avulsos — DATA, NOME, PIX, CLIENTE, SALÁRIO,
//                  AJUDA DE CUSTO, REEMBOLSO, ADIANTAMENTO, OBSERVAÇÃO,
//                  TOTAL A PAGAR (= o lançado), SITUAÇÃO
//   Ajuda de custo (segundas) · semanal por pessoa, uma coluna por segunda
//   Por pessoa   · o mês de cada um: dia 8 + 15 + 20 + avulsos + segundas
//   Total        · cada dia com total, pago, a pagar e aguardando o RH
// E, para conferência:
//   Detalhado    · cada lançamento com CPF, banco, categoria e tipo
//   Reembolsos   · pedidos do mês (aprovado, pendente, negado)
//   Folha        · cada vínculo do mês trabalhado: a conta, o lançado e o pago
// ============================================================
import type { GrupoDia, Lancamento } from './pagamentosPorDia'
import { totaisDoMes, mesCurto } from './pagamentosPorDia'
import type { Abertura } from './aberturaPagamentos'
import type { AjudaRel } from './planilhaPagamentosDados'

export type ReembolsoRel = { employee?: { full_name?: string } | null; description?: string | null; category?: string | null; amount?: number | string | null; status?: string | null; created_at?: string | null }
export type FolhaRel = { pessoa: string; cliente: string; tipo: string; diaPagamento: string; etapa: string; conta: number; lancado: number; pago: number; aberto: number }

const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
const dataBR = (iso?: string | null) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

export async function exportRelatorioSaidas(opts: {
  mes: string                     // yyyy-MM (vencimento das saídas)
  nomeMes: string                 // "outubro de 2026"
  grupos: GrupoDia[]
  nomePessoa: (p: Lancamento) => string
  nomeCliente: (p: Lancamento) => string
  dadosBancarios?: (p: Lancamento) => { cpf: string; pix: string; banco: string }
  reembolsos: ReembolsoRel[]
  folha: FolhaRel[]
  mesFolha: string                // nome do mês trabalhado da aba Folha
  abertura?: Map<string, Abertura> // salário/ajuda/reembolso de cada lançamento
  ajudas?: AjudaRel[]              // Ajuda de custo do mês (paga às segundas)
  nomePorId?: (employeeId: string | null) => string
  pixPorId?: (employeeId: string | null) => string
  clientePorId?: (clientId: string | null) => string
}) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const MOEDA = '"R$" #,##0.00'

  const ajustar = (ws: import('xlsx').WorkSheet, linhas: unknown[][]) => {
    const largura = Math.max(...linhas.map(l => l.length))
    ws['!cols'] = Array.from({ length: largura }, (_, c) => ({
      wch: Math.min(48, Math.max(10, ...linhas.slice(0, 400).map(l => String(l[c] ?? '').length + 2))),
    }))
    // Número vira moeda (menos a coluna de quantidade, marcada com "Qtd")
    const cab = (linhas.find(l => l.some(x => x === 'Qtd' || x === 'Valor' || x === 'Total' || x === 'TOTAL A PAGAR')) || []) as unknown[]
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const cell = ws[k] as { t?: string; z?: string }
      const col = XLSX.utils.decode_cell(k).c
      if (cell.t === 'n' && cab[col] !== 'Qtd') cell.z = MOEDA
    }
  }
  const aba = (nome: string, linhas: unknown[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(linhas)
    ajustar(ws, linhas)
    XLSX.utils.book_append_sheet(wb, ws, nome)
    return ws
  }

  // ── Um aba por dia, igual à planilha do contador ──
  const t = totaisDoMes(opts.grupos)
  const esperando = (p: Lancamento) => !!(p as { aguardando?: unknown }).aguardando
  const situacao = (p: Lancamento) => p.status === 'Pago' ? `Pago${p.paid_at ? ' ' + dataBR(String(p.paid_at).slice(0, 10)) : ''}`
    : esperando(p) ? 'Aguardando RH' : 'A pagar'
  for (const g of opts.grupos) {
    if (g.chave === 'avulso' && !g.itens.length) continue
    const itens = [...g.itens].sort((x, y) => opts.nomePessoa(x).localeCompare(opts.nomePessoa(y)))
    const ab = (p: Lancamento): Abertura => opts.abertura?.get(p.id) ?? { salario: n2(p.amount), ajuda: 0, reembolso: 0, adiantamento: 0, reembolsos: [] }
    const soma = (f: (a: Abertura) => number) => n2(itens.reduce((t, p) => t + f(ab(p)), 0))
    aba(g.chave === 'avulso' ? 'Avulsos' : `DIA ${g.chave.slice(1)}`, [
      ['DATA', 'NOME', 'PIX', 'CLIENTE', 'SALÁRIO', 'AJUDA DE CUSTO', 'REEMBOLSO', 'ADIANTAMENTO (desconta)', 'OBSERVAÇÃO', 'TOTAL A PAGAR', 'SITUAÇÃO'],
      ...itens.map(p => {
        const a = ab(p)
        return [
          g.chave === 'avulso' ? dataBR(p.due_date) : g.chave.slice(1),   // texto: número viraria R$
          opts.nomePessoa(p) || p.description || '', opts.dadosBancarios?.(p).pix || '', opts.nomeCliente(p),
          a.salario, a.ajuda || '', a.reembolso || '', a.adiantamento ? -a.adiantamento : '',
          [p.description,
            p.reference_month && p.reference_month !== opts.mes ? `trabalho de ${mesCurto(p.reference_month)}` : '',
            a.reembolsos.length ? `reembolso: ${a.reembolsos.join(', ')}` : '',
            (p as { aguardando?: { motivo?: string } }).aguardando ? 'valor ainda pode mudar (falta o RH)' : '',
          ].filter(Boolean).join(' · '),
          n2(p.amount), situacao(p),
        ]
      }),
      [],
      ['', 'TOTAL', '', '', soma(a => a.salario), soma(a => a.ajuda), soma(a => a.reembolso), -soma(a => a.adiantamento), '', g.total, ''],
    ])
  }
  // ── Ajuda de custo paga às segundas (semanal) + lançamentos mensais da aba ──
  const ajudas = opts.ajudas || []
  const segundas = [...new Set(ajudas.filter(a => a.periodo === 'semana').map(a => a.inicio))].sort()
  const nomeId = (id: string | null) => opts.nomePorId?.(id) || ''
  const linhasAjuda = new Map<string, { nome: string; cliente: string; pix: string; tipos: Set<string>; porSeg: Map<string, number>; mensal: number; pago: number; obs: string[] }>()
  for (const a of ajudas) {
    const k = `${a.employee_id}|${a.client_id}`
    if (!linhasAjuda.has(k)) linhasAjuda.set(k, { nome: nomeId(a.employee_id), cliente: opts.clientePorId?.(a.client_id) || '', pix: opts.pixPorId?.(a.employee_id) || '', tipos: new Set(), porSeg: new Map(), mensal: 0, pago: 0, obs: [] })
    const l = linhasAjuda.get(k)!
    const v = n2(a.valor)
    l.tipos.add(a.tipo)
    if (a.periodo === 'semana') l.porSeg.set(a.inicio, n2((l.porSeg.get(a.inicio) || 0) + v))
    else l.mensal = n2(l.mensal + v)
    if (a.status === 'Pago') l.pago = n2(l.pago + v)
    if (a.tipo === 'Reembolso' && a.descricao) l.obs.push(`${dataBR(a.inicio).slice(0, 5)}: ${a.descricao}`)
  }
  const ajudaOrdenada = [...linhasAjuda.values()].filter(l => [...l.porSeg.values()].some(v => v > 0) || l.mensal > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome))
  const totalAjuda = (l: { porSeg: Map<string, number>; mensal: number }) => n2([...l.porSeg.values()].reduce((s, v) => s + v, 0) + l.mensal)
  if (ajudas.length) {
    aba('Ajuda de custo (segundas)', [
      ['NOME', 'PIX', 'CLIENTE', 'TIPO', ...segundas.map(sg => `Segunda ${dataBR(sg).slice(0, 5)}`), 'Mensal', 'TOTAL A PAGAR', 'Já pago', 'OBSERVAÇÃO'],
      ...ajudaOrdenada.map(l => [l.nome, l.pix, l.cliente, [...l.tipos].join(', '),
        ...segundas.map(sg => l.porSeg.get(sg) ?? ''), l.mensal || '', totalAjuda(l), l.pago || '', l.obs.join(' · ')]),
      [],
      ['TOTAL', '', '', '', ...segundas.map(sg => n2(ajudaOrdenada.reduce((s, l) => s + (l.porSeg.get(sg) || 0), 0))),
        n2(ajudaOrdenada.reduce((s, l) => s + l.mensal, 0)), n2(ajudaOrdenada.reduce((s, l) => s + totalAjuda(l), 0)), n2(ajudaOrdenada.reduce((s, l) => s + l.pago, 0)), ''],
      [],
      ['Ajuda de custo e reembolsos pagos toda segunda-feira (contratos com ajuda semanal, ou reembolso que o RH mandou para a segunda). Não está dentro do salário dos dias 8/15/20.'],
    ])
  }

  // ── Por pessoa: tudo o que cada um recebe no mês ──
  const porPessoa = new Map<string, { nome: string; pix: string; d8: number; d15: number; d20: number; avulso: number; segunda: number; pago: number }>()
  const pegar = (id: string, nome: string, pix: string) => {
    if (!porPessoa.has(id)) porPessoa.set(id, { nome, pix, d8: 0, d15: 0, d20: 0, avulso: 0, segunda: 0, pago: 0 })
    return porPessoa.get(id)!
  }
  for (const g of opts.grupos) for (const p of g.itens) {
    const r = pegar(p.employee_id || `sem-${p.id}`, opts.nomePessoa(p) || p.description || '', opts.dadosBancarios?.(p).pix || '')
    const v = n2(p.amount)
    if (g.chave === 'd8') r.d8 = n2(r.d8 + v); else if (g.chave === 'd15') r.d15 = n2(r.d15 + v)
    else if (g.chave === 'd20') r.d20 = n2(r.d20 + v); else r.avulso = n2(r.avulso + v)
    if (p.status === 'Pago') r.pago = n2(r.pago + v)
  }
  for (const a of ajudas) {
    if (!a.employee_id) continue
    const r = pegar(a.employee_id, nomeId(a.employee_id), opts.pixPorId?.(a.employee_id) || '')
    r.segunda = n2(r.segunda + n2(a.valor))
    if (a.status === 'Pago') r.pago = n2(r.pago + n2(a.valor))
  }
  const pessoasOrd = [...porPessoa.values()].filter(r => r.d8 + r.d15 + r.d20 + r.avulso + r.segunda > 0).sort((a, b) => a.nome.localeCompare(b.nome))
  const totalP = (r: typeof pessoasOrd[number]) => n2(r.d8 + r.d15 + r.d20 + r.avulso + r.segunda)
  const col = (f: (r: typeof pessoasOrd[number]) => number) => n2(pessoasOrd.reduce((s, r) => s + f(r), 0))
  aba('Por pessoa', [
    ['NOME', 'PIX', 'Dia 8', 'Dia 15', 'Dia 20', 'Avulsos', 'Ajuda de custo (segundas)', 'TOTAL A PAGAR', 'Já pago', 'Falta pagar'],
    ...pessoasOrd.map(r => [r.nome, r.pix, r.d8 || '', r.d15 || '', r.d20 || '', r.avulso || '', r.segunda || '', totalP(r), r.pago || '', n2(totalP(r) - r.pago)]),
    [],
    ['TOTAL', '', col(r => r.d8), col(r => r.d15), col(r => r.d20), col(r => r.avulso), col(r => r.segunda), col(totalP), col(r => r.pago), n2(col(totalP) - col(r => r.pago))],
  ])

  const somaEsperando = (g: GrupoDia) => n2(g.itens.filter(esperando).reduce((s, p) => s + n2(p.amount), 0))
  aba('Total', [
    [`Pagamentos com vencimento em ${opts.nomeMes}`],
    [],
    ['Dia', 'Qtd', 'Total', 'Pago', 'A pagar', 'Aguardando RH'],
    ...opts.grupos.map(g => [g.titulo, g.itens.length, g.total, g.pago, n2(g.pendente - somaEsperando(g)), somaEsperando(g)]),
    ['TOTAL DO MÊS', t.qtd, t.total, t.pago, n2(t.pendente - opts.grupos.reduce((s, g) => s + somaEsperando(g), 0)), n2(opts.grupos.reduce((s, g) => s + somaEsperando(g), 0))],
    [],
    ['Cancelados não entram. A 2ª quinzena da consultoria vence no dia 8 do mês seguinte ao trabalhado.'],
    ['"Aguardando RH": ainda falta o RH lançar ou conferir na aba Conferência antes de pagar.'],
  ])

  // ── Detalhado (conferência) ──
  aba('Detalhado', [
    ['Dia de pagamento', 'Vencimento', 'Colaborador', 'CPF', 'Chave PIX', 'Banco / agência / conta', 'Cliente', 'Descrição', 'Categoria', 'Tipo', 'Mês trabalhado', 'Valor', 'Situação'],
    ...opts.grupos.flatMap(g => g.itens.map(p => [
      g.titulo, dataBR(p.due_date), opts.nomePessoa(p),
      opts.dadosBancarios?.(p).cpf || '', opts.dadosBancarios?.(p).pix || '', opts.dadosBancarios?.(p).banco || '',
      opts.nomeCliente(p), p.description || '', p.category || '',
      p.type === 'Real' ? 'Realizado' : p.type === 'Estimativa' ? 'Previsão' : esperando(p) ? 'Aguardando RH' : 'Manual',
      mesCurto(p.reference_month), n2(p.amount), situacao(p),
    ])),
  ])

  // ── Reembolsos ──
  aba('Reembolsos', [
    ['Colaborador', 'Descrição', 'Categoria', 'Valor', 'Situação', 'Pedido em'],
    ...opts.reembolsos.map(e => [
      e.employee?.full_name || '', e.description || '', e.category || '', n2(e.amount),
      e.status === 'pendente' ? 'Para analisar' : e.status === 'recusado' || e.status === 'negado' ? 'Negado' : 'Aprovado',
      e.created_at ? dataBR(String(e.created_at).slice(0, 10)) : '',
    ]),
  ])

  // ── Folha (mês trabalhado) ──
  aba('Folha', [
    [`Folha de ${opts.mesFolha} — a conta de cada vínculo e o que já foi lançado e pago`],
    ['Colaborador', 'Cliente', 'Tipo', 'Dia de pagamento', 'Etapa', 'Valor', 'Lançado', 'Pago', 'Em aberto'],
    ...opts.folha.map(f => [f.pessoa, f.cliente, f.tipo, f.diaPagamento, f.etapa, n2(f.conta), n2(f.lancado), n2(f.pago), n2(f.aberto)]),
  ])

  XLSX.writeFile(wb, `controle_pagamentos_${opts.mes}.xlsx`)
}
