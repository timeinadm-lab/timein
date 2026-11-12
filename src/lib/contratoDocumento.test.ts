// Preenchimento do texto do contrato. Rodar: npm run testes
import { dadosDoContrato, preencherModelo, nomeArquivoContrato, dataBr, MODELO_PADRAO } from './contratoDocumento'
import { formatCurrency } from './utils'

let falhas = 0
const ok = (cond: boolean, nome: string) => {
  if (cond) console.log('  ok  ', nome)
  else { console.log('  FALHOU', nome); falhas++ }
}

ok(dataBr('2026-11-12') === '12/11/2026', 'data em pt-BR')
ok(dataBr('2026-11-12T15:00:00Z') === '12/11/2026', 'data com hora usa só o dia')
ok(dataBr('') === '', 'data vazia não vira traço')

const dados = dadosDoContrato({
  hoje: '2026-11-12',
  inicio: '2026-11-01',
  fim: '2026-12-01',
  pessoa: {
    full_name: 'Ana Souza', cpf: '123.456.789-00', rg: '12.345.678-9', role: 'Nutricionista',
    email: 'ana@tin.test', whatsapp: '11999990000',
    address_street: 'Rua das Flores', address_number: '10', address_city: 'São Paulo', address_zip: '01000-000',
    crn_number: '12345', crn_region: '3',
  },
  cliente: { name: 'Hospital Azul', cnpj: '00.000.000/0001-00', address: 'Av. Brasil, 1', contact_name: 'Carla', contact_phone: '1133330000' },
  vinculo: {
    service_type: 'Fixo', monthly_amount: 5000, start_date: '2026-10-01', contract_end_date: '2026-10-31',
    work_schedule_type: '5x2', work_start: '08:00:00', work_end: '17:00:00', daily_hours: 8,
    cost_assistance: 300, cost_assistance_periodo: 'mes',
  },
})

ok(dados.NOME_COLABORADOR === 'Ana Souza', 'nome')
ok(dados.CPF === '123.456.789-00', 'cpf')
ok(dados.CLIENTE === 'Hospital Azul', 'cliente')
ok(dados.CNPJ === '00.000.000/0001-00', 'cnpj')
ok(dados.ENDERECO_COLABORADOR.includes('Rua das Flores') && dados.ENDERECO_COLABORADOR.includes('São Paulo'), 'endereço junta rua, número e cidade')
ok(dados.CRN === '12345 / 3', 'crn')
ok(dados.CONTATO_CLIENTE === 'Carla · 1133330000', 'contato do cliente')
ok(dados.SERVICO === 'Fixo', 'serviço')
ok(dados.VALOR === `${formatCurrency(5000)} por mês`, 'valor mensal por extenso')
ok(dados.VALOR_MENSAL === formatCurrency(5000), 'valor mensal')
ok(dados.DATA_INICIO === '01/11/2026', 'início vem do formulário, não do vínculo')
ok(dados.DATA_FIM === '01/12/2026', 'fim vem do formulário')
ok(dados.DATA_HOJE === '12/11/2026', 'hoje')
ok(dados.ESCALA === '5x2', 'escala')
ok(dados.HORARIO.includes('08:00') && dados.HORARIO.includes('17:00'), 'horário')
ok(dados.AJUDA_CUSTO.includes('por mês'), 'ajuda mensal')

const porVisita = dadosDoContrato({
  vinculo: { service_type: 'Consultoria', link_units: [{ visit_rate: 180 }, { visit_rate: 180 }] },
})
ok(porVisita.VALOR === `${formatCurrency(180)} por visita`, 'valor por visita, sem repetir')
ok(porVisita.VALOR_MENSAL === '', 'sem salário: valor mensal fica vazio')
ok(porVisita.DATA_FIM === 'prazo indeterminado', 'sem fim: prazo indeterminado')

const { texto, faltando } = preencherModelo('Olá {{NOME_COLABORADOR}}, CPF {{CPF}}, cliente {{ cliente }}.', {
  NOME_COLABORADOR: 'Ana', CPF: '', cliente: 'Hospital',
})
ok(texto === 'Olá Ana, CPF {{CPF}}, cliente Hospital.', 'preenche o que tem e mantém o que falta')
ok(faltando.length === 1 && faltando[0] === 'CPF', 'lista a chave que ficou em branco')

const cheio = preencherModelo(MODELO_PADRAO, dados)
ok(!cheio.texto.includes('{{'), 'modelo padrão fica sem placeholder quando os dados existem')
ok(cheio.texto.includes('Ana Souza') && cheio.texto.includes('Hospital Azul'), 'modelo padrão usa nome e cliente')
ok(cheio.faltando.length === 0, 'modelo padrão sem falta')

ok(nomeArquivoContrato('Ana Souza', 'Hospital Azul') === 'contrato_Ana_Souza_Hospital_Azul.pdf', 'nome do arquivo sem acento e sem espaço')
ok(nomeArquivoContrato('João', 'Ação') === 'contrato_Joao_Acao.pdf', 'acento sai do nome do arquivo')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram')
if (falhas) throw new Error(`${falhas} teste(s) falharam`)
