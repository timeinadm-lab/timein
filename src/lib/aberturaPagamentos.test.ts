import { abrirPagamentos, ajudaMensalNoMes } from './aberturaPagamentos'
import type { PagamentoBase, VinculoBase, GastoBase } from './aberturaPagamentos'

let falhas = 0
const ok = (c: boolean, msg: string) => { if (!c) { falhas++; console.error('✗ ' + msg) } }
const fecha = (m: Map<string, { salario: number; ajuda: number; reembolso: number; adiantamento: number }>, ps: PagamentoBase[]) =>
  ps.every(p => { const a = m.get(p.id)!; return Math.abs(a.salario + a.ajuda + a.reembolso - a.adiantamento - Number(p.amount)) < 0.005 })

const pag = (id: string, amount: number, due: string, extra: Partial<PagamentoBase> = {}): PagamentoBase =>
  ({ id, amount, due_date: due, employee_id: 'E', link_id: 'L', client_id: 'C', reference_month: '2026-10', type: 'Estimativa', ...extra })
const vinc = (porVisita: boolean, ajudaMensal: number) => new Map<string, VinculoBase>([['L', { id: 'L', client_id: 'C', porVisita, ajudaMensal }]])
function gasto(amount: number, category = 'Reembolso', extra: Partial<GastoBase> = {}): GastoBase {
  return { employee_id: 'E', client_id: 'C', reference_month: '2026-10', category, amount, description: 'Uber', ...extra }
}

// Fixo, um dia: 3000 salário + 300 ajuda + 50 reembolso = 3350
{
  const ps = [pag('p', 3350, '2026-10-20')]
  const m = abrirPagamentos(ps, vinc(false, 300), [gasto(50)])
  const a = m.get('p')!
  ok(a.salario === 3000 && a.ajuda === 300 && a.reembolso === 50, 'fixo um dia: abre salário, ajuda e reembolso')
  ok(a.reembolsos[0] === 'Uber', 'descrição do reembolso')
  ok(fecha(m, ps), 'fixo um dia fecha')
}
// Fixo, dois dias (metade em cada): extras divididos
{
  const ps = [pag('a', 1675, '2026-10-08'), pag('b', 1675, '2026-10-20')]
  const m = abrirPagamentos(ps, vinc(false, 300), [gasto(50)])
  ok(m.get('a')!.ajuda === 150 && m.get('b')!.reembolso === 25, 'fixo dois dias: metade dos extras em cada')
  ok(fecha(m, ps), 'fixo dois dias fecha')
}
// Consultoria por visita: extras só no último (dia 8 do mês seguinte)
{
  const ps = [pag('q1', 800, '2026-10-20'), pag('q2', 1000, '2026-11-08')]
  const m = abrirPagamentos(ps, vinc(true, 200), [gasto(40), gasto(100, 'Adiantamento')])
  ok(m.get('q1')!.ajuda === 0 && m.get('q1')!.salario === 800, 'consultoria: 1ª quinzena só visitas')
  const b = m.get('q2')!
  ok(b.ajuda === 200 && b.reembolso === 40 && b.adiantamento === 100 && b.salario === 860, 'consultoria: extras e adiantamento na 2ª')
  ok(fecha(m, ps), 'consultoria fecha')
}
// Lançamento manual não é aberto
{
  const ps = [pag('m', 500, '2026-10-15', { type: 'Manual' })]
  const m = abrirPagamentos(ps, vinc(false, 300), [gasto(50)])
  ok(m.get('m')!.salario === 500 && m.get('m')!.ajuda === 0, 'manual: inteiro em salário')
}
// Sem vínculo: inteiro
{
  const ps = [pag('x', 99.9, '2026-10-15', { link_id: null })]
  ok(abrirPagamentos(ps, vinc(false, 0), []).get('x')!.salario === 99.9, 'sem vínculo: inteiro')
}
// Gasto de outro cliente não entra; gasto sem cliente vai para o 1º vínculo
{
  const ps = [pag('p', 1000, '2026-10-20')]
  const m = abrirPagamentos(ps, vinc(false, 0), [gasto(70, 'Reembolso', { client_id: 'OUTRO' }), gasto(30, 'Reembolso', { client_id: null })])
  ok(m.get('p')!.reembolso === 30, 'só o gasto do cliente certo (ou sem cliente)')
}
// Extras maiores que o lançamento: nunca salário negativo, e fecha
{
  const ps = [pag('p', 100, '2026-10-20')]
  const m = abrirPagamentos(ps, vinc(false, 300), [])
  ok(m.get('p')!.salario >= 0 && fecha(m, ps), 'extras maiores que o valor: fecha sem negativo')
}
// Ajuda mensal proporcional quando encerra no mês; semanal não entra
ok(ajudaMensalNoMes({ cost_assistance: 300, contract_end_date: '2026-10-15' }, '2026-10') === 150, 'ajuda proporcional ao encerrar')
ok(ajudaMensalNoMes({ cost_assistance: 675, cost_assistance_periodo: 'semana' }, '2026-10') === 0, 'ajuda semanal fora')

if (falhas) throw new Error(`${falhas} teste(s) falharam`)
console.log('aberturaPagamentos: tudo certo')
