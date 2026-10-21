// ============================================================
// Resumo da Auditoria GR em PDF, para a chefe (21/10/2026: "tem que ser
// simplificado, ela não pode ficar perdendo muito tempo lendo... visual, sem
// um milhão de páginas" e depois "ter noção do pé que cada uma está").
// Sai do que está na tela (mês, fase, filtro e busca):
//   1. Em que pé estão: as 5 fases do fluxo, com quantas em cada uma;
//   2. dinheiro em seis números (orçado, entrou, a receber, auditores, sobra);
//   3. "Precisa de atenção": só o que pede ação;
//   4. as auditorias agrupadas por fase, cada uma com as 6 etapas em
//      bolinhas, há quantos dias está parada, os 7 documentos, o próximo
//      passo e o valor. As mais paradas primeiro.
// ============================================================
import { criarPdf } from './pdfBase'
import {
  numerosDoTopo, andamentoDocs, documentosDoProcesso, totalOrcamento, localDaAuditoria, avisoValidade, nomeDoMes, nomeRelatorioGR,
  etapasDoProcesso, ultimoMovimento, faseDe, FASES, ENCERRADOS,
} from './auditoriasFornecedores'
import type { AuditoriaFornecedor, EstadoDoc, DocChave, FaseChave } from './auditoriasFornecedores'

type Cor = [number, number, number]
type Tom = 'verde' | 'azul' | 'amarelo' | 'cinza' | 'vermelho'
const FORTE: Record<Tom, Cor> = { verde: [21, 128, 61], azul: [37, 99, 235], amarelo: [217, 119, 6], cinza: [140, 146, 156], vermelho: [220, 38, 38] }
const CLARO: Record<Tom, Cor> = { verde: [220, 252, 231], azul: [219, 234, 254], amarelo: [254, 243, 199], cinza: [241, 242, 244], vermelho: [254, 226, 226] }
const TINTA: Cor = [33, 33, 33], CINZA: Cor = [120, 120, 120], VERDE_TIME: Cor = [15, 78, 48]
const TOM_FASE: Record<FaseChave, Tom> = { orcamento: 'amarelo', acerto: 'amarelo', agendada: 'azul', relatorio: 'azul', concluida: 'verde', encerrada: 'cinza' }

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
const PASSO_ETAPA = ['Enviar orçamento', 'Aguardar aprovação', 'Receber pagamento', 'Agendar auditoria', 'Fazer a auditoria', 'Lançar resultado']
/** O que fazer agora: a primeira etapa do processo que falta; com as 6 feitas, os documentos */
export function proximoPasso(a: AuditoriaFornecedor): string | null {
  if (encerrada(a)) return null
  const etapa = etapasDoProcesso(a).indexOf(false)
  if (etapa >= 0) return PASSO_ETAPA[etapa]
  const faltam = andamentoDocs(a).itens.filter(i => i.estado === 'falta' || i.estado === 'sem_arquivo')
  if (!faltam.length) return null
  if (faltam.length > 1) return `Anexar ${faltam.length} documentos`
  const prox = faltam[0]
  return prox.estado === 'sem_arquivo' || (prox.chave === 'relatorio' && a.realizada_em) ? ANEXAR[prox.chave] : PASSO[prox.chave]
}

/** Nome curto do status, para caber na tabela */
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
 * da auditoria feita, agenda que passou sem marcar, nota a emitir, auditor a
 * pagar, relatório faltando, orçamento sem resposta há mais de 7 dias,
 * validade vencendo (concluídas).
 */
type Ponto = { peso: number; codigo: string; t: string; valor?: number; dias?: number }
const JUNTOS: Record<number, (p: Ponto[]) => string> = {
  1: p => `${p.length} auditorias feitas e o pagamento não entrou (${brl(soma(p))})`,
  2: p => `${p.length} auditorias passaram da data agendada: marcar se foram feitas`,
  2.5: p => `${p.length} marcadas como pagas sem a data do pagamento`,
  3: p => `${p.length} notas fiscais a emitir (${brl(soma(p))})`,
  4: p => `${p.length} auditores a pagar (${brl(soma(p))})`,
  5: p => `${p.length} relatórios de auditoria a anexar`,
  6: p => { const v = [...p].sort((x, y) => (y.dias ?? 0) - (x.dias ?? 0))[0]; return `${p.length} orçamentos sem aprovação há mais de 7 dias (o mais antigo: ${v.codigo}, ${v.dias} dias)` },
  7: p => `${p.length} validades vencendo: oferecer renovação`,
}
const soma = (p: Ponto[]) => p.reduce((s, x) => s + (x.valor || 0), 0)
export function pontosDeAtencao(lista: AuditoriaFornecedor[], hoje: string): string[] {
  const out: Ponto[] = []
  for (const a of lista) {
    if (encerrada(a)) continue
    const quem = `${a.codigo} · ${a.fornecedor}`
    const add = (peso: number, t: string, extra: Partial<Ponto> = {}) => out.push({ peso, codigo: a.codigo, t: `${quem}: ${t}`, ...extra })
    const docs = documentosDoProcesso(a)
    if (a.realizada_em && a.pagamento !== 'Pago' && a.pagamento !== 'Não se aplica')
      add(1, `auditoria feita em ${dm(a.realizada_em)} e o pagamento (${brl(totalOrcamento(a))}) ainda não entrou`, { valor: totalOrcamento(a) })
    if (a.agendada_para && a.agendada_para < hoje && !a.realizada_em)
      add(2, `estava agendada para ${dm(a.agendada_para)}: marcar se foi feita`)
    if (a.pagamento === 'Pago' && !a.pago_em)
      add(2.5, 'marcada como paga, falta a data em que o pagamento entrou')
    if (a.pagamento === 'Pago' && a.precisa_nota && !a.nota_numero?.trim())
      add(3, `emitir a nota fiscal (${brl(totalOrcamento(a))})`, { valor: totalOrcamento(a) })
    if (a.realizada_em && a.auditor_pagamento !== 'Pago' && Number(a.valor_auditor) > 0)
      add(4, `pagamento do auditor pendente (${a.auditor ? a.auditor + ', ' : ''}${brl(Number(a.valor_auditor))})`, { valor: Number(a.valor_auditor) })
    if (a.realizada_em && docs.find(d => d.chave === 'relatorio')?.estado === 'falta')
      add(5, 'falta anexar o relatório da auditoria')
    if (a.orcamento_enviado_em && !a.aprovado_em && diasEntre(a.orcamento_enviado_em, hoje) > 7)
      add(6, `orçamento enviado há ${diasEntre(a.orcamento_enviado_em, hoje)} dias sem aprovação`, { dias: diasEntre(a.orcamento_enviado_em, hoje) })
    const v = a.status === 'Concluída' ? avisoValidade(a.validade, hoje) : null
    if (v) add(7, v.tipo === 'vencida' ? `validade venceu em ${dataBr(a.validade!)}: oferecer renovação` : `validade vence em ${v.dias} dias: oferecer renovação`)
  }
  const ord = out.sort((x, y) => x.peso - y.peso || x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }))
  const final: string[] = []
  for (const peso of [...new Set(ord.map(x => x.peso))]) {
    const doTipo = ord.filter(x => x.peso === peso)
    if (doTipo.length >= 3) final.push(`${JUNTOS[peso](doTipo)}: ${doTipo.map(x => x.codigo).join(', ')}`)
    else final.push(...doTipo.map(x => x.t))
  }
  return final
}

export const nomeResumoGR = (hoje: string, mes?: string | null) => 'Resumo_' + nomeRelatorioGR(hoje, mes)

export async function gerarResumoGR(lista: AuditoriaFornecedor[], opts: { hoje: string; mes?: string | null; filtro?: string }): Promise<Uint8Array> {
  const { hoje, mes } = opts
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
  const titulo = (t: string, x: number, y: number, w: number, direita?: string) => {
    texto(t.toUpperCase(), x, y, { tam: 7.5, negrito: true, cor: VERDE_TIME })
    if (direita) texto(direita, x + w, y, { tam: 7, cor: CINZA, alinhar: 'right' })
    doc.setDrawColor(...VERDE_TIME); doc.setLineWidth(0.3); doc.line(x, y + 1.4, x + w, y + 1.4)
  }
  const cabe = (t: string, larg: number, tam: number, negrito = false) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam)
    let s = t
    if (doc.getTextWidth(s) <= larg) return s
    while (s.length > 1 && doc.getTextWidth(s + '...') > larg) s = s.slice(0, -1)
    return s.trimEnd() + '...'
  }

  // 1. Em que pé estão: as 5 fases do fluxo (setas) + as que saíram dele
  const porFase = (f: FaseChave) => lista.filter(a => faseDe(a) === f)
  st.y = 33
  titulo('Em que pé estão', L, st.y, W, `${ativos.length} ativa(s) · ${comFalta.length} com documento faltando`)
  const fluxo = FASES.filter(f => f.chave !== 'encerrada')
  const seta = 4.5, bw = (W - seta * (fluxo.length - 1)) / fluxo.length, bh = 25, by = st.y + 4
  fluxo.forEach((f, i) => {
    const x = L + i * (bw + seta), q = porFase(f.chave), tom = TOM_FASE[f.chave]
    caixa(x, by, bw, bh, q.length ? CLARO[tom] : [246, 246, 244])
    texto(String(q.length), x + 3.5, by + 9.5, { tam: 17, negrito: true, cor: q.length ? FORTE[tom] : [185, 185, 185] })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2)
    const nome = doc.splitTextToSize(f.nome, bw - 6) as string[]
    nome.slice(0, 2).forEach((l, j) => texto(l, x + 3.5, by + 14 + j * 3.2, { tam: 7.2, negrito: true, cor: q.length ? TINTA : CINZA }))
    // De que status são (quando a fase junta mais de um)
    if (f.status.length > 1 && q.length) {
      const partes = f.status.map(s => [statusCurto(s).replace('Aguard. ', ''), q.filter(a => a.status === s).length] as const).filter(([, c]) => c > 0)
      texto(cabe(partes.map(([s, c]) => `${c} ${s.toLowerCase()}`).join(' · '), bw - 6, 5.8), x + 3.5, by + 22.5, { tam: 5.8, cor: CINZA })
    }
    if (i < fluxo.length - 1) {
      doc.setFillColor(200, 200, 196)
      const sx = x + bw + 0.9, sy = by + bh / 2
      doc.triangle(sx, sy - 2.2, sx, sy + 2.2, sx + seta - 1.8, sy, 'F')
    }
  })
  st.y = by + bh + 4.5
  const fora = porFase('encerrada')
  if (fora.length) {
    const partes = ENCERRADOS.map(s => [statusCurto(s).toLowerCase(), fora.filter(a => a.status === s).length] as const).filter(([, c]) => c > 0)
    texto(`Fora do fluxo: ${fora.length} (${partes.map(([s, c]) => `${c} ${s}`).join(', ')})`, L, st.y, { tam: 7, cor: CINZA })
    st.y += 4
  }

  // 2. Dinheiro: seis números
  const semValorAuditor = ativos.filter(a => a.valor_auditor === null || a.valor_auditor === undefined).length
  st.y += 3
  titulo('Dinheiro', L, st.y, W)
  const din: { rot: string; v: number; tom: Tom | null; sub?: string }[] = [
    { rot: 'Total orçado', v: n.orcamentosAtivos, tom: null, sub: `${ativos.length} ativa(s)` },
    { rot: 'Entrou', v: n.recebido, tom: 'verde', sub: n.orcamentosAtivos ? `${Math.round(100 * n.recebido / n.orcamentosAtivos)}% do orçado` : undefined },
    { rot: 'A receber', v: n.aReceber, tom: n.aReceber ? 'amarelo' : 'verde', sub: n.qtdAReceber ? `${n.qtdAReceber} auditoria(s)` : undefined },
    { rot: 'Pago aos auditores', v: n.pagoAuditor, tom: null },
    { rot: 'A pagar aos auditores', v: n.aPagarAuditor, tom: n.aPagarAuditor ? 'amarelo' : null, sub: n.qtdAPagarAuditor ? `${n.qtdAPagarAuditor} auditor(es)` : undefined },
    { rot: 'Sobra para a Time IN', v: n.sobra, tom: 'verde', sub: semValorAuditor ? `falta valor de ${semValorAuditor} auditor(es)` : 'orçado - auditores' },
  ]
  const g2 = 3, dw = (W - g2 * 5) / 6, dy = st.y + 4, dh = 15
  din.forEach((d, i) => {
    const x = L + i * (dw + g2)
    caixa(x, dy, dw, dh, d.tom ? CLARO[d.tom] : [243, 244, 241])
    texto(d.rot, x + 2.5, dy + 4.2, { tam: 6.5, cor: [80, 80, 80] })
    texto(cabe(brl(d.v), dw - 4, 9.5, true), x + 2.5, dy + 9.5, { tam: 9.5, negrito: true, cor: d.tom ? FORTE[d.tom] : TINTA })
    if (d.sub) texto(d.sub, x + 2.5, dy + 12.9, { tam: 5.8, cor: CINZA })
  })
  st.y = dy + dh + 4
  if (notas.length) {
    texto(`Notas fiscais a emitir: ${notas.length} (${brl(notas.reduce((s, a) => s + totalOrcamento(a), 0))})`, L, st.y, { tam: 7, negrito: true, cor: FORTE.vermelho })
    st.y += 4
  }

  // 3. Precisa de atenção
  st.y += 2
  const pontos = pontosDeAtencao(lista, hoje)
  const MAX = 6
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

  // 4. As auditorias, por fase (as mais paradas primeiro)
  const cols = [
    { t: 'ID', w: 16 }, { t: 'Fornecedor', w: 44 }, { t: 'Etapas', w: 33 }, { t: 'Parada há', w: 17 },
    { t: 'Documentos', w: 28 }, { t: 'Próximo passo', w: 26 }, { t: 'Valor', w: 18, dir: true },
  ]
  const xs = cols.reduce<number[]>((acc, c, i) => [...acc, i ? acc[i - 1] + cols[i - 1].w : L], [])
  const ALTURA = 8, BAIXA = 5.2, LIMITE = 285
  const cabTabela = (cont = false) => {
    titulo(cont ? 'Auditorias por fase (continuação)' : `Auditorias por fase (${lista.length})`, L, st.y, W)
    st.y += 5.5
    doc.setFillColor(243, 244, 241); doc.rect(L, st.y - 3.4, W, 5, 'F')
    cols.forEach((c, i) => texto(c.t, c.dir ? xs[i] + c.w - 1.5 : xs[i] + 1.5, st.y, { tam: 7, negrito: true, cor: [90, 90, 90], alinhar: c.dir ? 'right' : 'left' }))
    st.y += 4.2
  }
  const corDoc: Record<EstadoDoc, { fundo: Cor; borda?: Cor }> = {
    ok: { fundo: FORTE.verde }, sem_arquivo: { fundo: [252, 211, 77] },
    falta: { fundo: [255, 255, 255], borda: [170, 170, 170] }, nao_se_aplica: { fundo: [225, 227, 230] },
  }
  const quadrado = (x: number, y: number, lado: number, e: EstadoDoc) => {
    const c = corDoc[e]
    doc.setFillColor(...c.fundo)
    if (c.borda) { doc.setDrawColor(...c.borda); doc.setLineWidth(0.25) }
    doc.rect(x, y, lado, lado, c.borda ? 'FD' : 'F')
  }
  if (st.y + 30 > LIMITE) novaPagina()
  cabTabela()
  for (const f of FASES) {
    const doGrupo = porFase(f.chave).sort((x, y) => (ultimoMovimento(y, hoje).dias ?? -1) - (ultimoMovimento(x, hoje).dias ?? -1) || x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }))
    if (!doGrupo.length) continue
    const tom = TOM_FASE[f.chave], fechada = f.chave === 'encerrada'
    if (st.y + 6 + (fechada ? BAIXA : ALTURA) > LIMITE) { novaPagina(); cabTabela(true) }
    // Faixa da fase
    doc.setFillColor(...CLARO[tom]); doc.rect(L, st.y - 1.6, W, 5.2, 'F')
    doc.setFillColor(...FORTE[tom]); doc.rect(L, st.y - 1.6, 1.2, 5.2, 'F')
    texto(`${f.nome.toUpperCase()} · ${doGrupo.length}`, L + 3.5, st.y + 2, { tam: 7.2, negrito: true, cor: FORTE[tom] })
    st.y += 5.8
    doGrupo.forEach(a => {
      const alt = fechada ? BAIXA : ALTURA
      if (st.y + alt > LIMITE) { novaPagina(); cabTabela(true) }
      const y = st.y, l1 = y + 2.3, l2 = y + 5.3
      texto(a.codigo, xs[0] + 1.5, l1, { tam: 7.5, negrito: true, cor: fechada ? CINZA : TINTA })
      texto(cabe(a.fornecedor + (a.planta ? ` · ${a.planta}` : ''), cols[1].w - 3, 7.8), xs[1] + 1.5, l1, { tam: 7.8, cor: fechada ? CINZA : TINTA })
      if (fechada) {
        texto(statusCurto(a.status), xs[2] + 1.5, l1, { tam: 7, cor: CINZA })
        if (a.proxima_acao) texto(cabe(a.proxima_acao, cols[3].w + cols[4].w + cols[5].w - 3, 6.5), xs[3] + 1.5, l1, { tam: 6.5, cor: CINZA })
      } else {
        texto(cabe(localDaAuditoria(a) || 'local não informado', cols[1].w - 3, 6.2), xs[1] + 1.5, l2, { tam: 6.2, cor: CINZA })
        // Etapas: 6 bolinhas (feita / onde está / falta) e o status embaixo
        const feitas = etapasDoProcesso(a), atual = feitas.indexOf(false)
        const passo = 5, x0 = xs[2] + 2.5, cy = l1 - 1
        doc.setDrawColor(205, 205, 200); doc.setLineWidth(0.35); doc.line(x0, cy, x0 + passo * 5, cy)
        feitas.forEach((ok, j) => {
          const cx = x0 + j * passo
          if (ok) { doc.setFillColor(...FORTE.verde); doc.circle(cx, cy, 1.15, 'F') }
          else if (j === atual) { doc.setFillColor(...FORTE.amarelo); doc.circle(cx, cy, 1.35, 'F') }
          else { doc.setFillColor(255, 255, 255); doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.25); doc.circle(cx, cy, 1.05, 'FD') }
        })
        texto(cabe(statusCurto(a.status), cols[2].w - 2, 5.8), xs[2] + 1.5, l2 + 0.3, { tam: 5.8, cor: [90, 90, 90] })
        // Parada há N dias (ou a data marcada, se for no futuro)
        const mv = ultimoMovimento(a, hoje)
        if (f.chave === 'concluida') texto('-', xs[3] + 1.5, l1, { tam: 7.5, cor: CINZA })
        else if (mv.proxima) {
          texto(`auditoria ${dm(mv.proxima)}`, xs[3] + 1.5, l1, { tam: 7, negrito: true, cor: FORTE.azul })
          texto(`em ${diasEntre(hoje, mv.proxima)} dia(s)`, xs[3] + 1.5, l2, { tam: 6, cor: CINZA })
        } else if (mv.dias !== null) {
          const c = mv.dias > 20 ? FORTE.vermelho : mv.dias > 7 ? FORTE.amarelo : FORTE.verde
          texto(mv.dias === 0 ? 'hoje' : `${mv.dias} dia${mv.dias === 1 ? '' : 's'}`, xs[3] + 1.5, l1, { tam: 7.5, negrito: true, cor: c })
          texto(`desde ${dm(mv.data)}`, xs[3] + 1.5, l2, { tam: 6, cor: CINZA })
        } else texto('sem data', xs[3] + 1.5, l1, { tam: 7, cor: CINZA })
        // Documentos: 7 quadradinhos + "5/7"
        const d = andamentoDocs(a)
        d.itens.forEach((it, j) => quadrado(xs[4] + 1.5 + j * 3, l1 - 2.4, 2.4, it.estado))
        texto(`${d.feitos}/${d.total}`, xs[4] + 1.5 + 7 * 3 + 0.6, l1, { tam: 7, negrito: true, cor: d.faltam.length ? FORTE.amarelo : FORTE.verde })
        // Próximo passo
        const prox = proximoPasso(a)
        if (!prox) texto('Completo', xs[5] + 1.5, l1, { tam: 7.2, negrito: true, cor: FORTE.verde })
        else texto(cabe(prox, cols[5].w - 2.5, 7.2), xs[5] + 1.5, l1, { tam: 7.2, cor: TINTA })
        // Valor e se entrou
        const xv = xs[6] + cols[6].w - 1.5
        texto(brl(totalOrcamento(a)), xv, l1, { tam: 7.5, negrito: true, alinhar: 'right' })
        const pg = a.pagamento === 'Pago' ? { t: 'entrou', c: FORTE.verde } : a.pagamento === 'Não se aplica' ? { t: 'sem cobrança', c: CINZA } : { t: 'a receber', c: FORTE.amarelo }
        texto(pg.t, xv, l2, { tam: 6, negrito: true, alinhar: 'right', cor: pg.c })
      }
      st.y += alt
      doc.setDrawColor(232, 232, 228); doc.setLineWidth(0.1); doc.line(L, st.y - 1.2, R, st.y - 1.2)
    })
    st.y += 1.5
  }

  // Legenda: só se couber na mesma folha (não abre página só para ela)
  if (st.y + 11 <= 289) {
    st.y += 1.5
    let xl = L
    const leg = (desenha: (x: number) => number, t: string) => {
      const w = desenha(xl)
      texto(t, xl + w + 1.2, st.y, { tam: 6.2, cor: CINZA })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2)
      xl += w + 1.2 + doc.getTextWidth(t) + 4.5
    }
    texto('Etapas:', xl, st.y, { tam: 6.2, negrito: true, cor: CINZA }); xl += 9
    leg(x => { doc.setFillColor(...FORTE.verde); doc.circle(x + 1.1, st.y - 0.9, 1.1, 'F'); return 2.2 }, 'feita')
    leg(x => { doc.setFillColor(...FORTE.amarelo); doc.circle(x + 1.1, st.y - 0.9, 1.2, 'F'); return 2.4 }, 'onde está')
    leg(x => { doc.setFillColor(255, 255, 255); doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.25); doc.circle(x + 1.1, st.y - 0.9, 1, 'FD'); return 2.2 }, 'falta')
    texto('(orçamento, aprovação, pagamento, agendada, realizada, resultado)', xl, st.y, { tam: 6.2, cor: CINZA })
    st.y += 3.6; xl = L
    texto('Documentos:', xl, st.y, { tam: 6.2, negrito: true, cor: CINZA }); xl += 14
    const lq = (e: EstadoDoc, t: string) => leg(x => { quadrado(x, st.y - 2.1, 2.2, e); return 2.2 }, t)
    lq('ok', 'ok'); lq('sem_arquivo', 'feito, falta o arquivo'); lq('falta', 'falta'); lq('nao_se_aplica', 'não se aplica')
    texto('(orçamento, aprovação, comprovante, nota, agendamento, relatório, pgto. auditor)', xl, st.y, { tam: 6.2, cor: CINZA })
    st.y += 3.6
    texto('Parada há: dias desde a última data do processo (verde até 7, amarelo até 20, vermelho acima).', L, st.y, { tam: 6.2, cor: CINZA })
  }

  numerar(`Auditoria GR · resumo · ${periodo}`)
  return new Uint8Array(doc.output('arraybuffer'))
}
