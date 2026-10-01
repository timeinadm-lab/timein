import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Search, FileDown, Save } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatDate, formatCurrency, corDoAvatar, hojeISO, semAcento, rotuloDoVinculo } from '../../lib/utils'
import { buscarForaDaJornada, textoDoDesvio, TOLERANCIA_MIN } from '../../lib/jornada'
import type { DiaForaDaJornada } from '../../lib/jornada'
import { resumoDoVinculo, textoDoResumo, vinculoNoMes } from '../../lib/jornadaPessoa'
import type { ResumoVinculo, StatusDia, VinculoPerfil, RegistroPerfil, AgendaPerfil, AvisoPerfil } from '../../lib/jornadaPessoa'
import { limitesDoMes } from '../../lib/pagamentosPorDia'
import { gerarPdfJornada } from '../../lib/jornadaPdf'
import { useAuth } from '../../contexts/AuthContext'
import { SignedLink } from '../../components/ui/SignedFile'

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
                  <button className="flex-1 min-w-0 text-left" onClick={() => navigate(`/jornada?pessoa=${p.employeeId}&mes=${p.data.slice(0, 7)}`)}>
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


// ════════════════════════════════════════════════════════════════════════
// Jornada por pessoa — o reflexo de tudo que a pessoa registra no portal
// (pedido do Gabriel, 01/10/2026). Lista de todas as pessoas do mês e o
// perfil de cada uma; Dashboard, Pagamentos e a ficha do colaborador abrem
// direto aqui (/jornada?pessoa=<id>&mes=<aaaa-mm>).
// ════════════════════════════════════════════════════════════════════════

type DadosMes = {
  links: (VinculoPerfil & { employee_id: string; employee?: { id: string; full_name?: string; status?: string; cpf?: string | null } | null })[]
  regs: (RegistroPerfil & { employee_id: string })[]
  agenda: (AgendaPerfil & { employee_id: string })[]
  avisos: (AvisoPerfil & { employee_id: string })[]
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const andarMes = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nomeDoMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const iniciais = (nome: string) => nome.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
const horasTxt = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`
const diaCurto = (ds: string) => `${ds.slice(8, 10)}/${ds.slice(5, 7)}`

/** Vínculos, registros, agenda e avisos do mês — de todos ou de uma pessoa */
async function carregarMes(mes: string, pessoa?: string): Promise<DadosMes> {
  const { inicio, fim } = limitesDoMes(mes)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const porPessoa = (q: any) => (pessoa ? q.eq('employee_id', pessoa) : q)
  const [linksR, regs, agenda, avisosR] = await Promise.all([
    porPessoa(supabase.from('employee_client_links').select('*, client:clients(name), employee:employees(id, full_name, status, cpf)')),
    fetchAll<DadosMes['regs'][number]>(() => porPessoa(supabase.from('nutritionist_visits')
      .select('id, employee_id, client_id, visit_date, check_in, check_out, break_start, break_end, is_extra, is_unavailable, is_holiday, is_swap, swapped_from, visit_rate, extra_approval, unit_name, observations, report_url, unavailability_reason, jornada_seen_at'))
      .gte('visit_date', inicio).lte('visit_date', fim).order('id')),
    fetchAll<DadosMes['agenda'][number]>(() => porPessoa(supabase.from('nutritionist_agenda').select('*'))
      .gte('planned_date', inicio).lte('planned_date', fim).order('id')),
    porPessoa(supabase.from('schedule_notices').select('*'))
      .or(`and(notice_date.gte.${inicio},notice_date.lte.${fim}),and(swap_work_date.gte.${inicio},swap_work_date.lte.${fim})`),
  ])
  if (linksR.error) throw new Error('Vínculos: ' + linksR.error.message)
  return {
    links: (linksR.data || []) as DadosMes['links'],
    regs, agenda,
    avisos: (avisosR.error ? [] : avisosR.data || []) as DadosMes['avisos'],
  }
}

function useNomesDeClientes() {
  const { data } = useQuery({
    queryKey: ['clientes-nomes'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name')
      return new Map((data || []).map(c => [c.id as string, c.name as string]))
    },
    staleTime: 5 * 60_000,
  })
  return (id?: string | null) => (id && data?.get(id)) || ''
}

/** Resumo de todos os vínculos de uma pessoa no mês */
function resumosDaPessoa(d: DadosMes, pessoa: string, mes: string, hoje: string, nomeCliente: (id?: string | null) => string): ResumoVinculo[] {
  const regs = d.regs.filter(r => r.employee_id === pessoa)
  const agenda = d.agenda.filter(a => a.employee_id === pessoa)
  const avisos = d.avisos.filter(a => a.employee_id === pessoa)
  return d.links
    .filter(l => l.employee_id === pessoa && vinculoNoMes(l, mes, regs))
    .map(l => resumoDoVinculo(l, mes, hoje, regs, agenda, avisos, nomeCliente))
    .sort((a, b) => nomeCliente(a.link.client_id).localeCompare(nomeCliente(b.link.client_id)))
}

const temAtencao = (r: ResumoVinculo) => r.faltas.length > 0 || r.trocasNaoVistas > 0 || r.abaixoJornada > 0 || r.semValor > 0

function rotuloVinculo(r: ResumoVinculo): string {
  const l = r.link
  const partes = [rotuloDoVinculo(l)]
  if (r.modo === 'escala') {
    const folgas = (l.days_off || []).slice().sort().map(d => DIAS_SEMANA[d]).join(' e ')
    partes.push(l.work_schedule_type === '12x36' ? '12x36' : `${l.work_schedule_type || 'escala'}${folgas ? ` · folga ${folgas}` : ''}`)
  }
  if (r.modo === 'agenda') partes.push(l.agenda_mode === 'gestor' ? 'agenda montada pelo RH' : 'agenda dela')
  if (r.jornada) {
    partes.push(`jornada ${horasTxt(r.jornada.minutos)}${r.jornada.entrada && r.jornada.saida ? ` (${r.jornada.entrada}–${r.jornada.saida})` : ''}${r.jornada.intervaloMin ? ` + ${horasTxt(r.jornada.intervaloMin)} intervalo` : ''}`)
  }
  return partes.join(' · ')
}

const COR_STATUS: Record<StatusDia, string> = {
  feito: 'bg-green-50 text-green-800 border-green-200',
  coberto: 'bg-sky-50 text-sky-800 border-sky-200',
  folga: 'bg-amber-50 text-amber-800 border-amber-200',
  extra: 'bg-violet-50 text-violet-800 border-violet-200',
  fora: 'bg-violet-50 text-violet-800 border-violet-200',
  faltou: 'bg-red-50 text-red-700 border-red-200',
  falta_registrada: 'bg-red-50 text-red-700 border-red-200',
  previsto: 'bg-ink-50 text-ink-600 border-ink-200',
}

// ── Lista de pessoas do mês ──────────────────────────────────────────────
function ListaPessoas({ mes, abrir, filtroInicial }: { mes: string; abrir: (id: string) => void; filtroInicial?: string | null }) {
  const hoje = hojeISO()
  const nomeCliente = useNomesDeClientes()
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'atencao' | 'faltas' | 'trocas'>(
    filtroInicial === 'trocas' || filtroInicial === 'faltas' || filtroInicial === 'atencao' ? filtroInicial : 'todos')
  const { data, isLoading, error } = useQuery({ queryKey: ['jornada-mes', mes], queryFn: () => carregarMes(mes) })

  const pessoas = useMemo(() => {
    if (!data) return []
    const ids = new Set(data.links.filter(l => l.employee?.status === 'Ativo').map(l => l.employee_id))
    for (const r of data.regs) ids.add(r.employee_id)
    return [...ids].map(id => {
      const emp = data.links.find(l => l.employee_id === id)?.employee
      const resumos = resumosDaPessoa(data, id, mes, hoje, nomeCliente)
      const soma = (f: (r: ResumoVinculo) => number) => resumos.reduce((s, r) => s + f(r), 0)
      const comPrevisto = resumos.filter(r => r.previstos != null)
      return {
        id, nome: emp?.full_name || 'Colaborador', resumos,
        previstos: comPrevisto.length ? soma(r => r.previstos || 0) : null,
        feitos: soma(r => r.feitos), extras: soma(r => r.extras), faltas: soma(r => r.faltas.length),
        trocas: soma(r => r.trocas), trocasNaoVistas: soma(r => r.trocasNaoVistas),
        abaixo: soma(r => r.abaixoJornada), semValor: soma(r => r.semValor), minutos: soma(r => r.minutos),
        atencao: resumos.some(temAtencao),
      }
    }).filter(p => p.resumos.length > 0)
      .sort((a, b) => Number(b.atencao) - Number(a.atencao) || b.faltas - a.faltas || a.nome.localeCompare(b.nome))
  }, [data, mes, hoje, nomeCliente])

  const termo = semAcento(busca.trim())
  const visiveis = pessoas.filter(p =>
    (!termo || semAcento(`${p.nome} ${p.resumos.map(r => nomeCliente(r.link.client_id)).join(' ')}`).includes(termo))
    && (filtro === 'todos' || (filtro === 'atencao' && p.atencao) || (filtro === 'faltas' && p.faltas > 0) || (filtro === 'trocas' && p.trocas > 0)))

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input className="input pl-9" placeholder="Buscar pessoa ou cliente…" value={busca} onChange={e => setBusca(e.target.value)} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
        {([
          ['todos', 'Todos', pessoas.length], ['atencao', 'Precisa de atenção', pessoas.filter(p => p.atencao).length],
          ['faltas', 'Com faltas', pessoas.filter(p => p.faltas > 0).length], ['trocas', 'Com trocas', pessoas.filter(p => p.trocas > 0).length],
        ] as const).map(([k, t, n]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filtro === k ? 'bg-ink-900 text-white' : 'bg-white border border-ink-200 text-ink-600'}`}>
            {t}<span className={`tnum rounded-full px-1.5 text-[10px] ${filtro === k ? 'bg-white/25' : 'bg-ink-100 text-ink-500'}`}>{n}</span>
          </button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">Ninguém por aqui com esse filtro.</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {visiveis.map(p => {
            const pct = p.previstos ? Math.min(100, Math.round((p.feitos / p.previstos) * 100)) : null
            const clientes = p.resumos.map(r => nomeCliente(r.link.client_id)).filter(Boolean)
            return (
              <button key={p.id} onClick={() => abrir(p.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/70 active:bg-ink-100">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(p.nome)}`}>{iniciais(p.nome)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{p.nome}</p>
                  <p className="text-xs text-ink-500 truncate">{clientes.length > 2 ? `${clientes.length} clientes` : clientes.join(' · ')}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {p.faltas > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-700">{p.faltas} falta{p.faltas > 1 ? 's' : ''}</span>}
                    {p.extras > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">+{p.extras} extra{p.extras > 1 ? 's' : ''}</span>}
                    {p.trocasNaoVistas > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-pink-50 text-pink-700">{p.trocasNaoVistas} troca{p.trocasNaoVistas > 1 ? 's' : ''} nova{p.trocasNaoVistas > 1 ? 's' : ''}</span>}
                    {p.abaixo > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{p.abaixo} abaixo da jornada</span>}
                    {p.semValor > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-700">{p.semValor} sem valor</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 w-24">
                  <p className="text-base font-semibold text-ink-900 tnum leading-tight">{p.previstos != null ? `${p.feitos}/${p.previstos}` : p.feitos}</p>
                  {pct != null && (
                    <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden mt-1">
                      <div className={`h-1.5 rounded-full ${p.faltas ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <p className="text-[10px] text-ink-400 mt-0.5">{p.minutos ? horasTxt(p.minutos) : ''}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Perfil de uma pessoa no mês ──────────────────────────────────────────
function PerfilJornada({ pessoa, mes, voltar }: { pessoa: string; mes: string; voltar: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile } = useAuth()
  const hoje = hojeISO()
  const nomeCliente = useNomesDeClientes()
  const { inicio, fim } = limitesDoMes(mes)
  const [filtroDia, setFiltroDia] = useState<'todos' | 'faltas' | 'extras' | 'trocas' | 'jornada'>('todos')
  const [gerando, setGerando] = useState<'' | 'pdf' | 'salvar'>('')

  const { data, isLoading, error } = useQuery({ queryKey: ['jornada-pessoa', pessoa, mes], queryFn: () => carregarMes(mes, pessoa) })
  const { data: emp } = useQuery({
    queryKey: ['jornada-emp', pessoa],
    queryFn: async () => {
      const { data } = await supabase.from('employees').select('id, full_name, cpf, status').eq('id', pessoa).maybeSingle()
      return data as { id: string; full_name: string; cpf?: string | null; status?: string } | null
    },
  })
  const { data: reembolsos = [] } = useQuery({
    queryKey: ['jornada-reembolsos', pessoa],
    queryFn: async () => {
      const { data } = await supabase.from('employee_expenses').select('*').eq('employee_id', pessoa).order('created_at', { ascending: false }).limit(200)
      return (data || []) as { id: string; created_at?: string; reference_month?: string; description?: string; category?: string; amount?: number; status?: string; receipt_url?: string | null; client_id?: string | null }[]
    },
  })
  const { data: pagamentos = [] } = useQuery({
    queryKey: ['payments', 'jornada', pessoa, mes],
    queryFn: async () => {
      const { data } = await supabase.from('payments').select('*').eq('employee_id', pessoa).neq('status', 'Cancelado')
        .or(`reference_month.eq.${mes},and(reference_month.is.null,due_date.gte.${inicio},due_date.lte.${fim})`).order('due_date')
      return (data || []) as { id: string; description?: string; amount?: number; due_date: string; status: string; type?: string }[]
    },
  })
  const { data: historico, error: erroHist } = useQuery({
    queryKey: ['jornada-historico', pessoa],
    queryFn: async () => {
      const { data, error } = await supabase.from('jornada_historico').select('*').eq('employee_id', pessoa).order('criado_em', { ascending: false })
      if (error) throw error
      return (data || []) as { id: string; mes: string; arquivo: string; criado_em: string; resumo?: { texto?: string } | null }[]
    },
  })

  const resumos = data ? resumosDaPessoa(data, pessoa, mes, hoje, nomeCliente) : []
  const nome = emp?.full_name || data?.links[0]?.employee?.full_name || 'Colaborador'
  const varios = resumos.length > 1
  const dias = resumos.flatMap(r => r.dias).sort((a, b) => a.data.localeCompare(b.data))
  const diasFiltrados = dias.filter(d => filtroDia === 'todos'
    || (filtroDia === 'faltas' && (d.status === 'faltou' || d.status === 'falta_registrada'))
    || (filtroDia === 'extras' && (d.status === 'extra' || d.status === 'fora'))
    || (filtroDia === 'trocas' && !!d.troca)
    || (filtroDia === 'jornada' && !!d.desvio))
  const reembolsosMes = reembolsos.filter(e => (e.reference_month || (e.created_at || '').slice(0, 7)) === mes)
  const totalPagamentos = pagamentos.reduce((s, p) => s + (Number(p.amount) || 0), 0)

  const invalidar = () => {
    for (const k of ['jornada-pessoa', 'jornada-mes', 'jornada-fora', 'avisos-sino', 'dashboard-jornada']) qc.invalidateQueries({ queryKey: [k] })
  }
  const cienteTroca = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('nutritionist_agenda').update({ change_seen_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Troca marcada como vista'); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })
  const cienteJornada = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('nutritionist_visits').update({ jornada_seen_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Marcado como visto'); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })

  const montarPdf = async () => gerarPdfJornada({
    nome, cpf: emp?.cpf, nomeMes: nomeDoMes(mes), resumos, nomeCliente, rotuloVinculo,
    reembolsos: reembolsosMes.map(e => ({
      data: (e.created_at || '').slice(0, 10), descricao: e.description || '', categoria: e.category || '',
      valor: Number(e.amount) || 0, situacao: e.status === 'pendente' ? 'Para analisar' : e.status === 'negado' ? 'Negado' : 'Aprovado',
    })),
    pagamentos: pagamentos.map(p => ({ vencimento: p.due_date, descricao: p.description || '', valor: Number(p.amount) || 0, situacao: p.status })),
    geradoPor: profile?.full_name,
  })
  const nomeArquivo = `jornada_${semAcento(nome).replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${mes}.pdf`
  const baixarPdf = async () => {
    setGerando('pdf')
    try {
      const blob = await montarPdf()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = nomeArquivo; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) { toast.error('Não consegui gerar o PDF: ' + (e as Error).message) } finally { setGerando('') }
  }
  const salvarNoHistorico = async () => {
    setGerando('salvar')
    try {
      const blob = await montarPdf()
      const caminho = `jornadas/${pessoa}/${mes}_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('arquivos').upload(caminho, blob, { contentType: 'application/pdf', upsert: false })
      if (upErr) throw upErr
      const { error } = await supabase.from('jornada_historico').insert({
        employee_id: pessoa, mes, arquivo: caminho, criado_por: profile?.id ?? null,
        resumo: { texto: resumos.map(r => `${nomeCliente(r.link.client_id)}: ${textoDoResumo(r)}`).join(' · '), faltas: resumos.reduce((s, r) => s + r.faltas.length, 0) },
      })
      if (error) throw new Error(/jornada_historico/.test(error.message) ? 'Falta rodar a migração 073 no Supabase.' : error.message)
      toast.success('PDF salvo no histórico da pessoa')
      qc.invalidateQueries({ queryKey: ['jornada-historico', pessoa] })
    } catch (e) { toast.error((e as Error).message) } finally { setGerando('') }
  }

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>

  return (
    <div className="space-y-4">
      {/* Pessoa + ações */}
      <div className="card p-4 flex items-start gap-3 flex-wrap">
        <button onClick={voltar} className="btn-ghost p-2 -ml-2 shrink-0" aria-label="Todas as pessoas"><ChevronLeft size={18} /></button>
        <span className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${corDoAvatar(nome)}`}>{iniciais(nome)}</span>
        <div className="flex-1 min-w-[10rem]">
          <p className="text-lg font-semibold text-ink-900 leading-tight">{nome}</p>
          <p className="text-xs text-ink-500 mt-0.5">
            {resumos.length} vínculo{resumos.length !== 1 ? 's' : ''} no mês
            {emp?.status && emp.status !== 'Ativo' && <span className="text-red-600"> · {emp.status}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary text-sm" onClick={() => navigate(`/colaboradores/${pessoa}`)}>Ficha</button>
          <button className="btn-secondary text-sm" onClick={() => navigate(`/pagamentos?mes=${mes}`)}>Pagamentos</button>
          <button className="btn-secondary text-sm" disabled={!!gerando || isLoading} onClick={baixarPdf}><FileDown size={15} />{gerando === 'pdf' ? 'Gerando…' : 'PDF'}</button>
          <button className="btn-primary text-sm" disabled={!!gerando || isLoading} onClick={salvarNoHistorico}><Save size={15} />{gerando === 'salvar' ? 'Salvando…' : 'Salvar no histórico'}</button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : resumos.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">Nenhum vínculo nem registro em {nomeDoMes(mes)}.</div>
      ) : (
        <>
          {/* Um cartão por vínculo: previsto × feito */}
          <div className={`grid gap-3 ${varios ? 'md:grid-cols-2' : ''}`}>
            {resumos.map(r => {
              const pct = r.previstos ? Math.min(100, Math.round((r.feitos / r.previstos) * 100)) : null
              const l = r.link
              const salario = Number(l.monthly_amount) || 0
              const ajuda = Number(l.cost_assistance) || 0
              return (
                <div key={l.id} className={`card p-4 space-y-3 ${temAtencao(r) ? 'border-amber-200' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900 truncate">{nomeCliente(l.client_id) || 'Cliente'}</p>
                      <p className="text-[11px] text-ink-500 mt-0.5">{rotuloVinculo(r)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-semibold text-ink-900 tnum leading-none">
                        {r.feitos}{r.previstos != null && <span className="text-base text-ink-400 font-normal"> de {r.previstos}</span>}
                      </p>
                      <p className="text-[11px] text-ink-500 mt-1">{r.unidade}{r.extras > 0 && <span className="text-violet-700 font-medium"> + {r.extras} {r.modo === 'agenda' ? 'fora da agenda' : 'extra'}</span>}</p>
                    </div>
                  </div>
                  {pct != null && (
                    <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                      <div className={`h-2 rounded-full ${r.faltas.length ? 'bg-amber-500' : 'bg-primary-600'}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {r.faltas.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">{r.faltas.length} {r.unidade === 'visitas' ? 'não registrada' : 'sem registro'}{r.faltas.length > 1 ? 's' : ''}: {r.faltas.map(diaCurto).join(', ')}</span>}
                    {r.restantes > 0 && <span className="px-2 py-0.5 rounded-full bg-ink-100 text-ink-600">{r.restantes} por vir</span>}
                    {r.trocas > 0 && <span className="px-2 py-0.5 rounded-full bg-pink-50 text-pink-700">{r.trocas} troca{r.trocas > 1 ? 's' : ''}{r.trocasNaoVistas ? ` · ${r.trocasNaoVistas} nova${r.trocasNaoVistas > 1 ? 's' : ''}` : ''}</span>}
                    {r.minutos > 0 && <span className="px-2 py-0.5 rounded-full bg-ink-100 text-ink-600">{horasTxt(r.minutos)} no mês</span>}
                    {r.abaixoJornada > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">{r.abaixoJornada} abaixo da jornada</span>}
                    {r.acimaJornada > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-800">{r.acimaJornada} acima da jornada</span>}
                    {r.semValor > 0 && <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">{r.semValor} visita{r.semValor > 1 ? 's' : ''} sem valor</span>}
                  </div>
                  <div className="text-xs text-ink-600 border-t border-ink-100 pt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {salario > 0 && <span>Salário <strong className="tnum">{formatCurrency(salario)}</strong></span>}
                    {ajuda > 0 && <span>Ajuda de custo <strong className="tnum">{formatCurrency(ajuda)}</strong></span>}
                    {r.valorVisitas > 0 && <span>Visitas registradas <strong className="tnum">{formatCurrency(r.valorVisitas)}</strong></span>}
                    {salario <= 0 && r.valorVisitas <= 0 && ajuda <= 0 && <span className="text-ink-400">Sem valor definido no vínculo</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Dia a dia */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 space-y-2">
              <p className="text-sm font-semibold text-ink-900">Dia a dia</p>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
                {([
                  ['todos', 'Todos', dias.length],
                  ['faltas', 'Faltas', dias.filter(d => d.status === 'faltou' || d.status === 'falta_registrada').length],
                  ['extras', 'Extras', dias.filter(d => d.status === 'extra' || d.status === 'fora').length],
                  ['trocas', 'Trocas', dias.filter(d => d.troca).length],
                  ['jornada', 'Fora da jornada', dias.filter(d => d.desvio).length],
                ] as const).map(([k, t, n]) => (
                  <button key={k} onClick={() => setFiltroDia(k)}
                    className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap ${filtroDia === k ? 'bg-ink-900 text-white' : 'bg-white border border-ink-200 text-ink-600'}`}>
                    {t} <span className="opacity-60 tnum">{n}</span>
                  </button>
                ))}
              </div>
            </div>
            {diasFiltrados.length === 0 ? <p className="px-4 py-6 text-sm text-ink-500 text-center">Nada aqui.</p> : (
              <div className="divide-y divide-ink-100">
                {diasFiltrados.map((d, i) => (
                  <div key={`${d.data}-${d.linkId}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="w-11 shrink-0 text-center">
                      <p className="text-sm font-semibold text-ink-900 tnum leading-none">{d.data.slice(8, 10)}</p>
                      <p className="text-[10px] text-ink-400 mt-0.5">{DIAS_SEMANA[new Date(d.data + 'T12:00:00').getDay()]}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${COR_STATUS[d.status]}`}>{d.titulo}</span>
                        {varios && <span className="text-xs text-ink-500 truncate">{nomeCliente(d.clientId)}</span>}
                        {d.troca && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-pink-50 text-pink-700">troca</span>}
                      </div>
                      {d.detalhe && <p className="text-xs text-ink-600 mt-0.5">{d.detalhe}</p>}
                      {d.desvio && (() => {
                        const j = resumos.find(r => r.link.id === d.linkId)?.jornada
                        return j ? <p className="text-xs text-amber-700 mt-0.5">{textoDoDesvio(d.desvio, j)}</p> : null
                      })()}
                      {d.registro?.observations && <p className="text-[11px] text-ink-400 mt-0.5 italic">"{d.registro.observations}"</p>}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {d.trocaNaoVista && d.agenda && (
                        <button className="btn-secondary text-[11px] py-1 px-2" disabled={cienteTroca.isPending} onClick={() => cienteTroca.mutate(d.agenda!.id)}>Ciente da troca</button>
                      )}
                      {d.desvio && d.registro && !d.registro.jornada_seen_at && (
                        <button className="btn-ghost text-[11px] py-1 px-2" disabled={cienteJornada.isPending} onClick={() => cienteJornada.mutate(d.registro!.id)}>Ciente</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Pagamentos do mês */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink-900">Pagamentos de {nomeDoMes(mes)}</p>
          {pagamentos.length > 0 && <p className="text-sm font-semibold text-ink-900 tnum">{formatCurrency(totalPagamentos)}</p>}
        </div>
        {pagamentos.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-500">Nada lançado ainda. <button className="underline" onClick={() => navigate(`/pagamentos?mes=${mes}`)}>Abrir Pagamentos</button></p>
        ) : (
          <div className="divide-y divide-ink-100">
            {pagamentos.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-800 truncate">{p.description}</p>
                  <p className="text-[11px] text-ink-500">vence {formatDate(p.due_date)}</p>
                </div>
                <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(Number(p.amount) || 0)}</p>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${p.status === 'Pago' ? 'bg-green-50 text-green-700' : p.due_date < hoje ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {p.status === 'Pago' ? 'Pago' : p.due_date < hoje ? 'Atrasado' : 'A pagar'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reembolsos: histórico completo, o mês em destaque */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-sm font-semibold text-ink-900">Reembolsos <span className="text-xs font-normal text-ink-400">· histórico de pedidos</span></p>
        </div>
        {reembolsos.length === 0 ? <p className="px-4 py-4 text-sm text-ink-500">Nenhum pedido de reembolso.</p> : (
          <div className="divide-y divide-ink-100">
            {reembolsos.slice(0, 30).map(e => {
              const doMes = (e.reference_month || (e.created_at || '').slice(0, 7)) === mes
              return (
                <div key={e.id} className={`flex items-center gap-3 px-4 py-2.5 ${doMes ? 'bg-primary-50/40' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-800 truncate">{e.description || e.category}</p>
                    <p className="text-[11px] text-ink-500">{e.created_at ? formatDate(e.created_at.slice(0, 10)) : ''}{e.category ? ` · ${e.category}` : ''}{doMes ? ' · deste mês' : ''}</p>
                  </div>
                  {e.receipt_url && <SignedLink value={e.receipt_url} bucket="arquivos" className="text-[11px] underline text-ink-500">nota</SignedLink>}
                  <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(Number(e.amount) || 0)}</p>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${e.status === 'pendente' ? 'bg-amber-50 text-amber-700' : e.status === 'negado' ? 'bg-ink-100 text-ink-500' : 'bg-green-50 text-green-700'}`}>
                    {e.status === 'pendente' ? 'Para analisar' : e.status === 'negado' ? 'Negado' : 'Aprovado'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Histórico de PDFs salvos */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100">
          <p className="text-sm font-semibold text-ink-900">Histórico salvo</p>
        </div>
        {erroHist ? (
          <p className="px-4 py-4 text-sm text-amber-700">Para salvar o histórico, rode a migração 073 no Supabase.</p>
        ) : !historico?.length ? (
          <p className="px-4 py-4 text-sm text-ink-500">Nenhum PDF salvo ainda. Use "Salvar no histórico" para guardar o mês.</p>
        ) : (
          <div className="divide-y divide-ink-100">
            {historico.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-800 first-letter:uppercase">{nomeDoMes(h.mes)}</p>
                  <p className="text-[11px] text-ink-500 truncate">salvo em {new Date(h.criado_em).toLocaleString('pt-BR')}{h.resumo?.texto ? ` · ${h.resumo.texto}` : ''}</p>
                </div>
                <SignedLink value={h.arquivo} bucket="arquivos" className="btn-secondary text-xs py-1.5">Abrir</SignedLink>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function JornadaPage() {
  const [params, setParams] = useSearchParams()
  const pessoa = params.get('pessoa') || ''
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') || '') ? params.get('mes')! : hojeISO().slice(0, 7)
  const aba = params.get('aba') === 'avisos' ? 'avisos' : 'pessoas'
  const ir = (mudar: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudar)) { if (v) p.set(k, v); else p.delete(k) }
    setParams(p)
  }
  const { data: avisos = [] } = useQuery({ queryKey: ['jornada-fora'], queryFn: buscarForaDaJornada })

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Operação</p>
          <h1 className="page-title">Jornada</h1>
          <p className="text-sm text-ink-500 mt-1">Tudo o que cada pessoa registra no portal: previsto × feito, trocas, horas, reembolsos e pagamentos.</p>
        </div>
        <div className="flex items-center gap-1 card p-1">
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Mês anterior" onClick={() => ir({ mes: andarMes(mes, -1) })}><ChevronLeft size={16} /></button>
          <span className="px-2 text-sm font-medium text-ink-800 min-w-[9rem] text-center first-letter:uppercase">{nomeDoMes(mes)}</span>
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Próximo mês" onClick={() => ir({ mes: andarMes(mes, 1) })}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="flex gap-1 border-b border-ink-200">
        {([['pessoas', 'Pessoas'], ['avisos', `Fora do combinado${avisos.length ? ` (${avisos.length})` : ''}`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => ir({ aba: k === 'avisos' ? 'avisos' : null })}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${aba === k ? 'border-primary-700 text-ink-900 font-medium' : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {t}
          </button>
        ))}
      </div>
      {aba === 'avisos' ? <AvisosJornada />
        : pessoa ? <PerfilJornada pessoa={pessoa} mes={mes} voltar={() => ir({ pessoa: null })} />
        : <ListaPessoas mes={mes} abrir={id => ir({ pessoa: id, filtro: null })} filtroInicial={params.get('filtro')} />}
    </div>
  )
}
