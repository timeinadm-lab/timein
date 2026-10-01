// Testes da Jornada por pessoa. Rodar todos: npm run testes
import { resumoDoVinculo, textoDoResumo, diasDoVinculoNoMes, folgaPelaEscala, temEscala } from './jornadaPessoa'
import type { VinculoPerfil, RegistroPerfil, AgendaPerfil, AvisoPerfil } from './jornadaPessoa'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info ?? ''); falhas++ }
}

const MES = '2026-10'           // 01/10/2026 é quinta-feira
const C = 'cli-1'
const reg = (id: string, dia: string, extra: Partial<RegistroPerfil> = {}): RegistroPerfil =>
  ({ id, client_id: C, visit_date: `${MES}-${dia}`, check_in: '08:00', check_out: '17:00', ...extra })

// ── Fixo 5x2 (folga sábado e domingo), 8h + 1h de almoço ──
const fixo: VinculoPerfil = {
  id: 'L1', client_id: C, service_type: 'Fixo', pay_mode: 'mensal', work_schedule_type: '5x2',
  days_off: [0, 6], daily_hours: 8, break_minutes: 60, monthly_amount: 3000,
}
console.log('Fixo 5x2 — outubro/2026 tem 22 dias úteis')
ok(temEscala(fixo), 'tem escala')
ok(folgaPelaEscala(fixo, '2026-10-03') && !folgaPelaEscala(fixo, '2026-10-05'), 'sábado é folga, segunda não')

{
  // Trabalhou todos os dias úteis até 15/10 (11 dias), menos 07/10; extra no sábado 10/10
  const uteisAte15 = ['01', '02', '05', '06', '07', '08', '09', '12', '13', '14', '15']
  const regs = uteisAte15.filter(d => d !== '07').map(d => reg('r' + d, d))
  regs.push(reg('x10', '10', { is_extra: true }))
  const r = resumoDoVinculo(fixo, MES, '2026-10-16', regs, [], [])
  ok(r.modo === 'escala' && r.previstos === 22, '22 dias previstos', r.previstos)
  ok(r.feitos === 10, '10 dias feitos', r.feitos)
  ok(r.extras === 1, '1 extra (sábado)', r.extras)
  ok(r.faltas.length === 1 && r.faltas[0] === '2026-10-07', 'falta em 07/10', r.faltas)
  ok(r.restantes === 11, '11 dias ainda por vir (16 a 30 úteis)', r.restantes)
  ok(r.feitos + r.faltas.length + r.restantes === r.previstos, 'feitos + faltas + restantes = previstos')
  ok(textoDoResumo(r) === '10 de 22 dias + 1 extra', 'texto: "10 de 22 dias + 1 extra"', textoDoResumo(r))
  ok(r.minutos === 11 * 8 * 60, 'horas: 11 dias × 8h (desconta 1h de almoço)', r.minutos)
  ok(r.abaixoJornada === 0 && r.acimaJornada === 0, '08–17 com 1h de almoço = dentro da jornada')
  ok(r.dias.find(d => d.data === '2026-10-07')?.status === 'faltou', 'dia 07 aparece como "Sem registro"')
}

{
  // Começou no meio do mês: só conta a partir do início
  const r = resumoDoVinculo({ ...fixo, start_date: '2026-10-19' }, MES, '2026-10-01', [], [], [])
  ok(r.previstos === 10, 'começou 19/10: 10 dias úteis (19 a 30)', r.previstos)
  ok(diasDoVinculoNoMes({ ...fixo, contract_end_date: '2026-10-09' }, MES).length === 9, 'encerrou 09/10: 9 dias no período')
}

{
  // Troca combinada pelo portal: folga na quarta 07 e trabalha no sábado 10
  const avisos: AvisoPerfil[] = [{ id: 'a1', client_id: C, type: 'troca', notice_date: '2026-10-07', swap_work_date: '2026-10-10' }]
  const regs = [reg('r10', '10', { is_swap: true, swapped_from: '2026-10-07' })]
  const r = resumoDoVinculo(fixo, MES, '2026-10-12', regs, [], avisos)
  ok(r.previstos === 22, 'troca não muda o total (sai 07, entra 10)', r.previstos)
  ok(r.dias.find(d => d.data === '2026-10-10')?.status === 'feito', 'sábado 10 trabalhado conta como feito')
  ok(!r.faltas.includes('2026-10-07'), 'quarta 07 não é falta (foi trocada)')
  ok(r.extras === 0 && r.trocas === 1, 'não vira extra; 1 troca', { extras: r.extras, trocas: r.trocas })
}

{
  // Troca registrada no dia (sem aviso antes): o sábado cobre a quarta
  const regs = [reg('r10', '10', { is_swap: true, swapped_from: '2026-10-07' })]
  const r = resumoDoVinculo(fixo, MES, '2026-10-12', regs, [], [])
  ok(r.dias.find(d => d.data === '2026-10-07')?.status === 'coberto', 'quarta 07 aparece "Trocado"')
  ok(!r.faltas.includes('2026-10-07') && r.extras === 0, 'sem falta e sem extra')
}

{
  // Saiu cedo: 08:00–12:00 num dia de 8h
  const r = resumoDoVinculo(fixo, MES, '2026-10-02', [reg('r1', '01', { check_out: '12:00' })], [], [])
  ok(r.abaixoJornada === 1, 'dia de 4h conta abaixo da jornada')
}

// ── 6x1 e 12x36 ──
ok(resumoDoVinculo({ ...fixo, work_schedule_type: '6x1', days_off: [0] }, MES, '2026-10-01', [], [], []).previstos === 27, '6x1 folga domingo: 27 dias')
ok(resumoDoVinculo({ ...fixo, work_schedule_type: '12x36', days_off: null, schedule_anchor_date: '2026-10-02' }, MES, '2026-10-01', [], [], []).previstos === 15, '12x36 a partir de 02/10: 15 plantões')
ok(resumoDoVinculo({ ...fixo, days_off: null, work_schedule_type: '5x2' }, MES, '2026-10-01', [reg('r1', '01')], [], []).modo === 'livre', 'sem folgas marcadas: conta só o registrado')

// ── Consultor pela agenda ──
console.log('Consultor — agenda do mês')
const consult: VinculoPerfil = { id: 'L2', client_id: C, service_type: 'Consultoria', pay_mode: 'mensal', weekly_hours_quota: 4 }
const ag = (id: string, dia: string, extra: Partial<AgendaPerfil> = {}): AgendaPerfil => ({ id, client_id: C, planned_date: `${MES}-${dia}`, ...extra })
{
  const agenda = [
    ag('a1', '05'), ag('a2', '12'),
    ag('a3', '14', { original_date: '2026-10-13', changed_by_portal: true }),   // trocada pelo portal, não vista
    ag('a4', '20'), ag('a5', '28'),
  ]
  const regs = [
    reg('v1', '05', { check_out: '12:00', visit_rate: 150 }),
    reg('v2', '14', { check_out: '12:00', visit_rate: 150 }),
    reg('v3', '22', { check_out: '12:00', visit_rate: 0 }),   // fora da agenda e sem valor
  ]
  const r = resumoDoVinculo(consult, MES, '2026-10-21', regs, agenda, [])
  ok(r.modo === 'agenda' && r.previstos === 5, '5 visitas na agenda', r.previstos)
  ok(r.feitos === 2, '2 feitas (05 e 14)', r.feitos)
  ok(r.faltas.join() === '2026-10-12,2026-10-20', 'faltou 12 e 20', r.faltas)
  ok(r.restantes === 1, '1 ainda por vir (28)', r.restantes)
  ok(r.extras === 1, '1 visita fora da agenda (22)', r.extras)
  ok(r.trocas === 1 && r.trocasNaoVistas === 1, '1 troca, ainda não vista pelo RH')
  ok(textoDoResumo(r) === '2 de 5 visitas + 1 fora da agenda', 'texto: "2 de 5 visitas + 1 fora da agenda"', textoDoResumo(r))
  ok(r.valorVisitas === 300 && r.semValor === 1, 'valor das visitas R$ 300; 1 sem valor', { v: r.valorVisitas, s: r.semValor })
  ok(r.jornada === null, 'consultoria por visita não tem jornada diária')
}
{
  // Visita em outro cliente não conta aqui
  const r = resumoDoVinculo(consult, MES, '2026-10-30', [{ ...reg('v9', '05'), client_id: 'outro' }], [ag('a1', '05')], [])
  ok(r.feitos === 0 && r.faltas.length === 1, 'registro de outro cliente não cumpre a agenda deste')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
