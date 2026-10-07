// ============================================================
// Importação de candidatos (planilha do Google Forms) — pedido de 07/10/2026:
//   · o "Carimbo de data/hora" vira a data da resposta (respondido_em);
//   · a mesma pessoa repetida (WhatsApp, e-mail ou nome + cidade) não entra
//     de novo: fica só a resposta MAIS NOVA, e quem refez o formulário sobe
//     para os recentes com os dados atualizados.
// Sem React e sem banco: testado em candidatosImport.test.ts.
// ============================================================

/**
 * Data da resposta. Aceita o que vem da planilha:
 *  · número do Excel (dias desde 30/12/1899, fração = hora) — .xlsx
 *  · "07/10/2026 14:32:10" ou "7/10/2026 14:32" (dia/mês/ano) — Google Forms
 *  · "2026-10-07T14:32:10" (ISO)
 * A hora é a do relógio de quem respondeu (Brasília) e volta em ISO com fuso.
 */
export function lerCarimbo(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  let d: Date | null = null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s)
    if (serial < 20000 || serial > 80000) return null          // não é data
    const utc = new Date(Math.round((serial - 25569) * 86400000))
    d = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds())
  } else {
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
    if (br) d = new Date(+br[3], +br[2] - 1, +br[1], +(br[4] || 0), +(br[5] || 0), +(br[6] || 0))
    else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.length === 10 ? s + 'T00:00:00' : s)
  }
  return d && !isNaN(d.getTime()) ? d.toISOString() : null
}

export type Chaves = { wa: string; email: string; nomeCidade: string }

/**
 * Junta as linhas da mesma pessoa e devolve só a mais nova de cada uma
 * (pela data da resposta; sem data, vale a linha de baixo, que o Forms
 * grava por último). Ordem de saída: a da planilha.
 */
export function ultimaRespostaDeCada<T>(linhas: T[], chaves: (l: T) => Chaves, quando: (l: T) => string | null): T[] {
  const grupoDe = new Map<string, number>()      // chave → índice do grupo
  const melhor: { linha: T; pos: number }[] = []
  const lista = (c: Chaves) => [c.wa && `w:${c.wa}`, c.email && `e:${c.email}`, c.nomeCidade && `n:${c.nomeCidade}`].filter(Boolean) as string[]
  linhas.forEach((l, pos) => {
    const ks = lista(chaves(l))
    const g = ks.map(k => grupoDe.get(k)).find(x => x !== undefined)
    if (g === undefined) {
      const novo = melhor.push({ linha: l, pos }) - 1
      ks.forEach(k => grupoDe.set(k, novo))
      return
    }
    ks.forEach(k => { if (!grupoDe.has(k)) grupoDe.set(k, g) })
    const atual = melhor[g]
    const qa = quando(atual.linha), qn = quando(l)
    // Mais nova ganha; empate ou sem data: a de baixo (mais recente no Forms)
    if (!qa || !qn || qn >= qa) melhor[g] = { linha: l, pos }
  })
  return melhor.sort((a, b) => a.pos - b.pos).map(x => x.linha)
}

/**
 * O que atualizar num candidato que refez o formulário: só os campos que vieram
 * preenchidos (vazio não apaga o que já existe). Estágio e notas nunca mudam.
 */
export function camposParaAtualizar(novo: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(novo)) {
    if (k === 'pipeline_stage') continue
    if (v === null || v === undefined || v === '') continue
    if (Array.isArray(v) && !v.length) continue
    out[k] = v
  }
  return out
}
