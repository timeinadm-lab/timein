// PDF do arquivo de pagamentos, gerado na hora.
// Padrão: sem chave PIX (para compartilhar). Com PIX: uso interno.
// CPF e dados bancários não entram em nenhuma das duas versões.
import { criarPdf } from './pdfBase'
import type { RegistroArquivo } from './arquivoPagamentos'
import { formatarDataPagamento, resumir } from './arquivoPagamentos'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function geradoEm(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export async function pdfDoArquivo(reg: RegistroArquivo, comPix = false): Promise<Blob> {
  const linhas = [...reg.linhas].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
  const { total, quantidade } = resumir(linhas)
  const data = formatarDataPagamento(reg.data_pagamento)
  const dia = Number(reg.data_pagamento.slice(8, 10))
  const confirmar = linhas.map(l => !!(l.observacao && /confirmar/i.test(l.observacao)))
  const { doc, st, L, W, texto, cabecalho, secao, tabela, destaque, garantir, numerar } = await criarPdf(comPix)

  cabecalho(
    'ARQUIVO DE PAGAMENTOS',
    `Pagamento de ${data}`,
    `Dia ${dia}`,
    `${quantidade} pessoa(s) · ${brl(total)} · ${comPix ? 'com PIX · uso interno' : 'sem PIX'} · gerado em ${geradoEm()}`,
  )
  secao('Pessoas')
  tabela(
    comPix
      ? [{ titulo: 'Nome', larg: 48 }, { titulo: 'Chave PIX', larg: 46 }, { titulo: 'Valor', larg: 24, direita: true }, { titulo: 'Observação', larg: 62 }]
      : [{ titulo: 'Nome', larg: 62 }, { titulo: 'Valor', larg: 28, direita: true }, { titulo: 'Observação', larg: 90 }],
    linhas.map(l => comPix ? [l.nome, l.pix || '—', brl(l.valor), l.observacao || ''] : [l.nome, brl(l.valor), l.observacao || '']),
    i => (confirmar[i] ? [254, 243, 199] : null),
  )
  garantir(14)
  doc.setFillColor(234, 246, 238)
  doc.rect(L, st.y - 4, W, 8, 'F')
  texto('Total', L + 2, st.y + 1, { tam: 10, negrito: true, cor: [15, 78, 48] })
  texto(`${brl(total)} · ${quantidade} pessoa(s)`, L + W - 2, st.y + 1, { tam: 11, negrito: true, cor: [15, 78, 48], alinhar: 'right' })
  st.y += 12
  if (reg.observacao) destaque('Observação do pagamento', [reg.observacao])
  if (confirmar.some(Boolean)) {
    texto('Amarelo = observação para confirmar.', L, st.y, { tam: 8, cor: [120, 120, 120] })
    st.y += 5
  }
  texto(
    comPix
      ? 'Uso interno. Contém a chave PIX. Não contém CPF nem dados bancários.'
      : 'Para compartilhar. Sem chave PIX, sem CPF e sem dados bancários.',
    L, st.y, { tam: 8, cor: [120, 120, 120] },
  )
  numerar(`Pagamento de ${data}`)
  return doc.output('blob')
}
