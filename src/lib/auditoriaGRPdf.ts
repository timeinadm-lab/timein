// ============================================================
// PDF de UMA auditoria da Auditoria GR (pedido de 20/10/2026: "na hora que
// completa tudo, eu posso gerar um PDF daquilo em específico").
// Página 1: os 7 documentos (ok / falta) e os dados do processo — fornecedor,
// pedido, financeiro (com auditor e sobra) e a auditoria. Depois, os
// arquivos anexados, dois por página, com faixa verde dizendo de qual documento é e
// a observação EMBAIXO do arquivo. Foto entra ajustada; PDF entra página a
// página. Não depende do navegador para ler os arquivos: quem chama passa o
// "carregar" (no sistema, baixa do armazenamento).
// ============================================================
import { criarPdf, limpo } from './pdfBase'
import {
  documentosDoProcesso, andamentoDocs, nomeDoTipo, anexosDe, totalOrcamento, localDaAuditoria, DOCUMENTOS, ROTULO_ESTADO, ROTULO_QUEM_PAGA, ENCERRADOS,
} from './auditoriasFornecedores'
import type { AuditoriaFornecedor, AnexoGR, EstadoDoc } from './auditoriasFornecedores'

/** Arquivo já carregado: bytes e tipo (image/png, image/jpeg ou application/pdf) */
export type ArquivoCarregado = { bytes: ArrayBuffer | Uint8Array; tipo: string } | null

const brl = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const dataBr = (d?: string | null) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-'
// A fonte padrão do PDF só tem o alfabeto latino
const winAnsi = (t: string) => limpo(t.normalize('NFC'))
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/✓/g, 'ok')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f]/g, ' ').replace(/[^ -~ -ÿ]/g, '')
const COR_ESTADO: Record<EstadoDoc, [number, number, number] | null> = { ok: [234, 246, 238], sem_arquivo: [255, 246, 221], falta: [255, 246, 221], nao_se_aplica: [241, 241, 239] }

/** Anexos na ordem dos documentos (orçamento → auditor) e depois os "outros" */
export function anexosEmOrdem(a: AuditoriaFornecedor): AnexoGR[] {
  const anx = anexosDe(a)
  return [...DOCUMENTOS.flatMap(d => anx.filter(x => x.tipo === d.chave)), ...anx.filter(x => !DOCUMENTOS.some(d => d.chave === x.tipo))]
}

export const nomePdfAuditoriaGR = (a: AuditoriaFornecedor) =>
  `Auditoria_GR_${a.codigo}_${a.fornecedor}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 80)

export async function gerarPdfAuditoriaGR(a: AuditoriaFornecedor, opts: {
  carregar: (caminho: string) => Promise<ArquivoCarregado>
  hoje: string
  aoProgredir?: (t: string) => void
}): Promise<Uint8Array> {
  const { carregar, hoje, aoProgredir } = opts
  const anexos = anexosEmOrdem(a)
  const numero = new Map(anexos.map((x, i) => [x.caminho, i + 1]))
  const docs = andamentoDocs(a)
  const encerrada = ENCERRADOS.includes(a.status)

  // 1. Capa: documentos e dados
  const { doc, st, L, texto, cabecalho, secao, tabela, campos, paragrafo, destaque } = await criarPdf(false)
  cabecalho('AUDITORIA GR · ' + a.codigo, a.fornecedor + (a.planta ? ` · ${a.planta}` : ''), a.status,
    `${localDaAuditoria(a) || 'Local não informado'} · ${encerrada ? 'processo encerrado' : `documentos ${docs.feitos} de ${docs.total}`} · gerado em ${dataBr(hoje)}`)

  secao('Documentos do processo')
  const itens = documentosDoProcesso(a)
  tabela(
    [{ titulo: 'Documento', larg: 44 }, { titulo: 'Situação', larg: 26 }, { titulo: 'Detalhe', larg: 78 }, { titulo: 'Arquivo', larg: 30 }],
    itens.map(i => [i.nome, ROTULO_ESTADO[i.estado], i.detalhe,
      i.anexos.length ? i.anexos.map(x => `Anexo ${numero.get(x.caminho)}`).join(', ') : i.estado === 'nao_se_aplica' || i.estado === 'ok' ? '-' : 'sem arquivo']),
    k => COR_ESTADO[itens[k].estado],
  )
  if (!encerrada && docs.faltam.length) destaque('Ainda falta', docs.faltam)
  const outros = anexos.filter(x => !DOCUMENTOS.some(d => d.chave === x.tipo))
  if (outros.length) paragrafo(`Outros arquivos: ${outros.map(x => `Anexo ${numero.get(x.caminho)} (${x.nome})`).join(', ')}.`, { tam: 8, cor: [100, 100, 100] })

  secao('Fornecedor')
  campos([
    ['Razão social', a.fornecedor], ['CNPJ', a.cnpj || '-'], ['Categoria', a.categoria || '-'], ['Produtos / escopo', a.produtos || '-'],
    ['Endereço', a.endereco || '-'], ['Cidade / UF', [a.cidade, a.uf].filter(Boolean).join('/') || '-'],
    ['Contato', a.contato || '-'], ['Telefone', a.telefone || '-'], ['E-mail', a.email || '-'], ['Tipo de auditoria', a.tipo || '-'],
  ])
  secao('Pedido da GR')
  campos([['Comprador', a.comprador || '-'], ['Unidade GRSA', a.unidade_grsa || '-'], ['CR', a.cr || '-'], ['Cidade polo', a.cidade_polo || '-']])

  secao('Financeiro')
  const total = totalOrcamento(a)
  const valorAuditor = Number(a.valor_auditor) || 0
  campos([
    ['Valor da auditoria', brl(Number(a.valor_auditoria) || 0)], ['Deslocamento', brl(Number(a.deslocamento) || 0)],
    ['Total', brl(total)], ['Local da auditoria', localDaAuditoria(a) || '-'],
    ['Quem paga', a.responsavel_pagamento ? ROTULO_QUEM_PAGA[a.responsavel_pagamento] || a.responsavel_pagamento : '-'], ['Forma de pagamento', a.forma_pagamento || '-'],
    ['Situação do pagamento', a.pagamento], ['Pago em', dataBr(a.pago_em)],
    ['Nota fiscal', a.precisa_nota === false ? 'Não precisa' : a.precisa_nota ? `Nº ${a.nota_numero || '(a emitir)'}${a.nota_emitida_em ? ' · ' + dataBr(a.nota_emitida_em) : ''}` : 'Não informado'],
    ['Orçamento enviado / aprovado', `${dataBr(a.orcamento_enviado_em)} / ${dataBr(a.aprovado_em)}`],
    ['Pago ao auditor', `${brl(valorAuditor)} · ${a.auditor_pagamento === 'Pago' ? 'pago em ' + dataBr(a.auditor_pago_em) : 'a pagar'}`],
    ['Sobra para a Time IN', encerrada ? '-' : brl(total - valorAuditor)],
  ])
  if (a.obs_financeiro?.trim()) paragrafo(`Obs. financeira: ${a.obs_financeiro.trim()}`, { tam: 8.5, cor: [80, 80, 80] })

  secao('Auditoria')
  campos([
    ['Agendada para', `${dataBr(a.agendada_para)}${a.horario ? ' às ' + a.horario : ''}`], ['Auditor', a.auditor || '-'],
    ['Realizada em', dataBr(a.realizada_em)], ['Nota', a.nota != null ? String(a.nota) : '-'],
    ['Resultado', a.resultado || '-'], ['Validade (próxima auditoria)', dataBr(a.validade)],
  ])
  if (anexos.length) {
    st.y += 2
    texto(`Em seguida: ${anexos.length} arquivo(s) anexado(s), dois por página, com a observação embaixo de cada um.`, L, st.y, { tam: 8, cor: [120, 120, 120] })
  }

  // 2. Anexos, dois por página lado a lado (21/10/2026: "sem um milhão de páginas"):
  // em cima de cada um, de qual documento é; embaixo, a observação. Foto entra
  // ajustada; PDF entra página a página (cada página ocupa uma metade).
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const final = await PDFDocument.load(doc.output('arraybuffer'))
  const negrito = await final.embedFont(StandardFonts.HelveticaBold)
  const normal = await final.embedFont(StandardFonts.Helvetica)
  const A4: [number, number] = [595.28, 841.89]
  const VERDE = rgb(0.06, 0.31, 0.19), CLARO = rgb(0.75, 0.86, 0.79)
  const MARGEM = 28, FAIXA = 40, RODAPE = 24, ENTRE = 14
  const cabe = (t: string, fonte: typeof normal, tam: number, larg: number) => {
    let s = winAnsi(t)
    if (fonte.widthOfTextAtSize(s, tam) <= larg) return s
    while (s.length > 1 && fonte.widthOfTextAtSize(s + '...', tam) > larg) s = s.slice(0, -1)
    return s + '...'
  }
  const quebrar = (t: string, tam: number, larg: number, max = 6) => {
    const linhas: string[] = []
    let atual = ''
    for (const p of winAnsi(t).split(/\s+/)) {
      const tenta = atual ? atual + ' ' + p : p
      if (normal.widthOfTextAtSize(tenta, tam) > larg && atual) { linhas.push(atual); atual = p } else atual = tenta
    }
    if (atual) linhas.push(atual)
    return linhas.length > max ? [...linhas.slice(0, max - 1), cabe(linhas.slice(max - 1).join(' '), normal, tam, larg)] : linhas
  }
  const larguraUtil = A4[0] - 2 * MARGEM
  const larguraCel = (larguraUtil - ENTRE) / 2
  const topoCel = A4[1] - FAIXA - 12

  // Cada pedaço ocupa uma metade: uma foto, uma página de PDF ou um aviso
  type Pedaco = { anexo: AnexoGR; n: number; parte?: string } & (
    { tipo: 'img'; img: Awaited<ReturnType<typeof final.embedPng>> } | { tipo: 'pdf'; pg: Awaited<ReturnType<typeof final.embedPdf>>[number] } | { tipo: 'aviso'; msg: string })
  const pedacos: Pedaco[] = []
  for (let k = 0; k < anexos.length; k++) {
    const x = anexos[k]
    aoProgredir?.(`anexo ${k + 1} de ${anexos.length}`)
    const arq = await carregar(x.caminho).catch(() => null)
    if (!arq) { pedacos.push({ anexo: x, n: k + 1, tipo: 'aviso', msg: 'Não foi possível baixar este arquivo.' }); continue }
    const bytes = arq.bytes instanceof Uint8Array ? arq.bytes : new Uint8Array(arq.bytes)
    try {
      if (arq.tipo === 'application/pdf' || /\.pdf$/i.test(x.caminho)) {
        const origem = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const paginas = await final.embedPdf(origem, origem.getPageIndices())
        paginas.forEach((pg, i) => pedacos.push({ anexo: x, n: k + 1, tipo: 'pdf', pg, parte: paginas.length > 1 ? `pág. ${i + 1} de ${paginas.length}` : undefined }))
      } else if (arq.tipo === 'image/png' || arq.tipo === 'image/jpeg') {
        pedacos.push({ anexo: x, n: k + 1, tipo: 'img', img: arq.tipo === 'image/png' ? await final.embedPng(bytes) : await final.embedJpg(bytes) })
      } else pedacos.push({ anexo: x, n: k + 1, tipo: 'aviso', msg: 'Formato que não dá para mostrar no PDF.' })
    } catch { pedacos.push({ anexo: x, n: k + 1, tipo: 'aviso', msg: 'Arquivo protegido ou com defeito.' }) }
  }

  const totalPgsAnexo = Math.ceil(pedacos.length / 2)
  for (let p = 0; p < totalPgsAnexo; p++) {
    const pg = final.addPage(A4)
    const [w, h] = A4
    pg.drawRectangle({ x: 0, y: h - FAIXA, width: w, height: FAIXA, color: VERDE })
    pg.drawText(cabe(`Anexos · ${a.codigo} · ${a.fornecedor}`, negrito, 12, larguraUtil - 70), { x: MARGEM, y: h - 19, size: 12, font: negrito, color: rgb(1, 1, 1) })
    pg.drawText(`${p + 1} de ${totalPgsAnexo}`, { x: w - MARGEM - normal.widthOfTextAtSize(`${p + 1} de ${totalPgsAnexo}`, 9), y: h - 19, size: 9, font: normal, color: CLARO })
    pg.drawText(cabe(`${anexos.length} arquivo(s) · dois por página · a observação fica embaixo de cada um`, normal, 8, larguraUtil), { x: MARGEM, y: h - 32, size: 8, font: normal, color: CLARO })

    pedacos.slice(p * 2, p * 2 + 2).forEach((c, i) => {
      const x0 = MARGEM + i * (larguraCel + ENTRE)
      // Cabeçalho da metade: documento e arquivo
      pg.drawText(cabe(`Anexo ${c.n} · ${nomeDoTipo(c.anexo.tipo)}${c.parte ? ' · ' + c.parte : ''}`, negrito, 10.5, larguraCel), { x: x0, y: topoCel - 10, size: 10.5, font: negrito, color: VERDE })
      pg.drawText(cabe(`${c.anexo.nome} · anexado em ${dataBr(c.anexo.em)}`, normal, 7.5, larguraCel), { x: x0, y: topoCel - 21, size: 7.5, font: normal, color: rgb(0.45, 0.45, 0.45) })
      // Observação embaixo
      const obs = quebrar(c.anexo.obs?.trim() ? `Obs.: ${c.anexo.obs.trim()}` : 'Obs.: (sem observação)', 9, larguraCel - 16)
      const OBS = 14 + obs.length * 11.5
      // a caixa vai logo abaixo do arquivo (yTopo = onde o arquivo terminou)
      const caixaObs = (yTopo: number) => {
        const y = yTopo - 8 - OBS
        pg.drawRectangle({ x: x0, y, width: larguraCel, height: OBS, color: rgb(1, 0.965, 0.867) })
        pg.drawRectangle({ x: x0, y, width: 3, height: OBS, color: rgb(0.88, 0.7, 0.24) })
        obs.forEach((l, j) => pg.drawText(l, { x: x0 + 9, y: y + OBS - 13 - j * 11.5, size: 9, font: j === 0 && c.anexo.obs?.trim() ? negrito : normal, color: rgb(0.2, 0.18, 0.1) }))
      }
      // Arquivo no meio, ajustado
      const area = { x: x0, y: RODAPE + OBS + 10, w: larguraCel, h: topoCel - 30 - (RODAPE + OBS + 10) }
      if (c.tipo === 'aviso') {
        pg.drawText(winAnsi(c.msg), { x: x0, y: area.y + area.h - 14, size: 10, font: negrito, color: rgb(0.78, 0.15, 0.15) })
        pg.drawText('Abra o arquivo pela ficha no sistema.', { x: x0, y: area.y + area.h - 28, size: 9, font: normal, color: rgb(0.4, 0.4, 0.4) })
        caixaObs(area.y + area.h - 36)
        return
      }
      const [ow, oh] = c.tipo === 'img' ? [c.img.width, c.img.height] : [c.pg.width, c.pg.height]
      const e = Math.min(area.w / ow, area.h / oh, 1)
      const r = { w: ow * e, h: oh * e, x: area.x + (area.w - ow * e) / 2, y: area.y + area.h - oh * e }
      pg.drawRectangle({ x: r.x - 0.5, y: r.y - 0.5, width: r.w + 1, height: r.h + 1, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 0.6 })
      if (c.tipo === 'img') pg.drawImage(c.img, { x: r.x, y: r.y, width: r.w, height: r.h })
      else pg.drawPage(c.pg, { x: r.x, y: r.y, width: r.w, height: r.h })
      caixaObs(r.y)
    })
    // Linha entre as metades
    if (pedacos.length > p * 2 + 1) pg.drawLine({ start: { x: MARGEM + larguraCel + ENTRE / 2, y: RODAPE }, end: { x: MARGEM + larguraCel + ENTRE / 2, y: topoCel }, thickness: 0.5, color: rgb(0.88, 0.88, 0.86) })
  }

  // Página X de Y em todas
  const todas = final.getPages()
  todas.forEach((pg, n) => {
    const t = winAnsi(`${a.codigo} · ${a.fornecedor} · página ${n + 1} de ${todas.length}`)
    pg.drawText(t, { x: A4[0] - MARGEM - normal.widthOfTextAtSize(t, 7), y: 12, size: 7, font: normal, color: rgb(0.55, 0.55, 0.55) })
  })
  aoProgredir?.('salvando')
  return await final.save()
}
