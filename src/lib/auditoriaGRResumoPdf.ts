// ============================================================
// Resumo da Auditoria GR em PDF (folha deitada). Pedidos:
// - 21/10/2026 (Gabriel): "simplificado, a chefe não pode perder tempo lendo,
//   visual, sem um milhão de páginas" e "noção do pé que cada uma está";
// - 22/10/2026 (cliente): manter a visão macro e o status; tirar ID,
//   documentos e próximo passo; pôr CNPJ, quem paga, valor da auditoria e do
//   deslocamento, datas do orçamento (enviado e resposta), cobranças, auditor,
//   resultado, quando o resultado foi enviado e a próxima auditoria.
// Sai do que está na tela (mês, fase, filtro e busca):
//   1. Em que pé estão: as 5 fases do fluxo, com quantas em cada uma;
//   2. dinheiro em seis números;
//   3. "Precisa de atenção": só o que pede ação;
//   4. as auditorias por fase, as mais paradas primeiro.
// ============================================================
import { criarPdf } from './pdfBase'
import {
  numerosDoTopo, andamentoDocs, totalOrcamento, localDaAuditoria, avisoValidade, nomeDoMes, nomeRelatorioGR,
  etapasDoProcesso, ultimoMovimento, faseDe, cobrancasDe, FASES, ENCERRADOS, ROTULO_QUEM_PAGA,
} from './auditoriasFornecedores'
import type { AuditoriaFornecedor, DocChave, FaseChave } from './auditoriasFornecedores'

type Cor = [number, number, number]
type Tom = 'verde' | 'azul' | 'amarelo' | 'cinza' | 'vermelho'
const FORTE: Record<Tom, Cor> = { verde: [21, 128, 61], azul: [37, 99, 235], amarelo: [217, 119, 6], cinza: [140, 146, 156], vermelho: [220, 38, 38] }
const CLARO: Record<Tom, Cor> = { verde: [220, 252, 231], azul: [219, 234, 254], amarelo: [254, 243, 199], cinza: [241, 242, 244], vermelho: [254, 226, 226] }
const TINTA: Cor = [33, 33, 33], CINZA: Cor = [120, 120, 120], VERDE_TIME: Cor = [15, 78, 48]
const TOM_FASE: Record<FaseChave, Tom> = { orcamento: 'amarelo', acerto: 'amarelo', agendada: 'azul', relatorio: 'azul', concluida: 'verde', encerrada: 'cinza' }

const brl = (n: number) => 'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const reais = (n: number) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const dm = (d?: string | null) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const encerrada = (a: AuditoriaFornecedor) => ENCERRADOS.includes(a.status)
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000)
/** Nome curto para as listas: sem "Ltda.", sem o que vem depois do travessão, até 3 palavras (+ planta) */
export const nomeCurto = (a: Pick<AuditoriaFornecedor, 'fornecedor' | 'planta'>) => {
  const base = a.fornecedor.split(/\s+[–-]\s+/)[0].replace(/\s+(ltda|ltd|me|eireli|s\/?a)\.?$/i, '').trim().split(/\s+/).slice(0, 3).join(' ')
  const planta = a.planta?.match(/planta\s*\d+/i)?.[0]
  return planta ? `${base} (${planta})` : base
}

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
 * da auditoria feita, agenda que passou sem marcar, pago sem data, nota a
 * emitir, auditor a pagar, resultado não enviado, orçamento sem resposta há
 * mais de 7 dias (com as cobranças), próxima auditoria chegando.
 */
type Ponto = { peso: number; codigo: string; nome: string; t: string; valor?: number; dias?: number; cobrado?: boolean }
const JUNTOS: Record<number, (p: Ponto[]) => string> = {
  1: p => `${p.length} auditorias feitas e o pagamento não entrou (${brl(soma(p))})`,
  2: p => `${p.length} auditorias passaram da data agendada: marcar se foram feitas`,
  2.5: p => `${p.length} marcadas como pagas sem a data do pagamento`,
  3: p => `${p.length} notas fiscais a emitir (${brl(soma(p))})`,
  4: p => `${p.length} auditores a pagar (${brl(soma(p))})`,
  5: p => `${p.length} resultados ainda não enviados à GR`,
  6: p => {
    const v = [...p].sort((x, y) => (y.dias ?? 0) - (x.dias ?? 0))[0]
    const semCobrar = p.filter(x => !x.cobrado).length
    return `${p.length} orçamentos sem resposta há mais de 7 dias (o mais antigo: ${v.nome}, ${v.dias} dias${semCobrar ? `; ${semCobrar} sem nenhuma cobrança` : ''})`
  },
  7: p => `${p.length} próximas auditorias chegando`,
}
const soma = (p: Ponto[]) => p.reduce((s, x) => s + (x.valor || 0), 0)
export function pontosDeAtencao(lista: AuditoriaFornecedor[], hoje: string): string[] {
  const out: Ponto[] = []
  for (const a of lista) {
    if (encerrada(a)) continue
    const nome = nomeCurto(a)
    const add = (peso: number, t: string, extra: Partial<Ponto> = {}) => out.push({ peso, codigo: a.codigo, nome, t: `${nome}: ${t}`, ...extra })
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
    if (a.resultado && !a.resultado_enviado_em)
      add(5, `resultado (${a.resultado.toLowerCase()}) ainda não enviado à GR`)
    if (a.orcamento_enviado_em && !a.aprovado_em && diasEntre(a.orcamento_enviado_em, hoje) > 7) {
      const cob = cobrancasDe(a)
      add(6, `orçamento enviado há ${diasEntre(a.orcamento_enviado_em, hoje)} dias sem resposta${cob.length ? ` (cobrado ${cob.length}x, última ${dm(cob[cob.length - 1].data)})` : ' (ainda não cobrado)'}`,
        { dias: diasEntre(a.orcamento_enviado_em, hoje), cobrado: cob.length > 0 })
    }
    const v = a.status === 'Concluída' ? avisoValidade(a.validade, hoje) : null
    if (v) add(7, v.tipo === 'vencida' ? `próxima auditoria venceu em ${dataBr(a.validade!)}` : `próxima auditoria em ${v.dias} dias (${dataBr(a.validade!)})`)
  }
  const ord = out.sort((x, y) => x.peso - y.peso || x.codigo.localeCompare(y.codigo, 'pt-BR', { numeric: true }))
  const final: string[] = []
  for (const peso of [...new Set(ord.map(x => x.peso))]) {
    const doTipo = ord.filter(x => x.peso === peso)
    if (doTipo.length >= 3) final.push(`${JUNTOS[peso](doTipo)}: ${doTipo.map(x => x.nome).join(', ')}`)
    else final.push(...doTipo.map(x => x.t))
  }
  return final
}

export const nomeResumoGR = (hoje: string, mes?: string | null) => 'Resumo_' + nomeRelatorioGR(hoje, mes)

export async function gerarResumoGR(lista: AuditoriaFornecedor[], opts: { hoje: string; mes?: string | null; filtro?: string }): Promise<Uint8Array> {
  const { hoje, mes } = opts
  const n = numerosDoTopo(lista)
  const ativos = lista.filter(a => !encerrada(a))
  const notas = ativos.filter(a => a.pagamento === 'Pago' && a.precisa_nota && !a.nota_numero?.trim())

  const { doc, st, L, R, W, texto, cabecalho, numerar, novaPagina } = await criarPdf(true)
  const LIMITE = 197
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
  const largura = (t: string, tam: number, negrito = false) => { doc.setFont('helvetica', negrito ? 'bold' : 'normal'); doc.setFontSize(tam); return doc.getTextWidth(t) }
  const cabe = (t: string, larg: number, tam: number, negrito = false) => {
    let s = t
    if (largura(s, tam, negrito) <= larg) return s
    while (s.length > 1 && largura(s + '...', tam, negrito) > larg) s = s.slice(0, -1)
    return s.trimEnd() + '...'
  }

  // 1. Em que pé estão: as 5 fases do fluxo (setas) + as que saíram dele
  const porFase = (f: FaseChave) => lista.filter(a => faseDe(a) === f)
  st.y = 33
  titulo('Em que pé estão', L, st.y, W, `${ativos.length} ativa(s)`)
  const fluxo = FASES.filter(f => f.chave !== 'encerrada')
  const seta = 5, bw = (W - seta * (fluxo.length - 1)) / fluxo.length, bh = 21, by = st.y + 4
  fluxo.forEach((f, i) => {
    const x = L + i * (bw + seta), q = porFase(f.chave), tom = TOM_FASE[f.chave]
    caixa(x, by, bw, bh, q.length ? CLARO[tom] : [246, 246, 244])
    texto(String(q.length), x + 4, by + 10, { tam: 18, negrito: true, cor: q.length ? FORTE[tom] : [185, 185, 185] })
    texto(f.nome, x + 4, by + 15.2, { tam: 8, negrito: true, cor: q.length ? TINTA : CINZA })
    if (f.status.length > 1 && q.length) {
      const partes = f.status.map(s => [statusCurto(s).replace('Aguard. ', 'aguard. '), q.filter(a => a.status === s).length] as const).filter(([, c]) => c > 0)
      texto(cabe(partes.map(([s, c]) => `${c} ${s.toLowerCase()}`).join(' · '), bw - 8, 6.3), x + 4, by + 18.8, { tam: 6.3, cor: CINZA })
    }
    if (i < fluxo.length - 1) {
      doc.setFillColor(200, 200, 196)
      const sx = x + bw + 1, sy = by + bh / 2
      doc.triangle(sx, sy - 2.4, sx, sy + 2.4, sx + seta - 2, sy, 'F')
    }
  })
  st.y = by + bh + 4.5
  const fora = porFase('encerrada')
  if (fora.length) {
    const partes = ENCERRADOS.map(s => [statusCurto(s).toLowerCase(), fora.filter(a => a.status === s).length] as const).filter(([, c]) => c > 0)
    texto(`Fora do fluxo: ${fora.length} (${partes.map(([s, c]) => `${c} ${s}`).join(', ')})`, L, st.y, { tam: 7, cor: CINZA })
    st.y += 3.5
  }

  // 2. Dinheiro: seis números
  const semValorAuditor = ativos.filter(a => a.valor_auditor === null || a.valor_auditor === undefined).length
  const somaCampo = (k: 'valor_auditoria' | 'deslocamento') => ativos.reduce((s, a) => s + (Number(a[k]) || 0), 0)
  st.y += 3
  titulo('Dinheiro', L, st.y, W)
  const din: { rot: string; v: number; tom: Tom | null; sub?: string }[] = [
    { rot: 'Total orçado', v: n.orcamentosAtivos, tom: null, sub: `auditorias ${brl(somaCampo('valor_auditoria'))} + desloc. ${brl(somaCampo('deslocamento'))}` },
    { rot: 'Entrou', v: n.recebido, tom: 'verde', sub: n.orcamentosAtivos ? `${Math.round(100 * n.recebido / n.orcamentosAtivos)}% do orçado` : undefined },
    { rot: 'A receber', v: n.aReceber, tom: n.aReceber ? 'amarelo' : 'verde', sub: n.qtdAReceber ? `${n.qtdAReceber} auditoria(s)` : undefined },
    { rot: 'Pago aos auditores', v: n.pagoAuditor, tom: null },
    { rot: 'A pagar aos auditores', v: n.aPagarAuditor, tom: n.aPagarAuditor ? 'amarelo' : null, sub: n.qtdAPagarAuditor ? `${n.qtdAPagarAuditor} auditor(es)` : undefined },
    { rot: 'Sobra para a Time IN', v: n.sobra, tom: 'verde', sub: semValorAuditor ? `falta valor de ${semValorAuditor} auditor(es)` : 'orçado - auditores' },
  ]
  const g2 = 3.5, dw = (W - g2 * 5) / 6, dy = st.y + 3.5, dh = 14
  din.forEach((d, i) => {
    const x = L + i * (dw + g2)
    caixa(x, dy, dw, dh, d.tom ? CLARO[d.tom] : [243, 244, 241])
    texto(d.rot, x + 3, dy + 4, { tam: 6.8, cor: [80, 80, 80] })
    texto(brl(d.v), x + 3, dy + 9, { tam: 10, negrito: true, cor: d.tom ? FORTE[d.tom] : TINTA })
    if (d.sub) texto(cabe(d.sub, dw - 5, 6), x + 3, dy + 12.3, { tam: 6, cor: CINZA })
  })
  st.y = dy + dh + 4
  if (notas.length) {
    texto(`Notas fiscais a emitir: ${notas.length} (${brl(notas.reduce((s, a) => s + totalOrcamento(a), 0))})`, L, st.y, { tam: 7, negrito: true, cor: FORTE.vermelho })
    st.y += 4
  }

  // 3. Precisa de atenção
  st.y += 1.5
  const pontos = pontosDeAtencao(lista, hoje)
  const MAX = 5
  if (!pontos.length) {
    caixa(L, st.y, W, 8.5, CLARO.verde)
    texto('Nada urgente: nenhum pagamento atrasado, nota, auditor ou resultado pendente.', L + 4, st.y + 5.6, { tam: 8.5, negrito: true, cor: FORTE.verde })
    st.y += 13
  } else {
    const mostrar = pontos.slice(0, MAX)
    const resto = pontos.length - mostrar.length
    const alt = 8 + mostrar.length * 3.9 + (resto ? 3.9 : 0)
    caixa(L, st.y, W, alt, CLARO.amarelo, [245, 158, 11])
    texto(`Precisa de atenção (${pontos.length})`, L + 4, st.y + 5.2, { tam: 8.8, negrito: true, cor: [120, 53, 15] })
    mostrar.forEach((p, i) => {
      const y = st.y + 9.6 + i * 3.9
      doc.setFillColor(...FORTE.amarelo); doc.circle(L + 5, y - 1, 0.7, 'F')
      texto(cabe(p, W - 12, 7.8), L + 7.5, y, { tam: 7.8, cor: [92, 45, 10] })
    })
    if (resto) texto(`+ ${resto} outro(s) ponto(s)`, L + 7.5, st.y + 9.6 + mostrar.length * 3.9, { tam: 7.5, cor: [146, 64, 14] })
    st.y += alt + 5
  }

  // 4. As auditorias, por fase (as mais paradas primeiro)
  const cols: { t: string; w: number; dir?: boolean; grupo?: string }[] = [
    { t: 'Fornecedor', w: 52 }, { t: 'Situação', w: 30 }, { t: 'Quem paga', w: 22 },
    { t: 'Auditoria', w: 17, dir: true, grupo: 'Valor (R$)' }, { t: 'Desloc.', w: 15, dir: true, grupo: 'Valor (R$)' }, { t: 'Total', w: 19, dir: true, grupo: 'Valor (R$)' },
    { t: 'Enviado', w: 22, grupo: 'Orçamento' }, { t: 'Cobranças', w: 17 }, { t: 'Auditor', w: 22 },
    { t: 'Resultado', w: 22, grupo: 'Resultado' }, { t: 'Enviado', w: 14, grupo: 'Resultado' }, { t: 'Próxima', w: 17, grupo: 'Resultado' },
  ]
  const xs = cols.reduce<number[]>((acc, c, i) => [...acc, i ? acc[i - 1] + cols[i - 1].w : L], [])
  const ALTURA = 8.2, BAIXA = 5.4
  const cabTabela = (cont = false) => {
    titulo(cont ? 'Auditorias por fase (continuação)' : `Auditorias por fase (${lista.length})`, L, st.y, W)
    st.y += 4
    // Grupos em cima (Valor, Orçamento, Resultado)
    doc.setFillColor(243, 244, 241); doc.rect(L, st.y - 0.6, W, 8.6, 'F')
    const grupos = [...new Set(cols.map(c => c.grupo).filter(Boolean))] as string[]
    for (const g of grupos) {
      const i0 = cols.findIndex(c => c.grupo === g), i1 = cols.map(c => c.grupo).lastIndexOf(g)
      const x0 = xs[i0], x1 = xs[i1] + cols[i1].w
      texto(g, (x0 + x1) / 2 - largura(g, 6.3, true) / 2, st.y + 2.4, { tam: 6.3, negrito: true, cor: [120, 120, 120] })
      doc.setDrawColor(200, 200, 196); doc.setLineWidth(0.15); doc.line(x0 + 1.5, st.y + 3.3, x1 - 1.5, st.y + 3.3)
    }
    cols.forEach((c, i) => texto(c.t, c.dir ? xs[i] + c.w - 1.5 : xs[i] + 1.5, st.y + 6.6, { tam: 6.8, negrito: true, cor: [90, 90, 90], alinhar: c.dir ? 'right' : 'left' }))
    st.y += 11
  }
  if (st.y + 26 > LIMITE) novaPagina()
  cabTabela()
  const TOM_RES: Record<string, Tom> = { Aprovado: 'verde', 'Aprovado com ressalvas': 'amarelo', Reprovado: 'vermelho' }
  for (const f of FASES) {
    const doGrupo = porFase(f.chave).sort((x, y) => (ultimoMovimento(y, hoje).dias ?? -1) - (ultimoMovimento(x, hoje).dias ?? -1) || x.fornecedor.localeCompare(y.fornecedor, 'pt-BR'))
    if (!doGrupo.length) continue
    const tom = TOM_FASE[f.chave], fechada = f.chave === 'encerrada'
    if (st.y + 6 + (fechada ? BAIXA : ALTURA) > LIMITE) { novaPagina(); cabTabela(true) }
    doc.setFillColor(...CLARO[tom]); doc.rect(L, st.y - 1.6, W, 5, 'F')
    doc.setFillColor(...FORTE[tom]); doc.rect(L, st.y - 1.6, 1.2, 5, 'F')
    texto(`${f.nome.toUpperCase()} · ${doGrupo.length}`, L + 3.5, st.y + 1.9, { tam: 7, negrito: true, cor: FORTE[tom] })
    st.y += 5.6
    doGrupo.forEach(a => {
      const alt = fechada ? BAIXA : ALTURA
      if (st.y + alt > LIMITE) { novaPagina(); cabTabela(true) }
      const y = st.y, l1 = y + 2.3, l2 = y + 5.4
      const em = (i: number, t: string, linha: number, o: { tam?: number; negrito?: boolean; cor?: Cor } = {}) => {
        const c = cols[i], tam = o.tam ?? 7.3
        texto(cabe(t, c.w - 2.5, tam, o.negrito), c.dir ? xs[i] + c.w - 1.5 : xs[i] + 1.5, linha, { tam, negrito: o.negrito, cor: o.cor ?? TINTA, alinhar: c.dir ? 'right' : 'left' })
      }
      em(0, a.fornecedor + (a.planta ? ` · ${a.planta}` : ''), l1, { tam: 7.6, cor: fechada ? CINZA : TINTA })
      if (fechada) {
        em(1, statusCurto(a.status), l1, { tam: 7, cor: CINZA })
        if (a.proxima_acao) texto(cabe(a.proxima_acao, xs[8] - xs[2] - 3, 6.5), xs[2] + 1.5, l1, { tam: 6.5, cor: CINZA })
      } else {
        em(0, [localDaAuditoria(a), a.cnpj].filter(Boolean).join(' · ') || 'local e CNPJ não informados', l2, { tam: 6, cor: CINZA })
        // Situação: status + parada há / data marcada
        const rot = cabe(statusCurto(a.status), cols[1].w - 6, 6.6, true)
        caixa(xs[1] + 1.5, l1 - 2.7, largura(rot, 6.6, true) + 3.4, 3.8, CLARO[tom])
        texto(rot, xs[1] + 3.2, l1, { tam: 6.6, negrito: true, cor: FORTE[tom] })
        const mv = ultimoMovimento(a, hoje)
        if (f.chave === 'concluida') em(1, a.realizada_em ? `feita em ${dm(a.realizada_em)}` : '', l2, { tam: 6, cor: CINZA })
        else if (mv.proxima) em(1, `auditoria em ${dm(mv.proxima)}`, l2, { tam: 6, negrito: true, cor: FORTE.azul })
        else if (mv.dias !== null) em(1, `parada há ${mv.dias} dia${mv.dias === 1 ? '' : 's'}`, l2, { tam: 6, negrito: true, cor: mv.dias > 20 ? FORTE.vermelho : mv.dias > 7 ? FORTE.amarelo : FORTE.verde })
        // Quem paga e se entrou
        const quem = a.responsavel_pagamento ? ROTULO_QUEM_PAGA[a.responsavel_pagamento] || a.responsavel_pagamento : null
        em(2, quem || 'a definir', l1, { cor: quem ? TINTA : FORTE.amarelo })
        const pg = a.pagamento === 'Pago' ? { t: a.pago_em ? `pago ${dm(a.pago_em)}` : 'pago', c: FORTE.verde } : a.pagamento === 'Não se aplica' ? { t: 'sem cobrança', c: CINZA } : { t: 'a receber', c: FORTE.amarelo }
        em(2, pg.t, l2, { tam: 6, negrito: true, cor: pg.c })
        // Valor: auditoria, deslocamento, total
        em(3, a.valor_auditoria != null ? reais(Number(a.valor_auditoria)) : '-', l1)
        em(4, a.deslocamento != null ? reais(Number(a.deslocamento)) : '-', l1)
        em(5, reais(totalOrcamento(a)), l1, { negrito: true })
        // Orçamento: enviado e resposta
        em(6, a.orcamento_enviado_em ? dataBr(a.orcamento_enviado_em) : 'não enviado', l1, { cor: a.orcamento_enviado_em ? TINTA : CINZA })
        if (a.orcamento_enviado_em) em(6, a.aprovado_em ? `resposta ${dm(a.aprovado_em)}` : 'sem resposta', l2, { tam: 6, negrito: !a.aprovado_em, cor: a.aprovado_em ? CINZA : FORTE.amarelo })
        // Cobranças
        const cob = cobrancasDe(a)
        if (cob.length) {
          em(7, `${cob.length}x`, l1, { negrito: true })
          em(7, `última ${dm(cob[cob.length - 1].data)}`, l2, { tam: 6, cor: CINZA })
        } else em(7, '-', l1, { cor: CINZA })
        // Auditor
        em(8, a.auditor || 'a definir', l1, { cor: a.auditor ? TINTA : CINZA })
        if (a.realizada_em) em(8, `feita ${dm(a.realizada_em)}`, l2, { tam: 6, cor: CINZA })
        else if (a.agendada_para) em(8, `agendada ${dm(a.agendada_para)}`, l2, { tam: 6, cor: CINZA })
        // Resultado, quando foi enviado, próxima auditoria
        if (a.resultado) {
          const tr = TOM_RES[a.resultado] || 'cinza'
          em(9, a.resultado === 'Aprovado com ressalvas' ? 'Com ressalvas' : a.resultado, l1, { negrito: true, cor: FORTE[tr] })
          if (a.nota != null) em(9, `nota ${String(a.nota).replace('.', ',')}`, l2, { tam: 6, cor: CINZA })
          em(10, a.resultado_enviado_em ? dm(a.resultado_enviado_em) : 'não env.', l1, { tam: a.resultado_enviado_em ? 7.3 : 6.3, negrito: !a.resultado_enviado_em, cor: a.resultado_enviado_em ? TINTA : FORTE.amarelo })
        } else em(9, '-', l1, { cor: CINZA })
        if (a.validade) em(11, dataBr(a.validade), l1)
      }
      st.y += alt
      doc.setDrawColor(232, 232, 228); doc.setLineWidth(0.1); doc.line(L, st.y - 1.2, R, st.y - 1.2)
    })
    st.y += 1.2
  }
  if (st.y + 3 <= LIMITE + 4) {
    st.y += 1.5
    texto('Parada há: dias desde a última data informada na ficha (verde até 7, amarelo até 20, vermelho acima). Próxima auditoria: aprovado 2 anos, com ressalvas 6 meses (sugestão; muda conforme a categoria).', L, st.y, { tam: 6.2, cor: CINZA })
  }

  numerar(`Auditoria GR · resumo · ${periodo}`)
  return new Uint8Array(doc.output('arraybuffer'))
}
