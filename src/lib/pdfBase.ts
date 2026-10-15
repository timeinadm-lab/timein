// Base dos PDFs novos (ficha do colaborador e panorama da Jornada, 15/10/2026):
// cabeçalho verde, seções, tabela com quebra de linha e de página — o mesmo
// visual do PDF da Jornada (jornadaPdf.ts).
import type { jsPDF as JsPDF } from 'jspdf'

export type Coluna = { titulo: string; larg: number; direita?: boolean }
type Cor = [number, number, number]

// Fontes padrão do PDF não têm alguns símbolos: troca por equivalentes simples
export const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[×]/g, 'x').replace(/[→]/g, '>').replace(/[•]/g, '-')

export async function criarPdf(deitado = false) {
  const { jsPDF } = await import('jspdf')
  const doc: JsPDF = new jsPDF({ unit: 'mm', format: 'a4', orientation: deitado ? 'landscape' : 'portrait' })
  const larguraPag = deitado ? 297 : 210
  const alturaUtil = deitado ? 196 : 282
  const L = 14, R = larguraPag - 14, W = R - L
  const st = { y: 16 }

  const novaPagina = () => { doc.addPage(); st.y = 16 }
  const garantir = (alt: number) => { if (st.y + alt > alturaUtil) novaPagina() }
  const texto = (t: string, x: number, yy: number, opt?: { tam?: number; negrito?: boolean; cor?: Cor; alinhar?: 'right' | 'left' }) => {
    doc.setFont('helvetica', opt?.negrito ? 'bold' : 'normal')
    doc.setFontSize(opt?.tam ?? 9)
    doc.setTextColor(...(opt?.cor ?? [33, 33, 33]))
    doc.text(limpo(t), x, yy, opt?.alinhar === 'right' ? { align: 'right' } : undefined)
  }
  const cabecalho = (rotulo: string, titulo: string, direita: string, linha: string) => {
    doc.setFillColor(15, 78, 48); doc.rect(0, 0, larguraPag, 26, 'F')
    texto(rotulo, L, 9, { tam: 8, cor: [190, 220, 200] })
    texto(titulo, L, 17, { tam: 15, negrito: true, cor: [255, 255, 255] })
    texto(direita, R, 17, { tam: 11, cor: [255, 255, 255], alinhar: 'right' })
    texto(linha, L, 22.5, { tam: 7.5, cor: [190, 220, 200] })
    st.y = 34
  }
  const secao = (t: string) => {
    garantir(14)
    st.y += 3
    texto(t.toUpperCase(), L, st.y, { tam: 8, negrito: true, cor: [15, 78, 48] })
    doc.setDrawColor(15, 78, 48); doc.setLineWidth(0.3); doc.line(L, st.y + 1.5, R, st.y + 1.5)
    st.y += 6
  }
  /** Pares rótulo: valor em duas colunas */
  const campos = (pares: [string, string][]) => {
    const meia = W / 2
    for (let i = 0; i < pares.length; i += 2) {
      garantir(6)
      pares.slice(i, i + 2).forEach(([r, v], k) => {
        const x = L + k * meia
        texto(r, x, st.y, { tam: 7, cor: [120, 120, 120] })
        const ls = doc.splitTextToSize(limpo(v || '-'), meia - 4) as string[]
        ls.slice(0, 2).forEach((ln, j) => texto(ln, x, st.y + 3.6 + j * 3.6, { tam: 9 }))
      })
      st.y += 9
    }
  }
  /** Parágrafo com quebra de linha */
  const paragrafo = (t: string, opt?: { tam?: number; cor?: Cor; recuo?: number }) => {
    const ls = doc.splitTextToSize(limpo(t), W - (opt?.recuo ?? 0)) as string[]
    ls.forEach(l => { garantir(5); texto(l, L + (opt?.recuo ?? 0), st.y, { tam: opt?.tam ?? 9, cor: opt?.cor }); st.y += (opt?.tam ?? 9) * 0.45 })
    st.y += 1
  }
  /** Caixa amarela de destaque (observações) */
  const destaque = (titulo: string, itens: string[]) => {
    doc.setFontSize(9)
    const linhas = itens.flatMap(t => doc.splitTextToSize(limpo('- ' + t), W - 8) as string[])
    const alt = 8 + linhas.length * 4.2
    garantir(alt + 2)
    doc.setFillColor(254, 243, 199); doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.4)
    doc.roundedRect(L, st.y - 4, W, alt, 1.5, 1.5, 'FD')
    texto(titulo, L + 4, st.y + 0.5, { tam: 9, negrito: true, cor: [120, 53, 15] })
    linhas.forEach((l, i) => texto(l, L + 4, st.y + 5.2 + i * 4.2, { tam: 9, cor: [120, 53, 15] }))
    st.y += alt + 2
  }
  /** Tabela simples com quebra de linha e de página; corLinha pinta a linha */
  const tabela = (cols: Coluna[], linhas: string[][], corLinha?: (i: number) => Cor | null) => {
    const total = cols.reduce((s, c) => s + c.larg, 0)
    const k = W / total // ajusta as larguras à página
    const cs = cols.map(c => ({ ...c, larg: c.larg * k }))
    const cab = () => {
      garantir(8)
      doc.setFillColor(243, 244, 241); doc.rect(L, st.y - 3.6, W, 5.4, 'F')
      let x = L + 1.5
      cs.forEach(c => { texto(c.titulo, c.direita ? x + c.larg - 3 : x, st.y, { tam: 7.5, negrito: true, cor: [90, 90, 90], alinhar: c.direita ? 'right' : 'left' }); x += c.larg })
      st.y += 4.6
    }
    cab()
    linhas.forEach((linha, i) => {
      doc.setFontSize(8)
      const partes = linha.map((v, j) => doc.splitTextToSize(limpo(v || ''), cs[j].larg - 3) as string[])
      const alt = Math.max(1, ...partes.map(p => p.length)) * 3.5 + 1.4
      if (st.y + alt > alturaUtil) { novaPagina(); cab() }
      const cor = corLinha?.(i)
      if (cor) { doc.setFillColor(...cor); doc.rect(L, st.y - 3.2, W, alt, 'F') }
      let x = L + 1.5
      partes.forEach((p, j) => {
        p.forEach((ln, m) => texto(ln, cs[j].direita ? x + cs[j].larg - 3 : x, st.y + m * 3.5, { tam: 8, alinhar: cs[j].direita ? 'right' : 'left' }))
        x += cs[j].larg
      })
      st.y += alt
      doc.setDrawColor(230, 230, 226); doc.setLineWidth(0.1); doc.line(L, st.y - 2.6, R, st.y - 2.6)
    })
    st.y += 2
  }
  /** Rodapé com página X de Y em todas as páginas */
  const numerar = (rotulo: string) => {
    const n = doc.getNumberOfPages()
    for (let p = 1; p <= n; p++) {
      doc.setPage(p)
      texto(`${rotulo} · página ${p} de ${n}`, R, (deitado ? 210 : 297) - 6, { tam: 7, cor: [150, 150, 150], alinhar: 'right' })
    }
  }
  return { doc, st, L, R, W, garantir, novaPagina, texto, cabecalho, secao, campos, paragrafo, destaque, tabela, numerar }
}
