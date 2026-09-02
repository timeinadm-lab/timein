// ============================================================
// Folha de pagamento em Excel — uma planilha com quatro abas:
//   Resumo      · uma linha por colaborador em cada cliente
//   Dia a dia   · cada registro de ponto do mês
//   Reembolsos  · o que foi pedido, com nota e situação
//   Pagamentos  · todos os lançamentos, mês por mês
// ============================================================

export type VisitaExcel = {
  visit_date: string
  check_in?: string | null
  check_out?: string | null
  break_start?: string | null
  break_end?: string | null
  visit_rate?: number | null
  unit_name?: string | null
  observations?: string | null
  report_url?: string | null
  atestado_url?: string | null
  unavailability_reason?: string | null
  is_unavailable?: boolean
  is_holiday?: boolean
  is_extra?: boolean
  extra_approval?: string | null
  extra_amount?: number | null
}

export type FolhaExcelRow = {
  employee?: { id: string; full_name: string }
  client?: { id: string; name: string }
  service_type: string
  isFreela: boolean
  freelaConsultoria: boolean
  work_schedule?: string | null
  startDate?: string | null
  monthly_amount: number
  dailyRate: number
  valorDia: number
  expDays: number
  actualDays: number
  actualVisits: number
  faltas: number
  realAmt: number
  cost_assistance: number
  extrasAprovados: number
  extrasPendentes: { visit_date: string }[]
  semRelatorio: number
  payDay: number
  presencaCompleta: boolean
  ausencias: VisitaExcel[]
  ausenciasComAtestado: VisitaExcel[]
  visits: VisitaExcel[]
  visitHours: (v: VisitaExcel) => number
}

export type ExpenseExcel = {
  amount: number
  description: string
  employee_id?: string
  category?: string | null
  status?: string | null
  receipt_url?: string | null
  notes?: string | null
  created_at?: string | null
  reference_month?: string | null
  employee?: { id?: string; full_name: string }
}

export type PagamentoExcel = {
  description: string
  amount: number
  due_date: string
  status: string
  type?: string | null
  reference_month?: string | null
  paid_at?: string | null
  employee?: { full_name: string }
  client?: { name: string }
}

const tipoDoVinculo = (r: FolhaExcelRow) =>
  r.isFreela
    ? (r.freelaConsultoria ? 'Freela (consultoria)' : 'Freela (diária)')
    : r.service_type === 'Consultoria' ? 'Consultoria' : 'Fixo'

const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : '')
const sim = (v: unknown) => (v ? 'Sim' : 'Não')
const n2 = (v: number) => Math.round((v || 0) * 100) / 100

export async function exportFolhaExcel(
  rows: FolhaExcelRow[],
  expenses: ExpenseExcel[],
  pagamentos: PagamentoExcel[],
  mes: string,
) {
  const XLSX = await import('xlsx')

  // ── Aba 1: Resumo ──
  const resumo = rows.map(r => {
    const meus = expenses.filter(e => (e.employee_id ?? e.employee?.id) === r.employee?.id)
    const reembolsoAprovado = meus
      .filter(e => (e.status ?? 'aprovado') === 'aprovado')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const reembolsoPendente = meus
      .filter(e => e.status === 'pendente')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const horas = r.visits.reduce((s, v) => s + r.visitHours(v), 0)
    const isConsult = r.service_type === 'Consultoria' || r.freelaConsultoria

    return {
      'Mês': mes,
      'Colaborador': r.employee?.full_name ?? '',
      'Cliente': r.client?.name ?? '',
      'Tipo': tipoDoVinculo(r),
      'Escala': r.work_schedule ?? '',
      'Início': r.startDate ?? '',
      'Dias previstos': isConsult ? '' : r.expDays,
      'Dias trabalhados': isConsult ? '' : r.actualDays,
      'Foi todos os dias': isConsult ? '' : (r.presencaCompleta ? 'Sim' : 'Não'),
      'Faltas': isConsult ? '' : r.faltas,
      'Ausências com atestado': r.ausenciasComAtestado.length,
      'Ausências sem atestado': r.ausencias.length - r.ausenciasComAtestado.length,
      'Visitas realizadas': isConsult ? r.actualVisits : '',
      'Horas trabalhadas': n2(horas),
      'Relatórios pendentes': r.semRelatorio,
      'Salário / Diária': n2(r.isFreela && !r.freelaConsultoria ? r.dailyRate : r.monthly_amount),
      'Valor do dia (salário ÷ 30)': isConsult ? '' : n2(r.valorDia),
      'Desconto por falta': isConsult ? '' : n2(r.faltas * r.valorDia),
      'Ajuda de custo': n2(r.cost_assistance),
      'Reembolso aprovado': n2(reembolsoAprovado),
      'Reembolso aguardando análise': n2(reembolsoPendente),
      'Extras aprovados': n2(r.extrasAprovados),
      'Extras aguardando decisão': r.extrasPendentes.length,
      'Total a pagar': n2(r.realAmt + r.cost_assistance + reembolsoAprovado + r.extrasAprovados),
      'Dia do pagamento': r.payDay,
    }
  })

  // ── Aba 2: Dia a dia ──
  const diaADia = rows.flatMap(r =>
    r.visits.slice()
      .sort((a, b) => a.visit_date.localeCompare(b.visit_date))
      .map(v => ({
        'Mês': mes,
        'Colaborador': r.employee?.full_name ?? '',
        'Cliente': r.client?.name ?? '',
        'Unidade': v.unit_name ?? '',
        'Data': v.visit_date,
        'Tipo do dia': v.is_unavailable ? 'Ausência'
          : v.is_holiday ? 'Feriado'
            : v.is_extra ? 'Dia extra'
              : 'Trabalhado',
        'Entrada': hhmm(v.check_in),
        'Saída': hhmm(v.check_out),
        'Intervalo': v.break_start && v.break_end ? `${hhmm(v.break_start)} - ${hhmm(v.break_end)}` : '',
        'Horas': n2(r.visitHours(v)),
        'Valor da visita': v.visit_rate != null ? n2(Number(v.visit_rate)) : '',
        'Atestado anexado': v.is_unavailable ? sim(v.atestado_url) : '',
        'Motivo da ausência': v.unavailability_reason ?? '',
        'Relatório anexado': sim(v.report_url),
        'Extra': v.is_extra ? (v.extra_approval ?? 'pendente') : '',
        'Valor do extra': v.extra_amount != null ? n2(Number(v.extra_amount)) : '',
        'Observações': v.observations ?? '',
      })),
  )

  // ── Aba 3: Reembolsos ──
  const reembolsos = expenses.map(e => ({
    'Mês': e.reference_month ?? mes,
    'Colaborador': e.employee?.full_name ?? '',
    'Pedido em': e.created_at ? String(e.created_at).slice(0, 10) : '',
    'Descrição': e.description,
    'Categoria': e.category ?? '',
    'Valor': n2(Number(e.amount)),
    'Situação': e.status ?? 'aprovado',
    'Nota anexada': sim(e.receipt_url),
    'Observações': e.notes ?? '',
  }))

  // ── Aba 4: Pagamentos de todos os meses ──
  const historico = pagamentos.map(p => ({
    'Mês de referência': p.reference_month ?? '',
    'Colaborador': p.employee?.full_name ?? '',
    'Cliente': p.client?.name ?? '',
    'Descrição': p.description,
    'Tipo': p.type ?? '',
    'Valor': n2(Number(p.amount)),
    'Vencimento': p.due_date ?? '',
    'Situação': p.status,
    'Pago em': p.paid_at ? String(p.paid_at).slice(0, 10) : '',
  }))

  const wb = XLSX.utils.book_new()

  const addSheet = (nome: string, dados: Record<string, unknown>[]) => {
    const linhas = dados.length ? dados : [{ 'Aviso': 'Nada registrado neste mês' }]
    const ws = XLSX.utils.json_to_sheet(linhas)
    // Sem largura definida o Excel espreme tudo numa coluna estreita
    const chaves = Object.keys(linhas[0])
    ws['!cols'] = chaves.map(k => ({
      wch: Math.min(45, Math.max(
        k.length + 2,
        ...linhas.slice(0, 300).map(d => String(d[k] ?? '').length + 2),
      )),
    }))
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(wb, ws, nome)
  }

  addSheet('Resumo', resumo)
  addSheet('Dia a dia', diaADia)
  addSheet('Reembolsos', reembolsos)
  addSheet('Pagamentos', historico)

  XLSX.writeFile(wb, `folha_${mes}.xlsx`)
}
