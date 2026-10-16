// Testes dos aniversários (Calendário e tela Aniversariantes). Rodar todos: npm run testes
import { diaMes, aniversarioNoAno, idadeNoAno, proximoAniversario, aniversariantesDoMes } from './aniversario'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

ok(diaMes('1990-10-16')?.mes === 10 && diaMes('1990-10-16')?.dia === 16, 'lê dia e mês')
ok(diaMes('') === null && diaMes(null) === null && diaMes('16/10/1990') === null, 'data vazia ou em outro formato: ignora')
ok(aniversarioNoAno('1990-10-16', 2026) === '2026-10-16', 'aniversário no ano')
ok(aniversarioNoAno('2000-02-29', 2026) === '2026-02-28', '29/02 vira 28/02 em ano comum')
ok(aniversarioNoAno('2000-02-29', 2028) === '2028-02-29', '29/02 em ano bissexto')
ok(idadeNoAno('1990-10-16', 2026) === 36, 'faz 36 anos')
ok(idadeNoAno('0001-10-16', 2026) === null, 'ano de nascimento estranho: sem idade')

const hoje = proximoAniversario('1990-10-16', '2026-10-16')
ok(hoje?.dias === 0 && hoje?.idade === 36, 'é hoje', hoje)
const amanha = proximoAniversario('1990-10-17', '2026-10-16')
ok(amanha?.dias === 1, 'é amanhã', amanha)
const passou = proximoAniversario('1990-10-15', '2026-10-16')
ok(passou?.data === '2027-10-15' && passou?.idade === 37, 'já passou: próximo é no ano que vem', passou)

const lista = aniversariantesDoMes([
  { id: '1', full_name: 'Bia', birth_date: '1995-10-30' },
  { id: '2', full_name: 'Ana', birth_date: '1988-10-02' },
  { id: '3', full_name: 'Caio', birth_date: '1990-11-02' },
  { id: '4', full_name: 'Duda', birth_date: null },
], '2026-10')
ok(lista.map(p => p.full_name).join(',') === 'Ana,Bia', 'só os do mês, em ordem de dia', lista)
ok(lista[0].idade === 38 && lista[0].data === '2026-10-02', 'idade e data no mês', lista[0])

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
