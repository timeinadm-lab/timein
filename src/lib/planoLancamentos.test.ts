// Testes do plano de lançamentos. Rodar todos: npm run testes
import { planoDaPrevisao, valorDoFechamento, correcoesDoVinculo, mesSeguinte } from './planoLancamentos'
import type { BasePlano, LancamentoExistente } from './planoLancamentos'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}
const base = (x: Partial<BasePlano>): BasePlano => ({ mes: '2026-10', porVisita: false, q1: 0, q2: 0, extras: 0, previsto: 0, realizado: 0, diasPagamento: [], diaPadrao: 5, ...x })
const L = (id: string, due: string, amount: number, status = 'Pendente', x: Partial<LancamentoExistente> = {}): LancamentoExistente =>
  ({ id, due_date: due, amount, status, type: 'Estimativa', ...x })

console.log('Previsão')
ok(mesSeguinte('2026-12') === '2027-01' && mesSeguinte('2026-09') === '2026-10', 'mês seguinte (virada de ano)')
{
  const p = planoDaPrevisao(base({ porVisita: true, q1: 300, q2: 450, extras: 50 }))
  ok(p.length === 2 && p[0].vencimento === '2026-10-20' && p[0].valor === 300, 'consultoria: 1ª quinzena dia 20 só com visitas', p)
  ok(p[1].vencimento === '2026-11-08' && p[1].valor === 500, 'consultoria: 2ª quinzena dia 8 do mês seguinte + extras', p)
}
{
  const p = planoDaPrevisao(base({ porVisita: true, q1: 300, q2: 0, extras: 50 }))
  ok(p.length === 1 && p[0].valor === 350 && p[0].vencimento === '2026-10-20', 'sem 2ª quinzena: extras vão na 1ª', p)
}
ok(planoDaPrevisao(base({ porVisita: true })).length === 0, 'consultoria sem visita e sem extra: nada a lançar')
{
  const p = planoDaPrevisao(base({ previsto: 3000, extras: 200, diasPagamento: [8] }))
  ok(p.length === 1 && p[0].valor === 3200 && p[0].vencimento === '2026-10-08', 'fixo: salário + extras no dia 8', p)
}
{
  const p = planoDaPrevisao(base({ previsto: 3000.01, diasPagamento: [20, 8] }))
  ok(p.length === 2 && p[0].vencimento === '2026-10-08' && p[1].vencimento === '2026-10-20', 'dois dias: ordem 8 e 20', p)
  ok(Math.round((p[0].valor + p[1].valor) * 100) === 300001, 'as duas parcelas somam o total, sem perder centavo', p)
}
ok(planoDaPrevisao(base({ previsto: 1000 }))[0].vencimento === '2026-10-05', 'sem dia marcado: usa o dia padrão')
ok(planoDaPrevisao(base({ previsto: 100, extras: -300, diasPagamento: [8] }))[0].valor === 0, 'adiantamento maior que o salário não fica negativo')
ok(valorDoFechamento(base({ realizado: 2800, extras: 100 }), 1000) === 1900, 'fechamento: realizado + extras − já pago')

console.log('Correção automática (salário editado antes de pagar)')
{
  // Salário era 3000, mudou para 3500: a previsão pendente acompanha
  const c = correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('p1', '2026-10-08', 3000)])
  ok(c.length === 1 && c[0].para === 3500 && c[0].de === 3000, 'previsão pendente vai para 3500', c)
}
ok(correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('p1', '2026-10-08', 3500)]).length === 0, 'já igual: nada a fazer')
ok(correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('p1', '2026-10-08', 3000, 'Pago')]).length === 0, 'já pago: nunca muda')
ok(correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('p1', '2026-10-08', 3000, 'Pendente', { ajuste_manual: true })]).length === 0, 'ajustado à mão: não mexe')
ok(correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('p1', '2026-10-08', 3000, 'Pendente', { type: 'Manual' })]).length === 0, 'criado à mão: não mexe')
ok(correcoesDoVinculo(base({ previsto: 3500, diasPagamento: [8] }), [L('c1', '2026-10-08', 3000, 'Cancelado')]).length === 0, 'só cancelado: nada a fazer')
{
  // Dia de pagamento mudou de 8 para 15, nada pago: o vencimento acompanha
  const c = correcoesDoVinculo(base({ previsto: 3000, diasPagamento: [15] }), [L('p1', '2026-10-08', 3000)])
  ok(c.length === 1 && c[0].vencimentoPara === '2026-10-15' && c[0].para === 3000, 'dia 8 → 15 sem pagamento: muda o vencimento', c)
}
{
  // Passou a ter dois dias de pagamento: estrutura mudou, não mexe sozinho
  ok(correcoesDoVinculo(base({ previsto: 3000, diasPagamento: [8, 20] }), [L('p1', '2026-10-08', 3000)]).length === 0, 'virou duas parcelas: fica o aviso, não mexe')
}
{
  // Consultoria: 1ª quinzena paga, visita nova na 2ª → só a 2ª muda
  const b = base({ porVisita: true, q1: 300, q2: 600 })
  const c = correcoesDoVinculo(b, [L('q1', '2026-10-20', 300, 'Pago'), L('q2', '2026-11-08', 450)])
  ok(c.length === 1 && c[0].id === 'q2' && c[0].para === 600, '2ª quinzena acompanha as visitas novas', c)
}
{
  // Consultoria: visita entrou na 1ª quinzena depois de paga → não bate, não mexe
  const b = base({ porVisita: true, q1: 450, q2: 600 })
  ok(correcoesDoVinculo(b, [L('q1', '2026-10-20', 300, 'Pago'), L('q2', '2026-11-08', 450)]).length === 0, '1ª paga com valor diferente: fica o aviso')
}
{
  // Consultoria com só a 1ª lançada e visitas na 2ª: falta lançar (botão próprio), não mexe aqui
  ok(correcoesDoVinculo(base({ porVisita: true, q1: 300, q2: 200 }), [L('q1', '2026-10-20', 300)]).length === 0, '2ª quinzena ainda não lançada: não cria sozinho')
}
{
  // Fechamento pendente acompanha (ex.: falta registrada depois)
  const c = correcoesDoVinculo(base({ previsto: 3000, realizado: 2900, diasPagamento: [8] }), [L('r1', '2026-10-08', 3000, 'Pendente', { type: 'Real' })])
  ok(c.length === 1 && c[0].para === 2900, 'fechamento pendente vai para 2900', c)
  const c2 = correcoesDoVinculo(base({ previsto: 3000, realizado: 2900, diasPagamento: [8] }), [
    L('e1', '2026-10-08', 1000, 'Pago'), L('r1', '2026-10-08', 2000, 'Pendente', { type: 'Real' })])
  ok(c2.length === 1 && c2[0].para === 1900, 'fechamento desconta o que a previsão já pagou', c2)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
