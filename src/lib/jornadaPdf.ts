// ============================================================
// PDF da Jornada de um colaborador no mês (pedido do Gabriel, 01/10/2026).
// O mesmo conteúdo da tela: resumo por vínculo, dia a dia, reembolsos e
// pagamentos. Devolve o arquivo (Blob) para baixar e/ou salvar no histórico.
// ============================================================
import type { ResumoVinculo } from './jornadaPessoa'
import { textoDoResumo } from './jornadaPessoa'

export type DadosPdfJornada = {
  nome: string
  cpf?: string | null
  nomeMes: string
  resumos: ResumoVinculo[]
  nomeCliente: (id?: string | null) => string
  rotuloVinculo: (r: ResumoVinculo) => string
  reembolsos: { data: string; descricao: string; categoria: string; valor: number; situacao: string }[]
  pagamentos: { vencimento: string; descricao: string; valor: number; situacao: string }[]
  geradoPor?: string | null
}

const brl = (v: number) => 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBR = (ds: string) => ds ? `${ds.slice(8, 10)}/${ds.slice(5, 7)}/${ds.slice(0, 4)}` : ''
const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const horas = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
// Fontes padrão do PDF não têm alguns símbolos: troca por equivalentes simples
const limpo = (t: string) => t.replace(/[–—]/g, '-').replace(/[×]/g, 'x').replace(/[→]/g, '>')

export async function gerarPdfJornada(d: DadosPdfJornada): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const L = 14, R = 196, W = R - L
  let y = 16

  const novaPagina = () => { doc.addPage(); y = 16 }
  const garantir = (alt: number) => { if (y + alt > 282) novaPagina() }
  const texto = (t: string, x: number, yy: number, opt?: { tam?: number; negrito?: boolean; cor?: [number, number, number]; alinhar?: 'right' | 'left' }) => {
    doc.setFont('helvetica', opt?.negrito ? 'bold' : 'normal')
    doc.setFontSize(opt?.tam ?? 9)
    doc.setTextColor(...(opt?.cor ?? [33, 33, 33]))
    doc.text(limpo(t), x, yy, opt?.alinhar === 'right' ? { align: 'right' } : undefined)
  }
  const secao = (t: string) => {
    garantir(14)
    y += 3
    texto(t.toUpperCase(), L, y, { tam: 8, negrito: true, cor: [15, 78, 48] })
    doc.setDrawColor(15, 78, 48); doc.setLineWidth(0.3); doc.line(L, y + 1.5, R, y + 1.5)
    y += 6
  }
  // Tabela simples com quebra de linha e de página
  const tabela = (cols: { titulo: string; larg: number; direita?: boolean }[], linhas: string[][]) => {
    const cab = () => {
      garantir(8)
      doc.setFillColor(243, 244, 241); doc.rect(L, y - 3.6, W, 5.4, 'F')
      let x = L + 1.5
      cols.forEach(c => { texto(c.titulo, c.direita ? x + c.larg - 3 : x, y, { tam: 7.5, negrito: true, cor: [90, 90, 90], alinhar: c.direita ? 'right' : 'left' }); x += c.larg })
      y += 4.6
    }
    cab()
    for (const linha of linhas) {
      doc.setFontSize(8.2)
      const partes = linha.map((v, i) => doc.splitTextToSize(limpo(v), cols[i].larg - 3) as string[])
      const alt = Math.max(...partes.map(p => p.length)) * 3.6 + 1.4
      if (y + alt > 282) { novaPagina(); cab() }
      let x = L + 1.5
      partes.forEach((p, i) => {
        p.forEach((ln, k) => texto(ln, cols[i].direita ? x + cols[i].larg - 3 : x, y + k * 3.6, { tam: 8.2, alinhar: cols[i].direita ? 'right' : 'left' }))
        x += cols[i].larg
      })
      y += alt
      doc.setDrawColor(230, 230, 226); doc.setLineWidth(0.1); doc.line(L, y - 2.6, R, y - 2.6)
    }
    y += 2
  }

  // ── Cabeçalho ──
  doc.setFillColor(15, 78, 48); doc.rect(0, 0, 210, 26, 'F')
  texto('TIN · Jornada do colaborador', L, 9, { tam: 8, cor: [190, 220, 200] })
  texto(d.nome, L, 17, { tam: 15, negrito: true, cor: [255, 255, 255] })
  texto(d.nomeMes.charAt(0).toUpperCase() + d.nomeMes.slice(1), R, 17, { tam: 11, cor: [255, 255, 255], alinhar: 'right' })
  texto([d.cpf ? `CPF ${d.cpf}` : null, `Gerado em ${new Date().toLocaleString('pt-BR')}${d.geradoPor ? ` por ${d.geradoPor}` : ''}`].filter(Boolean).join('  ·  '), L, 22.5, { tam: 7.5, cor: [190, 220, 200] })
  y = 34

  // ── Resumo por vínculo ──
  secao('Resumo do mês')
  if (d.resumos.length === 0) { texto('Nenhum vínculo neste mês.', L, y); y += 6 }
  for (const r of d.resumos) {
    garantir(22)
    const cliente = d.nomeCliente(r.link.client_id) || 'Cliente'
    texto(cliente, L, y, { tam: 10.5, negrito: true })
    texto(textoDoResumo(r), R, y, { tam: 10.5, negrito: true, cor: r.faltas.length ? [180, 83, 9] : [15, 78, 48], alinhar: 'right' })
    y += 4.6
    texto(d.rotuloVinculo(r), L, y, { tam: 8, cor: [110, 110, 110] })
    y += 4.4
    const itens = [
      r.faltas.length ? `${r.faltas.length} ${r.unidade === 'visitas' ? 'visita(s) não registrada(s)' : 'dia(s) sem registro'}: ${r.faltas.map(f => f.slice(8, 10) + '/' + f.slice(5, 7)).join(', ')}` : null,
      r.restantes ? `${r.restantes} ainda por vir` : null,
      r.trocas ? `${r.trocas} troca(s)` : null,
      r.minutos ? `${horas(r.minutos)} trabalhadas` : null,
      r.abaixoJornada ? `${r.abaixoJornada} dia(s) abaixo da jornada` : null,
      r.acimaJornada ? `${r.acimaJornada} dia(s) acima da jornada` : null,
      r.valorVisitas ? `visitas registradas: ${brl(r.valorVisitas)}` : null,
      r.semValor ? `${r.semValor} visita(s) sem valor` : null,
    ].filter(Boolean) as string[]
    if (itens.length) {
      const ls = doc.splitTextToSize(limpo(itens.join('  ·  ')), W) as string[]
      ls.forEach(l => { garantir(5); texto(l, L, y, { tam: 8.2, cor: [60, 60, 60] }); y += 3.8 })
    }
    y += 2.5
  }

  // ── Dia a dia ──
  const dias = d.resumos.flatMap(r => r.dias.map(x => ({ ...x, cliente: d.nomeCliente(r.link.client_id) })))
    .sort((a, b) => a.data.localeCompare(b.data))
  secao('Dia a dia')
  if (!dias.length) { texto('Nada registrado ou previsto no mês.', L, y); y += 6 }
  else {
    const varios = d.resumos.length > 1
    tabela(
      [{ titulo: 'Data', larg: 22 }, ...(varios ? [{ titulo: 'Cliente', larg: 42 }] : []), { titulo: 'Situação', larg: 38 }, { titulo: 'Detalhe', larg: varios ? 80 : 122 }],
      dias.map(x => [
        `${x.data.slice(8, 10)}/${x.data.slice(5, 7)} ${DIAS_SEMANA[new Date(x.data + 'T12:00:00').getDay()]}`,
        ...(varios ? [x.cliente || ''] : []),
        x.titulo,
        [x.detalhe, x.desvio ? `fora da jornada (${x.desvio.difMin >= 0 ? '+' : '-'}${horas(Math.abs(x.desvio.difMin))})` : null].filter(Boolean).join(' · '),
      ]),
    )
  }

  // ── Reembolsos ──
  secao('Reembolsos')
  if (!d.reembolsos.length) { texto('Nenhum pedido de reembolso.', L, y); y += 6 }
  else tabela(
    [{ titulo: 'Pedido em', larg: 24 }, { titulo: 'Descrição', larg: 82 }, { titulo: 'Categoria', larg: 28 }, { titulo: 'Valor', larg: 26, direita: true }, { titulo: 'Situação', larg: 22 }],
    d.reembolsos.map(e => [dataBR(e.data), e.descricao, e.categoria, brl(e.valor), e.situacao]),
  )

  // ── Pagamentos ──
  secao('Pagamentos do mês')
  if (!d.pagamentos.length) { texto('Nada lançado ainda para este mês.', L, y); y += 6 }
  else {
    tabela(
      [{ titulo: 'Vencimento', larg: 24 }, { titulo: 'Descrição', larg: 104 }, { titulo: 'Valor', larg: 30, direita: true }, { titulo: 'Situação', larg: 24 }],
      d.pagamentos.map(p => [dataBR(p.vencimento), p.descricao, brl(p.valor), p.situacao]),
    )
    garantir(6)
    texto(`Total: ${brl(d.pagamentos.reduce((s, p) => s + p.valor, 0))}`, R, y, { tam: 9.5, negrito: true, alinhar: 'right' })
    y += 6
  }

  // Rodapé com página
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    texto(`${d.nome} · ${d.nomeMes} · página ${i} de ${n}`, R, 291, { tam: 7, cor: [150, 150, 150], alinhar: 'right' })
  }
  return doc.output('blob')
}
