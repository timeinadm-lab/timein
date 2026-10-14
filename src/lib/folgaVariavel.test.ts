import { diasPorSemana, segundaDa, trabalhadosNaSemana, semanasCurtas } from './folgaVariavel'

let falhas = 0
const ok = (c: boolean, msg: string) => { if (!c) { falhas++; console.error('✗ ' + msg) } }

ok(diasPorSemana('6x1') === 6 && diasPorSemana('5x2') === 5 && diasPorSemana('12x36') === null, 'dias por semana')
ok(segundaDa('2026-10-14') === '2026-10-12' && segundaDa('2026-10-18') === '2026-10-12' && segundaDa('2026-10-12') === '2026-10-12', 'segunda da semana')

// 6 dias já feitos na semana de 12/10 → o domingo 18 é o 7º
const semana = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']
ok(trabalhadosNaSemana('2026-10-18', semana) === 6, '7º dia conta 6 antes')
ok(trabalhadosNaSemana('2026-10-14', semana) === 5, 'o próprio dia não conta')
ok(trabalhadosNaSemana('2026-10-19', semana) === 0, 'semana seguinte zera')

// Outubro/2026, folha desde 01/10 (quinta), hoje 14/10 → ontem 13
{
  const r = semanasCurtas({ de: '2026-10-01', fim: '2026-10-31', ontem: '2026-10-13', porSemana: 6, registrados: [] })
  // 01–04 (4 dias, meta 3) e 05–11 (meta 6); a semana de 12 ainda está aberta
  ok(r.length === 2, 'duas semanas fechadas')
  ok(r[0].inicio === '2026-10-01' && r[0].meta === 3 && r[0].semRegistro.length === 4, 'semana cortada proporcional')
  ok(r[1].inicio === '2026-10-05' && r[1].fim === '2026-10-11' && r[1].meta === 6, 'semana cheia')
}
{
  // 6 de 7 dias registrados: folga num dia qualquer → semana completa
  const reg = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-09', '2026-10-10', '2026-10-11']
  const r = semanasCurtas({ de: '2026-10-05', fim: '2026-10-31', ontem: '2026-10-13', porSemana: 6, registrados: reg })
  ok(r.length === 0, 'folga variável não pendura')
}
{
  // Fim do mês no meio da semana fecha a semana cortada
  const r = semanasCurtas({ de: '2026-09-28', fim: '2026-09-30', ontem: '2026-10-13', porSemana: 6, registrados: [] })
  ok(r.length === 1 && r[0].meta === 3 && r[0].fim === '2026-09-30', 'semana cortada no fim do mês')
}

if (falhas) throw new Error(`${falhas} falha(s) em folgaVariavel`)
console.log('✓ folgaVariavel')
