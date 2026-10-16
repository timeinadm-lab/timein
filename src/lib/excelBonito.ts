// ============================================================
// Excel apresentável (pedido de 16/10/2026: "bem redondo, bem bonito, bem
// apresentável"): título, cabeçalho verde, linhas zebradas, bordas, R$ nas
// colunas de dinheiro, filtro no cabeçalho, cabeçalho fixo e linha de total.
// Usa exceljs (só carrega quando baixa).
// ============================================================

export type TipoColuna = 'texto' | 'dinheiro' | 'numero' | 'data' | 'centro'
export type ColunaExcel = { titulo: string; largura?: number; tipo?: TipoColuna }
export type CorLinha = 'verde' | 'amarelo' | 'vermelho' | 'cinza' | null
export type AbaExcel = {
  nome: string
  titulo: string
  subtitulo?: string
  colunas: ColunaExcel[]
  linhas: (string | number | null)[][]
  cores?: CorLinha[]              // cor de fundo de cada linha (mesma ordem de linhas)
  total?: (string | number | null)[]
  rodape?: string
}

const VERDE = 'FF0F4E30'
const FUNDO: Record<Exclude<CorLinha, null>, string> = { verde: 'FFEAF6EE', amarelo: 'FFFFF6DD', vermelho: 'FFFDECEC', cinza: 'FFF1F1EF' }

export async function baixarExcelBonito(nomeArquivo: string, abas: AbaExcel[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'TIN · Time IN'
  wb.created = new Date()
  for (const aba of abas) {
    const ws = wb.addWorksheet(aba.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] })
    const n = aba.colunas.length
    ws.columns = aba.colunas.map(c => ({ width: c.largura || 16 }))

    // Título e subtítulo
    ws.mergeCells(1, 1, 1, n)
    const t = ws.getCell(1, 1)
    t.value = aba.titulo
    t.font = { bold: true, size: 15, color: { argb: VERDE } }
    ws.getRow(1).height = 24
    ws.mergeCells(2, 1, 2, n)
    const st = ws.getCell(2, 1)
    st.value = aba.subtitulo || ''
    st.font = { size: 10, color: { argb: 'FF6B716C' } }

    // Cabeçalho (linha 4)
    const cab = ws.getRow(4)
    aba.colunas.forEach((c, i) => {
      const cel = cab.getCell(i + 1)
      cel.value = c.titulo
      cel.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
      cel.alignment = { vertical: 'middle', horizontal: c.tipo === 'dinheiro' || c.tipo === 'numero' ? 'right' : c.tipo === 'centro' || c.tipo === 'data' ? 'center' : 'left', wrapText: true }
      cel.border = { bottom: { style: 'thin', color: { argb: VERDE } } }
    })
    cab.height = 22

    const borda = { style: 'thin' as const, color: { argb: 'FFE1E4E0' } }
    aba.linhas.forEach((valores, li) => {
      const row = ws.getRow(5 + li)
      const cor = aba.cores?.[li]
      valores.forEach((v, ci) => {
        const c = aba.colunas[ci]
        const cel = row.getCell(ci + 1)
        cel.value = v === null || v === undefined ? '' : v
        cel.font = { size: 10, color: { argb: 'FF1D211F' } }
        cel.border = { top: borda, bottom: borda, left: borda, right: borda }
        cel.alignment = { vertical: 'middle', horizontal: c?.tipo === 'dinheiro' || c?.tipo === 'numero' ? 'right' : c?.tipo === 'centro' || c?.tipo === 'data' ? 'center' : 'left', wrapText: c?.tipo === 'texto' }
        if (c?.tipo === 'dinheiro' && typeof v === 'number') cel.numFmt = '"R$" #,##0.00'
        const fundo = cor ? FUNDO[cor] : li % 2 ? 'FFF8F8F6' : null
        if (fundo) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fundo } }
      })
    })

    let ultima = 4 + aba.linhas.length
    if (aba.total) {
      ultima++
      const row = ws.getRow(ultima)
      aba.total.forEach((v, ci) => {
        const cel = row.getCell(ci + 1)
        cel.value = v === null || v === undefined ? '' : v
        cel.font = { bold: true, size: 11, color: { argb: VERDE } }
        cel.border = { top: { style: 'medium', color: { argb: VERDE } } }
        cel.alignment = { horizontal: aba.colunas[ci]?.tipo === 'dinheiro' || aba.colunas[ci]?.tipo === 'numero' ? 'right' : 'left' }
        if (aba.colunas[ci]?.tipo === 'dinheiro' && typeof v === 'number') cel.numFmt = '"R$" #,##0.00'
      })
      row.height = 20
    }
    if (aba.linhas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + aba.linhas.length, column: n } }
    if (aba.rodape) {
      const r = ultima + 2
      ws.mergeCells(r, 1, r, n)
      const c = ws.getCell(r, 1)
      c.value = aba.rodape
      c.font = { italic: true, size: 9, color: { argb: 'FF8A918B' } }
      c.alignment = { wrapText: true }
      ws.getRow(r).height = 30
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
  }
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${nomeArquivo}.xlsx`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
