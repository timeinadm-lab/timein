// Testes do arquivo de pagamentos. Rodar todos: npm run testes
import { lerValor, lerGrade, lerTexto, filtrarRegistros, resumir, formatarDataPagamento, diaDePagamento, dataNoMes, textoTemDadoBancario, validarEntrada, colunaProibida, celulasExportacao } from './arquivoPagamentos'
import type { RegistroArquivo } from './arquivoPagamentos'

let falhas = 0
const ok = (cond: boolean, nome: string, info?: unknown) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome, info === undefined ? '' : JSON.stringify(info)); falhas++ }
}

ok(lerValor('R$ 6.609,64') === 6609.64, 'valor brasileiro com milhar')
ok(lerValor('900,00') === 900, 'vírgula decimal')
ok(lerValor('6609.64') === 6609.64, 'ponto decimal do Excel')
ok(lerValor(900) === 900, 'número')
ok(lerValor('6.609') === 6609, 'milhar sem centavos')
ok(lerValor('-1') === null && lerValor('abc') === null, 'valor inválido não entra')

ok(formatarDataPagamento('2026-11-20') === '20/11/2026', 'data sem mudar o dia')
ok(diaDePagamento('2026-11-20') === 20 && diaDePagamento('2026-11-07') === null, 'só dia 8, 15 ou 20')
ok(dataNoMes('2026-11', 8) === '2026-11-08' && dataNoMes('2026-11', 7) === null, 'monta a data do mês')

ok(!colunaProibida('PIX') && !colunaProibida('Chave PIX'), 'a coluna da chave PIX entra')
ok(colunaProibida('CPF') && colunaProibida('Agência') && colunaProibida('Conta'), 'CPF, agência e conta continuam de fora')
ok(!colunaProibida('Nome') && !colunaProibida('Valor') && !colunaProibida('Observação'), 'nome, valor e observação ficam')

// A planilha do dia 20/11/2026, do jeito que ela vem (sem PIX)
const planilha = [
  ['Pagamento dia 20/11/2026'],
  [],
  ['Nome', 'Valor', 'Observação'],
  ['Alicia de Paula Monteiro Lima', 900, 'R$ 900 = 6 visitas de 4h (2 por dia em 04, 05 e 13/11) × R$ 150'],
  ['Ariane Souza Machado', 100, 'Consultoria Orquidário Oriental · 1 visita (11/11) × R$ 100'],
  ['Helen Cacia Martins de Oliveira', 9000, 'GRSA HNSN Paraíba · valor cheio'],
  ['Mariana Collaço Soares Dias Marques', 5000, 'GRSA Hospital Brasil · 12x36 · contrato 19/10 a 17/11'],
  ['Graziele Bassi de Andrade', 6609.64, 'SAPORE MELI Embu das Artes · R$ 6.500 + R$ 109,64 reembolso Ubers (11/11) · confirmar com a Fernanda'],
  ['Total', null, null],
]
const lido = lerGrade(planilha)
ok(lido.erros.length === 0 && lido.linhas.length === 5, 'cinco pessoas, sem a linha de total', lido)
ok(lido.linhas.map(l => l.nome).join(' | ') === 'Alicia de Paula Monteiro Lima | Ariane Souza Machado | Helen Cacia Martins de Oliveira | Mariana Collaço Soares Dias Marques | Graziele Bassi de Andrade', 'nomes completos da planilha')
ok(resumir(lido.linhas).total === 21609.64 && resumir(lido.linhas).quantidade === 5, 'total R$ 21.609,64', resumir(lido.linhas))
ok(lido.linhas.every(l => l.pix == null), 'o dia 20 entra sem chave PIX')
ok(lido.linhas.every(l => !textoTemDadoBancario(l.nome) && !textoTemDadoBancario(l.observacao || '')), 'as observações da planilha não têm dado bancário')
ok(/confirmar com a Fernanda/.test(lido.linhas[4].observacao || ''), 'Graziele fica a confirmar com a Fernanda')

const comPix = lerGrade([
  ['Nome', 'CPF', 'Valor', 'PIX', 'Observação'],
  ['Ana Souza', '123.456.789-00', 100, 'ana@email.com', 'visita'],
])
ok(comPix.linhas.length === 1 && comPix.linhas[0].pix === 'ana@email.com' && comPix.linhas[0].observacao === 'visita' && comPix.linhas[0].valor === 100, 'a coluna PIX entra; o CPF não', comPix)
ok(comPix.avisos.length === 1, 'avisa que ignorou CPF')
ok(!JSON.stringify(comPix.linhas).includes('123.456'), 'o CPF da coluna proibida não vaza')

const obsPix = lerGrade([['Nome', 'Valor', 'Observação'], ['Ana Souza', 100, 'chave pix email@x.com']])
ok(obsPix.linhas.length === 0 && obsPix.erros.length === 1, 'chave PIX escrita na observação não é gravada', obsPix)

const chave = { nome: 'Ana', valor: 10, observacao: 'visita', pix: 'ana@email.com' }
ok(!celulasExportacao(chave, false).join('|').includes('ana@email.com'), 'exportar sem PIX não leva a chave')
ok(celulasExportacao(chave, true)[1] === 'ana@email.com', 'exportar com PIX leva a chave na coluna')
ok(validarEntrada({ data_pagamento: '2026-11-08', observacao: null, linhas: [{ nome: 'Ana', valor: 10, observacao: null, pix: 'ana@email.com' }] }, []) === null, 'chave PIX na coluna pode ser salva')

const colado = lerTexto('Alicia de Paula Monteiro Lima\t900\t6 visitas\nAriane Souza Machado; 100; Consultoria')
ok(colado.linhas.length === 2 && colado.linhas[1].nome === 'Ariane Souza Machado' && colado.linhas[1].valor === 100, 'cola com tab ou ponto e vírgula', colado)

const frase = lerTexto('Graziele Bassi de Andrade R$ 6.609,64 a confirmar com Fernanda')
ok(frase.linhas.length === 1 && frase.linhas[0].valor === 6609.64 && frase.linhas[0].observacao === 'a confirmar com Fernanda', 'cola "Nome R$ valor observação"', frase)

const dia20: RegistroArquivo = {
  id: 'a', data_pagamento: '2026-11-20', observacao: null, total: 21609.64, quantidade: 5,
  linhas: lido.linhas.map((l, i) => ({ ...l, ordem: i + 1 })),
}
const dia8: RegistroArquivo = { id: 'b', data_pagamento: '2026-11-08', observacao: null, total: 100, quantidade: 1, linhas: [] }
ok(filtrarRegistros([dia20, dia8], '2026-11', 20).map(r => r.id).join() === 'a', 'filtra o mês e o dia 20')
ok(filtrarRegistros([dia20, dia8], '2026-11', null).length === 2, 'o mês inteiro')
ok(filtrarRegistros([dia20, dia8], '2026-10', null).length === 0, 'outro mês fica vazio')
ok(filtrarRegistros([dia20, dia8], '2026-11', 15).length === 0, 'dia 15 deste mês não tem registro')

ok(validarEntrada({ data_pagamento: '2026-11-20', observacao: null, linhas: [{ nome: 'Ana', valor: 10, observacao: null, pix: null }] }, ['2026-11-20']) === 'Já existe um registro neste dia de pagamento.', 'não cria o mesmo dia duas vezes')
ok(validarEntrada({ data_pagamento: '2026-11-07', observacao: null, linhas: [{ nome: 'Ana', valor: 10, observacao: null, pix: null }] }, []) === 'A data de pagamento precisa ser dia 8, 15 ou 20.', 'recusa dia fora de 8, 15 e 20')
ok(validarEntrada({ data_pagamento: '2026-11-08', observacao: null, linhas: [{ nome: 'Ana', valor: 10, observacao: 'meu pix', pix: null }] }, [])?.includes('PIX') === true, 'recusa chave PIX escrita na observação')
ok(validarEntrada({ data_pagamento: '2026-11-08', observacao: null, linhas: [{ nome: 'Ana', valor: 10, observacao: null, pix: 'agência 1234' }] }, [])?.includes('agência') === true, 'recusa agência no campo da chave')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
