// ============================================================
// Relatório de visita feito no sistema (migração 114, pedido do Gabriel em
// 20/11/2026: fazer aqui o que hoje é feito no FoodChecker).
// Aqui só o que é conta e regra — sem tela e sem banco: testado em
// relatorioVisita.test.ts.
// ============================================================

export type ItemRelatorio = { id: string; tipo: 'nota' | 'titulo'; texto: string; fotos: string[] }
export type Assinaturas = { consultor?: string | null; cliente?: string | null; cliente_nome?: string | null; cliente_doc?: string | null }
export type RelatorioVisita = {
  id: string
  client_id: string
  titulo: string
  data: string                 // AAAA-MM-DD
  entrada: string              // HH:MM
  saida: string
  objetivo: string
  itens: ItemRelatorio[]
  assinaturas: Assinaturas
  status: 'rascunho' | 'finalizado'
  pdf_url: string | null
  autor_nome?: string | null; autor_email?: string | null; autor_cargo?: string | null; autor_cpf?: string | null
}
export type LinhaRelatorio = {
  id: string; titulo: string; data: string; status: 'rascunho' | 'finalizado'; pdf_url: string | null
  client_id: string | null; cliente: string | null; anotacoes: number; autor?: string | null
}

const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso)

/** Título padrão: muda sozinho quando a pessoa troca a data, se ela não escreveu outro */
export const tituloPadrao = (dataISO: string) => `Visita do dia ${dataBR(dataISO)}`
export const ehTituloPadrao = (t: string) => !t.trim() || /^Visita do dia \d{2}\/\d{2}\/\d{4}$/.test(t.trim())

/** "08:00 até 11:30h" — do jeito que sai no PDF; vazio quando falta hora */
export function horarioTexto(entrada?: string | null, saida?: string | null): string {
  const e = (entrada || '').slice(0, 5), s = (saida || '').slice(0, 5)
  if (e && s) return `${e} até ${s}h`
  if (e) return `${e}h`
  return ''
}

/** CPF com pontos; qualquer outra coisa volta como veio */
export function cpfBR(cpf?: string | null): string {
  const d = String(cpf || '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(cpf || '')
}

/** O que falta para poder finalizar (lista vazia = pode) */
export function faltaParaFinalizar(r: Pick<RelatorioVisita, 'client_id' | 'data' | 'entrada' | 'saida' | 'objetivo' | 'itens'>): string[] {
  const f: string[] = []
  if (!r.client_id) f.push('escolher o cliente')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.data || '')) f.push('informar a data')
  if (!r.entrada) f.push('a hora que entrou')
  if (!r.saida) f.push('a hora que saiu')
  if (r.entrada && r.saida && r.saida.slice(0, 5) === r.entrada.slice(0, 5)) f.push('a hora de saída diferente da entrada')
  // Anotação não é obrigatória; mas o relatório precisa dizer alguma coisa
  const temConteudo = !!r.objetivo.trim() || r.itens.some(i => i.texto.trim() || i.fotos.length)
  if (!temConteudo) f.push('escrever o objetivo ou pelo menos uma anotação')
  return f
}

/** Tira anotações vazias (sem texto e sem foto) antes de gravar/gerar o PDF */
export const itensComConteudo = (itens: ItemRelatorio[]) => itens.filter(i => i.texto.trim() || i.fotos.length)

/**
 * Fotos de uma anotação no PDF: até 3 por linha, todas com a mesma altura, sem
 * deformar. Devolve as linhas com largura/altura de cada foto em mm.
 */
export function linhasDeFotos(fotos: { w: number; h: number }[], larguraUtil: number, alturaMax = 52, vao = 3): { w: number; h: number }[][] {
  const linhas: { w: number; h: number }[][] = []
  for (let i = 0; i < fotos.length; i += 3) {
    const grupo = fotos.slice(i, i + 3)
    const proporcoes = grupo.map(f => (f.h > 0 ? f.w / f.h : 1))
    // altura que faz as fotos da linha caberem na largura
    const alturaQueCabe = (larguraUtil - vao * (grupo.length - 1)) / proporcoes.reduce((s, p) => s + p, 0)
    const h = Math.min(alturaMax, alturaQueCabe)
    linhas.push(proporcoes.map(p => ({ w: Math.round(p * h * 100) / 100, h: Math.round(h * 100) / 100 })))
  }
  return linhas
}

export function relatorioNovo(id: string, hoje: string, clienteUnico?: string): RelatorioVisita {
  return {
    id, client_id: clienteUnico || '', titulo: tituloPadrao(hoje), data: hoje, entrada: '', saida: '', objetivo: '',
    itens: [], assinaturas: {}, status: 'rascunho', pdf_url: null,
  }
}

/** Linha do banco → relatório da tela (campo vazio vira texto vazio, hora sem os segundos) */
export function normalizarRelatorio(x: Record<string, unknown>): RelatorioVisita {
  const s = (v: unknown) => (v == null ? '' : String(v))
  const itens = Array.isArray(x.itens) ? (x.itens as Record<string, unknown>[]) : []
  return {
    id: s(x.id), client_id: s(x.client_id), titulo: s(x.titulo), data: s(x.data).slice(0, 10),
    entrada: s(x.entrada).slice(0, 5), saida: s(x.saida).slice(0, 5), objetivo: s(x.objetivo),
    itens: itens.map((i, k) => ({
      id: s(i.id) || `item-${k}`, tipo: i.tipo === 'titulo' ? 'titulo' : 'nota', texto: s(i.texto),
      fotos: Array.isArray(i.fotos) ? (i.fotos as unknown[]).map(String) : [],
    })),
    assinaturas: (x.assinaturas && typeof x.assinaturas === 'object' ? x.assinaturas : {}) as Assinaturas,
    status: x.status === 'finalizado' ? 'finalizado' : 'rascunho', pdf_url: x.pdf_url ? s(x.pdf_url) : null,
    autor_nome: x.autor_nome ? s(x.autor_nome) : null, autor_email: x.autor_email ? s(x.autor_email) : null,
    autor_cargo: x.autor_cargo ? s(x.autor_cargo) : null, autor_cpf: x.autor_cpf ? s(x.autor_cpf) : null,
  }
}
