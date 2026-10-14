// Excel dos colaboradores (pedido de 14/10/2026): antes saía um CSV com
// vírgula, que o Excel em português abre tudo na coluna A. Agora é .xlsx de
// verdade, na ordem que o RH usa: vínculo → clientes → contrato anexado →
// salário → dias de pagamento → dados pessoais. Segunda aba: um vínculo por linha.
import { supabase } from './supabase'
import { formatDate, hojeISO, tipoDoVinculo, pagaPorDiaria, salarioConsultoria } from './utils'

type Pessoa = Record<string, unknown> & { id: string; full_name: string }
type Link = Record<string, unknown> & {
  id: string; employee_id: string; start_date?: string | null; contract_end_date?: string | null
  service_type?: string | null; coverage_type?: string | null; pay_mode?: string | null
  monthly_amount?: number | null; daily_rate?: number | null; contract_file_url?: string | null; contract_required?: boolean | null
  link_units?: { unit_name?: string; visit_rate?: number | string | null }[] | null
  parcelas?: { data?: string; valor?: number | string }[] | null
  client?: { name?: string } | { name?: string }[] | null
  payment_dates?: { day_of_month?: number | null }[] | null
}

// O Supabase devolve no máximo 1000 linhas por vez
async function tudo<T>(tabela: string, colunas: string): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(de, de + 999)
    if (error) throw error
    out.push(...((data || []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

const reais = (v: unknown) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const txt = (v: unknown) => (v == null ? '' : String(v).trim())
const nomeCliente = (l: Link) => (Array.isArray(l.client) ? l.client[0]?.name : l.client?.name) || 'Cliente'

/** "R$ 5.500,00 por mês", "R$ 180,00 por dia", "por visita: R$ 150,00" */
function salarioDoLink(l: Link): { texto: string; valor: number | null } {
  if (pagaPorDiaria(l)) return { texto: Number(l.daily_rate) > 0 ? `${reais(l.daily_rate)} por dia` : 'por dia (sem valor)', valor: Number(l.daily_rate) || null }
  if (tipoDoVinculo(l) === 'Consultoria' && !salarioConsultoria(l)) {
    const valores = [...new Set((l.link_units || []).map(u => Number(u.visit_rate)).filter(v => v > 0))].sort((a, b) => a - b)
    return { texto: valores.length ? `por visita: ${valores.map(reais).join(' / ')}` : 'por visita (sem valor)', valor: valores.length === 1 ? valores[0] : null }
  }
  if (l.parcelas?.length) {
    const total = l.parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0)
    return { texto: `${reais(total)} no contrato (${l.parcelas.length} pagamento${l.parcelas.length > 1 ? 's' : ''})`, valor: total }
  }
  if (Number(l.monthly_amount) > 0) return { texto: `${reais(l.monthly_amount)} por mês`, valor: Number(l.monthly_amount) }
  return { texto: salarioConsultoria(l) ? 'salário em outro vínculo' : 'sem salário', valor: null }
}

/** "dias 8 e 20" ou as datas combinadas do contrato */
function diasDoLink(l: Link): string {
  if (l.parcelas?.length) return [...l.parcelas].sort((a, b) => txt(a.data).localeCompare(txt(b.data)))
    .map(p => `${formatDate(txt(p.data))} (${reais(p.valor)})`).join(', ')
  const dias = [...new Set((l.payment_dates || []).map(d => Number(d.day_of_month)).filter(d => d > 0))].sort((a, b) => a - b)
  if (!dias.length) return ''
  return dias.length === 1 ? `dia ${dias[0]}` : `dias ${dias.slice(0, -1).join(', ')} e ${dias[dias.length - 1]}`
}

export async function exportColaboradoresExcel(ids: string[], ufDoCep: (cep?: string | null) => string | null) {
  const [pessoas, links, docs] = await Promise.all([
    tudo<Pessoa>('employees', '*'),
    tudo<Link>('employee_client_links', '*, client:clients(name), payment_dates:employee_payment_dates(day_of_month)'),
    tudo<{ employee_id: string; name: string; file_url?: string | null }>('employee_documents', 'employee_id, name, file_url'),
  ])
  const hoje = hojeISO()
  const ordem = new Map(ids.map((id, i) => [id, i]))
  const escolhidas = pessoas.filter(p => ordem.has(p.id)).sort((a, b) => ordem.get(a.id)! - ordem.get(b.id)!)
  const ativos = (empId: string) => links.filter(l => l.employee_id === empId && (!l.contract_end_date || l.contract_end_date >= hoje))
    .sort((a, b) => nomeCliente(a).localeCompare(nomeCliente(b)))
  // Contrato solto na aba Documentos (sem ser de um vínculo)
  const contratosNosDocs = (empId: string) => docs.filter(d => d.employee_id === empId && !!d.file_url && /contrato/i.test(d.name)).length

  const porCliente = (ls: Link[], f: (l: Link) => string) => ls.length <= 1 ? (ls[0] ? f(ls[0]) : '') : ls.map(l => `${nomeCliente(l)}: ${f(l) || '—'}`).join(' | ')

  const linhasPessoas = escolhidas.map(p => {
    const ls = ativos(p.id)
    const comContrato = ls.filter(l => !!l.contract_file_url).length
    const endereco = [txt(p.address_street) || txt(p.address), txt(p.address_number), txt(p.address_neighborhood)].filter(Boolean).join(', ')
    return {
      'Nome': p.full_name,
      'Status': txt(p.status),
      'Cargo': txt(p.role),
      'Vinculada a cliente': ls.length ? 'Sim' : 'Não',
      'Qtd. clientes': ls.length,
      'Clientes': ls.map(nomeCliente).join(' | '),
      'Contrato anexado': ls.length
        ? (comContrato === ls.length ? `Sim (${comContrato} de ${ls.length})` : `Falta (${comContrato} de ${ls.length})`)
        : (contratosNosDocs(p.id) ? `Sim (${contratosNosDocs(p.id)} na aba Documentos)` : 'Não'),
      'Salário': porCliente(ls, l => salarioDoLink(l).texto),
      'Dias de pagamento': porCliente(ls, diasDoLink),
      'CPF': txt(p.cpf),
      'RG': txt(p.rg),
      'Nascimento': formatDate(txt(p.birth_date) || null),
      'Admissão': formatDate(txt(p.admission_date) || null),
      'E-mail': txt(p.email),
      'WhatsApp': txt(p.whatsapp),
      'Telefone': txt(p.phone),
      'Contato de emergência': txt(p.emergency_phone),
      'Endereço': endereco,
      'Cidade': txt(p.address_city),
      'UF': ufDoCep(txt(p.address_zip)) || '',
      'CEP': txt(p.address_zip),
      'CRN': [txt(p.crn_number), txt(p.crn_region)].filter(Boolean).join('/'),
      'Banco': txt(p.bank_name),
      'Agência': txt(p.bank_agency),
      'Conta': txt(p.bank_account),
      'Tipo de conta': txt(p.bank_account_type),
      'PIX': txt(p.pix),
    }
  })

  const linhasVinculos = escolhidas.flatMap(p => ativos(p.id).map(l => {
    const sal = salarioDoLink(l)
    return {
      'Nome': p.full_name,
      'Cliente': nomeCliente(l),
      'Tipo': tipoDoVinculo(l),
      'Início': formatDate(l.start_date || null),
      'Fim': l.contract_end_date ? formatDate(l.contract_end_date) : 'sem fim',
      'Contrato anexado': l.contract_file_url ? 'Sim' : l.contract_required ? 'Não (exigido)' : 'Não',
      'Salário': sal.texto,
      'Valor (R$)': sal.valor ?? '',
      'Dias de pagamento': diasDoLink(l),
    }
  }))

  const XLSX = await import('xlsx')
  const aba = (linhas: Record<string, unknown>[], larguras: number[]) => {
    const ws = XLSX.utils.json_to_sheet(linhas)
    ws['!cols'] = larguras.map(wch => ({ wch }))
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
    return ws
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, aba(linhasPessoas,
    [34, 9, 22, 10, 8, 45, 22, 40, 30, 15, 14, 12, 12, 32, 16, 16, 18, 40, 18, 5, 11, 12, 18, 9, 14, 11, 30]), 'Colaboradores')
  XLSX.utils.book_append_sheet(wb, aba(linhasVinculos, [34, 40, 12, 12, 12, 16, 32, 12, 30]), 'Vínculos')
  XLSX.writeFile(wb, `colaboradores_${hoje}.xlsx`)
}
