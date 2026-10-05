// Teste do horário de compromissos/reuniões. Rodar todos: npm run testes
// Em 05/10/2026 a reunião cadastrada às 11h saiu às 08h no relatório de
// atividades: o horário é gravado como "hora de parede" (sem fuso) e o
// relatório convertia para Brasília. Estes testes garantem que a hora
// cadastrada é a hora mostrada, venha ela do banco como vier.
import { formatLocalTime, formatLocalDateTime, parseLocal, compromissoNoDia } from './utils'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

console.log('Hora cadastrada = hora mostrada')
for (const vindoDoBanco of ['2026-10-05T11:00:00+00:00', '2026-10-05T11:00:00Z', '2026-10-05T11:00:00', '2026-10-05T11:00', '2026-10-05T11:00:00-03:00', '2026-10-05T11:00:00.000+0000']) {
  ok(formatLocalTime(vindoDoBanco) === '11:00', `11h continua 11:00 (${vindoDoBanco})`, formatLocalTime(vindoDoBanco))
}
ok(formatLocalDateTime('2026-10-05T11:00:00+00:00') === '05/10/2026 11:00', 'data e hora juntas')
ok(formatLocalTime('2026-10-05T23:30:00+00:00') === '23:30', 'fim do dia não vira outro dia')
ok(formatLocalTime('2026-10-06T00:30:00+00:00') === '00:30', 'começo do dia não volta para o dia anterior')

console.log('Dia do compromisso')
ok(parseLocal('2026-10-05T23:30:00+00:00')?.getDate() === 5, '23h30 do dia 5 é dia 5')
ok(compromissoNoDia('2026-10-06T00:30:00+00:00', null, '2026-10-06'), '00h30 do dia 6 é dia 6')
ok(!compromissoNoDia('2026-10-06T00:30:00+00:00', null, '2026-10-05'), '00h30 do dia 6 não aparece no dia 5')
ok(formatLocalTime(null) === '-' && parseLocal('') === null, 'vazio não quebra')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) de horário falharam`)
