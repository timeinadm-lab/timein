// Testes da aba Planilhas (dia de pagamento dos extras e resumo da folha de ponto). Rodar todos: npm run testes
import { pagamentoDoExtra, pagamentoDoMes, textoPagamento, textoDia, resumoDoPonto, diasDoVinculo, correcoesDoMes, pagamentosPorDiaPessoa } from './planilhas'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

const consultoria = { service_type: 'Consultoria', pay_mode: null, payment_dates: [] }
const consultSalario = { service_type: 'Consultoria', pay_mode: 'salario_fixo', payment_dates: [{ day_of_month: 15 }] }
const fixo = { service_type: 'Fixo', pay_mode: 'mensal', payment_dates: [{ day_of_month: 20 }] }
const fixoDois = { service_type: 'Fixo', pay_mode: 'mensal', payment_dates: [{ day_of_month: 20 }, { day_of_month: 8 }] }
const semDia = { service_type: 'Fixo', pay_mode: 'mensal', payment_dates: [] }

console.log('Dia de pagamento do extra')
ok(pagamentoDoExtra(consultoria, '2026-10', 'visita', '2026-10-10').join() === '2026-10-20', 'visita extra da 1ª quinzena: dia 20')
ok(pagamentoDoExtra(consultoria, '2026-10', 'visita', '2026-10-16').join() === '2026-11-08', 'visita extra da 2ª quinzena: dia 8 do mês seguinte')
ok(pagamentoDoExtra(consultoria, '2026-12', 'visita', '2026-12-28').join() === '2027-01-08', 'dezembro vira janeiro')
ok(pagamentoDoExtra(consultoria, '2026-10', 'horas', '2026-10-03').join() === '2026-11-08', 'hora acima entra no último lançamento: dia 8 seguinte')
ok(pagamentoDoExtra(fixo, '2026-10', 'dia', '2026-10-03').join() === '2026-10-20', 'fixo: dia do vínculo')
ok(pagamentoDoExtra(consultSalario, '2026-10', 'horas').join() === '2026-10-15', 'consultoria com salário: dia do vínculo')
ok(pagamentoDoExtra(fixoDois, '2026-10', 'dia').join() === '2026-10-08,2026-10-20', 'fixo com dois dias: os dois, em ordem')
ok(pagamentoDoExtra(semDia, '2026-10', 'dia').length === 0, 'sem dia marcado: vazio')
ok(diasDoVinculo({ payment_dates: [{ day_of_month: 5 }, { day_of_month: 15 }] }).join() === '15', 'só 8, 15 e 20 contam')

console.log('Dia de pagamento do mês (folha de ponto)')
ok(pagamentoDoMes(consultoria, '2026-10', [{ visit_date: '2026-10-05' }, { visit_date: '2026-10-22' }]).join() === '2026-10-20,2026-11-08', 'consultoria nas duas quinzenas: 20 e 8')
ok(pagamentoDoMes(consultoria, '2026-10', [{ visit_date: '2026-10-05' }]).join() === '2026-10-20', 'só 1ª quinzena: dia 20')
ok(pagamentoDoMes(consultoria, '2026-10', [{ visit_date: '2026-10-25' }]).join() === '2026-11-08', 'só 2ª quinzena: dia 8')
ok(pagamentoDoMes(fixo, '2026-10', []).join() === '2026-10-20', 'fixo: dia do vínculo')
ok(textoPagamento(['2026-10-20', '2026-11-08']) === '20/10 e 08/11', 'texto com mês')
ok(textoPagamento([]) === 'Sem dia marcado no vínculo', 'texto sem dia')
ok(textoDia(['2026-10-08', '2026-10-20']) === 'Dia 8 e 20', 'texto só do dia')

console.log('Resumo da folha de ponto')
const r = resumoDoPonto([
  { visit_date: '2026-10-01', check_in: '08:00', check_out: '17:00' },
  { visit_date: '2026-10-02', check_in: '08:00', check_out: '12:00', break_start: null, break_end: null, report_url: 'x.pdf' },
  { visit_date: '2026-10-05', is_unavailable: true },
  { visit_date: '2026-10-06', is_holiday: true },
  { visit_date: '2026-10-07', check_in: '08:00', check_out: null, is_extra: true },
], 60, true)
ok(r.diasTrabalhados === 2 && r.faltas === 1 && r.folgas === 1 && r.extras === 1, 'contagens (extra não soma nos dias)', r)
ok(r.minutos === 8 * 60 + 3 * 60, 'horas descontam o intervalo do vínculo (sem saída = 0)', r.minutos)
ok(r.semSaida === 1 && r.semRelatorio === 2, 'sem saída e sem relatório', r)
ok(r.primeiro === '2026-10-01' && r.ultimo === '2026-10-07', 'primeiro e último registro', r)

console.log('Correção e pagamentos por dia')
{
  const pessoas = [{ id: 'a', nome: 'Ana', vinculos: 1, registros: 5 }, { id: 'b', nome: 'Bia', vinculos: 1, registros: 0 }, { id: 'c', nome: 'Caio', vinculos: 1, registros: 2 }, { id: 'd', nome: 'Duda', vinculos: 1, registros: 3 }]
  const lanc = [
    { id: '1', employee_id: 'a', amount: 3000, due_date: '2026-10-20', status: 'Pendente' },
    { id: '2', employee_id: 'c', amount: 60, due_date: '2026-10-08', status: 'Pago' },
    { id: '3', employee_id: 'd', amount: 500, due_date: '2026-10-15', status: 'Cancelado' },
    { id: '4', employee_id: 'a', amount: 200, due_date: '2026-10-08', status: 'Pago' },
  ]
  const c = correcoesDoMes(pessoas, lanc)
  ok(c.map(x => x.pessoa.nome + ':' + x.motivo).join() === 'Bia:sem_pagamento,Duda:sem_pagamento,Caio:menos_100', 'sem pagamento (cancelado não conta) e menos de 100', c.map(x => x.pessoa.nome + ':' + x.motivo))
  const d = pagamentosPorDiaPessoa(lanc)
  ok(d.map(g => g.dia + '=' + g.total).join() === 'Dia 8=260,Dia 20=3000', 'agrupa por dia, sem cancelado', d.map(g => g.dia + '=' + g.total))
  ok(d[0].pago === 260 && d[0].linhas.length === 2, 'pago e uma linha por pessoa')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
