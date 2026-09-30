import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { formatDate, corDoAvatar } from '../../lib/utils'
import { buscarForaDaJornada, vinculosComJornada, diasDaPessoa, textoDoDesvio, horaMin, TOLERANCIA_MIN } from '../../lib/jornada'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DiaForaDaJornada } from '../../lib/jornada'

/**
 * Dias em que a pessoa trabalhou a menos ou a mais que a jornada do vínculo
 * (Fixo e Consultoria com salário fixo). O RH marca "Ciente" e o dia sai do
 * aviso; se ela corrigir o horário depois, o dia volta (migração 067).
 */
function AvisosJornada() {
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
      <p className="text-sm text-ink-500">Dias ainda não vistos · mês atual e anterior · tolerância de {TOLERANCIA_MIN} minutos.</p>

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

/**
 * Jornada de uma pessoa no mês: escolhe quem, vê cada dia registrado com o
 * feito × combinado. Só aparece quem tem jornada cadastrada no vínculo.
 */
function PorPessoa() {
  const navigate = useNavigate()
  const [pessoa, setPessoa] = useState('')
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))

  const { data: links = [], error: erroLinks } = useQuery({ queryKey: ['jornada-vinculos'], queryFn: vinculosComJornada })
  const pessoas = useMemo(() => Array.from(new Map(links.map(l => [l.employee_id, l.employee?.full_name || '—'])).entries())
    .sort((a, b) => a[1].localeCompare(b[1])), [links])

  const { data: dias = [], isLoading, error: erroDias } = useQuery({
    queryKey: ['jornada-pessoa', pessoa, mes, links.length],
    queryFn: () => diasDaPessoa(links, pessoa, mes),
    enabled: !!pessoa && links.length > 0,
  })

  const andarMes = (n: number) => setMes(m => {
    const [a, mm] = m.split('-').map(Number)
    const d = new Date(a, mm - 1 + n, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const nomeMes = new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const menos = dias.filter(d => d.desvio && (d.desvio.difMin < -TOLERANCIA_MIN || d.desvio.atrasoMin > TOLERANCIA_MIN || d.desvio.saidaCedoMin > TOLERANCIA_MIN))
  const mais = dias.filter(d => d.desvio && d.desvio.difMin > TOLERANCIA_MIN)
  const feitoTotal = dias.reduce((s, d) => s + d.feitoMin, 0)
  const combinadoTotal = dias.reduce((s, d) => s + d.jornada.minutos, 0)
  const saldo = feitoTotal - combinadoTotal
  const erro = erroLinks || erroDias

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input w-auto min-w-[16rem] text-sm" value={pessoa} onChange={e => setPessoa(e.target.value)}>
          <option value="">Escolha a pessoa…</option>
          {pessoas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
        <div className="flex items-center gap-1 card p-1">
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Mês anterior" onClick={() => andarMes(-1)}><ChevronLeft size={16} /></button>
          <span className="px-2 text-sm font-medium text-ink-800 min-w-[9rem] text-center first-letter:uppercase">{nomeMes}</span>
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Próximo mês" onClick={() => andarMes(1)}><ChevronRight size={16} /></button>
        </div>
        {pessoa && (
          <button className="btn-ghost text-xs" onClick={() => navigate(`/colaboradores/${pessoa}`)}>Abrir ficha</button>
        )}
      </div>

      {erro ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(erro as Error).message}</div>
      ) : !pessoa ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-ink-600">Escolha uma pessoa para ver a jornada do mês.</p>
          <p className="text-xs text-ink-400 mt-1">
            {pessoas.length} pessoa(s) com jornada cadastrada. Quem não aparece precisa de "Horas por dia" (ou horário) no vínculo.
          </p>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-ink-500">Carregando…</p>
      ) : dias.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-600">Nenhum dia registrado neste mês.</div>
      ) : (
        <>
          <div className="card grid grid-cols-2 sm:grid-cols-4 divide-x divide-ink-100 overflow-hidden">
            {([
              ['Dias registrados', String(dias.length), 'text-ink-900'],
              ['Abaixo da jornada', String(menos.length), menos.length ? 'text-amber-700' : 'text-ink-900'],
              ['Acima da jornada', String(mais.length), mais.length ? 'text-sky-700' : 'text-ink-900'],
              ['Saldo de horas', `${saldo < 0 ? '−' : saldo > 0 ? '+' : ''}${horaMin(Math.abs(saldo))}`, saldo < -TOLERANCIA_MIN ? 'text-amber-700' : 'text-ink-900'],
            ] as const).map(([t, v, c]) => (
              <div key={t} className="px-4 py-3">
                <p className="text-[11px] text-ink-500">{t}</p>
                <p className={`text-lg font-semibold tnum ${c}`}>{v}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden divide-y divide-ink-100">
            {dias.map(d => {
              const abaixo = !!d.desvio && (d.desvio.difMin < -TOLERANCIA_MIN || d.desvio.atrasoMin > TOLERANCIA_MIN || d.desvio.saidaCedoMin > TOLERANCIA_MIN)
              const acima = !!d.desvio && d.desvio.difMin > TOLERANCIA_MIN
              return (
                <div key={d.visitId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`dot shrink-0 ${abaixo ? 'bg-amber-500' : acima ? 'bg-sky-500' : 'bg-green-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-800">
                      <span className="font-medium tnum">{formatDate(d.data)}</span>
                      <span className="text-ink-500"> · {d.cliente}</span>
                      <span className="text-ink-400 tnum"> · {d.entrada}–{d.saida}</span>
                    </p>
                    <p className={`text-xs ${abaixo ? 'text-amber-700' : acima ? 'text-sky-700' : 'text-green-700'}`}>
                      {d.desvio ? textoDoDesvio(d.desvio, d.jornada) : `${horaMin(d.feitoMin)} de ${horaMin(d.jornada.minutos)} · dentro da jornada`}
                    </p>
                  </div>
                  {d.desvio && d.visto && <span className="text-[11px] text-ink-400">visto</span>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export default function JornadaPage() {
  const [aba, setAba] = useState<'pessoa' | 'avisos'>('pessoa')
  const { data: avisos = [] } = useQuery({ queryKey: ['jornada-fora'], queryFn: buscarForaDaJornada })
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow mb-1">Operação</p>
        <h1 className="page-title">Jornada</h1>
        <p className="text-sm text-ink-500 mt-1">Horas feitas × combinadas · Fixo e consultoria com salário fixo.</p>
      </div>
      <div className="flex gap-1 border-b border-ink-200">
        {([['pessoa', 'Por pessoa'], ['avisos', `Fora do combinado${avisos.length ? ` (${avisos.length})` : ''}`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setAba(k)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${aba === k ? 'border-primary-700 text-ink-900 font-medium' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {t}
          </button>
        ))}
      </div>
      {aba === 'pessoa' ? <PorPessoa /> : <AvisosJornada />}
    </div>
  )
}
