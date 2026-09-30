import { supabase } from './supabase'
import { tipoDoVinculo, salarioConsultoria } from './utils'

/**
 * Jornada combinada no vínculo e o aviso de "fora do combinado".
 * Vale para Fixo e Consultoria com salário fixo (pedido de 30/09/2026).
 *
 *   · Horas por dia: Fixo usa "Horas por dia"; Consultoria com salário usa
 *     "Horas por visita". Sem isso, vem da diferença entre entrada e saída.
 *   · Horário definido (work_start/work_end) é opcional. Vazio = livre: a
 *     pessoa só precisa cumprir as horas. Definido: avisa também atraso e
 *     saída antes da hora.
 */

export const TOLERANCIA_MIN = 10

export type VinculoJornada = {
  id?: string; employee_id?: string; client_id?: string | null
  service_type?: string | null; coverage_type?: string | null; pay_mode?: string | null; is_temporary?: boolean | null
  daily_hours?: number | null; weekly_hours_quota?: number | null
  work_start?: string | null; work_end?: string | null; break_minutes?: number | null
  start_date?: string | null; contract_end_date?: string | null
}

export type Jornada = { minutos: number; entrada: string | null; saida: string | null; intervaloMin: number }

const paraMin = (t?: string | null) => {
  if (!t) return null
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}
const duracao = (a?: string | null, b?: string | null) => {
  const x = paraMin(a), y = paraMin(b)
  if (x == null || y == null) return 0
  return y >= x ? y - x : y + 1440 - x // passou da meia-noite (plantão)
}

export const horaMin = (m: number) => m < 60 ? `${m}min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`

export const rotuloIntervalo = (m: number) => m ? `${horaMin(m)} de intervalo` : 'sem intervalo'

/** O combinado do vínculo, ou null quando não há jornada para cobrar */
export function jornadaDoVinculo(l?: VinculoJornada | null): Jornada | null {
  if (!l) return null
  const cobra = tipoDoVinculo(l) === 'Fixo' || salarioConsultoria(l)
  if (!cobra) return null
  const entrada = l.work_start ? l.work_start.slice(0, 5) : null
  const saida = l.work_end ? l.work_end.slice(0, 5) : null
  const horas = tipoDoVinculo(l) === 'Fixo' ? Number(l.daily_hours) : Number(l.weekly_hours_quota) || Number(l.daily_hours)
  const intervaloMin = Math.max(0, Number(l.break_minutes) || 0)
  const minutos = horas > 0 ? Math.round(horas * 60) : (entrada && saida ? Math.max(0, duracao(entrada, saida) - intervaloMin) : 0)
  return minutos > 0 ? { minutos, entrada, saida, intervaloMin } : null
}

export type Desvio = {
  feitoMin: number
  difMin: number        // + a mais, − a menos
  atrasoMin: number     // só com horário definido
  saidaCedoMin: number  // só com horário definido
}

/** Diferença de um dia registrado para o combinado; null = dentro da tolerância */
export function desvioDoDia(
  v: { check_in?: string | null; check_out?: string | null; break_start?: string | null; break_end?: string | null },
  j: Jornada,
): Desvio | null {
  if (!v.check_in || !v.check_out) return null
  // Intervalo registrado no dia; se não houver, vale o do vínculo (o portal não pede)
  const intervalo = v.break_start && v.break_end ? duracao(v.break_start, v.break_end) : j.intervaloMin
  const feitoMin = Math.max(0, duracao(v.check_in, v.check_out) - intervalo)
  const difMin = feitoMin - j.minutos
  const ent = paraMin(v.check_in), sai = paraMin(v.check_out)
  const jEnt = paraMin(j.entrada), jSai = paraMin(j.saida)
  const atrasoMin = jEnt != null && ent != null ? Math.max(0, ent - jEnt) : 0
  const saidaCedoMin = jSai != null && sai != null && jEnt != null && jSai > jEnt ? Math.max(0, jSai - sai) : 0
  if (Math.abs(difMin) <= TOLERANCIA_MIN && atrasoMin <= TOLERANCIA_MIN && saidaCedoMin <= TOLERANCIA_MIN) return null
  return { feitoMin, difMin, atrasoMin, saidaCedoMin }
}

/** Texto curto do desvio: "2h01 de 8h · faltam 5h59 · chegou 14min atrasada" */
export function textoDoDesvio(d: Desvio, j: Jornada): string {
  const partes = [`${horaMin(d.feitoMin)} de ${horaMin(j.minutos)}`]
  if (d.difMin > TOLERANCIA_MIN) partes.push(`${horaMin(d.difMin)} a mais`)
  if (d.difMin < -TOLERANCIA_MIN) partes.push(`faltam ${horaMin(-d.difMin)}`)
  if (d.atrasoMin > TOLERANCIA_MIN) partes.push(`entrou ${horaMin(d.atrasoMin)} depois das ${j.entrada}`)
  if (d.saidaCedoMin > TOLERANCIA_MIN) partes.push(`saiu ${horaMin(d.saidaCedoMin)} antes das ${j.saida}`)
  return partes.join(' · ')
}

export type DiaForaDaJornada = {
  visitId: string; employeeId: string; clientId: string; data: string
  pessoa: string; cliente: string
  entrada: string; saida: string
  jornada: Jornada; desvio: Desvio
}

/** Primeiro dia do mês passado: o aviso olha o mês atual e o anterior */
function inicioJanela() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export type VinculoComJornada = VinculoJornada & {
  id: string; employee_id: string; client_id: string
  employee?: { full_name?: string; status?: string } | null; client?: { name?: string } | null
  jornada: Jornada
}

/** Vínculos de gente ativa que têm jornada para cobrar */
export async function vinculosComJornada(): Promise<VinculoComJornada[]> {
  const { data, error } = await supabase.from('employee_client_links')
    .select('*, employee:employees(full_name, status), client:clients(name)')
    .or('daily_hours.not.is.null,weekly_hours_quota.not.is.null,work_start.not.is.null')
  if (error) throw new Error('Vínculos: ' + error.message)
  return ((data || []) as Omit<VinculoComJornada, 'jornada'>[])
    .filter(l => l.employee?.status === 'Ativo')
    .map(l => ({ ...l, jornada: jornadaDoVinculo(l) }))
    .filter((l): l is VinculoComJornada => !!l.jornada)
}

type Registro = { id: string; employee_id: string; client_id: string; visit_date: string; check_in?: string; check_out?: string; break_start?: string; break_end?: string; jornada_seen_at?: string | null }
const vinculoDoDia = (links: VinculoComJornada[], v: Registro) => links.find(l => l.employee_id === v.employee_id && l.client_id === v.client_id
  && (!l.start_date || v.visit_date >= l.start_date) && (!l.contract_end_date || v.visit_date <= l.contract_end_date))

/**
 * Dias fora da jornada ainda não vistos pelo RH (mês atual e anterior).
 * Erro de consulta sobe: o sino conta 0, a tela mostra o motivo.
 */
export async function buscarForaDaJornada(): Promise<DiaForaDaJornada[]> {
  const links = await vinculosComJornada()
  if (links.length === 0) return []
  const ids = Array.from(new Set(links.map(l => l.employee_id)))
  const visitas: Registro[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await supabase.from('nutritionist_visits')
      .select('id, employee_id, client_id, visit_date, check_in, check_out, break_start, break_end')
      .in('employee_id', ids.slice(i, i + 50))
      .gte('visit_date', inicioJanela())
      .not('check_out', 'is', null)
      .is('jornada_seen_at', null)
      .not('is_unavailable', 'is', true)
      .not('is_extra', 'is', true)
      .limit(5000)
    if (error) throw new Error('Registros: ' + error.message)
    visitas.push(...((data || []) as Registro[]))
  }

  const out: DiaForaDaJornada[] = []
  for (const v of visitas) {
    const l = vinculoDoDia(links, v)
    if (!l) continue
    const d = desvioDoDia(v, l.jornada)
    if (!d) continue
    out.push({
      visitId: v.id, employeeId: v.employee_id, clientId: v.client_id, data: v.visit_date,
      pessoa: l.employee?.full_name || '—', cliente: l.client?.name || '—',
      entrada: (v.check_in || '').slice(0, 5), saida: (v.check_out || '').slice(0, 5),
      jornada: l.jornada, desvio: d,
    })
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || a.pessoa.localeCompare(b.pessoa))
}

export type DiaDaPessoa = {
  visitId: string; data: string; clientId: string; cliente: string
  entrada: string; saida: string; feitoMin: number
  jornada: Jornada; desvio: Desvio | null; visto: boolean
}

/** Todos os dias registrados de uma pessoa no mês (yyyy-MM), com a comparação */
export async function diasDaPessoa(links: VinculoComJornada[], employeeId: string, mes: string): Promise<DiaDaPessoa[]> {
  const doMes = links.filter(l => l.employee_id === employeeId)
  if (doMes.length === 0) return []
  const [a, m] = mes.split('-').map(Number)
  const fim = new Date(a, m, 0).getDate()
  const { data, error } = await supabase.from('nutritionist_visits')
    .select('id, employee_id, client_id, visit_date, check_in, check_out, break_start, break_end, jornada_seen_at')
    .eq('employee_id', employeeId)
    .gte('visit_date', `${mes}-01`).lte('visit_date', `${mes}-${String(fim).padStart(2, '0')}`)
    .not('check_out', 'is', null)
    .not('is_unavailable', 'is', true)
    .not('is_extra', 'is', true)
    .order('visit_date')
  if (error) throw new Error('Registros: ' + error.message)
  const out: DiaDaPessoa[] = []
  for (const v of (data || []) as Registro[]) {
    const l = vinculoDoDia(doMes, v)
    if (!l) continue
    const d = desvioDoDia(v, l.jornada)
    const intervalo = v.break_start && v.break_end ? duracao(v.break_start, v.break_end) : l.jornada.intervaloMin
    out.push({
      visitId: v.id, data: v.visit_date, clientId: v.client_id, cliente: l.client?.name || '—',
      entrada: (v.check_in || '').slice(0, 5), saida: (v.check_out || '').slice(0, 5),
      feitoMin: Math.max(0, duracao(v.check_in, v.check_out) - intervalo),
      jornada: l.jornada, desvio: d, visto: !!v.jornada_seen_at,
    })
  }
  return out
}
