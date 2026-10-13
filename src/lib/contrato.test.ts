// Teste do contrato que paga ao concluir. Rodar: node src/lib/contrato.test.ts
import { diasDoContrato, salariosDoContrato, situacaoAoConcluir } from './contrato'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

ok(diasDoContrato('2026-10-13', '2026-11-11') === 30, '13/10 a 11/11 = 30 dias')
ok(salariosDoContrato('2026-10-13', '2026-11-12') === 1, '13/10 a 12/11 = 1 salário')
ok(salariosDoContrato('2026-10-13', '2026-11-11') === 1, '13/10 a 11/11 (30 dias) = 1 salário')
ok(salariosDoContrato('2026-10-01', '2026-10-31') === 1, 'outubro inteiro = 1 salário')
ok(salariosDoContrato('2026-02-01', '2026-02-28') === 1, 'fevereiro inteiro = 1 salário')
ok(salariosDoContrato('2026-11-01', '2026-11-10') === 0.3333, '10 dias = 10/30')
ok(salariosDoContrato('2026-10-13', '2026-12-12') === 2, '13/10 a 12/12 = 2 salários')
ok(salariosDoContrato('2026-01-31', '2026-02-27') === 1, '31/01 a 27/02 = 1 salário (fim de mês)')
ok(salariosDoContrato('2026-10-13', '2026-10-12') === 0, 'fim antes do início = 0')

// Começa 13/10, termina 12/11, paga dia 15: ciclo de outubro (15/09–14/10) não paga nada
const out = situacaoAoConcluir('2026-10-13', '2026-11-12', '2026-09-15', '2026-10-14')
ok(out.estado === 'aguarda', 'dia 15/10: aguarda a conclusão (antes pagava 13 e 14)')
// Ciclo de novembro (15/10–14/11) tem o último dia: paga o contrato inteiro em 15/11
const nov = situacaoAoConcluir('2026-10-13', '2026-11-12', '2026-10-15', '2026-11-14')
ok(nov.estado === 'paga' && nov.fator === 1 && nov.ini === '2026-10-13' && nov.dias === 31, 'dia 15/11: paga 1 salário, de 13/10 a 12/11')
// Dezembro: já foi pago
ok(situacaoAoConcluir('2026-10-13', '2026-11-12', '2026-11-15', '2026-12-14').estado === 'fora', 'dia 15/12: nada (já pago)')
// Encerrado antes de concluir (Encerrar contrato muda o fim): paga os dias feitos
const cedo = situacaoAoConcluir('2026-10-13', '2026-10-22', '2026-10-15', '2026-11-14')
ok(cedo.estado === 'paga' && cedo.dias === 10 && cedo.fator === 0.3333, 'encerrou em 22/10: paga 10 dias em 15/11')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
