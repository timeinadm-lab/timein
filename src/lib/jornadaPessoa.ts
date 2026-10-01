// ============================================================
// Jornada de UMA pessoa no mês — o reflexo de tudo que ela registra no portal.
// Pedido do Gabriel (01/10/2026):
//   · Fixo com escala (5x2, 6x1, 12x36): o sistema conta no calendário quantos
//     dias ela TEM que trabalhar no mês e compara com o registrado:
//     "23 de 23 dias + 1 extra". Dia de trabalho passado sem registro = falta.
//   · Consultor: o que está na AGENDA do mês × o que foi feito: "10 de 10
//     visitas". Visita marcada que passou sem registro = falta; visita feita
//     fora da agenda conta à parte; troca (de dia ou de cliente) fica marcada.
//   · Horas de cada dia × jornada do vínculo (quando houver).
// Sem React e sem banco: testado em jornadaPessoa.test.ts.
// ============================================================
import { tipoDoVinculo, salarioConsultoria } from './utils'
import { jornadaDoVinculo, desvioDoDia, minutosLiquidos, TOLERANCIA_MIN } from './jornada'
import type { Jornada, Desvio } from './jornada'

export type VinculoPerfil = {
  id: string
  employee_id?: string
  client_id: string | null
  client?: { name?: string } | null
  service_type?: string | null
  coverage_type?: string | null
  pay_mode?: string | null
  is_temporary?: boolean | null
  start_date?: string | null
  contract_end_date?: string | null
  monthly_amount?: number | null
  cost_assistance?: number | null
  daily_hours?: number | null
  weekly_hours_quota?: number | null
  visits_per_week?: number | null
  visit_frequency?: string | null
  work_schedule_type?: string | null
  days_off?: number[] | null
  schedule_anchor_date?: string | null
  work_start?: string | null
  work_end?: string | null
  break_minutes?: number | null
  expected_days_month?: number | null
  agenda_mode?: string | null
}

export type RegistroPerfil = {
  id: string
  client_id: string
  visit_date: string
  check_in?: string | null
  check_out?: string | null
  break_start?: string | null
  break_end?: string | null
  is_extra?: boolean | null
  is_unavailable?: boolean | null
  is_holiday?: boolean | null
  is_swap?: boolean | null
  swapped_from?: string | null
  visit_rate?: number | null
  extra_approval?: string | null
  unit_name?: string | null
  observations?: string | null
  report_url?: string | null
  unavailability_reason?: string | null
  jornada_seen_at?: string | null
}

export type AgendaPerfil = {
  id: string
  client_id: string | null
  planned_date: string
  planned_time?: string | null
  original_date?: string | null
  original_client_id?: string | null
  changed_by_portal?: boolean | null
  change_seen_at?: string | null
  change_reason?: string | null
  hours_expected?: number | null
  notes?: string | null
}

export type AvisoPerfil = {
  id: string
  client_id: string
  type: string                 // 'troca' | 'falta'
  notice_date: string
  swap_work_date?: string | null
  reason?: string | null
}

export type StatusDia =
  | 'feito'            // trabalhou no dia previsto
  | 'coberto'          // dia previsto trocado por outro dia (já trabalhado)
  | 'folga'            // folga dispensada registrada (conta como cumprido)
  | 'extra'            // trabalhou além do previsto
  | 'fora'             // consultoria: visita feita fora da agenda
  | 'faltou'           // dia previsto que passou sem registro
  | 'falta_registrada' // ela registrou falta
  | 'previsto'         // ainda vai acontecer

export type DiaPerfil = {
  data: string
  linkId: string
  clientId: string
  status: StatusDia
  titulo: string
  detalhe?: string
  registro?: RegistroPerfil
  agenda?: AgendaPerfil
  desvio?: Desvio | null
  minutos?: number
  troca?: boolean
  trocaNaoVista?: boolean
}

export type ResumoVinculo = {
  link: VinculoPerfil
  modo: 'escala' | 'agenda' | 'livre'
  unidade: 'dias' | 'visitas'
  previstos: number | null
  feitos: number
  extras: number
  faltas: string[]
  restantes: number
  trocas: number
  trocasNaoVistas: number
  minutos: number
  jornada: Jornada | null
  abaixoJornada: number
  acimaJornada: number
  valorVisitas: number
  semValor: number
  dias: DiaPerfil[]
}

// ── Datas ────────────────────────────────────────────────────────────────
export function diasDoMes(mes: string): string[] {
  const [a, m] = mes.split('-').map(Number)
  const n = new Date(a, m, 0).getDate()
  return Array.from({ length: n }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
}
const ddmm = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`
const hm = (t?: string | null) => (t || '').slice(0, 5)
const horas = (min: number) => min < 60 ? `${min}min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`

/** Dias do mês dentro do período do vínculo (início e fim) */
export function diasDoVinculoNoMes(link: VinculoPerfil, mes: string): string[] {
  return diasDoMes(mes).filter(ds => (!link.start_date || ds >= link.start_date) && (!link.contract_end_date || ds <= link.contract_end_date))
}

// ── Escala ───────────────────────────────────────────────────────────────
/** A escala tem os dias de trabalho conhecidos? (5x2/6x1 com folgas marcadas, ou 12x36 com o 1º plantão) */
export function temEscala(link: VinculoPerfil): boolean {
  if (tipoDoVinculo(link) !== 'Fixo') return false
  if (link.work_schedule_type === '12x36') return !!link.schedule_anchor_date
  return !!link.days_off?.length
}

/** Folga pela escala: 12x36 alterna a partir do 1º plantão; 5x2/6x1 pelos dias da semana marcados */
export function folgaPelaEscala(link: VinculoPerfil, ds: string): boolean {
  if (link.work_schedule_type === '12x36' && link.schedule_anchor_date) {
    const diff = Math.round((new Date(ds + 'T12:00:00').getTime() - new Date(link.schedule_anchor_date + 'T12:00:00').getTime()) / 86400000)
    return ((diff % 2) + 2) % 2 === 1
  }
  if (!link.days_off?.length) return false
  return link.days_off.includes(new Date(ds + 'T12:00:00').getDay())
}

const trabalhou = (r: RegistroPerfil) => !!r.check_in && !!r.check_out && !r.is_unavailable

// ── Resumo de um vínculo no mês ──────────────────────────────────────────
export function resumoDoVinculo(
  link: VinculoPerfil,
  mes: string,
  hoje: string,
  registros: RegistroPerfil[],
  agenda: AgendaPerfil[],
  avisos: AvisoPerfil[],
  nomeCliente: (id?: string | null) => string = () => '',
): ResumoVinculo {
  const periodo = new Set(diasDoVinculoNoMes(link, mes))
  const regs = registros.filter(r => r.client_id === link.client_id && periodo.has(r.visit_date))
  const jornada = jornadaDoVinculo(link)
  const porVisita = tipoDoVinculo(link) === 'Consultoria' && !salarioConsultoria(link)
  const modo: ResumoVinculo['modo'] = tipoDoVinculo(link) === 'Consultoria' ? 'agenda' : temEscala(link) ? 'escala' : 'livre'

  const dias: DiaPerfil[] = []
  let minutos = 0, abaixoJornada = 0, acimaJornada = 0, valorVisitas = 0, semValor = 0

  // Horas, jornada e valor de cada dia trabalhado
  const infoDoRegistro = (r: RegistroPerfil) => {
    const min = minutosLiquidos(r, link.break_minutes)
    const desvio = jornada ? desvioDoDia(r, jornada) : null
    return { min, desvio, texto: `${hm(r.check_in)}–${hm(r.check_out)} · ${horas(min)}` }
  }
  for (const r of regs.filter(trabalhou)) {
    const { min, desvio } = infoDoRegistro(r)
    minutos += min
    if (desvio && (desvio.difMin < -TOLERANCIA_MIN || desvio.atrasoMin > TOLERANCIA_MIN || desvio.saidaCedoMin > TOLERANCIA_MIN)) abaixoJornada++
    if (desvio && desvio.difMin > TOLERANCIA_MIN) acimaJornada++
    if (porVisita) {
      valorVisitas += Number(r.visit_rate) || 0
      if (!(Number(r.visit_rate) > 0) && !['pendente', 'negada'].includes(r.extra_approval || '') && !r.is_holiday) semValor++
    }
  }
  const diaDeRegistro = (r: RegistroPerfil, status: StatusDia, titulo: string, extra?: Partial<DiaPerfil>): DiaPerfil => {
    const info = trabalhou(r) ? infoDoRegistro(r) : null
    return {
      data: r.visit_date, linkId: link.id, clientId: link.client_id || '', status, titulo,
      detalhe: info?.texto, registro: r, desvio: info?.desvio ?? null, minutos: info?.min, ...extra,
    }
  }
  const faltasRegistradas = regs.filter(r => r.is_unavailable)
  for (const r of faltasRegistradas) {
    dias.push({ data: r.visit_date, linkId: link.id, clientId: link.client_id || '', status: 'falta_registrada', titulo: 'Falta registrada', detalhe: r.unavailability_reason || undefined, registro: r })
  }
  // Folga dispensada (registro antigo, sem horário): na escala conta como dia cumprido
  const folgasReg = new Map(regs.filter(r => r.is_holiday && !r.is_unavailable && !trabalhou(r)).map(r => [r.visit_date, r]))
  const trabalhados = regs.filter(trabalhou)
  const porData = new Map<string, RegistroPerfil>()
  for (const r of trabalhados) if (!porData.has(r.visit_date) || (porData.get(r.visit_date)!.is_extra && !r.is_extra)) porData.set(r.visit_date, r)
  const usados = new Set<string>()

  let previstos: number | null = null
  let feitos = 0, extras = 0, restantes = 0, trocas = 0, trocasNaoVistas = 0
  const faltas: string[] = []

  if (modo === 'escala') {
    // Trocas combinadas pelo portal: o dia de folga vira trabalho e vice-versa
    const trocasAviso = avisos.filter(a => a.type === 'troca' && a.client_id === link.client_id)
    const folgaPorTroca = new Set(trocasAviso.map(a => a.notice_date))
    const trabalhoPorTroca = new Set(trocasAviso.map(a => a.swap_work_date).filter(Boolean) as string[])
    const faltaAvisada = new Set(avisos.filter(a => a.type === 'falta' && a.client_id === link.client_id).map(a => a.notice_date))
    // Troca registrada no dia (is_swap): cobre o dia de trabalho de onde veio
    const cobertoPor = new Map<string, RegistroPerfil>()
    for (const r of trabalhados) if (r.is_swap && r.swapped_from) cobertoPor.set(r.swapped_from, r)
    const chavesTroca = new Set<string>([
      ...trocasAviso.map(a => `${a.notice_date}>${a.swap_work_date || ''}`),
      ...trabalhados.filter(r => r.is_swap && r.swapped_from && !trocasAviso.some(a => a.notice_date === r.swapped_from)).map(r => `${r.swapped_from}>${r.visit_date}`),
    ])
    trocas = chavesTroca.size

    const previstosDias = [...periodo].sort().filter(ds =>
      (!folgaPelaEscala(link, ds) && !folgaPorTroca.has(ds)) || trabalhoPorTroca.has(ds))
    previstos = previstosDias.length
    for (const ds of previstosDias) {
      const r = porData.get(ds)
      const doTroca = trabalhoPorTroca.has(ds)
      if (r) {
        usados.add(r.id)
        feitos++
        dias.push(diaDeRegistro(r, r.is_holiday ? 'folga' : 'feito', r.is_holiday ? 'Folga dispensada' : doTroca ? 'Trabalhou (dia trocado)' : 'Trabalhou', { troca: doTroca }))
      } else if (folgasReg.has(ds)) {
        feitos++
        const fg = folgasReg.get(ds)!
        dias.push({ data: ds, linkId: link.id, clientId: link.client_id || '', status: 'folga', titulo: 'Folga dispensada', detalhe: fg.unavailability_reason || undefined, registro: fg })
      } else if (cobertoPor.has(ds)) {
        const c = cobertoPor.get(ds)!
        feitos++
        dias.push({ data: ds, linkId: link.id, clientId: link.client_id || '', status: 'coberto', titulo: 'Trocado', detalhe: `trabalhou em ${ddmm(c.visit_date)} no lugar`, troca: true })
      } else if (faltasRegistradas.some(f => f.visit_date === ds)) {
        faltas.push(ds)
      } else if (ds < hoje) {
        faltas.push(ds)
        dias.push({ data: ds, linkId: link.id, clientId: link.client_id || '', status: 'faltou', titulo: 'Sem registro', detalhe: faltaAvisada.has(ds) ? 'avisou que ia faltar' : 'dia de trabalho da escala' })
      } else {
        restantes++
        dias.push({ data: ds, linkId: link.id, clientId: link.client_id || '', status: 'previsto', titulo: 'Previsto', detalhe: doTroca ? 'dia trocado' : 'escala' })
      }
    }
    for (const r of trabalhados) {
      if (usados.has(r.id)) continue
      usados.add(r.id)
      if (r.is_swap && r.swapped_from && cobertoPor.get(r.swapped_from)?.id === r.id) {
        dias.push(diaDeRegistro(r, 'feito', 'Trabalhou (troca)', { troca: true, detalhe: `${infoDoRegistro(r).texto} · no lugar de ${ddmm(r.swapped_from)}` }))
      } else {
        extras++
        dias.push(diaDeRegistro(r, 'extra', 'Dia extra'))
      }
    }
  } else if (modo === 'agenda') {
    const itens = agenda.filter(a => a.client_id === link.client_id && periodo.has(a.planned_date))
      .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
    previstos = itens.length
    for (const a of itens) {
      const trocada = !!a.original_client_id || (!!a.original_date && a.original_date !== a.planned_date)
      const naoVista = trocada && !!a.changed_by_portal && !a.change_seen_at
      if (trocada) trocas++
      if (naoVista) trocasNaoVistas++
      const notaTroca = trocada
        ? [a.original_date && a.original_date !== a.planned_date ? `era ${ddmm(a.original_date)}` : null,
           a.original_client_id ? `antes: ${nomeCliente(a.original_client_id) || 'outro cliente'}` : null,
           a.change_reason ? `motivo: ${a.change_reason}` : null].filter(Boolean).join(' · ')
        : ''
      const r = regs.find(x => x.visit_date === a.planned_date && trabalhou(x) && !usados.has(x.id))
      if (r) {
        usados.add(r.id)
        feitos++
        const d = diaDeRegistro(r, 'feito', trocada ? 'Visita feita (trocada)' : 'Visita feita', { agenda: a, troca: trocada, trocaNaoVista: naoVista })
        if (notaTroca) d.detalhe = `${d.detalhe} · ${notaTroca}`
        dias.push(d)
      } else if (faltasRegistradas.some(f => f.visit_date === a.planned_date)) {
        faltas.push(a.planned_date)
      } else if (a.planned_date < hoje) {
        faltas.push(a.planned_date)
        dias.push({ data: a.planned_date, linkId: link.id, clientId: link.client_id || '', status: 'faltou', titulo: 'Visita não registrada', detalhe: [a.planned_time ? `marcada ${hm(a.planned_time)}` : 'marcada na agenda', notaTroca].filter(Boolean).join(' · '), agenda: a, troca: trocada, trocaNaoVista: naoVista })
      } else {
        restantes++
        dias.push({ data: a.planned_date, linkId: link.id, clientId: link.client_id || '', status: 'previsto', titulo: trocada ? 'Agendada (trocada)' : 'Agendada', detalhe: [a.planned_time ? hm(a.planned_time) : null, notaTroca].filter(Boolean).join(' · ') || undefined, agenda: a, troca: trocada, trocaNaoVista: naoVista })
      }
    }
    for (const r of trabalhados) {
      if (usados.has(r.id)) continue
      extras++
      dias.push(diaDeRegistro(r, 'fora', 'Visita fora da agenda'))
    }
  } else {
    // Fixo sem escala definida: conta o que foi registrado; previsto = dias esperados do vínculo, se houver
    previstos = Number(link.expected_days_month) > 0 ? Number(link.expected_days_month) : null
    faltas.push(...faltasRegistradas.map(f => f.visit_date))
    for (const fg of folgasReg.values()) dias.push({ data: fg.visit_date, linkId: link.id, clientId: link.client_id || '', status: 'folga', titulo: 'Folga dispensada', detalhe: fg.unavailability_reason || undefined, registro: fg })
    for (const r of trabalhados) {
      if (r.is_extra) { extras++; dias.push(diaDeRegistro(r, 'extra', 'Dia extra')) }
      else { feitos++; dias.push(diaDeRegistro(r, r.is_holiday ? 'folga' : 'feito', r.is_holiday ? 'Folga dispensada' : 'Trabalhou')) }
    }
  }

  dias.sort((a, b) => a.data.localeCompare(b.data))
  return {
    link, modo, unidade: modo === 'agenda' ? 'visitas' : 'dias',
    previstos, feitos, extras, faltas: faltas.sort(), restantes, trocas, trocasNaoVistas,
    minutos, jornada, abaixoJornada, acimaJornada,
    valorVisitas: Math.round(valorVisitas * 100) / 100, semValor, dias,
  }
}

/** "23 de 23 dias + 1 extra" / "8 de 10 visitas" / "12 dias trabalhados" */
export function textoDoResumo(r: ResumoVinculo): string {
  const u = r.unidade
  const base = r.previstos != null
    ? `${r.feitos} de ${r.previstos} ${u === 'dias' ? (r.previstos === 1 ? 'dia' : 'dias') : (r.previstos === 1 ? 'visita' : 'visitas')}`
    : `${r.feitos} ${u === 'dias' ? (r.feitos === 1 ? 'dia trabalhado' : 'dias trabalhados') : (r.feitos === 1 ? 'visita' : 'visitas')}`
  const extra = r.extras > 0
    ? ` + ${r.extras} ${r.modo === 'agenda' ? (r.extras === 1 ? 'fora da agenda' : 'fora da agenda') : (r.extras === 1 ? 'extra' : 'extras')}`
    : ''
  return base + extra
}

/** Vínculo que aparece no mês: valendo em algum dia do mês, ou com algo registrado nele */
export function vinculoNoMes(link: VinculoPerfil, mes: string, registros: RegistroPerfil[]): boolean {
  if (diasDoVinculoNoMes(link, mes).length > 0) return true
  return registros.some(r => r.client_id === link.client_id && r.visit_date.startsWith(mes))
}
