// Regra única de "vínculo encerrado".
//
// contract_end_date é o ÚLTIMO DIA trabalhado (migração 057). O portal, a
// jornada e a folha tratam esse dia como dentro do contrato
// (`dia <= contract_end_date`). A vaga, ao desligar, grava a data de hoje e
// ainda considera o vínculo em vigor (`contract_end_date >= hoje`).
//
// Por isso a data de fim IGUAL a hoje continua ativo. Encerrado só no dia
// seguinte: contract_end_date < hoje.
//
// ended_at é quando o RH registrou o encerramento, e pode ser antes do último
// dia (a pessoa segue até a data). Sem data de fim, o registro sozinho encerra.
//
// Conferir se UM DIA cai dentro do contrato continua sendo
// `!contract_end_date || dia <= contract_end_date` — não use esta função para isso.

import { hojeISO, precisaContrato } from './utils'

export type VinculoFim = {
  contract_end_date?: string | null
  ended_at?: string | null
}

const dia = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')

/** O vínculo já acabou na data `hoje` (padrão: hoje no fuso de quem usa). */
export function vinculoEncerrado(l: VinculoFim | null | undefined, hoje?: string): boolean {
  if (!l) return false
  const ref = dia(hoje) || hojeISO()
  const fim = dia(l.contract_end_date)
  if (fim) return fim < ref
  return !!l.ended_at
}

/** Ainda vale nessa data — o último dia inclusive. */
export function vinculoAtivo(l: VinculoFim | null | undefined, hoje?: string): boolean {
  return !vinculoEncerrado(l, hoje)
}

/** Dias de calendário de `hoje` até `fim` (0 = o fim é hoje, negativo = já passou). */
export function diasAteFim(fim: string | null | undefined, hoje: string): number | null {
  const a = dia(fim)
  const b = dia(hoje)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null
  const [y, m, d] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y2, m2 - 1, d2)) / 86400000)
}

export type AvisoContrato = VinculoFim & {
  contract_required?: boolean | null
  created_at?: string | null
  contract_file_url?: string | null
  service_type?: string | null
  employee?: { status?: string | null } | { status?: string | null }[] | null
}

export function colaboradorDoAviso(l: AvisoContrato) {
  const e = l.employee
  return Array.isArray(e) ? e[0] : e
}

/**
 * O sino "Vínculos sem contrato" conta este vínculo?
 * Mesmas regras de antes (Fixo/Consultoria, sem arquivo, colaborador Ativo,
 * precisaContrato) e, além disso, não conta vínculo encerrado nem um em que
 * o RH já registrou o encerramento (ended_at), mesmo que o último dia ainda
 * seja hoje ou no futuro.
 */
export function pendenciaDeContrato(l: AvisoContrato, hoje?: string): boolean {
  if (l.contract_file_url) return false
  if (l.service_type && l.service_type !== 'Fixo' && l.service_type !== 'Consultoria') return false
  if (l.ended_at) return false
  if (vinculoEncerrado(l, hoje)) return false
  if (!precisaContrato(l)) return false
  return colaboradorDoAviso(l)?.status === 'Ativo'
}

export function contaVinculosSemContrato(links: AvisoContrato[], hoje?: string): number {
  return links.filter(l => pendenciaDeContrato(l, hoje)).length
}
