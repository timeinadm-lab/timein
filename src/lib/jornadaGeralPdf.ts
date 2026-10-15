// Panorama da Jornada em PDF (pedido de 15/10/2026): todas as folhas de ponto
// do mês numa tabela só — quem está ok e quem precisa de atenção.
import { criarPdf } from './pdfBase'

export type LinhaPanorama = {
  nome: string
  clientes: string        // "GSH Live (escala do cliente) · Outro (6x1)"
  feitos: string          // "22/26" ou "22"
  extras: number
  faltas: number
  trocas: number
  horas: string
  situacao: string        // "OK" ou o que chama atenção
  atencao: boolean
}

export async function baixarPanoramaJornada(nomeMes: string, linhas: LinhaPanorama[], filtro: string, geradoPor?: string | null) {
  const pdf = await criarPdf(true)
  const mes = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1)
  const comAtencao = linhas.filter(l => l.atencao).length
  pdf.cabecalho('TIN · Jornada · panorama das folhas de ponto', mes, `${linhas.length} pessoa(s)`,
    [`${comAtencao} precisam de atenção · ${linhas.length - comAtencao} ok`, filtro !== 'Todos' ? `filtro: ${filtro}` : null,
      `Gerado em ${new Date().toLocaleString('pt-BR')}${geradoPor ? ` por ${geradoPor}` : ''}`].filter(Boolean).join('  ·  '))

  pdf.tabela(
    [{ titulo: 'Nome', larg: 46 }, { titulo: 'Clientes e escala', larg: 62 }, { titulo: 'Dias', larg: 14, direita: true },
      { titulo: 'Extras', larg: 12, direita: true }, { titulo: 'Faltas', larg: 12, direita: true }, { titulo: 'Trocas', larg: 12, direita: true },
      { titulo: 'Horas', larg: 15, direita: true }, { titulo: 'Situação', larg: 70 }],
    linhas.map(l => [l.nome, l.clientes, l.feitos, l.extras ? String(l.extras) : '', l.faltas ? String(l.faltas) : '',
      l.trocas ? String(l.trocas) : '', l.horas, l.situacao]),
    i => (linhas[i].faltas ? [254, 226, 226] : linhas[i].atencao ? [254, 243, 199] : null),
  )
  pdf.paragrafo('Dias = feitos / previstos no mês até agora (sem previsto: escala do cliente, horas por semana ou agenda livre). Vermelho: tem falta. Amarelo: precisa de atenção.', { tam: 7.5, cor: [120, 120, 120] })
  pdf.numerar(`Jornada ${mes}`)
  pdf.doc.save(`jornada_panorama_${mes.replace(/\s+/g, '_')}.pdf`)
}
