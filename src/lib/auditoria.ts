// ============================================================
// Auditoria por checklist (migração 079) — contas puras, testadas em
// auditoria.test.ts.
//
// Nota com peso: soma dos pesos das perguntas CONFORMES ÷ soma dos pesos das
// perguntas avaliadas (conformes + não conformes). N/A não entra na conta.
// Ex. MELI: Estrutura peso 1, Boas Práticas peso 2 — uma não conformidade de
// Boas Práticas tira o dobro de pontos de uma de Estrutura.
// ============================================================

export type Resposta = 'C' | 'NC' | 'NA'
export type Faixa = { min: number; rotulo: string }
export type ItemAuditoria = { grupo: string; secao?: string | null; peso: number | string; resposta: Resposta | null }

export const FAIXAS_PADRAO: Faixa[] = [
  { min: 91, rotulo: 'Excelente' }, { min: 80, rotulo: 'Satisfatório' },
  { min: 50, rotulo: 'Insatisfatório' }, { min: 0, rotulo: 'Crítico' },
]

export type ResumoGrupo = {
  grupo: string; total: number; conformes: number; naoConformes: number; na: number; pendentes: number
  peso: number | null            // peso das perguntas do grupo (null se misturado)
  ncPct: number | null           // % de não conformidade entre as avaliadas do grupo
}
export type ResumoAuditoria = {
  nota: number | null            // 0–100, arredondada para inteiro (é o que aparece e classifica)
  notaExata: number | null
  total: number; conformes: number; naoConformes: number; na: number; pendentes: number
  pontosObtidos: number; pontosPossiveis: number
  grupos: ResumoGrupo[]
  classificacao: Faixa | null
}

const num = (v: number | string) => Number(v) || 0

export function classificar(nota: number | null, faixas: Faixa[] = FAIXAS_PADRAO): Faixa | null {
  if (nota == null) return null
  const ord = [...faixas].sort((a, b) => b.min - a.min)
  return ord.find(f => nota >= f.min) || ord[ord.length - 1] || null
}

export function resumoAuditoria(itens: ItemAuditoria[], faixas: Faixa[] = FAIXAS_PADRAO): ResumoAuditoria {
  let pontosObtidos = 0, pontosPossiveis = 0
  const grupos = new Map<string, ResumoGrupo & { pesos: Set<number> }>()
  for (const it of itens) {
    const g = grupos.get(it.grupo) || { grupo: it.grupo, total: 0, conformes: 0, naoConformes: 0, na: 0, pendentes: 0, peso: null, ncPct: null, pesos: new Set<number>() }
    g.total++; g.pesos.add(num(it.peso))
    if (it.resposta === 'C') { g.conformes++; pontosObtidos += num(it.peso); pontosPossiveis += num(it.peso) }
    else if (it.resposta === 'NC') { g.naoConformes++; pontosPossiveis += num(it.peso) }
    else if (it.resposta === 'NA') g.na++
    else g.pendentes++
    grupos.set(it.grupo, g)
  }
  const lista: ResumoGrupo[] = [...grupos.values()].map(({ pesos, ...g }) => {
    const avaliadas = g.conformes + g.naoConformes
    return { ...g, peso: pesos.size === 1 ? [...pesos][0] : null, ncPct: avaliadas ? (100 * g.naoConformes) / avaliadas : null }
  })
  const notaExata = pontosPossiveis > 0 ? (100 * pontosObtidos) / pontosPossiveis : null
  const nota = notaExata == null ? null : Math.round(notaExata)
  const soma = (k: 'total' | 'conformes' | 'naoConformes' | 'na' | 'pendentes') => lista.reduce((s, g) => s + g[k], 0)
  return {
    nota, notaExata, pontosObtidos, pontosPossiveis, grupos: lista,
    total: soma('total'), conformes: soma('conformes'), naoConformes: soma('naoConformes'), na: soma('na'), pendentes: soma('pendentes'),
    classificacao: classificar(nota, faixas),
  }
}

/** Faixas em texto curto para a legenda: "Entre 91 e 100%", "Abaixo de 50%" */
export function textoDasFaixas(faixas: Faixa[] = FAIXAS_PADRAO): { rotulo: string; texto: string }[] {
  const ord = [...faixas].sort((a, b) => b.min - a.min)
  return ord.map((f, i) => {
    const teto = i === 0 ? 100 : ord[i - 1].min - 1
    return { rotulo: f.rotulo, texto: f.min <= 0 ? `Abaixo de ${ord[i - 1]?.min ?? 0}%` : `Entre ${f.min} e ${teto}%` }
  })
}

/** Cor da classificação (posição na lista: melhor → pior) */
export function corDaFaixa(rotulo: string | undefined, faixas: Faixa[] = FAIXAS_PADRAO): [number, number, number] {
  const ord = [...faixas].sort((a, b) => b.min - a.min)
  const i = ord.findIndex(f => f.rotulo === rotulo)
  const cores: [number, number, number][] = [[22, 128, 61], [37, 99, 235], [234, 179, 8], [220, 38, 38]]
  return i < 0 ? [120, 120, 120] : cores[Math.min(i, cores.length - 1)]
}
