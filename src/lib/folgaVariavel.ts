// Escala de folga variável (14/10/2026): 6x1 ou 5x2 SEM dia de folga fixo.
// O cliente escolhe a folga de cada semana (segunda numa, sábado na outra),
// então não existe "dia pendente" — o que vale é a conta da semana:
// 6x1 → 6 dias por semana (às vezes 5); o 7º dia trabalhado é dia extra.
// A folha do mês continua contando ~26 dias (PaymentList.expectedDays).

export function diasPorSemana(escala: string | null | undefined): number | null {
  if (!escala) return null
  if (escala.includes('6x1')) return 6
  if (escala.includes('5x2')) return 5
  return null
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dataDe = (ds: string) => new Date(ds + 'T12:00:00')
const somar = (ds: string, n: number) => { const d = dataDe(ds); d.setDate(d.getDate() + n); return iso(d) }

/** Segunda-feira da semana do dia (semana de segunda a domingo) */
export function segundaDa(ds: string): string {
  const dow = dataDe(ds).getDay() // 0 = domingo
  return somar(ds, -((dow + 6) % 7))
}

/** Dias trabalhados na semana do dia, sem contar o próprio dia */
export function trabalhadosNaSemana(dia: string, diasTrabalhados: string[]): number {
  const seg = segundaDa(dia)
  const dom = somar(seg, 6)
  return new Set(diasTrabalhados.filter(d => d !== dia && d >= seg && d <= dom)).size
}

export type SemanaCurta = { inicio: string; fim: string; registrados: number; meta: number; semRegistro: string[] }

/**
 * Semanas já encerradas (até `ate`) com menos registros que a escala pede.
 * Registro = trabalho, folga ou falta. Semana cortada pelo começo do mês, do
 * vínculo ou da folha de ponto tem meta proporcional (dias × meta ÷ 7).
 */
export function semanasCurtas(opts: {
  de: string               // primeiro dia que conta (mês, vínculo, início da folha)
  fim: string              // último dia do período (fim do mês ou do vínculo)
  ontem: string            // semana só fecha quando o último dia dela já passou
  porSemana: number
  registrados: string[]    // dias com algum registro neste cliente
}): SemanaCurta[] {
  const { de, fim, ontem, porSemana } = opts
  if (fim < de) return []
  const feitos = new Set(opts.registrados)
  const out: SemanaCurta[] = []
  for (let seg = segundaDa(de); seg <= fim; seg = somar(seg, 7)) {
    const ult = somar(seg, 6) < fim ? somar(seg, 6) : fim
    if (ult > ontem) break // semana ainda aberta: a folga dela pode estar pela frente
    const ini = seg < de ? de : seg
    const dias: string[] = []
    for (let d = ini; d <= ult; d = somar(d, 1)) dias.push(d)
    const meta = Math.round(dias.length * porSemana / 7)
    const registrados = dias.filter(d => feitos.has(d)).length
    if (registrados < meta) out.push({ inicio: ini, fim: ult, registrados, meta, semRegistro: dias.filter(d => !feitos.has(d)) })
  }
  return out
}
