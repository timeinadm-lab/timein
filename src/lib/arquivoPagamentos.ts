// ============================================================
// Arquivo histórico de pagamentos (pedido de 19/11/2026).
// Cada pagamento fechado é um registro do dia 8, 15 ou 20.
// Cada linha tem nome, valor, observação e a chave PIX (opcional até preencher).
// CPF e dados bancários (agência, conta) não entram. O PDF/Excel sai sem PIX
// por padrão; a versão com PIX é só para uso interno.
// Sem React e sem banco: a tela e o PDF usam estas regras.
// ============================================================

export const DIAS_DE_PAGAMENTO = [8, 15, 20] as const
export type DiaPagamento = (typeof DIAS_DE_PAGAMENTO)[number]

export type LinhaArquivo = {
  id?: string
  ordem: number
  nome: string
  valor: number
  observacao: string | null
  pix: string | null
}

export type RegistroArquivo = {
  id: string
  data_pagamento: string
  observacao: string | null
  total: number
  quantidade: number
  linhas: LinhaArquivo[]
}

export type EntradaArquivo = {
  id?: string
  data_pagamento: string
  observacao: string | null
  linhas: { nome: string; valor: number; observacao: string | null; pix: string | null }[]
}

export type LinhaLida = { nome: string; valor: number; observacao: string | null; pix: string | null }
export type LeituraArquivo = { linhas: LinhaLida[]; avisos: string[]; erros: string[] }

const SEM_ACENTO = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const CAB_NOME = /^(nome|pessoa|colaborador|prestador|nutricionista)$/
const CAB_VALOR = /^(valor|pago|pagamento)$/
const CAB_OBS = /^(observacao|obs|nota|notas)$/
const CAB_PIX = /^(pix|chave pix|chave)$/

/** Título de coluna, sem acento, para achar Nome, Valor e Chave PIX. */
export function tituloColuna(s: string): string {
  return SEM_ACENTO(s).replace(/[^a-z0-9/ ]/g, '').replace(/\s+/g, ' ').trim()
}

/** Coluna que não pode ser gravada (CPF, banco, agência, conta). A chave PIX pode. */
export function colunaProibida(titulo: string): boolean {
  const t = tituloColuna(titulo)
  if (!t || CAB_PIX.test(t)) return false
  return /\bcpf\b/.test(t) || /\bbanco\b/.test(t) || /\bagencia\b/.test(t) || /\bconta\b/.test(t) || t === 'cc' || t === 'c/c'
}

/** Chave PIX com rótulo de conta, agência ou a palavra CPF. O número da chave em si pode. */
export function pixRecusado(t: string): boolean {
  const s = t.trim()
  if (!s) return false
  return /\bag[eê]ncia\s*\d/i.test(s) || /\bconta\s+corrente\b/i.test(s) || /\bc\/c\b/i.test(s) || /\bcpf\b/i.test(s)
}

const RE_PROIBIDO: RegExp[] = [
  /\bpix\b/i,
  /\bcpf\b/i,
  /\d{3}\.\d{3}\.\d{3}-\d{2}/,
  /(?<!\d)\d{11}(?!\d)/,
  /\bag[eê]ncia\s*\d/i,
  /\bconta\s+corrente\b/i,
  /\bc\/c\b/i,
]

/**
 * Nome ou observação com CPF, dado bancário ou a palavra PIX.
 * A chave fica só na coluna PIX — assim o arquivo "sem PIX" não leva a chave na observação.
 */
export function textoTemDadoBancario(t: string): boolean {
  return RE_PROIBIDO.some(r => r.test(t))
}

/** "R$ 6.609,64", "900,00", "6609.64" ou número do Excel. */
export function lerValor(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null
    return Math.round(v * 100) / 100
  }
  let s = String(v ?? '').trim()
  if (!s || s === '-') return null
  s = s.replace(/r\$/gi, '').replace(/\s/g, '')
  if (!/^[\d.,]+$/.test(s)) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function valorParaTexto(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

/** 20/11/2026 a partir de "2026-11-20", sem mudar o dia por causa do fuso. */
export function formatarDataPagamento(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'
}

export function diaDePagamento(iso: string): DiaPagamento | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const dia = Number(iso.slice(8, 10))
  return (DIAS_DE_PAGAMENTO as readonly number[]).includes(dia) ? dia as DiaPagamento : null
}

export function dataNoMes(mes: string, dia: number): string | null {
  if (!/^\d{4}-\d{2}$/.test(mes)) return null
  if (!(DIAS_DE_PAGAMENTO as readonly number[]).includes(dia)) return null
  return `${mes}-${String(dia).padStart(2, '0')}`
}

export function resumir(linhas: { valor: number }[]): { total: number; quantidade: number } {
  const total = Math.round(linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100
  return { total, quantidade: linhas.length }
}

export function filtrarRegistros(regs: RegistroArquivo[], mes: string, dia: number | null): RegistroArquivo[] {
  return regs
    .filter(r => r.data_pagamento.slice(0, 7) === mes && (dia == null || Number(r.data_pagamento.slice(8, 10)) === dia))
    .sort((a, b) => a.data_pagamento.localeCompare(b.data_pagamento))
}

function textoCelula(v: unknown): string {
  if (v == null) return ''
  return String(v).trim()
}

/**
 * Planilha (Nome, Valor, Observação e, se tiver, Chave PIX).
 * Colunas de CPF, banco, agência ou conta são ignoradas.
 * A linha "Total" e o título "Pagamento dia …" não entram.
 */
export function lerGrade(linhas: unknown[][]): LeituraArquivo {
  const avisos: string[] = []
  const erros: string[] = []
  const out: LinhaLida[] = []
  let header = -1
  let iNome = 0
  let iValor = 1
  let iObs = 2
  let iPix = -1
  for (let i = 0; i < linhas.length; i++) {
    const titulos = (linhas[i] || []).map(c => tituloColuna(textoCelula(c)))
    const nome = titulos.findIndex(t => CAB_NOME.test(t))
    const valor = titulos.findIndex(t => CAB_VALOR.test(t))
    if (nome >= 0 && valor >= 0) {
      header = i
      iNome = nome
      iValor = valor
      iObs = titulos.findIndex(t => CAB_OBS.test(t))
      iPix = titulos.findIndex(t => CAB_PIX.test(t))
      if (titulos.some(t => t && colunaProibida(t))) {
        avisos.push('Colunas de CPF ou dados bancários foram ignoradas. A chave PIX, se vier na coluna, entra no registro.')
      }
      break
    }
  }
  const dados = header >= 0 ? linhas.slice(header + 1) : linhas
  dados.forEach((row, idx) => {
    const cells = row || []
    const nome = textoCelula(cells[header >= 0 ? iNome : 0])
    if (!nome) return
    if (/^total$/i.test(nome) || /^pagamento\s+dia\b/i.test(nome)) return
    const valor = lerValor(cells[header >= 0 ? iValor : 1])
    const obsBruta = header >= 0 ? (iObs >= 0 ? textoCelula(cells[iObs]) : '') : textoCelula(cells[2])
    const pixBruto = header >= 0 ? (iPix >= 0 ? textoCelula(cells[iPix]) : '') : textoCelula(cells[3])
    const n = (header >= 0 ? header + 2 : 1) + idx
    if (valor == null) {
      erros.push(`Linha ${n}: não entendi o valor de ${nome}.`)
      return
    }
    const observacao = obsBruta.trim() || null
    const pix = pixBruto.trim() || null
    if (textoTemDadoBancario(nome) || (observacao && textoTemDadoBancario(observacao))) {
      erros.push(`Linha ${n}: ${nome} tem CPF, dado bancário ou chave PIX fora da coluna e não foi incluída.`)
      return
    }
    if (pix && pixRecusado(pix)) {
      erros.push(`Linha ${n}: a chave PIX de ${nome} parece conta, agência ou CPF escrito como dado bancário.`)
      return
    }
    out.push({ nome, valor, observacao, pix })
  })
  if (!out.length && !erros.length) erros.push('Nenhuma pessoa encontrada. Use nome, valor e observação.')
  return { linhas: out, avisos, erros }
}

/** Texto colado: tab ou ponto e vírgula, ou "Nome R$ 1.234,56 observação". */
export function lerTexto(texto: string): LeituraArquivo {
  const brutas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!brutas.length) return { linhas: [], avisos: [], erros: ['Cole ao menos uma pessoa.'] }
  const primeira = tituloColuna(brutas[0])
  const tabela = brutas.some(l => l.includes('\t') || l.includes(';'))
    || (/\bnome\b/.test(primeira) && /\bvalor\b/.test(primeira) && brutas[0].includes(','))
  if (tabela) {
    return lerGrade(brutas.map(l => {
      const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ','
      return l.split(sep).map(c => c.trim())
    }))
  }
  const avisos: string[] = []
  const erros: string[] = []
  const out: LinhaLida[] = []
  brutas.forEach((linha, idx) => {
    if (/^pagamento\s+dia\b/i.test(linha) || /^total\b/i.test(linha)) return
    const m = linha.match(/^(.*?)(?:\s+)(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)(?:\s+(.*))?$/i)
    if (!m) {
      erros.push(`Linha ${idx + 1}: não entendi "${linha.slice(0, 60)}".`)
      return
    }
    const nome = m[1].trim().replace(/[-–—:]+$/, '').trim()
    const valor = lerValor(m[2])
    const observacao = (m[3] || '').trim() || null
    if (!nome || valor == null) {
      erros.push(`Linha ${idx + 1}: não entendi "${linha.slice(0, 60)}".`)
      return
    }
    if (textoTemDadoBancario(nome) || (observacao && textoTemDadoBancario(observacao))) {
      erros.push(`Linha ${idx + 1}: ${nome} tem CPF, dado bancário ou chave PIX fora da coluna e não foi incluída.`)
      return
    }
    out.push({ nome, valor, observacao, pix: null })
  })
  if (!out.length && !erros.length) erros.push('Nenhuma pessoa encontrada.')
  return { linhas: out, avisos, erros }
}

/** O que a tela manda para o banco, já conferido. */
export function validarEntrada(entrada: EntradaArquivo, outrasDatas: string[]): string | null {
  if (!diaDePagamento(entrada.data_pagamento)) return 'A data de pagamento precisa ser dia 8, 15 ou 20.'
  if (entrada.observacao && textoTemDadoBancario(entrada.observacao)) return 'A observação geral tem CPF, dado bancário ou uma chave PIX. A chave fica na coluna PIX.'
  if (!entrada.linhas.length) return 'Inclua ao menos uma pessoa.'
  for (const [i, l] of entrada.linhas.entries()) {
    if (!l.nome.trim()) return `A linha ${i + 1} está sem nome.`
    if (!(l.valor >= 0) || !Number.isFinite(l.valor)) return `A linha ${i + 1} está sem valor.`
    if (textoTemDadoBancario(l.nome) || (l.observacao && textoTemDadoBancario(l.observacao))) {
      return `${l.nome || 'A linha ' + (i + 1)} tem CPF, dado bancário ou chave PIX fora da coluna.`
    }
    if (l.pix && pixRecusado(l.pix)) return `A chave PIX de ${l.nome} parece conta, agência ou a palavra CPF.`
  }
  const repetida = outrasDatas.includes(entrada.data_pagamento)
  if (repetida) return 'Já existe um registro neste dia de pagamento.'
  return null
}

/** Células de uma linha na exportação. Sem PIX, a chave não entra em lugar nenhum. */
export function celulasExportacao(l: { nome: string; valor: number; observacao: string | null; pix?: string | null }, comPix: boolean): (string | number)[] {
  return comPix
    ? [l.nome, l.pix || '', l.valor, l.observacao || '']
    : [l.nome, l.valor, l.observacao || '']
}
