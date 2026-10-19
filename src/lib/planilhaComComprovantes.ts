// ============================================================
// Planilha com os comprovantes (pedido de 16/10/2026: "na hora de levantar
// uma planilha viesse os comprovantes de cada um").
// Baixa um .zip com a planilha (.xlsx) e a pasta "comprovantes". Na planilha,
// a coluna Comprovante tem o link para o arquivo da pasta: descompactou, clicou,
// abriu. O link é para o arquivo do zip, então não vence.
// 19/10/2026: a planilha sai no padrão apresentável (excelBonito): título,
// cabeçalho verde, cores, R$ e linha de total.
// ============================================================
import { supabase } from './supabase'
import { parseStorage } from './storage'
import { montarExcelBonito, letraDaColuna } from './excelBonito'
import type { AbaExcel, CelulaExcel, ColunaExcel, CorLinha } from './excelBonito'
import type JSZip from 'jszip'

export type Celula = string | number
export type LinhaPlanilha = {
  valores: Celula[]
  comprovante?: string | null   // caminho no armazenamento (bucket arquivos)
  nomeArquivo?: string          // começo do nome do arquivo no zip (ex.: "Ana Souza - Uber - 12-10")
  cor?: CorLinha
}
export type AbaPlanilha = {
  nome: string; cabecalho: string[]; linhas: LinhaPlanilha[]; larguras?: number[]; colunasDinheiro?: number[]
  titulo?: string; subtitulo?: string; rodape?: string
}

export const nomeSeguro = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 80) || 'comprovante'   // sem espaço: o link da planilha abre em qualquer Excel

type Zip = JSZip

/**
 * Baixa os arquivos para a pasta "comprovantes" do zip. Devolve, na mesma ordem,
 * o nome do arquivo no zip (null = sem comprovante ou não baixou).
 */
export async function baixarArquivosParaZip(zip: Zip, itens: { caminho?: string | null; nomeArquivo?: string }[],
  aoProgredir?: (feitos: number, total: number) => void): Promise<{ nomes: (string | null)[]; falhas: number }> {
  const pasta = zip.folder('comprovantes')!
  const usados = new Set<string>()
  const jaBaixado = new Map<string, string>()   // mesmo arquivo em duas linhas: baixa uma vez
  const total = itens.filter(i => i.caminho).length
  let feitos = 0, falhas = 0
  const nomes: (string | null)[] = []
  for (const it of itens) {
    if (!it.caminho) { nomes.push(null); continue }
    let nome = jaBaixado.get(it.caminho) || null
    if (!nome) {
      const onde = parseStorage(it.caminho, 'arquivos')
      const { data, error } = onde ? await supabase.storage.from(onde.bucket).download(onde.path) : { data: null, error: true }
      if (!error && data && onde) {
        const ext = (onde.path.split('.').pop() || 'jpg').toLowerCase().slice(0, 5)
        const base = nomeSeguro(it.nomeArquivo || 'comprovante')
        nome = `${base}.${ext}`
        for (let n = 2; usados.has(nome); n++) nome = `${base}_${n}.${ext}`
        usados.add(nome)
        pasta.file(nome, data)
        jaBaixado.set(it.caminho, nome)
      } else falhas++
    }
    feitos++
    aoProgredir?.(feitos, total)
    nomes.push(nome)
  }
  return { nomes, falhas }
}

/** Coloca a planilha e o LEIA-ME no zip e baixa */
export async function fecharZip(zip: Zip, nomeZip: string, abas: AbaExcel[]) {
  zip.file(`${nomeZip}.xlsx`, await montarExcelBonito(abas))
  zip.file('LEIA-ME.txt', 'Descompacte esta pasta antes de abrir a planilha.\r\nNa coluna "Comprovante", clique em "Abrir comprovante" para ver o arquivo de cada linha.\r\nOs arquivos ficam na pasta "comprovantes", com o nome da pessoa no começo.\r\n')
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${nomeZip}.zip`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** Célula da coluna Comprovante */
export const celulaComprovante = (arquivo: string | null, tinha: boolean): CelulaExcel =>
  arquivo ? { text: 'Abrir comprovante', hyperlink: `comprovantes/${arquivo}` } : tinha ? 'Não baixou — ver no sistema' : 'Sem comprovante'

/**
 * Monta e baixa o zip. A coluna "Comprovante" é acrescentada no fim de cada aba,
 * e as colunas de dinheiro ganham linha de total.
 * Retorna quantos comprovantes entraram e quantos não baixaram.
 */
export async function baixarPlanilhaComComprovantes(nomeZip: string, abas: AbaPlanilha[], aoProgredir?: (feitos: number, total: number) => void) {
  const { default: JSZipCls } = await import('jszip')
  const zip = new JSZipCls()
  const todas = abas.flatMap(a => a.linhas)
  const { nomes, falhas } = await baixarArquivosParaZip(zip, todas.map(l => ({ caminho: l.comprovante, nomeArquivo: l.nomeArquivo })), aoProgredir)
  let i = 0
  const abasExcel: AbaExcel[] = abas.map(aba => {
    const dinheiro = new Set(aba.colunasDinheiro || [])
    const colunas: ColunaExcel[] = [...aba.cabecalho.map((t, c) => ({ titulo: t, largura: aba.larguras?.[c] || 18, tipo: dinheiro.has(c) ? 'dinheiro' as const : 'texto' as const })),
      { titulo: 'Comprovante', largura: 22 }]
    const linhas = aba.linhas.map(l => [...l.valores, celulaComprovante(nomes[i++], !!l.comprovante)] as CelulaExcel[])
    const ini = 5, fim = ini + linhas.length - 1
    const temTotal = dinheiro.size > 0 && linhas.length > 0
    return {
      nome: aba.nome, titulo: aba.titulo || aba.nome, subtitulo: aba.subtitulo || `${linhas.length} linha(s)`,
      colunas, linhas,
      cores: aba.linhas.map(l => l.cor ?? (l.comprovante ? null : 'amarelo')),
      total: temTotal ? colunas.map((_, c): CelulaExcel => c === 0 ? 'Total'
        : dinheiro.has(c) ? { formula: `SUM(${letraDaColuna(c + 1)}${ini}:${letraDaColuna(c + 1)}${fim})`,
          result: Math.round(aba.linhas.reduce((s, l) => s + (Number(l.valores[c]) || 0), 0) * 100) / 100 } : '') : undefined,
      rodape: aba.rodape || 'Amarelo = sem comprovante anexado. Descompacte o zip e clique em "Abrir comprovante" para ver cada arquivo.',
    }
  })
  await fecharZip(zip, nomeZip, abasExcel)
  return { comprovantes: nomes.filter(Boolean).length, falhas }
}
