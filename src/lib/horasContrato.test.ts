// Testes das horas do contrato do consultor fixo. Rodar todos: npm run testes
import { semanasDoContrato, totalDoContrato } from './horasContrato'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}
const vs = [
  { id: 'l1', client_id: 'A', contrato_horas_semana: 10, horas_semana: 4 },
  { id: 'l2', client_id: 'B', horas_semana: null },
]
const regs = [
  { client_id: 'A', visit_date: '2026-10-05', check_in: '08:00', check_out: '12:00' },          // seg da semana 05–11: 4h
  { client_id: 'B', visit_date: '2026-10-07', check_in: '08:00', check_out: '14:00' },          // 6h
  { client_id: 'B', visit_date: '2026-10-13', check_in: '08:00', check_out: '10:00' },          // semana 12–18: 2h
  { client_id: 'C', visit_date: '2026-10-13', check_in: '08:00', check_out: '18:00' },          // cliente fora do contrato
  { client_id: 'A', visit_date: '2026-10-14', is_unavailable: true },                           // falta não conta
]
ok(totalDoContrato(vs) === 10, 'total do contrato vem do principal')
const s = semanasDoContrato(vs, regs, '2026-10', '2026-10-16')
ok(s[0].ini === '2026-09-28' && s[s.length - 1].fim === '2026-11-01' && s.length === 5, 'semanas seg→dom que tocam outubro', s.map(x => x.ini))
const s2 = s[1]
ok(s2.ini === '2026-10-05' && s2.feitoMin === 600 && s2.status === 'cumpriu', 'semana 05–11: 10h de 10h, cumpriu', s2)
ok(s2.porCliente[0].metaMin === 240 && s2.porCliente[0].feitoMin === 240 && s2.porCliente[1].metaMin === null && s2.porCliente[1].feitoMin === 360, 'por cliente: A 4h (meta 4h), B 6h em aberto', s2.porCliente)
ok(s[2].feitoMin === 120 && s[2].status === 'andamento', 'semana atual em andamento; outro cliente e falta não contam', s[2])
ok(s[3].status === 'futura', 'semana que ainda não começou')
ok(semanasDoContrato([{ id: 'x', client_id: 'A' }], regs, '2026-10', '2026-10-16').length === 0, 'sem total do contrato: nada')
ok(semanasDoContrato([{ ...vs[0], start_date: '2026-10-06' }, vs[1]], regs, '2026-10', '2026-10-16')[0].ini === '2026-10-05', 'semanas antes do início do contrato não aparecem')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
