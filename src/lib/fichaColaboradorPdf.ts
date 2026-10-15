// PDF completo do colaborador (pedido de 15/10/2026): "todas as informações
// daquele colaborador" — observações em destaque, dados, vínculos, documentos
// e a folha de ponto dos últimos 3 meses, dia a dia.
import { supabase, fetchAll } from './supabase'
import { formatDate, hojeISO, tipoDoVinculo } from './utils'
import { minutosLiquidos } from './jornada'
import { salarioDoLink, diasDoLink } from './colaboradoresExcel'
import { criarPdf } from './pdfBase'

type Emp = Record<string, unknown> & { id: string; full_name: string }
type Registro = {
  visit_date: string; client_id: string; check_in?: string | null; check_out?: string | null
  break_start?: string | null; break_end?: string | null; is_unavailable?: boolean; is_holiday?: boolean
  is_extra?: boolean; is_swap?: boolean; unavailability_reason?: string | null; observations?: string | null
}

const txt = (v: unknown) => (v == null ? '' : String(v).trim())
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const horas = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
const nomeMes = (m: string) => new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

export function tipoDoRegistro(v: Registro): string {
  if (v.is_unavailable) return 'Falta'
  if (v.is_holiday) return 'Folga'
  if (!v.check_out) return 'Sem saída'
  if (v.is_extra) return 'Dia extra'
  if (v.is_swap) return 'Troca'
  return 'Trabalho'
}

export async function baixarFichaColaborador(employeeId: string, geradoPor?: string | null) {
  const hoje = hojeISO()
  const d = new Date(hoje + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() - 2)
  const desde = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

  const [{ data: emp, error: e1 }, { data: links }, { data: docs }, obs, regs] = await Promise.all([
    supabase.from('employees').select('*').eq('id', employeeId).single(),
    supabase.from('employee_client_links').select('*, client:clients(id, name), payment_dates:employee_payment_dates(day_of_month)').eq('employee_id', employeeId),
    supabase.from('employee_documents').select('name, status, file_url').eq('employee_id', employeeId).order('name'),
    // Observações (094): se a migração ainda não rodou, o PDF sai sem elas
    supabase.from('employee_observacoes').select('texto, destaque, criado_em, criado_por').eq('employee_id', employeeId)
      .order('criado_em', { ascending: false }).then(r => (r.error ? [] : r.data || []), () => []),
    fetchAll<Registro>(() => supabase.from('nutritionist_visits').select('*').eq('employee_id', employeeId).gte('visit_date', desde).lte('visit_date', hoje).order('visit_date')),
  ])
  if (e1 || !emp) throw new Error(e1?.message || 'Colaborador não encontrado')
  const p = emp as Emp
  type L = Record<string, unknown> & { client?: { id: string; name: string } | null; client_id?: string; start_date?: string | null; contract_end_date?: string | null }
  const ls = (links || []) as L[]
  const nomeCliente = (id: string) => ls.find(l => l.client_id === id)?.client?.name || 'Cliente'

  const pdf = await criarPdf()
  pdf.cabecalho('TIN · Ficha do colaborador', p.full_name, txt(p.status) || '',
    [p.cpf ? `CPF ${p.cpf}` : null, `Gerado em ${new Date().toLocaleString('pt-BR')}${geradoPor ? ` por ${geradoPor}` : ''}`].filter(Boolean).join('  ·  '))

  // ── Observações: em destaque logo no começo ──
  const observacoes = obs as { texto: string; destaque: boolean; criado_em: string; criado_por?: string | null }[]
  const destaques = observacoes.filter(o => o.destaque)
  if (destaques.length) pdf.destaque('Atenção', destaques.map(o => o.texto))

  // ── Dados ──
  pdf.secao('Dados pessoais')
  const endereco = [txt(p.address_street) || txt(p.address), txt(p.address_number), txt(p.address_neighborhood), txt(p.address_city), txt(p.address_zip)].filter(Boolean).join(', ')
  pdf.campos([
    ['Cargo', txt(p.role)], ['CPF', txt(p.cpf)],
    ['RG', txt(p.rg)], ['Nascimento', formatDate(txt(p.birth_date) || null)],
    ['Admissão', formatDate(txt(p.admission_date) || null)], ['CRN', [txt(p.crn_number), txt(p.crn_region)].filter(Boolean).join(' / ')],
    ['E-mail', txt(p.email)], ['WhatsApp', txt(p.whatsapp) || txt(p.phone)],
    ['Contato de emergência', txt(p.emergency_phone)], ['Endereço', endereco],
  ])
  pdf.secao('Dados bancários')
  pdf.campos([
    ['PIX', txt(p.pix)], ['Banco', txt(p.bank_name)],
    ['Agência', txt(p.bank_agency)], ['Conta', [txt(p.bank_account), txt(p.bank_account_type)].filter(Boolean).join(' · ')],
  ])

  // ── Vínculos ──
  pdf.secao('Clientes (vínculos)')
  const ordenados = [...ls].sort((a, b) => txt(b.start_date).localeCompare(txt(a.start_date)))
  if (!ordenados.length) pdf.paragrafo('Nenhum vínculo.')
  else pdf.tabela(
    [{ titulo: 'Cliente', larg: 40 }, { titulo: 'Tipo', larg: 22 }, { titulo: 'Escala', larg: 26 }, { titulo: 'Salário', larg: 38 }, { titulo: 'Pagamento', larg: 24 }, { titulo: 'Período', larg: 32 }],
    ordenados.map(l => {
      const escala = txt(l.work_schedule_type) === 'cliente' ? 'Escala do cliente'
        : txt(l.work_schedule_type) === 'horas' ? `${txt(l.horas_semana) || '?'}h por semana` : txt(l.work_schedule_type)
      const fim = txt(l.contract_end_date)
      return [l.client?.name || 'Cliente', tipoDoVinculo(l as never), escala, salarioDoLink(l as never).texto, diasDoLink(l as never),
        `${formatDate(txt(l.start_date) || null)} a ${fim ? formatDate(fim) : 'sem fim'}${fim && fim < hoje ? ' (encerrado)' : ''}`]
    }),
    i => (txt(ordenados[i].contract_end_date) && txt(ordenados[i].contract_end_date) < hoje ? [245, 245, 245] : null),
  )

  // ── Documentos ──
  pdf.secao('Documentos')
  const ds = (docs || []) as { name: string; status?: string | null; file_url?: string | null }[]
  if (!ds.length) pdf.paragrafo('Nenhum documento cadastrado.')
  else pdf.tabela([{ titulo: 'Documento', larg: 90 }, { titulo: 'Situação', larg: 50 }, { titulo: 'Arquivo', larg: 40 }],
    ds.map(x => [x.name, txt(x.status), x.file_url ? 'anexado' : 'sem arquivo']))

  // ── Todas as observações ──
  if (observacoes.length) {
    pdf.secao('Observações')
    pdf.tabela([{ titulo: 'Data', larg: 22 }, { titulo: 'Observação', larg: 130 }, { titulo: 'Por', larg: 30 }],
      observacoes.map(o => [new Date(o.criado_em).toLocaleDateString('pt-BR'), o.texto + (o.destaque ? ' (destaque)' : ''), o.criado_por || '']))
  }

  // ── Folha de ponto: últimos 3 meses ──
  const meses = [...new Set([desde.slice(0, 7), ...[1, 2].map(k => { const m = new Date(desde + 'T12:00:00'); m.setMonth(m.getMonth() + k); return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}` })])]
  for (const mes of meses) {
    pdf.novaPagina()
    pdf.secao(`Folha de ponto · ${nomeMes(mes)}`)
    const doMes = regs.filter(r => r.visit_date.startsWith(mes))
    if (!doMes.length) { pdf.paragrafo('Nenhum registro no mês.'); continue }
    const intervaloDe = (cid: string) => Number(ls.find(l => l.client_id === cid)?.break_minutes) || 0
    const minDe = (r: Registro) => (r.check_in && r.check_out && !r.is_unavailable ? minutosLiquidos(r, intervaloDe(r.client_id)) : 0)
    const trabalhados = doMes.filter(r => r.check_out && !r.is_unavailable && !r.is_holiday)
    const resumo = [
      `${new Set(trabalhados.map(r => r.visit_date)).size} dia(s) trabalhado(s)`,
      `${horas(doMes.reduce((s, r) => s + minDe(r), 0))} no total`,
      `${doMes.filter(r => r.is_holiday && !r.is_unavailable).length} folga(s)`,
      `${doMes.filter(r => r.is_unavailable).length} falta(s)`,
      `${doMes.filter(r => r.is_extra).length} dia(s) extra(s)`,
    ].join('  ·  ')
    pdf.paragrafo(resumo, { tam: 9, cor: [15, 78, 48] })
    const varios = new Set(doMes.map(r => r.client_id)).size > 1
    pdf.tabela(
      [{ titulo: 'Data', larg: 16 }, { titulo: 'Dia', larg: 9 }, ...(varios ? [{ titulo: 'Cliente', larg: 32 }] : []),
        { titulo: 'Entrada', larg: 14 }, { titulo: 'Saída', larg: 14 }, { titulo: 'Horas', larg: 13, direita: true }, { titulo: 'Tipo', larg: 18 }, { titulo: 'Observação', larg: 60 }],
      doMes.map(r => [
        formatDate(r.visit_date).slice(0, 5), DIAS[new Date(r.visit_date + 'T12:00:00').getDay()],
        ...(varios ? [nomeCliente(r.client_id)] : []),
        txt(r.check_in).slice(0, 5), txt(r.check_out).slice(0, 5), minDe(r) ? horas(minDe(r)) : '', tipoDoRegistro(r),
        [r.unavailability_reason, r.observations].filter(Boolean).join(' · '),
      ]),
      i => (doMes[i].is_unavailable ? [254, 226, 226] : doMes[i].is_holiday ? [232, 240, 254] : !doMes[i].check_out ? [254, 243, 199] : null),
    )
  }

  pdf.numerar(p.full_name)
  pdf.doc.save(`ficha_${p.full_name.replace(/\s+/g, '_')}.pdf`)
}
