// Testes da equipe (período e caixa). Rodar todos: npm run testes
import { periodoDe, andarPeriodo, saldoDoCaixa, textoDoSaldo, minutosDaVisita, horasTexto, situacaoDaVisitaEquipe, tipoDaVisita, ROTULO_TIPO_VISITA, ehPaga, gradeDoMes, mesDoPeriodo } from './equipe'
import type { LancamentoCaixa } from './equipe'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

console.log('Período')
{
  const s = periodoDe('semana', '2026-10-01')           // quinta-feira
  ok(s.ini === '2026-09-28' && s.fim === '2026-10-04', 'semana de segunda 28/09 a domingo 04/10', s)
  ok(periodoDe('semana', '2026-10-04').ini === '2026-09-28', 'domingo fica na semana que começou na segunda')
  ok(periodoDe('semana', '2026-10-05').ini === '2026-10-05', 'segunda começa semana nova')
  ok(andarPeriodo(s, 1).ini === '2026-10-05' && andarPeriodo(s, -1).ini === '2026-09-21', 'semana seguinte e anterior')
  ok(s.rotulo === 'semana de 28/09 a 04/10/2026', 'rótulo da semana', s.rotulo)
}
{
  const m = periodoDe('mes', '2026-02-10')
  ok(m.ini === '2026-02-01' && m.fim === '2026-02-28', 'fevereiro/2026 termina dia 28', m)
  ok(periodoDe('mes', '2028-02-10').fim === '2028-02-29', 'fevereiro bissexto')
  ok(andarPeriodo(periodoDe('mes', '2026-12-05'), 1).ini === '2027-01-01', 'virada de ano')
  ok(m.rotulo === 'fevereiro de 2026', 'rótulo do mês', m.rotulo)
}

console.log('Caixa')
const L = (id: string, tipo: LancamentoCaixa['tipo'], data: string, valor: number): LancamentoCaixa =>
  ({ id, user_id: 'u', tipo, data, valor, descricao: id })
const caixa = [
  L('r1', 'recebido', '2026-09-29', 3000),
  L('c1', 'compra', '2026-09-30', 1250.4),
  L('c2', 'compra', '2026-10-02', 1329.6),
  L('d1', 'devolvido', '2026-10-06', 420),
]
{
  const s = saldoDoCaixa(caixa, '2026-10-04')
  ok(s.recebido === 3000 && s.gasto === 2580 && s.devolvido === 0 && s.saldo === 420, 'até domingo 04/10: recebeu 3000, gastou 2580, está com 420', s)
  ok(saldoDoCaixa(caixa).saldo === 0, 'depois de devolver os 420: caixa zerado')
  const semana = saldoDoCaixa(caixa, '2026-10-04', '2026-09-28')
  ok(semana.gasto === 2580, 'movimento da semana: 2580 em compras', semana)
  ok(saldoDoCaixa([L('c', 'compra', '2026-10-01', 80)]).saldo === -80, 'gastou do bolso sem receber: saldo -80')
}
{
  const brl = (v: number) => `R$ ${v.toFixed(2)}`
  ok(textoDoSaldo(420, brl).startsWith('Com ela: R$ 420.00'), 'saldo positivo: está com ela')
  ok(textoDoSaldo(-80, brl).startsWith('A receber: R$ 80.00'), 'saldo negativo: a receber')
  ok(textoDoSaldo(0, brl) === 'Caixa zerado', 'zerado')
}

console.log('Visitas da equipe (paga e não paga)')
{
  const hoje = '2026-10-19'
  ok(minutosDaVisita('08:00', '10:30') === 150 && horasTexto(150) === '2h30' && horasTexto(120) === '2h', 'entrada 08:00, saída 10:30 = 2h30')
  ok(minutosDaVisita('22:00:00', '01:00:00') === 180, 'passou da meia-noite soma 24h')
  ok(minutosDaVisita('08:00', null) === null, 'sem saída: sem horas')
  const naoPaga = { data: '2026-10-15', entrada: '09:00', saida: '12:00', paga: false, status: 'registrada', tipo: 'vistoria' }
  ok(situacaoDaVisitaEquipe(naoPaga, hoje) === 'realizada', 'não paga com horário: realizada')
  ok(situacaoDaVisitaEquipe({ ...naoPaga, entrada: null, saida: null }, hoje) === 'sem_horario', 'não paga sem horário: falta o horário')
  ok(situacaoDaVisitaEquipe({ ...naoPaga, data: '2026-10-22', entrada: null, saida: null }, hoje) === 'programada', 'não paga no futuro: programada')
  ok(situacaoDaVisitaEquipe({ data: '2026-10-15', status: 'pendente' }, hoje) === 'pendente', 'sem a 099 (sem "paga"): é paga e aguarda aprovação')
  ok(situacaoDaVisitaEquipe({ data: '2026-10-25', status: 'pendente', paga: true }, hoje) === 'programada', 'paga no futuro: programada')
  ok(situacaoDaVisitaEquipe({ data: '2026-10-10', status: 'aprovada', paga: true }, hoje) === 'aprovada', 'paga aprovada')
  ok(tipoDaVisita({ tipo: 'supervisao' }) === 'supervisao' && tipoDaVisita({}) === 'visita' && ROTULO_TIPO_VISITA.vistoria === 'Vistoria', 'tipo e rótulo')
  ok(ehPaga({}) && !ehPaga({ paga: false }), 'sem o campo, conta como paga')
}
console.log('Calendário do mês')
{
  const g = gradeDoMes('2026-10')                      // 01/10/2026 é quinta
  ok(g.ini === '2026-09-28' && g.fim === '2026-11-01' && g.dias.length === 35, 'outubro/2026: de segunda 28/09 a domingo 01/11 (5 semanas)', g)
  ok(gradeDoMes('2027-02').dias.length === 28, 'fevereiro/2027 começa na segunda e cabe em 4 semanas')
  ok(gradeDoMes('2026-02').ini === '2026-01-26' && gradeDoMes('2026-02').dias.length === 35, 'fevereiro/2026 começa no domingo: a grade pega a segunda 26/01')
  ok(mesDoPeriodo(periodoDe('semana', '2026-09-30')) === '2026-10', 'semana de 28/09 a 04/10 mostra outubro (a quinta é 01/10)')
  ok(mesDoPeriodo(periodoDe('mes', '2026-11-10')) === '2026-11', 'mês mostra o próprio mês')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
