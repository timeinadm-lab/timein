import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bell, Receipt, Clock3, FileWarning, FileSignature, MessageSquare, AlertTriangle, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { hojeISO } from '../../lib/utils'

type Aviso = { chave: string; rotulo: string; n: number; caminho: string; icone: LucideIcon; urgente?: boolean }

/**
 * Sino de avisos no topo: tudo que espera alguém do RH, visível de qualquer
 * tela. Antes essas contagens ficavam espalhadas (Dashboard, Pagamentos,
 * Visitas) e só apareciam para quem abrisse a tela certa.
 */
export default function AvisosSino() {
  const { role } = useAuth()
  const chefe = role === 'chefe'
  const navigate = useNavigate()
  const [aberto, setAberto] = useState(false)

  const { data: avisos = [] } = useQuery({
    queryKey: ['avisos-sino', chefe],
    refetchInterval: 120_000,
    queryFn: async (): Promise<Aviso[]> => {
      const conta = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
        const { count, error } = await q
        return error ? 0 : count ?? 0
      }
      const [reembolsos, extras, atrasados, docs, perguntas, contratos] = await Promise.all([
        chefe ? conta(supabase.from('employee_expenses').select('id', { count: 'exact', head: true }).eq('status', 'pendente')) : 0,
        chefe ? conta(supabase.from('nutritionist_visits').select('id', { count: 'exact', head: true }).eq('extra_approval', 'pendente')) : 0,
        chefe ? conta(supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'Pendente').lt('due_date', hojeISO())) : 0,
        chefe ? conta(supabase.from('employee_documents').select('id', { count: 'exact', head: true }).eq('status', 'Pendente').is('file_url', null)) : 0,
        conta(supabase.from('employee_questions').select('id', { count: 'exact', head: true }).is('answer', null)),
        // Contrato faltando só conta para quem está ativo
        (async () => {
          const { data } = await supabase.from('employee_client_links')
            .select('id, employee:employees(status)')
            .in('service_type', ['Fixo', 'Consultoria'])
            .is('contract_file_url', null)
          return ((data || []) as { employee?: { status?: string } | { status?: string }[] }[])
            .filter(l => (Array.isArray(l.employee) ? l.employee[0] : l.employee)?.status === 'Ativo').length
        })(),
      ])
      return ([
        { chave: 'atrasados', rotulo: 'Pagamentos atrasados', n: atrasados, caminho: '/pagamentos', icone: AlertTriangle, urgente: true },
        { chave: 'reembolsos', rotulo: 'Reembolsos para analisar', n: reembolsos, caminho: '/pagamentos', icone: Receipt },
        { chave: 'extras', rotulo: 'Extras para aprovar', n: extras, caminho: '/visitas', icone: Clock3 },
        { chave: 'perguntas', rotulo: 'Perguntas no chat', n: perguntas, caminho: '/chat', icone: MessageSquare },
        { chave: 'docs', rotulo: 'Documentos pendentes', n: docs, caminho: '/colaboradores', icone: FileWarning },
        { chave: 'contratos', rotulo: 'Vínculos sem contrato', n: contratos, caminho: '/colaboradores', icone: FileSignature },
      ] as Aviso[]).filter(a => a.n > 0)
    },
  })

  const total = avisos.reduce((s, a) => s + a.n, 0)
  const temUrgente = avisos.some(a => a.urgente)

  return (
    <div className="relative">
      <button
        onClick={() => setAberto(v => !v)}
        className={`relative p-2 rounded-lg border transition-colors ${aberto ? 'bg-ink-100 border-ink-200' : 'bg-white border-ink-200 hover:bg-ink-50'}`}
        aria-label={total ? `${total} avisos` : 'Avisos'}
        title="Avisos"
      >
        <Bell size={18} className="text-ink-700" strokeWidth={1.75} />
        {total > 0 && (
          <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold text-white flex items-center justify-center tnum ${temUrgente ? 'bg-red-600' : 'bg-amber-500'}`}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-[min(20rem,calc(100vw-1.5rem))] bg-white rounded-xl border border-ink-200 shadow-lift overflow-hidden animate-fade-in">
            <div className="flex items-baseline justify-between px-4 py-3 border-b border-ink-100">
              <span className="text-sm font-semibold text-ink-900">Avisos</span>
              <span className="text-xs text-ink-400">{total ? `${total} pendente${total > 1 ? 's' : ''}` : 'nada pendente'}</span>
            </div>
            {avisos.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-500 text-center">Tudo em dia.</p>
            ) : (
              <div className="divide-y divide-ink-100">
                {avisos.map(a => (
                  <button key={a.chave}
                    onClick={() => { setAberto(false); navigate(a.caminho) }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50 active:bg-ink-100 transition-colors">
                    <a.icone size={16} className="text-ink-400 shrink-0" strokeWidth={1.75} />
                    <span className="flex-1 text-sm text-ink-800">{a.rotulo}</span>
                    <span className={`text-sm font-semibold tnum ${a.urgente ? 'text-red-600' : 'text-amber-600'}`}>{a.n}</span>
                    <ChevronRight size={14} className="text-ink-300" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
