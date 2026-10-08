// Auditorias de fornecedores GRSA: leitura da planilha, números do topo e validade. Rodar: npm run testes
import { lerPlanilha, numerosDoTopo, validadePadrao, avisoValidade, lerData, COLUNAS, totalOrcamento } from './auditoriasFornecedores'

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
ok(k.nota === 84 && k.resultado === 'Aprovado' && k.comprovante_enviado === true && k.pagamento === 'Informado – comprovante enviado', 'resultado e pagamento')
const c = registros.find(r => r.codigo === 'GRSA-001')!
ok(c.contato === null && c.planta === null && c.orcamento_enviado_em === '2026-10-07', '"Não informado" vira vazio', c)
ok(totalOrcamento(c) === 540, 'total = valor + deslocamento')
ok(lerPlanilha([['a', 'b']]).erro !== undefined, 'planilha errada avisa')

console.log('Números do topo (iguais aos da planilha)')
const n = numerosDoTopo(registros)
ok(n.fornecedores === 4 && n.registros === 5, 'Long Way com 2 plantas conta como 1 fornecedor', n)
ok(n.concluidas === 1 && n.agendadas === 2, 'concluídas e agendadas', n)
ok(n.orcamentosAtivos === 540 + 540 + 450 + 540, 'orçamentos ativos: sem cancelada/encerrada', n.orcamentosAtivos)
ok(n.pagamentoInformado === 540, 'pagamento informado', n.pagamentoInformado)

console.log('Validade (3 anos)')
ok(validadePadrao('2026-09-18') === '2029-09-18', '18/09/2026 → 18/09/2029')
ok(validadePadrao('2028-02-29') === '2031-02-28', '29/02 → 28/02')
ok(avisoValidade('2026-10-01', '2026-10-08')?.tipo === 'vencida', 'vencida')
ok(avisoValidade('2026-11-30', '2026-10-08')?.tipo === 'vencendo', 'vence em até 60 dias')
ok(avisoValidade('2027-06-01', '2026-10-08') === null, 'longe: sem aviso')
ok(lerData('18/09/2026') === '2026-09-18' && lerData('Não informado') === null, 'data em texto')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) de auditorias de fornecedores falharam`)
