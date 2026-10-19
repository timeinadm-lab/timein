// Teste da planilha da Ajuda de custo. Rodar: npm run testes
import { filtrarPeriodo, porPessoa, abasAjudaCusto } from './planilhaAjudaCusto'
import type { AjudaPlanilha } from './planilhaAjudaCusto'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

const A = (x: Partial<AjudaPlanilha>): AjudaPlanilha => ({
  id: Math.random().toString(36), employee_id: 'j', client_id: 'pg', periodo: 'semana', inicio: '2026-10-12', fim: '2026-10-18',
  tipo: 'Outro', descricao: null, valor: 0, status: 'Pendente', pago_em: null, ...x,
})
const ajudas = [
  A({ link_id: 'l1', valor: 350, inicio: '2026-10-05', fim: '2026-10-11', status: 'Pago', pago_em: '2026-10-06' }),
  A({ link_id: 'l1', valor: 350 }),
  A({ expense_id: 'e1', tipo: 'Reembolso', descricao: 'Uber', valor: 81 }),
  A({ employee_id: 'b', link_id: 'l2', valor: 0 }),                                  // semana zerada: não entra
  A({ employee_id: 'b', periodo: 'mes', inicio: '2026-10-01', fim: '2026-10-31', tipo: 'Hospedagem', descricao: 'Airbnb', valor: 2000 }),
]
const nome = (id: string | null) => ({ j: 'Jane Cristina', b: 'Bruna' } as Record<string, string>)[id || ''] || ''
const cli = (id: string | null) => (id === 'pg' ? 'Ponta Grossa' : '')

const mes = filtrarPeriodo(ajudas, { tipo: 'mes' })
ok(mes.length === 4, 'mês: tudo menos o zerado')
const sem = filtrarPeriodo(ajudas, { tipo: 'semana', de: '2026-10-12', ate: '2026-10-18' })
ok(sem.length === 2 && sem.every(a => a.inicio === '2026-10-12'), 'semana: só os lançamentos daquela semana')

const ps = porPessoa(mes, nome, cli)
ok(ps.map(p => p.nome).join(',') === 'Bruna,Jane Cristina', 'uma linha por pessoa em ordem de nome')
const jane = ps[1]
ok(jane.contrato === 700 && jane.reembolso === 81 && jane.outros === 0 && jane.total === 781 && jane.pago === 350, 'Jane: contrato + reembolso, 350 pago')
ok(ps[0].outros === 2000 && ps[0].obs[0] === 'Hospedagem (Airbnb)', 'Bruna: outros custos com a descrição na observação')

const abas = abasAjudaCusto({ tituloPeriodo: 'outubro de 2026', ajudas: mes, nome, pix: id => (id === 'j' ? 'jane@pix' : ''), cliente: cli, comprovante: () => 'Sem comprovante' })
ok(abas.map(a => a.nome).join('|') === 'Para pagar|Lançamentos|Ponta Grossa', 'abas: Para pagar, Lançamentos, uma por cliente')
const pp = abas[0]
ok(pp.colunas[1].titulo === 'PIX' && pp.linhas[1][1] === 'jane@pix' && pp.linhas[0][1] === 'SEM PIX NO CADASTRO', 'PIX na planilha (e aviso de quem não tem)')
ok((pp.linhas[1][6] as { formula: string }).formula === 'D6+E6+F6', 'Total da pessoa é fórmula')
ok((pp.total![6] as { result: number }).result === 2781, 'total geral')
ok(pp.cores![0] === 'amarelo', 'sem PIX fica amarelo')
const lanc = abas[1]
ok(lanc.colunas.at(-1)!.titulo === 'Comprovante' && (lanc.total![6] as { formula: string }).formula === 'SUM(G5:G8)', 'lançamentos com comprovante e total da coluna Valor')
ok(lanc.cores!.filter(c => c === 'verde').length === 1, 'pago fica verde')

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nTudo certo.')
