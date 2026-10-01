import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, FileDown, Plus, Trash2, FileText, Check, X } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatCurrency, formatDate, corDoAvatar, hojeISO } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { SignedLink } from '../../components/ui/SignedFile'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { comprimirImagem, miniaturaJpeg } from '../../lib/imagem'
import { periodoDe, andarPeriodo, saldoDoCaixa, textoDoSaldo, ROTULO_PAPEL, ROTULO_TIPO_CAIXA } from '../../lib/equipe'
import type { Periodo, TipoPeriodo, LancamentoCaixa } from '../../lib/equipe'

/**
 * Equipe — relatório de trabalho de quem tem login no sistema (pedido do
 * Gabriel, 01/10/2026). Junta sozinho o que a pessoa já registra
 * (atividades, reuniões/compromissos, supervisões) e o caixa de compras
 * (migração 075). Cada um vê o seu; chefe e contabilidade veem todos.
 * A própria pessoa baixa o relatório (semana ou mês) e entrega para a chefe.
 */

type Perfil = { id: string; full_name: string; role: string; photo_url?: string | null }
type Atividade = { id: string; user_id: string; activity_date: string; activity_name: string; notes?: string | null; done: boolean | null }
type Compromisso = { id: string; title: string; category?: string | null; scheduled_at: string; status?: string | null; notes?: string | null; recruiter_id?: string | null; participant_ids?: string[] | null; client?: { name?: string } | null }
type Supervisao = { id: string; supervisor_id: string | null; visit_date: string; status?: string | null; unit_name?: string | null; observations?: string | null; motivo_nao_realizada?: string | null; checked_in_at?: string | null; client?: { name?: string } | null }
type Dados = { perfis: Perfil[]; atividades: Atividade[]; compromissos: Compromisso[]; supervisoes: Supervisao[]; caixa: LancamentoCaixa[]; caixaErro: boolean }

const iniciais = (nome: string) => nome.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const diaLongo = (ds: string) => `${DIAS[new Date(ds.slice(0, 10) + 'T12:00:00').getDay()]}, ${formatDate(ds.slice(0, 10))}`
const hora = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const situacaoSup = (s: Supervisao) => s.status === 'nao_realizada' ? 'Não realizada' : s.status === 'agendada' ? 'Agendada' : 'Realizada'
const doUsuario = (c: Compromisso, uid: string) => c.recruiter_id === uid || (c.participant_ids || []).includes(uid)

/** Tudo do período — de todo mundo (lista da chefia) ou de uma pessoa */
async function carregar(p: Periodo, uid?: string): Promise<Dados> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dele = (q: any, col: string) => (uid ? q.eq(col, uid) : q)
  const [perfisR, atividades, compromissos, supervisoes, caixaR] = await Promise.all([
    supabase.from('user_profiles').select('id, full_name, role, photo_url').order('full_name'),
    fetchAll<Atividade>(() => dele(supabase.from('activity_logs').select('id, user_id, activity_date, activity_name, notes, done'), 'user_id')
      .gte('activity_date', p.ini).lte('activity_date', p.fim).order('id')),
    fetchAll<Compromisso>(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from('interviews').select('id, title, category, scheduled_at, status, notes, recruiter_id, participant_ids, client:clients(name)')
        .gte('scheduled_at', `${p.ini}T00:00:00-03:00`).lte('scheduled_at', `${p.fim}T23:59:59-03:00`)
      if (uid) q = q.or(`recruiter_id.eq.${uid},participant_ids.cs.{${uid}}`)
      return q.order('id')
    }),
    fetchAll<Supervisao>(() => dele(supabase.from('supervision_visits').select('*, client:clients(name)'), 'supervisor_id')
      .gte('visit_date', p.ini).lte('visit_date', p.fim).order('id')),
    // Caixa: tudo (o saldo vem de antes do período também)
    dele(supabase.from('equipe_caixa').select('*'), 'user_id').order('data'),
  ])
  return {
    perfis: (perfisR.data || []) as Perfil[],
    atividades, compromissos, supervisoes,
    caixa: (caixaR.error ? [] : caixaR.data || []) as LancamentoCaixa[],
    caixaErro: !!caixaR.error,
  }
}

function resumoDe(d: Dados, uid: string, p: Periodo) {
  const atividades = d.atividades.filter(a => a.user_id === uid)
  const compromissos = d.compromissos.filter(c => doUsuario(c, uid))
  const supervisoes = d.supervisoes.filter(s => s.supervisor_id === uid)
  const caixaDele = d.caixa.filter(c => c.user_id === uid)
  return {
    atividades, compromissos, supervisoes, caixaDele,
    caixaPeriodo: caixaDele.filter(c => c.data >= p.ini && c.data <= p.fim),
    feitas: atividades.filter(a => a.done === true).length,
    supReal: supervisoes.filter(s => (s.status || 'realizada') === 'realizada').length,
    movPeriodo: saldoDoCaixa(caixaDele, p.fim, p.ini),
    saldoFim: saldoDoCaixa(caixaDele, p.fim),
    saldoAgora: saldoDoCaixa(caixaDele),
  }
}

// ── Página ────────────────────────────────────────────────────────────────
export default function EquipePage() {
  const { profile, role } = useAuth()
  const chefia = role === 'chefe' // chefe e contabilidade
  const [params, setParams] = useSearchParams()
  const tipo: TipoPeriodo = params.get('periodo') === 'mes' ? 'mes' : 'semana'
  const periodo = periodoDe(tipo, /^\d{4}-\d{2}(-\d{2})?$/.test(params.get('ref') || '') ? (params.get('ref')!.length === 7 ? params.get('ref') + '-01' : params.get('ref')!) : hojeISO())
  const pessoa = chefia ? (params.get('pessoa') || '') : (profile?.id || '')
  const ir = (mudar: Record<string, string | null>) => {
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(mudar)) { if (v) q.set(k, v); else q.delete(k) }
    setParams(q)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Operação</p>
          <h1 className="page-title">{chefia ? 'Equipe' : 'Meu trabalho'}</h1>
          <p className="text-sm text-ink-500 mt-1">Atividades, reuniões, supervisões e compras — com relatório para entregar à chefe.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5">
            {(['semana', 'mes'] as const).map(k => (
              <button key={k} onClick={() => ir({ periodo: k === 'mes' ? 'mes' : null, ref: periodo.ini })}
                className={`px-3 py-1.5 text-sm rounded-lg ${tipo === k ? 'bg-ink-900 text-white' : 'text-ink-600'}`}>{k === 'semana' ? 'Semana' : 'Mês'}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 card p-1">
            <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Anterior" onClick={() => ir({ ref: andarPeriodo(periodo, -1).ini })}><ChevronLeft size={16} /></button>
            <span className="px-2 text-sm font-medium text-ink-800 min-w-[10rem] text-center first-letter:uppercase">{periodo.rotulo}</span>
            <button className="p-2 rounded-lg hover:bg-ink-100" aria-label="Próximo" onClick={() => ir({ ref: andarPeriodo(periodo, 1).ini })}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      {chefia && !pessoa
        ? <ListaEquipe periodo={periodo} abrir={id => ir({ pessoa: id })} />
        : pessoa
          ? <PerfilEquipe uid={pessoa} periodo={periodo} proprio={pessoa === profile?.id} voltar={chefia ? () => ir({ pessoa: null }) : undefined} />
          : <p className="text-sm text-ink-500">Carregando…</p>}
    </div>
  )
}

// ── Lista (chefia) ────────────────────────────────────────────────────────
function ListaEquipe({ periodo, abrir }: { periodo: Periodo; abrir: (id: string) => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['equipe', periodo.ini, periodo.fim], queryFn: () => carregar(periodo) })
  const membros = useMemo(() => (data?.perfis || []).filter(p => p.role !== 'contabilidade'), [data])
  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>
  return (
    <div className="card divide-y divide-ink-100 overflow-hidden">
      {membros.map(m => {
        const r = resumoDe(data, m.id, periodo)
        return (
          <button key={m.id} onClick={() => abrir(m.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/70">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(m.full_name)}`}>{iniciais(m.full_name)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink-900 truncate">{m.full_name}</p>
              <p className="text-xs text-ink-500">{ROTULO_PAPEL[m.role] || m.role}</p>
            </div>
            <div className="hidden sm:grid grid-cols-4 gap-4 text-center shrink-0">
              {([['Atividades', `${r.feitas}/${r.atividades.length}`], ['Reuniões', r.compromissos.length], ['Supervisões', r.supReal], ['Compras', formatCurrency(r.movPeriodo.gasto)]] as const).map(([t, v]) => (
                <div key={t}><p className="text-sm font-semibold text-ink-900 tnum">{v}</p><p className="text-[10px] text-ink-400">{t}</p></div>
              ))}
            </div>
            <p className="sm:hidden text-xs text-ink-600 tnum shrink-0">{r.feitas}/{r.atividades.length} ativ.</p>
          </button>
        )
      })}
      {membros.length === 0 && <p className="px-4 py-6 text-sm text-ink-500 text-center">Ninguém na equipe ainda.</p>}
    </div>
  )
}

// ── Perfil de uma pessoa ──────────────────────────────────────────────────
function PerfilEquipe({ uid, periodo, proprio, voltar }: { uid: string; periodo: Periodo; proprio: boolean; voltar?: () => void }) {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ['equipe', periodo.ini, periodo.fim, uid], queryFn: () => carregar(periodo, uid) })
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-lista-simples'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name')
      if (error) throw error
      return (data || []) as { id: string; name: string }[]
    },
    staleTime: 5 * 60_000,
  })
  const nomeCliente = (id?: string | null) => (id && clientes.find(c => c.id === id)?.name) || ''
  const [lancando, setLancando] = useState(false)
  const [comFotos, setComFotos] = useState(true)
  const [gerando, setGerando] = useState(false)

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('equipe_caixa').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Lançamento apagado'); qc.invalidateQueries({ queryKey: ['equipe'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>

  const perfil = data.perfis.find(p => p.id === uid)
  const nome = perfil?.full_name || 'Pessoa'
  const papel = ROTULO_PAPEL[perfil?.role || ''] || 'Equipe'
  const r = resumoDe(data, uid, periodo)
  const atividadesPorDia = new Map<string, Atividade[]>()
  for (const a of [...r.atividades].sort((x, z) => x.activity_date.localeCompare(z.activity_date))) atividadesPorDia.set(a.activity_date, [...(atividadesPorDia.get(a.activity_date) || []), a])

  const baixar = async () => {
    setGerando(true)
    try {
      // Fotos dos comprovantes das compras do período (PDF de comprovante fica só no sistema)
      const comprovantes: { titulo: string; dataUrl: string; w: number; h: number }[] = []
      let semFoto = 0
      if (comFotos) {
        for (const c of r.caixaPeriodo.filter(x => x.comprovante)) {
          const url = await getSignedUrl(c.comprovante!, 'arquivos')
          const img = url ? await miniaturaJpeg(url) : null
          if (img) comprovantes.push({ titulo: `${formatDate(c.data)} · ${c.descricao} · ${formatCurrency(Number(c.valor) || 0)}`, ...img })
          else semFoto++
        }
      }
      const { gerarRelatorioEquipe } = await import('../../lib/relatorioEquipePdf')
      const blob = await gerarRelatorioEquipe({
        nome, papel, periodo,
        atividades: r.atividades.map(a => ({ data: a.activity_date, nome: a.activity_name, notas: a.notes, feito: a.done })),
        compromissos: r.compromissos.map(c => ({ inicio: c.scheduled_at, categoria: c.category || 'Compromisso', titulo: c.title, cliente: c.client?.name, situacao: c.status || 'Agendada', notas: c.notes })),
        supervisoes: r.supervisoes.map(s => ({
          data: s.visit_date, cliente: s.client?.name || 'Cliente', unidade: s.unit_name, situacao: situacaoSup(s),
          detalhe: [s.checked_in_at ? `check-in às ${hora(s.checked_in_at)}` : null, s.motivo_nao_realizada ? `motivo: ${s.motivo_nao_realizada}` : null, s.observations].filter(Boolean).join(' · ') || null,
        })),
        caixa: r.caixaPeriodo.map(c => ({ data: c.data, tipo: c.tipo, descricao: c.descricao, cliente: nomeCliente(c.client_id), valor: Number(c.valor) || 0, temComprovante: !!c.comprovante })),
        saldoPeriodo: r.movPeriodo, saldoFinal: r.saldoFim,
        comprovantes, comprovantesSemFoto: semFoto,
        geradoPor: profile?.full_name,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `relatorio_${nome.split(' ')[0].toLowerCase()}_${periodo.tipo === 'mes' ? periodo.ini.slice(0, 7) : periodo.ini}.pdf`
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      toast.error('Não consegui gerar o relatório: ' + (e as Error).message)
    } finally { setGerando(false) }
  }

  return (
    <div className="space-y-4">
      {/* Pessoa + ações */}
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        {voltar && <button onClick={voltar} className="btn-ghost p-2 -ml-2" aria-label="Equipe"><ChevronLeft size={18} /></button>}
        <span className={`w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${corDoAvatar(nome)}`}>{iniciais(nome)}</span>
        <div className="flex-1 min-w-[9rem]">
          <p className="text-lg font-semibold text-ink-900 leading-tight">{nome}</p>
          <p className="text-xs text-ink-500">{papel}</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input type="checkbox" checked={comFotos} onChange={e => setComFotos(e.target.checked)} /> fotos dos comprovantes
        </label>
        <button className="btn-primary text-sm" disabled={gerando} onClick={baixar}><FileDown size={15} />{gerando ? 'Gerando…' : 'Baixar relatório'}</button>
      </div>

      {/* Resumo */}
      <div className="card grid grid-cols-2 md:grid-cols-4 divide-x divide-ink-100 overflow-hidden">
        {([
          ['Atividades', `${r.feitas} de ${r.atividades.length}`, 'feitas'],
          ['Reuniões e compromissos', String(r.compromissos.length), 'no período'],
          ['Supervisões', String(r.supReal), `realizada${r.supReal === 1 ? '' : 's'} de ${r.supervisoes.length}`],
          ['Compras', formatCurrency(r.movPeriodo.gasto), textoDoSaldo(r.saldoAgora.saldo, formatCurrency)],
        ] as const).map(([t, v, s]) => (
          <div key={t} className="px-4 py-3">
            <p className="text-[11px] text-ink-500">{t}</p>
            <p className="text-lg font-semibold text-ink-900 tnum">{v}</p>
            <p className="text-[11px] text-ink-400 truncate">{s}</p>
          </div>
        ))}
      </div>

      {/* Atividades por dia */}
      <Secao titulo="Atividades" info={`${r.feitas} feita(s) · ${r.atividades.filter(a => a.done === false).length} não feita(s)`}>
        {r.atividades.length === 0 ? <Vazio texto="Nenhuma atividade no período." /> : [...atividadesPorDia].map(([dia, lista]) => (
          <div key={dia} className="px-4 py-2.5">
            <p className="text-xs font-semibold text-ink-500 first-letter:uppercase mb-1">{diaLongo(dia)}</p>
            {lista.map(a => (
              <div key={a.id} className="flex items-start gap-2 py-1">
                <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${a.done === true ? 'bg-green-600' : a.done === false ? 'bg-red-500' : 'border border-ink-300'}`}>
                  {a.done === true && <Check size={10} className="text-white" strokeWidth={3} />}
                  {a.done === false && <X size={10} className="text-white" strokeWidth={3} />}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm ${a.done === false ? 'text-ink-500' : 'text-ink-800'}`}>{a.activity_name}</p>
                  {a.notes && <p className="text-xs text-ink-400">{a.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Secao>

      {/* Reuniões e compromissos */}
      <Secao titulo="Reuniões e compromissos" info={`${r.compromissos.length}`}>
        {r.compromissos.length === 0 ? <Vazio texto="Nenhuma reunião ou compromisso no período." /> :
          [...r.compromissos].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map(c => (
            <div key={c.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="w-20 shrink-0">
                <p className="text-xs font-semibold text-ink-700">{formatDate(c.scheduled_at.slice(0, 10))}</p>
                <p className="text-[11px] text-ink-400">{hora(c.scheduled_at)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-900"><span className="text-ink-500">{c.category || 'Compromisso'} · </span>{c.title}</p>
                {c.client?.name && <p className="text-xs text-ink-500">{c.client.name}</p>}
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${/realiz/i.test(c.status || '') ? 'bg-green-50 text-green-700' : /cancel|falt/i.test(c.status || '') ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{c.status || 'Agendada'}</span>
            </div>
          ))}
      </Secao>

      {/* Supervisões */}
      <Secao titulo="Supervisões" info={`${r.supReal} realizada(s) de ${r.supervisoes.length}`}>
        {r.supervisoes.length === 0 ? <Vazio texto="Nenhuma supervisão no período." /> :
          [...r.supervisoes].sort((a, b) => a.visit_date.localeCompare(b.visit_date)).map(s => (
            <div key={s.id} className="px-4 py-2.5 flex items-start gap-3">
              <p className="w-20 shrink-0 text-xs font-semibold text-ink-700">{formatDate(s.visit_date)}</p>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-900">{s.client?.name || 'Cliente'}{s.unit_name ? ` · ${s.unit_name}` : ''}</p>
                <p className="text-xs text-ink-500">{[s.checked_in_at ? `check-in às ${hora(s.checked_in_at)}` : null, s.motivo_nao_realizada ? `motivo: ${s.motivo_nao_realizada}` : null, s.observations].filter(Boolean).join(' · ')}</p>
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${situacaoSup(s) === 'Realizada' ? 'bg-green-50 text-green-700' : situacaoSup(s) === 'Não realizada' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{situacaoSup(s)}</span>
            </div>
          ))}
      </Secao>

      {/* Caixa de compras */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink-900">Compras e reembolsos</p>
            <p className={`text-xs font-medium ${r.saldoAgora.saldo < -0.004 ? 'text-red-600' : 'text-ink-500'}`}>{textoDoSaldo(r.saldoAgora.saldo, formatCurrency)}</p>
          </div>
          {proprio && !data.caixaErro && <button className="btn-primary text-sm" onClick={() => setLancando(true)}><Plus size={15} />Lançar</button>}
        </div>
        {data.caixaErro ? <p className="px-4 py-4 text-sm text-amber-700">Para usar o caixa, rode a migração 075 no Supabase.</p>
          : r.caixaPeriodo.length === 0 ? <Vazio texto={proprio ? 'Nada lançado neste período. Recebeu dinheiro para compras ou comprou algo? Toque em Lançar.' : 'Nada lançado neste período.'} />
          : (
            <div className="divide-y divide-ink-100">
              {r.caixaPeriodo.map(c => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
                  <p className="w-14 shrink-0 text-xs font-semibold text-ink-700">{formatDate(c.data).slice(0, 5)}</p>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink-900 truncate"><span className="text-ink-500">{ROTULO_TIPO_CAIXA[c.tipo]} · </span>{c.descricao}</p>
                    {c.client_id && <p className="text-xs text-ink-500">{nomeCliente(c.client_id)}</p>}
                  </div>
                  {c.comprovante && <SignedLink value={c.comprovante} bucket="arquivos" className="btn-ghost text-[11px] py-1 px-2 inline-flex items-center gap-1"><FileText size={12} />nota</SignedLink>}
                  <p className={`text-sm font-semibold tnum shrink-0 ${c.tipo === 'recebido' ? 'text-green-700' : 'text-ink-900'}`}>{c.tipo === 'recebido' ? '+' : '−'} {formatCurrency(Number(c.valor) || 0)}</p>
                  {proprio && (
                    <button className="p-1.5 text-ink-400 hover:text-red-600" aria-label="Apagar" disabled={apagar.isPending}
                      onClick={async () => { if (await confirmar({ titulo: 'Apagar este lançamento?', texto: `${c.descricao} · ${formatCurrency(Number(c.valor) || 0)}`, confirmar: 'Apagar', perigo: true })) apagar.mutate(c.id) }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="px-4 py-2.5 bg-ink-50/60 text-xs text-ink-600 flex flex-wrap gap-x-4 gap-y-1">
                <span>Recebido <strong className="tnum">{formatCurrency(r.movPeriodo.recebido)}</strong></span>
                <span>Compras <strong className="tnum">{formatCurrency(r.movPeriodo.gasto)}</strong></span>
                {r.movPeriodo.devolvido > 0 && <span>Devolvido <strong className="tnum">{formatCurrency(r.movPeriodo.devolvido)}</strong></span>}
              </div>
            </div>
          )}
      </div>

      {lancando && <LancarCaixa uid={uid} clientes={clientes} fechar={() => setLancando(false)} />}
    </div>
  )
}

function Secao({ titulo, info, children }: { titulo: string; info?: string; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-100 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-ink-900">{titulo}</p>
        {info && <p className="text-xs text-ink-500">{info}</p>}
      </div>
      <div className="divide-y divide-ink-100">{children}</div>
    </div>
  )
}
const Vazio = ({ texto }: { texto: string }) => <p className="px-4 py-4 text-sm text-ink-500">{texto}</p>

// ── Lançar no caixa (a própria pessoa) ────────────────────────────────────
function LancarCaixa({ uid, clientes, fechar }: { uid: string; clientes: { id: string; name: string }[]; fechar: () => void }) {
  const qc = useQueryClient()
  const [tipo, setTipo] = useState<LancamentoCaixa['tipo']>('compra')
  const [valor, setValor] = useState('')
  const [data, setData] = useState(hojeISO())
  const [descricao, setDescricao] = useState('')
  const [cliente, setCliente] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)

  const salvar = useMutation({
    mutationFn: async () => {
      const v = Number(valor.replace(/\./g, '').replace(',', '.'))
      if (!(v > 0)) throw new Error('Informe o valor')
      if (!descricao.trim()) throw new Error(tipo === 'compra' ? 'Diga o que foi comprado' : 'Escreva uma descrição')
      if (tipo === 'compra' && !arquivo) throw new Error('A compra precisa do comprovante (foto ou PDF da nota)')
      let comprovante: string | null = null
      if (arquivo) {
        // Foto diminuída antes de subir: economiza o espaço do plano gratuito
        const f = await comprimirImagem(arquivo)
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const caminho = `caixa/${uid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(caminho, f, { upsert: false, contentType: f.type || undefined })
        if (upErr) throw new Error('O comprovante não subiu: ' + upErr.message)
        comprovante = caminho
      }
      const { error } = await supabase.from('equipe_caixa').insert({
        user_id: uid, tipo, valor: Math.round(v * 100) / 100, data, descricao: descricao.trim(),
        client_id: cliente || null, comprovante,
      })
      if (error) throw new Error(/equipe_caixa/.test(error.message) ? 'Falta rodar a migração 075 no Supabase.' : error.message)
    },
    onSuccess: () => { toast.success('Lançado!'); qc.invalidateQueries({ queryKey: ['equipe'] }); fechar() },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-ink-900">Lançar no caixa</h3>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-ink-100/70">
          {([['recebido', 'Recebi dinheiro'], ['compra', 'Fiz uma compra'], ['devolvido', 'Devolvi a sobra']] as const).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setTipo(k)}
              className={`h-10 rounded-lg text-xs sm:text-sm font-medium ${tipo === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Valor *</label>
            <input className="input tnum" inputMode="decimal" placeholder="0,00" value={valor} onChange={e => setValor(e.target.value)} />
          </div>
          <div>
            <label className="label">Data *</label>
            <input className="input" type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">{tipo === 'compra' ? 'O que foi comprado *' : tipo === 'recebido' ? 'Para quê *' : 'Descrição *'}</label>
          <input className="input" value={descricao} onChange={e => setDescricao(e.target.value)}
            placeholder={tipo === 'compra' ? 'Ex.: Material de limpeza para o cliente' : tipo === 'recebido' ? 'Ex.: Compras do mês pedidas pela chefe' : 'Ex.: Sobra das compras de setembro'} />
        </div>
        {tipo === 'compra' && (
          <div>
            <label className="label">Cliente <span className="text-ink-400 font-normal">— opcional</span></label>
            <select className="input" value={cliente} onChange={e => setCliente(e.target.value)}>
              <option value="">Nenhum</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Comprovante {tipo === 'compra' ? '*' : <span className="text-ink-400 font-normal">— opcional</span>}</label>
          <input type="file" accept="image/*,application/pdf" className="input" onChange={e => setArquivo(e.target.files?.[0] || null)} />
          <p className="text-[11px] text-ink-400 mt-1">Foto da nota ou PDF. A foto é diminuída antes de subir.</p>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Lançar'}</button>
        </div>
      </div>
    </div>
  )
}
