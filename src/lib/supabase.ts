import { createClient } from '@supabase/supabase-js'

const fetchWithTimeout = (input: RequestInfo | URL, init?: RequestInit) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

export const isConfigured = !!(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder',
  { global: { fetch: fetchWithTimeout } }
)

/**
 * Carrega TODAS as linhas de uma consulta, em páginas.
 *
 * O Supabase devolve no máximo 1000 linhas por requisição e NÃO avisa quando
 * corta. Uma consulta de visitas do mês passa de 1000 assim que a operação
 * cresce — e a folha passaria a calcular pagamento com dado faltando, sem
 * nenhum erro na tela. Use isto em qualquer consulta cujo volume cresce com
 * o tempo (visitas, agenda, vínculos, pagamentos).
 *
 *   const visitas = await fetchAll(() => supabase.from('nutritionist_visits')
 *     .select('...').gte('visit_date', ini).lte('visit_date', fim))
 */
export async function fetchAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }> },
  pageSize = 1000,
): Promise<T[]> {
  const todas: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    todas.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return todas
}
