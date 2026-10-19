// Teste da planilha para pagar. Rodar: node src/lib/planilhaParaPagar.test.ts
import { juntarPorPessoa, abasDaPlanilha, ordenarComprovantes } from './planilhaParaPagar'
import { numerarAnexos } from './comprovantesPdf'
import { abasComAnexo } from './planilhaComComprovantes'
import type { ItemPagar } from './planilhaParaPagar'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

const I = (x: Partial<ItemPagar>): ItemPagar => ({
  dia: 'd20', employee_id: 'a', nome: 'Ana', salario: 0, ajuda: 0, reembolso: 0, adiantamento: 0, obs: [], pago: false, mesTrabalhado: '2026-10', ...x,
})

const porDia = juntarPorPessoa([
  // Graziele: salário + reembolso
  I({ employee_id: 'g', nome: 'Graziele', salario: 2160, reembolso: 130, obs: ['GRSA PROJETOS', 'reembolso: Lavanderia'] }),
  // Ana: duas parcelas no mesmo dia (dois vínculos) viram uma linha; adiantamento sai do salário
  I({ salario: 1000, ajuda: 200, obs: ['Cliente A'] }),
  I({ salario: 500, adiantamento: 300, obs: ['Cliente B', 'Cliente A'] }),
  // Dia 8, já pago
  I({ dia: 'd8', employee_id: 'b', nome: 'Bia', salario: 875, pago: true, mesTrabalhado: '2026-09' }),
])

const d20 = porDia.get('d20')!
ok(d20.length === 2, 'uma linha por pessoa no dia 20')
ok(d20[0].nome === 'Ana' && d20[1].nome === 'Graziele', 'em ordem de nome')
const ana = d20[0]
ok(ana.salario === 1200, 'salário somado e com o adiantamento descontado (1500 − 300)')
ok(ana.ajuda === 200 && ana.total === 1400, 'total = salário + reembolso + ajuda')
ok(ana.obs.startsWith('Cliente A · Cliente B') && ana.obs.includes('Adiantamento de R$ 300,00'), 'observação junta sem repetir e avisa o adiantamento')
const gr = d20[1]
ok(gr.total === 2290 && gr.reembolso === 130, 'Graziele: 2160 + 130 = 2290')
ok(porDia.get('d8')![0].pago && porDia.get('d15')!.length === 0, 'dia 8 pago; dia 15 vazio')

const comps = ordenarComprovantes([
  { employee_id: 'g', nome: 'Graziele', dia: 'Dia 20', descricao: 'Passagem', data: '2026-10-11', valor: 50, caminho: null },
  { employee_id: 'g', nome: 'Graziele', dia: 'Dia 20', descricao: 'Lavanderia', data: '2026-10-10', valor: 80, caminho: 'x.jpg' },
])
ok(comps[0].descricao === 'Lavanderia', 'comprovantes em ordem de nome e data')
const abas = abasDaPlanilha('outubro de 2026', porDia, id => (id === 'b' ? '' : 'pix@x'), comps, numerarAnexos(comps))
ok(abas.map(a => a.nome).join(',') === 'Dia 8,Dia 20,Comprovantes', 'aba por dia com gente + Comprovantes')
const a20 = abas[1]
const tot = a20.linhas[0][5] as { formula: string; result: number }
ok(tot.formula === 'C5+D5+E5' && tot.result === 1400, 'Total é fórmula da própria linha')
ok((a20.total![5] as { formula: string }).formula === 'SUM(F5:F6)', 'linha de total soma a coluna')
ok(a20.colunas.map(c => c.titulo).join('|') === 'Nome completo|PIX|Salário|Reembolso|Ajuda de custo|Total|Observação', 'colunas pedidas')
ok(abas[0].cores![0] === 'verde', 'pago fica verde')
const aba = abas[2]
ok(aba.linhas[0][5] === 'Anexo 1' && aba.linhas[1][5] === 'Sem comprovante anexado', 'aba Comprovantes: número do anexo no PDF (sem arquivo avisa)')
ok(aba.cores![1] === 'amarelo' && (aba.total![4] as { result: number }).result === 130, 'sem comprovante em amarelo; total dos reembolsos')

// Planilha da aba Reembolsos: "Anexo N" na ordem das linhas, total da coluna de dinheiro
const [r] = abasComAnexo([{ nome: 'Reembolsos', cabecalho: ['Nome', 'Valor'], colunasDinheiro: [1], linhas: [
  { valores: ['Ana', 10], comprovante: 'a.pdf' }, { valores: ['Bia', 20] }, { valores: ['Caio', 5], comprovante: 'c.jpg' },
] }])
ok(r.linhas.map(l => l[2]).join('|') === 'Anexo 1|Sem comprovante|Anexo 2', 'Reembolsos: anexo numerado só para quem tem arquivo')
ok((r.total![1] as { formula: string; result: number }).formula === 'SUM(B5:B7)' && (r.total![1] as { result: number }).result === 35, 'Reembolsos: total da coluna Valor')

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nTudo certo.')
