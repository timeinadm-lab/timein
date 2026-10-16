// ============================================================
// Planilha com os comprovantes (pedido de 16/10/2026: "na hora de levantar
// uma planilha viesse os comprovantes de cada um").
// Baixa um .zip com a planilha (.xlsx) e a pasta "comprovantes". Na planilha,
// a coluna Comprovante tem o link para o arquivo da pasta: descompactou, clicou,
// abriu. O link é para o arquivo do zip, então não vence.
// ============================================================
import { supabase } from './supabase'

export type Celula = string | number
export type LinhaPlanilha = {
  valores: Celula[]
  comprovante?: string | null   // caminho no armazenamento (bucket arquivos)
  nomeArquivo?: string          // começo do nome do arquivo no zip (ex.: "Ana Souza - Uber - 12-10")
}
export type AbaPlanilha = { nome: string; cabecalho: string[]; linhas: LinhaPlanilha[]; larguras?: number[]; colunasDinheiro?: number[] }

const limpar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 80) || 'comprovante'   // sem espaço: o link da planilha abre em qualquer Excel

/**
 * Monta e baixa o zip. A coluna "Comprovante" é acrescentada no fim de cada aba.
 * Retorna quantos comprovantes entraram e quantos não baixaram.
 */
export async function baixarPlanilhaComComprovantes(nomeZip: string, abas: AbaPlanilha[], aoProgredir?: (feitos: number, total: number) => void) {
  const [{ default: JSZip }, XLSX] = await Promise.all([import('jszip'), import('xlsx')])
  const zip = new JSZip()
  const pasta = zip.folder('comprovantes')!
  const usados = new Set<string>()
  const jaBaixado = new Map<string, string>()   // mesmo arquivo em duas linhas: baixa uma vez
  const total = abas.reduce((t, a) => t + a.linhas.filter(l => l.comprovante).length, 0)
  let feitos = 0, falhas = 0

  const wb = XLSX.utils.book_new()
  for (const aba of abas) {
    const aoa: Celula[][] = [[...aba.cabecalho, 'Comprovante']]
    const links: { linha: number; alvo: string }[] = []
    for (const l of aba.linhas) {
      let rotulo = ''
      if (l.comprovante) {
        let nome = jaBaixado.get(l.comprovante)
        if (!nome) {
          const { data, error } = await supabase.storage.from('arquivos').download(l.comprovante)
          if (!error && data) {
            const ext = (l.comprovante.split('.').pop() || 'jpg').toLowerCase().slice(0, 5)
            const base = limpar(l.nomeArquivo || 'comprovante')
            nome = `${base}.${ext}`
            for (let n = 2; usados.has(nome); n++) nome = `${base} (${n}).${ext}`
            usados.add(nome)
            pasta.file(nome, data)
            jaBaixado.set(l.comprovante, nome)
          } else falhas++
        }
        feitos++
        aoProgredir?.(feitos, total)
        if (nome) { rotulo = 'Abrir comprovante'; links.push({ linha: aoa.length, alvo: `comprovantes/${nome}` }) }
        else rotulo = 'Não baixou — ver no sistema'
      } else rotulo = 'Sem comprovante'
      aoa.push([...l.valores, rotulo])
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const colLink = aba.cabecalho.length
    for (const { linha, alvo } of links) {
      const ref = XLSX.utils.encode_cell({ r: linha, c: colLink })
      ;(ws[ref] as { l?: { Target: string; Tooltip?: string } }).l = { Target: alvo, Tooltip: 'Abre o arquivo da pasta comprovantes' }
    }
    for (const c of aba.colunasDinheiro || []) {
      for (let r = 1; r < aoa.length; r++) {
        const cel = ws[XLSX.utils.encode_cell({ r, c })] as { t?: string; z?: string } | undefined
        if (cel && cel.t === 'n') cel.z = '"R$" #,##0.00'
      }
    }
    ws['!cols'] = [...(aba.larguras || aba.cabecalho.map(() => 18)), 22].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, aba.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  }
  const planilha = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  zip.file(`${nomeZip}.xlsx`, planilha)
  zip.file('LEIA-ME.txt', 'Descompacte esta pasta antes de abrir a planilha.\r\nNa coluna "Comprovante", clique em "Abrir comprovante" para ver o arquivo de cada linha.\r\nOs arquivos ficam na pasta "comprovantes".\r\n')
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `${nomeZip}.zip`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return { comprovantes: feitos - falhas, falhas }
}
