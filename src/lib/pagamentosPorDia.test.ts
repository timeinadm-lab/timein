// Teste da divisão por dia de pagamento. Rodar: node src/lib/pagamentosPorDia.test.ts
import { agruparPorDia, totaisDoMes, chaveDoDia, limitesDoMes, mesCurto } from './pagamentosPorDia'
import type { Lancamento } from './pagamentosPorDia'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

const L = (id: string, due: string, amount: number, status = 'Pendente', extra: Partial<Lancamento> = {}): Lancamento =>
  ({ id, due_date: due, amount, status, description: id, ...extra })

// Outubro: 2ª quinzena da consultoria de setembro (08/10), fixos 8/15/20, avulsos
const lanc: Lancamento[] = [
  L('consult-set-q2', '2026-10-08', 450.5, 'Pendente', { reference_month: '2026-09' }),
  L('fixo-8', '2026-10-08', 3000, 'Pago'),
  L('fixo-15', '2026-10-15', 2800),
  L('consult-out-q1', '2026-10-20', 900.25),
  L('fixo-20', '2026-10-20', 2500, 'Pago'),
  L('rescisao', '2026-10-03', 1200),
  L('fornecedor', '2026-10-27', 300),
  L('cancelado-8', '2026-10-08', 999, 'Cancelado'),
  L('texto', '2026-10-08', '100.10' as unknown as number),
]
const hoje = '2026-10-16'
const g = agruparPorDia(lanc, hoje)
const por = (c: string) => g.find(x => x.chave === c)!

console.log('Divisão por dia')
ok(g.map(x => x.titulo).join(',') === 'Dia 8,Dia 15,Dia 20,Avulsos', 'sempre os 4 grupos, nesta ordem')
ok(por('d8').itens.length === 3, 'dia 8 tem 3 (cancelado fica de fora)')
ok(por('d8').total === 3550.6, 'dia 8 soma 450,50 + 3000 + 100,10 (valor em texto também soma)')
ok(por('d8').pago === 3000 && por('d8').pendente === 550.6, 'dia 8: pago e pendente separados')
ok(por('d8').atrasado === 550.6, 'dia 8 pendente já passou do dia 16 → atrasado')
ok(por('d15').atrasado === 2800, 'dia 15 pendente vencido em 16/10 → atrasado')
ok(por('d20').atrasado === 0 && por('d20').pendente === 900.25, 'dia 20 ainda não venceu → não é atraso')
ok(por('avulso').itens.map(i => i.id).join(',') === 'rescisao,fornecedor', 'avulsos por data (03 antes de 27)')
ok(por('avulso').total === 1500, 'avulsos somam 1500')
ok(por('d8').itens[por('d8').itens.length - 1].status === 'Pago', 'dentro do dia, pago vai para o fim')

const t = totaisDoMes(g)
ok(t.total === 11250.85, 'total do mês = soma de tudo menos cancelado')
ok(t.pago === 5500 && t.pendente === 5750.85, 'pago + pendente = total')
ok(r(t.pago + t.pendente) === t.total, 'nada se perde entre pago e pendente')
ok(t.qtd === 8, '8 lançamentos (9 menos o cancelado)')

console.log('Auxiliares')
ok(chaveDoDia('2026-10-08') === 'd8' && chaveDoDia('2026-10-18') === 'avulso' && chaveDoDia('2026-10-05') === 'avulso', 'dia 5 e 18 são avulsos')
ok(limitesDoMes('2026-02').fim === '2026-02-28' && limitesDoMes('2028-02').fim === '2028-02-29', 'fevereiro e ano bissexto')
ok(limitesDoMes('2026-12').inicio === '2026-12-01' && limitesDoMes('2026-12').fim === '2026-12-31', 'dezembro')
ok(mesCurto('2026-09') === 'set/2026' && mesCurto(null) === '', 'mês de referência curto')
ok(agruparPorDia([], hoje).every(x => x.total === 0 && x.itens.length === 0), 'mês sem lançamento: tudo zero')

function r(n: number) { return Math.round(n * 100) / 100 }

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
