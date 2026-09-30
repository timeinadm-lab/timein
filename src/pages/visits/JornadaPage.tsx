import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { formatDate, corDoAvatar } from '../../lib/utils'
import { buscarForaDaJornada, textoDoDesvio, TOLERANCIA_MIN } from '../../lib/jornada'
import type { DiaForaDaJornada } from '../../lib/jornada'

/**
 * Dias em que a pessoa trabalhou a menos ou a mais que a jornada do vínculo
 * (Fixo e Consultoria com salário fixo). O RH marca "Ciente" e o dia sai do
 * aviso; se ela corrigir o horário depois, o dia volta (migração 067).
 */
export default function JornadaPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filtro, setFiltro] = useState<'todos' | 'menos' | 'mais'>('todos')

  const { data: dias = [], isLoading, error: erro } = useQuery({
    queryKey: ['jornada-fora'],
    queryFn: buscarForaDaJornada,
  })

  const ciente = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('nutritionist_visits')
        .update({ jornada_seen_at: new Date().toISOString() }).in('id', ids)
      if (error) throw new Error(/jornada_seen_at/.test(error.message) ? 'Falta rodar a migração 067 no Supabase.' : error.message)
    },
    onSuccess: (_d, ids) => {
      toast.success(ids.length > 1 ? `${ids.length} dias marcados como vistos` : 'Marcado como visto')
      qc.invalidateQueries({ queryKey: ['jornada-fora'] })
      qc.invalidateQueries({ queryKey: ['avisos-sino'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const abaixo = (d: DiaForaDaJornada) => d.desvio.difMin < -TOLERANCIA_MIN || d.desvio.atrasoMin > TOLERANCIA_MIN || d.desvio.saidaCedoMin > TOLERANCIA_MIN
  const visiveis = dias.filter(d => filtro === 'todos' || (filtro === 'menos' ? abaixo(d) : d.desvio.difMin > TOLERANCIA_MIN))

  // Agrupa por pessoa + cliente
  const grupos = useMemo(() => {
    const m = new Map<string, DiaForaDaJornada[]>()
    for (const d of visiveis) {
      const k = `${d.employeeId}|${d.clientId}`
      m.set(k, [...(m.get(k) || []), d])
    }
    return Array.from(m.values())
  }, [visiveis])

  const nMenos = dias.filter(abaixo).length
  const nMais = dias.filter(d => d.desvio.difMin > TOLERANCIA_MIN).length

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Operação</p>
        <h1 className="page-title">Jornada fora do combinado</h1>
        <p className="text-sm text-ink-500 mt-1">
          Fixo e consultoria com salário fixo · mês atual e anterior · tolerância de {TOLERANCIA_MIN} minutos.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([['todos', `Todos (${dias.length})`], ['menos', `A menos / atraso (${nMenos})`], ['mais', `A mais (${nMais})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${filtro === k ? 'bg-ink-900 text-white border-ink-900' : 'bg-white border-ink-200 text-ink-700 hover:bg-ink-50'}`}>
            {t}
          </button>
        ))}
      </div>

      {erro ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(erro as Error).message}</div>
      ) : isLoading ? (
        <p className="text-sm text-ink-500">Carregando…</p>
      ) : grupos.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-600">Nenhum dia fora da jornada.</p>
          <p className="text-xs text-ink-400 mt-1">Só entra aqui quem tem "Horas por dia" (ou horário) cadastrado no vínculo.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grupos.map(g => {
            const p = g[0]
            return (
              <div key={`${p.employeeId}|${p.clientId}`} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(p.pessoa)}`}>
                    {p.pessoa.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()}
                  </span>
                  <button className="flex-1 min-w-0 text-left" onClick={() => navigate(`/colaboradores/${p.employeeId}`)}>
                    <p className="text-sm font-semibold text-ink-900 truncate hover:underline">{p.pessoa}</p>
                    <p className="text-xs text-ink-500 truncate">
                      {p.cliente} · jornada {p.jornada.entrada && p.jornada.saida ? `${p.jornada.entrada}–${p.jornada.saida}` : `${p.jornada.minutos / 60}h por dia (horário livre)`}
                    </p>
                  </button>
                  {g.length > 1 && (
                    <button className="btn-secondary text-xs py-1.5" disabled={ciente.isPending}
                      onClick={() => ciente.mutate(g.map(d => d.visitId))}>Ciente em todos</button>
                  )}
                </div>
                <div className="divide-y divide-ink-100">
                  {g.map(d => (
                    <div key={d.visitId} className="flex items-center gap-3 px-4 py-2.5">
                      <span className={`dot shrink-0 ${abaixo(d) ? 'bg-amber-500' : 'bg-sky-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-800">
                          <span className="font-medium tnum">{formatDate(d.data)}</span>
                          <span className="text-ink-500 tnum"> · {d.entrada}–{d.saida}</span>
                        </p>
                        <p className={`text-xs ${abaixo(d) ? 'text-amber-700' : 'text-sky-700'}`}>{textoDoDesvio(d.desvio, d.jornada)}</p>
                      </div>
                      <button className="btn-ghost text-xs py-1.5" disabled={ciente.isPending}
                        onClick={() => ciente.mutate([d.visitId])}>Ciente</button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
