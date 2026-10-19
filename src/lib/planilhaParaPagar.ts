// ============================================================
// Planilha para pagar (pedido do Gabriel, 19/10/2026): "não preciso fazer o
// lançamento, essa planilha eu posso editar". Uma aba por dia de pagamento
// (8, 15, 20, avulsos) com uma linha por pessoa:
//   Nome completo · PIX · Salário · Reembolso · Ajuda de custo · Total · Observação
// O Total é fórmula (Salário + Reembolso + Ajuda): editou um valor, o total
// acompanha. Mais a aba "Comprovantes": cada reembolso que entrou na planilha,
// por nome, com o número do anexo no PDF de comprovantes (que sai à parte —
// o zip com pasta não subia; pedido de 19/10/2026: "só a planilha").
// Entra quem já foi lançado E quem ainda está "Aguardando RH".
// A parte que junta as linhas não usa banco: testada em planilhaParaPagar.test.ts.
// ============================================================
import type { ChaveDia } from './pagamentosPorDia'
import type { AbaExcel, CelulaExcel, CorLinha } from './excelBonito'

export type ItemPagar = {
  dia: ChaveDia
  employee_id: string | null
  nome: string
  salario: number          // bruto (antes do adiantamento)
  ajuda: number
  reembolso: number
  adiantamento: number     // já recebeu antes: sai do salário
  obs: string[]
  pago: boolean
  mesTrabalhado: string | null
}

export type LinhaPagar = {
  employee_id: string | null
  nome: string
  salario: number          // já com o adiantamento descontado
  reembolso: number
  ajuda: number
  total: number
  obs: string
  pago: boolean
  meses: string[]          // meses trabalhados das parcelas (para achar os comprovantes)
}

const r2 = (n: number) => Math.round(n * 100) / 100
export const DIAS_PLANILHA: { chave: ChaveDia; titulo: string }[] = [
  { chave: 'd8', titulo: 'Dia 8' }, { chave: 'd15', titulo: 'Dia 15' }, { chave: 'd20', titulo: 'Dia 20' }, { chave: 'avulso', titulo: 'Avulsos' },
]

/** Uma linha por pessoa em cada dia (duas parcelas no mesmo dia viram uma linha) */
export function juntarPorPessoa(itens: ItemPagar[]): Map<ChaveDia, LinhaPagar[]> {
  const out = new Map<ChaveDia, LinhaPagar[]>()
  for (const { chave } of DIAS_PLANILHA) {
    const porPessoa = new Map<string, { l: LinhaPagar; adiant: number; obs: string[]; todosPagos: boolean }>()
    for (const it of itens.filter(i => i.dia === chave)) {
      const k = it.employee_id || `sem-${it.nome}`
      const atual = porPessoa.get(k) ?? {
        l: { employee_id: it.employee_id, nome: it.nome, salario: 0, reembolso: 0, ajuda: 0, total: 0, obs: '', pago: false, meses: [] },
        adiant: 0, obs: [], todosPagos: true,
      }
      atual.l.salario += it.salario
      atual.l.reembolso += it.reembolso
      atual.l.ajuda += it.ajuda
      atual.adiant += it.adiantamento
      atual.todosPagos = atual.todosPagos && it.pago
      for (const o of it.obs) if (o && !atual.obs.includes(o)) atual.obs.push(o)
      if (it.mesTrabalhado && !atual.l.meses.includes(it.mesTrabalhado)) atual.l.meses.push(it.mesTrabalhado)
      porPessoa.set(k, atual)
    }
    const linhas = [...porPessoa.values()].map(({ l, adiant, obs, todosPagos }) => {
      const obsFinal = [...obs]
      if (adiant > 0) obsFinal.push(`Adiantamento de R$ ${adiant.toFixed(2).replace('.', ',')} já descontado do salário`)
      const salario = r2(l.salario - adiant)
      return { ...l, salario, reembolso: r2(l.reembolso), ajuda: r2(l.ajuda), total: r2(salario + l.reembolso + l.ajuda), obs: obsFinal.join(' · '), pago: todosPagos }
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    out.set(chave, linhas)
  }
  return out
}

export type ComprovanteReembolso = {
  employee_id: string; nome: string; dia: string; descricao: string; data: string; valor: number; caminho: string | null
}

const dataBR = (iso: string) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''

/** Reembolsos em ordem de nome (e data): é a ordem da aba e do PDF de comprovantes */
export const ordenarComprovantes = (cs: ComprovanteReembolso[]) =>
  [...cs].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.data.localeCompare(b.data))

/** As abas do Excel. `comprovantes` já em ordem; `anexos[i]` = número no PDF (null = sem arquivo). */
export function abasDaPlanilha(nomeMes: string, porDia: Map<ChaveDia, LinhaPagar[]>, pixDe: (id: string | null) => string,
  comprovantes: ComprovanteReembolso[], anexos: (number | null)[]): AbaExcel[] {
  const abas: AbaExcel[] = []
  for (const { chave, titulo } of DIAS_PLANILHA) {
    const linhas = porDia.get(chave) || []
    if (!linhas.length) continue
    const L = 5   // primeira linha de dados (PRIMEIRA_LINHA_EXCEL)
    const ultima = L + linhas.length - 1
    abas.push({
      nome: titulo,
      titulo: `Pagamentos · ${titulo} · ${nomeMes}`,
      subtitulo: `${linhas.length} pessoa(s) · edite os valores à vontade: o Total recalcula sozinho`,
      colunas: [
        { titulo: 'Nome completo', largura: 34 }, { titulo: 'PIX', largura: 30, tipo: 'texto' },
        { titulo: 'Salário', largura: 14, tipo: 'dinheiro' }, { titulo: 'Reembolso', largura: 14, tipo: 'dinheiro' },
        { titulo: 'Ajuda de custo', largura: 14, tipo: 'dinheiro' }, { titulo: 'Total', largura: 15, tipo: 'dinheiro' },
        { titulo: 'Observação', largura: 60, tipo: 'texto' },
      ],
      linhas: linhas.map((l, i): CelulaExcel[] => [
        l.nome, pixDe(l.employee_id), l.salario, l.reembolso, l.ajuda,
        { formula: `C${L + i}+D${L + i}+E${L + i}`, result: l.total }, l.obs,
      ]),
      cores: linhas.map(l => (l.pago ? 'verde' : !pixDe(l.employee_id) || pixDe(l.employee_id).startsWith('SEM PIX') ? 'amarelo' : null) as CorLinha),
      total: ['Total', '',
        ...(['C', 'D', 'E', 'F'] as const).map((c, i): CelulaExcel => ({
          formula: `SUM(${c}${L}:${c}${ultima})`,
          result: r2(linhas.reduce((s, l) => s + [l.salario, l.reembolso, l.ajuda, l.total][i], 0)),
        })), ''],
      rodape: 'Verde = já pago. Amarelo = sem PIX no cadastro. Os reembolsos estão na aba "Comprovantes"; os arquivos saem à parte no botão "Comprovantes (PDF)".',
    })
  }
  abas.push({
    nome: 'Comprovantes',
    titulo: `Comprovantes dos reembolsos · ${nomeMes}`,
    subtitulo: comprovantes.length
      ? `${comprovantes.length} reembolso(s) · o "Anexo" é a página no PDF de comprovantes (botão "Comprovantes (PDF)" em Pagamentos)`
      : 'Nenhum reembolso nos pagamentos deste mês',
    colunas: [
      { titulo: 'Nome completo', largura: 34 }, { titulo: 'Recebe no', largura: 11, tipo: 'centro' },
      { titulo: 'Reembolso', largura: 36, tipo: 'texto' }, { titulo: 'Pedido em', largura: 12, tipo: 'data' },
      { titulo: 'Valor', largura: 14, tipo: 'dinheiro' }, { titulo: 'Comprovante', largura: 22, tipo: 'centro' },
    ],
    linhas: comprovantes.map((c, i): CelulaExcel[] => [c.nome, c.dia, c.descricao, dataBR(c.data), c.valor,
      anexos[i] ? `Anexo ${anexos[i]}` : 'Sem comprovante anexado']),
    cores: comprovantes.map((_, i) => (anexos[i] ? null : 'amarelo') as CorLinha),
    total: comprovantes.length ? ['Total', '', '', '', { formula: `SUM(E5:E${4 + comprovantes.length})`, result: r2(comprovantes.reduce((s, c) => s + c.valor, 0)) }, ''] : undefined,
    rodape: 'Amarelo = a pessoa não anexou o comprovante no sistema.',
  })
  return abas
}
