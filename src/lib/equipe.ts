// ============================================================
// Equipe: relatório de trabalho de quem tem login no sistema (pedido do
// Gabriel, 01/10/2026). Junta o que a pessoa já registra — atividades,
// reuniões/compromissos, supervisões — e o caixa de compras (migração 075).
// Período: semana (segunda a domingo) ou mês.
// As contas puras daqui são testadas em equipe.test.ts.
// ============================================================

export type TipoPeriodo = 'semana' | 'mes'
export type Periodo = { tipo: TipoPeriodo; ini: string; fim: string; rotulo: string; curto: string }

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const ddmm = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`
const dia = (ds: string) => new Date(ds + 'T12:00:00')

/** Semana de segunda a domingo, ou o mês, que contém a data */
export function periodoDe(tipo: TipoPeriodo, ref: string): Periodo {
  if (tipo === 'mes') {
    const [a, m] = ref.split('-').map(Number)
    const ini = `${a}-${String(m).padStart(2, '0')}-01`
    const fim = iso(new Date(a, m, 0, 12))
    return { tipo, ini, fim, rotulo: `${MESES[m - 1]} de ${a}`, curto: `${MESES[m - 1].slice(0, 3)}/${a}` }
  }
  const d = dia(ref)
  const desde = (d.getDay() + 6) % 7          // segunda = 0
  const seg = new Date(d); seg.setDate(d.getDate() - desde)
  const dom = new Date(seg); dom.setDate(seg.getDate() + 6)
  const ini = iso(seg), fim = iso(dom)
  return { tipo, ini, fim, rotulo: `semana de ${ddmm(ini)} a ${ddmm(fim)}/${fim.slice(0, 4)}`, curto: `${ddmm(ini)}–${ddmm(fim)}` }
}

/** Período anterior (-1) ou seguinte (+1) */
export function andarPeriodo(p: Periodo, n: number): Periodo {
  if (p.tipo === 'mes') {
    const [a, m] = p.ini.split('-').map(Number)
    return periodoDe('mes', iso(new Date(a, m - 1 + n, 1, 12)))
  }
  const d = dia(p.ini); d.setDate(d.getDate() + 7 * n)
  return periodoDe('semana', iso(d))
}

export type LancamentoCaixa = {
  id: string
  user_id: string
  tipo: 'recebido' | 'compra' | 'devolvido'
  data: string
  valor: number | string
  descricao: string
  client_id?: string | null
  comprovante?: string | null
  criado_em?: string
}

export type SaldoCaixa = { recebido: number; gasto: number; devolvido: number; saldo: number }
const r2 = (n: number) => Math.round(n * 100) / 100

/** Saldo do caixa considerando os lançamentos até a data (inclusive); sem data, tudo */
export function saldoDoCaixa(lancamentos: LancamentoCaixa[], ate?: string, desde?: string): SaldoCaixa {
  let recebido = 0, gasto = 0, devolvido = 0
  for (const l of lancamentos) {
    if (ate && l.data > ate) continue
    if (desde && l.data < desde) continue
    const v = Number(l.valor) || 0
    if (l.tipo === 'recebido') recebido += v
    else if (l.tipo === 'compra') gasto += v
    else devolvido += v
  }
  return { recebido: r2(recebido), gasto: r2(gasto), devolvido: r2(devolvido), saldo: r2(recebido - gasto - devolvido) }
}

/** "Está com ela R$ 420 (devolver ou usar)" / "A receber R$ 80" / "Caixa zerado" */
export function textoDoSaldo(saldo: number, brl: (v: number) => string): string {
  if (saldo > 0.004) return `Com ela: ${brl(saldo)} (devolver ou usar)`
  if (saldo < -0.004) return `A receber: ${brl(-saldo)} (gastou do próprio bolso)`
  return 'Caixa zerado'
}

export const ROTULO_PAPEL: Record<string, string> = { chefe: 'Chefe', recrutador: 'RH', contabilidade: 'Contabilidade' }
export const ROTULO_TIPO_CAIXA: Record<LancamentoCaixa['tipo'], string> = { recebido: 'Recebi', compra: 'Compra', devolvido: 'Devolvi' }
