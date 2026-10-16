// ============================================================
// Aba Planilhas (pedido de 16/10/2026): planilha de EXTRAS (validar e baixar)
// e planilha de quem preencheu a FOLHA DE PONTO no mês, as duas com o dia em
// que a pessoa recebe (8, 15 ou 20). Contas puras, testadas em planilhas.test.ts.
//
// Dia de pagamento — a mesma regra de planoLancamentos.ts:
//   · Consultoria por visita: visita do dia 1 ao 15 → dia 20 do mês;
//     do dia 16 ao fim → dia 8 do mês seguinte. Hora acima do combinado entra
//     no último lançamento do mês → dia 8 do mês seguinte.
//   · Fixo, diária e consultoria com salário: o(s) dia(s) marcado(s) no
//     vínculo (8, 15, 20) do mês. Com dois dias, metade em cada.
// ============================================================
import { tipoDoVinculo, salarioConsultoria } from './utils'
import { minutosLiquidos } from './jornada'

export type VinculoPg = {
  service_type?: string | null; coverage_type?: string | null; pay_mode?: string | null
  payment_dates?: { day_of_month?: number | null }[] | null
  break_minutes?: number | null
}
export type TipoExtra = 'dia' | 'visita' | 'horas'

const dia = (mes: string, d: number) => `${mes}-${String(d).padStart(2, '0')}`
export const mesSeguinte = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}
export const porVisita = (l?: VinculoPg | null) => !!l && tipoDoVinculo(l) === 'Consultoria' && !salarioConsultoria(l)

/** Dias marcados no vínculo (só 8, 15 e 20), em ordem */
export function diasDoVinculo(l?: VinculoPg | null): number[] {
  return [...new Set((l?.payment_dates || []).map(d => Number(d.day_of_month)).filter(d => [8, 15, 20].includes(d)))].sort((a, b) => a - b)
}

/**
 * Datas em que um extra é pago. Vazio = vínculo sem dia de pagamento marcado.
 * visitDate: dia do extra (só importa na consultoria por visita).
 */
export function pagamentoDoExtra(l: VinculoPg | null | undefined, mes: string, tipo: TipoExtra, visitDate?: string): string[] {
  if (porVisita(l)) {
    if (tipo === 'horas') return [dia(mesSeguinte(mes), 8)]
    const d = Number((visitDate || '').slice(8, 10)) || 31
    return [d <= 15 ? dia(mes, 20) : dia(mesSeguinte(mes), 8)]
  }
  return diasDoVinculo(l).map(d => dia(mes, d))
}

/** Datas em que a pessoa recebe pelo mês trabalhado (folha de ponto) */
export function pagamentoDoMes(l: VinculoPg | null | undefined, mes: string, registros: { visit_date: string }[] = []): string[] {
  if (porVisita(l)) {
    const q1 = registros.some(r => Number(r.visit_date.slice(8, 10)) <= 15)
    const q2 = registros.some(r => Number(r.visit_date.slice(8, 10)) > 15)
    return [...(q1 ? [dia(mes, 20)] : []), ...(q2 || !q1 ? [dia(mesSeguinte(mes), 8)] : [])]
  }
  return diasDoVinculo(l).map(d => dia(mes, d))
}

/** "20/10 e 08/11" — ou o aviso quando o vínculo está sem dia */
export function textoPagamento(datas: string[]): string {
  if (!datas.length) return 'Sem dia marcado no vínculo'
  return datas.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(' e ')
}
/** Só o dia: "Dia 20" / "Dia 8 e 20" (o mês vem no texto completo) */
export function textoDia(datas: string[]): string {
  if (!datas.length) return '—'
  return 'Dia ' + [...new Set(datas.map(d => Number(d.slice(8, 10))))].join(' e ')
}

export type RegistroPonto = {
  visit_date: string; check_in?: string | null; check_out?: string | null; break_start?: string | null; break_end?: string | null
  is_unavailable?: boolean | null; is_holiday?: boolean | null; is_extra?: boolean | null; report_url?: string | null
}
export type ResumoPonto = {
  diasTrabalhados: number; faltas: number; folgas: number; extras: number; minutos: number
  semSaida: number; semRelatorio: number; primeiro: string | null; ultimo: string | null
}

/** Resumo da folha de ponto de um vínculo no mês */
export function resumoDoPonto(registros: RegistroPonto[], intervaloVinculoMin?: number | null, exigeRelatorio = false): ResumoPonto {
  const trabalhados = registros.filter(r => r.check_in && !r.is_unavailable && !r.is_holiday)
  const datas = registros.map(r => r.visit_date).sort()
  return {
    // Extra fica na coluna própria (como na Pagamentos): não soma nos dias
    diasTrabalhados: new Set(trabalhados.filter(r => !r.is_extra).map(r => r.visit_date)).size,
    faltas: registros.filter(r => r.is_unavailable).length,
    folgas: registros.filter(r => r.is_holiday).length,
    extras: registros.filter(r => r.is_extra).length,
    minutos: trabalhados.reduce((t, r) => t + minutosLiquidos(r, intervaloVinculoMin), 0),
    semSaida: trabalhados.filter(r => !r.check_out).length,
    semRelatorio: exigeRelatorio ? trabalhados.filter(r => !r.report_url).length : 0,
    primeiro: datas[0] || null,
    ultimo: datas[datas.length - 1] || null,
  }
}

export const horasTexto = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
