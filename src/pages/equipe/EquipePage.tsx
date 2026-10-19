import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, FileDown, Plus, Trash2, FileText, Check, X, Pencil, Repeat } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatCurrency, formatDate, corDoAvatar, hojeISO, formatLocalTime } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { SignedLink } from '../../components/ui/SignedFile'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { comprimirImagem, miniaturaJpeg } from '../../lib/imagem'
import {
  periodoDe, andarPeriodo, saldoDoCaixa, textoDoSaldo, ROTULO_PAPEL, ROTULO_TIPO_CAIXA,
  ROTULO_TIPO_VISITA, ROTULO_SITUACAO_VISITA, situacaoDaVisitaEquipe, minutosDaVisita, horasTexto, tipoDaVisita, ehPaga,
  gradeDoMes, mesDoPeriodo,
} from '../../lib/equipe'
import type { Periodo, TipoPeriodo, LancamentoCaixa, TipoVisitaEquipe, SituacaoVisitaEquipe } from '../../lib/equipe'

/**
 * Meu trabalho (antes "Equipe") — o trabalho de quem tem login no sistema
 * (pedido do Gabriel, 01/10/2026). Junta sozinho o que a pessoa já registra
 * (atividades, reuniões/compromissos, supervisões) e o caixa de compras
 * (migração 075). Cada um vê o seu; só a contabilidade vê todos (migração 078).
 * A própria pessoa baixa o relatório (semana ou mês) e entrega para a chefe.
 *
 * 19/10/2026: calendário grande do mês com tudo da pessoa, e o registro de
 * visita (= vistoria) ou supervisão como no portal (cliente, entrada e saída) —
 * sem pagamento: só entra no relatório e no calendário (migração 099). A visita
 * paga (valor + aprovação da contabilidade) continua como opção.
 */

type Perfil = { id: string; full_name: string; role: string; photo_url?: string | null; employee_id?: string | null }
type Atividade = { id: string; user_id: string; activity_date: string; activity_name: string; notes?: string | null; done: boolean | null }
type Compromisso = { id: string; title: string; category?: string | null; scheduled_at: string; status?: string | null; notes?: string | null; recruiter_id?: string | null; participant_ids?: string[] | null; client?: { name?: string } | null }
type Supervisao = { id: string; supervisor_id: string | null; visit_date: string; status?: string | null; unit_name?: string | null; observations?: string | null; motivo_nao_realizada?: string | null; checked_in_at?: string | null; client?: { name?: string } | null }
type VisitaEquipe = {
  id: string; user_id: string; client_id: string | null; unidade?: string | null; data: string
  entrada?: string | null; saida?: string | null; valor?: number | string | null; relatorio?: string | null; observacoes?: string | null
  status: 'pendente' | 'aprovada' | 'recusada' | 'registrada'; motivo_recusa?: string | null; client?: { name?: string } | null
  paga?: boolean | null; tipo?: string | null
}
type ModeloVisita = { id: string; client_id: string | null; unidade?: string | null; valor?: number | string | null; entrada?: string | null; saida?: string | null; observacoes?: string | null; paga?: boolean | null; tipo?: string | null }
type InicialVisita = {
  qual?: Qual   // o que abre no Registrar (visita, supervisão, reunião, atividade)
  id?: string; tipo?: TipoVisitaEquipe; paga?: boolean; cliente?: string; unidade?: string; data?: string
  entrada?: string; saida?: string; valor?: string; obs?: string
}
type Dados = { perfis: Perfil[]; atividades: Atividade[]; compromissos: Compromisso[]; supervisoes: Supervisao[]; caixa: LancamentoCaixa[]; caixaErro: boolean; visitas: VisitaEquipe[]; visitasErro: boolean }

const COR_SITUACAO: Record<SituacaoVisitaEquipe, string> = {
  programada: 'bg-sky-50 text-sky-700', sem_horario: 'bg-amber-50 text-amber-700', realizada: 'bg-green-50 text-green-700',
  pendente: 'bg-amber-50 text-amber-700', aprovada: 'bg-green-50 text-green-700', recusada: 'bg-red-50 text-red-700',
}
const COR_TIPO: Record<TipoVisitaEquipe, string> = { visita: 'bg-emerald-50 text-emerald-800', supervisao: 'bg-teal-50 text-teal-800' }
const situacao = (v: VisitaEquipe) => situacaoDaVisitaEquipe(v, hojeISO())
// A própria pessoa corrige e apaga enquanto não foi decidida (paga) — a não paga, sempre
const editavel = (v: VisitaEquipe) => v.status === 'pendente' || v.status === 'registrada'
const horarioDaVisita = (v: VisitaEquipe) => {
  const min = minutosDaVisita(v.entrada, v.saida)
  return min == null ? null : `${v.entrada!.slice(0, 5)}–${v.saida!.slice(0, 5)} · ${horasTexto(min)}`
}
const paraEditar = (v: VisitaEquipe): InicialVisita => ({
  id: v.id, tipo: tipoDaVisita(v), paga: ehPaga(v), cliente: v.client_id || '', unidade: v.unidade || '', data: v.data,
  entrada: (v.entrada || '').slice(0, 5), saida: (v.saida || '').slice(0, 5), valor: v.valor != null ? String(v.valor).replace('.', ',') : '', obs: v.observacoes || '',
})
const paraRepetir = (v: VisitaEquipe): InicialVisita => ({ ...paraEditar(v), id: undefined, data: undefined })

const iniciais = (nome: string) => nome.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const diaLongo = (ds: string) => `${DIAS[new Date(ds.slice(0, 10) + 'T12:00:00').getDay()]}, ${formatDate(ds.slice(0, 10))}`
// Compromisso é gravado como "hora de parede" (cadastrou 11h → banco guarda 11:00, sem fuso).
// new Date() convertia para Brasília e 11h virava 08h no relatório (05/10/2026).
const hora = (ts: string) => formatLocalTime(ts)
const situacaoSup = (s: Supervisao) => s.status === 'nao_realizada' ? 'Não realizada' : s.status === 'agendada' ? 'Agendada' : 'Realizada'
const doUsuario = (c: Compromisso, uid: string) => c.recruiter_id === uid || (c.participant_ids || []).includes(uid)

/** Tudo do período — de todo mundo (lista da chefia) ou de uma pessoa */
async function carregar(p: { ini: string; fim: string }, uid?: string): Promise<Dados> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dele = (q: any, col: string) => (uid ? q.eq(col, uid) : q)
  // Com a migração 076 o login tem o cadastro de colaborador ligado; sem ela, só o básico
  const comCadastro = await supabase.from('user_profiles').select('id, full_name, role, photo_url, employee_id').order('full_name')
  const perfisR = comCadastro.error ? await supabase.from('user_profiles').select('id, full_name, role, photo_url').order('full_name') : comCadastro
  const [atividades, compromissos, supervisoes, caixaR, visitasR] = await Promise.all([
    fetchAll<Atividade>(() => dele(supabase.from('activity_logs').select('id, user_id, activity_date, activity_name, notes, done'), 'user_id')
      .gte('activity_date', p.ini).lte('activity_date', p.fim).order('id')),
    fetchAll<Compromisso>(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from('interviews').select('id, title, category, scheduled_at, status, notes, recruiter_id, participant_ids, client:clients(name)')
        .gte('scheduled_at', `${p.ini}T00:00:00`).lte('scheduled_at', `${p.fim}T23:59:59`)   // hora de parede: sem fuso
      if (uid) q = q.or(`recruiter_id.eq.${uid},participant_ids.cs.{${uid}}`)
      return q.order('id')
    }),
    fetchAll<Supervisao>(() => dele(supabase.from('supervision_visits').select('*, client:clients(name)'), 'supervisor_id')
      .gte('visit_date', p.ini).lte('visit_date', p.fim).order('id')),
    // Caixa: tudo (o saldo vem de antes do período também)
    dele(supabase.from('equipe_caixa').select('*'), 'user_id').order('data'),
    // Visitas e supervisões registradas (pagas 076 e não pagas 099)
    dele(supabase.from('equipe_visitas').select('*, client:clients(name)'), 'user_id').gte('data', p.ini).lte('data', p.fim).order('data'),
  ])
  return {
    perfis: (perfisR.data || []) as Perfil[],
    atividades, compromissos, supervisoes,
    caixa: (caixaR.error ? [] : caixaR.data || []) as LancamentoCaixa[],
    caixaErro: !!caixaR.error,
    visitas: (visitasR.error ? [] : visitasR.data || []) as VisitaEquipe[],
    visitasErro: !!visitasR.error,
  }
}

function resumoDe(d: Dados, uid: string, p: Periodo) {
  const atividades = d.atividades.filter(a => a.user_id === uid)
  const compromissos = d.compromissos.filter(c => doUsuario(c, uid))
  const supervisoes = d.supervisoes.filter(s => s.supervisor_id === uid)
  const caixaDele = d.caixa.filter(c => c.user_id === uid)
  const visitas = d.visitas.filter(v => v.user_id === uid)
  const pagas = visitas.filter(v => ehPaga(v))
  return {
    atividades, compromissos, supervisoes, caixaDele, visitas,
    visitasPendentes: pagas.filter(v => v.status === 'pendente').length,
    valorVisitas: pagas.filter(v => v.status !== 'recusada').reduce((t, v) => t + (Number(v.valor) || 0), 0),
    // Horas feitas: só o que já aconteceu e tem entrada e saída (recusada não conta)
    minutosVisitas: visitas.filter(v => v.status !== 'recusada' && v.data <= hojeISO()).reduce((t, v) => t + (minutosDaVisita(v.entrada, v.saida) || 0), 0),
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
  const { profile, isContabilidade } = useAuth()
  // Cada um vê só o seu — nem o chefe abre o dos outros. Só a contabilidade vê todos (pedido de 02/10).
  const chefia = isContabilidade
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
          <p className="eyebrow mb-1">{chefia ? 'Operação' : 'Pessoal'}</p>
          <h1 className="page-title">{chefia && !pessoa ? 'Equipe' : 'Meu trabalho'}</h1>
          <p className="text-sm text-ink-500 mt-1">Seu calendário com atividades, reuniões, visitas e supervisões — e o relatório para entregar à chefe.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl border border-ink-200 bg-white p-0.5" title="Período do relatório e das listas">
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
          ? <PerfilEquipe uid={pessoa} periodo={periodo} proprio={pessoa === profile?.id} chefia={chefia} voltar={chefia ? () => ir({ pessoa: null }) : undefined} />
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
              <p className="text-xs text-ink-500">
                {ROTULO_PAPEL[m.role] || m.role}
                {r.visitasPendentes > 0 && <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{r.visitasPendentes} visita{r.visitasPendentes > 1 ? 's' : ''} para aprovar</span>}
              </p>
            </div>
            <div className="hidden sm:grid grid-cols-5 gap-4 text-center shrink-0">
              {([['Atividades', `${r.feitas}/${r.atividades.length}`], ['Reuniões', r.compromissos.length], ['Supervisões', r.supReal], ['Visitas', r.visitas.length], ['Compras', formatCurrency(r.movPeriodo.gasto)]] as const).map(([t, v]) => (
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
function PerfilEquipe({ uid, periodo, proprio, voltar, chefia }: { uid: string; periodo: Periodo; proprio: boolean; voltar?: () => void; chefia: boolean }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
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
  const [registrandoVisita, setRegistrandoVisita] = useState<InicialVisita | null>(null)
  const [recusando, setRecusando] = useState<{ id: string; motivo: string } | null>(null)
  const [comFotos, setComFotos] = useState(true)
  const [gerando, setGerando] = useState(false)

  // Cadastro de colaborador para o pagamento sair com nome, PIX e banco (só a chefia liga)
  const { data: colaboradores = [] } = useQuery({
    queryKey: ['colaboradores-lista-simples'],
    enabled: chefia,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, full_name, status').order('full_name')
      if (error) throw error
      return (data || []) as { id: string; full_name: string; status?: string }[]
    },
    staleTime: 5 * 60_000,
  })
  const ligarCadastro = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await supabase.from('user_profiles').update({ employee_id: employeeId || null }).eq('id', uid)
      if (error) throw new Error(/employee_id/.test(error.message) ? 'Falta rodar a migração 076 no Supabase.' : error.message)
    },
    onSuccess: () => { toast.success('Cadastro ligado'); qc.invalidateQueries({ queryKey: ['equipe'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const decidirVisita = useMutation({
    mutationFn: async ({ id, aprovar, motivo }: { id: string; aprovar: boolean; motivo?: string }) => {
      const { error } = aprovar
        ? await supabase.rpc('aprovar_visita_equipe', { p_id: id })
        : await supabase.rpc('recusar_visita_equipe', { p_id: id, p_motivo: motivo || null })
      if (error) throw error
    },
    onSuccess: (_d, v) => {
      toast.success(v.aprovar ? 'Visita aprovada — já está em Pagamentos' : 'Visita recusada')
      setRecusando(null)
      qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['avisos-sino'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const apagarVisita = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('equipe_visitas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Apagado'); qc.invalidateQueries({ queryKey: ['equipe'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const pedirApagar = async (v: VisitaEquipe) => {
    if (await confirmar({ titulo: `Apagar esta ${ROTULO_TIPO_VISITA[tipoDaVisita(v)].toLowerCase()}?`, texto: `${formatDate(v.data)} · ${v.client?.name || nomeCliente(v.client_id) || 'Cliente'}`, confirmar: 'Apagar', perigo: true }))
      apagarVisita.mutate(v.id)
  }

  // Atividade: marcar feita / não feita aqui mesmo (tocar de novo desmarca)
  const marcarAtividade = useMutation({
    mutationFn: async ({ id, v }: { id: string; v: boolean | null }) => {
      const { error } = await supabase.from('activity_logs').update({ done: v }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['activity-logs-day'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

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
  const podeRegistrar = proprio && !data.visitasErro

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
        visitas: r.visitas.map(v => ({
          data: v.data, tipo: ROTULO_TIPO_VISITA[tipoDaVisita(v)], cliente: v.client?.name || nomeCliente(v.client_id) || 'Cliente', unidade: v.unidade,
          horario: v.entrada && v.saida ? `${v.entrada.slice(0, 5)}–${v.saida.slice(0, 5)}` : null, minutos: minutosDaVisita(v.entrada, v.saida),
          paga: ehPaga(v), valor: Number(v.valor) || 0, situacao: ROTULO_SITUACAO_VISITA[situacao(v)],
          temRelatorio: !!v.relatorio, obs: [v.observacoes, v.motivo_recusa ? `recusada: ${v.motivo_recusa}` : null].filter(Boolean).join(' · ') || null,
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
        {podeRegistrar && <button className="btn-secondary text-sm" onClick={() => setRegistrandoVisita({})}><Plus size={15} />Registrar</button>}
        <label className="flex items-center gap-1.5 text-xs text-ink-600">
          <input type="checkbox" checked={comFotos} onChange={e => setComFotos(e.target.checked)} /> fotos dos comprovantes
        </label>
        <button className="btn-primary text-sm" disabled={gerando} onClick={baixar}><FileDown size={15} />{gerando ? 'Gerando…' : 'Baixar relatório'}</button>
      </div>

      {/* Calendário grande do mês: tudo da pessoa */}
      <MeuCalendario uid={uid} periodo={periodo} nomeCliente={nomeCliente}
        registrar={podeRegistrar ? ini => setRegistrandoVisita(ini) : undefined}
        apagar={proprio ? pedirApagar : undefined} marcar={proprio ? (id, v) => marcarAtividade.mutate({ id, v }) : undefined} />

      {/* Resumo do período */}
      <div className="card grid grid-cols-2 md:grid-cols-5 divide-x divide-ink-100 overflow-hidden">
        {([
          ['Atividades', `${r.feitas} de ${r.atividades.length}`, 'feitas'],
          ['Reuniões e compromissos', String(r.compromissos.length), 'no período'],
          ['Visitas e supervisões', String(r.visitas.length), r.minutosVisitas ? `${horasTexto(r.minutosVisitas)} registradas` : 'registradas'],
          ['Supervisões (agenda)', String(r.supReal), `realizada${r.supReal === 1 ? '' : 's'} de ${r.supervisoes.length}`],
          ['Compras', formatCurrency(r.movPeriodo.gasto), textoDoSaldo(r.saldoAgora.saldo, formatCurrency)],
        ] as const).map(([t, v, s]) => (
          <div key={t} className="px-4 py-3">
            <p className="text-[11px] text-ink-500">{t}</p>
            <p className="text-lg font-semibold text-ink-900 tnum">{v}</p>
            <p className="text-[11px] text-ink-400 truncate">{s}</p>
          </div>
        ))}
      </div>

      {/* Visitas e supervisões registradas — não pagas (099) e pagas (076) */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink-900">Visitas e supervisões</p>
            <p className="text-xs text-ink-500">
              {r.visitas.length} no período{r.minutosVisitas ? ` · ${horasTexto(r.minutosVisitas)}` : ''}
              {r.valorVisitas > 0 ? ` · pagas ${formatCurrency(r.valorVisitas)}` : ''}{r.visitasPendentes ? ` · ${r.visitasPendentes} aguardando aprovação` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {chefia && !data.visitasErro && (
              <select className="input w-auto text-xs py-1.5" title="Cadastro de colaborador para o pagamento das visitas pagas (nome, PIX e banco)"
                value={perfil?.employee_id || ''} onChange={e => ligarCadastro.mutate(e.target.value)} disabled={ligarCadastro.isPending}>
                <option value="">Recebe como: (sem cadastro ligado)</option>
                {colaboradores.filter(c => c.status === 'Ativo' || c.id === perfil?.employee_id).map(c => <option key={c.id} value={c.id}>Recebe como: {c.full_name}</option>)}
              </select>
            )}
            {podeRegistrar && <button className="btn-primary text-sm" onClick={() => setRegistrandoVisita({})}><Plus size={15} />Registrar</button>}
          </div>
        </div>
        {data.visitasErro ? <p className="px-4 py-4 text-sm text-amber-700">Para registrar visita, rode a migração 076 no Supabase.</p>
          : r.visitas.length === 0 ? <Vazio texto={proprio ? 'Nada registrado neste período. Toque em Registrar ou num dia do calendário.' : 'Nada registrado neste período.'} />
          : (
            <div className="divide-y divide-ink-100">
              {r.visitas.map(v => {
                const sit = situacao(v), tp = tipoDaVisita(v), paga = ehPaga(v)
                return (
                  <div key={v.id} className="px-4 py-2.5 flex items-start gap-3">
                    <p className="w-14 shrink-0 text-xs font-semibold text-ink-700 pt-0.5">{formatDate(v.data).slice(0, 5)}</p>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-900">
                        <span className={`mr-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${COR_TIPO[tp]}`}>{ROTULO_TIPO_VISITA[tp]}</span>
                        {v.client?.name || nomeCliente(v.client_id) || 'Cliente'}{v.unidade ? ` · ${v.unidade}` : ''}
                      </p>
                      <p className="text-xs text-ink-500">{[horarioDaVisita(v), v.observacoes].filter(Boolean).join(' · ')}</p>
                      {v.motivo_recusa && <p className="text-xs text-red-600">Recusada: {v.motivo_recusa}</p>}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR_SITUACAO[sit]}`}>{ROTULO_SITUACAO_VISITA[sit]}</span>
                        {proprio && editavel(v) && <button className="text-[11px] underline text-ink-500 inline-flex items-center gap-0.5" onClick={() => setRegistrandoVisita(paraEditar(v))}><Pencil size={10} />editar</button>}
                        {proprio && <button className="text-[11px] underline text-ink-500 inline-flex items-center gap-0.5" title="Registrar de novo em outro dia com os mesmos dados" onClick={() => setRegistrandoVisita(paraRepetir(v))}><Repeat size={10} />repetir</button>}
                        {v.relatorio && <SignedLink value={v.relatorio} bucket="arquivos" className="text-[11px] underline text-ink-500 inline-flex items-center gap-1"><FileText size={11} />relatório</SignedLink>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {paga ? <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(Number(v.valor) || 0)}</p> : <p className="text-[11px] text-ink-400">não paga</p>}
                      {chefia && paga && v.status === 'pendente' && sit !== 'programada' && (
                        <div className="flex gap-1">
                          <button className="btn-primary text-[11px] py-1 px-2" disabled={decidirVisita.isPending}
                            onClick={async () => { if (await confirmar({ titulo: `Aprovar a visita de ${formatCurrency(Number(v.valor) || 0)}?`, texto: 'Ela vira um lançamento em Pagamentos (dia 20 para visita até o dia 15; dia 8 do mês seguinte depois disso).', confirmar: 'Aprovar' })) decidirVisita.mutate({ id: v.id, aprovar: true }) }}>Aprovar</button>
                          <button className="btn-secondary text-[11px] py-1 px-2" disabled={decidirVisita.isPending} onClick={() => setRecusando({ id: v.id, motivo: '' })}>Recusar</button>
                        </div>
                      )}
                      {proprio && editavel(v) && (
                        <button className="p-1 text-ink-400 hover:text-red-600" aria-label="Apagar" disabled={apagarVisita.isPending} onClick={() => pedirApagar(v)}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* Atividades por dia */}
      <Secao titulo="Atividades" info={`${r.feitas} feita(s) · ${r.atividades.filter(a => a.done === false).length} não feita(s)`}
        acao={proprio ? <button className="btn-secondary text-xs py-1.5" onClick={() => setRegistrandoVisita({ qual: 'atividade' })}><Plus size={13} />Atividade</button> : undefined}>
        {r.atividades.length === 0 ? <Vazio texto="Nenhuma atividade no período." /> : [...atividadesPorDia].map(([dia, lista]) => (
          <div key={dia} className="px-4 py-2.5">
            <p className="text-xs font-semibold text-ink-500 first-letter:uppercase mb-1">{diaLongo(dia)}</p>
            {lista.map(a => <LinhaAtividade key={a.id} a={a} marcar={proprio ? v => marcarAtividade.mutate({ id: a.id, v }) : undefined} />)}
          </div>
        ))}
      </Secao>

      {/* Reuniões e compromissos */}
      <Secao titulo="Reuniões e compromissos" info={`${r.compromissos.length}`}
        acao={proprio ? <button className="btn-secondary text-xs py-1.5" onClick={() => setRegistrandoVisita({ qual: 'reuniao' })}><Plus size={13} />Reunião</button> : undefined}>
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
                {proprio && <button className="text-[11px] underline text-ink-500 inline-flex items-center gap-0.5" onClick={() => navigate(`/agenda/${c.id}/editar`)}><Pencil size={10} />editar</button>}
              </div>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${/realiz/i.test(c.status || '') ? 'bg-green-50 text-green-700' : /cancel|falt/i.test(c.status || '') ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{c.status || 'Agendada'}</span>
            </div>
          ))}
      </Secao>

      {/* Supervisões da agenda da Supervisão */}
      <Secao titulo="Supervisões da agenda" info={`${r.supReal} realizada(s) de ${r.supervisoes.length}`}>
        {r.supervisoes.length === 0 ? <Vazio texto="Nenhuma supervisão da agenda no período." /> :
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
      {registrandoVisita && <Registrar uid={uid} clientes={clientes} inicial={registrandoVisita} fechar={() => setRegistrandoVisita(null)} />}
      {recusando && (
        <div className="modal-overlay" onClick={() => setRecusando(null)}>
          <div className="modal-box max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-ink-900">Recusar visita</h3>
            <textarea className="input" rows={3} placeholder="Motivo (ela vê no relatório)" value={recusando.motivo}
              onChange={e => setRecusando(p => p ? { ...p, motivo: e.target.value } : p)} />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setRecusando(null)}>Cancelar</button>
              <button className="btn-danger flex-1" disabled={decidirVisita.isPending} onClick={() => decidirVisita.mutate({ id: recusando.id, aprovar: false, motivo: recusando.motivo })}>Recusar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LinhaAtividade({ a, marcar }: { a: Atividade; marcar?: (v: boolean | null) => void }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${a.done === true ? 'bg-green-600' : a.done === false ? 'bg-red-500' : 'border border-ink-300'}`}>
        {a.done === true && <Check size={10} className="text-white" strokeWidth={3} />}
        {a.done === false && <X size={10} className="text-white" strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <p className={`text-sm ${a.done === false ? 'text-ink-500' : 'text-ink-800'}`}>{a.activity_name}</p>
        {a.notes && <p className="text-xs text-ink-400">{a.notes}</p>}
      </div>
      {marcar && (
        <div className="ml-auto flex rounded-lg border border-ink-200 overflow-hidden text-[11px] shrink-0">
          <button onClick={() => marcar(a.done === true ? null : true)} title="Feita"
            className={`px-2 py-1 font-medium ${a.done === true ? 'bg-green-600 text-white' : 'bg-white text-ink-500 hover:bg-green-50'}`}>✓ Feita</button>
          <button onClick={() => marcar(a.done === false ? null : false)} title="Não feita"
            className={`px-2 py-1 font-medium border-l border-ink-200 ${a.done === false ? 'bg-red-500 text-white' : 'bg-white text-ink-500 hover:bg-red-50'}`}>✕ Não</button>
        </div>
      )}
    </div>
  )
}

function Secao({ titulo, info, acao, children }: { titulo: string; info?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0 flex-wrap">
          <p className="text-sm font-semibold text-ink-900">{titulo}</p>
          {info && <p className="text-xs text-ink-500">{info}</p>}
        </div>
        {acao}
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

// ── Registrar visita (= vistoria) ou supervisão (a própria pessoa) ────────
// Como no portal: cliente, unidade, dia, entrada e saída, relatório. Não paga
// por padrão (099): não calcula nada, entra no relatório e no calendário.
function FormVisita({ uid, clientes, inicial, tipo, mudarTipo, fechar }: {
  uid: string; clientes: { id: string; name: string }[]; inicial: InicialVisita
  tipo: TipoVisitaEquipe; mudarTipo: (t: TipoVisitaEquipe) => void; fechar: () => void
}) {
  const qc = useQueryClient()
  const editando = !!inicial.id
  const [paga, setPaga] = useState(inicial.paga ?? false)
  const [cliente, setCliente] = useState(inicial.cliente || '')
  const [unidade, setUnidade] = useState(inicial.unidade || '')
  const [data, setData] = useState(inicial.data || hojeISO())
  const [entrada, setEntrada] = useState(inicial.entrada || '')
  const [saida, setSaida] = useState(inicial.saida || '')
  const [valor, setValor] = useState(inicial.valor || '')
  const [obs, setObs] = useState(inicial.obs || '')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [guardarModelo, setGuardarModelo] = useState(false)

  // Unidades do cliente (como no portal); cliente sem unidade: escreve à mão
  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades-do-cliente', cliente],
    enabled: !!cliente,
    queryFn: async () => {
      const { data, error } = await supabase.from('client_units').select('id, name').eq('client_id', cliente).order('name')
      if (error) throw error
      return (data || []) as { id: string; name: string }[]
    },
  })
  // Modelos (078): cliente, unidade, tipo e horário prontos para repetir
  const { data: modelos = [], error: modelosErro } = useQuery({
    queryKey: ['equipe-modelos', uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('equipe_modelos_visita').select('*').eq('user_id', uid).order('criado_em')
      if (error) throw error
      return (data || []) as ModeloVisita[]
    },
    retry: false,
  })
  const nomeCli = (id?: string | null) => clientes.find(c => c.id === id)?.name || 'Cliente'
  const usarModelo = (m: ModeloVisita) => {
    setCliente(m.client_id || ''); setUnidade(m.unidade || ''); mudarTipo(tipoDaVisita(m)); setPaga(ehPaga(m))
    setValor(m.valor != null ? String(m.valor).replace('.', ',') : '')
    setEntrada((m.entrada || '').slice(0, 5)); setSaida((m.saida || '').slice(0, 5)); setObs(m.observacoes || '')
    setGuardarModelo(false)
  }
  const apagarModelo = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('equipe_modelos_visita').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['equipe-modelos', uid] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const futura = data > hojeISO()
  const minutos = minutosDaVisita(entrada, saida)
  const nomeTipo = ROTULO_TIPO_VISITA[tipo]

  const salvar = useMutation({
    mutationFn: async () => {
      if (!cliente) throw new Error('Escolha o cliente')
      if (!!entrada !== !!saida) throw new Error('Informe a entrada e a saída, ou deixe as duas em branco')
      // Já aconteceu e não é paga: o registro é das horas, como no portal
      if (!paga && !futura && !entrada) throw new Error('Coloque o horário em que você entrou e saiu')
      let v: number | null = null
      if (paga) {
        v = Number(valor.replace(/\./g, '').replace(',', '.'))
        if (!(v > 0)) throw new Error('Informe o valor da visita paga')
        v = Math.round(v * 100) / 100
      }
      let relatorio: string | null = null
      if (arquivo) {
        // Foto diminuída antes de subir (continua legível). PDF vai igual.
        const f = await comprimirImagem(arquivo)
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase()
        const caminho = `visitas-equipe/${uid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('arquivos').upload(caminho, f, { upsert: false, contentType: f.type || undefined })
        if (upErr) throw new Error('O relatório não subiu: ' + upErr.message)
        relatorio = caminho
      }
      // Sem a migração 099 só existe a visita paga: os campos novos vão só quando precisam
      const novos = { ...(!paga || inicial.paga === false ? { paga } : {}), ...(tipo !== 'visita' || (inicial.tipo && inicial.tipo !== 'visita') ? { tipo } : {}) }
      const registro = {
        client_id: cliente, unidade: unidade.trim() || null, data, entrada: entrada || null, saida: saida || null,
        valor: v, observacoes: obs.trim() || null, status: paga ? 'pendente' : 'registrada', ...novos,
        ...(relatorio ? { relatorio } : {}),
      }
      const { error } = editando
        ? await supabase.from('equipe_visitas').update(registro).eq('id', inicial.id!)
        : await supabase.from('equipe_visitas').insert({ user_id: uid, ...registro })
      if (error) {
        if (/paga|tipo|registrada|status_ok|valor_ok|tipo_ok|null value in column "valor"/i.test(error.message))
          throw new Error('Falta rodar a migração 099 no Supabase (visita sem pagamento).')
        throw new Error(/equipe_visitas/.test(error.message) ? 'Falta rodar a migração 076 no Supabase.' : error.message)
      }
      if (guardarModelo && !modelosErro) {
        const { error: eM } = await supabase.from('equipe_modelos_visita').insert({
          user_id: uid, client_id: cliente, unidade: unidade.trim() || null, valor: v,
          entrada: entrada || null, saida: saida || null, observacoes: obs.trim() || null, ...novos,
        })
        if (eM) toast.error('O modelo não foi guardado: ' + eM.message)
        qc.invalidateQueries({ queryKey: ['equipe-modelos', uid] })
      }
    },
    onSuccess: () => {
      toast.success(editando ? 'Alterado' : futura ? `${nomeTipo} programada` : paga ? 'Visita registrada — aguardando aprovação da contabilidade' : `${nomeTipo} registrada — já está no relatório e no calendário`)
      qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['avisos-sino'] }); qc.invalidateQueries({ queryKey: ['cal-equipe-visitas'] })
      fechar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
        <div>
          <h3 className="text-lg font-semibold text-ink-900">{editando ? `Editar ${nomeTipo.toLowerCase()}` : futura ? `Programar ${nomeTipo.toLowerCase()}` : `Registrar ${nomeTipo.toLowerCase()}`}</h3>
          <p className="text-xs text-ink-500">{paga ? 'Paga: depois do dia, a contabilidade aprova e ela entra em Pagamentos.' : 'Não paga: não calcula nada — entra no seu relatório e no calendário.'}</p>
        </div>
        {modelos.length > 0 && !editando && (
          <div>
            <label className="label">Usar um modelo</label>
            <div className="flex flex-wrap gap-1.5">
              {modelos.map(m => (
                <span key={m.id} className="inline-flex items-center rounded-full border border-ink-200 bg-white text-xs">
                  <button type="button" className="pl-3 pr-1.5 py-1.5 text-ink-800" onClick={() => usarModelo(m)}>
                    {ROTULO_TIPO_VISITA[tipoDaVisita(m)]} · {nomeCli(m.client_id)}{m.unidade ? ` · ${m.unidade}` : ''}{ehPaga(m) && m.valor ? ` · ${formatCurrency(Number(m.valor) || 0)}` : ''}{m.entrada && m.saida ? ` · ${m.entrada.slice(0, 5)}–${m.saida.slice(0, 5)}` : ''}
                  </button>
                  <button type="button" className="pr-2 pl-1 py-1.5 text-ink-400 hover:text-red-600" aria-label="Apagar modelo"
                    onClick={async () => { if (await confirmar({ titulo: 'Apagar este modelo?', texto: 'O que já foi registrado continua.', confirmar: 'Apagar' })) apagarModelo.mutate(m.id) }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className="label">Cliente *</label>
          <select className="input" value={cliente} onChange={e => { setCliente(e.target.value); setUnidade('') }}>
            <option value="">Escolha…</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Unidade <span className="text-ink-400 font-normal">— opcional</span></label>
          {unidades.length > 0 ? (
            <select className="input" value={unidade} onChange={e => setUnidade(e.target.value)}>
              <option value="">Nenhuma / todas</option>
              {unidades.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              {unidade && !unidades.some(u => u.name === unidade) && <option value={unidade}>{unidade}</option>}
            </select>
          ) : <input className="input" value={unidade} onChange={e => setUnidade(e.target.value)} placeholder="Ex.: Unidade Centro" />}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">Dia *</label><input className="input" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
          <div><label className="label">Entrada {!paga && !futura ? '*' : <span className="text-ink-400 font-normal">opc.</span>}</label><input className="input" type="time" value={entrada} onChange={e => setEntrada(e.target.value)} /></div>
          <div><label className="label">Saída {!paga && !futura ? '*' : <span className="text-ink-400 font-normal">opc.</span>}</label><input className="input" type="time" value={saida} onChange={e => setSaida(e.target.value)} /></div>
        </div>
        {minutos != null && <p className="text-xs text-ink-500 -mt-2">{horasTexto(minutos)} no cliente</p>}
        <div>
          <label className="label">Relatório <span className="text-ink-400 font-normal">— opcional, foto ou PDF{editando ? ' (só se for trocar)' : ''}</span></label>
          <input type="file" accept="image/*,application/pdf" className="input" onChange={e => setArquivo(e.target.files?.[0] || null)} />
        </div>
        <div>
          <label className="label">Observações <span className="text-ink-400 font-normal">— opcional</span></label>
          <textarea className="input" rows={2} value={obs} onChange={e => setObs(e.target.value)} placeholder="O que foi feito, pendências do cliente…" />
        </div>
        <div className="rounded-xl border border-ink-200 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-800">
            <input type="checkbox" checked={paga} onChange={e => setPaga(e.target.checked)} disabled={editando && inicial.paga === true} />
            Esta visita é paga
            <span className="text-xs text-ink-400">— vai para aprovação da contabilidade</span>
          </label>
          {paga && (
            <div>
              <label className="label">Valor da visita *</label>
              <input className="input tnum" inputMode="decimal" placeholder="0,00" value={valor} onChange={e => setValor(e.target.value)} />
            </div>
          )}
        </div>
        {!modelosErro && !editando && (
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" checked={guardarModelo} onChange={e => setGuardarModelo(e.target.checked)} />
            Guardar como modelo para registrar de novo
          </label>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : editando ? 'Salvar' : futura ? 'Programar' : 'Registrar'}</button>
        </div>
    </>
  )
}

// ── Registrar: tudo num lugar só (pedido de 19/10/2026: "tem que facilitar,
// direto ao ponto") — visita/vistoria, supervisão, reunião/compromisso e atividade
type Qual = 'visita' | 'supervisao' | 'reuniao' | 'atividade'
const ROTULO_QUAL: Record<Qual, string> = { visita: 'Visita / vistoria', supervisao: 'Supervisão', reuniao: 'Reunião', atividade: 'Atividade' }

function Registrar({ uid, clientes, inicial, fechar }: { uid: string; clientes: { id: string; name: string }[]; inicial: InicialVisita; fechar: () => void }) {
  const editando = !!inicial.id
  const [qual, setQual] = useState<Qual>(inicial.qual || inicial.tipo || 'visita')
  // Editando uma visita, só dá para trocar entre visita e supervisão
  const opcoes: Qual[] = editando ? ['visita', 'supervisao'] : ['visita', 'supervisao', 'reuniao', 'atividade']
  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-md space-y-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className={`grid gap-1 p-1 rounded-xl bg-ink-100/70 ${opcoes.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
          {opcoes.map(k => (
            <button key={k} type="button" onClick={() => setQual(k)}
              className={`h-9 px-1 rounded-lg text-[13px] font-medium leading-tight ${qual === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{ROTULO_QUAL[k]}</button>
          ))}
        </div>
        {qual === 'reuniao' ? <FormReuniao uid={uid} clientes={clientes} dia={inicial.data} fechar={fechar} />
          : qual === 'atividade' ? <FormAtividade uid={uid} dia={inicial.data} fechar={fechar} />
          : <FormVisita uid={uid} clientes={clientes} inicial={inicial} tipo={qual} mudarTipo={setQual} fechar={fechar} />}
      </div>
    </div>
  )
}

// Reunião ou compromisso — o mesmo que a tela de Reuniões grava (interviews),
// com você já como participante
const TIPOS_REUNIAO = ['Reunião', 'Compromisso', 'Treinamento', 'Ligação', 'Outro'] as const
function FormReuniao({ uid, clientes, dia, fechar }: { uid: string; clientes: { id: string; name: string }[]; dia?: string; fechar: () => void }) {
  const qc = useQueryClient()
  const [categoria, setCategoria] = useState<typeof TIPOS_REUNIAO[number]>('Reunião')
  const [titulo, setTitulo] = useState('')
  const [data, setData] = useState(dia || hojeISO())
  const [horaIni, setHoraIni] = useState('')
  const [duracao, setDuracao] = useState('60')
  const [modalidade, setModalidade] = useState('Online')
  const [link, setLink] = useState('')
  const [cliente, setCliente] = useState('')
  const [outros, setOutros] = useState<string[]>([])
  const [notas, setNotas] = useState('')
  const jaFoi = data < hojeISO()
  const [situacao, setSituacao] = useState<'Agendada' | 'Realizada' | null>(null)
  const status = situacao || (jaFoi ? 'Realizada' : 'Agendada')
  const ehCompromisso = categoria === 'Compromisso'
  const { data: pessoas = [] } = useQuery({
    queryKey: ['user-profiles-nomes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_profiles').select('id, full_name').order('full_name')
      if (error) throw error
      return (data || []) as { id: string; full_name: string }[]
    },
    staleTime: 5 * 60_000,
  })

  const salvar = useMutation({
    mutationFn: async () => {
      if (!titulo.trim()) throw new Error(ehCompromisso ? 'Escreva o que é o compromisso' : 'Escreva o assunto')
      if (!data || !horaIni) throw new Error('Escolha o dia e a hora')
      // Hora de parede (sem fuso), como a tela de Reuniões grava
      const { error } = await supabase.from('interviews').insert({
        title: titulo.trim(), category: categoria, client_id: cliente || null,
        recruiter_id: uid, participant_ids: [uid, ...outros.filter(p => p !== uid)],
        scheduled_at: `${data}T${horaIni}`, duration_min: ehCompromisso ? 60 : Number(duracao),
        modality: ehCompromisso ? 'Presencial' : modalidade, link_or_address: ehCompromisso ? null : (link.trim() || null),
        notes: notas.trim() || null, status,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`${categoria} ${status === 'Realizada' ? 'registrada' : 'agendada'} — já está no seu calendário`)
      qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['interviews'] })
      fechar()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <div>
        <h3 className="text-lg font-semibold text-ink-900">{ehCompromisso ? 'Compromisso' : 'Reunião'}</h3>
        <p className="text-xs text-ink-500">Entra no seu calendário, no relatório e na tela de Reuniões.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TIPOS_REUNIAO.map(c => (
          <button key={c} type="button" onClick={() => { setCategoria(c); if (c === 'Ligação') setModalidade('Telefone') }}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border-2 ${categoria === c ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-ink-200 text-ink-500 hover:border-ink-300'}`}>{c}</button>
        ))}
      </div>
      <div>
        <label className="label">{ehCompromisso ? 'O que é *' : 'Assunto *'}</label>
        <input className="input" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder={ehCompromisso ? 'Ex.: Consulta médica, viagem para o cliente…' : 'Ex.: Alinhamento com o cliente, reunião de equipe…'} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Dia *</label><input className="input" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
        <div><label className="label">Hora *</label><input className="input" type="time" value={horaIni} onChange={e => setHoraIni(e.target.value)} /></div>
      </div>
      {!ehCompromisso && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Duração</label>
              <select className="input" value={duracao} onChange={e => setDuracao(e.target.value)}>
                {['30', '45', '60', '90', '120'].map(m => <option key={m} value={m}>{Number(m) >= 60 ? `${Number(m) / 60}h`.replace('.5h', 'h30') : `${m} min`}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Como</label>
              <select className="input" value={modalidade} onChange={e => setModalidade(e.target.value)}>
                <option>Online</option><option>Presencial</option><option>Telefone</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">Link ou endereço <span className="text-ink-400 font-normal">— opcional</span></label>
            <input className="input" value={link} onChange={e => setLink(e.target.value)} placeholder="Link do Meet/Teams/Zoom ou o endereço" />
          </div>
          <div>
            <label className="label">Quem mais vai <span className="text-ink-400 font-normal">— você já está</span></label>
            <div className="flex flex-wrap gap-1.5">
              {pessoas.filter(p => p.id !== uid).map(p => {
                const on = outros.includes(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => setOutros(o => on ? o.filter(x => x !== p.id) : [...o, p.id])}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border ${on ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-ink-200 text-ink-500'}`}>{p.full_name.split(' ')[0]}</button>
                )
              })}
            </div>
          </div>
        </>
      )}
      <div>
        <label className="label">Cliente <span className="text-ink-400 font-normal">— opcional</span></label>
        <select className="input" value={cliente} onChange={e => setCliente(e.target.value)}>
          <option value="">Nenhum</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Notas <span className="text-ink-400 font-normal">— opcional</span></label>
        <textarea className="input" rows={2} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Pauta, o que foi decidido…" />
      </div>
      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit">
        {(['Agendada', 'Realizada'] as const).map(s => (
          <button key={s} type="button" onClick={() => setSituacao(s)}
            className={`px-3 h-8 rounded-lg text-sm font-medium ${status === s ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{s === 'Agendada' ? 'Vai acontecer' : 'Já aconteceu'}</button>
        ))}
      </div>
      <div className="flex flex-col-reverse sm:flex-row gap-2">
        <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
        <button className="btn-primary flex-1" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : status === 'Realizada' ? 'Registrar' : 'Agendar'}</button>
      </div>
    </>
  )
}

// Atividade — o mesmo checklist da tela de Atividades (activity_logs), com a
// sua lista pronta; "Outro" entra na lista para a próxima vez
function FormAtividade({ uid, dia, fechar }: { uid: string; dia?: string; fechar: () => void }) {
  const qc = useQueryClient()
  const [data, setData] = useState(dia || hojeISO())
  const [escolhida, setEscolhida] = useState('')
  const [outro, setOutro] = useState(false)
  const [texto, setTexto] = useState('')
  const [notas, setNotas] = useState('')
  const [feitaEscolha, setFeitaEscolha] = useState<boolean | null | undefined>(undefined)
  // Padrão: o que já passou (ou é hoje) entra como feito; dia futuro, a fazer
  const feita = feitaEscolha === undefined ? (data <= hojeISO() ? true : null) : feitaEscolha
  const { data: tipos = [] } = useQuery({
    queryKey: ['activity-types', uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_types').select('id, name').eq('user_id', uid).order('name')
      if (error) throw error
      return (data || []) as { id: string; name: string }[]
    },
  })
  const salvar = useMutation({
    mutationFn: async () => {
      const nome = (outro ? texto : escolhida).trim()
      if (!nome) throw new Error('Escolha ou escreva a atividade')
      const { error } = await supabase.from('activity_logs').insert({
        user_id: uid, activity_date: data, activity_name: nome, notes: notas.trim() || null, done: feita, assigned_by: uid,
      })
      if (error) throw error
      if (outro && !tipos.some(t => t.name.toLowerCase() === nome.toLowerCase())) {
        await supabase.from('activity_types').insert({ name: nome, user_id: uid })
      }
    },
    onSuccess: () => {
      toast.success('Atividade registrada')
      qc.invalidateQueries({ queryKey: ['equipe'] }); qc.invalidateQueries({ queryKey: ['activity-types', uid] }); qc.invalidateQueries({ queryKey: ['activity-logs-day'] })
      fechar()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <>
      <div>
        <h3 className="text-lg font-semibold text-ink-900">Atividade</h3>
        <p className="text-xs text-ink-500">Entra no seu checklist do dia, no calendário e no relatório.</p>
      </div>
      <div><label className="label">Dia *</label><input className="input" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
      <div>
        <label className="label">Qual atividade *</label>
        <div className="flex flex-wrap gap-1.5">
          {tipos.map(t => (
            <button key={t.id} type="button" onClick={() => { setEscolhida(t.name); setOutro(false) }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${!outro && escolhida === t.name ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-ink-200 text-ink-600 hover:border-primary-300'}`}>{t.name}</button>
          ))}
          <button type="button" onClick={() => { setOutro(true); setEscolhida('') }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${outro ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-dashed border-ink-300 text-ink-500'}`}>+ Outra</button>
        </div>
        {outro && <input className="input mt-2" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Descreva (fica salva na sua lista)" autoFocus />}
      </div>
      <div>
        <label className="label">Observação <span className="text-ink-400 font-normal">— opcional</span></label>
        <textarea className="input" rows={2} value={notas} onChange={e => setNotas(e.target.value)} />
      </div>
      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit">
        {([[true, 'Feita'], [null, 'A fazer']] as const).map(([v, t]) => (
          <button key={t} type="button" onClick={() => setFeitaEscolha(v)}
            className={`px-3 h-8 rounded-lg text-sm font-medium ${feita === v ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
        ))}
      </div>
      <div className="flex flex-col-reverse sm:flex-row gap-2">
        <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
        <button className="btn-primary flex-1" disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? 'Salvando…' : 'Registrar'}</button>
      </div>
    </>
  )
}

// ── Calendário grande do mês (pedido de 19/10/2026) ───────────────────────
// Tudo da pessoa: visitas e supervisões registradas, supervisões da
// agenda da Supervisão, reuniões e compromissos, e as atividades do dia.
type ItemDia = { chave: string; ordem: string; cor: string; ponto: string; texto: string }
const COR_CAL = {
  visita: { cor: 'bg-emerald-100 text-emerald-900', ponto: 'bg-emerald-500' },
  supervisao: { cor: 'bg-teal-100 text-teal-900', ponto: 'bg-teal-500' },
  programada: { cor: 'bg-sky-100 text-sky-900', ponto: 'bg-sky-500' },
  sem_horario: { cor: 'bg-amber-100 text-amber-900', ponto: 'bg-amber-500' },
  recusada: { cor: 'bg-red-50 text-red-700 line-through', ponto: 'bg-red-500' },
  agenda: { cor: 'bg-violet-100 text-violet-900', ponto: 'bg-violet-500' },
  reuniao: { cor: 'bg-blue-100 text-blue-900', ponto: 'bg-blue-500' },
  atividades: { cor: 'bg-ink-100 text-ink-700', ponto: 'bg-ink-400' },
  atividadesOk: { cor: 'bg-green-100 text-green-800', ponto: 'bg-green-600' },
} as const

function MeuCalendario({ uid, periodo, nomeCliente, registrar, apagar, marcar }: {
  uid: string; periodo: Periodo; nomeCliente: (id?: string | null) => string
  registrar?: (inicial: InicialVisita) => void; apagar?: (v: VisitaEquipe) => void
  marcar?: (atividadeId: string, v: boolean | null) => void
}) {
  const navigate = useNavigate()
  const [mes, setMes] = useState(() => mesDoPeriodo(periodo))
  // Andou o período lá em cima: o calendário acompanha
  useEffect(() => { setMes(mesDoPeriodo(periodo)) }, [periodo.ini, periodo.tipo]) // eslint-disable-line react-hooks/exhaustive-deps
  const grade = useMemo(() => gradeDoMes(mes), [mes])
  const { data, isLoading } = useQuery({ queryKey: ['equipe', grade.ini, grade.fim, uid], queryFn: () => carregar(grade, uid) })
  const [aberto, setAberto] = useState<string | null>(null)
  const hoje = hojeISO()
  const [a, m] = mes.split('-').map(Number)
  const nomeMes = new Date(a, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const andar = (n: number) => { const d = new Date(a, m - 1 + n, 15); setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }

  const doDia = useMemo(() => {
    const out = new Map<string, { itens: ItemDia[]; visitas: VisitaEquipe[]; supervisoes: Supervisao[]; compromissos: Compromisso[]; atividades: Atividade[] }>()
    const de = (d: string) => {
      if (!out.has(d)) out.set(d, { itens: [], visitas: [], supervisoes: [], compromissos: [], atividades: [] })
      return out.get(d)!
    }
    if (!data) return out
    for (const v of data.visitas.filter(x => x.user_id === uid)) {
      const sit = situacao(v), tp = tipoDaVisita(v)
      const c = sit === 'recusada' ? COR_CAL.recusada : sit === 'programada' ? COR_CAL.programada : sit === 'sem_horario' ? COR_CAL.sem_horario : COR_CAL[tp]
      const d = de(v.data)
      d.visitas.push(v)
      d.itens.push({ chave: 'v' + v.id, ordem: (v.entrada || '99').slice(0, 5), ...c, texto: `${v.entrada ? v.entrada.slice(0, 5) + ' ' : ''}${ROTULO_TIPO_VISITA[tp]} · ${v.client?.name || nomeCliente(v.client_id) || 'Cliente'}` })
    }
    for (const s of data.supervisoes.filter(x => x.supervisor_id === uid)) {
      const d = de(s.visit_date)
      d.supervisoes.push(s)
      d.itens.push({ chave: 's' + s.id, ordem: '98', ...(s.status === 'nao_realizada' ? COR_CAL.recusada : COR_CAL.agenda), texto: `Supervisão · ${s.client?.name || 'Cliente'}` })
    }
    for (const c of data.compromissos.filter(x => doUsuario(x, uid))) {
      const d = de(c.scheduled_at.slice(0, 10))
      d.compromissos.push(c)
      d.itens.push({ chave: 'c' + c.id, ordem: hora(c.scheduled_at), ...COR_CAL.reuniao, texto: `${hora(c.scheduled_at)} ${c.title}` })
    }
    for (const at of data.atividades.filter(x => x.user_id === uid)) de(at.activity_date).atividades.push(at)
    for (const [, d] of out) {
      d.itens.sort((x, y) => x.ordem.localeCompare(y.ordem))
      if (d.atividades.length) {
        const feitas = d.atividades.filter(x => x.done === true).length
        d.itens.push({ chave: 'atv', ordem: '99', ...(feitas === d.atividades.length ? COR_CAL.atividadesOk : COR_CAL.atividades), texto: `Atividades ${feitas}/${d.atividades.length}` })
      }
    }
    return out
  }, [data, uid, nomeCliente])

  const dia = aberto ? doDia.get(aberto) : undefined
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button className="p-1.5 rounded-lg hover:bg-ink-100" aria-label="Mês anterior" onClick={() => andar(-1)}><ChevronLeft size={16} /></button>
          <p className="text-sm font-semibold text-ink-900 min-w-[9rem] text-center first-letter:uppercase">{nomeMes}</p>
          <button className="p-1.5 rounded-lg hover:bg-ink-100" aria-label="Próximo mês" onClick={() => andar(1)}><ChevronRight size={16} /></button>
          {isLoading && <span className="text-[11px] text-ink-400 ml-1">carregando…</span>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
          {([['visita', 'Visita'], ['supervisao', 'Supervisão'], ['programada', 'Programada'], ['sem_horario', 'Falta o horário'], ['agenda', 'Supervisão (agenda)'], ['reuniao', 'Reunião'], ['atividades', 'Atividades']] as const).map(([k, t]) => (
            <span key={k} className="inline-flex items-center gap-1"><i className={`w-2 h-2 rounded-full ${COR_CAL[k].ponto}`} />{t}</span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-ink-400 border-b border-ink-100">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(d => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {grade.dias.map(d => {
          const fora = d.slice(0, 7) !== mes
          const noPeriodo = periodo.tipo === 'semana' && d >= periodo.ini && d <= periodo.fim
          const itens = doDia.get(d)?.itens || []
          return (
            <button key={d} type="button" onClick={() => setAberto(d)}
              title={itens.length ? itens.map(i => i.texto).join('\n') : registrar ? 'Registrar ou programar neste dia' : undefined}
              className={`min-h-[4.25rem] sm:min-h-[7.5rem] border-b border-r border-ink-100 p-1 sm:p-1.5 text-left align-top transition-colors hover:bg-primary-50/50
                ${fora ? 'bg-ink-50/60 text-ink-300' : noPeriodo ? 'bg-primary-50/30' : ''}`}>
              <span className={`text-[11px] font-semibold ${d === hoje ? 'inline-flex w-5 h-5 items-center justify-center rounded-full bg-primary-600 text-white' : ''}`}>{Number(d.slice(8))}</span>
              {/* Celular: só as bolinhas; tocando no dia abre tudo */}
              <div className="sm:hidden mt-1 flex flex-wrap gap-0.5">
                {itens.slice(0, 6).map(i => <i key={i.chave} className={`w-1.5 h-1.5 rounded-full ${i.ponto}`} />)}
              </div>
              <div className="hidden sm:block mt-1 space-y-0.5">
                {itens.slice(0, 5).map(i => <p key={i.chave} className={`truncate rounded px-1 text-[10.5px] leading-4 ${i.cor} ${fora ? 'opacity-60' : ''}`}>{i.texto}</p>)}
                {itens.length > 5 && <p className="text-[10px] text-ink-500 px-1">+{itens.length - 5}</p>}
              </div>
            </button>
          )
        })}
      </div>
      <p className="px-4 py-2 text-[11px] text-ink-400">Toque num dia para ver tudo{registrar ? ' e registrar visita, supervisão, reunião ou atividade' : ''}.{periodo.tipo === 'semana' ? ' A semana do relatório fica destacada.' : ''}</p>

      {aberto && (
        <div className="modal-overlay" onClick={() => setAberto(null)}>
          <div className="modal-box max-w-lg space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-ink-500">Meu dia</p>
                <h3 className="text-lg font-semibold text-ink-900 first-letter:uppercase">{diaLongo(aberto)}</h3>
              </div>
              <button className="p-1 text-ink-400 hover:text-ink-700" onClick={() => setAberto(null)} aria-label="Fechar"><X size={18} /></button>
            </div>
            {registrar && (
              <div className="grid grid-cols-2 gap-2">
                {(['visita', 'supervisao', 'reuniao', 'atividade'] as const).map(k => (
                  <button key={k} className="btn-secondary text-sm justify-center" onClick={() => { setAberto(null); registrar({ data: aberto, qual: k }) }}>
                    <Plus size={14} />{ROTULO_QUAL[k]}
                  </button>
                ))}
              </div>
            )}
            {!dia || (!dia.visitas.length && !dia.supervisoes.length && !dia.compromissos.length && !dia.atividades.length)
              ? <p className="text-sm text-ink-500">Nada neste dia.</p>
              : (
                <div className="space-y-4">
                  {dia.visitas.length > 0 && (
                    <BlocoDia titulo="Visitas e supervisões">
                      {dia.visitas.map(v => {
                        const sit = situacao(v), tp = tipoDaVisita(v)
                        return (
                          <div key={v.id} className="py-2 flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-ink-900">
                                <span className={`mr-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${COR_TIPO[tp]}`}>{ROTULO_TIPO_VISITA[tp]}</span>
                                {v.client?.name || nomeCliente(v.client_id) || 'Cliente'}{v.unidade ? ` · ${v.unidade}` : ''}
                              </p>
                              <p className="text-xs text-ink-500">{[horarioDaVisita(v), ehPaga(v) ? `paga · ${formatCurrency(Number(v.valor) || 0)}` : 'não paga', v.observacoes].filter(Boolean).join(' · ')}</p>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${COR_SITUACAO[sit]}`}>{ROTULO_SITUACAO_VISITA[sit]}</span>
                                {v.relatorio && <SignedLink value={v.relatorio} bucket="arquivos" className="text-[11px] underline text-ink-500 inline-flex items-center gap-1"><FileText size={11} />relatório</SignedLink>}
                              </div>
                            </div>
                            {registrar && editavel(v) && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button className="btn-ghost text-xs py-1 px-2" onClick={() => { setAberto(null); registrar(paraEditar(v)) }}><Pencil size={12} />{sit === 'sem_horario' || sit === 'programada' ? 'Pôr horário' : 'Editar'}</button>
                                {apagar && <button className="p-1 text-ink-400 hover:text-red-600" aria-label="Apagar" onClick={() => apagar(v)}><Trash2 size={14} /></button>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </BlocoDia>
                  )}
                  {dia.supervisoes.length > 0 && (
                    <BlocoDia titulo="Supervisões da agenda" acao={{ rotulo: 'Abrir Supervisão', ir: () => navigate('/supervisao') }}>
                      {dia.supervisoes.map(s => (
                        <div key={s.id} className="py-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm text-ink-900">{s.client?.name || 'Cliente'}{s.unit_name ? ` · ${s.unit_name}` : ''}</p>
                            {(s.checked_in_at || s.observations) && <p className="text-xs text-ink-500">{[s.checked_in_at ? `check-in às ${hora(s.checked_in_at)}` : null, s.observations].filter(Boolean).join(' · ')}</p>}
                          </div>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${situacaoSup(s) === 'Realizada' ? 'bg-green-50 text-green-700' : situacaoSup(s) === 'Não realizada' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{situacaoSup(s)}</span>
                        </div>
                      ))}
                    </BlocoDia>
                  )}
                  {dia.compromissos.length > 0 && (
                    <BlocoDia titulo="Reuniões e compromissos" acao={{ rotulo: 'Abrir Reuniões', ir: () => navigate('/agenda') }}>
                      {[...dia.compromissos].sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at)).map(c => (
                        <div key={c.id} className="py-2 flex items-start gap-3">
                          <p className="w-12 shrink-0 text-xs font-semibold text-ink-700 pt-0.5">{hora(c.scheduled_at)}</p>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-ink-900"><span className="text-ink-500">{c.category || 'Compromisso'} · </span>{c.title}</p>
                            {c.client?.name && <p className="text-xs text-ink-500">{c.client.name}</p>}
                          </div>
                        </div>
                      ))}
                    </BlocoDia>
                  )}
                  {dia.atividades.length > 0 && (
                    <BlocoDia titulo={`Atividades · ${dia.atividades.filter(x => x.done === true).length} de ${dia.atividades.length} feitas`} acao={{ rotulo: 'Abrir Atividades', ir: () => navigate('/atividades') }}>
                      <div className="py-1">{dia.atividades.map(x => <LinhaAtividade key={x.id} a={x} marcar={marcar ? v => marcar(x.id, v) : undefined} />)}</div>
                    </BlocoDia>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}

function BlocoDia({ titulo, acao, children }: { titulo: string; acao?: { rotulo: string; ir: () => void }; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-ink-100 pb-1">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">{titulo}</p>
        {acao && <button className="text-[11px] text-primary-700 hover:underline" onClick={acao.ir}>{acao.rotulo}</button>}
      </div>
      <div className="divide-y divide-ink-100">{children}</div>
    </div>
  )
}
