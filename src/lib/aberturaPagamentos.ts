// ============================================================
// Abertura de cada pagamento do dia (pedido de 14/10/2026): "a aba do dia
// 8/15/20 com o salário + se houver reembolso + a observação + ajuda de custo".
//
// O lançamento (payments) guarda só o TOTAL. A folha soma nele: ajuda de custo
// mensal do contrato + reembolsos aprovados (que não foram para a segunda) −
// adiantamento. Aqui a conta é desfeita, com a mesma regra da folha
// (planoLancamentos):
//   · Consultoria por visita: os extras vão no ÚLTIMO lançamento do mês.
//   · Fixo / salário: com dois dias, metade em cada → extras divididos na
//     proporção do valor de cada lançamento.
//   · Lançamento feito à mão (Manual / ajustado): não é aberto — vai inteiro
//     em Salário e a descrição explica.
// Garantia: salário + ajuda + reembolso − adiantamento = valor lançado, sempre.
// Sem banco e sem React: testado em aberturaPagamentos.test.ts.
// ============================================================

export type PagamentoBase = {
  id: string
  amount: number | string | null
  due_date: string
  employee_id?: string | null
  client_id?: string | null
  link_id?: string | null
  reference_month?: string | null
  type?: string | null
  ajuste_manual?: boolean | null
  status?: string | null
}
export type VinculoBase = { id: string; client_id?: string | null; porVisita: boolean; ajudaMensal: number | ((mes: string) => number) }   // função: depende do mês trabalhado
export type GastoBase = {
  employee_id: string; client_id?: string | null; reference_month: string
  category?: string | null; amount: number | string | null; description?: string | null
}
export type Abertura = { salario: number; ajuda: number; reembolso: number; adiantamento: number; reembolsos: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100
const v = (x: unknown) => Number(x) || 0

/** Ajuda mensal do contrato no mês trabalhado (encerrou no mês: dias ÷ 30, como a folha) */
export function ajudaMensalNoMes(l: { cost_assistance?: number | null; cost_assistance_periodo?: string | null; contract_end_date?: string | null }, mes: string): number {
  if (l.cost_assistance_periodo === 'semana') return 0
  const cheia = v(l.cost_assistance)
  const fim = l.contract_end_date
  if (fim && fim.slice(0, 7) === mes) return r2(cheia * Math.min(1, Number(fim.slice(8, 10)) / 30))
  if (fim && fim.slice(0, 7) < mes) return 0
  return cheia
}

export function abrirPagamentos(pagamentos: PagamentoBase[], vinculos: Map<string, VinculoBase>, gastos: GastoBase[]): Map<string, Abertura> {
  const out = new Map<string, Abertura>()
  const inteiro = (p: PagamentoBase): Abertura => ({ salario: r2(v(p.amount)), ajuda: 0, reembolso: 0, adiantamento: 0, reembolsos: [] })

  // Grupos: vínculo + mês trabalhado
  const grupos = new Map<string, PagamentoBase[]>()
  for (const p of pagamentos) {
    if (!p.link_id || !p.reference_month || !vinculos.has(p.link_id)) { out.set(p.id, inteiro(p)); continue }
    const k = `${p.link_id}|${p.reference_month}`
    grupos.set(k, [...(grupos.get(k) || []), p])
  }

  // Gasto sem cliente vai para o 1º vínculo da pessoa no mês (como a folha)
  const primeiroDoMes = new Map<string, string>()
  for (const k of [...grupos.keys()].sort()) {
    const p = grupos.get(k)![0]
    const chave = `${p.employee_id}|${p.reference_month}`
    if (!primeiroDoMes.has(chave)) primeiroDoMes.set(chave, p.link_id!)
  }

  for (const [k, lista] of grupos) {
    const [linkId, mes] = k.split('|')
    const l = vinculos.get(linkId)!
    const emp = lista[0].employee_id
    const meus = gastos.filter(g => g.employee_id === emp && g.reference_month === mes &&
      (g.client_id ? g.client_id === l.client_id : primeiroDoMes.get(`${emp}|${mes}`) === linkId))
    const adiant = r2(meus.filter(g => g.category === 'Adiantamento').reduce((s, g) => s + v(g.amount), 0))
    const ajudaGasto = meus.filter(g => g.category === 'Ajuda de Custo')
    const reemb = meus.filter(g => g.category !== 'Adiantamento' && g.category !== 'Ajuda de Custo')
    const ajuda = r2((typeof l.ajudaMensal === 'function' ? l.ajudaMensal(mes) : l.ajudaMensal) + ajudaGasto.reduce((s, g) => s + v(g.amount), 0))
    const reembolso = r2(reemb.reduce((s, g) => s + v(g.amount), 0))
    const descr = reemb.map(g => g.description || 'Reembolso').filter(Boolean)

    // Só os lançamentos da conta automática recebem extras
    const automaticos = lista.filter(p => p.type !== 'Manual' && !p.ajuste_manual).sort((a, b) => a.due_date.localeCompare(b.due_date))
    for (const p of lista) if (!automaticos.includes(p)) out.set(p.id, inteiro(p))
    if (!automaticos.length) continue

    const totalGrupo = automaticos.reduce((s, p) => s + v(p.amount), 0)
    const pesos = automaticos.map((p, i) => l.porVisita
      ? (i === automaticos.length - 1 ? 1 : 0)
      : (totalGrupo > 0 ? v(p.amount) / totalGrupo : (i === automaticos.length - 1 ? 1 : 0)))

    automaticos.forEach((p, i) => {
      const valor = r2(v(p.amount))
      let aj = r2(ajuda * pesos[i]), re = r2(reembolso * pesos[i]), ad = r2(adiant * pesos[i])
      // Extras maiores que o lançamento (salário zerado, valor ajustado): reduz na proporção
      const extras = aj + re - ad
      if (extras > valor && extras > 0) {
        const f = valor / extras
        aj = r2(aj * f); re = r2(re * f); ad = r2(ad * f)
      }
      const salario = r2(valor - aj - re + ad)
      out.set(p.id, { salario: Math.max(0, salario), ajuda: aj, reembolso: re, adiantamento: ad, reembolsos: pesos[i] > 0 ? descr : [] })
      // Arredondamento: o que sobrar fica no salário para fechar com o lançado
      const a = out.get(p.id)!
      const dif = r2(valor - (a.salario + a.ajuda + a.reembolso - a.adiantamento))
      if (dif !== 0) a.salario = r2(a.salario + dif)
    })
  }
  return out
}
