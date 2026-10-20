// ============================================================
// PDF de UMA auditoria da Auditoria GR (pedido de 20/10/2026: "na hora que
// completa tudo, eu posso gerar um PDF daquilo em específico").
// Página 1: os 7 documentos (ok / falta) e os dados do processo — fornecedor,
// pedido, financeiro (com auditor e sobra) e a auditoria. Depois, cada
// arquivo anexado numa página, com faixa verde dizendo de qual documento é e
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
    texto(`Em seguida: ${anexos.length} arquivo(s) anexado(s), um por página, com a observação embaixo.`, L, st.y, { tam: 8, cor: [120, 120, 120] })
  }

  // 2. Um arquivo por página: faixa verde em cima, arquivo, observação embaixo
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const final = await PDFDocument.load(doc.output('arraybuffer'))
  const negrito = await final.embedFont(StandardFonts.HelveticaBold)
  const normal = await final.embedFont(StandardFonts.Helvetica)
  const A4: [number, number] = [595.28, 841.89]
  const VERDE = rgb(0.06, 0.31, 0.19), CLARO = rgb(0.75, 0.86, 0.79)
  const MARGEM = 28, FAIXA = 48, RODAPE = 26
  const cabe = (t: string, fonte: typeof normal, tam: number, larg: number) => {
    let s = winAnsi(t)
    if (fonte.widthOfTextAtSize(s, tam) <= larg) return s
    while (s.length > 1 && fonte.widthOfTextAtSize(s + '...', tam) > larg) s = s.slice(0, -1)
    return s + '...'
  }
  const quebrar = (t: string, tam: number, larg: number, max = 5) => {
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

  for (let k = 0; k < anexos.length; k++) {
    const x = anexos[k]
    aoProgredir?.(`anexo ${k + 1} de ${anexos.length}`)
    const obsLinhas = quebrar(x.obs?.trim() ? `Obs.: ${x.obs.trim()}` : 'Obs.: (sem observação)', 10, larguraUtil - 20)
    const OBS = 18 + obsLinhas.length * 13
    const pagina = (parte?: string) => {
      const pg = final.addPage(A4)
      const [w, h] = A4
      pg.drawRectangle({ x: 0, y: h - FAIXA, width: w, height: FAIXA, color: VERDE })
      pg.drawText(cabe(`Anexo ${k + 1} de ${anexos.length} · ${nomeDoTipo(x.tipo)}${parte ? ' · ' + parte : ''}`, negrito, 13, larguraUtil), { x: MARGEM, y: h - 22, size: 13, font: negrito, color: rgb(1, 1, 1) })
      pg.drawText(cabe(`${a.codigo} · ${a.fornecedor} · ${x.nome} · anexado em ${dataBr(x.em)}`, normal, 8.5, larguraUtil), { x: MARGEM, y: h - 38, size: 8.5, font: normal, color: CLARO })
      // Observação embaixo do arquivo
      pg.drawRectangle({ x: MARGEM, y: RODAPE, width: larguraUtil, height: OBS, color: rgb(1, 0.965, 0.867) })
      pg.drawRectangle({ x: MARGEM, y: RODAPE, width: 3, height: OBS, color: rgb(0.88, 0.7, 0.24) })
      obsLinhas.forEach((l, i) => pg.drawText(l, { x: MARGEM + 12, y: RODAPE + OBS - 16 - i * 13, size: 10, font: i === 0 ? negrito : normal, color: rgb(0.2, 0.18, 0.1) }))
      return pg
    }
    // Área livre entre a faixa e a observação
    const encaixar = (w: number, h: number) => {
      const area = { x: MARGEM, y: RODAPE + OBS + 12, w: larguraUtil, h: A4[1] - FAIXA - 14 - (RODAPE + OBS + 12) }
      const e = Math.min(area.w / w, area.h / h, 1)
      return { w: w * e, h: h * e, x: area.x + (area.w - w * e) / 2, y: area.y + area.h - h * e }
    }
    const aviso = (msg: string) => {
      const pg = pagina()
      pg.drawText(winAnsi(msg), { x: MARGEM, y: A4[1] - FAIXA - 40, size: 11, font: negrito, color: rgb(0.78, 0.15, 0.15) })
      pg.drawText('Abra o arquivo pela ficha no sistema.', { x: MARGEM, y: A4[1] - FAIXA - 58, size: 10, font: normal, color: rgb(0.4, 0.4, 0.4) })
    }
    const arq = await carregar(x.caminho).catch(() => null)
    if (!arq) { aviso('Não foi possível baixar este arquivo.'); continue }
    const bytes = arq.bytes instanceof Uint8Array ? arq.bytes : new Uint8Array(arq.bytes)
    const borda = (pg: ReturnType<typeof pagina>, r: { x: number; y: number; w: number; h: number }) =>
      pg.drawRectangle({ x: r.x - 0.5, y: r.y - 0.5, width: r.w + 1, height: r.h + 1, borderColor: rgb(0.85, 0.86, 0.84), borderWidth: 0.6 })
    try {
      if (arq.tipo === 'application/pdf' || /\.pdf$/i.test(x.caminho)) {
        const origem = await PDFDocument.load(bytes, { ignoreEncryption: true })
        const paginas = await final.embedPdf(origem, origem.getPageIndices())
        paginas.forEach((ep, n) => {
          const pg = pagina(paginas.length > 1 ? `página ${n + 1} de ${paginas.length}` : undefined)
          const r = encaixar(ep.width, ep.height)
          borda(pg, r); pg.drawPage(ep, { x: r.x, y: r.y, width: r.w, height: r.h })
        })
      } else if (arq.tipo === 'image/png' || arq.tipo === 'image/jpeg') {
        const img = arq.tipo === 'image/png' ? await final.embedPng(bytes) : await final.embedJpg(bytes)
        const pg = pagina()
        const r = encaixar(img.width, img.height)
        borda(pg, r); pg.drawImage(img, { x: r.x, y: r.y, width: r.w, height: r.h })
      } else aviso('Formato de arquivo que não dá para mostrar no PDF.')
    } catch { aviso('Este arquivo está protegido ou com defeito.') }
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
