// ============================================================
// Anexos dentro do Excel (pedido de 20/10/2026, Auditoria GR): "na hora de
// gerar o relatório ter os comprovantes ali também, todos ali". Baixa cada
// anexo do armazenamento e devolve imagens prontas para a planilha: foto vira
// JPEG menor; PDF (nota fiscal, boleto) tem as páginas desenhadas como imagem.
// Nunca trava o relatório: o que não abrir sai com um aviso no lugar.
// ============================================================
import { supabase } from './supabase'
import { parseStorage } from './storage'
import type { ImagemExcel } from './excelBonito'

const MAX_LADO = 1400       // nítido para ler nota/comprovante, leve no arquivo
const MAX_PAGINAS = 4       // PDF muito comprido: as primeiras páginas e um aviso

async function baixar(caminho: string): Promise<Blob | null> {
  const onde = parseStorage(caminho, 'arquivos')
  if (!onde) return null
  const { data, error } = await supabase.storage.from(onde.bucket).download(onde.path)
  return error ? null : data
}

async function canvasParaJpeg(c: HTMLCanvasElement): Promise<ImagemExcel | null> {
  const jpg = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.82))
  return jpg ? { bytes: await jpg.arrayBuffer(), w: c.width, h: c.height, ext: 'jpeg' } : null
}

async function fotoParaJpeg(blob: Blob): Promise<ImagemExcel | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height)
    return await canvasParaJpeg(c)
  } catch { return null }
}

async function paginasDoPdf(blob: Blob): Promise<{ imagens: ImagemExcel[]; total: number }> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.js?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const imagens: ImagemExcel[] = []
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGINAS); p++) {
    const pagina = await doc.getPage(p)
    const base = pagina.getViewport({ scale: 1 })
    const viewport = pagina.getViewport({ scale: Math.min(3, MAX_LADO / Math.max(base.width, base.height)) })
    const c = document.createElement('canvas'); c.width = Math.round(viewport.width); c.height = Math.round(viewport.height)
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    await pagina.render({ canvasContext: ctx, viewport }).promise
    const img = await canvasParaJpeg(c)
    if (img) imagens.push(img)
  }
  return { imagens, total: doc.numPages }
}

/** caminho → imagens (e aviso, se algo não abriu) */
export async function imagensDosAnexos(caminhos: string[], aoProgredir?: (t: string) => void) {
  const mapa = new Map<string, { imagens: ImagemExcel[]; aviso?: string }>()
  const unicos = [...new Set(caminhos)]
  for (let i = 0; i < unicos.length; i++) {
    const caminho = unicos[i]
    aoProgredir?.(`anexo ${i + 1} de ${unicos.length}`)
    const blob = await baixar(caminho)
    if (!blob) { mapa.set(caminho, { imagens: [], aviso: 'Não foi possível baixar este arquivo: abra pela ficha no sistema.' }); continue }
    const ehPdf = /\.pdf($|\?)/i.test(caminho) || blob.type === 'application/pdf'
    if (ehPdf) {
      try {
        const { imagens, total } = await paginasDoPdf(blob)
        mapa.set(caminho, { imagens, aviso: total > imagens.length ? `PDF com ${total} páginas: aqui estão as ${imagens.length} primeiras. O arquivo inteiro está na ficha.` : undefined })
      } catch { mapa.set(caminho, { imagens: [], aviso: 'PDF protegido ou com defeito: abra pela ficha no sistema.' }) }
      continue
    }
    const img = await fotoParaJpeg(blob)
    mapa.set(caminho, img ? { imagens: [img] } : { imagens: [], aviso: 'Formato que não dá para mostrar na planilha: abra pela ficha no sistema.' })
  }
  return mapa
}
