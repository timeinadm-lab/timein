// ============================================================
// Consultor fixo — horas por semana do CONTRATO (migração 097, 17/10/2026):
// soma as horas de todos os clientes do contrato, semana a semana
// (segunda a domingo), contra o total do contrato e a divisão por cliente.
// Contas puras, testadas em horasContrato.test.ts.
// ============================================================
import { minutosLiquidos } from './jornada'

export type VinculoContrato = { id: string; client_id: string | null; start_date?: string | null; horas_semana?: number | null; contrato_horas_semana?: number | null; break_minutes?: number | null }
export type RegistroContrato = { client_id: string | null; visit_date: string; check_in?: string | null; check_out?: string | null; break_start?: string | null; break_end?: string | null; is_unavailable?: boolean | null; is_holiday?: boolean | null }
export type SemanaContrato = {
  ini: string; fim: string; metaMin: number; feitoMin: number
  status: 'cumpriu' | 'faltou' | 'andamento' | 'futura'
  porCliente: { client_id: string | null; metaMin: number | null; feitoMin: number }[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const mais = (ds: string, n: number) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const segunda = (ds: string) => { const d = new Date(ds + 'T12:00:00Z'); const dow = d.getUTCDay() || 7; return mais(ds, 1 - dow) }

/** Total do contrato: o maior contrato_horas_semana do grupo (fica no vínculo principal) */
export const totalDoContrato = (vs: VinculoContrato[]) => Math.max(0, ...vs.map(v => Number(v.contrato_horas_semana) || 0))

/** Semanas (seg→dom) que tocam o mês, com o feito de todos os clientes do contrato */
export function semanasDoContrato(vs: VinculoContrato[], regs: RegistroContrato[], mes: string, hoje: string): SemanaContrato[] {
  const total = totalDoContrato(vs)
  if (!total) return []
  const [a, m] = mes.split('-').map(Number)
  const ini = `${mes}-01`, fim = iso(new Date(Date.UTC(a, m, 0, 12)))
  const clientes = new Set(vs.map(v => v.client_id))
  const inicio = vs.map(v => v.start_date || '').filter(Boolean).sort()[0] || ''
  const out: SemanaContrato[] = []
  for (let s = segunda(ini); s <= fim; s = mais(s, 7)) {
    const d = mais(s, 6)
    if (inicio && d < inicio) continue   // semana inteira antes do contrato começar
    const daSemana = regs.filter(r => clientes.has(r.client_id) && r.visit_date >= s && r.visit_date <= d && r.check_in && !r.is_unavailable && !r.is_holiday)
    const porCliente = vs.map(v => ({
      client_id: v.client_id,
      metaMin: Number(v.horas_semana) > 0 ? Math.round(Number(v.horas_semana) * 60) : null,
      feitoMin: daSemana.filter(r => r.client_id === v.client_id).reduce((t, r) => t + minutosLiquidos(r, v.break_minutes), 0),
    }))
    const feitoMin = porCliente.reduce((t, c) => t + c.feitoMin, 0)
    const metaMin = Math.round(total * 60)
    const status = s > hoje ? 'futura' : d >= hoje ? 'andamento' : feitoMin >= metaMin ? 'cumpriu' : 'faltou'
    out.push({ ini: s, fim: d, metaMin, feitoMin, status, porCliente })
  }
  return out
}
