import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Search, Columns3, X, RotateCcw } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatCurrency, formatDate, tipoDoVinculo, salarioConsultoria, pagaPorDiaria, hojeISO } from '../../lib/utils'
import { resumoDoVinculo } from '../../lib/jornadaPessoa'
import type { VinculoPerfil, RegistroPerfil, AgendaPerfil, AvisoPerfil } from '../../lib/jornadaPessoa'
import { resumoDoPonto, pagamentoDoMes, textoPagamento, textoDia, horasTexto, diasDoVinculo } from '../../lib/planilhas'
import type { VinculoPg, RegistroPonto } from '../../lib/planilhas'
import { baixarExcelBonito } from '../../lib/excelBonito'
import type { CorLinha, TipoColuna } from '../../lib/excelBonito'

/**
 * Montar planilha (pedido de 16/10/2026): uma linha por vínculo no mês com
 * TODA a informação — formato, dia de pagamento, valores, folha de ponto,
 * dias faltando, pagamento e PIX. Filtra do jeito que quiser, escolhe as
 * colunas e baixa o Excel do que está na tela.
 */
type Vinculo = VinculoPg & VinculoPerfil & {
  id: string; employee_id: string; client_id: string
  monthly_amount?: number | null; link_units?: { visit_rate?: number | null; unit_name?: string | null }[] | null
  employee?: { full_name: string; status?: string | null; dismissal_date?: string | null; cpf?: string | null; pix?: string | null; bank_name?: string | null; bank_account?: string | null; phone?: string | null } | null
  client?: { name: string } | null
}
type Registro = RegistroPonto & RegistroPerfil & { employee_id: string; client_id: string | null; visit_rate?: number | null }
type Lanc = { id: string; employee_id: string | null; client_id: string | null; link_id: string | null; amount: number | string | null; due_date: string; status: string; reference_month: string | null }

type Formato = 'Consultoria por visita' | 'Consultoria com salário' | 'Fixo' | 'Fixo por diária'
type Folha = 'nada' | 'faltando' | 'em_dia'
type SitPgto = 'sem_lancamento' | 'a_pagar' | 'parcial' | 'pago'
type Linha = {
  id: string; empId: string; pessoa: string; cpf: string; cliente: string; formato: Formato; escala: string; ativo: boolean
  inicio: string | null; fim: string | null
  diasPgto: string; datasPgto: string[]; valorBase: string
  registros: number; dias: number; faltas: number; folgas: number; extras: number; minutos: number; semRelatorio: number; semRegistro: number
  previstos: number | null; ultimo: string | null; folha: Folha
  lancado: number; pago: number; aPagar: number; sitPgto: SitPgto; conta: string
}

const FOLHA_TXT: Record<Folha, string> = { nada: 'Não preencheu nada', faltando: 'Faltando preencher', em_dia: 'Em dia' }
const PGTO_TXT: Record<SitPgto, string> = { sem_lancamento: 'Sem lançamento', a_pagar: 'A pagar', parcial: 'Parcial', pago: 'Pago' }

type Col = { k: string; titulo: string; largura: number; tipo?: TipoColuna; valor: (l: Linha) => string | number | null; padrao?: boolean }
const COLUNAS: Col[] = [
  { k: 'pessoa', titulo: 'Colaborador', largura: 28, valor: l => l.pessoa, padrao: true },
  { k: 'cpf', titulo: 'CPF', largura: 15, valor: l => l.cpf },
  { k: 'cliente', titulo: 'Cliente', largura: 24, valor: l => l.cliente, padrao: true },
  { k: 'formato', titulo: 'Formato', largura: 22, valor: l => l.formato, padrao: true },
  { k: 'escala', titulo: 'Escala / frequência', largura: 18, valor: l => l.escala },
  { k: 'inicio', titulo: 'Início', largura: 12, tipo: 'data', valor: l => (l.inicio ? formatDate(l.inicio) : '') },
  { k: 'fim', titulo: 'Fim do vínculo', largura: 12, tipo: 'data', valor: l => (l.fim ? formatDate(l.fim) : '') },
  { k: 'valorBase', titulo: 'Valor do contrato', largura: 20, valor: l => l.valorBase, padrao: true },
  { k: 'diasPgto', titulo: 'Recebe', largura: 12, tipo: 'centro', valor: l => l.diasPgto, padrao: true },
  { k: 'datasPgto', titulo: 'Datas do pagamento', largura: 18, tipo: 'centro', valor: l => textoPagamento(l.datasPgto) },
  { k: 'folha', titulo: 'Folha de ponto', largura: 18, valor: l => FOLHA_TXT[l.folha], padrao: true },
  { k: 'registros', titulo: 'Registros', largura: 10, tipo: 'numero', valor: l => l.registros },
  { k: 'dias', titulo: 'Dias trabalhados', largura: 11, tipo: 'numero', valor: l => l.dias, padrao: true },
  { k: 'previstos', titulo: 'Previstos', largura: 10, tipo: 'numero', valor: l => l.previstos },
  { k: 'semRegistro', titulo: 'Dias sem registro', largura: 11, tipo: 'numero', valor: l => l.semRegistro, padrao: true },
  { k: 'faltas', titulo: 'Faltas', largura: 8, tipo: 'numero', valor: l => l.faltas },
  { k: 'folgas', titulo: 'Folgas', largura: 8, tipo: 'numero', valor: l => l.folgas },
  { k: 'extras', titulo: 'Extras', largura: 8, tipo: 'numero', valor: l => l.extras },
  { k: 'horas', titulo: 'Horas', largura: 9, tipo: 'centro', valor: l => (l.minutos ? horasTexto(l.minutos) : '') },
  { k: 'semRelatorio', titulo: 'Sem relatório', largura: 10, tipo: 'numero', valor: l => l.semRelatorio },
  { k: 'ultimo', titulo: 'Último registro', largura: 13, tipo: 'data', valor: l => (l.ultimo ? formatDate(l.ultimo) : '') },
  { k: 'lancado', titulo: 'Valor do mês', largura: 14, tipo: 'dinheiro', valor: l => l.lancado, padrao: true },
  { k: 'pago', titulo: 'Pago', largura: 13, tipo: 'dinheiro', valor: l => l.pago },
  { k: 'aPagar', titulo: 'A pagar', largura: 13, tipo: 'dinheiro', valor: l => l.aPagar },
  { k: 'sitPgto', titulo: 'Pagamento', largura: 14, valor: l => PGTO_TXT[l.sitPgto], padrao: true },
  { k: 'conta', titulo: 'PIX / conta', largura: 30, tipo: 'texto', valor: l => l.conta },
]

type Filtros = { formatos: Formato[]; dia: string; folha: '' | Folha | 'preencheu'; pgto: '' | SitPgto; cliente: string; busca: string; incluirEncerrados: boolean }
const FILTRO_VAZIO: Filtros = { formatos: [], dia: '', folha: '', pgto: '', cliente: '', busca: '', incluirEncerrados: true }
const ATALHOS: [string, Partial<Filtros>][] = [
  ['Pagamento dia 8', { dia: '8' }], ['Pagamento dia 15', { dia: '15' }], ['Pagamento dia 20', { dia: '20' }],
  ['Preencheram algum dia', { folha: 'preencheu' }], ['Não preencheram nada', { folha: 'nada' }], ['Faltando preencher', { folha: 'faltando' }],
  ['Sem lançamento', { pgto: 'sem_lancamento' }], ['Só consultoria', { formatos: ['Consultoria por visita', 'Consultoria com salário'] }], ['Só fixo', { formatos: ['Fixo', 'Fixo por diária'] }],
]

export default function PlanilhaCompleta({ mes, nomeMes }: { mes: string; nomeMes: string }) {
  const navigate = useNavigate()
  const ini = `${mes}-01`
  const fim = (() => { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 0).toISOString().slice(0, 10) })()
  const [f, setF] = useState<Filtros>(FILTRO_VAZIO)
  const [cols, setCols] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('planilha-colunas'); if (s) return new Set(JSON.parse(s)) } catch { /* sem armazenamento */ }
    return new Set(COLUNAS.filter(c => c.padrao).map(c => c.k))
  })
  const [verColunas, setVerColunas] = useState(false)
  const salvarCols = (n: Set<string>) => { setCols(n); try { localStorage.setItem('planilha-colunas', JSON.stringify([...n])) } catch { /* sem armazenamento */ } }

  const { data, isLoading, error } = useQuery({
    queryKey: ['planilha-completa', mes],
    queryFn: async () => {
      const [vinculos, regs, agenda, avisosR, lanc] = await Promise.all([
        fetchAll<Vinculo>(() => supabase.from('employee_client_links')
          .select('*, payment_dates:employee_payment_dates(day_of_month), employee:employees(full_name, status, dismissal_date, cpf, pix, bank_name, bank_account), client:clients(name)').order('id') as never),
        fetchAll<Registro>(() => supabase.from('nutritionist_visits')
          .select('id, employee_id, client_id, visit_date, check_in, check_out, break_start, break_end, is_extra, is_unavailable, is_holiday, is_swap, swapped_from, visit_rate, extra_approval, report_url')
          .gte('visit_date', ini).lte('visit_date', fim).order('id') as never),
        fetchAll<AgendaPerfil & { employee_id: string }>(() => supabase.from('nutritionist_agenda').select('*').gte('planned_date', ini).lte('planned_date', fim).order('id') as never),
        supabase.from('schedule_notices').select('*').or(`and(notice_date.gte.${ini},notice_date.lte.${fim}),and(swap_work_date.gte.${ini},swap_work_date.lte.${fim})`),
        fetchAll<Lanc>(() => supabase.from('payments').select('id, employee_id, client_id, link_id, amount, due_date, status, reference_month').eq('reference_month', mes).order('id') as never),
      ])
      return { vinculos, regs, agenda, avisos: (avisosR.error ? [] : avisosR.data || []) as (AvisoPerfil & { employee_id: string })[], lanc }
    },
  })

  const linhas: Linha[] = useMemo(() => {
    if (!data) return []
    const hoje = hojeISO()
    const out: Linha[] = []
    for (const l of data.vinculos) {
      if ((l.start_date && l.start_date > fim) || (l.contract_end_date && l.contract_end_date < ini)) continue
      const p = l.employee
      if (!p || (p.status === 'Inativo' && (p.dismissal_date || '0000') < ini)) continue
      const rs = data.regs.filter(r => r.employee_id === l.employee_id && r.client_id === l.client_id)
      // Só acesso (098) sem registro no mês: não é "não preencheu", ela não tinha obrigação
      if ((l as { so_acesso?: boolean | null }).so_acesso && !rs.length) continue
      const tipo = tipoDoVinculo(l)
      const formato: Formato = tipo === 'Consultoria' ? (salarioConsultoria(l) ? 'Consultoria com salário' : 'Consultoria por visita') : pagaPorDiaria(l) ? 'Fixo por diária' : 'Fixo'
      const exige = tipo === 'Consultoria' || pagaPorDiaria(l)
      const rp = resumoDoPonto(rs, l.break_minutes, exige)
      const jornada = resumoDoVinculo(l, mes, hoje, rs, data.agenda.filter(a => a.employee_id === l.employee_id), data.avisos.filter(a => a.employee_id === l.employee_id))
      const semRegistro = jornada.dias.filter(d => d.status === 'faltou').length
      const folha: Folha = rs.length === 0 ? 'nada' : semRegistro > 0 ? 'faltando' : 'em_dia'
      // Lançamentos do mês trabalhado (do vínculo; sem link_id, pela pessoa + cliente)
      const lc = data.lanc.filter(x => x.status !== 'Cancelado' && (x.link_id ? x.link_id === l.id : x.employee_id === l.employee_id && (!x.client_id || x.client_id === l.client_id)))
      const lancado = Math.round(lc.reduce((t, x) => t + (Number(x.amount) || 0), 0) * 100) / 100
      const pago = Math.round(lc.filter(x => x.status === 'Pago').reduce((t, x) => t + (Number(x.amount) || 0), 0) * 100) / 100
      const sitPgto: SitPgto = !lc.length ? 'sem_lancamento' : pago >= lancado && lancado > 0 ? 'pago' : pago > 0 ? 'parcial' : 'a_pagar'
      const datas = lc.length ? [...new Set(lc.map(x => x.due_date))].sort() : pagamentoDoMes(l, mes, rs)
      const dias = formato === 'Consultoria por visita' ? 'Dia 20 e 8' : diasDoVinculo(l).length ? textoDia(diasDoVinculo(l).map(d => `${mes}-${String(d).padStart(2, '0')}`)) : 'Sem dia'
      const visita = Math.max(0, ...(l.link_units || []).map(u => Number(u.visit_rate) || 0))
      const valorBase = formato === 'Consultoria por visita' ? (visita ? `${formatCurrency(visita)} por visita` : 'por visita (valor da unidade)')
        : formato === 'Fixo por diária' ? (Number(l.monthly_amount) ? `${formatCurrency(Number(l.monthly_amount))} (diária)` : 'diária')
        : Number(l.monthly_amount) ? `${formatCurrency(Number(l.monthly_amount))} por mês` : 'sem salário'
      const escala = tipo === 'Consultoria' ? [l.visit_frequency, l.visits_per_week ? `${l.visits_per_week}x/sem` : ''].filter(Boolean).join(' · ')
        : l.work_schedule_type === 'cliente' ? 'Escala do cliente' : l.work_schedule_type === 'horas' ? `${l.horas_semana || '?'}h/semana` : l.work_schedule_type || ''
      out.push({
        id: l.id, empId: l.employee_id, pessoa: p.full_name, cpf: p.cpf || '', cliente: l.client?.name || '—', formato, escala,
        ativo: !l.contract_end_date || l.contract_end_date >= hoje, inicio: l.start_date || null, fim: l.contract_end_date || null,
        diasPgto: dias, datasPgto: datas, valorBase,
        registros: rs.length, dias: rp.diasTrabalhados, faltas: rp.faltas, folgas: rp.folgas, extras: rp.extras, minutos: rp.minutos, semRelatorio: rp.semRelatorio,
        semRegistro, previstos: jornada.previstos, ultimo: rp.ultimo, folha,
        lancado, pago, aPagar: Math.round((lancado - pago) * 100) / 100, sitPgto,
        conta: p.pix ? `PIX ${p.pix}` : p.bank_account ? `${p.bank_name || ''} ${p.bank_account}`.trim() : '',
      })
    }
    return out.sort((a, b) => a.pessoa.localeCompare(b.pessoa) || a.cliente.localeCompare(b.cliente))
  }, [data, ini, fim, mes])

  const termo = f.busca.trim().toLowerCase()
  const visiveis = linhas.filter(l =>
    (!f.formatos.length || f.formatos.includes(l.formato)) &&
    (!f.dia || l.diasPgto.replace('Dia ', '').split(' e ').includes(f.dia) || l.datasPgto.some(d => Number(d.slice(8, 10)) === Number(f.dia))) &&
    (!f.folha || (f.folha === 'preencheu' ? l.folha !== 'nada' : l.folha === f.folha)) &&
    (!f.pgto || l.sitPgto === f.pgto) &&
    (!f.cliente || l.cliente === f.cliente) &&
    (f.incluirEncerrados || l.ativo) &&
    (!termo || l.pessoa.toLowerCase().includes(termo) || l.cliente.toLowerCase().includes(termo) || l.cpf.includes(termo)))
  const colsAtivas = COLUNAS.filter(c => cols.has(c.k))
  const clientes = [...new Set(linhas.map(l => l.cliente))].sort()
  const filtrando = JSON.stringify(f) !== JSON.stringify(FILTRO_VAZIO)
  const soma = (k: 'lancado' | 'pago' | 'aPagar') => Math.round(visiveis.reduce((t, l) => t + l[k], 0) * 100) / 100
  const descricaoFiltro = [
    f.formatos.length ? f.formatos.join(', ') : '', f.dia ? `recebe dia ${f.dia}` : '',
    f.folha ? (f.folha === 'preencheu' ? 'preencheram algum dia' : FOLHA_TXT[f.folha].toLowerCase()) : '',
    f.pgto ? PGTO_TXT[f.pgto].toLowerCase() : '', f.cliente, f.busca ? `"${f.busca}"` : '', !f.incluirEncerrados ? 'só vínculos ativos' : '',
  ].filter(Boolean).join(' · ')

  const baixar = () => baixarExcelBonito(`planilha_${mes}${f.dia ? '_dia' + f.dia : ''}`, [{
    nome: 'Planilha', titulo: `Planilha · ${nomeMes}`, subtitulo: `${visiveis.length} vínculo(s)${descricaoFiltro ? ' · ' + descricaoFiltro : ''}`,
    colunas: colsAtivas.map(c => ({ titulo: c.titulo, largura: c.largura, tipo: c.tipo })),
    linhas: visiveis.map(l => colsAtivas.map(c => c.valor(l))),
    cores: visiveis.map(l => (l.folha === 'nada' ? 'vermelho' : l.folha === 'faltando' ? 'amarelo' : null) as CorLinha),
    total: colsAtivas.map((c, i) => (i === 0 ? 'Total' : c.k === 'lancado' ? soma('lancado') : c.k === 'pago' ? soma('pago') : c.k === 'aPagar' ? soma('aPagar')
      : ['dias', 'faltas', 'folgas', 'extras', 'registros', 'semRegistro', 'semRelatorio'].includes(c.k) ? visiveis.reduce((t, l) => t + (Number(c.valor(l)) || 0), 0) : '')),
    rodape: 'Uma linha por vínculo no mês. Vermelho = não preencheu nada na folha. Amarelo = faltando preencher (dia de trabalho ou visita da agenda que já passou sem registro). "Valor do mês" = lançamentos de Pagamentos do mês trabalhado.',
  }]).catch(e => toast.error('Não gerou: ' + e.message))

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>

  const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button onClick={onClick} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${ativo ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-ink-200 text-ink-600 hover:border-ink-300'}`}>{children}</button>
  )

  return (
    <div className="space-y-4">
      {/* Atalhos */}
      <div className="card p-3 space-y-2">
        <p className="text-[11px] font-semibold text-ink-500 uppercase tracking-wide">Atalhos</p>
        <div className="flex flex-wrap gap-1.5">
          {ATALHOS.map(([rot, fx]) => {
            const ativo = Object.entries(fx).every(([k, v]) => JSON.stringify(f[k as keyof Filtros]) === JSON.stringify(v))
            return <Chip key={rot} ativo={ativo} onClick={() => setF(ativo ? FILTRO_VAZIO : { ...FILTRO_VAZIO, ...fx })}>{rot}</Chip>
          })}
        </div>
      </div>

      {/* Filtros */}
      <div className="card p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-4">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar pessoa, cliente ou CPF" value={f.busca} onChange={e => setF(x => ({ ...x, busca: e.target.value }))} />
        </div>
        <select className="input" value={f.formatos.length === 1 ? f.formatos[0] : f.formatos.length ? '__varios' : ''} onChange={e => setF(x => ({ ...x, formatos: e.target.value ? [e.target.value as Formato] : [] }))}>
          <option value="">Todos os formatos</option>
          {f.formatos.length > 1 && <option value="__varios">{f.formatos.join(' + ')}</option>}
          {(['Consultoria por visita', 'Consultoria com salário', 'Fixo', 'Fixo por diária'] as Formato[]).map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className="input" value={f.dia} onChange={e => setF(x => ({ ...x, dia: e.target.value }))}>
          <option value="">Qualquer dia de pagamento</option>
          {['8', '15', '20'].map(d => <option key={d} value={d}>Recebe dia {d}</option>)}
        </select>
        <select className="input" value={f.folha} onChange={e => setF(x => ({ ...x, folha: e.target.value as Filtros['folha'] }))}>
          <option value="">Folha: todos</option>
          <option value="preencheu">Preencheram algum dia</option>
          <option value="nada">Não preencheram nada</option>
          <option value="faltando">Faltando preencher</option>
          <option value="em_dia">Em dia</option>
        </select>
        <select className="input" value={f.pgto} onChange={e => setF(x => ({ ...x, pgto: e.target.value as Filtros['pgto'] }))}>
          <option value="">Pagamento: todos</option>
          {(Object.keys(PGTO_TXT) as SitPgto[]).map(k => <option key={k} value={k}>{PGTO_TXT[k]}</option>)}
        </select>
        <select className="input sm:col-span-2" value={f.cliente} onChange={e => setF(x => ({ ...x, cliente: e.target.value }))}>
          <option value="">Todos os clientes</option>
          {clientes.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer sm:col-span-2 px-1">
          <input type="checkbox" className="w-4 h-4 accent-primary-700" checked={!f.incluirEncerrados} onChange={e => setF(x => ({ ...x, incluirEncerrados: !e.target.checked }))} />
          Só vínculos ativos (sem os encerrados no mês)
        </label>
      </div>

      {/* Resumo + ações */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm text-ink-700 flex-1 min-w-[14rem]">
          <b>{visiveis.length}</b> de {linhas.length} vínculo(s){descricaoFiltro && <span className="text-ink-500"> · {descricaoFiltro}</span>}
          {visiveis.length > 0 && <span className="text-ink-500"> · valor do mês <b className="text-ink-900 tnum">{formatCurrency(soma('lancado'))}</b> · pago <b className="text-green-700 tnum">{formatCurrency(soma('pago'))}</b></span>}
        </p>
        {filtrando && <button className="btn-ghost text-sm" onClick={() => setF(FILTRO_VAZIO)}><RotateCcw size={14} />Limpar</button>}
        <button className="btn-secondary text-sm" onClick={() => setVerColunas(v => !v)}><Columns3 size={15} />Colunas ({colsAtivas.length})</button>
        <button className="btn-primary text-sm" disabled={!visiveis.length || !colsAtivas.length} onClick={baixar}><Download size={15} />Baixar Excel</button>
      </div>

      {verColunas && (
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-ink-700">Colunas da planilha (vale para a tela e para o Excel)</p>
            <div className="flex gap-3 text-xs">
              <button className="text-primary-700 hover:underline" onClick={() => salvarCols(new Set(COLUNAS.map(c => c.k)))}>Todas</button>
              <button className="text-primary-700 hover:underline" onClick={() => salvarCols(new Set(COLUNAS.filter(c => c.padrao).map(c => c.k)))}>Padrão</button>
              <button className="text-ink-400" onClick={() => setVerColunas(false)} aria-label="Fechar"><X size={14} /></button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {COLUNAS.map(c => (
              <label key={c.k} className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-primary-700" checked={cols.has(c.k)} disabled={c.k === 'pessoa'}
                  onChange={e => { const n = new Set(cols); if (e.target.checked) n.add(c.k); else n.delete(c.k); salvarCols(n) }} />
                {c.titulo}
              </label>
            ))}
          </div>
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-500">Ninguém com esses filtros.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary-900 text-white text-xs">
                  {colsAtivas.map(c => <th key={c.k} className={`font-semibold px-3 py-2.5 whitespace-nowrap ${c.tipo === 'dinheiro' || c.tipo === 'numero' ? 'text-right' : c.tipo === 'centro' || c.tipo === 'data' ? 'text-center' : 'text-left'} ${c.k === 'pessoa' ? 'sticky left-0 bg-primary-900' : ''}`}>{c.titulo}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visiveis.map(l => (
                  <tr key={l.id} className={`hover:bg-ink-50/70 cursor-pointer ${l.folha === 'nada' ? 'bg-red-50/40' : l.folha === 'faltando' ? 'bg-amber-50/40' : ''}`} onClick={() => navigate(`/jornada?pessoa=${l.empId}&mes=${mes}`)}>
                    {colsAtivas.map(c => {
                      const v = c.valor(l)
                      const txt = c.tipo === 'dinheiro' ? formatCurrency(Number(v) || 0) : v === null || v === '' ? '—' : String(v)
                      const cor = c.k === 'folha' ? (l.folha === 'nada' ? 'text-red-600 font-semibold' : l.folha === 'faltando' ? 'text-amber-700 font-semibold' : 'text-green-700')
                        : c.k === 'sitPgto' ? (l.sitPgto === 'pago' ? 'text-green-700' : l.sitPgto === 'sem_lancamento' ? 'text-ink-400' : 'text-amber-700')
                        : c.k === 'semRegistro' && l.semRegistro ? 'text-amber-700 font-semibold' : ''
                      return (
                        <td key={c.k} className={`px-3 py-2 whitespace-nowrap ${c.tipo === 'dinheiro' || c.tipo === 'numero' ? 'text-right tnum' : c.tipo === 'centro' || c.tipo === 'data' ? 'text-center' : ''} ${c.k === 'pessoa' ? `sticky left-0 font-medium text-ink-900 ${l.folha === 'nada' ? 'bg-red-50' : l.folha === 'faltando' ? 'bg-amber-50' : 'bg-white'}` : ''} ${cor}`}>{txt}</td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-500">Uma linha por vínculo no mês (quem tem dois clientes aparece duas vezes). Toque na linha para abrir a Jornada. "Faltando preencher" = dia de trabalho da escala ou visita da agenda que já passou sem registro. "Valor do mês" = lançamentos de Pagamentos do mês trabalhado.</p>
    </div>
  )
}
