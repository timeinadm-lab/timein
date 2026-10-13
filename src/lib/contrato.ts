// ============================================================
// Contrato com DATAS DE PAGAMENTO COMBINADAS (migração 089, pedido de 13/10/2026):
// "contrato de 30 dias — ela só recebe em 15/11". O RH lista as datas e o valor
// de cada uma (o sistema sugere). A folha paga cada parcela no mês dela e nada
// nos outros meses. Os dias continuam 8, 15 ou 20.
// Sem React e sem banco: dá para testar (contrato.test.ts).
// ============================================================

export type Parcela = { data: string; valor: number }
export const DIAS_PARCELA = [8, 15, 20] as const

const DIA = 86400000
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const isoDe = (t: number) => new Date(t).toISOString().slice(0, 10)
const somaMeses = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  // 31/01 + 1 mês = 28/02 (não pula para março)
  const ultimo = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return Date.UTC(y, m - 1 + n, Math.min(d, ultimo))
}
const r2 = (n: number) => Math.round(n * 100) / 100

/** Dias corridos do início ao fim, contando os dois */
export function diasDoContrato(ini: string, fim: string) {
  return Math.max(0, Math.round((utc(fim) - utc(ini)) / DIA) + 1)
}

/**
 * Quantos salários vale o contrato: meses cheios + dias que sobram ÷ 30.
 * 13/10 a 12/11 = 1 salário. 13/10 a 11/11 (30 dias) também = 1.
 * 01/11 a 10/11 = 10/30. 13/10 a 12/12 = 2.
 */
function mesesEDias(ini: string, fim: string) {
  const ate = utc(fim) + DIA   // fim é o último dia trabalhado: conta até o dia seguinte
  if (ate <= utc(ini)) return { meses: 0, resto: 0 }
  let meses = 0
  while (somaMeses(ini, meses + 1) <= ate) meses++
  const resto = Math.round((ate - somaMeses(ini, meses)) / DIA)
  // 30 ou 31 dias corridos sem fechar o mês do calendário (ex.: 13/10 a 11/11) contam como 1 mês
  return meses === 0 && resto >= 30 ? { meses: 1, resto: 0 } : { meses, resto }
}
export function salariosDoContrato(ini: string, fim: string) {
  const { meses, resto } = mesesEDias(ini, fim)
  return Math.round((meses + resto / 30) * 10000) / 10000
}
/** Valor do contrato inteiro em reais, sem arredondar no meio da conta */
export function valorDoContrato(ini: string, fim: string, mensal: number) {
  const { meses, resto } = mesesEDias(ini, fim)
  return r2(mensal * meses + mensal * resto / 30)
}

/** Primeiro dia `dia` (8, 15 ou 20) depois de `apos` */
function proximoDia(apos: string, dia: number) {
  const [y, m] = apos.split('-').map(Number)
  for (let k = 0; k < 3; k++) {
    const d = isoDe(Date.UTC(y, m - 1 + k, dia))
    if (d > apos) return d
  }
  return isoDe(Date.UTC(y, m + 2, dia))
}

/**
 * Sugestão: uma data por mês de contrato (no dia de pagamento dela), a última
 * logo depois do fim; o total (salário + ajuda mensal × meses) dividido igual.
 * 13/10 a 12/11, dia 15 → 15/11. 13/10 a 12/01, dia 15 → 15/11, 15/12, 15/01.
 */
export function sugerirParcelas(ini: string, fim: string, mensal: number, dia: number): Parcela[] {
  if (!ini || !fim || fim < ini || !(mensal > 0)) return []
  const dia0 = (DIAS_PARCELA as readonly number[]).includes(dia) ? dia : 15
  const total = valorDoContrato(ini, fim, mensal)
  const ultima = proximoDia(fim, dia0)
  const datas: string[] = []
  for (let k = 1; ; k++) {
    const d = proximoDia(isoDe(somaMeses(ini, k) - DIA), dia0)
    if (d >= ultima) break
    if (!datas.includes(d)) datas.push(d)
  }
  datas.push(ultima)
  const cada = r2(total / datas.length)
  return datas.map((data, i) => ({ data, valor: i === datas.length - 1 ? r2(total - cada * (datas.length - 1)) : cada }))
}

/** O que está errado na lista (vazio = ok) */
export function problemasDasParcelas(parcelas: Parcela[], fim?: string | null): string[] {
  const p: string[] = []
  const meses = new Set<string>()
  for (const x of parcelas) {
    if (!x.data) { p.push('Tem data em branco.'); continue }
    if (!(DIAS_PARCELA as readonly number[]).includes(Number(x.data.slice(8, 10)))) p.push(`${br(x.data)}: o dia tem que ser 8, 15 ou 20.`)
    if (meses.has(x.data.slice(0, 7))) p.push(`Duas datas no mesmo mês (${x.data.slice(5, 7)}/${x.data.slice(0, 4)}).`)
    meses.add(x.data.slice(0, 7))
    if (!(x.valor > 0)) p.push(`${br(x.data)}: informe o valor.`)
  }
  if (fim && parcelas.length && !parcelas.some(x => x.data > fim)) p.push(`Nenhuma data depois do fim do contrato (${br(fim)}): os últimos dias ficariam sem pagar.`)
  return p
}
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Parcelas em ordem de data, sem as vazias */
export function ordenarParcelas(parcelas: Parcela[] | null | undefined): Parcela[] {
  return (parcelas || []).filter(x => x && x.data).map(x => ({ data: x.data, valor: Number(x.valor) || 0 }))
    .sort((a, b) => a.data.localeCompare(b.data))
}

/**
 * A parcela que cai no mês da folha e o período que ela cobre (para contar
 * faltas): da parcela anterior (ou do início) até o dia antes dela — a última
 * vai até o fim do contrato.
 */
export function parcelaDoMes(parcelas: Parcela[] | null | undefined, mes: string, inicio: string | null, fim: string | null) {
  const lista = ordenarParcelas(parcelas)
  const i = lista.findIndex(x => x.data.slice(0, 7) === mes)
  if (i < 0) return null
  const p = lista[i]
  const de = i === 0 ? (inicio || p.data) : lista[i - 1].data
  const ultima = i === lista.length - 1
  const vespera = isoDe(utc(p.data) - DIA)
  const ate = ultima && fim ? fim : fim && fim < vespera ? fim : vespera
  return { ...p, numero: i + 1, de, ate, total: lista.length }
}

/**
 * As datas do vínculo. Quem foi marcado com a caixinha antiga "paga ao concluir"
 * (088) e ainda não tem lista ganha a sugestão: mesma conta que valia antes.
 */
export function parcelasDoVinculo(l: {
  parcelas?: Parcela[] | null; paga_ao_concluir?: boolean | null; start_date?: string | null
  contract_end_date?: string | null; monthly_amount?: number | null
  cost_assistance?: number | null; cost_assistance_periodo?: string | null
}, dia: number): Parcela[] {
  const lista = ordenarParcelas(l.parcelas)
  if (lista.length) return lista
  if (l.paga_ao_concluir && l.start_date && l.contract_end_date) {
    // ajuda mensal vai junto (a semanal continua toda segunda, fora daqui)
    const ajuda = l.cost_assistance_periodo === 'semana' ? 0 : Number(l.cost_assistance) || 0
    return sugerirParcelas(l.start_date, l.contract_end_date, (Number(l.monthly_amount) || 0) + ajuda, dia)
  }
  return []
}

/** Próxima parcela a partir de um dia (para avisar "nada neste mês — próxima em …") */
export function proximaParcela(parcelas: Parcela[] | null | undefined, desde: string) {
  return ordenarParcelas(parcelas).find(x => x.data >= desde) || null
}
