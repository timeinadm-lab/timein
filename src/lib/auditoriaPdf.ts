// ============================================================
// Relatório da auditoria (migração 079) — num PDF só, no formato pedido
// pelo cliente MELI (04/10/2026):
//  · nota em % já com os pesos + classificação e faixas;
//  · SEM gráfico de pizza (o % de conformes confundia com a nota);
//  · gráfico de barras: % de não conformidade em cada grupo;
//  · TODAS as perguntas por grupo e seção, com C / NC / N/A, o peso ao lado,
//    a observação do auditor e as fotos.
// ============================================================
import { resumoAuditoria, textoDasFaixas, corDaFaixa } from './auditoria'
import type { Faixa, Resposta } from './auditoria'

export type FotoPdf = { dataUrl: string; w: number; h: number }
export type DadosAuditoriaPdf = {
  titulo: string
  faixas: Faixa[]
  cliente?: string | null
  unidade?: string | null
  concessionaria?: string | null
  auditor?: string | null
  email?: string | null
  data: string                 // YYYY-MM-DD
  inicio?: string | null
  fim?: string | null
  observacoes?: string | null
  rascunho?: boolean
  logo?: FotoPdf | null
  itens: { grupo: string; secao?: string | null; texto: string; peso: number; resposta: Resposta | null; observacao?: string | null; fotos: FotoPdf[] }[]
}

const VERDE: [number, number, number] = [15, 78, 48]
const CINZA_CAB: [number, number, number] = [228, 230, 226]
const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[×]/g, 'x').replace(/[✓✔]/g, '')
const dataBr = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}`
const pesoTxt = (p: number) => String(p).replace('.', ',')

export async function gerarPdfAuditoria(d: DadosAuditoriaPdf): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 14, R = 196, W = R - L
  const TOPO = 30, FUNDO = 282
  let y = 0
  const r = resumoAuditoria(d.itens, d.faixas)

  const t = (s: string, x: number, yy: number, o?: { tam?: number; negrito?: boolean; cor?: [number, number, number]; direita?: boolean; centro?: boolean }) => {
    doc.setFont('helvetica', o?.negrito ? 'bold' : 'normal')
    doc.setFontSize(o?.tam ?? 9.5)
    doc.setTextColor(...(o?.cor ?? [33, 33, 33]))
    doc.text(limpo(s), x, yy, o?.direita ? { align: 'right' } : o?.centro ? { align: 'center' } : undefined)
  }
  const quebra = (s: string, larg: number, tam = 9.5, negrito = false) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam)
    return doc.splitTextToSize(limpo(s), larg) as string[]
  }
  const cabecalho = () => {
    if (d.logo) {
      const h = 14, w = (d.logo.w / d.logo.h) * h
      doc.addImage(d.logo.dataUrl, 'PNG', L, 8, w, h)
    } else {
      t('Fernanda Stinchi', L, 16, { tam: 13, negrito: true, cor: VERDE })
      t('qualidade + nutrição', L, 20.5, { tam: 7.5, cor: [110, 110, 110] })
    }
    // Aviso só quando o relatório está incompleto (todas respondidas = sai limpo, mesmo antes de finalizar)
    if (d.rascunho && r.pendentes > 0) t(`PRÉVIA - faltam ${r.pendentes} pergunta(s)`, R, 15, { tam: 8, negrito: true, cor: [200, 38, 38], direita: true })
    doc.setDrawColor(220, 222, 218); doc.setLineWidth(0.3); doc.line(L, 25, R, 25)
  }
  const novaPagina = () => { doc.addPage(); cabecalho(); y = TOPO + 2 }
  const garantir = (alt: number) => { if (y + alt > FUNDO) { novaPagina(); return true } return false }

  // ── Página 1: identificação ──
  cabecalho()
  y = TOPO + 6
  t(d.titulo, 105, y, { tam: 17, centro: true })
  y += 6
  // Cabeçalho no formato do relatório MELI: Cliente / Consultor(a) | E-mail / Data das… às…
  const linhasInfo: [string, string, string?, string?][] = [
    ['Cliente', [d.cliente, d.unidade].filter(Boolean).join(' - ') || '-'],
    ['Consultor(a)', d.auditor || '-', 'E-mail', d.email || '-'],
    ...(d.concessionaria ? [['Concessionária', d.concessionaria] as [string, string]] : []),
    ['Data', `${dataBr(d.data)}${d.inicio ? ` das ${d.inicio.slice(0, 5)}` : ''}${d.fim ? ` às ${d.fim.slice(0, 5)}h` : ''}`],
  ]
  doc.setDrawColor(210, 212, 208); doc.setLineWidth(0.25)
  const campo = (k: string, v: string, x: number, larg: number) => {
    doc.rect(x, y, larg, 7)
    t(k + ':', x + 2, y + 4.8, { tam: 9.5, negrito: true })
    const vx = x + 2 + doc.getTextWidth(limpo(k + ': ')) + 1.5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    let val = limpo(v)
    while (val.length > 3 && doc.getTextWidth(val) > x + larg - vx - 2) val = val.slice(0, -1)
    t(val === limpo(v) ? val : val.trimEnd() + '...', vx, y + 4.8, { tam: 9.5 })
  }
  for (const [k, v, k2, v2] of linhasInfo) {
    if (k2) { const corte = W * 0.55; campo(k, v, L, corte); campo(k2, v2 || '-', L + corte, W - corte) }
    else campo(k, v, L, W)
    y += 7
  }

  // ── Nota e classificação ──
  y += 5
  const cor = corDaFaixa(r.classificacao?.rotulo, d.faixas)
  doc.setFillColor(...CINZA_CAB); doc.rect(L, y, W / 2, 8, 'F')
  doc.setFillColor(...cor); doc.rect(L + W / 2, y, W / 2, 8, 'F')
  t(`Nota: ${r.nota == null ? '-' : r.nota + '%'}`, L + W / 4, y + 5.6, { tam: 11, negrito: true, centro: true })
  t(`Classificação: ${r.classificacao?.rotulo || '-'}`, L + (3 * W) / 4, y + 5.6, { tam: 11, negrito: true, centro: true, cor: [255, 255, 255] })
  y += 8
  const faixasTxt = textoDasFaixas(d.faixas)
  const fw = W / faixasTxt.length
  faixasTxt.forEach((f, i) => {
    const x = L + i * fw
    doc.setDrawColor(210, 212, 208); doc.rect(x, y, fw, 11)
    const atual = f.rotulo === r.classificacao?.rotulo
    doc.setFont('helvetica', atual ? 'bold' : 'normal'); doc.setFontSize(9)
    const lw = doc.getTextWidth(limpo(f.rotulo))
    doc.setFillColor(...corDaFaixa(f.rotulo, d.faixas)); doc.circle(x + fw / 2 - lw / 2 - 1.2, y + 3.9, 1.4, 'F')
    t(f.rotulo, x + fw / 2 + 1.5, y + 4.8, { tam: 9, centro: true, negrito: atual })
    t(f.texto, x + fw / 2, y + 9, { tam: 8.5, centro: true, cor: [90, 90, 90] })
  })
  y += 11
  // Como a nota é calculada (para ninguém comparar com % de perguntas)
  const pesos = r.grupos.filter(g => g.peso != null).map(g => `${g.grupo} peso ${pesoTxt(g.peso!)}`).join(' · ')
  const expl = quebra(`A nota considera o peso de cada pergunta${pesos ? ` (${pesos})` : ''}: pontos das perguntas conformes ÷ pontos das perguntas avaliadas. Perguntas N/A não entram na conta. ${r.conformes} conformes, ${r.naoConformes} não conformes${r.na ? `, ${r.na} N/A` : ''}${r.pendentes ? `, ${r.pendentes} sem resposta` : ''}.`, W - 4, 8)
  y += 4.5
  expl.forEach(l => { t(l, L + 2, y, { tam: 8, cor: [100, 100, 100] }); y += 3.6 })

  // ── Gráfico de barras: não conformidade por grupo ──
  y += 4
  const gruposG = r.grupos.filter(g => g.conformes + g.naoConformes > 0)
  const altG = 10 + gruposG.length * 10 + 4
  doc.setFillColor(...CINZA_CAB); doc.rect(L, y, W, 7.5, 'F')
  t('Não conformidade por grupo', 105, y + 5.2, { tam: 10.5, centro: true })
  doc.setDrawColor(210, 212, 208); doc.rect(L, y, W, altG)
  y += 12
  const xBar = L + 48, wBar = W - 48 - 40
  // linhas de grade a cada 20%
  doc.setDrawColor(235, 236, 233); doc.setLineWidth(0.2)
  for (let p = 0; p <= 100; p += 20) {
    const x = xBar + (wBar * p) / 100
    doc.line(x, y - 3, x, y + gruposG.length * 10 - 3)
    t(`${p}%`, x, y + gruposG.length * 10, { tam: 6.5, centro: true, cor: [150, 150, 150] })
  }
  for (const g of gruposG) {
    const pct = g.ncPct || 0
    t(g.grupo, xBar - 3, y + 2.6, { tam: 9, direita: true, cor: [70, 70, 70] })
    doc.setFillColor(239, 68, 68); doc.rect(xBar, y - 1.8, Math.max(0.6, (wBar * pct) / 100), 6, 'F')
    t(`${Math.round(pct)}%`, xBar + (wBar * pct) / 100 + 2, y + 2.6, { tam: 9, negrito: true, cor: [200, 38, 38] })
    t(`${g.naoConformes} de ${g.conformes + g.naoConformes}${g.peso != null ? ` · peso ${pesoTxt(g.peso)}` : ''}`, R - 2, y + 2.6, { tam: 7.5, direita: true, cor: [120, 120, 120] })
    y += 10
  }
  y += 6

  if (d.observacoes?.trim()) {
    const ls = quebra(d.observacoes.trim(), W - 6, 9)
    garantir(12 + ls.length * 4.2)
    t('Observações gerais', L, y, { tam: 10, negrito: true, cor: VERDE }); y += 5
    ls.forEach(l => { t(l, L + 2, y, { tam: 9 }); y += 4.2 })
    y += 3
  }

  // ── Todas as perguntas ──
  const xC = R - 39, xNC = R - 26, xNA = R - 13, wCol = 13
  const wTxt = xC - L - 4
  let paginaDoCabecalho = 0
  const cabTabela = (secao: string) => {
    doc.setFillColor(238, 239, 236); doc.rect(L, y, W, 6.5, 'F')
    doc.setDrawColor(210, 212, 208); doc.rect(L, y, W, 6.5)
    t(secao, L + 2, y + 4.5, { tam: 9.5, negrito: true })
    paginaDoCabecalho = doc.getNumberOfPages()
    ;[['C', xC], ['N/C', xNC], ['N/A', xNA]].forEach(([s, x]) => t(String(s), Number(x) + wCol / 2, y + 4.5, { tam: 8.5, negrito: true, centro: true }))
    y += 6.5
  }
  // Na ordem do checklist, uma tabela por seção (padrão MELI: Estrutura e Boas
  // Práticas misturadas dentro das seções; o peso aparece em cada pergunta)
  let secaoAtual: string | undefined = undefined
  for (const it of d.itens) {
    const nomeSecao = it.secao || it.grupo || 'Itens gerais'
    if (nomeSecao !== secaoAtual) {
      garantir(16)
      y += secaoAtual === undefined ? 0 : 3
      cabTabela(nomeSecao)
      secaoAtual = nomeSecao
    }
    // O "(peso N)" quebra junto com o texto: nunca invade a coluna C
    const pesoS = `(peso ${pesoTxt(it.peso)})` // espaço que não quebra: "(peso 2)" fica inteiro
    const linhas = quebra(it.texto + ' ' + pesoS, wTxt, 9)
    const obs = it.observacao?.trim() ? quebra('Obs.: ' + it.observacao.trim(), wTxt, 8) : []
    const altTexto = Math.max(6.5, linhas.length * 4 + 2.5) + (obs.length ? obs.length * 3.6 + 1.5 : 0)
    // página nova (pela pergunta ou pelas fotos da anterior): repete o cabeçalho da tabela
    if (garantir(altTexto) || paginaDoCabecalho !== doc.getNumberOfPages()) cabTabela(nomeSecao)
    const nc = it.resposta === 'NC'
    if (nc) { doc.setFillColor(254, 242, 242); doc.rect(L, y, W, altTexto, 'F') }
    doc.setDrawColor(215, 217, 213); doc.setLineWidth(0.2)
    doc.rect(L, y, W, altTexto)
    ;[xC, xNC, xNA].forEach(x => doc.line(x, y, x, y + altTexto))
    let yy = y + 4.3
    linhas.forEach((l, i) => {
      const ultima = i === linhas.length - 1 && l.endsWith(pesoS)
      const corpo = ultima ? l.slice(0, -pesoS.length) : l
      t(corpo, L + 2, yy, { tam: 9 })
      if (ultima) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        t(pesoS, L + 2 + doc.getTextWidth(limpo(corpo)), yy, { tam: 7.5, cor: [120, 120, 120] })
      }
      yy += 4
    })
    obs.forEach(l => { t(l, L + 2, yy + 0.3, { tam: 8, cor: [150, 60, 20] }); yy += 3.6 })
    const col = it.resposta === 'C' ? xC : it.resposta === 'NC' ? xNC : it.resposta === 'NA' ? xNA : null
    if (col != null) t('X', col + wCol / 2, y + altTexto / 2 + 1.6, { tam: 11, centro: true, cor: it.resposta === 'C' ? [22, 150, 90] : it.resposta === 'NC' ? [220, 38, 38] : [110, 110, 110] })
    y += altTexto
    // Fotos da pergunta (3 por linha)
    if (it.fotos.length) {
      const fh = 38, gap = 3
      let x = L + 2
      y += 2
      if (garantir(fh + 4)) { /* fotos começam na página nova */ }
      for (const f of it.fotos) {
        const fw2 = Math.min(58, (f.w / f.h) * fh)
        if (x + fw2 > R) { x = L + 2; y += fh + gap; if (garantir(fh + 4)) { /* nova página */ } }
        try { doc.addImage(f.dataUrl, 'JPEG', x, y, fw2, fh) } catch { /* imagem inválida: pula */ }
        x += fw2 + gap
      }
      y += fh + 3
    }
  }

  // ── Rodapé com página ──
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setDrawColor(220, 222, 218); doc.setLineWidth(0.3); doc.line(L, 287, R, 287)
    t('Consultoria Fernanda Stinchi - www.fernandastinchi.com.br', L, 291, { tam: 7, cor: [110, 110, 110] })
    t(`Pág. ${i} de ${total}`, R, 291, { tam: 7, cor: [110, 110, 110], direita: true })
  }
  return doc.output('blob')
}
