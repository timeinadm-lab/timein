// ============================================================
// Imagens: diminuir a foto antes de subir (o plano gratuito tem 1 GB de
// arquivos — foto de celular tem 2 a 5 MB, diminuída fica com ~200 KB) e
// gerar miniatura para colocar dentro de PDF.
// Se não der para mexer na imagem (formato que o navegador não abre), usa a
// original — nunca impede o envio.
// ============================================================

/** Foto → JPEG com no máximo `maxLado` px. PDF e outros arquivos passam iguais. */
export async function comprimirImagem(file: File, maxLado = 1600, qualidade = 0.75): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bmp = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // PNG com fundo transparente não fica preto
    ctx.drawImage(bmp, 0, 0, w, h)
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', qualidade))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}

/** Baixa uma imagem (link assinado) e devolve uma miniatura JPEG para o PDF; null se não for imagem */
export async function miniaturaJpeg(url: string, maxLado = 700, qualidade = 0.7): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    const blob = await resp.blob()
    if (!blob.type.startsWith('image/')) return null
    const bmp = await createImageBitmap(blob)
    const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/jpeg', qualidade), w, h }
  } catch {
    return null
  }
}
