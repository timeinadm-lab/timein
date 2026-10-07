// ============================================================
// Saídas do mês por DIA DE PAGAMENTO (pedido do Gabriel, 30/09/2026):
//   Dia 8 · Dia 15 · Dia 20 · Avulsos (qualquer outro dia).
// Base: os lançamentos (tabela payments) com VENCIMENTO no mês escolhido —
// é o dinheiro que sai naquele mês, não o mês trabalhado. Ex.: a 2ª quinzena
// da consultoria de setembro vence em 08/10 e aparece em outubro, no Dia 8.
// Cancelado não é saída e fica de fora.
// Sem React e sem banco: dá para testar (pagamentosPorDia.test.ts).
// ============================================================

export const DIAS_FIXOS = [8, 15, 20] as const
export type ChaveDia = 'd8' | 'd15' | 'd20' | 'avulso'

export type Lancamento = {
  id: string
  description?: string | null
  amount: number | string | null
  due_date: string            // yyyy-MM-dd
  status: string              // Pendente | Pago | Cancelado
  type?: string | null        // Estimativa | Real | Manual
  category?: string | null
  reference_month?: string | null
  paid_at?: string | null
  employee_id?: string | null
  client_id?: string | null
  link_id?: string | null
}

export type GrupoDia<T extends Lancamento = Lancamento> = {
  chave: ChaveDia
  titulo: string
  itens: T[]
  total: number
  pago: number
  pendente: number
  atrasado: number
  qtdPendentes: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const valor = (p: Lancamento) => Number(p.amount) || 0

export function chaveDoDia(dueDate: string): ChaveDia {
  const dia = Number(dueDate.slice(8, 10))
  return dia === 8 ? 'd8' : dia === 15 ? 'd15' : dia === 20 ? 'd20' : 'avulso'
}

/** Agrupa os lançamentos do mês nos 4 grupos, sempre nesta ordem (grupo vazio também vem) */
export function agruparPorDia<T extends Lancamento>(lancamentos: T[], hoje: string): GrupoDia<T>[] {
  const titulos: Record<ChaveDia, string> = { d8: 'Dia 8', d15: 'Dia 15', d20: 'Dia 20', avulso: 'Avulsos' }
  const grupos = (['d8', 'd15', 'd20', 'avulso'] as ChaveDia[]).map(chave => ({
    chave, titulo: titulos[chave], itens: [] as T[], total: 0, pago: 0, pendente: 0, atrasado: 0, qtdPendentes: 0,
  }))
  for (const p of lancamentos) {
    if (p.status === 'Cancelado') continue
    const g = grupos.find(x => x.chave === chaveDoDia(p.due_date))!
    g.itens.push(p)
    const v = valor(p)
    g.total += v
    if (p.status === 'Pago') g.pago += v
    else {
      g.pendente += v
      g.qtdPendentes++
      // Aguardando o RH não é atraso de quem paga
      if (p.due_date < hoje && !(p as { aguardando?: unknown }).aguardando) g.atrasado += v
    }
  }
  for (const g of grupos) {
    g.total = r2(g.total); g.pago = r2(g.pago); g.pendente = r2(g.pendente); g.atrasado = r2(g.atrasado)
    // Avulsos por data; dentro do dia fixo, pendente primeiro e depois por nome do lançamento
    g.itens.sort((a, b) => a.due_date.localeCompare(b.due_date)
      || (a.status === 'Pago' ? 1 : 0) - (b.status === 'Pago' ? 1 : 0)
      || String(a.description || '').localeCompare(String(b.description || '')))
  }
  return grupos
}

/** Totais do mês somando os grupos */
export function totaisDoMes(grupos: GrupoDia[]) {
  return {
    total: r2(grupos.reduce((s, g) => s + g.total, 0)),
    pago: r2(grupos.reduce((s, g) => s + g.pago, 0)),
    pendente: r2(grupos.reduce((s, g) => s + g.pendente, 0)),
    atrasado: r2(grupos.reduce((s, g) => s + g.atrasado, 0)),
    qtd: grupos.reduce((s, g) => s + g.itens.length, 0),
  }
}

/** Primeiro e último dia do mês (yyyy-MM) */
export function limitesDoMes(mes: string): { inicio: string; fim: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/** "set/2026" a partir de "2026-09" — para o mês de referência do lançamento */
export function mesCurto(ref?: string | null): string {
  if (!ref || !/^\d{4}-\d{2}$/.test(ref)) return ''
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(ref.slice(5, 7)) - 1]}/${ref.slice(0, 4)}`
}
