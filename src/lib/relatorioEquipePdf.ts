// ============================================================
// Relatório de trabalho da equipe (semana ou mês) — para entregar à chefe.
// Pedido do Gabriel (01/10/2026): tudo escrito, não só números — cada
// atividade pelo nome, cada reunião, cada supervisão, cada compra com o
// comprovante. Layout caprichado: cabeçalho verde, resumo em quadros,
// seções por dia, caixa com saldo e anexo com as fotos dos comprovantes.
// ============================================================
import type { Periodo, SaldoCaixa } from './equipe'
import { formatLocalTime } from './utils'

export type DadosRelatorioEquipe = {
  nome: string
  papel: string
  periodo: Periodo
  atividades: { data: string; nome: string; notas?: string | null; feito: boolean | null }[]
  compromissos: { inicio: string; categoria: string; titulo: string; cliente?: string | null; situacao: string; notas?: string | null }[]
  supervisoes: { data: string; cliente: string; unidade?: string | null; situacao: string; detalhe?: string | null }[]
  visitas: { data: string; cliente: string; unidade?: string | null; horario?: string | null; valor: number; situacao: string; temRelatorio: boolean; obs?: string | null }[]
  caixa: { data: string; tipo: 'recebido' | 'compra' | 'devolvido'; descricao: string; cliente?: string | null; valor: number; temComprovante: boolean }[]
  saldoPeriodo: SaldoCaixa
  saldoFinal: SaldoCaixa
  comprovantes: { titulo: string; dataUrl: string; w: number; h: number }[]
  comprovantesSemFoto: number
  geradoPor?: string | null
}

const VERDE: [number, number, number] = [15, 78, 48]
const brl = (v: number) => 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const ddmm = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`
const nomeDia = (ds: string) => `${DIAS[new Date(ds.slice(0, 10) + 'T12:00:00').getDay()]}, ${ddmm(ds)}`
// Fontes padrão do PDF não têm alguns símbolos: troca por equivalentes simples
const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[×]/g, 'x').replace(/[→]/g, '>').replace(/[✓✔]/g, '')

export async function gerarRelatorioEquipe(d: DadosRelatorioEquipe): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 15, R = 195, W = R - L
  let y = 0

  const t = (s: string, x: number, yy: number, o?: { tam?: number; negrito?: boolean; cor?: [number, number, number]; direita?: boolean; centro?: boolean }) => {
    doc.setFont('helvetica', o?.negrito ? 'bold' : 'normal')
    doc.setFontSize(o?.tam ?? 9.5)
    doc.setTextColor(...(o?.cor ?? [33, 33, 33]))
    doc.text(limpo(s), x, yy, o?.direita ? { align: 'right' } : o?.centro ? { align: 'center' } : undefined)
  }
  const quebra = (s: string, larg: number, tam = 9.5) => { doc.setFontSize(tam); return doc.splitTextToSize(limpo(s), larg) as string[] }
  const novaPagina = () => { doc.addPage(); y = 18 }
  const garantir = (alt: number) => { if (y + alt > 280) novaPagina() }

  // Marca de situação: bolinha verde com ✓, vermelha com ✕ ou vazia
  const marca = (x: number, yy: number, feito: boolean | null) => {
    if (feito === true) {
      doc.setFillColor(22, 128, 61); doc.circle(x, yy, 1.9, 'F')
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.45)
      doc.line(x - 0.9, yy + 0.05, x - 0.2, yy + 0.8); doc.line(x - 0.2, yy + 0.8, x + 1, yy - 0.7)
    } else if (feito === false) {
      doc.setFillColor(220, 38, 38); doc.circle(x, yy, 1.9, 'F')
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.45)
      doc.line(x - 0.8, yy - 0.8, x + 0.8, yy + 0.8); doc.line(x - 0.8, yy + 0.8, x + 0.8, yy - 0.8)
    } else {
      doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.35); doc.circle(x, yy, 1.8, 'S')
    }
  }

  const secao = (titulo: string, info?: string) => {
    // Título nunca fica sozinho no pé da página: só começa se couber com o começo do conteúdo
    garantir(30)
    y += 4
    doc.setFillColor(...VERDE); doc.rect(L, y - 4.2, 1.3, 5.6, 'F')
    t(titulo, L + 3.5, y, { tam: 12, negrito: true, cor: VERDE })
    if (info) t(info, R, y, { tam: 8.5, cor: [120, 120, 120], direita: true })
    y += 3
    doc.setDrawColor(225, 228, 222); doc.setLineWidth(0.3); doc.line(L, y, R, y)
    y += 5.5
  }
  const vazio = (s: string) => { garantir(7); t(s, L + 2, y, { tam: 9, cor: [140, 140, 140] }); y += 7 }

  // ── Cabeçalho ──
  doc.setFillColor(...VERDE); doc.rect(0, 0, 210, 38, 'F')
  t('TIN · RELATÓRIO DE TRABALHO', L, 11, { tam: 8, negrito: true, cor: [170, 215, 190] })
  t(d.nome, L, 22, { tam: 19, negrito: true, cor: [255, 255, 255] })
  t(`${d.papel}  ·  ${d.periodo.rotulo.charAt(0).toUpperCase()}${d.periodo.rotulo.slice(1)}`, L, 30, { tam: 10.5, cor: [225, 240, 230] })
  t(`Gerado em ${new Date().toLocaleString('pt-BR')}${d.geradoPor ? ` por ${d.geradoPor}` : ''}`, R, 30, { tam: 7.5, cor: [170, 215, 190], direita: true })
  y = 48

  // ── Resumo em quadros ──
  const feitas = d.atividades.filter(a => a.feito === true).length
  const supReal = d.supervisoes.filter(s => /realizada/i.test(s.situacao) && !/não/i.test(s.situacao)).length
  const quadros: [string, string, string][] = [
    ['Atividades', `${feitas} de ${d.atividades.length}`, 'feitas'],
    ['Reuniões e compromissos', String(d.compromissos.length), d.compromissos.length === 1 ? 'no período' : 'no período'],
    ['Supervisões', String(supReal), `realizada${supReal === 1 ? '' : 's'} de ${d.supervisoes.length}`],
    ['Visitas pagas', String(d.visitas.length), brl(d.visitas.filter(v => v.situacao !== 'Recusada').reduce((s, v) => s + v.valor, 0))],
    ['Compras', brl(d.saldoPeriodo.gasto), `${d.caixa.filter(c => c.tipo === 'compra').length} comprovante(s)`],
  ]
  const qw = (W - 4 * 3) / 5
  quadros.forEach(([rot, val, sub], i) => {
    const x = L + i * (qw + 3)
    doc.setFillColor(246, 247, 244); doc.setDrawColor(228, 230, 224); doc.setLineWidth(0.3)
    doc.roundedRect(x, y, qw, 22, 2, 2, 'FD')
    t(rot === 'Reuniões e compromissos' ? 'REUNIÕES' : rot.toUpperCase(), x + 3, y + 5.5, { tam: 6.5, negrito: true, cor: [120, 120, 120] })
    t(val, x + 3, y + 13.5, { tam: val.length > 10 ? 10 : 13, negrito: true, cor: [20, 20, 20] })
    t(sub, x + 3, y + 18.5, { tam: 7, cor: [120, 120, 120] })
  })
  y += 30

  // ── Atividades, por dia ──
  secao('Atividades', `${feitas} feita(s) · ${d.atividades.filter(a => a.feito === false).length} não feita(s) · ${d.atividades.filter(a => a.feito == null).length} sem marcação`)
  if (!d.atividades.length) vazio('Nenhuma atividade registrada no período.')
  const porDia = new Map<string, typeof d.atividades>()
  for (const a of [...d.atividades].sort((x, z) => x.data.localeCompare(z.data))) porDia.set(a.data, [...(porDia.get(a.data) || []), a])
  for (const [data, lista] of porDia) {
    garantir(12)
    t(nomeDia(data), L, y, { tam: 9, negrito: true, cor: [70, 70, 70] })
    y += 5.5
    for (const a of lista) {
      const linhas = quebra(a.nome, W - 40, 9.5)
      const notas = a.notas ? quebra(a.notas, W - 40, 8) : []
      garantir(linhas.length * 4.6 + notas.length * 3.8 + 3)
      marca(L + 3, y - 1.2, a.feito)
      linhas.forEach((ln, k) => t(ln, L + 8, y + k * 4.6, { tam: 9.5 }))
      t(a.feito === true ? 'Feita' : a.feito === false ? 'Não feita' : 'Sem marcação', R, y, { tam: 8, cor: a.feito === true ? [22, 128, 61] : a.feito === false ? [200, 38, 38] : [150, 150, 150], direita: true })
      y += linhas.length * 4.6
      notas.forEach(ln => { t(ln, L + 8, y, { tam: 8, cor: [120, 120, 120] }); y += 3.8 })
      y += 1.6
    }
    y += 1.5
  }

  // ── Reuniões e compromissos ──
  secao('Reuniões e compromissos', `${d.compromissos.length} no período`)
  if (!d.compromissos.length) vazio('Nenhuma reunião ou compromisso no período.')
  for (const c of [...d.compromissos].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    const quando = `${nomeDia(c.inicio)} · ${formatLocalTime(c.inicio)}`
    const comTipo = c.titulo.toLowerCase().startsWith(c.categoria.toLowerCase()) ? c.titulo : `${c.categoria} — ${c.titulo}`
    const titulo = quebra(`${comTipo}${c.cliente ? ` · ${c.cliente}` : ''}`, W - 50, 9.5)
    const notas = c.notas ? quebra(c.notas, W - 50, 8) : []
    garantir(5 + titulo.length * 4.6 + notas.length * 3.8 + 3)
    t(quando, L + 2, y, { tam: 8, cor: [110, 110, 110] })
    t(c.situacao, R, y, { tam: 8, negrito: true, cor: /realizad/i.test(c.situacao) ? [22, 128, 61] : /cancel|falt/i.test(c.situacao) ? [200, 38, 38] : [150, 110, 20], direita: true })
    y += 4.6
    titulo.forEach((ln, k) => t(ln, L + 2, y + k * 4.6, { tam: 9.5, negrito: k === 0 }))
    y += titulo.length * 4.6
    notas.forEach(ln => { t(ln, L + 2, y, { tam: 8, cor: [120, 120, 120] }); y += 3.8 })
    y += 2.5
  }

  // ── Supervisões ──
  secao('Supervisões', `${supReal} realizada(s) de ${d.supervisoes.length}`)
  if (!d.supervisoes.length) vazio('Nenhuma supervisão no período.')
  for (const s of [...d.supervisoes].sort((a, b) => a.data.localeCompare(b.data))) {
    const det = s.detalhe ? quebra(s.detalhe, W - 12, 8) : []
    garantir(10 + det.length * 3.8)
    const realizada = /realizada/i.test(s.situacao) && !/não/i.test(s.situacao)
    marca(L + 3, y - 1.2, realizada ? true : /não/i.test(s.situacao) ? false : null)
    t(`${nomeDia(s.data)} · ${s.cliente}${s.unidade ? ` · ${s.unidade}` : ''}`, L + 8, y, { tam: 9.5, negrito: true })
    t(s.situacao, R, y, { tam: 8, negrito: true, cor: realizada ? [22, 128, 61] : /não/i.test(s.situacao) ? [200, 38, 38] : [150, 110, 20], direita: true })
    y += 4.6
    det.forEach(ln => { t(ln, L + 8, y, { tam: 8, cor: [110, 110, 110] }); y += 3.8 })
    y += 2
  }

  // ── Visitas pagas ──
  secao('Visitas pagas', `${d.visitas.length} visita(s)`)
  if (!d.visitas.length) vazio('Nenhuma visita paga no período.')
  for (const v of [...d.visitas].sort((a, b) => a.data.localeCompare(b.data))) {
    const det = [v.horario, v.temRelatorio ? 'relatório anexado' : 'sem relatório', v.obs].filter(Boolean).join(' · ')
    const linhas = quebra(det, W - 50, 8)
    garantir(9 + linhas.length * 3.8)
    marca(L + 3, y - 1.2, v.situacao === 'Aprovada' ? true : v.situacao === 'Recusada' ? false : null)
    t(`${nomeDia(v.data)} · ${v.cliente}${v.unidade ? ` · ${v.unidade}` : ''}`, L + 8, y, { tam: 9.5, negrito: true })
    t(brl(v.valor), R, y, { tam: 9.5, negrito: true, direita: true })
    y += 4.6
    // Situação na linha de baixo, à direita (embaixo do valor)
    t(v.situacao, R, y, { tam: 7.5, cor: v.situacao === 'Aprovada' ? [22, 128, 61] : v.situacao === 'Recusada' ? [200, 38, 38] : [150, 110, 20], direita: true })
    linhas.forEach(ln => { t(ln, L + 8, y, { tam: 8, cor: [110, 110, 110] }); y += 3.8 })
    y += 2
  }

  // ── Caixa: compras e reembolsos ──
  secao('Compras e reembolsos', `${d.caixa.length} lançamento(s)`)
  if (!d.caixa.length) vazio('Nenhum lançamento no caixa no período.')
  else {
    garantir(10)
    doc.setFillColor(243, 244, 241); doc.rect(L, y - 4, W, 6, 'F')
    const cab: [string, number, boolean?][] = [['Data', L + 2], ['Tipo', L + 20], ['Descrição', L + 42], ['Comprovante', R - 46], ['Valor', R - 2, true]]
    cab.forEach(([s, x, dir]) => t(s, x, y, { tam: 7.5, negrito: true, cor: [100, 100, 100], direita: dir }))
    y += 6
    for (const c of [...d.caixa].sort((a, b) => a.data.localeCompare(b.data))) {
      const desc = quebra(`${c.descricao}${c.cliente ? ` · ${c.cliente}` : ''}`, R - 50 - (L + 42), 8.8)
      garantir(desc.length * 4.2 + 3)
      t(ddmm(c.data), L + 2, y, { tam: 8.8 })
      t(c.tipo === 'recebido' ? 'Recebi' : c.tipo === 'compra' ? 'Compra' : 'Devolvi', L + 20, y, { tam: 8.8, cor: c.tipo === 'compra' ? [33, 33, 33] : [22, 100, 60] })
      desc.forEach((ln, k) => t(ln, L + 42, y + k * 4.2, { tam: 8.8 }))
      t(c.tipo === 'compra' ? (c.temComprovante ? 'anexado' : 'FALTA') : '-', R - 46, y, { tam: 8.2, cor: c.tipo === 'compra' && !c.temComprovante ? [200, 38, 38] : [110, 110, 110] })
      // Recebido soma no caixa; compra e devolução saem dele
      t(`${c.tipo === 'recebido' ? '+' : '-'} ${brl(c.valor)}`, R - 2, y, { tam: 8.8, negrito: true, direita: true, cor: c.tipo === 'recebido' ? [22, 100, 60] : [33, 33, 33] })
      y += desc.length * 4.2 + 1.6
      doc.setDrawColor(235, 236, 232); doc.setLineWidth(0.1); doc.line(L, y - 2.4, R, y - 2.4)
    }
    // Caixa final: uma faixa com recebido, compras, devolvido e o saldo
    garantir(20)
    y += 1
    const f = d.saldoFinal
    const cw = W / 4
    doc.setFillColor(246, 247, 244); doc.setDrawColor(228, 230, 224); doc.setLineWidth(0.3)
    doc.roundedRect(L, y, W, 15, 2, 2, 'FD')
    const saldoRot = f.saldo > 0.004 ? 'Está com ela (devolver ou usar)' : f.saldo < -0.004 ? 'A receber (gastou do bolso)' : 'Caixa zerado'
    const colunas: [string, string, [number, number, number]][] = [
      ['Recebido (até o fim do período)', brl(f.recebido), [60, 60, 60]],
      ['Compras', `- ${brl(f.gasto)}`, [60, 60, 60]],
      ['Devolvido', `- ${brl(f.devolvido)}`, [60, 60, 60]],
      [saldoRot, brl(Math.abs(f.saldo)), f.saldo < -0.004 ? [200, 38, 38] : VERDE],
    ]
    colunas.forEach(([rot, val, cor], i) => {
      const x = L + i * cw + 4
      t(rot, x, y + 5.5, { tam: 7, cor: [110, 110, 110] })
      t(val, x, y + 11.5, { tam: i === 3 ? 11 : 10, negrito: true, cor })
    })
    y += 21
  }

  // ── Anexo: fotos dos comprovantes ──
  if (d.comprovantes.length || d.comprovantesSemFoto) {
    garantir(70)
    secao('Comprovantes', `${d.comprovantes.length} foto(s)${d.comprovantesSemFoto ? ` · ${d.comprovantesSemFoto} em PDF (ver no sistema)` : ''}`)
    const larg = (W - 8) / 2, alturaMax = 100
    let col = 0, alturaLinha = 0
    for (const c of d.comprovantes) {
      const escala = Math.min(larg / c.w, alturaMax / c.h)
      const w = c.w * escala, h = c.h * escala
      if (col === 0 && y + h + 10 > 282) { novaPagina(); alturaLinha = 0 }
      const x = L + col * (larg + 8)
      doc.setDrawColor(228, 230, 224); doc.setLineWidth(0.3); doc.rect(x, y, larg, h + 9, 'S')
      doc.addImage(c.dataUrl, 'JPEG', x + (larg - w) / 2, y + 1, w, h)
      const cap = quebra(c.titulo, larg - 4, 7.5)
      t(cap[0] || '', x + 2, y + h + 6, { tam: 7.5, cor: [90, 90, 90] })
      alturaLinha = Math.max(alturaLinha, h + 9)
      col++
      if (col === 2) { col = 0; y += alturaLinha + 5; alturaLinha = 0 }
    }
    if (col === 1) y += alturaLinha + 5
  }

  // ── Rodapé ──
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setDrawColor(225, 228, 222); doc.setLineWidth(0.2); doc.line(L, 287, R, 287)
    t(`${d.nome} · ${d.periodo.rotulo}`, L, 291.5, { tam: 7, cor: [150, 150, 150] })
    t(`página ${i} de ${n}`, R, 291.5, { tam: 7, cor: [150, 150, 150], direita: true })
  }
  return doc.output('blob')
}
