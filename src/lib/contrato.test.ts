// Teste do contrato com datas de pagamento combinadas. Rodar: npm run testes
import { diasDoContrato, salariosDoContrato, sugerirParcelas, problemasDasParcelas, parcelaDoMes, proximaParcela } from './contrato'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

ok(diasDoContrato('2026-10-13', '2026-11-11') === 30, '13/10 a 11/11 = 30 dias')
ok(salariosDoContrato('2026-10-13', '2026-11-12') === 1, '13/10 a 12/11 = 1 salário')
ok(salariosDoContrato('2026-10-13', '2026-11-11') === 1, '13/10 a 11/11 (30 dias) = 1 salário')
ok(salariosDoContrato('2026-02-01', '2026-02-28') === 1, 'fevereiro inteiro = 1 salário')
ok(salariosDoContrato('2026-11-01', '2026-11-10') === 0.3333, '10 dias = 10/30')
ok(salariosDoContrato('2026-10-13', '2026-12-12') === 2, '13/10 a 12/12 = 2 salários')
ok(salariosDoContrato('2026-01-31', '2026-02-27') === 1, '31/01 a 27/02 = 1 salário (fim de mês)')

// Sugestão
const um = sugerirParcelas('2026-10-13', '2026-11-12', 5000, 15)
ok(um.length === 1 && um[0].data === '2026-11-15' && um[0].valor === 5000, '1 mês, dia 15: só 15/11 com R$ 5.000')
const tres = sugerirParcelas('2026-10-13', '2027-01-12', 5000, 15)
ok(JSON.stringify(tres.map(p => p.data)) === '["2026-11-15","2026-12-15","2027-01-15"]', '3 meses: 15/11, 15/12, 15/01')
ok(tres.reduce((s, p) => s + p.valor, 0) === 15000 && tres[0].valor === 5000, '3 meses: R$ 5.000 cada, total R$ 15.000')
const quebrado = sugerirParcelas('2026-10-13', '2026-12-01', 3000, 8)
ok(Math.abs(quebrado.reduce((s, p) => s + p.valor, 0) - 4900) < 0.01, 'total quebrado fecha no centavo (1 mês e 20 dias)')
ok(quebrado[quebrado.length - 1].data === '2026-12-08', 'última data é o primeiro dia 8 depois do fim')
ok(sugerirParcelas('2026-10-13', '2026-10-01', 5000, 15).length === 0, 'fim antes do início: sem sugestão')

// Conferência
ok(problemasDasParcelas(um, '2026-11-12').length === 0, 'sugestão está ok')
ok(problemasDasParcelas([{ data: '2026-11-14', valor: 100 }]).some(p => p.includes('8, 15 ou 20')), 'dia 14 não vale')
ok(problemasDasParcelas([{ data: '2026-11-08', valor: 1 }, { data: '2026-11-20', valor: 1 }]).some(p => p.includes('mesmo mês')), 'duas no mesmo mês não vale')
ok(problemasDasParcelas([{ data: '2026-11-08', valor: 0 }]).some(p => p.includes('valor')), 'valor zero não vale')
ok(problemasDasParcelas([{ data: '2026-11-08', valor: 10 }], '2026-11-12').some(p => p.includes('depois do fim')), 'avisa se nada cai depois do fim')

// Folha: qual parcela cai no mês
ok(parcelaDoMes(um, '2026-10', '2026-10-13', '2026-11-12') === null, 'outubro: nada')
const nov = parcelaDoMes(um, '2026-11', '2026-10-13', '2026-11-12')
ok(!!nov && nov.valor === 5000 && nov.de === '2026-10-13' && nov.ate === '2026-11-12' && nov.numero === 1, 'novembro: R$ 5.000, cobre 13/10 a 12/11')
const dez = parcelaDoMes(tres, '2026-12', '2026-10-13', '2027-01-12')
ok(!!dez && dez.de === '2026-11-15' && dez.ate === '2026-12-14' && dez.numero === 2 && dez.total === 3, 'dezembro: parcela 2 de 3, cobre 15/11 a 14/12')
ok(proximaParcela(tres, '2026-10-13')?.data === '2026-11-15', 'próxima a partir de hoje: 15/11')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
