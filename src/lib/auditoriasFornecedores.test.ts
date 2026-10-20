// Auditorias de fornecedores GRSA: leitura da planilha, números do topo e validade. Rodar: npm run testes
import { lerPlanilha, numerosDoTopo, validadePadrao, avisoValidade, lerData, COLUNAS, totalOrcamento, lerPagamento, faltandoNaFicha, quantoFalta, localDaAuditoria, abasRelatorioGR, nomeRelatorioGR } from './auditoriasFornecedores'
import type { AuditoriaFornecedor } from './auditoriasFornecedores'

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
ok(localDaAuditoria(cheia) === 'Campinas/SP' && localDaAuditoria({ ...cheia, local_auditoria: 'Planta Sumaré' }) === 'Planta Sumaré', 'local: digitado ou cidade/UF')

console.log('Relatório (3 abas)')
const abas = abasRelatorioGR([...registros, cheia], '2026-10-20')
ok(abas.map(a => a.nome).join() === 'Resumo,Acompanhamento,Financeiro', 'abas Resumo, Acompanhamento e Financeiro')
const acomp = abas[1]
ok(acomp.colunas.length === 36 && acomp.linhas.length === 6, 'acompanhamento: 36 colunas da GR, uma linha por registro', acomp.linhas.length)
ok(acomp.linhas[0][0] === 'GRSA-001' && acomp.linhas[5][0] === 'GRSA-100', 'ordem pelo ID (numérica)')
const tot = acomp.linhas[0][21] as { formula: string; result: number }
ok(tot.formula === 'T5+U5' && tot.result === 540, 'total do orçamento é fórmula (valor + deslocamento)', tot)
ok(acomp.linhas[0][2] === 'Não informado' && acomp.linhas[0][23] === '07/10/2026', 'vazio = Não informado; data dd/mm/aaaa')
ok(acomp.cores?.[3] === 'cinza' && acomp.cores?.[4] === 'verde' && acomp.cores?.[1] === 'azul', 'cor pelo status')
const fin = abas[2]
ok((fin.linhas[5][8] as { formula: string }).formula === 'G10+H10','financeiro: total = G+H')
ok(fin.linhas[5][4] === 'Fornecedor' && fin.linhas[5][5] === 'Pix na conta da empresa' && fin.linhas[5][14] === 'Sim', 'quem paga, forma e comprovante')
const res = abas[0].linhas
ok(res.find(l => l[0] === 'A receber')?.[2] === 1530 && res.find(l => l[0] === 'Já recebido (pago)')?.[2] === 990, 'resumo: a receber e recebido', res)
ok(nomeRelatorioGR('2026-10-20') === 'Auditoria_GR_20.10.26', 'nome do arquivo')

console.log('Validade (3 anos)')
ok(validadePadrao('2026-09-18') === '2029-09-18', '18/09/2026 → 18/09/2029')
ok(validadePadrao('2028-02-29') === '2031-02-28', '29/02 → 28/02')
ok(avisoValidade('2026-10-01', '2026-10-08')?.tipo === 'vencida', 'vencida')
ok(avisoValidade('2026-11-30', '2026-10-08')?.tipo === 'vencendo', 'vence em até 60 dias')
ok(avisoValidade('2027-06-01', '2026-10-08') === null, 'longe: sem aviso')
ok(lerData('18/09/2026') === '2026-09-18' && lerData('Não informado') === null, 'data em texto')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) de auditorias de fornecedores falharam`)
