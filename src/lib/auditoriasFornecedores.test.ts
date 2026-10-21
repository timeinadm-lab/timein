// Auditorias de fornecedores GRSA: leitura da planilha, números do topo e validade. Rodar: npm run testes
import { lerPlanilha, numerosDoTopo, validadePadrao, avisoValidade, lerData, COLUNAS, totalOrcamento, lerPagamento, faltandoNaFicha, quantoFalta, localDaAuditoria, abasRelatorioGR, nomeRelatorioGR, tipoDoAnexo, temComprovante, documentosDoProcesso, andamentoDocs, etapasDoProcesso, etapasFeitas, mesDoProcesso, nomeDoMes } from './auditoriasFornecedores'
import type { AuditoriaFornecedor } from './auditoriasFornecedores'
import { pontosDeAtencao, statusCurto, nomeResumoGR } from './auditoriaGRResumoPdf'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

// Mesmo formato da planilha de 07/10/2026 (título, números, aviso, cabeçalho na linha 9)
const NI = 'Não informado'
const linha = (o: Record<string, unknown>) => COLUNAS.map(c => o[c.titulo] ?? NI)
const planilha: unknown[][] = [
  [], ['GRSA – Auditorias de fornecedores'], ['Consolidado em 07/10/2026'], [],
  ['Fornecedores consolidados'], [16], [], ['Filtros no cabeçalho.'],
  COLUNAS.map(c => c.titulo),
  linha({ ID: 'GRSA-001', 'Fornecedor / razão social': 'Codicon', 'Status atual': 'Aguardando aprovação', CNPJ: '32.551.880/0002-61',
    'Tipo de auditoria': 'Inicial', 'Valor auditoria (R$)': 450, 'Deslocamento (R$)': 90, 'Total orçamento (R$)': 540,
    'Orçamento enviado em': 46302.5, Pagamento: 'Não confirmado' }),
  linha({ ID: 'GRSA-010A', 'Fornecedor / razão social': 'Long Way', Planta: 'Planta 1', 'Status atual': 'Agendada', CNPJ: '03.491.105/0001-89',
    'Valor auditoria (R$)': 450, 'Deslocamento (R$)': 90, 'Auditoria agendada para': 46304.5, Pagamento: 'Não confirmado' }),
  linha({ ID: 'GRSA-010B', 'Fornecedor / razão social': 'Long Way', Planta: 'Planta 2', 'Status atual': 'Agendada', CNPJ: '03.491.105/0001-89',
    'Valor auditoria (R$)': 450, 'Deslocamento (R$)': 0, Pagamento: 'Não confirmado' }),
  linha({ ID: 'GRSA-014', 'Fornecedor / razão social': 'São João', 'Status atual': 'Cancelada', 'Valor auditoria (R$)': 450, 'Deslocamento (R$)': 366 }),
  linha({ ID: 'GRSA-015', 'Fornecedor / razão social': 'Mestre Kuca', 'Status atual': 'Concluída', 'Tipo de auditoria': 'Inicial',
    'Valor auditoria (R$)': 450, 'Deslocamento (R$)': 90, Pagamento: 'Informado – comprovante enviado', 'Comprovante enviado': 'Sim',
    'Auditoria realizada em': 46283.5, Auditor: 'Rafaella Morial', 'Nota (0–100)': 84, Resultado: 'Aprovado', 'Validade da nova auditoria': 47379.5 }),
  [null, null, null],
]

console.log('Leitura da planilha')
const { registros, erro } = lerPlanilha(planilha)
ok(!erro && registros.length === 5, '5 registros (linha vazia ignorada)', { erro, n: registros.length })
const k = registros.find(r => r.codigo === 'GRSA-015')!
ok(k.realizada_em === '2026-09-18' && k.validade === '2029-09-18', 'datas do Excel viram dd certinho', [k.realizada_em, k.validade])
ok(k.nota === 84 && k.resultado === 'Aprovado' && k.comprovante_enviado === true && k.pagamento === 'Pago', 'resultado; "Informado – comprovante enviado" vira Pago com comprovante', k.pagamento)
const c = registros.find(r => r.codigo === 'GRSA-001')!
ok(c.contato === null && c.planta === null && c.orcamento_enviado_em === '2026-10-07', '"Não informado" vira vazio', c)
ok(totalOrcamento(c) === 540, 'total = valor + deslocamento')
ok(lerPlanilha([['a', 'b']]).erro !== undefined, 'planilha errada avisa')

console.log('Números do topo (iguais aos da planilha)')
const n = numerosDoTopo(registros)
ok(n.fornecedores === 4 && n.registros === 5, 'Long Way com 2 plantas conta como 1 fornecedor', n)
ok(n.concluidas === 1 && n.agendadas === 2, 'concluídas e agendadas', n)
ok(n.orcamentosAtivos === 540 + 540 + 450 + 540, 'orçamentos ativos: sem cancelada/encerrada', n.orcamentosAtivos)
ok(n.recebido === 540 && n.qtdRecebido === 1, 'já recebido: só o pago', n)
ok(n.aReceber === 540 + 540 + 450 && n.qtdAReceber === 3, 'a receber: ativos não pagos (sem a cancelada)', n)
ok(c.pagamento === 'Não pago', '"Não confirmado" vira Não pago')

console.log('Pagamento da planilha da GR')
ok(lerPagamento('Confirmado pelo financeiro').pagamento === 'Pago', 'confirmado pelo financeiro = pago')
ok(lerPagamento('Não aplicável').pagamento === 'Não se aplica', 'não aplicável')
ok(lerPagamento('Não pago').pagamento === 'Não pago' && lerPagamento(null).pagamento === 'Não pago', 'não pago / vazio')

console.log('Ficha em aberto (o que falta)')
const cheia: AuditoriaFornecedor = {
  codigo: 'GRSA-100', fornecedor: 'Fornecedor X', planta: null, status: 'Concluída', proxima_acao: null, cnpj: '1', categoria: 'Padaria', produtos: 'Pães',
  tipo: 'Inicial', cidade: 'Campinas', uf: 'SP', endereco: 'Rua 1', contato: 'Ana', email: 'a@b.c', telefone: '1', comprador: 'Polianna',
  unidade_grsa: 'Unimed', cr: '7', responsavel_pagamento: 'Fornecedor', valor_auditoria: 450, deslocamento: 0, cidade_polo: 'Campinas/SP',
  orcamento_enviado_em: '2026-10-01', aprovado_em: '2026-10-02', pagamento: 'Pago', pago_em: '2026-10-03', comprovante_enviado: false,
  comprovante_recebido_em: null, agendada_para: '2026-10-10', horario: '09:00', realizada_em: '2026-10-10', auditor: 'Rafa', nota: 90,
  resultado: 'Aprovado', validade: '2029-10-10', forma_pagamento: 'Pix na conta da empresa', precisa_nota: false, comprovante_url: 'auditoria-gr/x.pdf',
  valor_auditor: 200, auditor_pagamento: 'Pago', auditor_pago_em: '2026-10-15',
}
ok(quantoFalta(cheia) === 0, 'tudo preenchido: completa (planta e local podem ficar vazios: local vem da cidade)', faltandoNaFicha(cheia))
ok(faltandoNaFicha({ ...cheia, comprovante_url: null }).financeiro.join() === 'Comprovante', 'pago sem comprovante: falta o comprovante')
ok(faltandoNaFicha({ ...cheia, precisa_nota: true }).financeiro.join() === 'Nº da nota,Nota emitida em', 'precisa de nota: pede nº e data')
ok(faltandoNaFicha({ ...cheia, precisa_nota: null }).financeiro.join() === 'Nota fiscal?', 'nota não informada')
ok(faltandoNaFicha({ ...cheia, pagamento: 'Não pago', pago_em: null }).financeiro.join() === 'Pagamento', 'não pago: o pagamento fica pendente')
ok(faltandoNaFicha({ ...cheia, pagamento: 'Não se aplica', forma_pagamento: null, precisa_nota: null, comprovante_url: null }).financeiro.length === 0, 'não se aplica: financeiro não cobra')
ok(faltandoNaFicha({ ...cheia, deslocamento: null, cidade: null, uf: null }).orcamento.join() === 'Deslocamento', 'deslocamento vazio falta (0 vale)')
ok(faltandoNaFicha({ ...cheia, cidade: null, uf: null }).financeiro.join() === 'Local', 'sem cidade nem local: falta o local')
ok(quantoFalta({ ...cheia, status: 'Cancelada', cnpj: null, nota: null }) === 0, 'cancelada não cobra nada')
ok(faltandoNaFicha({ ...cheia, valor_auditor: null }).financeiro.join() === 'Valor do auditor', 'sem o valor do auditor: falta')
ok(faltandoNaFicha({ ...cheia, auditor_pagamento: 'A pagar', auditor_pago_em: null }).financeiro.join() === 'Pagar o auditor', 'auditoria feita e auditor a pagar: pendente')
ok(faltandoNaFicha({ ...cheia, realizada_em: null, auditor_pagamento: 'A pagar' }).financeiro.length === 0, 'antes da auditoria, auditor a pagar não cobra')
ok(faltandoNaFicha({ ...cheia, auditor_pago_em: null }).financeiro.join() === 'Auditor pago em', 'auditor pago sem data')
ok(localDaAuditoria(cheia) === 'Campinas/SP' && localDaAuditoria({ ...cheia, local_auditoria: 'Planta Sumaré' }) === 'Planta Sumaré', 'local: digitado ou cidade/UF')

console.log('Auditor, etapas e mês')
const nn = numerosDoTopo([...registros, cheia])
ok(nn.pagoAuditor === 200 && nn.aPagarAuditor === 0 && nn.custoAuditor === 200, 'auditor: pago 200', nn)
ok(nn.sobra === nn.orcamentosAtivos - 200, 'sobra = orçado (ativos) − auditores', nn.sobra)
ok(numerosDoTopo([{ ...cheia, auditor_pagamento: 'A pagar' }]).aPagarAuditor === 200, 'auditor a pagar')
ok(etapasDoProcesso(cheia).every(Boolean) && etapasFeitas(c) === 1, 'etapas: completa 6/6; só orçamento enviado 1/6', etapasDoProcesso(c))
ok(etapasDoProcesso({ ...cheia, pagamento: 'Não se aplica' })[2] && !etapasDoProcesso({ ...cheia, pagamento: 'Não pago' })[2], 'pagamento: pago ou não se aplica conta')
ok(mesDoProcesso(cheia) === '2026-10' && mesDoProcesso({ ...cheia, realizada_em: null, agendada_para: '2026-11-03' }) === '2026-11', 'mês: realizada, senão agendada')
ok(mesDoProcesso({ ...c, orcamento_enviado_em: null }) === null && mesDoProcesso({ ...c, orcamento_enviado_em: null, criado_em: '2026-09-30T10:00:00Z' }) === '2026-09', 'sem datas: mês em que a ficha foi criada')
ok(nomeDoMes('2026-10') === 'outubro de 2026', 'nome do mês')

console.log('Documentos do processo (102)')
ok(tipoDoAnexo('NF 1045.pdf') === 'nota' && tipoDoAnexo('danfe.pdf') === 'nota' && tipoDoAnexo('comprovante pix.jpg') === 'comprovante', 'tipo pelo nome: nota e comprovante')
ok(tipoDoAnexo('Relatório final.pdf') === 'relatorio' && tipoDoAnexo('orçamento 12.pdf') === 'orcamento' && tipoDoAnexo('IMG_2026.jpg') === 'outro' && tipoDoAnexo('informe.pdf') === 'outro', 'relatório, orçamento, outro (informe não é NF)')
const arq = (tipo: string, obs: string | null = null) => ({ caminho: `auditoria-gr/X/${tipo}.pdf`, nome: `${tipo}.pdf`, tipo: tipo as never, obs, em: '2026-10-08' })
const todos = ['orcamento', 'aprovacao', 'comprovante', 'relatorio', 'auditor'].map(t => arq(t))
const docsCheia = documentosDoProcesso({ ...cheia, anexos: todos })
ok(docsCheia.length === 7 && docsCheia.map(d => d.estado).join() === 'ok,ok,ok,nao_se_aplica,ok,ok,ok', '7 documentos; nota não precisa = não se aplica', docsCheia.map(d => d.estado))
ok(andamentoDocs({ ...cheia, anexos: todos }).faltam.length === 0 && andamentoDocs({ ...cheia, anexos: todos }).feitos === 7, 'tudo anexado: 7 de 7')
const semArq = documentosDoProcesso({ ...cheia, anexos: [] })
ok(semArq[0].estado === 'sem_arquivo' && semArq[2].estado === 'sem_arquivo' && semArq[4].estado === 'ok' && semArq[5].estado === 'falta', 'etapa feita sem arquivo; agendamento basta a data; relatório falta', semArq.map(d => d.estado))
ok(documentosDoProcesso({ ...cheia, anexos: [], auditoria_id: 'abc' })[5].estado === 'ok', 'relatório: auditoria feita no sistema conta')
ok(documentosDoProcesso({ ...cheia, precisa_nota: null })[3].estado === 'falta' && documentosDoProcesso({ ...cheia, precisa_nota: true, anexos: [arq('nota')] })[3].estado === 'ok', 'nota: indefinida falta; com arquivo ok')
ok(documentosDoProcesso({ ...cheia, pagamento: 'Não se aplica' }).filter(d => d.estado === 'nao_se_aplica').length === 2, 'pagamento não se aplica: comprovante e nota também não')
ok(documentosDoProcesso({ ...cheia, valor_auditor: 0 })[6].estado === 'nao_se_aplica', 'sem auditor terceirizado (valor 0)')
const novo = { ...cheia, orcamento_enviado_em: null, aprovado_em: null, pagamento: 'Não pago', pago_em: null, comprovante_url: null, agendada_para: null, realizada_em: null, auditor_pagamento: 'A pagar', anexos: [] }
ok(andamentoDocs(novo).feitos === 1 && andamentoDocs(novo).faltam[0] === 'Orçamento enviado', 'processo novo: só a nota (não precisa) resolvida', andamentoDocs(novo))
ok(andamentoDocs({ ...novo, status: 'Cancelada' }).faltam.length === 0, 'cancelada não cobra documento')
ok(documentosDoProcesso({ ...cheia, anexos: [arq('comprovante', 'Pix ok'), arq('comprovante')] })[2].anexos.length === 2, 'vários arquivos no mesmo documento')
ok(temComprovante({ ...cheia, comprovante_url: null, anexos: [arq('comprovante')] }) && !temComprovante({ ...cheia, comprovante_url: null, anexos: [arq('outro')] }), 'comprovante conta pelo anexo')

console.log('Relatório do mês (3 abas)')
const abas = abasRelatorioGR([...registros, { ...cheia, anexos: todos }], '2026-10-20', { filtro: 'outubro de 2026' })
ok(abas.map(a => a.nome).join() === 'Resumo,Auditorias,Planilha GR', 'abas Resumo, Auditorias e Planilha GR')
ok(String(abas[0].subtitulo).includes('outubro de 2026'), 'subtítulo diz o filtro')
const res = abas[0].linhas
ok(res.find(l => l[0] === 'A receber')?.[2] === 1530 && res.find(l => l[0] === 'Entrou (já pago)')?.[2] === 990, 'resumo: a receber e entrou', res)
ok(res.find(l => l[0] === 'Pago aos auditores')?.[2] === 200 && res.some(l => String(l[0]).startsWith('Sobra para a Time IN')), 'resumo: auditores e sobra')
const aud = abas[1]
ok(aud.linhas.length === 6 && aud.linhas[0][0] === 'GRSA-001' && aud.linhas[5][0] === 'GRSA-100', 'auditorias: uma linha por processo, pelo ID', aud.linhas.length)
ok(aud.linhas[5][4] === '7 de 7' && aud.linhas[5][5] === 'Nada, completo' && aud.cores?.[5] === 'verde', 'completa: 7 de 7, verde')
ok(String(aud.linhas[0][5]).startsWith('Orçamento enviado') && aud.cores?.[0] === 'amarelo', 'faltando: diz o quê, amarelo', aud.linhas[0][5])
ok(aud.linhas[3][4] === '—' && aud.cores?.[3] === 'cinza' && aud.linhas[3][12] === '—', 'cancelada: sem documentos nem sobra', aud.linhas[3][0])
const sobra = aud.linhas[5][12] as { formula: string; result: number }
ok(sobra.formula === 'G10-K10' && sobra.result === 250 && aud.linhas[5][8] === 450, 'sobra = total − auditor (fórmula); entrou = total pago', sobra)
ok((aud.total?.[12] as { result: number }).result === nn.sobra, 'total da sobra = resumo')
const acomp = abas[2]
ok(acomp.colunas.length === 36 && acomp.linhas.length === 6, 'planilha GR: 36 colunas')
const tot = acomp.linhas[0][21] as { formula: string; result: number }
ok(tot.formula === 'T5+U5' && tot.result === 540, 'total do orçamento é fórmula (valor + deslocamento)', tot)
ok(acomp.linhas[0][2] === 'Não informado' && acomp.linhas[0][23] === '07/10/2026', 'vazio = Não informado; data dd/mm/aaaa')
ok(nomeRelatorioGR('2026-10-20') === 'Auditoria_GR_20.10.26' && nomeRelatorioGR('2026-10-20', '2026-10') === 'Auditoria_GR_outubro-2026', 'nome do arquivo (geral e do mês)')

console.log('Validade (3 anos)')
ok(validadePadrao('2026-09-18') === '2029-09-18', '18/09/2026 → 18/09/2029')
ok(validadePadrao('2028-02-29') === '2031-02-28', '29/02 → 28/02')
ok(avisoValidade('2026-10-01', '2026-10-08')?.tipo === 'vencida', 'vencida')
ok(avisoValidade('2026-11-30', '2026-10-08')?.tipo === 'vencendo', 'vence em até 60 dias')
ok(avisoValidade('2027-06-01', '2026-10-08') === null, 'longe: sem aviso')
ok(lerData('18/09/2026') === '2026-09-18' && lerData('Não informado') === null, 'data em texto')

console.log('Resumo para a chefe (PDF)')
{
  const feita = { ...cheia, codigo: 'X-1', realizada_em: '2026-10-09', pagamento: 'Não pago', pago_em: null, auditor_pagamento: 'A pagar', valor_auditor: 200, auditor: 'Ana' }
  const at = pontosDeAtencao([feita], '2026-10-21')
  ok(at[0]?.includes('pagamento') && at[0].includes('ainda não entrou') && at.some(t => t.includes('auditor pendente (Ana')), 'feita e não paga vem primeiro; auditor a pagar', at)
  ok(pontosDeAtencao([{ ...feita, status: 'Cancelada' }], '2026-10-21').length === 0, 'cancelada não entra na atenção')
  const semResposta = { ...cheia, codigo: 'X-2', orcamento_enviado_em: '2026-10-01', aprovado_em: null, realizada_em: null }
  ok(pontosDeAtencao([semResposta], '2026-10-21').some(t => t.includes('há 20 dias sem aprovação')), 'orçamento sem resposta há mais de 7 dias')
  ok(pontosDeAtencao([{ ...semResposta, orcamento_enviado_em: '2026-10-18' }], '2026-10-21').every(t => !t.includes('sem aprovação')), 'orçamento recente não avisa')
  ok(statusCurto('Aguardando definição de laboratório') === 'Aguard. laboratório' && statusCurto('Agendada') === 'Agendada', 'status curto')
  ok(nomeResumoGR('2026-10-21', '2026-10') === 'Resumo_Auditoria_GR_outubro-2026', 'nome do resumo')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) de auditorias de fornecedores falharam`)
