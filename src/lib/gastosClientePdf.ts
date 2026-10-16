// ============================================================
// PDF dos gastos com o cliente (pedido de 16/10/2026): a tabela dos gastos
// e, depois, a foto de cada comprovante ("Anexo 1, 2…"). Comprovante em PDF
// entra inteiro no fim do arquivo (pdf-lib junta as páginas).
// ============================================================
import { supabase } from './supabase'
import { criarPdf } from './pdfBase'

export type GastoPdf = {
  data: string; nome: string; observacao?: string | null; valor: number; pessoa?: string | null; comprovante_url?: string | null
}
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

async function baixar(caminho: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from('arquivos').download(caminho)
  return error ? null : data
}
async function imagemJpeg(blob: Blob, maxLado = 1600): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height)
    return { dataUrl: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height }
  } catch { return null }
}

export async function gerarPdfGastosCliente(cliente: string, periodo: string, gastos: GastoPdf[], aoProgredir?: (t: string) => void): Promise<Blob> {
  const pdf = await criarPdf(false)
  const { doc, st, L, W, texto, cabecalho, secao, tabela, garantir, novaPagina, numerar } = pdf
  const total = gastos.reduce((t, g) => t + g.valor, 0)
  cabecalho('GASTOS COM O CLIENTE', cliente, periodo, `${gastos.length} gasto(s) · total ${brl(total)} · gerado em ${new Date().toLocaleDateString('pt-BR')}`)

  // Anexos: numera só quem tem comprovante
  let n = 0
  const anexo = gastos.map(g => (g.comprovante_url ? ++n : 0))

  secao('Gastos')
  tabela(
    [{ titulo: 'Data', larg: 18 }, { titulo: 'Gasto', larg: 38 }, { titulo: 'Observação', larg: 52 }, { titulo: 'Para quem', larg: 30 }, { titulo: 'Valor', larg: 22, direita: true }, { titulo: 'Comprovante', larg: 22 }],
    gastos.map((g, i) => [dataBr(g.data), g.nome, g.observacao || '', g.pessoa || '', brl(g.valor), anexo[i] ? `Anexo ${anexo[i]}` : 'Sem comprovante']),
    i => (gastos[i].comprovante_url ? null : [254, 243, 199]),
  )
  garantir(10)
  doc.setFillColor(234, 246, 238); doc.rect(L, st.y - 4, W, 8, 'F')
  texto('Total', L + 2, st.y + 1, { tam: 10, negrito: true, cor: [15, 78, 48] })
  texto(brl(total), L + W - 2, st.y + 1, { tam: 11, negrito: true, cor: [15, 78, 48], alinhar: 'right' })
  st.y += 10

  // Comprovantes em foto
  const pdfsParaJuntar: { bytes: ArrayBuffer; legenda: string }[] = []
  if (n > 0) {
    novaPagina()
    secao('Comprovantes')
    for (let i = 0; i < gastos.length; i++) {
      const g = gastos[i]
      if (!g.comprovante_url) continue
      aoProgredir?.(`Comprovante ${anexo[i]} de ${n}…`)
      const legenda = `Anexo ${anexo[i]} · ${g.nome} · ${brl(g.valor)} · ${dataBr(g.data)}${g.pessoa ? ' · ' + g.pessoa : ''}`
      const blob = await baixar(g.comprovante_url)
      const ehPdf = /\.pdf$/i.test(g.comprovante_url) || blob?.type === 'application/pdf'
      if (blob && ehPdf) {
        pdfsParaJuntar.push({ bytes: await blob.arrayBuffer(), legenda })
        garantir(14)
        texto(legenda, L, st.y, { tam: 9, negrito: true })
        texto('Comprovante em PDF: está nas páginas finais deste arquivo.', L, st.y + 4.5, { tam: 8, cor: [110, 110, 110] })
        st.y += 12
        continue
      }
      const img = blob ? await imagemJpeg(blob) : null
      if (!img) {
        garantir(12); texto(legenda, L, st.y, { tam: 9, negrito: true })
        texto('Não foi possível abrir o comprovante.', L, st.y + 4.5, { tam: 8, cor: [200, 38, 38] }); st.y += 12; continue
      }
      // Foto grande: até a largura da página e no máximo ~metade da altura
      const maxH = 118
      let w = W, h = (img.h / img.w) * w
      if (h > maxH) { h = maxH; w = (img.w / img.h) * h }
      garantir(h + 12)
      texto(legenda, L, st.y, { tam: 9, negrito: true })
      st.y += 2.5
      doc.setDrawColor(220, 222, 218); doc.setLineWidth(0.3)
      doc.rect(L, st.y, w, h)
      doc.addImage(img.dataUrl, 'JPEG', L, st.y, w, h)
      st.y += h + 8
    }
  }
  numerar(`Gastos · ${cliente} · ${periodo}`)
  const base = doc.output('arraybuffer')
  if (!pdfsParaJuntar.length) return new Blob([base], { type: 'application/pdf' })

  // Junta os comprovantes em PDF no fim
  aoProgredir?.('Juntando comprovantes em PDF…')
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const final = await PDFDocument.load(base)
  const fonte = await final.embedFont(StandardFonts.HelveticaBold)
  for (const p of pdfsParaJuntar) {
    try {
      const src = await PDFDocument.load(p.bytes, { ignoreEncryption: true })
      const paginas = await final.copyPages(src, src.getPageIndices())
      paginas.forEach((pg, k) => {
        final.addPage(pg)
        if (k === 0) {
          const { height } = pg.getSize()
          pg.drawRectangle({ x: 0, y: height - 22, width: pg.getSize().width, height: 22, color: rgb(0.06, 0.31, 0.19) })
          pg.drawText(p.legenda.replace(/[–—]/g, '-').slice(0, 110), { x: 12, y: height - 15, size: 9, font: fonte, color: rgb(1, 1, 1) })
        }
      })
    } catch { /* PDF protegido/corrompido: fica só a menção na lista */ }
  }
  const bytes = await final.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
