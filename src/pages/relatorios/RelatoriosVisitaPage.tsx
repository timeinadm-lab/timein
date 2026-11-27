import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import RelatoriosVisita from '../../components/relatorio/RelatoriosVisita'
import type { ApiRelatorios } from '../../components/relatorio/RelatoriosVisita'
import { normalizarRelatorio } from '../../lib/relatorioVisita'
import type { LinhaRelatorio } from '../../lib/relatorioVisita'

/**
 * Relatórios de visita no escritório (migração 114, 20/11/2026). Mostra os de
 * todo mundo — os feitos no portal pelas nutricionistas e os feitos aqui — e
 * deixa quem é do escritório fazer o seu. A tela é a mesma do portal.
 */
export default function RelatoriosVisitaPage() {
  const { user, profile } = useAuth()
  const { data: clientes = [] } = useQuery({
    queryKey: ['relatorios-clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const api = useMemo<ApiRelatorios>(() => ({
    carregar: async () => {
      const [rel, cli, emp] = await Promise.all([
        supabase.from('relatorios_visita').select('id,titulo,data,status,pdf_url,client_id,itens,autor_nome,client:clients(name)').order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(300),
        supabase.from('clients').select('id,logo_url').not('logo_url', 'is', null),
        // CPF e cargo de quem é do escritório e também tem cadastro de colaborador
        profile?.employee_id ? supabase.from('employees').select('cpf,role,email').eq('id', profile.employee_id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (rel.error) throw new Error(rel.error.message)
      const linhas = ((rel.data || []) as unknown as (Record<string, unknown> & { client?: { name?: string } | null })[]).map(r => ({
        id: String(r.id), titulo: String(r.titulo || ''), data: String(r.data), status: r.status === 'finalizado' ? 'finalizado' : 'rascunho',
        pdf_url: (r.pdf_url as string) || null, client_id: (r.client_id as string) || null, cliente: r.client?.name || null,
        anotacoes: Array.isArray(r.itens) ? r.itens.length : 0, autor: (r.autor_nome as string) || null,
      })) as LinhaRelatorio[]
      const e = emp.data as { cpf?: string; role?: string; email?: string } | null
      return {
        relatorios: linhas,
        autor: { nome: profile?.full_name || '', email: profile?.email || e?.email || user?.email || null, cargo: e?.role || 'Nutricionista', cpf: e?.cpf || null },
        logos: Object.fromEntries(((cli.data || []) as { id: string; logo_url: string }[]).map(c => [c.id, c.logo_url])),
      }
    },
    abrir: async id => {
      const { data, error } = await supabase.from('relatorios_visita').select('*').eq('id', id).single()
      if (error) throw new Error(error.message)
      return normalizarRelatorio(data)
    },
    salvar: async r => {
      const campos = {
        client_id: r.client_id, titulo: r.titulo, data: r.data, entrada: r.entrada || null, saida: r.saida || null,
        objetivo: r.objetivo || null, nota: r.nota || null, itens: r.itens, assinaturas: r.assinaturas, status: r.status,
        ...(r.pdf_url ? { pdf_url: r.pdf_url } : {}), atualizado_em: new Date().toISOString(),
        ...(r.autor_nome ? { autor_nome: r.autor_nome } : {}), ...(r.autor_email ? { autor_email: r.autor_email } : {}),
      }
      // Relatório que já existe (inclusive feito no portal) mantém o autor original
      const { data: existe } = await supabase.from('relatorios_visita').select('id').eq('id', r.id).maybeSingle()
      const { error } = existe
        ? await supabase.from('relatorios_visita').update(campos).eq('id', r.id)
        : await supabase.from('relatorios_visita').insert({
            id: r.id, ...campos, user_id: user?.id || null, employee_id: profile?.employee_id || null,
            autor_nome: r.autor_nome || profile?.full_name || null, autor_email: r.autor_email || profile?.email || user?.email || null,
          })
      if (error) throw new Error(error.message)
      // 27/11/2026: não anexa mais sozinho na visita do ponto; a tela pergunta antes
    },
    apagar: async id => {
      const { error } = await supabase.from('relatorios_visita').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    visitaDoDia: async r => {
      const { data: rel } = await supabase.from('relatorios_visita').select('employee_id').eq('id', r.id).maybeSingle()
      if (!rel?.employee_id) return null
      const { data: v } = await supabase.from('nutritionist_visits').select('id, report_url, is_unavailable')
        .eq('employee_id', rel.employee_id).eq('client_id', r.client_id).eq('visit_date', r.data)
      const achou = (v || []).find(x => !x.is_unavailable)
      return achou ? { id: achou.id, temRelatorio: !!achou.report_url } : null
    },
    anexarNaVisita: async (visitaId, r) => {
      const { error } = await supabase.from('nutritionist_visits').update({ report_url: r.pdf_url }).eq('id', visitaId)
      if (error) throw new Error(error.message)
    },
  }), [user?.id, profile?.id, profile?.employee_id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Relatórios de visita</h1>
        <p className="text-sm text-ink-500 mt-1">Os relatórios feitos no portal e os do escritório. O PDF sai com a nossa logo e a do cliente.</p>
      </div>
      <RelatoriosVisita api={api} clientes={clientes} chave="escritorio" />
    </div>
  )
}
