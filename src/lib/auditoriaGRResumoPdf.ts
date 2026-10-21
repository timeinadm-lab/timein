// ============================================================
// Resumo do mês da Auditoria GR em PDF, para a chefe (21/10/2026: "tem que ser
// simplificado, ela não pode ficar perdendo muito tempo lendo... visual, sem
// um milhão de páginas"). Uma folha (duas se tiver muita auditoria):
//   1. quatro números grandes (quantas, concluídas, em andamento, pendência);
//   2. onde estão (barras por status) e o dinheiro (barras: orçado, entrou,
//      a receber, auditores, sobra);
//   3. "Precisa de atenção": só o que pede ação (pagamento atrasado, nota,
//      auditor a pagar, relatório, orçamento sem resposta, validade);
//   4. uma linha por auditoria: situação, os 7 documentos em quadradinhos,
//      próximo passo e valor.
// ============================================================
import { criarPdf } from './pdfBase'
import {
  numerosDoTopo, andamentoDocs, documentosDoProcesso, totalOrcamento, localDaAuditoria, avisoValidade, nomeDoMes, nomeRelatorioGR,
  ENCERRADOS, STATUS_FORNECEDOR, corDoStatus,
} from './auditoriasFornecedores'
import type { AuditoriaFornecedor, EstadoDoc, DocChave } from './auditoriasFornecedores'

type Cor = [number, number, number]
type Tom = 'verde' | 'azul' | 'amarelo' | 'cinza' | 'vermelho'
const FORTE: Record<Tom, Cor> = { verde: [21, 128, 61], azul: [37, 99, 235], amarelo: [217, 119, 6], cinza: [140, 146, 156], vermelho: [220, 38, 38] }
const CLARO: Record<Tom, Cor> = { verde: [220, 252, 231], azul: [219, 234, 254], amarelo: [254, 243, 199], cinza: [241, 242, 244], vermelho: [254, 226, 226] }
const TINTA: Cor = [33, 33, 33], CINZA: Cor = [120, 120, 120], VERDE_TIME: Cor = [15, 78, 48]

const brl = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const dm = (d?: string | null) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const encerrada = (a: AuditoriaFornecedor) => ENCERRADOS.includes(a.status)
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000)

/** Próximo passo, pelo primeiro documento que falta (feito sem arquivo = anexar) */
const PASSO: Record<DocChave, string> = {
  orcamento: 'Enviar orçamento', aprovacao: 'Aguardar aprovação', comprovante: 'Receber pagamento', nota: 'Emitir nota fiscal',
  agendamento: 'Agendar auditoria', relatorio: 'Fazer a auditoria', auditor: 'Pagar auditor',
}
const ANEXAR: Record<DocChave, string> = {
  orcamento: 'Anexar orçamento', aprovacao: 'Anexar aprovação', comprovante: 'Anexar comprovante', nota: 'Anexar nota fiscal',
  agendamento: 'Anexar agendamento', relatorio: 'Anexar relatório', auditor: 'Anexar pgto. auditor',
}

/** Nome curto do status, para caber na etiqueta */
export const statusCurto = (s: string) => ({
  'Em elaboração de orçamento': 'Fazendo orçamento',
  'Aguardando retorno do fornecedor': 'Aguard. fornecedor',
  'Aguardando definição de laboratório': 'Aguard. laboratório',
  'Aguardando comprovante': 'Aguard. comprovante',
  'Aguardando aprovação': 'Aguard. aprovação',
  'Aguardando pagamento': 'Aguard. pagamento',
  'Aguardando relatório': 'Aguard. relatório',
  'Encerrada – outro prestador': 'Encerrada (outro)',
  'Encerrada – auditoria vigente': 'Encerrada (vigente)',
} as Record<string, string>)[s] || s

/**
 * Só o que pede ação, do mais urgente ao menos: dinheiro que não entrou depois
 * da auditoria feita, nota a emitir, auditor a pagar, relatório faltando,
 * orçamento sem resposta há mais de 7 dias, validade vencendo (concluídas).
 */
export function pontosDeAtencao(lista: AuditoriaFornecedor[], hoje: string): string[] {
  const out: { peso: number; codigo: string; t: string }[] = []
  for (const a of lista) {
    if (encerrada(a)) continue
    const quem = `${a.codigo} · ${a.fornecedor}`
    const add = (peso: number, t: string) => out.push({ peso, codigo: a.codigo, t: `${quem}: ${t}` })
    const docs = documentosDoProcesso(a)
    if (a.realizada_em && a.pagamento !== 'Pago' && a.pagamento !== 'Não se aplica')
      add(1, `auditoria feita em ${dm(a.realizada_em)} e o pagamento (${brl(totalOrcamento(a))}) ainda não entrou`)
    if (a.pagamento === 'Pago' && a.precisa_nota && !a.nota_numero?.trim())
      add(2, `emitir a nota fiscal (${brl(totalOrcamento(a))})`)
    if (a.realizada_em && a.auditor_pagamento !== 'Pago' && Number(a.valor_auditor) > 0)
      add(3, `pagamento do auditor pendente (${a.auditor ? a.auditor + ', ' : ''}${brl(Number(a.valor_auditor))})`)
    if (a.realizada_em && docs.find(d => d.chave === 'relatorio')?.estado === 'falta')
      add(4, 'falta anexar o relatório da auditoria')
    if (a.orcamento_enviado_em && !a.aprovado_em && diasEntre(a.orcamento_enviado_em, hoje) > 7)
      add(5, `orçamento enviado há ${diasEntre(a.orcamento_enviado_em, hoje)} dias sem aprovação`)
    const v = a.status === 'Concluída' ? avisoValidade(a.validade, hoje) : null
    if (v) add(6, v.tipo === 'vencida' ? `validade venceu em ${dataBr(a.validade!)}: oferecer renovação` : `validade vence em ${v.dias} dias: oferecer renovação`)
  }
  return out.sort((x, y) => x.peso - y.peso || x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true })).map(x => x.t)
}

export const nomeResumoGR = (hoje: string, mes?: string | null) => 'Resumo_' + nomeRelatorioGR(hoje, mes)

export async function gerarResumoGR(lista: AuditoriaFornecedor[], opts: { hoje: string; mes?: string | null; filtro?: string }): Promise<Uint8Array> {
  const { hoje, mes } = opts
  const ord = [...lista].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
  const n = numerosDoTopo(lista)
  const ativos = lista.filter(a => !encerrada(a))
  const comFalta = ativos.filter(a => andamentoDocs(a).faltam.length > 0)
  const notas = ativos.filter(a => a.pagamento === 'Pago' && a.precisa_nota && !a.nota_numero?.trim())

  const { doc, st, L, R, W, texto, cabecalho, numerar, novaPagina } = await criarPdf(false)
  const periodo = mes ? nomeDoMes(mes) : 'Todos os meses'
  cabecalho('AUDITORIA GR · RESUMO', periodo.charAt(0).toUpperCase() + periodo.slice(1), `${n.registros} auditoria${n.registros === 1 ? '' : 's'}`,
    `gerado em ${dataBr(hoje)} · uso interno${opts.filtro ? ' · ' + opts.filtro : ''}`)

  const caixa = (x: number, y: number, w: number, h: number, fundo: Cor, borda?: Cor) => {
    doc.setFillColor(...fundo)
    if (borda) { doc.setDrawColor(...borda); doc.setLineWidth(0.3) }
    doc.roundedRect(x, y, w, h, 1.6, 1.6, borda ? 'FD' : 'F')
  }
  const titulo = (t: string, x: number, y: number, w: number) => {
    texto(t.toUpperCase(), x, y, { tam: 7.5, negrito: true, cor: VERDE_TIME })
    doc.setDrawColor(...VERDE_TIME); doc.setLineWidth(0.3); doc.line(x, y + 1.4, x + w, y + 1.4)
  }
  const cabe = (t: string, larg: number, tam: number, negrito = false) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam)
    let s = t
    if (doc.getTextWidth(s) <= larg) return s
    while (s.length > 1 && doc.getTextWidth(s + '...') > larg) s = s.slice(0, -1)
    return s.trimEnd() + '...'
  }

  // 1. Quatro números grandes
  const cards: { rot: string; v: number; tom: Tom | null; sub?: string }[] = [
    { rot: 'Auditorias', v: n.registros, tom: null, sub: n.encerradas ? `${n.encerradas} cancelada(s)/encerrada(s)` : undefined },
    { rot: 'Concluídas', v: n.concluidas, tom: 'verde' },
    { rot: 'Em andamento', v: n.emAndamento, tom: 'azul', sub: n.agendadas ? `${n.agendadas} agendada(s)` : undefined },
    { rot: 'Com documento faltando', v: comFalta.length, tom: comFalta.length ? 'amarelo' : 'verde' },
  ]
  const gap = 4, cw = (W - gap * 3) / 4, ch = 20, y1 = 32
  cards.forEach((c, i) => {
    const x = L + i * (cw + gap)
    caixa(x, y1, cw, ch, c.tom ? CLARO[c.tom] : [243, 244, 241])
    doc.setFillColor(...(c.tom ? FORTE[c.tom] : VERDE_TIME)); doc.rect(x, y1 + 2, 1.2, ch - 4, 'F')
    texto(String(c.v), x + 5, y1 + 10, { tam: 20, negrito: true, cor: c.tom ? FORTE[c.tom] : TINTA })
    texto(c.rot, x + 5, y1 + 15, { tam: 8, negrito: true, cor: TINTA })
    if (c.sub) texto(c.sub, x + 5, y1 + 18.3, { tam: 6.5, cor: CINZA })
  })

  // 2. Onde estão (status) | Dinheiro
  const y2 = y1 + ch + 9, meia = (W - 8) / 2, xD = L + meia + 8
  titulo('Onde estão', L, y2, meia)
  const porStatus = STATUS_FORNECEDOR.map(s => ({ s, q: lista.filter(a => a.status === s).length })).filter(x => x.q > 0)
  const maxQ = Math.max(1, ...porStatus.map(x => x.q))
  const larRot = 34, larBarra = meia - larRot - 8
  porStatus.forEach((x, i) => {
    const y = y2 + 6.5 + i * 4.6
    texto(statusCurto(x.s), L, y, { tam: 7.5, cor: TINTA })
    doc.setFillColor(243, 244, 241); doc.rect(L + larRot, y - 2.6, larBarra, 3.2, 'F')
    doc.setFillColor(...FORTE[corDoStatus(x.s) as Tom]); doc.rect(L + larRot, y - 2.6, Math.max(1.2, larBarra * x.q / maxQ), 3.2, 'F')
    texto(String(x.q), L + meia, y, { tam: 8, negrito: true, alinhar: 'right' })
  })
  const fimStatus = y2 + 6.5 + porStatus.length * 4.6

  titulo('Dinheiro', xD, y2, meia)
  const linhasDin: { rot: string; v: number; tom: Tom | null; obs?: string }[] = [
    { rot: 'Total orçado', v: n.orcamentosAtivos, tom: null, obs: `${ativos.length} auditoria(s) ativas` },
    { rot: 'Entrou', v: n.recebido, tom: 'verde', obs: n.orcamentosAtivos ? `${Math.round(100 * n.recebido / n.orcamentosAtivos)}% do orçado · ${n.qtdRecebido} paga(s)` : undefined },
    { rot: 'A receber', v: n.aReceber, tom: n.aReceber ? 'amarelo' : 'verde', obs: n.qtdAReceber ? `${n.qtdAReceber} auditoria(s)` : undefined },
    { rot: 'Pago aos auditores', v: n.pagoAuditor, tom: 'cinza' },
    { rot: 'A pagar aos auditores', v: n.aPagarAuditor, tom: n.aPagarAuditor ? 'amarelo' : 'cinza', obs: n.qtdAPagarAuditor ? `${n.qtdAPagarAuditor} auditor(es)` : undefined },
    { rot: 'Sobra para a Time IN', v: n.sobra, tom: 'verde', obs: 'orçado menos auditores' },
  ]
  const maxV = Math.max(1, ...linhasDin.map(x => x.v))
  const larRotD = 33, larValor = 22, larBarraD = meia - larRotD - larValor - 2
  linhasDin.forEach((x, i) => {
    const y = y2 + 7 + i * 6.6
    const ultima = i === linhasDin.length - 1
    texto(x.rot, xD, y, { tam: 7.5, negrito: ultima, cor: TINTA })
    if (x.obs) texto(x.obs, xD, y + 2.6, { tam: 5.8, cor: CINZA })
    doc.setFillColor(243, 244, 241); doc.rect(xD + larRotD, y - 2.8, larBarraD, 3.6, 'F')
    if (x.v > 0) { doc.setFillColor(...(x.tom ? FORTE[x.tom] : VERDE_TIME)); doc.rect(xD + larRotD, y - 2.8, Math.max(1.2, larBarraD * x.v / maxV), 3.6, 'F') }
    texto(brl(x.v), R, y, { tam: ultima ? 8.5 : 8, negrito: true, cor: x.tom && x.tom !== 'cinza' ? FORTE[x.tom] : TINTA, alinhar: 'right' })
  })
  let fimDin = y2 + 7 + linhasDin.length * 6.6
  if (notas.length) {
    texto(`Notas fiscais a emitir: ${notas.length} (${brl(notas.reduce((s, a) => s + totalOrcamento(a), 0))})`, xD, fimDin + 0.5, { tam: 7, negrito: true, cor: FORTE.vermelho })
    fimDin += 4
  }
  st.y = Math.max(fimStatus, fimDin) + 4

  // 3. Precisa de atenção
  const pontos = pontosDeAtencao(lista, hoje)
  const MAX = 7
  if (!pontos.length) {
    caixa(L, st.y, W, 9, CLARO.verde)
    texto('Nada urgente: nenhum pagamento atrasado, nota, auditor ou relatório pendente.', L + 4, st.y + 5.8, { tam: 8.5, negrito: true, cor: FORTE.verde })
    st.y += 14
  } else {
    const mostrar = pontos.slice(0, MAX)
    const resto = pontos.length - mostrar.length
    const alt = 8.5 + mostrar.length * 4 + (resto ? 4 : 0)
    caixa(L, st.y, W, alt, CLARO.amarelo, [245, 158, 11])
    texto(`Precisa de atenção (${pontos.length})`, L + 4, st.y + 5.5, { tam: 9, negrito: true, cor: [120, 53, 15] })
    mostrar.forEach((p, i) => {
      const y = st.y + 10 + i * 4
      doc.setFillColor(...FORTE.amarelo); doc.circle(L + 5, y - 1, 0.7, 'F')
      texto(cabe(p, W - 12, 8), L + 7.5, y, { tam: 8, cor: [92, 45, 10] })
    })
    if (resto) texto(`+ ${resto} outro(s) ponto(s)`, L + 7.5, st.y + 10 + mostrar.length * 4, { tam: 7.5, cor: [146, 64, 14] })
    st.y += alt + 5.5
  }

  // 4. Uma linha por auditoria
  const cols = [
    { t: 'ID', w: 17 }, { t: 'Fornecedor', w: 49 }, { t: 'Situação', w: 31 },
    { t: 'Documentos', w: 31 }, { t: 'Próximo passo', w: 32 }, { t: 'Valor', w: 22, dir: true },
  ]
  const xs = cols.reduce<number[]>((acc, c, i) => [...acc, i ? acc[i - 1] + cols[i - 1].w : L], [])
  const ALTURA = 8.4, LIMITE = 284
  const cabTabela = () => {
    titulo(`Todas as auditorias (${ord.length})`, L, st.y, W)
    st.y += 5.5
    doc.setFillColor(243, 244, 241); doc.rect(L, st.y - 3.4, W, 5, 'F')
    cols.forEach((c, i) => texto(c.t, c.dir ? xs[i] + c.w - 1.5 : xs[i] + 1.5, st.y, { tam: 7, negrito: true, cor: [90, 90, 90], alinhar: c.dir ? 'right' : 'left' }))
    st.y += 4.6
  }
  const corDoc: Record<EstadoDoc, { fundo: Cor; borda?: Cor }> = {
    ok: { fundo: FORTE.verde }, sem_arquivo: { fundo: [252, 211, 77] },
    falta: { fundo: [255, 255, 255], borda: [170, 170, 170] }, nao_se_aplica: { fundo: [225, 227, 230] },
  }
  if (st.y + 20 > LIMITE) novaPagina()
  cabTabela()
  ord.forEach((a, k) => {
    if (st.y + ALTURA > LIMITE) { novaPagina(); cabTabela() }
    const y = st.y, enc = encerrada(a), d = andamentoDocs(a)
    if (k % 2) { doc.setFillColor(250, 250, 248); doc.rect(L, y - 1.2, W, ALTURA, 'F') }
    const l1 = y + 2.4, l2 = y + 5.6
    texto(a.codigo, xs[0] + 1.5, l1, { tam: 7.5, negrito: true })
    texto(cabe(a.fornecedor + (a.planta ? ` · ${a.planta}` : ''), cols[1].w - 3, 8), xs[1] + 1.5, l1, { tam: 8, cor: enc ? CINZA : TINTA })
    texto(cabe(localDaAuditoria(a) || 'local não informado', cols[1].w - 3, 6.5), xs[1] + 1.5, l2, { tam: 6.5, cor: CINZA })
    // Situação: etiqueta colorida
    const tom = corDoStatus(a.status) as Tom
    const rot = cabe(statusCurto(a.status), cols[2].w - 6, 6.8, true)
    const lp = doc.getTextWidth(rot) + 4
    caixa(xs[2] + 1.5, l1 - 2.9, lp, 4.2, CLARO[tom])
    texto(rot, xs[2] + 3.5, l1, { tam: 6.8, negrito: true, cor: FORTE[tom] })
    if (a.realizada_em) texto(`feita em ${dm(a.realizada_em)}${a.resultado ? ' · ' + a.resultado.toLowerCase() : ''}`, xs[2] + 1.5, l2 + 0.6, { tam: 6, cor: CINZA })
    else if (a.agendada_para) texto(`agendada ${dm(a.agendada_para)}`, xs[2] + 1.5, l2 + 0.6, { tam: 6, cor: CINZA })
    // Documentos: 7 quadradinhos + "5/7"
    if (enc) texto('-', xs[3] + 1.5, l1, { tam: 8, cor: CINZA })
    else {
      d.itens.forEach((it, j) => {
        const c = corDoc[it.estado]
        doc.setFillColor(...c.fundo)
        if (c.borda) { doc.setDrawColor(...c.borda); doc.setLineWidth(0.25) }
        doc.rect(xs[3] + 1.5 + j * 3.2, l1 - 2.5, 2.6, 2.6, c.borda ? 'FD' : 'F')
      })
      texto(`${d.feitos}/${d.total}`, xs[3] + 1.5 + 7 * 3.2 + 0.8, l1, { tam: 7.5, negrito: true, cor: d.faltam.length ? FORTE.amarelo : FORTE.verde })
    }
    // Próximo passo
    if (enc) texto('encerrada', xs[4] + 1.5, l1, { tam: 7.5, cor: CINZA })
    else if (!d.faltam.length) texto('Completo', xs[4] + 1.5, l1, { tam: 7.5, negrito: true, cor: FORTE.verde })
    else {
      const prox = d.itens.find(i => i.estado === 'falta' || i.estado === 'sem_arquivo')!
      texto(cabe(prox.estado === 'sem_arquivo' || (prox.chave === 'relatorio' && a.realizada_em) ? ANEXAR[prox.chave] : PASSO[prox.chave], cols[4].w - 3, 7.5), xs[4] + 1.5, l1, { tam: 7.5, cor: TINTA })
      if (d.faltam.length > 1) texto(`+ ${d.faltam.length - 1} documento(s)`, xs[4] + 1.5, l2, { tam: 6, cor: CINZA })
    }
    // Valor e se entrou
    const xv = xs[5] + cols[5].w - 1.5
    texto(enc ? '-' : brl(totalOrcamento(a)), xv, l1, { tam: 8, negrito: !enc, alinhar: 'right', cor: enc ? CINZA : TINTA })
    if (!enc) {
      const pg = a.pagamento === 'Pago' ? { t: 'entrou', c: FORTE.verde } : a.pagamento === 'Não se aplica' ? { t: 'sem cobrança', c: CINZA } : { t: 'a receber', c: FORTE.amarelo }
      texto(pg.t, xv, l2, { tam: 6.3, negrito: true, alinhar: 'right', cor: pg.c })
    }
    st.y += ALTURA
    doc.setDrawColor(232, 232, 228); doc.setLineWidth(0.1); doc.line(L, st.y - 1.2, R, st.y - 1.2)
  })
  // Legenda dos quadradinhos
  if (st.y + 6 > LIMITE) novaPagina()
  st.y += 2
  let xl = L
  const legenda: [EstadoDoc, string][] = [['ok', 'documento ok'], ['sem_arquivo', 'feito, falta o arquivo'], ['falta', 'falta'], ['nao_se_aplica', 'não se aplica']]
  texto('Documentos, na ordem:', xl, st.y, { tam: 6.5, cor: CINZA }); xl += 25
  legenda.forEach(([e, t]) => {
    const c = corDoc[e]
    doc.setFillColor(...c.fundo)
    if (c.borda) { doc.setDrawColor(...c.borda); doc.setLineWidth(0.25) }
    doc.rect(xl, st.y - 2.3, 2.4, 2.4, c.borda ? 'FD' : 'F')
    texto(t, xl + 3.4, st.y, { tam: 6.5, cor: CINZA })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5)
    xl += 3.4 + doc.getTextWidth(t) + 5
  })
  texto('orçamento, aprovação, comprovante, nota, agendamento, relatório, pagamento ao auditor', L, st.y + 3.4, { tam: 6.2, cor: CINZA })

  numerar(`Auditoria GR · resumo · ${periodo}`)
  return new Uint8Array(doc.output('arraybuffer'))
}
