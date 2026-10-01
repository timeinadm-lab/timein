// ============================================================
// Relatório do mês de pagamentos (Excel) — pedido do Gabriel, 30/09/2026.
// Quatro abas:
//   Resumo       · Dia 8 / 15 / 20 / Avulsos com total, pago, falta e atraso;
//                  e o mesmo total aberto por categoria e por situação
//   Saídas       · cada lançamento com vencimento no mês
//   Reembolsos   · pedidos do mês (aprovado, pendente, negado)
//   Folha        · cada vínculo do mês trabalhado: a conta, o lançado e o pago
// ============================================================
import type { GrupoDia, Lancamento } from './pagamentosPorDia'
import { totaisDoMes, mesCurto } from './pagamentosPorDia'

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
    const cab = (linhas.find(l => l.some(x => x === 'Qtd' || x === 'Valor' || x === 'Total')) || []) as unknown[]
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

  // ── Resumo ──
  const t = totaisDoMes(opts.grupos)
  const todos = opts.grupos.flatMap(g => g.itens)
  const somaPor = (chave: (p: Lancamento) => string) => {
    const m = new Map<string, { qtd: number; total: number }>()
    for (const p of todos) {
      const k = chave(p) || '—'
      const x = m.get(k) || { qtd: 0, total: 0 }
      x.qtd++; x.total = n2(x.total + n2(p.amount)); m.set(k, x)
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total)
  }
  const resumo: unknown[][] = [
    [`Saídas com vencimento em ${opts.nomeMes}`],
    [`Gerado em ${new Date().toLocaleString('pt-BR')}`],
    [],
    ['Dia de pagamento', 'Qtd', 'Total', 'Pago', 'Falta pagar', 'Atrasado'],
    ...opts.grupos.map(g => [g.titulo, g.itens.length, g.total, g.pago, g.pendente, g.atrasado]),
    ['TOTAL DO MÊS', t.qtd, t.total, t.pago, t.pendente, t.atrasado],
    [],
    ['Por categoria', 'Qtd', 'Total'],
    ...somaPor(p => p.category || 'Outro').map(([k, v]) => [k, v.qtd, v.total]),
    [],
    ['Por situação', 'Qtd', 'Total'],
    ...somaPor(p => p.status).map(([k, v]) => [k, v.qtd, v.total]),
    [],
    ['Por tipo de lançamento', 'Qtd', 'Total'],
    ...somaPor(p => p.type === 'Real' ? 'Fechado pelo realizado' : p.type === 'Estimativa' ? 'Previsão' : 'Manual').map(([k, v]) => [k, v.qtd, v.total]),
    [],
    ['Cancelados não entram. A 2ª quinzena da consultoria vence no dia 8 do mês seguinte ao trabalhado.'],
  ]
  aba('Resumo', resumo)

  // ── Saídas ──
  aba('Saídas', [
    ['Dia de pagamento', 'Vencimento', 'Colaborador', 'CPF', 'Chave PIX', 'Banco / agência / conta', 'Cliente', 'Descrição', 'Categoria', 'Tipo', 'Mês trabalhado', 'Valor', 'Situação', 'Pago em'],
    ...opts.grupos.flatMap(g => g.itens.map(p => [
      g.titulo, dataBR(p.due_date), opts.nomePessoa(p),
      opts.dadosBancarios?.(p).cpf || '', opts.dadosBancarios?.(p).pix || '', opts.dadosBancarios?.(p).banco || '',
      opts.nomeCliente(p), p.description || '', p.category || '',
      p.type === 'Real' ? 'Realizado' : p.type === 'Estimativa' ? 'Previsão' : 'Manual',
      mesCurto(p.reference_month), n2(p.amount), p.status, p.paid_at ? dataBR(String(p.paid_at).slice(0, 10)) : '',
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

  XLSX.writeFile(wb, `relatorio_pagamentos_${opts.mes}.xlsx`)
}
