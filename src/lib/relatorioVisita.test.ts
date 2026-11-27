// Testes do relatório de visita (rodam com: npm run testes)
import { tituloPadrao, ehTituloPadrao, horarioTexto, cpfBR, faltaParaFinalizar, itensComConteudo, linhasDeFotos, relatorioNovo, agruparPorSetor, itensParaPdf } from './relatorioVisita'
import type { ItemRelatorio } from './relatorioVisita'

let falhas = 0
const ok = (cond: boolean, nome: string, extra?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { falhas++; console.log('  FALHOU', nome, extra ?? '') }
}

console.log('Título')
ok(tituloPadrao('2026-11-18') === 'Visita do dia 18/11/2026', 'título padrão com a data')
ok(ehTituloPadrao('Visita do dia 18/09/2026') && ehTituloPadrao('  '), 'reconhece o padrão e o vazio')
ok(!ehTituloPadrao('Visita técnica Espaço Terrá'), 'título escrito pela pessoa não é trocado')

console.log('Horário e CPF')
ok(horarioTexto('08:00:00', '11:30:00') === '08:00 até 11:30h', 'entrada e saída')
ok(horarioTexto('08:00', '') === '08:00h' && horarioTexto('', '') === '', 'só entrada / nada')
ok(cpfBR('42706781866') === '427.067.818-66', 'CPF com pontos')
ok(cpfBR('') === '' && cpfBR('123') === '123', 'CPF incompleto volta como veio')

console.log('Finalizar')
const base = { client_id: 'c1', data: '2026-11-18', entrada: '08:00', saida: '11:30', objetivo: 'Visita técnica', itens: [] }
ok(faltaParaFinalizar(base).length === 0, 'só com objetivo já pode (anotação não é obrigatória)')
ok(faltaParaFinalizar({ ...base, client_id: '' }).includes('escolher o cliente'), 'sem cliente não pode')
ok(faltaParaFinalizar({ ...base, saida: '' }).includes('a hora que saiu'), 'sem saída não pode')
ok(faltaParaFinalizar({ ...base, saida: '08:00' }).length === 1, 'saída igual à entrada avisa')
ok(faltaParaFinalizar({ ...base, objetivo: '  ' }).length === 1, 'sem objetivo e sem anotação avisa')
ok(faltaParaFinalizar({ ...base, objetivo: '', itens: [{ id: 'a', tipo: 'nota', texto: '', fotos: ['f.jpg'] }] }).length === 0, 'só foto já é conteúdo')

console.log('Anotações')
const itens = itensComConteudo([
  { id: '1', tipo: 'nota', texto: 'Etiquetas ok', fotos: [] },
  { id: '2', tipo: 'nota', texto: '   ', fotos: [] },
  { id: '3', tipo: 'titulo', texto: 'Casa Lucca', fotos: [] },
  { id: '4', tipo: 'nota', texto: '', fotos: ['x.jpg'] },
])
ok(itens.length === 3 && !itens.some(i => i.id === '2'), 'anotação vazia não entra no PDF')

console.log('Fotos no PDF')
const tres = linhasDeFotos([{ w: 800, h: 600 }, { w: 600, h: 800 }, { w: 600, h: 800 }], 182)
ok(tres.length === 1 && tres[0].length === 3, 'três fotos numa linha')
ok(tres[0].every(f => f.h === tres[0][0].h), 'mesma altura na linha')
ok(tres[0].reduce((s, f) => s + f.w, 0) + 6 <= 182.01, 'cabem na largura da página', tres[0])
ok(Math.abs(tres[0][0].w / tres[0][0].h - 800 / 600) < 0.01, 'sem deformar')
const uma = linhasDeFotos([{ w: 4000, h: 1000 }], 182)
ok(uma[0][0].w <= 182 && uma[0][0].h < 52, 'foto muito larga é reduzida para caber', uma[0])
ok(linhasDeFotos(Array(7).fill({ w: 1, h: 1 }), 182).length === 3, 'sete fotos: três linhas')
ok(linhasDeFotos([], 182).length === 0, 'sem foto: nada')

console.log('Relatório novo')
const n = relatorioNovo('id1', '2026-11-20', 'c9')
ok(n.titulo === 'Visita do dia 20/11/2026' && n.client_id === 'c9' && n.status === 'rascunho', 'começa com data de hoje e o cliente único')

console.log('Setores (27/11/2026)')
{
  const n = (id: string, setor?: string, texto = 'x'): ItemRelatorio => ({ id, tipo: 'nota', texto, fotos: [], ...(setor ? { setor } : {}) })
  const g = agruparPorSetor([n('1', 'Cozinha'), n('2', 'Estoque'), n('3', 'cozinha '), n('4')])
  ok(g.map(b => b.setor).join('|') === 'Cozinha|Estoque|', 'ordem do primeiro aparecimento, sem diferenciar maiúscula', g.map(b => b.setor))
  ok(g[0].itens.map(i => i.id).join() === '1,3', 'mesmo setor fica junto')
  ok(g[2].itens[0].id === '4', 'sem setor: bloco sem título')
  const antigo = agruparPorSetor([{ id: 't', tipo: 'titulo', texto: 'Câmara fria', fotos: [] }, n('a'), n('b', 'Lixo')])
  ok(antigo[0].setor === 'Câmara fria' && antigo[0].itens[0].id === 'a', 'título de seção antigo vira setor')
  const pdf = itensParaPdf([n('1', 'Cozinha'), n('2', 'Cozinha', ''), n('3')])
  ok(pdf.map(i => i.tipo + ':' + i.texto).join('|') === 'titulo:Cozinha|nota:x|nota:x', 'PDF: título do setor e sem anotação vazia', pdf)
  ok(itensParaPdf([n('1', 'Estoque', '')]).length === 0, 'setor sem anotação não vira título no PDF')
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) do relatório de visita falharam`)
