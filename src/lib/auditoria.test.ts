// Testes da auditoria (nota com peso, grupos, classificação). Rodar todos: npm run testes
import { resumoAuditoria, classificar, textoDasFaixas } from './auditoria'
import type { ItemAuditoria, Resposta } from './auditoria'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}
const itens = (grupo: string, peso: number, resp: (Resposta | null)[]): ItemAuditoria[] => resp.map(r => ({ grupo, peso, resposta: r }))

console.log('Nota com peso')
{
  // Estrutura peso 1: 3 C + 1 NC · Boas Práticas peso 2: 1 C + 1 NC + 1 N/A
  const r = resumoAuditoria([...itens('Estrutura', 1, ['C', 'C', 'C', 'NC']), ...itens('Boas Práticas', 2, ['C', 'NC', 'NA'])])
  // pontos: (3·1 + 1·2) ÷ (4·1 + 2·2) = 5 ÷ 8 = 62,5% → 63
  ok(r.pontosObtidos === 5 && r.pontosPossiveis === 8, 'pontos obtidos/possíveis', r)
  ok(r.nota === 63 && Math.abs((r.notaExata || 0) - 62.5) < 1e-9, 'nota 62,5% arredonda para 63', r.notaExata)
  ok(r.conformes === 4 && r.naoConformes === 2 && r.na === 1 && r.pendentes === 0, 'contagens')
  const bp = r.grupos.find(g => g.grupo === 'Boas Práticas')!
  ok(bp.ncPct === 50 && bp.peso === 2, 'BP: 50% de não conformidade (N/A não conta), peso 2', bp)
  const es = r.grupos.find(g => g.grupo === 'Estrutura')!
  ok(es.ncPct === 25 && es.peso === 1, 'Estrutura: 25% de não conformidade', es)
  ok(r.classificacao?.rotulo === 'Insatisfatório', 'classificação 63% = Insatisfatório')
}
{
  // Conformidade simples ≠ nota com peso: 50% das perguntas conformes, mas o peso muda a nota
  const r = resumoAuditoria([...itens('Estrutura', 1, ['NC']), ...itens('Boas Práticas', 2, ['C'])])
  ok(r.nota === 67, 'NC de peso 1 e C de peso 2 → 67% (não 50%)', r.nota)
  const r2 = resumoAuditoria([...itens('Estrutura', 1, ['C']), ...itens('Boas Práticas', 2, ['NC'])])
  ok(r2.nota === 33, 'C de peso 1 e NC de peso 2 → 33%', r2.nota)
}
{
  const r = resumoAuditoria(itens('Estrutura', 1, [null, 'NA']))
  ok(r.nota === null && r.classificacao === null && r.pendentes === 1, 'sem nada avaliado não tem nota')
  ok(r.grupos[0].ncPct === null, 'grupo sem avaliadas não tem %')
  const todas = resumoAuditoria(itens('X', 1, ['C', 'C']))
  ok(todas.nota === 100 && todas.classificacao?.rotulo === 'Excelente', '100% = Excelente')
}

console.log('Classificação')
{
  ok(classificar(91)?.rotulo === 'Excelente' && classificar(90)?.rotulo === 'Satisfatório', '91 Excelente, 90 Satisfatório')
  ok(classificar(80)?.rotulo === 'Satisfatório' && classificar(79)?.rotulo === 'Insatisfatório', '80 Satisfatório, 79 Insatisfatório')
  ok(classificar(50)?.rotulo === 'Insatisfatório' && classificar(49)?.rotulo === 'Crítico', '50 Insatisfatório, 49 Crítico')
  ok(classificar(0)?.rotulo === 'Crítico', '0 Crítico')
  const t = textoDasFaixas()
  ok(t[0].texto === 'Entre 91 e 100%' && t[1].texto === 'Entre 80 e 90%' && t[3].texto === 'Abaixo de 50%', 'legenda das faixas', t)
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
