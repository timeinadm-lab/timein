// PDF do contrato a partir do texto já preenchido. Reusa a fonte e o verde
// dos outros PDFs (pdfBase). O texto em si vem de contratoDocumento.ts.
import { limpo } from './pdfBase'

export async function blobDoContrato(opts: { titulo: string; linha?: string; corpo: string }): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 18
  const R = 192
  const W = R - L
  const limite = 280
  let y = 16

  const texto = (t: string, x: number, yy: number, opt?: { tam?: number; negrito?: boolean; cor?: [number, number, number]; alinhar?: 'right' }) => {
    doc.setFont('helvetica', opt?.negrito ? 'bold' : 'normal')
    doc.setFontSize(opt?.tam ?? 11)
    doc.setTextColor(...(opt?.cor ?? [30, 30, 30]))
    doc.text(limpo(t), x, yy, opt?.alinhar === 'right' ? { align: 'right' } : undefined)
  }
  const nova = () => { doc.addPage(); y = 18 }

  doc.setFillColor(15, 78, 48)
  doc.rect(0, 0, 210, 24, 'F')
  texto('TIME IN · CONTRATO', L, 9, { tam: 8, cor: [190, 220, 200] })
  const tituloLinhas = doc.splitTextToSize(limpo(opts.titulo), W) as string[]
  tituloLinhas.slice(0, 2).forEach((l, i) => texto(l, L, 16 + i * 5, { tam: 13, negrito: true, cor: [255, 255, 255] }))
  y = 34
  if (opts.linha) {
    const ls = doc.splitTextToSize(limpo(opts.linha), W) as string[]
    ls.forEach(l => { texto(l, L, y, { tam: 9, cor: [90, 90, 90] }); y += 4.2 })
    y += 3
  }

  for (const bruta of (opts.corpo || '').replace(/\r\n/g, '\n').split('\n')) {
    if (!bruta.trim()) { y += 3; continue }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    const ls = doc.splitTextToSize(limpo(bruta), W) as string[]
    for (const l of ls) {
      if (y > limite) nova()
      texto(l, L, y, { tam: 11 })
      y += 5.2
    }
  }

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p)
    texto(`Time IN · página ${p} de ${n}`, R, 292, { tam: 8, cor: [150, 150, 150], alinhar: 'right' })
  }
  return doc.output('blob')
}

export function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}
