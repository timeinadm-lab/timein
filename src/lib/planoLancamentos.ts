// ============================================================
// Plano de lançamentos de um vínculo no mês — a MESMA conta para gerar o
// lançamento e para mantê-lo certo depois de uma edição.
//
// Pedido do Gabriel (01/10/2026): vínculo, salário, ajuda de custo e dia de
// pagamento são editados toda hora; o que ainda NÃO foi pago tem que
// acompanhar o valor novo. O que já foi pago não muda. O que o RH ajustou à
// mão ("Ajustar lançamento") também não é mexido.
//
// Regras (memória de pagamento):
//   · Consultoria por visita: 1ª quinzena (visitas 1–15) vence dia 20 do mês;
//     2ª quinzena (16–fim) vence dia 8 do mês seguinte. Gastos, ajuda de custo
//     e extras entram no último lançamento do mês.
//   · Fixo / salário: um lançamento no dia do contrato; com dois dias marcados,
//     metade em cada (as duas somam o total exato).
//   · Fechamento pelo realizado (Real): um lançamento com o que falta pagar.
// Sem banco e sem React: testado em planoLancamentos.test.ts.
// ============================================================

export type BasePlano = {
  mes: string               // mês trabalhado (yyyy-MM)
  porVisita: boolean        // consultoria por visita (não é salário)
  q1: number                // consultoria: soma das visitas do dia 1 ao 15
  q2: number                // consultoria: soma das visitas do dia 16 ao fim
  extras: number            // gastos/reembolsos − adiantamento + ajuda de custo + extras aprovados + multa
  previsto: number          // fixo/salário: valor do mês (já proporcional)
  realizado: number         // fixo/salário: valor pelo realizado (faltas descontadas)
  diasPagamento: number[]   // dias marcados no vínculo (8, 15, 20)
  diaPadrao: number         // dia usado quando não há dia marcado
}

export type ItemPlano = { vencimento: string; valor: number; parte: '1ª quinzena' | '2ª quinzena' | 'mês' }

const r2 = (n: number) => Math.round(n * 100) / 100
const dia = (mes: string, d: number) => `${mes}-${String(d).padStart(2, '0')}`
export const mesSeguinte = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** A previsão do mês (o que o botão Lançar cria) */
export function planoDaPrevisao(b: BasePlano): ItemPlano[] {
  if (b.porVisita) {
    const extrasNaSegunda = b.q2 > 0 || b.q1 <= 0
    const itens: ItemPlano[] = []
    if (b.q1 > 0 || (!extrasNaSegunda && b.extras > 0)) {
      itens.push({ vencimento: dia(b.mes, 20), valor: Math.max(0, r2(b.q1 + (extrasNaSegunda ? 0 : b.extras))), parte: '1ª quinzena' })
    }
    if (b.q2 > 0 || (extrasNaSegunda && b.extras > 0)) {
      itens.push({ vencimento: dia(mesSeguinte(b.mes), 8), valor: Math.max(0, r2(b.q2 + (extrasNaSegunda ? b.extras : 0))), parte: '2ª quinzena' })
    }
    return itens
  }
  const total = Math.max(0, r2(b.previsto + b.extras))
  const dias = [...new Set(b.diasPagamento)].sort((x, y) => x - y)
  if (dias.length >= 2) {
    const metade = r2(total / 2)
    return [
      { vencimento: dia(b.mes, dias[0]), valor: r2(total - metade), parte: '1ª quinzena' },
      { vencimento: dia(b.mes, dias[1]), valor: metade, parte: '2ª quinzena' },
    ]
  }
  return [{ vencimento: dia(b.mes, dias[0] || b.diaPadrao), valor: total, parte: 'mês' }]
}

/** O fechamento pelo realizado: o que falta pagar, descontado o que já foi pago no mês */
export function valorDoFechamento(b: BasePlano, jaPago: number): number {
  return Math.max(0, r2(b.realizado + b.extras - jaPago))
}

export type LancamentoExistente = {
  id: string
  due_date: string
  amount: number | string | null
  status: string            // Pendente | Pago (cancelado não entra)
  type?: string | null      // Estimativa | Real | Manual
  ajuste_manual?: boolean | null
  created_at?: string | null
}
export type Correcao = { id: string; de: number; para: number; vencimentoDe: string; vencimentoPara: string }

const valor = (p: LancamentoExistente) => Number(p.amount) || 0
const igual = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * O que precisa mudar nos lançamentos PENDENTES de um vínculo para ficarem
 * iguais à conta de hoje. Devolve [] quando não é seguro mexer sozinho:
 *   · algum lançamento ajustado à mão (ou criado à mão);
 *   · a estrutura mudou (outro número de lançamentos) — o aviso da linha fica;
 *   · algo já pago não bate com a conta (mudou depois de pagar).
 */
export function correcoesDoVinculo(b: BasePlano, existentes: LancamentoExistente[]): Correcao[] {
  const ativos = existentes.filter(p => p.status !== 'Cancelado')
  if (!ativos.length) return []
  if (ativos.some(p => p.ajuste_manual || p.type === 'Manual')) return []
  const pendentes = ativos.filter(p => p.status === 'Pendente')
  if (!pendentes.length) return []

  const real = ativos.filter(p => p.type === 'Real')
  if (real.length) {
    // Fechamento: só o Real pendente acompanha; o resto do mês tem que estar pago
    if (real.length !== 1 || real[0].status !== 'Pendente') return []
    if (ativos.some(p => p.id !== real[0].id && p.status !== 'Pago')) return []
    const jaPago = ativos.filter(p => p.id !== real[0].id).reduce((s, p) => s + valor(p), 0)
    const para = valorDoFechamento(b, jaPago)
    return igual(valor(real[0]), para) ? [] : [{ id: real[0].id, de: valor(real[0]), para, vencimentoDe: real[0].due_date, vencimentoPara: real[0].due_date }]
  }

  const plano = planoDaPrevisao(b)
  if (plano.length !== ativos.length) return []
  const ordenados = [...ativos].sort((x, y) => x.due_date.localeCompare(y.due_date))
  const temPago = ativos.some(p => p.status === 'Pago')
  const out: Correcao[] = []
  for (let i = 0; i < plano.length; i++) {
    const p = ordenados[i], item = plano[i]
    // Com algo já pago, os vencimentos têm que ser os mesmos; sem nada pago, o dia pode mudar junto
    if (temPago && p.due_date !== item.vencimento) return []
    if (p.status === 'Pago') {
      if (!igual(valor(p), item.valor)) return []
      continue
    }
    if (!igual(valor(p), item.valor) || p.due_date !== item.vencimento) {
      out.push({ id: p.id, de: valor(p), para: item.valor, vencimentoDe: p.due_date, vencimentoPara: item.vencimento })
    }
  }
  return out
}
