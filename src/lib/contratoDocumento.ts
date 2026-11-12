// Texto do contrato: troca {{PLACEHOLDERS}} pelos dados reais do colaborador,
// do cliente e do vínculo. Sem React e sem banco — testável (contratoDocumento.test.ts).
// O PDF (contratoPdf.ts) só desenha o texto que sai daqui.

import { formatCurrency, hojeISO, rotuloDoVinculo } from './utils'

export const VARIAVEIS_CONTRATO = [
  'NOME_COLABORADOR',
  'CPF',
  'RG',
  'CARGO',
  'EMAIL',
  'WHATSAPP',
  'ENDERECO_COLABORADOR',
  'CRN',
  'CLIENTE',
  'CNPJ',
  'ENDERECO_CLIENTE',
  'CONTATO_CLIENTE',
  'SERVICO',
  'VALOR',
  'VALOR_MENSAL',
  'DATA_INICIO',
  'DATA_FIM',
  'DATA_HOJE',
  'ESCALA',
  'HORARIO',
  'AJUDA_CUSTO',
] as const

export type VariavelContrato = typeof VARIAVEIS_CONTRATO[number]

export const ROTULO_VARIAVEL: Record<string, string> = {
  NOME_COLABORADOR: 'nome do colaborador',
  CPF: 'CPF',
  RG: 'RG',
  CARGO: 'cargo',
  EMAIL: 'e-mail',
  WHATSAPP: 'WhatsApp',
  ENDERECO_COLABORADOR: 'endereço do colaborador',
  CRN: 'CRN',
  CLIENTE: 'cliente',
  CNPJ: 'CNPJ',
  ENDERECO_CLIENTE: 'endereço do cliente',
  CONTATO_CLIENTE: 'contato do cliente',
  SERVICO: 'serviço',
  VALOR: 'valor',
  VALOR_MENSAL: 'valor mensal',
  DATA_INICIO: 'data de início',
  DATA_FIM: 'data de fim',
  DATA_HOJE: 'data de hoje',
  ESCALA: 'escala',
  HORARIO: 'horário',
  AJUDA_CUSTO: 'ajuda de custo',
}

export const MODELO_PADRAO_ID = '__padrao__'

export const MODELO_PADRAO = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento, de um lado {{CLIENTE}}, inscrito no CNPJ sob o nº {{CNPJ}}, com endereço em {{ENDERECO_CLIENTE}}, neste ato representado por {{CONTATO_CLIENTE}}, e de outro lado {{NOME_COLABORADOR}}, inscrito(a) no CPF sob o nº {{CPF}}, RG {{RG}}, residente em {{ENDERECO_COLABORADOR}}, e-mail {{EMAIL}}, telefone {{WHATSAPP}}, CRN {{CRN}}, têm entre si justo e contratado o que segue.

1. DO OBJETO
A prestação de serviços de {{SERVICO}}, na função de {{CARGO}}, para {{CLIENTE}}.

2. DO PRAZO
Início em {{DATA_INICIO}}. Término em {{DATA_FIM}}.

3. DA REMUNERAÇÃO
Pela prestação dos serviços, o valor é {{VALOR}} (referência mensal: {{VALOR_MENSAL}}).
Ajuda de custo: {{AJUDA_CUSTO}}.

4. DA JORNADA
Escala: {{ESCALA}}.
Horário: {{HORARIO}}.

5. DAS DISPOSIÇÕES GERAIS
As partes declaram estar de acordo com as condições deste instrumento, gerado em {{DATA_HOJE}}.

________________________________                ________________________________
{{CLIENTE}}                                     {{NOME_COLABORADOR}}
`

export function tokenVariavel(chave: string) {
  return `{{${chave}}}`
}

const limpo = (v: unknown) => (v == null ? '' : String(v).trim())

export function dataBr(iso?: string | null): string {
  const s = limpo(iso).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

export type PessoaContrato = {
  full_name?: string | null
  cpf?: string | null
  rg?: string | null
  role?: string | null
  email?: string | null
  whatsapp?: string | null
  phone?: string | null
  address?: string | null
  address_street?: string | null
  address_number?: string | null
  address_neighborhood?: string | null
  address_city?: string | null
  address_zip?: string | null
  crn_number?: string | null
  crn_region?: string | null
}

export type ClienteContrato = {
  name?: string | null
  cnpj?: string | null
  address?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
}

export type VinculoContrato = {
  service_type?: string | null
  coverage_type?: string | null
  pay_mode?: string | null
  is_temporary?: boolean | null
  monthly_amount?: number | null
  daily_rate?: number | null
  start_date?: string | null
  contract_end_date?: string | null
  work_schedule_type?: string | null
  work_schedule?: string | null
  work_start?: string | null
  work_end?: string | null
  daily_hours?: number | null
  horas_semana?: number | null
  cost_assistance?: number | null
  cost_assistance_periodo?: string | null
  link_units?: { unit_name?: string | null; visit_rate?: number | string | null }[] | null
}

export function enderecoColaborador(p?: PessoaContrato | null): string {
  if (!p) return ''
  const rua = [limpo(p.address_street), limpo(p.address_number)].filter(Boolean).join(', ')
  return [rua || limpo(p.address), limpo(p.address_neighborhood), limpo(p.address_city), limpo(p.address_zip)].filter(Boolean).join(', ')
}

export function contatoCliente(c?: ClienteContrato | null): string {
  if (!c) return ''
  return [limpo(c.contact_name), limpo(c.contact_phone), limpo(c.contact_email)].filter(Boolean).join(' · ')
}

export function valorDoVinculo(v?: VinculoContrato | null): { valor: string; mensal: string } {
  if (!v) return { valor: '', mensal: '' }
  const mensal = Number(v.monthly_amount) || 0
  const diaria = Number(v.daily_rate) || 0
  if (mensal > 0) {
    const t = formatCurrency(mensal)
    return { valor: `${t} por mês`, mensal: t }
  }
  if (diaria > 0) return { valor: `${formatCurrency(diaria)} por dia`, mensal: '' }
  const taxas = (v.link_units || []).map(u => Number(u.visit_rate) || 0).filter(n => n > 0)
  if (!taxas.length) return { valor: '', mensal: '' }
  const unicas = [...new Set(taxas)]
  const txt = unicas.length === 1
    ? `${formatCurrency(unicas[0])} por visita`
    : `${unicas.map(n => formatCurrency(n)).join(', ')} por visita`
  return { valor: txt, mensal: '' }
}

export function escalaDoVinculo(v?: VinculoContrato | null): string {
  if (!v) return ''
  const t = limpo(v.work_schedule_type)
  if (t === 'horas') return v.horas_semana ? `${String(v.horas_semana).replace('.', ',')}h por semana` : 'Horas por semana'
  if (t === 'cliente') return 'Escala do cliente'
  if (t) return t
  return limpo(v.work_schedule)
}

export function horarioDoVinculo(v?: VinculoContrato | null): string {
  if (!v) return ''
  const ini = limpo(v.work_start).slice(0, 5)
  const fim = limpo(v.work_end).slice(0, 5)
  const faixa = ini && fim ? `${ini}–${fim}` : ''
  const h = Number(v.daily_hours) || 0
  const horas = h > 0 ? `${String(h).replace('.', ',')}h por dia` : ''
  return [faixa, horas].filter(Boolean).join(' · ')
}

export function ajudaDoVinculo(v?: VinculoContrato | null): string {
  if (!v) return ''
  const n = Number(v.cost_assistance) || 0
  if (!(n > 0)) return 'não há'
  const periodo = v.cost_assistance_periodo === 'semana' ? 'por semana' : 'por mês'
  return `${formatCurrency(n)} ${periodo}`
}

export function dadosDoContrato(p: {
  pessoa?: PessoaContrato | null
  cliente?: ClienteContrato | null
  vinculo?: VinculoContrato | null
  inicio?: string | null
  fim?: string | null
  hoje?: string | null
}): Record<VariavelContrato, string> {
  const pessoa = p.pessoa
  const cliente = p.cliente
  const v = p.vinculo
  const valor = valorDoVinculo(v)
  const inicio = limpo(p.inicio) || limpo(v?.start_date)
  const fimInformado = p.fim != null ? limpo(p.fim) : limpo(v?.contract_end_date)
  const crn = [limpo(pessoa?.crn_number), limpo(pessoa?.crn_region)].filter(Boolean).join(' / ')
  return {
    NOME_COLABORADOR: limpo(pessoa?.full_name),
    CPF: limpo(pessoa?.cpf),
    RG: limpo(pessoa?.rg),
    CARGO: limpo(pessoa?.role),
    EMAIL: limpo(pessoa?.email),
    WHATSAPP: limpo(pessoa?.whatsapp) || limpo(pessoa?.phone),
    ENDERECO_COLABORADOR: enderecoColaborador(pessoa),
    CRN: crn,
    CLIENTE: limpo(cliente?.name),
    CNPJ: limpo(cliente?.cnpj),
    ENDERECO_CLIENTE: limpo(cliente?.address),
    CONTATO_CLIENTE: contatoCliente(cliente),
    SERVICO: v ? rotuloDoVinculo(v) : '',
    VALOR: valor.valor,
    VALOR_MENSAL: valor.mensal,
    DATA_INICIO: dataBr(inicio),
    DATA_FIM: fimInformado ? dataBr(fimInformado) : (v || inicio ? 'prazo indeterminado' : ''),
    DATA_HOJE: dataBr(p.hoje || hojeISO()),
    ESCALA: escalaDoVinculo(v),
    HORARIO: horarioDoVinculo(v),
    AJUDA_CUSTO: ajudaDoVinculo(v),
  }
}

/** Placeholders que ainda estão no texto. */
export function chavesRestantes(texto: string): string[] {
  return [...new Set([...(texto || '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1].toUpperCase()))]
}

/** Troca {{CHAVE}} pelo valor. A chave não diferencia maiúsculas. Vazio fica no texto e volta em `faltando`. */
export function preencherModelo(
  modelo: string,
  dados: Partial<Record<string, string | null | undefined>>,
): { texto: string; faltando: string[] } {
  const mapa = new Map<string, string>()
  for (const [k, v] of Object.entries(dados)) mapa.set(k.toUpperCase(), limpo(v))
  const faltando: string[] = []
  const texto = (modelo || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (full, raw: string) => {
    const key = raw.toUpperCase()
    const v = mapa.get(key) || ''
    if (!v) { faltando.push(key); return full }
    return v
  })
  return { texto, faltando: [...new Set(faltando)] }
}

export function nomeArquivoContrato(pessoa?: string | null, cliente?: string | null) {
  const pedaco = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  return `contrato_${pedaco(limpo(pessoa)) || 'colaborador'}_${pedaco(limpo(cliente)) || 'cliente'}.pdf`
}
