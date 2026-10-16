import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Download, Search, Check, AlertTriangle, ChevronDown, Copy } from 'lucide-react'
import { supabase, fetchAll } from '../../lib/supabase'
import { formatCurrency, formatDate, getInitials, corDoAvatar } from '../../lib/utils'
import { correcoesDoMes, pagamentosPorDiaPessoa } from '../../lib/planilhas'
import type { LancPg, PessoaPg } from '../../lib/planilhas'
import { baixarExcelBonito } from '../../lib/excelBonito'
import type { CorLinha } from '../../lib/excelBonito'

/**
 * Planilhas de Correção e de Pagamentos (pedido de 16/10/2026). Base: os
 * lançamentos de Pagamentos com VENCIMENTO no mês (o dinheiro que sai no mês).
 *  · Correção: quem tem vínculo no mês e não recebe nada, ou recebe menos de R$ 100.
 *  · Pagamentos: quem recebe no dia 8, 15 e 20, uma linha por pessoa, com PIX/banco.
 */
type Pessoa = { id: string; full_name: string; status?: string | null; dismissal_date?: string | null; pix?: string | null; bank_name?: string | null; bank_agency?: string | null; bank_account?: string | null; cpf?: string | null }
type Vinc = { employee_id: string; start_date?: string | null; contract_end_date?: string | null; service_type?: string | null; pay_mode?: string | null; client?: { name: string } | null }

function useDadosPagamento(mes: string) {
  const ini = `${mes}-01`
  const fim = (() => { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 0).toISOString().slice(0, 10) })()
  return useQuery({
    queryKey: ['planilhas-pagamento', mes],
    queryFn: async () => {
      const [lanc, pessoas, vinc, regs] = await Promise.all([
        fetchAll<LancPg>(() => supabase.from('payments').select('id, employee_id, amount, due_date, status, description, paid_at').gte('due_date', ini).lte('due_date', fim).order('id') as never),
        fetchAll<Pessoa>(() => supabase.from('employees').select('id, full_name, status, dismissal_date, pix, bank_name, bank_agency, bank_account, cpf').order('id') as never),
        fetchAll<Vinc>(() => supabase.from('employee_client_links').select('employee_id, start_date, contract_end_date, service_type, pay_mode, client:clients(name)').order('id') as never),
        fetchAll<{ employee_id: string }>(() => supabase.from('nutritionist_visits').select('employee_id').gte('visit_date', ini).lte('visit_date', fim).order('id') as never),
      ])
      const nRegs = new Map<string, number>()
      for (const r of regs) nRegs.set(r.employee_id, (nRegs.get(r.employee_id) || 0) + 1)
      return { lanc, pessoas: new Map(pessoas.map(p => [p.id, p])), vinc, nRegs, ini, fim }
    },
  })
}
const contaBancaria = (p?: Pessoa) => p?.pix ? `PIX ${p.pix}` : p?.bank_account ? [p.bank_name, p.bank_agency && `ag ${p.bank_agency}`, p.bank_account && `cc ${p.bank_account}`].filter(Boolean).join(' · ') : ''

// ── Correção ─────────────────────────────────────────────────────────────
export function PlanilhaCorrecao({ mes, nomeMes }: { mes: string; nomeMes: string }) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useDadosPagamento(mes)
  const [filtro, setFiltro] = useState<'todos' | 'sem_pagamento' | 'menos_100'>('todos')

  const correcoes = useMemo(() => {
    if (!data) return []
    // Quem tem vínculo valendo em algum dia do mês e não estava desligado antes dele
    const comVinculo = new Map<string, Vinc[]>()
    for (const v of data.vinc) {
      if ((v.start_date && v.start_date > data.fim) || (v.contract_end_date && v.contract_end_date < data.ini)) continue
      const p = data.pessoas.get(v.employee_id)
      if (!p || (p.status === 'Inativo' && (p.dismissal_date || '0000') < data.ini)) continue
      comVinculo.set(v.employee_id, [...(comVinculo.get(v.employee_id) || []), v])
    }
    const pessoas: PessoaPg[] = [...comVinculo.entries()].map(([id, vs]) => ({ id, nome: data.pessoas.get(id)?.full_name || '—', vinculos: vs.length, registros: data.nRegs.get(id) || 0 }))
    return correcoesDoMes(pessoas, data.lanc).map(c => ({ ...c, clientes: [...new Set((comVinculo.get(c.pessoa.id) || []).map(v => v.client?.name).filter(Boolean))].join(', ') }))
  }, [data])

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>
  const sem = correcoes.filter(c => c.motivo === 'sem_pagamento'), menos = correcoes.filter(c => c.motivo === 'menos_100')
  const visiveis = correcoes.filter(c => filtro === 'todos' || c.motivo === filtro)

  const baixar = () => baixarExcelBonito(`correcao_${mes}`, [{
    nome: 'Correção', titulo: `Correção de pagamentos · ${nomeMes}`, subtitulo: `${sem.length} sem pagamento · ${menos.length} com menos de R$ 100`,
    colunas: [{ titulo: 'Colaborador', largura: 28 }, { titulo: 'Clientes', largura: 30, tipo: 'texto' }, { titulo: 'Situação', largura: 22 },
      { titulo: 'Total no mês', largura: 14, tipo: 'dinheiro' }, { titulo: 'Registros no mês', largura: 12, tipo: 'numero' }, { titulo: 'Lançamentos', largura: 40, tipo: 'texto' }],
    linhas: visiveis.map(c => [c.pessoa.nome, c.clientes, c.motivo === 'sem_pagamento' ? 'Não recebe no mês' : 'Menos de R$ 100', c.total, c.pessoa.registros,
      c.lancamentos.map(l => `${formatDate(l.due_date).slice(0, 5)} ${formatCurrency(Number(l.amount) || 0)}${l.status === 'Pago' ? ' (pago)' : ''}`).join(' · ')]),
    cores: visiveis.map(c => (c.motivo === 'sem_pagamento' ? 'vermelho' : 'amarelo') as CorLinha),
    rodape: 'Pessoas com vínculo no mês. Base: lançamentos com vencimento no mês (cancelados não contam). "Registros no mês" = dias/visitas lançados na folha de ponto: sem registro costuma explicar o R$ 0.',
  }]).catch(e => toast.error('Não gerou: ' + e.message))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {([['sem_pagamento', 'Não recebem no mês', sem, 'text-red-600'], ['menos_100', 'Recebem menos de R$ 100', menos, 'text-amber-700']] as const).map(([k, rot, xs, cor]) => (
          <button key={k} onClick={() => setFiltro(f => f === k ? 'todos' : k)} className={`card px-3 py-2.5 text-left ${filtro === k ? 'border-primary-500 ring-1 ring-primary-200' : 'hover:border-ink-300'}`}>
            <p className="text-[11px] text-ink-500">{rot}</p>
            <p className={`text-lg font-semibold tnum ${xs.length ? cor : 'text-ink-400'}`}>{xs.length}</p>
          </button>
        ))}
      </div>
      <div className="flex justify-end"><button className="btn-primary text-sm" disabled={!visiveis.length} onClick={baixar}><Download size={15} />Baixar Excel</button></div>
      {visiveis.length === 0 ? <div className="card p-8 text-center text-sm text-ink-500">Ninguém para corrigir neste mês.</div> : (
        <div className="card overflow-hidden divide-y divide-ink-100">
          {visiveis.map(c => (
            <div key={c.pessoa.id} className={`px-4 py-3 flex items-start gap-3 ${c.motivo === 'sem_pagamento' ? 'bg-red-50/40' : 'bg-amber-50/40'}`}>
              <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(c.pessoa.nome)}`}>{getInitials(c.pessoa.nome)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink-900">{c.pessoa.nome}</p>
                <p className="text-[11px] text-ink-500 truncate">{c.clientes || '—'}</p>
                <p className={`text-[11px] mt-0.5 ${c.pessoa.registros ? 'text-ink-600' : 'text-red-600 font-medium'}`}>
                  {c.pessoa.registros ? `${c.pessoa.registros} registro(s) na folha no mês` : 'Nenhum registro na folha no mês'}
                  {c.lancamentos.length > 0 && <> · {c.lancamentos.map(l => `${formatDate(l.due_date).slice(0, 5)} ${formatCurrency(Number(l.amount) || 0)}`).join(' · ')}</>}
                </p>
                <div className="flex gap-3 mt-1.5 text-xs">
                  <button className="text-primary-700 hover:underline" onClick={() => navigate(`/pagamentos?mes=${mes}&aba=folha`)}>Ver em Pagamentos</button>
                  <button className="text-primary-700 hover:underline" onClick={() => navigate(`/jornada?pessoa=${c.pessoa.id}&mes=${mes}`)}>Jornada</button>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold tnum ${c.motivo === 'sem_pagamento' ? 'text-red-600' : 'text-amber-700'}`}>{formatCurrency(c.total)}</p>
                <p className="text-[10px] text-ink-500">{c.motivo === 'sem_pagamento' ? 'não recebe' : 'menos de R$ 100'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-500">Pessoas com vínculo no mês. Conta o que vence no mês (cancelado não conta). Quem não tem registro na folha geralmente não recebe por isso — confira antes de corrigir.</p>
    </div>
  )
}

// ── Pagamentos por dia ───────────────────────────────────────────────────
export function PlanilhaPagamentos({ mes, nomeMes }: { mes: string; nomeMes: string }) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useDadosPagamento(mes)
  const [busca, setBusca] = useState('')
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const grupos = useMemo(() => (data ? pagamentosPorDiaPessoa(data.lanc) : []), [data])

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !data) return <p className="text-sm text-ink-500">Carregando…</p>
  const nome = (id: string) => data.pessoas.get(id)?.full_name || '—'
  const termo = busca.trim().toLowerCase()
  const totalMes = grupos.reduce((t, g) => t + g.total, 0), pagoMes = grupos.reduce((t, g) => t + g.pago, 0)

  const baixar = () => baixarExcelBonito(`pagamentos_${mes}`, grupos.map(g => {
    const linhas = [...g.linhas].sort((a, b) => nome(a.empId).localeCompare(nome(b.empId)))
    return {
      nome: g.dia, titulo: `Pagamentos · ${g.dia} · ${nomeMes}`, subtitulo: `${linhas.length} pessoa(s) · total ${formatCurrency(g.total)} · pago ${formatCurrency(g.pago)}`,
      colunas: [{ titulo: 'Colaborador', largura: 30 }, { titulo: 'CPF', largura: 16 }, { titulo: 'PIX / conta', largura: 38, tipo: 'texto' as const },
        { titulo: 'Vencimento', largura: 12, tipo: 'data' as const }, { titulo: 'Valor', largura: 14, tipo: 'dinheiro' as const }, { titulo: 'Situação', largura: 12, tipo: 'centro' as const }],
      linhas: linhas.map(x => { const p = data.pessoas.get(x.empId); return [nome(x.empId), p?.cpf || '', contaBancaria(p),
        [...new Set(x.lancamentos.map(l => formatDate(l.due_date)))].join(', '), x.total, x.pago >= x.total ? 'Pago' : x.pago > 0 ? 'Parcial' : 'A pagar'] }),
      cores: linhas.map(x => (x.pago >= x.total ? 'verde' : null) as CorLinha),
      total: ['Total', '', '', '', g.total, ''],
    }
  })).catch(e => toast.error('Não gerou: ' + e.message))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {grupos.map(g => (
          <div key={g.dia} className="card px-3 py-2.5">
            <p className="text-[11px] text-ink-500">{g.dia} · {g.linhas.length} pessoa(s)</p>
            <p className="text-lg font-semibold tnum text-ink-900">{formatCurrency(g.total)}</p>
            <p className="text-[10px] text-green-700">pago {formatCurrency(g.pago)}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar pessoa" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <button className="btn-primary text-sm" disabled={!grupos.length} onClick={baixar}><Download size={15} />Baixar Excel</button>
      </div>
      <p className="text-xs text-ink-600">No mês: <b className="tnum">{formatCurrency(totalMes)}</b> · pago <b className="tnum text-green-700">{formatCurrency(pagoMes)}</b> · a pagar <b className="tnum text-amber-700">{formatCurrency(totalMes - pagoMes)}</b></p>
      {grupos.length === 0 ? <div className="card p-8 text-center text-sm text-ink-500">Nenhum pagamento lançado com vencimento neste mês.</div> : grupos.map(g => {
        const linhas = g.linhas.filter(x => !termo || nome(x.empId).toLowerCase().includes(termo)).sort((a, b) => nome(a.empId).localeCompare(nome(b.empId)))
        const aberto = !fechados.has(g.dia)
        return (
          <div key={g.dia} className="card overflow-hidden">
            <button className="w-full px-4 py-3 bg-primary-900 text-white flex items-center gap-3 text-left" onClick={() => setFechados(s => { const n = new Set(s); if (n.has(g.dia)) n.delete(g.dia); else n.add(g.dia); return n })}>
              <span className="font-semibold flex-1">{g.dia} <span className="font-normal text-white/70">· {g.linhas.length} pessoa(s)</span></span>
              <span className="font-semibold tnum">{formatCurrency(g.total)}</span>
              <ChevronDown size={16} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} />
            </button>
            {aberto && (
              <div className="divide-y divide-ink-100">
                {linhas.map(x => {
                  const p = data.pessoas.get(x.empId)
                  const pago = x.pago >= x.total
                  const conta = contaBancaria(p)
                  return (
                    <div key={x.empId} className="px-4 py-2.5 flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${corDoAvatar(nome(x.empId))}`}>{getInitials(nome(x.empId))}</span>
                      <div className="flex-1 min-w-0">
                        <button className="text-sm font-medium text-ink-900 hover:underline text-left truncate block max-w-full" onClick={() => navigate(`/colaboradores/${x.empId}`)}>{nome(x.empId)}</button>
                        <p className="text-[11px] text-ink-500 truncate flex items-center gap-1">
                          {conta ? <>{conta}<button className="p-0.5 text-ink-400 hover:text-ink-700" title="Copiar" onClick={() => { navigator.clipboard?.writeText(p?.pix || p?.bank_account || ''); toast.success('Copiado') }}><Copy size={11} /></button></>
                            : <span className="text-amber-700 flex items-center gap-1"><AlertTriangle size={11} />sem PIX/conta no cadastro</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tnum text-ink-900">{formatCurrency(x.total)}</p>
                        <p className={`text-[11px] font-medium ${pago ? 'text-green-700' : x.pago > 0 ? 'text-amber-700' : 'text-ink-500'}`}>{pago ? <><Check size={11} className="inline -mt-0.5" /> pago</> : x.pago > 0 ? `pago ${formatCurrency(x.pago)}` : 'a pagar'}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      <p className="text-[11px] text-ink-500">Base: lançamentos de Pagamentos com vencimento no mês (o que sai no mês). Para marcar pago, use Pagamentos → Pagar.</p>
    </div>
  )
}
