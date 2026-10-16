import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { format, addMonths, subMonths } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Sheet, Sparkles, ClipboardList, Receipt, Wrench, Wallet, ChevronLeft, ChevronRight, ChevronDown, Download, Check, CheckCheck, X, Search, Undo2, AlertTriangle } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatCurrency, formatDate, tipoDoVinculo, getInitials, corDoAvatar, hojeISO, pagaPorDiaria } from '../../lib/utils'
import { resumoDoVinculo } from '../../lib/jornadaPessoa'
import type { VinculoPerfil, RegistroPerfil, AgendaPerfil, AvisoPerfil } from '../../lib/jornadaPessoa'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { pagamentoDoExtra, pagamentoDoMes, textoPagamento, textoDia, resumoDoPonto, horasTexto, porVisita } from '../../lib/planilhas'
import type { TipoExtra, VinculoPg, RegistroPonto } from '../../lib/planilhas'
import { baixarExcelBonito } from '../../lib/excelBonito'
import GastosCliente from './GastosCliente'
import { PlanilhaCorrecao, PlanilhaPagamentos } from './PlanilhasPagamento'
import type { CorLinha } from '../../lib/excelBonito'

/**
 * Aba Planilhas (pedido de 16/10/2026): escolher a planilha e ver/baixar.
 *  · Extras: todo extra do mês (dia extra do fixo, visita extra e horas acima
 *    do combinado da consultoria) — validar aqui mesmo, com o dia em que a
 *    pessoa recebe (8, 15 ou 20).
 *  · Folha de ponto: quem preencheu a folha no mês (e quem não preencheu),
 *    com o resumo do mês e o dia em que recebe.
 * As duas viram Excel apresentável.
 */
type Qual = 'extras' | 'ponto' | 'gastos' | 'correcao' | 'pagamentos'
type Vinculo = VinculoPg & VinculoPerfil & {
  id: string; employee_id: string; client_id: string; start_date?: string | null; contract_end_date?: string | null
  work_schedule_type?: string | null
  employee?: { full_name: string; status?: string | null; dismissal_date?: string | null } | null
  client?: { name: string } | null
}
type Visita = RegistroPonto & {
  id: string; employee_id: string; client_id: string | null; unit_name?: string | null
  extra_approval?: string | null; extra_amount?: number | null; proposed_amount?: number | null; visit_rate?: number | null
  excesso_min?: number | null; excesso_sugerido?: number | null; excesso_status?: string | null; excesso_valor?: number | null
  is_swap?: boolean | null; swapped_from?: string | null
}
type Situacao = 'pendente' | 'aprovado' | 'negado'
type Extra = {
  chave: string; visita: Visita; vinculo: Vinculo | null; tipo: TipoExtra; pessoa: string; cliente: string
  detalhe: string; valor: number | null; sugerido: number | null; situacao: Situacao; datasPgto: string[]
  // Achado pela conta da Jornada (dia fora da escala / visita fora da agenda), sem marcação de extra
  daJornada?: boolean
  // Já entra no pagamento sozinho (visita por valor, diária): só para conferência
  jaNoPagamento?: boolean
  rotulo?: string
}

const COLS_VISITA = 'id, employee_id, client_id, visit_date, check_in, check_out, break_start, break_end, is_unavailable, is_holiday, is_extra, extra_approval, extra_amount, proposed_amount, visit_rate, report_url, unit_name, is_swap, swapped_from'
const ROTULO_TIPO: Record<TipoExtra, string> = { dia: 'Dia extra', visita: 'Visita extra', horas: 'Horas acima' }
const hm = (t?: string | null) => (t || '').slice(0, 5)
const diaDaSemana = (ds: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(ds + 'T12:00:00').getDay()]

function vinculoNoDia(vinculos: Vinculo[], emp: string, cli: string | null, dia: string): Vinculo | null {
  const doPar = vinculos.filter(l => l.employee_id === emp && (!cli || l.client_id === cli))
  return doPar.find(l => (!l.start_date || l.start_date <= dia) && (!l.contract_end_date || l.contract_end_date >= dia)) || doPar[0] || null
}
const contratoTexto = (l: Vinculo | null) => {
  if (!l) return '—'
  const tipo = tipoDoVinculo(l)
  if (tipo === 'Consultoria') return porVisita(l) ? 'Consultoria por visita' : 'Consultoria com salário'
  const esc = l.work_schedule_type
  return `Fixo${esc && esc !== 'cliente' && esc !== 'horas' ? ' ' + esc : esc === 'cliente' ? ' · escala do cliente' : esc === 'horas' ? ' · horas por semana' : ''}${l.pay_mode === 'diaria' ? ' · diária' : ''}`
}

export default function PlanilhasPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [qual, setQual] = useState<Qual>(() => { const q = new URLSearchParams(window.location.search).get('planilha'); return q === 'ponto' || q === 'gastos' || q === 'correcao' || q === 'pagamentos' ? q : 'extras' })
  const [cursor, setCursor] = useState(() => { const m = new URLSearchParams(window.location.search).get('mes'); return m && /^\d{4}-\d{2}$/.test(m) ? new Date(m + '-15T12:00:00') : new Date() })
  const mes = format(cursor, 'yyyy-MM')
  const ini = `${mes}-01`, fim = format(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0), 'yyyy-MM-dd')
  const nomeMes = format(cursor, "MMMM 'de' yyyy", { locale: ptBR })

  const { data, isLoading, error } = useQuery({
    queryKey: ['planilhas', mes],
    enabled: qual === 'extras' || qual === 'ponto',
    queryFn: async () => {
      const visitas = async (cols: string) => fetchAll<Visita>(() => supabase.from('nutritionist_visits').select(cols).gte('visit_date', ini).lte('visit_date', fim).order('visit_date') as never)
      let regs: Visita[]
      try { regs = await visitas(COLS_VISITA + ', excesso_min, excesso_sugerido, excesso_status, excesso_valor') }
      catch (e) { if (/excesso/.test((e as Error).message)) regs = await visitas(COLS_VISITA); else throw e }
      // Paginado (vínculos passam de 1000) e completo: a conta da Jornada precisa da escala inteira
      const [links, agenda, avisosR] = await Promise.all([
        fetchAll<Vinculo>(() => supabase.from('employee_client_links')
          .select('*, payment_dates:employee_payment_dates(day_of_month), employee:employees(full_name, status, dismissal_date), client:clients(name)').order('id') as never),
        fetchAll<AgendaPerfil & { employee_id: string }>(() => supabase.from('nutritionist_agenda').select('*').gte('planned_date', ini).lte('planned_date', fim).order('id') as never),
        supabase.from('schedule_notices').select('*').or(`and(notice_date.gte.${ini},notice_date.lte.${fim}),and(swap_work_date.gte.${ini},swap_work_date.lte.${fim})`),
      ])
      const avisos = (avisosR.error ? [] : avisosR.data || []) as (AvisoPerfil & { employee_id: string })[]
      const pessoas = [...new Set(regs.map(r => r.employee_id))]
      const { data: pagos } = pessoas.length
        ? await supabase.from('payments').select('employee_id').eq('reference_month', mes).eq('status', 'Pago').in('employee_id', pessoas)
        : { data: [] as { employee_id: string }[] }
      return { regs, vinculos: links, agenda, avisos, comPago: new Set((pagos || []).map(p => p.employee_id as string)) }
    },
  })

  if (error && (qual === 'extras' || qual === 'ponto')) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Financeiro</p>
          <h1 className="page-title flex items-center gap-2"><Sheet size={26} className="text-primary-600" />Planilhas</h1>
          <p className="text-sm text-ink-500 mt-1">Escolha a planilha, confira na tela e baixe em Excel.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setCursor(c => subMonths(c, 1))} className="btn-secondary p-2" aria-label="Mês anterior"><ChevronLeft size={16} /></button>
          <span className="font-semibold text-ink-900 min-w-[150px] text-center first-letter:uppercase">{nomeMes}</span>
          <button onClick={() => setCursor(c => addMonths(c, 1))} className="btn-secondary p-2" aria-label="Próximo mês"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Escolher a planilha */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {([
          ['extras', Sparkles, 'Extras', 'Tudo que passou do combinado no mês: dia extra, dia de folga trabalhado, visita extra ou fora da agenda e horas acima. Valide aqui.'],
          ['ponto', ClipboardList, 'Folha de ponto', 'Quem preencheu a folha no mês e o resumo de cada um.'],
          ['gastos', Receipt, 'Gastos do cliente', 'Airbnb, carro, material… com comprovante. Gera PDF com as fotos.'],
          ['pagamentos', Wallet, 'Pagamentos', 'Quem recebe no dia 8, 15 e 20, com valor e PIX/conta.'],
          ['correcao', Wrench, 'Correção', 'Quem não recebe nada no mês ou recebe menos de R$ 100.'],
        ] as const).map(([k, Icone, titulo, desc]) => (
          <button key={k} onClick={() => setQual(k)}
            className={`card p-4 text-left flex items-start gap-3 transition-all ${qual === k ? 'border-primary-500 ring-2 ring-primary-100 bg-primary-50/40' : 'hover:border-ink-300'}`}>
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${qual === k ? 'bg-primary-600 text-white' : 'bg-ink-100 text-ink-600'}`}><Icone size={20} /></span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink-900">{titulo}</span>
              <span className="block text-xs text-ink-500 mt-0.5">{desc}</span>
            </span>
          </button>
        ))}
      </div>

      {qual === 'gastos' ? <GastosCliente mes={mes} nomeMes={nomeMes} />
        : qual === 'correcao' ? <PlanilhaCorrecao mes={mes} nomeMes={nomeMes} />
        : qual === 'pagamentos' ? <PlanilhaPagamentos mes={mes} nomeMes={nomeMes} />
        : isLoading || !data ? <p className="text-sm text-ink-500">Carregando…</p>
        : qual === 'extras'
          ? <PlanilhaExtras mes={mes} nomeMes={nomeMes} regs={data.regs} vinculos={data.vinculos} agenda={data.agenda} avisos={data.avisos} comPago={data.comPago} recarregar={() => qc.invalidateQueries({ queryKey: ['planilhas', mes] })} abrir={id => navigate(`/colaboradores/${id}`)} />
          : <PlanilhaPonto mes={mes} nomeMes={nomeMes} ini={ini} fim={fim} regs={data.regs} vinculos={data.vinculos} agenda={data.agenda} avisos={data.avisos} abrir={(emp) => navigate(`/jornada?pessoa=${emp}&mes=${mes}`)} />}
    </div>
  )
}

// ── Extras ─────────────────────────────────────────────────────────────────
function PlanilhaExtras({ mes, nomeMes, regs, vinculos, agenda, avisos, comPago, recarregar, abrir }: {
  mes: string; nomeMes: string; regs: Visita[]; vinculos: Vinculo[]
  agenda: (AgendaPerfil & { employee_id: string })[]; avisos: (AvisoPerfil & { employee_id: string })[]; comPago: Set<string>; recarregar: () => void; abrir: (empId: string) => void
}) {
  const [filtro, setFiltro] = useState<'todos' | Situacao>('todos')
  const [busca, setBusca] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [mexendo, setMexendo] = useState<string | null>(null)

  const extras: Extra[] = useMemo(() => {
    const out: Extra[] = []
    for (const v of regs) {
      const l = vinculoNoDia(vinculos, v.employee_id, v.client_id, v.visit_date)
      const pessoa = l?.employee?.full_name || '—'
      const cliente = l?.client?.name || '—'
      // Dia extra (fixo) / visita extra (consultoria)
      if (v.is_extra || ['pendente', 'aprovada', 'negada'].includes(v.extra_approval || '')) {
        const tipo: TipoExtra = porVisita(l) ? 'visita' : 'dia'
        const sit: Situacao = v.extra_approval === 'aprovada' ? 'aprovado' : v.extra_approval === 'negada' ? 'negado' : 'pendente'
        const aprovado = tipo === 'dia' ? Number(v.extra_amount) || 0 : Number(v.visit_rate) || 0
        out.push({ chave: v.id + '|e', visita: v, vinculo: l, tipo, pessoa, cliente,
          detalhe: v.check_in ? `${hm(v.check_in)}–${hm(v.check_out) || '?'}${v.unit_name ? ' · ' + v.unit_name : ''}` : v.unit_name || '',
          valor: sit === 'aprovado' ? aprovado : sit === 'negado' ? 0 : null, sugerido: Number(v.proposed_amount) || null,
          situacao: sit, datasPgto: pagamentoDoExtra(l, mes, tipo, v.visit_date) })
      }
      // Horas acima do combinado (consultoria por visita)
      if (v.excesso_status && Number(v.excesso_min) > 0) {
        const sit: Situacao = v.excesso_status === 'pago' ? 'aprovado' : v.excesso_status === 'nao_pago' ? 'negado' : 'pendente'
        out.push({ chave: v.id + '|h', visita: v, vinculo: l, tipo: 'horas', pessoa, cliente,
          detalhe: `+${horasTexto(Number(v.excesso_min))} acima · ${hm(v.check_in)}–${hm(v.check_out)}`,
          valor: sit === 'aprovado' ? Number(v.excesso_valor) || 0 : sit === 'negado' ? 0 : null, sugerido: Number(v.excesso_sugerido) || null,
          situacao: sit, datasPgto: pagamentoDoExtra(l, mes, 'horas', v.visit_date) })
      }
    }
    // Extras pela conta da Jornada (pedido de 16/10/2026: "tem que levar tudo desse mês,
    // não pode faltar"): dia trabalhado fora da escala (inclusive feriado) e visita fora
    // da agenda — mesmo sem a pessoa ter marcado como extra.
    const jaListado = new Set(out.filter(e => e.tipo !== 'horas').map(e => e.visita.id))
    const hoje = hojeISO()
    const porId = new Map(regs.map(r => [r.id, r]))
    for (const l of vinculos) {
      const dela = regs.filter(r => r.employee_id === l.employee_id && r.client_id === l.client_id)
      if (!dela.length) continue
      const res = resumoDoVinculo(l, mes, hoje, dela as unknown as RegistroPerfil[],
        agenda.filter(a => a.employee_id === l.employee_id), avisos.filter(a => a.employee_id === l.employee_id))
      for (const d of res.dias) {
        if ((d.status !== 'extra' && d.status !== 'fora') || !d.registro || jaListado.has(d.registro.id)) continue
        const v = porId.get(d.registro.id)
        if (!v) continue
        jaListado.add(v.id)
        const pessoa = l.employee?.full_name || '—', cliente = l.client?.name || '—'
        const horario = v.check_in ? `${hm(v.check_in)}–${hm(v.check_out) || '?'}${v.unit_name ? ' · ' + v.unit_name : ''}` : ''
        if (d.status === 'fora' || pagaPorDiaria(l)) {
          // Visita por valor / diária: já é paga pelo registro. Aparece para conferência.
          const pv = porVisita(l) || pagaPorDiaria(l)
          out.push({ chave: v.id + '|j', visita: v, vinculo: l, tipo: porVisita(l) ? 'visita' : 'dia', pessoa, cliente,
            detalhe: [d.status === 'fora' ? 'Fora da agenda' : 'Fora da escala', horario].filter(Boolean).join(' · '),
            valor: pv ? Number(v.visit_rate) || 0 : null, sugerido: null, situacao: 'aprovado', jaNoPagamento: true, daJornada: true,
            rotulo: d.status === 'fora' ? 'Fora da agenda' : 'Dia a mais',
            datasPgto: pagamentoDoExtra(l, mes, porVisita(l) ? 'visita' : 'dia', v.visit_date) })
        } else {
          // Fixo/salário: dia fora da escala sem marcação — precisa validar
          const sug = Number(l.monthly_amount) > 0 ? Math.round((Number(l.monthly_amount) / 30) * 100) / 100 : null
          out.push({ chave: v.id + '|j', visita: v, vinculo: l, tipo: 'dia', pessoa, cliente,
            detalhe: ['Dia de folga da escala', horario].filter(Boolean).join(' · '),
            valor: null, sugerido: sug, situacao: 'pendente', daJornada: true,
            datasPgto: pagamentoDoExtra(l, mes, 'dia', v.visit_date) })
        }
      }
    }
    return out.sort((a, b) => a.pessoa.localeCompare(b.pessoa) || a.visita.visit_date.localeCompare(b.visita.visit_date))
  }, [regs, vinculos, agenda, avisos, mes])

  const termo = busca.trim().toLowerCase()
  const visiveis = extras.filter(e => (filtro === 'todos' || e.situacao === filtro) && (!termo || e.pessoa.toLowerCase().includes(termo) || e.cliente.toLowerCase().includes(termo)))
  const conta = (s: Situacao) => extras.filter(e => e.situacao === s)
  const somaValor = (xs: Extra[]) => xs.reduce((t, e) => t + (e.valor ?? e.sugerido ?? 0), 0)
  // Aprovados por dia de pagamento
  const porDia = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of extras.filter(x => x.situacao === 'aprovado' && (x.valor || 0) > 0)) {
      const k = textoDia(e.datasPgto)
      m.set(k, (m.get(k) || 0) + (e.valor || 0))
    }
    return [...m.entries()].sort()
  }, [extras])

  const valorDe = (e: Extra) => valores[e.chave] ?? (e.sugerido != null ? String(e.sugerido).replace('.', ',') : '')

  // Uma pessoa (no cliente) = um cartão. Quem tem algo para validar vem primeiro.
  const grupos = useMemo(() => {
    const m = new Map<string, Extra[]>()
    for (const e of visiveis) { const k = `${e.visita.employee_id}|${e.vinculo?.client_id || e.cliente}`; m.set(k, [...(m.get(k) || []), e]) }
    return [...m.entries()].map(([chave, itens]) => {
      const pendentes = itens.filter(e => e.situacao === 'pendente')
      const dias = [...new Set(itens.filter(e => e.situacao !== 'negado').flatMap(e => e.datasPgto))].sort()
      return { chave, itens, pendentes, dias, pessoa: itens[0].pessoa, cliente: itens[0].cliente, vinculo: itens[0].vinculo, empId: itens[0].visita.employee_id,
        aprovado: itens.filter(e => e.situacao === 'aprovado').reduce((t, e) => t + (e.valor || 0), 0) }
    }).sort((a, b) => Number(b.pendentes.length > 0) - Number(a.pendentes.length > 0) || a.pessoa.localeCompare(b.pessoa))
  }, [visiveis])
  // Começa aberto quem tem algo para validar
  const [abertos, setAbertos] = useState<Set<string> | null>(null)
  const abertosAtuais = abertos ?? new Set(grupos.filter(g => g.pendentes.length).map(g => g.chave))
  const alternar = (k: string) => setAbertos(() => { const n = new Set(abertosAtuais); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const numero = (txt: string) => Number(txt.replace(/\./g, '').replace(',', '.'))
  const decidir = async (e: Extra, aprovar: boolean, emLote = false): Promise<boolean> => {
    const valor = Number(valorDe(e).replace(/\./g, '').replace(',', '.'))
    if (aprovar && !(valor > 0)) { toast.error(`Informe o valor do extra de ${formatDate(e.visita.visit_date)}.`); return false }
    setMexendo(e.chave)
    let upd: Record<string, unknown>
    if (e.tipo === 'horas') {
      const { data: { user } } = await supabase.auth.getUser()
      upd = { excesso_status: aprovar ? 'pago' : 'nao_pago', excesso_valor: aprovar ? Math.round(valor * 100) / 100 : null, excesso_decidido_em: new Date().toISOString(), excesso_decidido_por: user?.id ?? null }
    } else if (e.tipo === 'dia') {
      upd = { extra_approval: aprovar ? 'aprovada' : 'negada', extra_amount: aprovar ? Math.round(valor * 100) / 100 : null, ...(e.daJornada ? { is_extra: true } : {}) }
    } else {
      upd = { extra_approval: aprovar ? 'aprovada' : 'negada', visit_rate: aprovar ? Math.round(valor * 100) / 100 : null }
    }
    const { error } = await supabase.from('nutritionist_visits').update(upd).eq('id', e.visita.id)
    setMexendo(null)
    if (error) { toast.error(error.message); return false }
    if (!emLote) { toast.success(aprovar ? `Extra aprovado — recebe ${textoPagamento(e.datasPgto)}.` : 'Extra marcado como não pago.'); recarregar() }
    return true
  }
  const aprovarTodos = async (itens: Extra[]) => {
    const total = itens.reduce((t, e) => t + (numero(valorDe(e)) || 0), 0)
    if (!(await confirmar({ titulo: `Aprovar ${itens.length} extras?`, texto: `${itens[0].pessoa} · ${formatCurrency(total)} pelos valores que estão na tela.`, confirmar: 'Aprovar todos' }))) return
    let ok = 0
    for (const e of itens) if (await decidir(e, true, true)) ok++
    toast.success(`${ok} extra(s) aprovado(s).`); recarregar()
  }
  const desfazer = async (e: Extra) => {
    if (comPago.has(e.visita.employee_id)) { toast.error('Já tem pagamento deste mês marcado como pago para esta pessoa. Ajuste em Pagamentos.'); return }
    if (!(await confirmar({ titulo: 'Voltar para validar?', texto: `${e.pessoa} · ${ROTULO_TIPO[e.tipo]} de ${formatDate(e.visita.visit_date)}. A decisão é desfeita.`, confirmar: 'Voltar' }))) return
    const upd = e.tipo === 'horas' ? { excesso_status: 'pendente', excesso_valor: null, excesso_decidido_em: null, excesso_decidido_por: null }
      : e.tipo === 'dia' ? { extra_approval: 'pendente', extra_amount: null } : { extra_approval: 'pendente', visit_rate: null }
    const { error } = await supabase.from('nutritionist_visits').update(upd).eq('id', e.visita.id)
    if (error) { toast.error(error.message); return }
    toast.success('Voltou para validar.'); recarregar()
  }

  const baixar = async () => {
    const linhas: (string | number | null)[][] = []
    const cores: CorLinha[] = []
    for (const g of grupos) {
      g.itens.forEach((e, i) => {
        linhas.push([i === 0 ? g.pessoa : '', i === 0 ? g.cliente : '', formatDate(e.visita.visit_date), e.rotulo || ROTULO_TIPO[e.tipo], e.detalhe,
          e.situacao === 'pendente' ? (e.sugerido ?? null) : e.valor ?? 0,
          e.situacao === 'pendente' ? 'Para validar (valor sugerido)' : e.jaNoPagamento ? 'Já no pagamento' : e.situacao === 'aprovado' ? 'Aprovado' : 'Não pago',
          e.situacao === 'negado' ? '—' : textoDia(e.datasPgto), e.situacao === 'negado' ? '—' : textoPagamento(e.datasPgto)])
        cores.push(e.situacao === 'pendente' ? 'amarelo' : e.situacao === 'negado' ? 'cinza' : null)
      })
      linhas.push(['', '', '', '', `Total aprovado de ${g.pessoa.split(' ')[0]}`, g.aprovado, g.pendentes.length ? `${g.pendentes.length} para validar` : '', textoDia(g.dias), ''])
      cores.push('verde')
    }
    const totalAprov = grupos.reduce((t, g) => t + g.aprovado, 0)
    await baixarExcelBonito(`extras_${mes}`, [{
      nome: 'Extras', titulo: `Extras · ${nomeMes}`,
      subtitulo: `${grupos.length} pessoa(s) · ${visiveis.length} extra(s) · aprovados: ${formatCurrency(totalAprov)}${porDia.length ? ' · ' + porDia.map(([d, v]) => `${d}: ${formatCurrency(v)}`).join(' · ') : ''}`,
      colunas: [{ titulo: 'Colaborador', largura: 28 }, { titulo: 'Cliente', largura: 24 }, { titulo: 'Data', largura: 12, tipo: 'data' }, { titulo: 'Tipo', largura: 15 },
        { titulo: 'Detalhe', largura: 32, tipo: 'texto' }, { titulo: 'Valor', largura: 14, tipo: 'dinheiro' }, { titulo: 'Situação', largura: 24 },
        { titulo: 'Recebe', largura: 12, tipo: 'centro' }, { titulo: 'Data do pagamento', largura: 18, tipo: 'centro' }],
      linhas, cores, total: ['Total aprovado no mês', '', '', '', '', totalAprov, '', '', ''],
      rodape: 'Uma pessoa por bloco; a linha verde é o total dela. Amarelo = para validar (o valor é o sugerido). Cinza = não pago. Consultoria: visita até o dia 15 recebe no dia 20; depois do dia 15, no dia 8 do mês seguinte; horas acima, no dia 8 do mês seguinte. Fixo: no dia do contrato.',
    }])
  }

  const cartoes: ['todos' | Situacao, string, Extra[], string][] = [
    ['pendente', 'Para validar', conta('pendente'), 'text-amber-700'],
    ['aprovado', 'Aprovados', conta('aprovado'), 'text-green-700'],
    ['negado', 'Não pagos', conta('negado'), 'text-ink-400'],
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {cartoes.map(([k, rotulo, xs, cor]) => (
          <button key={k} onClick={() => setFiltro(f => f === k ? 'todos' : k)}
            className={`card px-3 py-2.5 text-left ${filtro === k ? 'border-primary-500 ring-1 ring-primary-200' : 'hover:border-ink-300'}`}>
            <p className="text-[11px] text-ink-500">{rotulo} · {xs.length}</p>
            <p className={`text-base sm:text-lg font-semibold tnum ${cor}`}>{k === 'negado' ? '—' : formatCurrency(somaValor(xs))}</p>
            {k === 'pendente' && xs.length > 0 && <p className="text-[10px] text-ink-400">pelo valor sugerido</p>}
          </button>
        ))}
      </div>
      {porDia.length > 0 && (
        <div className="card px-4 py-3 flex flex-wrap gap-x-6 gap-y-1 items-center">
          <p className="text-xs font-semibold text-ink-700">Aprovados por dia de pagamento</p>
          {porDia.map(([d, v]) => <p key={d} className="text-sm text-ink-800">{d}: <b className="tnum">{formatCurrency(v)}</b></p>)}
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar pessoa ou cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <button className="btn-primary text-sm" disabled={!visiveis.length} onClick={() => baixar().catch(e => toast.error('Não gerou: ' + e.message))}><Download size={15} />Baixar Excel</button>
      </div>

      {grupos.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">{extras.length ? 'Nada neste filtro.' : 'Nenhum extra neste mês.'}</div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex justify-end gap-3 text-xs">
            <button className="text-primary-700 hover:underline" onClick={() => setAbertos(new Set(grupos.map(g => g.chave)))}>Abrir todos</button>
            <button className="text-primary-700 hover:underline" onClick={() => setAbertos(new Set())}>Fechar todos</button>
          </div>
          {grupos.map(g => {
            const aberto = abertosAtuais.has(g.chave)
            return (
              <div key={g.chave} className={`card overflow-hidden ${g.pendentes.length ? 'border-amber-200' : ''}`}>
                {/* Cabeçalho da pessoa: nome uma vez só + resumo */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-ink-50/60" onClick={() => alternar(g.chave)}>
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(g.pessoa)}`}>{getInitials(g.pessoa)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink-900 truncate">{g.pessoa}</p>
                    <p className="text-[11px] text-ink-500 truncate">{g.cliente} · {contratoTexto(g.vinculo)} · {g.itens.length} extra{g.itens.length > 1 ? 's' : ''}</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0">
                    {g.pendentes.length > 0 && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-800">{g.pendentes.length} para validar</span>}
                    {g.aprovado > 0 && <span className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-green-50 text-green-700 tnum">{formatCurrency(g.aprovado)}</span>}
                  </div>
                  <div className="text-right shrink-0 w-20">
                    <p className={`text-sm font-semibold ${g.dias.length ? 'text-ink-900' : g.itens.every(e => e.situacao === 'negado') ? 'text-ink-300' : 'text-amber-700'}`}>{g.dias.length ? textoDia(g.dias) : g.itens.every(e => e.situacao === 'negado') ? '—' : 'Sem dia'}</p>
                    <p className="text-[10px] text-ink-500">recebe</p>
                  </div>
                  <ChevronDown size={16} className={`text-ink-400 shrink-0 transition-transform ${aberto ? 'rotate-180' : ''}`} />
                </div>
                {/* Resumo no celular */}
                {(g.pendentes.length > 0 || g.aprovado > 0) && (
                  <div className="sm:hidden flex gap-2 px-4 -mt-1 pb-2.5">
                    {g.pendentes.length > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800">{g.pendentes.length} para validar</span>}
                    {g.aprovado > 0 && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-green-50 text-green-700 tnum">aprovado {formatCurrency(g.aprovado)}</span>}
                  </div>
                )}
                {aberto && (
                  <div className="border-t border-ink-100">
                    {g.pendentes.length > 1 && (
                      <div className="px-4 py-2 bg-amber-50/60 flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-xs text-amber-900">{g.pendentes.length} para validar · {formatCurrency(g.pendentes.reduce((t, e) => t + (numero(valorDe(e)) || 0), 0))} pelos valores da tela</p>
                        <button className="btn-primary text-xs py-1.5" disabled={!!mexendo} onClick={() => aprovarTodos(g.pendentes)}><CheckCheck size={13} />Aprovar todos</button>
                      </div>
                    )}
                    <div className="divide-y divide-ink-100">
                      {g.itens.map(e => (
                        <div key={e.chave} className={`px-4 py-2.5 flex items-center gap-x-3 gap-y-2 flex-wrap ${e.situacao === 'pendente' ? 'bg-amber-50/40' : e.situacao === 'negado' ? 'bg-ink-50/50' : ''}`}>
                          <div className="w-14 shrink-0">
                            <p className="text-sm font-semibold text-ink-900 tnum">{formatDate(e.visita.visit_date).slice(0, 5)}</p>
                            <p className="text-[10px] text-ink-400 uppercase">{diaDaSemana(e.visita.visit_date)}</p>
                          </div>
                          <div className="flex-1 min-w-[10rem]">
                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${e.tipo === 'horas' ? 'bg-blue-50 text-blue-700' : e.tipo === 'visita' ? 'bg-purple-50 text-purple-700' : 'bg-primary-50 text-primary-800'}`}>{e.rotulo || ROTULO_TIPO[e.tipo]}</span>
                            <p className="text-[11px] text-ink-500 mt-0.5">{e.detalhe}{g.dias.join() !== e.datasPgto.join() && e.situacao !== 'negado' ? ` · recebe ${textoPagamento(e.datasPgto)}` : ''}</p>
                          </div>
                          {e.situacao === 'pendente' ? (
                            <div className="flex items-center gap-1.5 ml-auto">
                              <span className="text-xs text-ink-400">R$</span>
                              <input className="w-24 h-8 rounded-md border border-ink-200 px-2 text-right tnum text-sm focus:border-primary-500 focus:outline-none" inputMode="decimal"
                                value={valorDe(e)} onChange={ev => setValores(v => ({ ...v, [e.chave]: ev.target.value.replace(/[^\d,.]/g, '') }))} placeholder="0,00" title={e.sugerido != null ? `Sugerido ${formatCurrency(e.sugerido)}` : undefined} />
                              <button className="btn-primary text-xs py-1.5 px-2.5" disabled={mexendo === e.chave} onClick={() => decidir(e, true)} title="Aprovar"><Check size={13} /><span className="hidden sm:inline">Aprovar</span></button>
                              <button className="btn-secondary text-xs py-1.5 px-2.5 text-red-600" disabled={mexendo === e.chave} onClick={() => decidir(e, false)} title="Não pagar"><X size={13} /><span className="hidden sm:inline">Não pagar</span></button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 ml-auto">
                              <span className={`text-sm font-semibold tnum ${e.situacao === 'negado' ? 'text-ink-400' : 'text-ink-900'}`}>{e.situacao === 'negado' ? '—' : e.valor != null ? formatCurrency(e.valor) : 'no salário'}</span>
                              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${e.jaNoPagamento ? 'bg-ink-100 text-ink-600' : e.situacao === 'aprovado' ? 'bg-green-50 text-green-700' : 'bg-ink-100 text-ink-500'}`}>{e.jaNoPagamento ? 'Já no pagamento' : e.situacao === 'aprovado' ? 'Aprovado' : 'Não pago'}</span>
                              {!e.jaNoPagamento
                                ? <button className="p-1.5 rounded text-ink-400 hover:text-ink-700 hover:bg-ink-100" title="Voltar para validar" onClick={() => desfazer(e)}><Undo2 size={14} /></button>
                                : <span className="w-[26px]" />}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2 border-t border-ink-100 flex items-center justify-between">
                      <button className="text-xs text-primary-700 hover:underline" onClick={() => abrir(g.empId)}>Abrir colaborador</button>
                      <p className="text-xs text-ink-600">Total aprovado: <b className="tnum text-ink-900">{formatCurrency(g.aprovado)}</b></p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-ink-500">Entra aqui todo extra do mês, mesmo o que a pessoa não marcou como extra: dia de folga da escala trabalhado e visita fora da agenda (mesma conta da Jornada). Feriado trabalhado num dia de trabalho da escala é dia normal, não extra (contrato PJ). "Já no pagamento" = visita por valor ou diária, que já é paga pelo registro. Aprovado entra sozinho no pagamento da pessoa. Consultoria: visita até o dia 15 recebe no dia 20; depois do dia 15, no dia 8 do mês seguinte; horas acima, no dia 8 do mês seguinte. Fixo: no dia do contrato.</p>
    </div>
  )
}

// ── Folha de ponto ─────────────────────────────────────────────────────────
function PlanilhaPonto({ mes, nomeMes, ini, fim, regs, vinculos, agenda, avisos, abrir }: {
  agenda: (AgendaPerfil & { employee_id: string })[]; avisos: (AvisoPerfil & { employee_id: string })[]
  mes: string; nomeMes: string; ini: string; fim: string; regs: Visita[]; vinculos: Vinculo[]; abrir: (empId: string) => void
}) {
  const [verSemRegistro, setVerSemRegistro] = useState(false)
  const [busca, setBusca] = useState('')
  const [diaFiltro, setDiaFiltro] = useState('')
  const tabelaRef = useRef<HTMLDivElement>(null)

  const linhas = useMemo(() => {
    // Vínculo valendo no mês e pessoa não desligada antes dele
    const valendo = vinculos.filter(l => (!l.start_date || l.start_date <= fim) && (!l.contract_end_date || l.contract_end_date >= ini)
      && !(l.employee?.status === 'Inativo' && (l.employee.dismissal_date || '0000') < ini))
    const porVinculo = new Map<string, Visita[]>()
    for (const r of regs) {
      const l = vinculoNoDia(vinculos, r.employee_id, r.client_id, r.visit_date)
      if (!l) continue
      porVinculo.set(l.id, [...(porVinculo.get(l.id) || []), r])
    }
    const ids = new Set([...valendo.map(l => l.id), ...porVinculo.keys()])
    return [...ids].map(id => {
      const l = vinculos.find(x => x.id === id)!
      const rs = porVinculo.get(id) || []
      const exige = tipoDoVinculo(l) === 'Consultoria' || l.service_type === 'Volante' || l.pay_mode === 'diaria'
      const resumo = resumoDoPonto(rs, l.break_minutes, exige)
      const datas = pagamentoDoMes(l, mes, rs)
      // Feriado num dia de trabalho da escala sem registro: só informação para o RH (não é falta)
      const feriadosSemRegistro = tipoDoVinculo(l) === 'Fixo'
        ? resumoDoVinculo(l, mes, hojeISO(), rs as unknown as RegistroPerfil[], agenda.filter(a => a.employee_id === l.employee_id), avisos.filter(a => a.employee_id === l.employee_id))
            .dias.filter(d => d.status === 'feriado' && d.titulo === 'Não trabalhou no feriado').map(d => d.data)
        : []
      return { l, rs, resumo, datas, feriadosSemRegistro, pessoa: l.employee?.full_name || '—', cliente: l.client?.name || '—', preencheu: rs.length > 0 }
    }).sort((a, b) => Number(b.preencheu) - Number(a.preencheu) || a.pessoa.localeCompare(b.pessoa))
  }, [regs, vinculos, ini, fim, mes])

  const preencheram = linhas.filter(x => x.preencheu)
  const semRegistro = linhas.filter(x => !x.preencheu)
  const diasDePagto = [...new Set(preencheram.map(x => textoDia(x.datas)))].sort()
  const termo = busca.trim().toLowerCase()
  const visiveis = (verSemRegistro ? linhas : preencheram)
    .filter(x => (!termo || x.pessoa.toLowerCase().includes(termo) || x.cliente.toLowerCase().includes(termo)) && (!diaFiltro || textoDia(x.datas) === diaFiltro))

  const baixar = async () => {
    const linhasX = visiveis.map(x => [x.pessoa, x.cliente, contratoTexto(x.l), x.preencheu ? 'Preencheu' : 'Não preencheu',
      x.resumo.diasTrabalhados, x.resumo.faltas, x.resumo.folgas, x.resumo.extras, x.resumo.minutos ? horasTexto(x.resumo.minutos) : '—',
      x.resumo.semRelatorio || '', x.resumo.ultimo ? formatDate(x.resumo.ultimo) : '—', textoDia(x.datas), textoPagamento(x.datas),
      x.feriadosSemRegistro.length ? `Não trabalhou no feriado ${x.feriadosSemRegistro.map(d => formatDate(d).slice(0, 5)).join(', ')} (só informação)` : ''])
    const cores: CorLinha[] = visiveis.map(x => !x.preencheu ? 'vermelho' : x.resumo.semRelatorio || x.resumo.semSaida ? 'amarelo' : null)
    const soma = (k: 'diasTrabalhados' | 'faltas' | 'folgas' | 'extras') => visiveis.reduce((t, x) => t + x.resumo[k], 0)
    await baixarExcelBonito(`folha_de_ponto_${mes}`, [{
      nome: 'Folha de ponto', titulo: `Folha de ponto · ${nomeMes}`,
      subtitulo: `${preencheram.length} de ${linhas.length} vínculo(s) preencheram · ${preencheram.reduce((t, x) => t + x.resumo.diasTrabalhados, 0)} dia(s) trabalhado(s)`,
      colunas: [{ titulo: 'Colaborador', largura: 28 }, { titulo: 'Cliente', largura: 24 }, { titulo: 'Contrato', largura: 22 }, { titulo: 'Situação', largura: 14 },
        { titulo: 'Dias trabalhados', largura: 11, tipo: 'numero' }, { titulo: 'Faltas', largura: 8, tipo: 'numero' }, { titulo: 'Folgas', largura: 8, tipo: 'numero' },
        { titulo: 'Extras', largura: 8, tipo: 'numero' }, { titulo: 'Horas', largura: 10, tipo: 'centro' }, { titulo: 'Sem relatório', largura: 10, tipo: 'numero' },
        { titulo: 'Último registro', largura: 14, tipo: 'data' }, { titulo: 'Recebe', largura: 12, tipo: 'centro' }, { titulo: 'Data do pagamento', largura: 18, tipo: 'centro' }, { titulo: 'Observação', largura: 34, tipo: 'texto' }],
      linhas: linhasX, cores,
      total: ['Total', '', '', '', soma('diasTrabalhados'), soma('faltas'), soma('folgas'), soma('extras'), '', '', '', '', '', ''],
      rodape: 'Vermelho = não preencheu a folha no mês. Amarelo = dia sem saída ou sem relatório. Consultoria por visita: dias 1 a 15 recebem no dia 20; dias 16 em diante, no dia 8 do mês seguinte. Fixo: no dia do contrato.',
    }])
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="card px-3 py-2.5">
          <p className="text-[11px] text-ink-500">Preencheram</p>
          <p className="text-lg font-semibold tnum text-green-700">{preencheram.length}<span className="text-sm text-ink-400 font-normal"> de {linhas.length}</span></p>
        </div>
        <button className={`card px-3 py-2.5 text-left ${verSemRegistro ? 'border-primary-500 ring-1 ring-primary-200' : 'hover:border-ink-300'}`} onClick={() => setVerSemRegistro(v => !v)}>
          <p className="text-[11px] text-ink-500">Não preencheram</p>
          <p className={`text-lg font-semibold tnum ${semRegistro.length ? 'text-red-600' : 'text-ink-400'}`}>{semRegistro.length}</p>
          <p className="text-[10px] text-ink-400">{verSemRegistro ? 'mostrando na lista' : 'toque para ver'}</p>
        </button>
        <div className="card px-3 py-2.5">
          <p className="text-[11px] text-ink-500">Dias trabalhados</p>
          <p className="text-lg font-semibold tnum text-ink-900">{preencheram.reduce((t, x) => t + x.resumo.diasTrabalhados, 0)}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar pessoa ou cliente" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <select className="input w-auto" value={diaFiltro} onChange={e => setDiaFiltro(e.target.value)}>
          <option value="">Todos os dias de pagamento</option>
          {diasDePagto.map(d => <option key={d} value={d}>Recebe {d.toLowerCase()}</option>)}
        </select>
        <button className="btn-primary text-sm" disabled={!visiveis.length} onClick={() => baixar().catch(e => toast.error('Não gerou: ' + e.message))}><Download size={15} />Baixar Excel</button>
      </div>

      {visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">Ninguém preencheu a folha neste mês{termo || diaFiltro ? ' com esse filtro' : ''}.</div>
      ) : (
        <div className="card overflow-hidden" ref={tabelaRef}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-900 text-white text-xs">
                  <th className="text-left font-semibold px-4 py-2.5">Colaborador</th>
                  <th className="text-center font-semibold px-2 py-2.5">Dias</th>
                  <th className="text-center font-semibold px-2 py-2.5 hidden md:table-cell">Faltas</th>
                  <th className="text-center font-semibold px-2 py-2.5 hidden md:table-cell">Folgas</th>
                  <th className="text-center font-semibold px-2 py-2.5 hidden md:table-cell">Extras</th>
                  <th className="text-center font-semibold px-2 py-2.5 hidden sm:table-cell">Horas</th>
                  <th className="text-center font-semibold px-2 py-2.5 hidden lg:table-cell">Último</th>
                  <th className="text-center font-semibold px-4 py-2.5">Recebe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visiveis.map(x => (
                  <tr key={x.l.id} className={`cursor-pointer hover:bg-ink-50/70 ${!x.preencheu ? 'bg-red-50/50' : ''}`} onClick={() => abrir(x.l.employee_id)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${corDoAvatar(x.pessoa)}`}>{getInitials(x.pessoa)}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-ink-900 truncate">{x.pessoa}</p>
                          <p className="text-[11px] text-ink-500 truncate">{x.cliente} · {contratoTexto(x.l)}</p>
                          {!x.preencheu && <p className="text-[11px] font-semibold text-red-600">Não preencheu a folha no mês</p>}
                          {x.feriadosSemRegistro.length > 0 && <p className="text-[11px] text-sky-700">Não trabalhou no feriado {x.feriadosSemRegistro.map(d => formatDate(d).slice(0, 5)).join(', ')} · só informação</p>}
                          {(x.resumo.semRelatorio > 0 || x.resumo.semSaida > 0) && (
                            <p className="text-[11px] text-amber-700 flex items-center gap-1"><AlertTriangle size={11} />
                              {[x.resumo.semSaida ? `${x.resumo.semSaida} sem saída` : '', x.resumo.semRelatorio ? `${x.resumo.semRelatorio} sem relatório` : ''].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center font-semibold tnum text-ink-900">{x.resumo.diasTrabalhados || '—'}</td>
                    <td className={`px-2 py-2.5 text-center tnum hidden md:table-cell ${x.resumo.faltas ? 'text-red-600 font-semibold' : 'text-ink-300'}`}>{x.resumo.faltas || '—'}</td>
                    <td className={`px-2 py-2.5 text-center tnum hidden md:table-cell ${x.resumo.folgas ? 'text-ink-800' : 'text-ink-300'}`}>{x.resumo.folgas || '—'}</td>
                    <td className={`px-2 py-2.5 text-center tnum hidden md:table-cell ${x.resumo.extras ? 'text-primary-700 font-semibold' : 'text-ink-300'}`}>{x.resumo.extras || '—'}</td>
                    <td className="px-2 py-2.5 text-center tnum hidden sm:table-cell text-ink-700">{x.resumo.minutos ? horasTexto(x.resumo.minutos) : '—'}</td>
                    <td className="px-2 py-2.5 text-center hidden lg:table-cell text-ink-600">{x.resumo.ultimo ? formatDate(x.resumo.ultimo).slice(0, 5) : '—'}</td>
                    <td className="px-4 py-2.5 text-center">
                      <p className={`font-semibold ${x.datas.length ? 'text-ink-900' : 'text-amber-700'}`}>{textoDia(x.datas)}</p>
                      <p className="text-[11px] text-ink-500 whitespace-nowrap">{x.datas.length ? textoPagamento(x.datas) : 'sem dia no vínculo'}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-500">Toque numa pessoa para abrir a Jornada dela no mês. Consultoria por visita: dias 1 a 15 recebem no dia 20; dias 16 em diante, no dia 8 do mês seguinte. Fixo: no dia do contrato.</p>
    </div>
  )
}
