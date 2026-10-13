// ============================================================
// Contrato que paga AO CONCLUIR (migração 088, pedido de 13/10/2026):
// "contrato de 30 dias — ela só recebe quando conclui". Os dias de pagamento
// continuam 8, 15 ou 20; o que muda é QUAL ciclo paga: nenhum antes do fim,
// e o contrato inteiro no primeiro dia de pagamento depois do último dia.
// Sem React e sem banco: dá para testar (contrato.test.ts).
// ============================================================

const DIA = 86400000
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const somaMeses = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  // 31/01 + 1 mês = 28/02 (não pula para março)
  const ultimo = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return Date.UTC(y, m - 1 + n, Math.min(d, ultimo))
}

/** Dias corridos do início ao fim, contando os dois */
export function diasDoContrato(ini: string, fim: string) {
  return Math.max(0, Math.round((utc(fim) - utc(ini)) / DIA) + 1)
}

/**
 * Quantos salários vale o contrato: meses cheios + dias que sobram ÷ 30.
 * 13/10 a 12/11 = 1 salário. 13/10 a 11/11 (30 dias) também = 1.
 * 01/11 a 10/11 = 10/30. 13/10 a 12/12 = 2.
 */
export function salariosDoContrato(ini: string, fim: string) {
  const ate = utc(fim) + DIA   // fim é o último dia trabalhado: conta até o dia seguinte
  if (ate <= utc(ini)) return 0
  let meses = 0
  while (somaMeses(ini, meses + 1) <= ate) meses++
  const resto = Math.round((ate - somaMeses(ini, meses)) / DIA)
  // 30 ou 31 dias corridos sem fechar o mês do calendário (ex.: 13/10 a 11/11) contam como 1 mês
  if (meses === 0 && resto >= 30) return 1
  return Math.round((meses + resto / 30) * 10000) / 10000
}

export type SituacaoAoConcluir =
  | { estado: 'aguarda' }                                  // ciclo antes do fim: nada a pagar ainda
  | { estado: 'paga'; ini: string; dias: number; fator: number }   // ciclo com o último dia: o contrato inteiro
  | { estado: 'fora' }                                     // já foi pago num ciclo anterior

/** O que o ciclo [cicloIni, cicloFim] paga de um contrato que paga ao concluir */
export function situacaoAoConcluir(inicio: string | null, fim: string, cicloIni: string, cicloFim: string): SituacaoAoConcluir {
  if (fim < cicloIni) return { estado: 'fora' }
  if (fim > cicloFim) return { estado: 'aguarda' }
  const ini = inicio && inicio <= fim ? inicio : cicloIni
  return { estado: 'paga', ini, dias: diasDoContrato(ini, fim), fator: salariosDoContrato(ini, fim) }
}
