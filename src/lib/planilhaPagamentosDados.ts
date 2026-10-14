// Busca o que a "Planilha do mês" precisa para abrir cada pagamento
// (salário + ajuda + reembolso − adiantamento) e a aba da Ajuda de custo paga
// às segundas. A conta em si fica em aberturaPagamentos.ts (testada).
import { supabase } from './supabase'
import { tipoDoVinculo, salarioConsultoria } from './utils'
import { abrirPagamentos, ajudaMensalNoMes } from './aberturaPagamentos'
import type { Abertura, PagamentoBase, VinculoBase, GastoBase } from './aberturaPagamentos'

export type AjudaRel = {
  employee_id: string | null; client_id: string | null; periodo: 'semana' | 'mes'; inicio: string; fim: string
  tipo: string; descricao: string | null; valor: number; status: string; pago_em: string | null; expense_id?: string | null
}

const emPartes = <T,>(xs: T[], n = 80) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function carregarAbertura(pagamentos: PagamentoBase[], mes: string, fimMes: string): Promise<{ abertura: Map<string, Abertura>; ajudas: AjudaRel[] }> {
  // Vínculos dos lançamentos
  const linkIds = [...new Set(pagamentos.map(p => p.link_id).filter(Boolean) as string[])]
  const vinculos = new Map<string, VinculoBase>()
  for (const parte of emPartes(linkIds)) {
    const { data, error } = await supabase.from('employee_client_links')
      .select('id, client_id, service_type, coverage_type, pay_mode, cost_assistance, cost_assistance_periodo, contract_end_date').in('id', parte)
    if (error) throw error
    for (const l of data || []) vinculos.set(l.id as string, {
      id: l.id as string, client_id: l.client_id as string | null,
      porVisita: tipoDoVinculo(l) === 'Consultoria' && !salarioConsultoria(l),
      ajudaMensal: (m: string) => ajudaMensalNoMes(l, m),
    })
  }

  // Reembolsos e adiantamentos aprovados dos meses trabalhados — menos os que vão pela segunda (Ajuda de custo)
  const meses = [...new Set(pagamentos.map(p => p.reference_month).filter(Boolean) as string[])]
  let gastos: (GastoBase & { id: string; status?: string | null })[] = []
  if (meses.length) {
    const { data, error } = await supabase.from('employee_expenses')
      .select('id, employee_id, client_id, reference_month, category, amount, description, status').in('reference_month', meses)
    if (error) throw error
    gastos = ((data || []) as typeof gastos).filter(g => (g.status ?? 'aprovado') === 'aprovado')
  }
  const naSegunda = new Set<string>()
  for (const parte of emPartes(gastos.map(g => g.id))) {
    const { data } = await supabase.from('ajudas_custo').select('expense_id').in('expense_id', parte)
    for (const a of data || []) if (a.expense_id) naSegunda.add(a.expense_id as string)
  }
  const abertura = abrirPagamentos(pagamentos, vinculos, gastos.filter(g => !naSegunda.has(g.id)))

  // Ajuda de custo do mês (semanas que começam no mês + lançamentos mensais)
  const { data: aj, error: eAj } = await supabase.from('ajudas_custo')
    .select('employee_id, client_id, periodo, inicio, fim, tipo, descricao, valor, status, pago_em, expense_id')
    .gte('inicio', `${mes}-01`).lte('inicio', fimMes).order('inicio')
  if (eAj && !/ajudas_custo|relation/.test(eAj.message)) throw eAj
  return { abertura, ajudas: (aj || []) as AjudaRel[] }
}
