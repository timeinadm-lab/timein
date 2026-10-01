import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, FileSpreadsheet, FileDown, AlertTriangle, Copy, CheckCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO, corDoAvatar } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { agruparPorDia, totaisDoMes, limitesDoMes, mesCurto } from '../../lib/pagamentosPorDia'
import type { Lancamento, GrupoDia, ChaveDia } from '../../lib/pagamentosPorDia'
import type { FolhaRel, ReembolsoRel } from '../../lib/relatorioSaidas'

type Saida = Lancamento & { employee?: { full_name?: string } | null }
type DadosBanco = { id: string; full_name?: string; cpf?: string | null; pix?: string | null; bank_name?: string | null; bank_agency?: string | null; bank_account?: string | null; bank_account_type?: string | null }

const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const iniciais = (nome: string) => nome.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase()
const textoBanco = (b?: DadosBanco | null) => b && (b.bank_name || b.bank_account)
  ? [b.bank_name, b.bank_agency ? `Ag ${b.bank_agency}` : null, b.bank_account ? `${b.bank_account_type === 'Poupança' ? 'CP' : 'CC'} ${b.bank_account}` : null].filter(Boolean).join(' · ')
  : ''

/**
 * Pagamentos por DIA: Dia 8, Dia 15, Dia 20 e Avulsos — pensado para quem
 * paga (o contador): cada dia com o total, quantos já foram pagos e a lista
 * com PIX e banco. Base: lançamentos com VENCIMENTO no mês.
 * Pedido do Gabriel (30/09 e 01/10/2026).
 */
export default function PorDiaDePagamento({ mes, nomeMes, aLancar, irParaFolha, reembolsos, folha }: {
  mes: string
  nomeMes: string
  aLancar: number                 // vínculos do mês ainda sem lançamento
  irParaFolha: () => void
  reembolsos: ReembolsoRel[]
  folha: FolhaRel[]
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [escolhido, setEscolhido] = useState<ChaveDia | null>(null)
  const [gerando, setGerando] = useState<'' | 'excel' | 'pdf'>('')
  const { inicio, fim } = limitesDoMes(mes)
  const hoje = hojeISO()

  // Chave começa com 'payments': qualquer "Marcar pago" da tela atualiza esta lista
  const { data: saidas = [], isLoading, error } = useQuery({
    queryKey: ['payments', 'vencimento', mes],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments')
        .select('*, employee:employees(full_name)')
        .gte('due_date', inicio).lte('due_date', fim)
        .order('due_date')
      if (error) throw error
      return (data || []) as Saida[]
    },
  })
  // payments.client_id não tem chave estrangeira: nomes à parte
  const { data: clientes } = useQuery({
    queryKey: ['clientes-nomes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name')
      if (error) throw error // não guarda lista vazia por 5 minutos
      return new Map((data || []).map(c => [c.id as string, c.name as string]))
    },
    staleTime: 5 * 60_000,
  })
  // CPF, PIX e banco de quem recebe no mês — o que o contador precisa para pagar
  const ids = Array.from(new Set(saidas.map(s => s.employee_id).filter(Boolean) as string[])).sort()
  const { data: bancos } = useQuery({
    queryKey: ['dados-bancarios', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('employees')
        .select('id, full_name, cpf, pix, bank_name, bank_agency, bank_account, bank_account_type').in('id', ids)
      return new Map(((data || []) as DadosBanco[]).map(e => [e.id, e]))
    },
  })

  const pagarVarios = useMutation({
    mutationFn: async (idsPagar: string[]) => {
      // Só o que ainda está pendente: nunca muda a data de quem já estava pago
      const { error } = await supabase.from('payments')
        .update({ status: 'Pago', paid_at: new Date().toISOString() })
        .in('id', idsPagar).eq('status', 'Pendente')
      if (error) throw error
    },
    onSuccess: (_d, idsPagar) => {
      toast.success(idsPagar.length > 1 ? `${idsPagar.length} pagamentos marcados como pagos` : 'Marcado como pago!')
      qc.invalidateQueries({ queryKey: ['payments'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const grupos = agruparPorDia(saidas, hoje) as GrupoDia<Saida>[]
  const t = totaisDoMes(grupos)
  const pessoa = (p: Saida) => p.employee?.full_name || ''
  const cliente = (p: Lancamento) => (p.client_id && clientes?.get(p.client_id)) || ''
  const banco = (p: Lancamento) => (p.employee_id ? bancos?.get(p.employee_id) : undefined)

  // Dia aberto: o escolhido; senão o próximo dia de pagamento com algo a pagar;
  // senão o primeiro (8, 15, 20, avulsos) com algo pendente; senão o primeiro com lançamentos
  const proximo = grupos.find(g => g.chave !== 'avulso' && g.qtdPendentes > 0 && `${mes}-${g.chave.slice(1).padStart(2, '0')}` >= hoje)
    ?? grupos.find(g => g.qtdPendentes > 0) ?? grupos.find(g => g.itens.length > 0) ?? grupos[0]
  const aberto = grupos.find(g => g.chave === escolhido) ?? proximo
  const dataDoGrupo = (g: GrupoDia) => g.chave === 'avulso' ? null : `${mes}-${g.chave.slice(1).padStart(2, '0')}`

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success('Copiado') } catch { toast.error('Não consegui copiar') }
  }
  const pagar = async (p: Saida) => {
    if (await confirmar({
      titulo: `Confirmar pagamento de ${formatCurrency(Number(p.amount) || 0)}?`,
      texto: `${pessoa(p) || 'Sem colaborador'}${cliente(p) ? ` · ${cliente(p)}` : ''}\n${p.description || ''}`,
      confirmar: 'Sim, foi pago',
    })) pagarVarios.mutate([p.id])
  }
  const pagarTodos = async (g: GrupoDia<Saida>) => {
    const pend = g.itens.filter(p => p.status !== 'Pago')
    if (!pend.length) return
    if (await confirmar({
      titulo: `Marcar ${pend.length} pagamento${pend.length > 1 ? 's' : ''} como pago${pend.length > 1 ? 's' : ''}?`,
      texto: `${g.titulo}${dataDoGrupo(g) ? ` (${formatDate(dataDoGrupo(g)!)})` : ''} — total ${formatCurrency(g.pendente)}.\nUse só depois que o banco confirmar todos.`,
      confirmar: 'Sim, todos foram pagos',
    })) pagarVarios.mutate(pend.map(p => p.id))
  }

  const baixarExcel = async () => {
    setGerando('excel')
    try {
      const { exportRelatorioSaidas } = await import('../../lib/relatorioSaidas')
      await exportRelatorioSaidas({
        mes, nomeMes, grupos,
        nomePessoa: p => pessoa(p as Saida), nomeCliente: cliente,
        dadosBancarios: p => { const b = banco(p); return { cpf: b?.cpf || '', pix: b?.pix || '', banco: textoBanco(b) } },
        reembolsos, folha, mesFolha: nomeMes,
      })
      toast.success('Relatório baixado!')
    } catch (e) {
      toast.error('Não foi possível gerar o relatório: ' + (e as Error).message)
    } finally { setGerando('') }
  }
  const baixarLista = async (g: GrupoDia<Saida> | null) => {
    setGerando('pdf')
    try {
      const { gerarListaContador } = await import('../../lib/listaContadorPdf')
      const itens = g ? g.itens : grupos.flatMap(x => x.itens)
      const titulo = g ? `Pagamentos · ${g.titulo}${dataDoGrupo(g) ? ` · ${formatDate(dataDoGrupo(g)!)}` : ''}` : `Pagamentos · ${nomeMes}`
      const blob = await gerarListaContador(titulo, `Vencimento em ${nomeMes} · ${itens.length} lançamento(s)`, itens.map(p => {
        const b = banco(p)
        return {
          nome: pessoa(p) || p.description || 'Sem colaborador', cpf: b?.cpf, pix: b?.pix, banco: textoBanco(b),
          cliente: cliente(p), descricao: p.description, vencimento: p.due_date, valor: Number(p.amount) || 0, pago: p.status === 'Pago',
        }
      }))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `pagamentos_${mes}${g ? `_${g.chave === 'avulso' ? 'avulsos' : 'dia' + g.chave.slice(1)}` : ''}.pdf`
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      toast.error('Não foi possível gerar a lista: ' + (e as Error).message)
    } finally { setGerando('') }
  }

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading) return <p className="text-sm text-ink-500">Carregando…</p>

  const pctMes = t.total > 0 ? Math.round((t.pago / t.total) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Total do mês */}
      <div className="card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-ink-500">Sai em {nomeMes}</p>
            <p className="text-3xl md:text-4xl font-semibold text-ink-900 tnum mt-1 tracking-tight">{formatCurrency(t.total)}</p>
            <p className="text-xs text-ink-400 mt-0.5">{t.qtd} pagamento{t.qtd !== 1 ? 's' : ''} · {pctMes}% já pago</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => baixarLista(null)} disabled={!!gerando || !t.qtd} className="btn-secondary text-sm">
              <FileDown size={16} />{gerando === 'pdf' ? 'Gerando…' : 'Lista do contador'}
            </button>
            <button onClick={baixarExcel} disabled={!!gerando} className="btn-secondary text-sm">
              <FileSpreadsheet size={16} />{gerando === 'excel' ? 'Gerando…' : 'Relatório do mês'}
            </button>
          </div>
        </div>
        <div className="h-2 rounded-full bg-ink-100 overflow-hidden mt-4">
          <div className="h-2 rounded-full bg-green-600 transition-all" style={{ width: `${pctMes}%` }} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div><p className="text-xs text-ink-500">Já pago</p><p className="text-sm md:text-base font-semibold text-green-700 tnum">{formatCurrency(t.pago)}</p></div>
          <div className="border-l border-ink-100 pl-3"><p className="text-xs text-ink-500">Falta pagar</p><p className="text-sm md:text-base font-semibold text-ink-900 tnum">{formatCurrency(t.pendente)}</p></div>
          <div className="border-l border-ink-100 pl-3"><p className="text-xs text-ink-500">Atrasado</p><p className={`text-sm md:text-base font-semibold tnum ${t.atrasado > 0 ? 'text-red-600' : 'text-ink-400'}`}>{formatCurrency(t.atrasado)}</p></div>
        </div>
      </div>

      {/* Quem ainda não foi lançado não aparece nos dias */}
      {aLancar > 0 && (
        <button onClick={irParaFolha} className="w-full card p-3 flex items-center gap-3 text-left border-amber-200 bg-amber-50 hover:bg-amber-100/60">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span className="text-sm text-amber-900 flex-1">
            <strong>{aLancar} pessoa{aLancar > 1 ? 's' : ''}</strong> da folha de {nomeMes} ainda sem lançamento — só entram nos dias depois de lançadas.
          </span>
          <span className="text-xs font-medium text-amber-800 shrink-0">Lançar →</span>
        </button>
      )}

      {/* Os 4 dias lado a lado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {grupos.map(g => {
          const ativo = aberto?.chave === g.chave
          const pagos = g.itens.length - g.qtdPendentes
          const pct = g.total > 0 ? Math.round((g.pago / g.total) * 100) : 0
          const tudoPago = g.itens.length > 0 && g.qtdPendentes === 0
          const data = dataDoGrupo(g)
          return (
            <button key={g.chave} onClick={() => setEscolhido(g.chave)}
              className={`card p-3.5 text-left transition-all ${ativo ? 'ring-2 ring-primary-600 border-primary-600' : 'hover:border-ink-300'} ${g.itens.length === 0 ? 'opacity-60' : ''}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900">{g.titulo}</p>
                {tudoPago ? <span className="text-[10px] font-semibold text-green-700 flex items-center gap-0.5"><CheckCheck size={12} />pago</span>
                  : g.atrasado > 0 ? <span className="text-[10px] font-semibold text-red-600">atrasado</span>
                  : data && data === hoje ? <span className="text-[10px] font-semibold text-amber-700">hoje</span> : null}
              </div>
              <p className="text-[11px] text-ink-400">{data ? `${DIA_SEMANA[new Date(data + 'T12:00:00').getDay()]}, ${formatDate(data)}` : 'outros dias'}</p>
              <p className="text-lg font-semibold text-ink-900 tnum mt-2 leading-none">{formatCurrency(g.total)}</p>
              <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden mt-2">
                <div className="h-1.5 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-ink-500 mt-1">{g.itens.length === 0 ? 'nada neste dia' : `${pagos} de ${g.itens.length} pago${g.itens.length > 1 ? 's' : ''}`}</p>
            </button>
          )
        })}
      </div>

      {/* Lista do dia escolhido */}
      {aberto && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-base font-semibold text-ink-900">
                {aberto.titulo}
                {dataDoGrupo(aberto) && <span className="text-sm font-normal text-ink-500"> · {DIA_SEMANA[new Date(dataDoGrupo(aberto)! + 'T12:00:00').getDay()]}, {formatDate(dataDoGrupo(aberto)!)}</span>}
              </p>
              <p className="text-xs text-ink-500">
                {aberto.itens.length} pagamento{aberto.itens.length !== 1 ? 's' : ''}
                {aberto.pendente > 0 && <> · falta pagar <strong className="text-ink-800">{formatCurrency(aberto.pendente)}</strong></>}
                {aberto.pago > 0 && <> · pago <span className="text-green-700">{formatCurrency(aberto.pago)}</span></>}
              </p>
            </div>
            {aberto.itens.length > 0 && (
              <div className="flex gap-2">
                <button className="btn-secondary text-xs" disabled={!!gerando} onClick={() => baixarLista(aberto)}><FileDown size={14} />Lista deste dia</button>
                {aberto.qtdPendentes > 1 && (
                  <button className="btn-secondary text-xs" disabled={pagarVarios.isPending} onClick={() => pagarTodos(aberto)}><CheckCheck size={14} />Pagar todos</button>
                )}
              </div>
            )}
          </div>
          {aberto.itens.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-500">Nada com vencimento {aberto.chave === 'avulso' ? 'em outros dias' : 'neste dia'}.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {aberto.itens.map(p => {
                const pago = p.status === 'Pago'
                const atrasado = !pago && p.due_date < hoje
                const nome = pessoa(p)
                const b = banco(p)
                const contaBanco = textoBanco(b)
                return (
                  <div key={p.id} className={`flex items-start gap-3 px-4 py-3 ${pago ? 'bg-green-50/30' : ''}`}>
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${nome ? corDoAvatar(nome) : 'bg-ink-100 text-ink-500'}`}>
                      {nome ? iniciais(nome) : '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      {nome && p.employee_id ? (
                        <button className="text-sm font-semibold text-ink-900 hover:underline text-left" title="Abrir a jornada"
                          onClick={() => navigate(`/jornada?pessoa=${p.employee_id}&mes=${p.reference_month || mes}`)}>{nome}</button>
                      ) : <p className="text-sm font-semibold text-ink-900">{p.description}</p>}
                      <p className="text-[11px] text-ink-500 truncate">
                        {[cliente(p), aberto.chave === 'avulso' ? `vence ${formatDate(p.due_date)}` : null,
                          p.reference_month && p.reference_month !== mes ? `trabalho de ${mesCurto(p.reference_month)}` : null,
                          nome ? p.description : p.category].filter(Boolean).join(' · ')}
                      </p>
                      {/* O que o contador precisa para pagar */}
                      {(b?.pix || contaBanco) ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          {b?.pix && (
                            <button onClick={() => copiar(b.pix!)} className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-800 bg-primary-50 rounded px-1.5 py-0.5 hover:bg-primary-100" title="Copiar a chave PIX">
                              PIX {b.pix} <Copy size={11} />
                            </button>
                          )}
                          {contaBanco && <span className="text-[11px] text-ink-500">{contaBanco}</span>}
                        </div>
                      ) : nome ? <p className="text-[11px] text-amber-700 mt-1">Sem PIX e sem conta no cadastro</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-base font-semibold tnum ${pago ? 'text-green-700' : atrasado ? 'text-red-600' : 'text-ink-900'}`}>{formatCurrency(Number(p.amount) || 0)}</p>
                      {pago
                        ? <p className="text-[11px] text-green-700 flex items-center justify-end gap-1 mt-1"><Check size={12} />pago{p.paid_at ? ` ${formatDate(String(p.paid_at).slice(0, 10))}` : ''}</p>
                        : <button className={`mt-1 text-xs py-1.5 px-3 ${atrasado ? 'btn-danger' : 'btn-primary'}`} disabled={pagarVarios.isPending} onClick={() => pagar(p)}>{atrasado ? 'Pagar (atrasado)' : 'Pagar'}</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-ink-400 px-1">
        Pelo vencimento: a 2ª quinzena da consultoria vence no dia 8 do mês seguinte ao trabalhado e aparece aqui com "trabalho de" o mês dela. Cancelados não entram.
      </p>
    </div>
  )
}
