import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ChevronLeft, ChevronRight, Check, X, CalendarClock, UserRound, Trash2, Search } from 'lucide-react'
import { format, addDays, startOfMonth, endOfMonth, getDaysInMonth } from 'date-fns'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, hojeISO, getInitials, corDoAvatar, semAcento } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'

/**
 * Supervisão = agenda interna da equipe (migração 059).
 * Qualquer pessoa com acesso ao sistema pode ser responsável. Cada supervisão
 * tem cliente, dia e responsável — sem horário. No dia, check-in ("foi").
 * Se não foi: fica registrada como não realizada e pode ser remarcada (vira
 * uma nova supervisão ligada à anterior), trocar o responsável ou ser excluída.
 */

type Status = 'agendada' | 'realizada' | 'nao_realizada'
type Supervisao = {
  id: string
  client_id: string | null
  supervisor_id: string | null
  visit_date: string
  observations: string | null
  status?: Status
  checked_in_at?: string | null
  checked_in_by?: string | null
  motivo_nao_realizada?: string | null
  remarcada_de?: string | null
}

const STATUS_INFO: Record<Status, { rotulo: string; dot: string; texto: string }> = {
  agendada: { rotulo: 'Agendada', dot: 'bg-amber-500', texto: 'text-amber-700' },
  realizada: { rotulo: 'Realizada', dot: 'bg-green-600', texto: 'text-green-700' },
  nao_realizada: { rotulo: 'Não realizada', dot: 'bg-red-600', texto: 'text-red-600' },
}

export default function SupervisionDashboard() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const hoje = hojeISO()
  const [mes, setMes] = useState(format(new Date(), 'yyyy-MM'))
  const [filtroResp, setFiltroResp] = useState<string>('') // '' = todos
  const [novo, setNovo] = useState<{ client_id: string; visit_date: string; supervisor_id: string; observations: string } | null>(null)
  const [buscaCliente, setBuscaCliente] = useState('')
  const [aberta, setAberta] = useState<Supervisao | null>(null)
  const [naoFoi, setNaoFoi] = useState<{ sup: Supervisao; motivo: string; remarcar: boolean; nova_data: string; novo_resp: string } | null>(null)
  // Meta editada aqui mesmo (grava no "Visitas/mês" do cliente)
  const [editMeta, setEditMeta] = useState<{ id: string; valor: string } | null>(null)
  const [novaMeta, setNovaMeta] = useState<{ client_id: string; valor: string } | null>(null)

  const inicioMes = format(startOfMonth(new Date(mes + '-15')), 'yyyy-MM-dd')
  const fimMes = format(endOfMonth(new Date(mes + '-15')), 'yyyy-MM-dd')
  const nomeMes = new Date(mes + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const { data: equipe } = useQuery({
    queryKey: ['user-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id,full_name').order('full_name')
      if (error) throw error
      return data || []
    },
  })
  const { data: clientes } = useQuery({
    queryKey: ['supervisao-clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name,supervision_visits_per_month').order('name')
      if (error) throw error
      return data || []
    },
  })

  // Supervisões do mês na tela + as agendadas que já passaram sem resposta (de qualquer mês)
  const { data: supervisoes, isLoading } = useQuery({
    queryKey: ['supervisoes', mes],
    queryFn: async () => {
      const [doMes, pendentes] = await Promise.all([
        supabase.from('supervision_visits').select('*').gte('visit_date', inicioMes).lte('visit_date', fimMes).order('visit_date'),
        supabase.from('supervision_visits').select('*').eq('status', 'agendada').lt('visit_date', hoje).order('visit_date'),
      ])
      if (doMes.error) throw doMes.error
      const lista = (doMes.data || []) as Supervisao[]
      // Sem a migração 059 não existe status: o histórico conta como realizado
      const extras = pendentes.error ? [] : (pendentes.data || []) as Supervisao[]
      const vistos = new Set(lista.map(s => s.id))
      return [...lista, ...extras.filter(s => !vistos.has(s.id))]
        .map(s => ({ ...s, status: (s.status || 'realizada') as Status }))
    },
  })

  const nomePessoa = (id?: string | null) => (equipe || []).find(p => p.id === id)?.full_name || 'Sem responsável'
  const nomeCliente = (id?: string | null) => (clientes || []).find(c => c.id === id)?.name || 'Cliente'
  const primeiroNome = (id?: string | null) => nomePessoa(id).split(' ')[0]

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['supervisoes'] })
    qc.invalidateQueries({ queryKey: ['avisos-sino'] })
  }
  const erroMigracao = (e: Error) => toast.error(/status|checked_in|remarcada|created_by|column/i.test(e.message)
    ? 'Falta rodar a migração 059 no Supabase.' : e.message)

  const criar = useMutation({
    mutationFn: async () => {
      if (!novo?.client_id) throw new Error('Escolha o cliente')
      if (!novo.visit_date) throw new Error('Escolha o dia')
      if (!novo.supervisor_id) throw new Error('Escolha o responsável')
      const { error } = await supabase.from('supervision_visits').insert({
        client_id: novo.client_id, visit_date: novo.visit_date, supervisor_id: novo.supervisor_id,
        observations: novo.observations.trim() || null, status: 'agendada', created_by: user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Supervisão agendada'); setNovo(null); setBuscaCliente(''); invalidar() },
    onError: erroMigracao,
  })

  const atualizar = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from('supervision_visits').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidar() },
    onError: erroMigracao,
  })

  const checkIn = (s: Supervisao) => atualizar.mutate(
    { id: s.id, patch: { status: 'realizada', checked_in_at: new Date().toISOString(), checked_in_by: user?.id ?? null, motivo_nao_realizada: null } },
    { onSuccess: () => { toast.success(`Check-in feito: ${nomeCliente(s.client_id)}`); setAberta(null) } },
  )

  const registrarNaoFoi = useMutation({
    mutationFn: async () => {
      if (!naoFoi) return
      const { sup } = naoFoi
      if (naoFoi.remarcar && !naoFoi.nova_data) throw new Error('Escolha o novo dia')
      const { error } = await supabase.from('supervision_visits').update({
        status: 'nao_realizada', motivo_nao_realizada: naoFoi.motivo.trim() || null,
        checked_in_at: null, checked_in_by: null,
      }).eq('id', sup.id)
      if (error) throw error
      // Remarcar = nova supervisão ligada à que não aconteceu (a original fica
      // registrada como "não realizada" — é o histórico)
      if (naoFoi.remarcar) {
        const { error: e2 } = await supabase.from('supervision_visits').insert({
          client_id: sup.client_id, visit_date: naoFoi.nova_data,
          supervisor_id: naoFoi.novo_resp || sup.supervisor_id,
          observations: sup.observations, status: 'agendada', remarcada_de: sup.id, created_by: user?.id ?? null,
        })
        if (e2) throw e2
      }
    },
    onSuccess: () => {
      toast.success(naoFoi?.remarcar ? `Remarcada para ${formatDate(naoFoi.nova_data)}` : 'Registrada como não realizada')
      setNaoFoi(null); setAberta(null); invalidar()
    },
    onError: erroMigracao,
  })

  const excluir = async (s: Supervisao) => {
    if (!(await confirmar({ titulo: 'Excluir esta supervisão?', texto: `${nomeCliente(s.client_id)} · ${formatDate(s.visit_date)}`, perigo: true }))) return
    const { error } = await supabase.from('supervision_visits').delete().eq('id', s.id)
    if (error) { toast.error(error.message); return }
    toast.success('Supervisão excluída'); setAberta(null); invalidar()
  }

  const lista = (supervisoes || []).filter(s => !filtroResp || s.supervisor_id === filtroResp)
  const semResposta = lista.filter(s => s.status === 'agendada' && s.visit_date < hoje)
  const deHoje = lista.filter(s => s.status === 'agendada' && s.visit_date === hoje)
  const proximas = lista.filter(s => s.status === 'agendada' && s.visit_date > hoje && s.visit_date <= fimMes)
  const feitas = lista.filter(s => s.status !== 'agendada' && s.visit_date >= inicioMes && s.visit_date <= fimMes)
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))

  // Meta por cliente (Visitas/mês do cadastro do cliente)
  const metas = (clientes || []).filter(c => (c.supervision_visits_per_month || 0) > 0).map(c => {
    const doCliente = (supervisoes || []).filter(s => s.client_id === c.id && s.visit_date >= inicioMes && s.visit_date <= fimMes)
    return {
      id: c.id, nome: c.name, meta: c.supervision_visits_per_month || 0,
      realizadas: doCliente.filter(s => s.status === 'realizada').length,
      agendadas: doCliente.filter(s => s.status === 'agendada').length,
    }
  })

  // A meta é a quantidade de supervisões por mês do cliente. A equipe define
  // aqui; o "feito" enche sozinho com os check-ins do mês.
  const salvarMeta = useMutation({
    mutationFn: async ({ ids, valor }: { ids: string[]; valor: number | null }) => {
      const { error } = await supabase.from('clients').update({ supervision_visits_per_month: valor }).in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supervisao-clientes'] })
      setEditMeta(null); setNovaMeta(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const gravarMeta = (id: string, texto: string) => {
    const n = Math.round(Number(texto))
    if (!texto.trim() || !Number.isFinite(n) || n < 0) { toast.error('Digite um número'); return }
    salvarMeta.mutate({ ids: [id], valor: n > 0 ? n : null })
  }

  const clientesFiltrados = useMemo(() => {
    const q = semAcento(buscaCliente.trim())
    return (clientes || []).filter(c => !q || semAcento(c.name || '').includes(q))
  }, [clientes, buscaCliente])

  const abrirNovo = (data?: string) => setNovo({ client_id: '', visit_date: data || hoje, supervisor_id: user?.id || '', observations: '' })

  // ── Linha de supervisão (lista) ──
  const Linha = ({ s }: { s: Supervisao }) => {
    const info = STATUS_INFO[s.status || 'realizada']
    const atrasada = s.status === 'agendada' && s.visit_date < hoje
    return (
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50/60 cursor-pointer" onClick={() => setAberta(s)}>
        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${corDoAvatar(nomePessoa(s.supervisor_id))}`}
          title={nomePessoa(s.supervisor_id)}>
          {getInitials(nomePessoa(s.supervisor_id))}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink-900 truncate">{nomeCliente(s.client_id)}</p>
          <p className="text-xs text-ink-500 truncate">
            {formatDate(s.visit_date)} · {primeiroNome(s.supervisor_id)}
            {s.remarcada_de && <span className="text-ink-400"> · remarcada</span>}
          </p>
        </div>
        {s.status === 'agendada' && s.visit_date <= hoje ? (
          <button onClick={e => { e.stopPropagation(); checkIn(s) }} className="btn-secondary text-xs py-1.5 px-3 shrink-0">
            <Check size={14} /> Check-in
          </button>
        ) : (
          <span className={`text-xs font-medium flex items-center gap-1.5 shrink-0 ${atrasada ? 'text-red-600' : info.texto}`}>
            <span className={`dot ${info.dot}`} />{info.rotulo}
          </span>
        )}
      </div>
    )
  }

  // ── Calendário do mês ──
  const diasNoMes = getDaysInMonth(new Date(mes + '-15'))
  const primeiroDiaSemana = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1).getDay()

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Qualidade</p>
          <h1 className="page-title">Supervisão</h1>
          <p className="text-sm text-ink-500 mt-1">Agenda interna da equipe: cliente, dia e quem vai.</p>
        </div>
        <button onClick={() => abrirNovo()} className="btn-primary text-sm"><Plus size={16} /> Agendar supervisão</button>
      </div>

      {/* Mês + filtro de responsável */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 card p-1">
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Mês anterior"
            onClick={() => setMes(m => format(addDays(new Date(m + '-15'), -30), 'yyyy-MM'))}><ChevronLeft size={18} /></button>
          <span className="px-2 text-sm font-medium text-ink-800 min-w-[9.5rem] text-center first-letter:uppercase">{nomeMes}</span>
          <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Próximo mês"
            onClick={() => setMes(m => format(addDays(new Date(m + '-15'), 30), 'yyyy-MM'))}><ChevronRight size={18} /></button>
        </div>
        <select className="input w-auto text-sm" value={filtroResp} onChange={e => setFiltroResp(e.target.value)}>
          <option value="">Toda a equipe</option>
          {user?.id && <option value={user.id}>Só as minhas</option>}
          {(equipe || []).filter(p => p.id !== user?.id).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </div>

      {/* O que precisa de resposta */}
      {semResposta.length > 0 && (
        <section>
          <h2 className="section-title mb-2 text-red-700">Sem resposta <span className="font-normal text-ink-400 tnum">{semResposta.length}</span></h2>
          <p className="text-xs text-ink-500 mb-2">O dia passou e ninguém deu check-in. Foi feita? Toque para responder.</p>
          <div className="card divide-y divide-ink-100 overflow-hidden border-red-200">
            {semResposta.map(s => <Linha key={s.id} s={s} />)}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Calendário */}
        <section className="lg:col-span-3 card p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-400 mb-1">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: primeiroDiaSemana }).map((_, i) => <div key={'b' + i} />)}
            {Array.from({ length: diasNoMes }).map((_, i) => {
              const ds = `${mes}-${String(i + 1).padStart(2, '0')}`
              const doDia = lista.filter(s => s.visit_date === ds)
              const ehHoje = ds === hoje
              return (
                <button key={ds} onClick={() => doDia.length === 1 ? setAberta(doDia[0]) : abrirNovo(ds)}
                  title={doDia.length ? doDia.map(s => `${nomeCliente(s.client_id)} · ${primeiroNome(s.supervisor_id)}`).join('\n') : 'Agendar neste dia'}
                  className={`min-h-[3.25rem] sm:min-h-[4.5rem] rounded-lg border p-1 text-left align-top transition-colors hover:bg-ink-50 ${ehHoje ? 'border-primary-600' : 'border-ink-100'}`}>
                  <span className={`text-[11px] ${ehHoje ? 'text-primary-700 font-semibold' : 'text-ink-500'}`}>{i + 1}</span>
                  <div className="mt-0.5 space-y-0.5">
                    {doDia.slice(0, 3).map(s => {
                      const info = STATUS_INFO[s.status || 'realizada']
                      return (
                        <span key={s.id} className="flex items-center gap-1 min-w-0">
                          <span className={`dot ${s.status === 'agendada' && s.visit_date < hoje ? 'bg-red-600' : info.dot}`} />
                          <span className="hidden sm:block text-[10px] text-ink-700 truncate">{nomeCliente(s.client_id)}</span>
                        </span>
                      )
                    })}
                    {doDia.length > 3 && <span className="text-[10px] text-ink-400">+{doDia.length - 3}</span>}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-ink-500">
            <span className="flex items-center gap-1.5"><span className="dot bg-amber-500" />Agendada</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-green-600" />Realizada</span>
            <span className="flex items-center gap-1.5"><span className="dot bg-red-600" />Não realizada / sem resposta</span>
            <span className="text-ink-400">Toque num dia vazio para agendar</span>
          </div>
        </section>

        {/* Listas */}
        <div className="lg:col-span-2 space-y-5">
          <section>
            <h2 className="section-title mb-2">Hoje <span className="font-normal text-ink-400 tnum">{deHoje.length}</span></h2>
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {deHoje.length ? deHoje.map(s => <Linha key={s.id} s={s} />)
                : <p className="px-4 py-4 text-sm text-ink-400">Nenhuma supervisão hoje.</p>}
            </div>
          </section>
          <section>
            <h2 className="section-title mb-2">Próximas <span className="font-normal text-ink-400 tnum">{proximas.length}</span></h2>
            <div className="card divide-y divide-ink-100 overflow-hidden">
              {isLoading ? <p className="px-4 py-4 text-sm text-ink-400">Carregando…</p>
                : proximas.length ? proximas.map(s => <Linha key={s.id} s={s} />)
                : <p className="px-4 py-4 text-sm text-ink-400">Nada agendado no resto do mês.</p>}
            </div>
          </section>
          {feitas.length > 0 && (
            <section>
              <h2 className="section-title mb-2">Já resolvidas no mês <span className="font-normal text-ink-400 tnum">{feitas.length}</span></h2>
              <div className="card divide-y divide-ink-100 overflow-hidden">
                {feitas.map(s => <Linha key={s.id} s={s} />)}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Meta por cliente: a equipe digita a quantidade do mês; o feito enche
          com os check-ins. Grava no "Visitas/mês" do cadastro do cliente. */}
      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="section-title">Meta do mês por cliente</h2>
          <div className="flex items-center gap-3">
            {metas.length > 0 && (
              <button className="text-xs text-ink-400 hover:text-red-600" onClick={async () => {
                if (!(await confirmar({ titulo: 'Zerar todas as metas?', texto: `${metas.length} cliente(s) ficam sem meta. As supervisões não mudam.`, perigo: true }))) return
                salvarMeta.mutate({ ids: metas.map(m => m.id), valor: null })
              }}>Zerar todas</button>
            )}
            <button className="btn-secondary text-xs py-1 inline-flex items-center gap-1" onClick={() => setNovaMeta({ client_id: '', valor: '' })}>
              <Plus size={12} /> Meta
            </button>
          </div>
        </div>
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {novaMeta && (
            <form className="flex items-center gap-2 px-4 py-2.5 flex-wrap" onSubmit={e => {
              e.preventDefault()
              if (!novaMeta.client_id) { toast.error('Escolha o cliente'); return }
              gravarMeta(novaMeta.client_id, novaMeta.valor)
            }}>
              <select className="input flex-1 min-w-[12rem] text-sm" value={novaMeta.client_id} autoFocus
                onChange={e => setNovaMeta(p => p ? { ...p, client_id: e.target.value } : p)}>
                <option value="">Cliente…</option>
                {(clientes || []).filter(c => !((c.supervision_visits_per_month || 0) > 0)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input type="number" min={1} inputMode="numeric" className="input w-24 text-sm" placeholder="Qtd/mês" value={novaMeta.valor}
                onChange={e => setNovaMeta(p => p ? { ...p, valor: e.target.value } : p)} />
              <button type="submit" className="btn-primary text-xs py-1.5" disabled={salvarMeta.isPending}>Salvar</button>
              <button type="button" className="p-1.5 text-ink-400 hover:text-ink-700" onClick={() => setNovaMeta(null)} aria-label="Cancelar"><X size={14} /></button>
            </form>
          )}
          {metas.length === 0 && !novaMeta && (
            <p className="px-4 py-4 text-sm text-ink-400">Nenhuma meta. Toque em <b>+ Meta</b> para definir quantas supervisões por mês um cliente precisa.</p>
          )}
          {metas.map(m => {
            const pct = Math.min(100, Math.round((m.realizadas / m.meta) * 100))
            const bateu = m.realizadas >= m.meta
            return (
              <div key={m.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-ink-800">{m.nome}</span>
                  <span className="text-xs text-ink-400 tnum">{m.agendadas > 0 ? `${m.agendadas} agendada${m.agendadas > 1 ? 's' : ''}` : ''}</span>
                  {editMeta?.id === m.id ? (
                    <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); gravarMeta(m.id, editMeta.valor) }}>
                      <span className="tnum text-ink-500">{m.realizadas}/</span>
                      <input type="number" min={0} inputMode="numeric" autoFocus className="input w-16 py-1 text-sm" value={editMeta.valor}
                        onChange={e => setEditMeta({ id: m.id, valor: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Escape') setEditMeta(null) }} />
                      <button type="submit" className="p-1 text-green-700" aria-label="Salvar meta"><Check size={14} /></button>
                    </form>
                  ) : (
                    <button className={`tnum font-medium rounded px-1 -mx-1 hover:bg-ink-100 ${bateu ? 'text-green-700' : 'text-ink-800'}`}
                      title="Alterar a meta (0 tira a meta)" onClick={() => setEditMeta({ id: m.id, valor: String(m.meta) })}>
                      {m.realizadas}/{m.meta}
                    </button>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-ink-100 overflow-hidden">
                  <div className={`h-full rounded-full ${bateu ? 'bg-green-600' : 'bg-primary-500'}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Agendar ── */}
      {novo && (
        <div className="modal-overlay" onClick={() => setNovo(null)}>
          <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink-900">Agendar supervisão</h3>
              <button onClick={() => setNovo(null)} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Fechar"><X size={18} /></button>
            </div>
            <div>
              <label className="label">Cliente *</label>
              <div className="relative mb-1.5">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-8" placeholder="Buscar cliente…" value={buscaCliente} onChange={e => setBuscaCliente(e.target.value)} />
              </div>
              <select className="input" size={Math.min(6, Math.max(3, clientesFiltrados.length))} value={novo.client_id}
                onChange={e => setNovo(p => p ? { ...p, client_id: e.target.value } : p)}>
                {clientesFiltrados.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Dia *</label>
                <input type="date" className="input" value={novo.visit_date} onChange={e => setNovo(p => p ? { ...p, visit_date: e.target.value } : p)} />
              </div>
              <div>
                <label className="label">Responsável *</label>
                <select className="input" value={novo.supervisor_id} onChange={e => setNovo(p => p ? { ...p, supervisor_id: e.target.value } : p)}>
                  <option value="">Escolha…</option>
                  {(equipe || []).map(p => <option key={p.id} value={p.id}>{p.full_name}{p.id === user?.id ? ' (eu)' : ''}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Observação</label>
              <textarea className="input" rows={2} value={novo.observations} onChange={e => setNovo(p => p ? { ...p, observations: e.target.value } : p)}
                placeholder="Opcional" />
            </div>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button className="btn-secondary" onClick={() => setNovo(null)}>Cancelar</button>
              <button className="btn-primary" onClick={() => criar.mutate()} disabled={criar.isPending}>{criar.isPending ? 'Salvando…' : 'Agendar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalhe / ações ── */}
      {aberta && !naoFoi && (() => {
        const s = aberta
        const info = STATUS_INFO[s.status || 'realizada']
        return (
          <div className="modal-overlay" onClick={() => setAberta(null)}>
            <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-ink-400">{formatDate(s.visit_date)}</p>
                  <h3 className="text-lg font-semibold text-ink-900 truncate">{nomeCliente(s.client_id)}</h3>
                  <p className={`text-xs font-medium flex items-center gap-1.5 mt-0.5 ${info.texto}`}><span className={`dot ${info.dot}`} />{info.rotulo}
                    {s.status === 'realizada' && s.checked_in_by && <span className="text-ink-400 font-normal"> · check-in de {primeiroNome(s.checked_in_by)}{s.checked_in_at ? ` em ${formatDate(s.checked_in_at.slice(0, 10))}` : ''}</span>}
                  </p>
                </div>
                <button onClick={() => setAberta(null)} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Fechar"><X size={18} /></button>
              </div>

              {s.observations && <p className="text-sm text-ink-600">{s.observations}</p>}
              {s.status === 'nao_realizada' && s.motivo_nao_realizada && <p className="text-sm text-red-700">Motivo: {s.motivo_nao_realizada}</p>}

              {/* Responsável — troca a qualquer momento */}
              <div>
                <label className="label flex items-center gap-1.5"><UserRound size={13} /> Responsável</label>
                <select className="input" value={s.supervisor_id || ''} disabled={s.status !== 'agendada'}
                  onChange={e => {
                    const novoResp = e.target.value
                    atualizar.mutate({ id: s.id, patch: { supervisor_id: novoResp || null } },
                      { onSuccess: () => { toast.success(`Agora com ${primeiroNome(novoResp)}`); setAberta({ ...s, supervisor_id: novoResp }) } })
                  }}>
                  <option value="">Sem responsável</option>
                  {(equipe || []).map(p => <option key={p.id} value={p.id}>{p.full_name}{p.id === user?.id ? ' (eu)' : ''}</option>)}
                </select>
              </div>

              {/* Remarcar (ainda agendada) */}
              {s.status === 'agendada' && (
                <div>
                  <label className="label flex items-center gap-1.5"><CalendarClock size={13} /> Dia</label>
                  <input type="date" className="input" value={s.visit_date}
                    onChange={e => {
                      const d = e.target.value
                      if (!d) return
                      atualizar.mutate({ id: s.id, patch: { visit_date: d } },
                        { onSuccess: () => { toast.success(`Remarcada para ${formatDate(d)}`); setAberta({ ...s, visit_date: d }) } })
                    }} />
                </div>
              )}

              <div className="flex flex-col gap-2 pt-1">
                {s.status === 'agendada' && (
                  <>
                    <button className="btn-primary" onClick={() => checkIn(s)} disabled={atualizar.isPending || s.visit_date > hoje}
                      title={s.visit_date > hoje ? 'O check-in é no dia da supervisão' : undefined}>
                      <Check size={16} /> {s.visit_date > hoje ? `Check-in disponível em ${formatDate(s.visit_date)}` : 'Check-in: foi realizada'}
                    </button>
                    <button className="btn-secondary" onClick={() => setNaoFoi({ sup: s, motivo: '', remarcar: true, nova_data: format(addDays(new Date(), 1), 'yyyy-MM-dd'), novo_resp: s.supervisor_id || '' })}>
                      <X size={16} /> Não foi realizada
                    </button>
                  </>
                )}
                {s.status === 'realizada' && s.checked_in_at && (
                  <button className="btn-ghost text-sm" onClick={() => atualizar.mutate(
                    { id: s.id, patch: { status: 'agendada', checked_in_at: null, checked_in_by: null } },
                    { onSuccess: () => { toast.success('Check-in desfeito'); setAberta(null) } })}>
                    Desfazer check-in
                  </button>
                )}
                {s.status === 'nao_realizada' && (
                  <button className="btn-secondary" onClick={() => setNaoFoi({ sup: s, motivo: s.motivo_nao_realizada || '', remarcar: true, nova_data: format(addDays(new Date(), 1), 'yyyy-MM-dd'), novo_resp: s.supervisor_id || '' })}>
                    <CalendarClock size={16} /> Remarcar
                  </button>
                )}
                <button className="btn-ghost text-sm text-red-600 hover:bg-red-50" onClick={() => excluir(s)}>
                  <Trash2 size={15} /> Excluir agendamento
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Não foi realizada ── */}
      {naoFoi && (
        <div className="modal-overlay" onClick={() => setNaoFoi(null)}>
          <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div>
              <p className="text-xs text-ink-400">{nomeCliente(naoFoi.sup.client_id)} · {formatDate(naoFoi.sup.visit_date)}</p>
              <h3 className="text-lg font-semibold text-ink-900">Supervisão não realizada</h3>
            </div>
            <div>
              <label className="label">Motivo</label>
              <textarea className="input" rows={2} value={naoFoi.motivo} placeholder="Opcional"
                onChange={e => setNaoFoi(p => p ? { ...p, motivo: e.target.value } : p)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-800 cursor-pointer select-none">
              <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-primary-700" checked={naoFoi.remarcar}
                onChange={e => setNaoFoi(p => p ? { ...p, remarcar: e.target.checked } : p)} />
              Remarcar para outro dia
            </label>
            {naoFoi.remarcar && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Novo dia *</label>
                  <input type="date" className="input" value={naoFoi.nova_data} onChange={e => setNaoFoi(p => p ? { ...p, nova_data: e.target.value } : p)} />
                </div>
                <div>
                  <label className="label">Responsável</label>
                  <select className="input" value={naoFoi.novo_resp} onChange={e => setNaoFoi(p => p ? { ...p, novo_resp: e.target.value } : p)}>
                    {(equipe || []).map(p => <option key={p.id} value={p.id}>{p.full_name}{p.id === user?.id ? ' (eu)' : ''}</option>)}
                  </select>
                </div>
              </div>
            )}
            <p className="text-xs text-ink-500">A supervisão de {formatDate(naoFoi.sup.visit_date)} fica registrada como não realizada.{naoFoi.remarcar ? ' Uma nova é agendada no novo dia.' : ''}</p>
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button className="btn-secondary" onClick={() => setNaoFoi(null)}>Voltar</button>
              <button className="btn-primary" onClick={() => registrarNaoFoi.mutate()} disabled={registrarNaoFoi.isPending}>
                {registrarNaoFoi.isPending ? 'Salvando…' : naoFoi.remarcar ? 'Registrar e remarcar' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
