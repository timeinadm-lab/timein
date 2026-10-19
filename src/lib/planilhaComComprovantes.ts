// ============================================================
// Planilha com a coluna "Comprovante" (pedido de 16/10/2026: "na hora de
// levantar uma planilha viesse os comprovantes de cada um").
// 19/10/2026: antes saía um .zip com a pasta dos arquivos — não subia ("só a
// planilha; os comprovantes eu peço à parte"). Agora é só o .xlsx, no padrão
// apresentável (excelBonito), e a coluna diz "Anexo N": o número da página no
// PDF de comprovantes (comprovantesPdf.ts), que sai num botão à parte.
// ============================================================
import { baixarExcelBonito, letraDaColuna } from './excelBonito'
import type { AbaExcel, CelulaExcel, ColunaExcel, CorLinha } from './excelBonito'
import { numerarAnexos } from './comprovantesPdf'

export type Celula = string | number
export type LinhaPlanilha = {
  valores: Celula[]
  comprovante?: string | null   // caminho no armazenamento (bucket arquivos)
  cor?: CorLinha
}
export type AbaPlanilha = {
  nome: string; cabecalho: string[]; linhas: LinhaPlanilha[]; larguras?: number[]; colunasDinheiro?: number[]
  titulo?: string; subtitulo?: string; rodape?: string
}

/**
 * Monta as abas: a coluna "Comprovante" vai no fim ("Anexo N" na ordem das
 * linhas — a mesma ordem do PDF) e as colunas de dinheiro ganham linha de total.
 */
export function abasComAnexo(abas: AbaPlanilha[]): AbaExcel[] {
  const anexos = numerarAnexos(abas.flatMap(a => a.linhas).map(l => ({ caminho: l.comprovante || null })))
  let i = 0
  return abas.map(aba => {
    const dinheiro = new Set(aba.colunasDinheiro || [])
    const colunas: ColunaExcel[] = [...aba.cabecalho.map((t, c) => ({ titulo: t, largura: aba.larguras?.[c] || 18, tipo: dinheiro.has(c) ? 'dinheiro' as const : 'texto' as const })),
      { titulo: 'Comprovante', largura: 18, tipo: 'centro' }]
    const doAba = aba.linhas.map(() => anexos[i++])
    const linhas = aba.linhas.map((l, k) => [...l.valores, doAba[k] ? `Anexo ${doAba[k]}` : 'Sem comprovante'] as CelulaExcel[])
    const ini = 5, fim = ini + linhas.length - 1
    return {
      nome: aba.nome, titulo: aba.titulo || aba.nome, subtitulo: aba.subtitulo || `${linhas.length} linha(s)`,
      colunas, linhas,
      cores: aba.linhas.map((l, k) => l.cor ?? (doAba[k] ? null : 'amarelo')),
      total: dinheiro.size > 0 && linhas.length > 0 ? colunas.map((_, c): CelulaExcel => c === 0 ? 'Total'
        : dinheiro.has(c) ? { formula: `SUM(${letraDaColuna(c + 1)}${ini}:${letraDaColuna(c + 1)}${fim})`,
          result: Math.round(aba.linhas.reduce((s, l) => s + (Number(l.valores[c]) || 0), 0) * 100) / 100 } : '') : undefined,
      rodape: aba.rodape || 'Amarelo = sem comprovante anexado. "Anexo N" = a página no PDF de comprovantes (botão "Comprovantes (PDF)").',
    }
  })
}

/** Baixa só o .xlsx */
export async function baixarPlanilhaComAnexos(nomeArquivo: string, abas: AbaPlanilha[]) {
  await baixarExcelBonito(nomeArquivo, abasComAnexo(abas))
}
