// ============================================================
// Comprovantes num PDF só (pedido do Gabriel, 19/10/2026): "só a planilha;
// os comprovantes eu peço à parte" — o zip com pasta (WinRAR) não subia.
// Capa com a lista (Anexo · nome · o quê · data · valor) e depois um
// comprovante por página, com faixa verde no topo dizendo de quem é. Foto
// entra ajustada à página; comprovante em PDF entra com cada página reduzida
// para caber embaixo da faixa. A ordem é a da lista recebida: o número do
// anexo é o mesmo que aparece na planilha (numerarAnexos).
// ============================================================
import { supabase } from './supabase'
import { parseStorage } from './storage'
import { criarPdf, limpo } from './pdfBase'

export type ItemComprovante = {
  pessoa: string          // nome completo
  descricao: string       // o quê ("Uber aeroporto x casa")
  valor: number
  data: string            // yyyy-MM-dd
  caminho: string | null  // arquivo no armazenamento (ou URL antiga)
  extra?: string          // "Recebe no Dia 20", "Semana 12/10 a 18/10 · Cliente"
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBr = (d: string) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : ''

/** Número do anexo de cada item, na ordem recebida (sem arquivo = null) */
export function numerarAnexos<T extends { caminho: string | null }>(itens: T[]): (number | null)[] {
  let n = 0
  return itens.map(i => (i.caminho ? ++n : null))
}

/** Baixa um arquivo gerado no navegador */
export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// A fonte padrão do PDF só tem o alfabeto latino: troca o resto por equivalentes
const winAnsi = (t: string) => limpo(t.normalize('NFC'))
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f]/g, ' ').replace(/[^ -~ -ÿ]/g, '')

async function baixar(caminho: string): Promise<Blob | null> {
  const onde = parseStorage(caminho, 'arquivos')
  if (!onde) return null
  const { data, error } = await supabase.storage.from(onde.bucket).download(onde.path)
  return error ? null : data
}

/** Foto → JPEG (corrige PNG com transparência e fotos enormes) */
async function paraJpeg(blob: Blob, maxLado = 1800): Promise<{ bytes: ArrayBuffer; w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const jpg = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.85))
    return jpg ? { bytes: await jpg.arrayBuffer(), w: c.width, h: c.height } : null
  } catch { return null }
}

export async function gerarPdfComprovantes(opts: {
  titulo: string          // "Comprovantes dos pagamentos"
  periodo: string         // "outubro de 2026"
  itens: ItemComprovante[]
  aoProgredir?: (t: string) => void
}): Promise<Blob> {
  const { titulo, periodo, itens, aoProgredir } = opts
  const anexos = numerarAnexos(itens)
  const totalAnexos = anexos.filter(Boolean).length
  const total = itens.reduce((s, i) => s + i.valor, 0)

  // 1. Capa: a lista
  const { doc, st, L, W, texto, cabecalho, secao, tabela, garantir } = await criarPdf(false)
  cabecalho('COMPROVANTES', titulo, periodo, `${itens.length} item(ns) · ${totalAnexos} comprovante(s) · total ${brl(total)} · gerado em ${new Date().toLocaleDateString('pt-BR')}`)
  secao('Lista')
  tabela(
    [{ titulo: 'Anexo', larg: 14 }, { titulo: 'Nome', larg: 46 }, { titulo: 'O quê', larg: 46 }, { titulo: 'Data', larg: 20 }, { titulo: 'Valor', larg: 22, direita: true }, { titulo: 'Onde', larg: 34 }],
    itens.map((i, k) => [anexos[k] ? String(anexos[k]) : 'Sem', i.pessoa, i.descricao, dataBr(i.data), brl(i.valor), i.extra || '']),
    k => (anexos[k] ? null : [254, 243, 199]),
  )
  garantir(10)
  doc.setFillColor(234, 246, 238); doc.rect(L, st.y - 4, W, 8, 'F')
  texto('Total', L + 2, st.y + 1, { tam: 10, negrito: true, cor: [15, 78, 48] })
  texto(brl(total), L + W - 2, st.y + 1, { tam: 11, negrito: true, cor: [15, 78, 48], alinhar: 'right' })
  st.y += 10
  if (itens.some((_, k) => !anexos[k])) {
    texto('Amarelo = sem comprovante anexado no sistema.', L, st.y, { tam: 8, cor: [120, 120, 120] })
  }

  // 2. Um comprovante por página
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const final = await PDFDocument.load(doc.output('arraybuffer'))
  const negrito = await final.embedFont(StandardFonts.HelveticaBold)
  const normal = await final.embedFont(StandardFonts.Helvetica)
  const A4: [number, number] = [595.28, 841.89]
  const VERDE = rgb(0.06, 0.31, 0.19), CLARO = rgb(0.75, 0.86, 0.79)
  const FAIXA = 46, MARGEM = 24, RODAPE = 26
  const cabe = (t: string, fonte: typeof normal, tam: number, larg: number) => {
    let s = winAnsi(t)
    if (fonte.widthOfTextAtSize(s, tam) <= larg) return s
    while (s.length > 1 && fonte.widthOfTextAtSize(s + '...', tam) > larg) s = s.slice(0, -1)
    return s + '...'
  }
  const novaPaginaComFaixa = (k: number, continua = false) => {
    const pg = final.addPage(A4)
    const [w, h] = A4
    const i = itens[k]
    pg.drawRectangle({ x: 0, y: h - FAIXA, width: w, height: FAIXA, color: VERDE })
    pg.drawText(cabe(`Anexo ${anexos[k]} de ${totalAnexos} · ${i.pessoa}${continua ? ' (continuação)' : ''}`, negrito, 12, w - 2 * MARGEM), { x: MARGEM, y: h - 20, size: 12, font: negrito, color: rgb(1, 1, 1) })
    pg.drawText(cabe([i.descricao, brl(i.valor), dataBr(i.data), i.extra].filter(Boolean).join(' · '), normal, 9, w - 2 * MARGEM), { x: MARGEM, y: h - 36, size: 9, font: normal, color: CLARO })
    return pg
  }
  // Área livre embaixo da faixa
  const area = { x: MARGEM, y: RODAPE, w: A4[0] - 2 * MARGEM, h: A4[1] - FAIXA - 12 - RODAPE }
  const encaixar = (w: number, h: number) => {
    const k = Math.min(area.w / w, area.h / h, 1.6)
    return { w: w * k, h: h * k, x: area.x + (area.w - w * k) / 2, y: area.y + area.h - h * k }
  }
  const aviso = (k: number, msg: string) => {
    const pg = novaPaginaComFaixa(k)
    pg.drawText(winAnsi(msg), { x: MARGEM, y: A4[1] - FAIXA - 40, size: 11, font: negrito, color: rgb(0.78, 0.15, 0.15) })
    pg.drawText('Veja o arquivo direto no sistema.', { x: MARGEM, y: A4[1] - FAIXA - 58, size: 10, font: normal, color: rgb(0.4, 0.4, 0.4) })
  }

  for (let k = 0; k < itens.length; k++) {
    const i = itens[k]
    if (!anexos[k] || !i.caminho) continue
    aoProgredir?.(`comprovante ${anexos[k]} de ${totalAnexos}`)
    const blob = await baixar(i.caminho)
    if (!blob) { aviso(k, 'Não foi possível baixar este comprovante.'); continue }
    const ehPdf = /\.pdf($|\?)/i.test(i.caminho) || blob.type === 'application/pdf'
    if (ehPdf) {
      try {
        const bytes = await blob.arrayBuffer()
        const origem = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const paginas = await final.embedPdf(origem, origem.getPageIndices())
        paginas.forEach((ep, n) => {
          const pg = novaPaginaComFaixa(k, n > 0)
          const r = encaixar(ep.width, ep.height)
          pg.drawRectangle({ x: r.x - 0.5, y: r.y - 0.5, width: r.w + 1, height: r.h + 1, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 0.6 })
          pg.drawPage(ep, { x: r.x, y: r.y, width: r.w, height: r.h })
        })
      } catch { aviso(k, 'Este comprovante em PDF está protegido ou com defeito.') }
      continue
    }
    const jpg = await paraJpeg(blob)
    if (!jpg) { aviso(k, 'Não foi possível abrir este comprovante (formato de imagem não suportado).'); continue }
    try {
      const img = await final.embedJpg(jpg.bytes)
      const pg = novaPaginaComFaixa(k)
      const r = encaixar(jpg.w, jpg.h)
      pg.drawRectangle({ x: r.x - 0.5, y: r.y - 0.5, width: r.w + 1, height: r.h + 1, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 0.6 })
      pg.drawImage(img, { x: r.x, y: r.y, width: r.w, height: r.h })
    } catch { aviso(k, 'Não foi possível abrir este comprovante.') }
  }

  // 3. Página X de Y em todas
  const paginas = final.getPages()
  const rotulo = winAnsi(`${titulo} · ${periodo}`)
  paginas.forEach((pg, n) => {
    const t = `${rotulo} · página ${n + 1} de ${paginas.length}`
    const { width } = pg.getSize()
    pg.drawText(winAnsi(t), { x: width - MARGEM - normal.widthOfTextAtSize(winAnsi(t), 7), y: 12, size: 7, font: normal, color: rgb(0.55, 0.55, 0.55) })
  })
  aoProgredir?.('salvando')
  const bytes = await final.save()
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}
