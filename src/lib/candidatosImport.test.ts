// Importação de candidatos: data da resposta e "fica só a última resposta". Rodar: npm run testes
import { lerCarimbo, ultimaRespostaDeCada, camposParaAtualizar } from './candidatosImport'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}
const local = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso), p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

console.log('Carimbo de data/hora')
ok(local(lerCarimbo('07/10/2026 14:32:10')) === '07/10/2026 14:32', 'formato do Google Forms', local(lerCarimbo('07/10/2026 14:32:10')))
ok(local(lerCarimbo('7/1/2026 9:05')) === '07/01/2026 09:05', 'dia e mês com um dígito')
ok(local(lerCarimbo('46302.6034722222')) === '07/10/2026 14:29', 'número do Excel', local(lerCarimbo('46302.6034722222')))
ok(local(lerCarimbo('2026-10-07T14:32:00')) === '07/10/2026 14:32', 'ISO')
ok(lerCarimbo('') === null && lerCarimbo('Sim') === null && lerCarimbo('3') === null, 'texto que não é data fica sem data')

console.log('Mesma pessoa várias vezes: fica a última resposta')
type L = { nome: string; wa: string; email: string; cidade: string; quando: string | null }
const ch = (l: L) => ({ wa: l.wa, email: l.email, nomeCidade: `${l.nome}|${l.cidade}` })
const linhas: L[] = [
  { nome: 'ana', wa: '41999990000', email: 'a@x', cidade: 'pg', quando: '2026-09-01T10:00:00Z' },
  { nome: 'bia', wa: '41988880000', email: 'b@x', cidade: 'ctba', quando: '2026-09-02T10:00:00Z' },
  { nome: 'ana', wa: '41999990000', email: 'a@x', cidade: 'pg', quando: '2026-10-05T10:00:00Z' },
  { nome: 'ana', wa: '41977770000', email: 'a@x', cidade: 'pg', quando: '2026-10-07T10:00:00Z' },   // trocou o número
  { nome: 'ana', wa: '41999990000', email: 'a@x', cidade: 'pg', quando: '2026-09-15T10:00:00Z' },   // mais antiga, embaixo
]
const r = ultimaRespostaDeCada(linhas, ch, l => l.quando)
ok(r.length === 2, '5 linhas, 2 pessoas', r.length)
ok(r.find(x => x.nome === 'ana')?.quando === '2026-10-07T10:00:00Z', 'Ana: fica a de 07/10 (a mais nova), mesmo com outro número')
const semData = ultimaRespostaDeCada([{ nome: 'c', wa: '1', email: '', cidade: '', quando: null }, { nome: 'c2', wa: '1', email: '', cidade: '', quando: null }], l => ({ wa: l.wa, email: '', nomeCidade: '' }), l => l.quando)
ok(semData.length === 1 && semData[0].nome === 'c2', 'sem data: vale a linha de baixo')

console.log('Atualizar quem refez o formulário')
const up = camposParaAtualizar({ city: 'Curitiba', email: '', tools: [], pipeline_stage: 'Banco', experience_time: '2 anos', whatsapp: null })
ok(JSON.stringify(up) === JSON.stringify({ city: 'Curitiba', experience_time: '2 anos' }), 'vazio não apaga; estágio não muda', up)

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) de importação de candidatos falharam`)
