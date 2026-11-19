// PDF do relatório de visita (20/11/2026), no formato que a consultoria já
// entrega ao cliente: logo da consultoria à esquerda, logo do cliente à direita
// (só quando o cliente tem logo cadastrada), "Visita do dia …", quadro com
// cliente / consultor / data / hora, objetivo, anotações com visto e fotos,
// assinaturas e rodapé com a página.
import { cpfBR, horarioTexto, itensComConteudo, linhasDeFotos } from './relatorioVisita'
import type { RelatorioVisita } from './relatorioVisita'

export type ImagemPdf = { dataUrl: string; w: number; h: number }
export type DadosRelatorioPdf = {
  relatorio: RelatorioVisita
  cliente: string
  consultor: { nome: string; email?: string | null; cargo?: string | null; cpf?: string | null }
  logoConsultoria?: ImagemPdf | null
  logoCliente?: ImagemPdf | null
  fotos: Map<string, ImagemPdf>          // caminho da foto → imagem pronta
}

const RODAPE = 'Consultoria Fernanda Stinchi - www.fernandastinchi.com.br'
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const formato = (d: string) => (/^data:image\/png/i.test(d) ? 'PNG' : 'JPEG')
// As fontes padrão do PDF não têm estes sinais
const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[✓✔✅]/g, '').replace(/​/g, '')

export async function gerarPdfRelatorioVisita(d: DadosRelatorioPdf): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 14, R = 196, W = R - L, TOPO = 34, FIM = 280
  let y = TOPO
  const r = d.relatorio

  const cabecalho = () => {
    const caber = (img: ImagemPdf, maxW: number, maxH: number) => { const k = Math.min(maxW / img.w, maxH / img.h); return { w: img.w * k, h: img.h * k } }
    if (d.logoConsultoria) { const t = caber(d.logoConsultoria, 50, 20); doc.addImage(d.logoConsultoria.dataUrl, formato(d.logoConsultoria.dataUrl), L, 8 + (20 - t.h) / 2, t.w, t.h) }
    if (d.logoCliente) { const t = caber(d.logoCliente, 40, 20); doc.addImage(d.logoCliente.dataUrl, formato(d.logoCliente.dataUrl), R - t.w, 8 + (20 - t.h) / 2, t.w, t.h) }
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2); doc.line(L, 30, R, 30)
  }
  const novaPagina = () => { doc.addPage(); cabecalho(); y = TOPO + 4 }
  const garantir = (alt: number) => { if (y + alt > FIM) novaPagina() }
  const fonte = (tam: number, negrito = false, cor: [number, number, number] = [30, 30, 30]) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); doc.setTextColor(...cor)
  }
  /** "Rótulo: valor" dentro de uma célula, com o rótulo em negrito */
  const celula = (rotulo: string, valor: string, x: number, larg: number, yy: number) => {
    fonte(9, true); doc.text(rotulo, x + 2, yy)
    const lr = doc.getTextWidth(rotulo) + 1.2
    fonte(9); doc.text((doc.splitTextToSize(limpo(valor || '-'), larg - lr - 4) as string[])[0] || '-', x + 2 + lr, yy)
  }

  cabecalho()

  // Título
  y = 44
  fonte(14); doc.text(limpo(r.titulo), 105, y, { align: 'center' })
  y += 7

  // Quadro: cliente / consultor + e-mail / data + hora
  const alt = 6.4
  doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.2)
  doc.rect(L, y, W, alt * 3)
  doc.line(L, y + alt, R, y + alt); doc.line(L, y + alt * 2, R, y + alt * 2)
  doc.line(L + W / 2, y + alt, L + W / 2, y + alt * 3)
  celula('Cliente:', d.cliente, L, W, y + 4.4)
  celula('Consultor(a):', d.consultor.nome, L, W / 2, y + alt + 4.4)
  celula('E-mail:', d.consultor.email || '-', L + W / 2, W / 2, y + alt + 4.4)
  celula('Data:', dataBR(r.data), L, W / 2, y + alt * 2 + 4.4)
  celula('Hora:', horarioTexto(r.entrada, r.saida) || '-', L + W / 2, W / 2, y + alt * 2 + 4.4)
  y += alt * 3 + 5

  // Objetivo
  if (r.objetivo.trim()) {
    const rot = 'Observações Gerais / Objetivo:'
    fonte(9, true); const lr = doc.getTextWidth(rot) + 1.5
    fonte(9)
    const linhas = doc.splitTextToSize(limpo(r.objetivo.trim()), W - lr - 4) as string[]
    const h = Math.max(alt, linhas.length * 4.2 + 2.4)
    garantir(h + 4)
    doc.setDrawColor(190, 190, 190); doc.rect(L, y, W, h)
    fonte(9, true); doc.text(rot, L + 2, y + 4.4)
    fonte(9); linhas.forEach((ln, i) => doc.text(ln, L + 2 + lr, y + 4.4 + i * 4.2))
    y += h + 6
  }

  // Anotações
  const RECUO = 7
  for (const item of itensComConteudo(r.itens)) {
    if (item.tipo === 'titulo') {
      garantir(12)
      y += 2
      fonte(10.5, true); doc.text(limpo(item.texto.trim()), L, y)
      y += 6
      continue
    }
    const linhas = item.texto.trim() ? (() => { fonte(9.5); return doc.splitTextToSize(limpo(item.texto.trim()), W - RECUO) as string[] })() : []
    // o visto e a primeira linha nunca ficam sozinhos no pé da página
    garantir(Math.min(linhas.length, 3) * 4.4 + 2)
    // visto (desenhado: a fonte do PDF não tem o sinal)
    doc.setDrawColor(230, 150, 30); doc.setLineWidth(0.6)
    doc.line(L + 1.2, y - 1.4, L + 2.4, y - 0.2); doc.line(L + 2.4, y - 0.2, L + 4.6, y - 3)
    fonte(9.5)
    linhas.forEach(ln => { garantir(4.4); doc.text(ln, L + RECUO, y); y += 4.4 })
    if (!linhas.length) y += 1
    const imgs = item.fotos.map(f => d.fotos.get(f)).filter(Boolean) as ImagemPdf[]
    const grupos = linhasDeFotos(imgs, W - RECUO)
    let k = 0
    for (const grupo of grupos) {
      const h = grupo[0].h
      garantir(h + 3)
      let x = L + RECUO
      for (const t of grupo) { const img = imgs[k++]; doc.addImage(img.dataUrl, formato(img.dataUrl), x, y, t.w, t.h); x += t.w + 3 }
      y += h + 3
    }
    y += 3.5
  }

  // Assinaturas
  const a = r.assinaturas || {}
  garantir(46)
  y += 6
  const col = [L + 18, L + W / 2 + 12], largAss = 62
  const assinatura = (x: number, img: string | null | undefined, linhas: string[]) => {
    if (img) { try { doc.addImage(img, 'PNG', x, y, largAss, 20) } catch { /* assinatura ilegível: fica só a linha */ } }
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.2); doc.line(x, y + 21, x + largAss, y + 21)
    fonte(8.5); linhas.forEach((ln, i) => doc.text(limpo(ln), x, y + 25 + i * 3.8))
  }
  assinatura(col[0], a.consultor, [d.consultor.nome, d.consultor.cargo || 'Nutricionista', d.consultor.cpf ? `CPF: ${cpfBR(d.consultor.cpf)}` : ''].filter(Boolean))
  assinatura(col[1], a.cliente, [a.cliente_nome?.trim() || d.cliente, `CPF: ${a.cliente_doc?.trim() || ''}`])

  // Rodapé com a página em todas
  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p)
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2); doc.line(L, 286, R, 286)
    fonte(7, false, [80, 80, 80])
    doc.text(RODAPE, L, 290.5)
    doc.text(`Pág. ${p} de ${n}`, R, 290.5, { align: 'right' })
  }
  return doc.output('blob')
}
