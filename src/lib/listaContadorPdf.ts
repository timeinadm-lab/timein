// ============================================================
// Lista para o contador fazer os pagamentos (pedido do Gabriel, 01/10/2026):
// um PDF por dia de pagamento (ou o mês inteiro) com nome, CPF, PIX, banco,
// valor e uma caixinha para ticar. Só o que está PENDENTE entra — o que já foi
// pago aparece separado no fim, para conferência.
// ============================================================
export type LinhaContador = {
  nome: string
  cpf?: string | null
  pix?: string | null
  banco?: string | null       // "Banco · Ag 0001 · CC 12345-6"
  cliente?: string | null
  descricao?: string | null
  vencimento: string          // yyyy-MM-dd
  valor: number
  pago: boolean
}

const brl = (v: number) => 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBR = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}`
const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[×]/g, 'x')

export async function gerarListaContador(titulo: string, subtitulo: string, linhas: LinhaContador[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const L = 12, R = 285
  let y = 14
  const t = (s: string, x: number, yy: number, o?: { tam?: number; negrito?: boolean; cor?: [number, number, number]; direita?: boolean }) => {
    doc.setFont('helvetica', o?.negrito ? 'bold' : 'normal'); doc.setFontSize(o?.tam ?? 9)
    doc.setTextColor(...(o?.cor ?? [30, 30, 30]))
    doc.text(limpo(s), x, yy, o?.direita ? { align: 'right' } : undefined)
  }
  const cols = [
    { t: '', w: 7 }, { t: 'Nome', w: 58 }, { t: 'CPF', w: 30 }, { t: 'Chave PIX', w: 52 },
    { t: 'Banco / agência / conta', w: 58 }, { t: 'Vence', w: 20 }, { t: 'Valor', w: 48, dir: true },
  ]
  const cabecalho = () => {
    doc.setFillColor(15, 78, 48); doc.rect(0, 0, 297, 22, 'F')
    t(titulo, L, 10, { tam: 14, negrito: true, cor: [255, 255, 255] })
    t(subtitulo, L, 16.5, { tam: 8.5, cor: [200, 225, 210] })
    t(`Gerado em ${new Date().toLocaleString('pt-BR')}`, R, 16.5, { tam: 8, cor: [200, 225, 210], direita: true })
    y = 30
    doc.setFillColor(243, 244, 241); doc.rect(L, y - 4.2, R - L, 6.2, 'F')
    let x = L + 1
    cols.forEach(c => { t(c.t, c.dir ? x + c.w - 2 : x, y, { tam: 7.5, negrito: true, cor: [90, 90, 90], direita: c.dir }); x += c.w })
    y += 6
  }
  const linha = (l: LinhaContador) => {
    doc.setFontSize(8.6)
    const pedacos = [
      [''], doc.splitTextToSize(limpo(l.nome + (l.cliente ? `\n${l.cliente}` : '')), cols[1].w - 2),
      [l.cpf || '-'], doc.splitTextToSize(limpo(l.pix || '-'), cols[3].w - 2),
      doc.splitTextToSize(limpo(l.banco || '-'), cols[4].w - 2), [dataBR(l.vencimento)], [brl(l.valor)],
    ] as string[][]
    const alt = Math.max(...pedacos.map(p => p.length)) * 3.8 + 2.2
    if (y + alt > 196) { doc.addPage(); cabecalho() }
    // Caixinha para ticar
    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3); doc.rect(L + 1, y - 3.2, 3.6, 3.6)
    if (l.pago) { doc.setDrawColor(21, 128, 61); doc.line(L + 1.6, y - 1.4, L + 2.6, y - 0.2); doc.line(L + 2.6, y - 0.2, L + 4.2, y - 2.8) }
    let x = L + 1
    pedacos.forEach((p, i) => {
      p.forEach((ln, k) => t(ln, cols[i].dir ? x + cols[i].w - 2 : x, y + k * 3.8, {
        tam: i === 1 && k > 0 ? 7.5 : 8.6, negrito: i === 6 || (i === 1 && k === 0), cor: i === 1 && k > 0 ? [110, 110, 110] : [30, 30, 30], direita: cols[i].dir,
      }))
      x += cols[i].w
    })
    y += alt
    doc.setDrawColor(228, 228, 224); doc.setLineWidth(0.1); doc.line(L, y - 2.8, R, y - 2.8)
  }

  cabecalho()
  const aPagar = linhas.filter(l => !l.pago).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.nome.localeCompare(b.nome))
  const pagos = linhas.filter(l => l.pago).sort((a, b) => a.nome.localeCompare(b.nome))
  if (!aPagar.length) { t('Nada a pagar.', L, y); y += 8 }
  aPagar.forEach(linha)
  y += 2
  t(`A pagar: ${aPagar.length} pagamento(s)`, L, y, { tam: 10, negrito: true })
  t(brl(aPagar.reduce((s, l) => s + l.valor, 0)), R, y, { tam: 12, negrito: true, direita: true })
  y += 9
  if (pagos.length) {
    if (y > 170) { doc.addPage(); cabecalho() }
    t(`Já pagos (${pagos.length}) — para conferência`, L, y, { tam: 9, negrito: true, cor: [21, 128, 61] })
    y += 6
    pagos.forEach(linha)
    t(`Total já pago: ${brl(pagos.reduce((s, l) => s + l.valor, 0))}`, R, y + 2, { tam: 9.5, negrito: true, cor: [21, 128, 61], direita: true })
  }
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) { doc.setPage(i); t(`página ${i} de ${n}`, R, 204, { tam: 7, cor: [150, 150, 150], direita: true }) }
  return doc.output('blob')
}
