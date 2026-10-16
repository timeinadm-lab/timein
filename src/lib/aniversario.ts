// ============================================================
// Aniversários dos colaboradores (pedido de 16/10/2026): rosa no Calendário
// e a tela Aniversariantes. Contas puras, testadas em aniversario.test.ts.
// birth_date vem como 'AAAA-MM-DD' (sem fuso).
// ============================================================

export type ComNascimento = { id: string; full_name: string; birth_date?: string | null }

/** Dia e mês do nascimento; null se a data estiver vazia ou estranha */
export function diaMes(birth?: string | null): { ano: number; mes: number; dia: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birth || '')
  if (!m) return null
  const ano = +m[1], mes = +m[2], dia = +m[3]
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return { ano, mes, dia }
}

/** Data do aniversário em um ano ('AAAA-MM-DD'). Quem nasceu em 29/02 faz em 28/02 nos anos que não são bissextos. */
export function aniversarioNoAno(birth: string | null | undefined, ano: number): string | null {
  const d = diaMes(birth)
  if (!d) return null
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
  const dia = d.mes === 2 && d.dia === 29 && !bissexto ? 28 : d.dia
  return `${ano}-${String(d.mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Quantos anos faz no aniversário desse ano */
export function idadeNoAno(birth: string | null | undefined, ano: number): number | null {
  const d = diaMes(birth)
  if (!d || d.ano < 1900 || d.ano >= ano) return null
  return ano - d.ano
}

/** Próximo aniversário a partir de hoje (inclusive) e quantos dias faltam */
export function proximoAniversario(birth: string | null | undefined, hoje: string): { data: string; dias: number; idade: number | null } | null {
  const ano = +hoje.slice(0, 4)
  let data = aniversarioNoAno(birth, ano)
  if (!data) return null
  if (data < hoje) data = aniversarioNoAno(birth, ano + 1)!
  const dias = Math.round((Date.parse(data + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000)
  return { data, dias, idade: idadeNoAno(birth, +data.slice(0, 4)) }
}

/** Aniversariantes de um mês ('AAAA-MM'), em ordem de dia */
export function aniversariantesDoMes<T extends ComNascimento>(pessoas: T[], mes: string): (T & { data: string; idade: number | null })[] {
  const ano = +mes.slice(0, 4)
  return pessoas
    .map(p => ({ ...p, data: aniversarioNoAno(p.birth_date, ano) || '', idade: idadeNoAno(p.birth_date, ano) }))
    .filter(p => p.data.startsWith(mes))
    .sort((a, b) => a.data.localeCompare(b.data) || a.full_name.localeCompare(b.full_name))
}
