import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Check, ChevronDown, ChevronUp, FileSpreadsheet, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatDate, hojeISO } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { agruparPorDia, totaisDoMes, limitesDoMes, mesCurto } from '../../lib/pagamentosPorDia'
import type { Lancamento, GrupoDia } from '../../lib/pagamentosPorDia'
import type { FolhaRel, ReembolsoRel } from '../../lib/relatorioSaidas'

type Saida = Lancamento & { employee?: { full_name?: string } | null }

/**
 * Saídas do mês por dia de pagamento: Dia 8, Dia 15, Dia 20 e Avulsos.
 * Base: lançamentos com VENCIMENTO no mês (o dinheiro que sai no mês).
 * Pedido do Gabriel, 30/09/2026.
 */
export default function PorDiaDePagamento({ mes, nomeMes, onPagar, pagando, aLancar, irParaFolha, reembolsos, folha }: {
  mes: string
  nomeMes: string
  onPagar: (id: string) => void
  pagando: boolean
  aLancar: number                 // vínculos do mês ainda sem lançamento
  irParaFolha: () => void
  reembolsos: ReembolsoRel[]
  folha: FolhaRel[]
}) {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})
  const [gerando, setGerando] = useState(false)
  const { inicio, fim } = limitesDoMes(mes)
  const hoje = hojeISO()

  // Chave começa com 'payments': o "Marcar pago" da tela já atualiza esta lista
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
  const { data: clientes = new Map<string, string>() } = useQuery({
    queryKey: ['clientes-nomes'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name')
      return new Map((data || []).map(c => [c.id as string, c.name as string]))
    },
    staleTime: 5 * 60_000,
  })

  const grupos = agruparPorDia(saidas, hoje) as GrupoDia<Saida>[]
  const t = totaisDoMes(grupos)
  const pessoa = (p: Saida) => p.employee?.full_name || ''
  const cliente = (p: Lancamento) => (p.client_id && clientes.get(p.client_id)) || ''

  const baixarRelatorio = async () => {
    setGerando(true)
    try {
      const { exportRelatorioSaidas } = await import('../../lib/relatorioSaidas')
      await exportRelatorioSaidas({
        mes, nomeMes, grupos,
        nomePessoa: p => pessoa(p as Saida), nomeCliente: cliente,
        reembolsos, folha, mesFolha: nomeMes,
      })
      toast.success('Relatório baixado!')
    } catch (e) {
      toast.error('Não foi possível gerar o relatório: ' + (e as Error).message)
    } finally {
      setGerando(false)
    }
  }

  const pagar = async (p: Saida) => {
    if (await confirmar({
      titulo: `Confirmar pagamento de ${formatCurrency(Number(p.amount) || 0)}?`,
      texto: `${pessoa(p) || 'Sem colaborador'}${cliente(p) ? ` · ${cliente(p)}` : ''}\n${p.description || ''}`,
      confirmar: 'Sim, foi pago',
    })) onPagar(p.id)
  }

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading) return <p className="text-sm text-ink-500">Carregando…</p>

  return (
    <div className="space-y-4">
      {/* Total do mês */}
      <div className="card p-4 md:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-ink-500">Saídas com vencimento em {nomeMes}</p>
            <p className="text-3xl md:text-4xl font-semibold text-ink-900 tnum mt-1 tracking-tight">{formatCurrency(t.total)}</p>
            <p className="text-xs text-ink-400 mt-0.5">{t.qtd} lançamento{t.qtd !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={baixarRelatorio} disabled={gerando} className="btn-secondary text-sm">
            <FileSpreadsheet size={16} />{gerando ? 'Gerando…' : 'Relatório do mês'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div><p className="text-xs text-ink-500">Já pago</p><p className="text-sm md:text-base font-semibold text-green-700 tnum">{formatCurrency(t.pago)}</p></div>
          <div className="border-l border-ink-100 pl-3"><p className="text-xs text-ink-500">Falta pagar</p><p className="text-sm md:text-base font-semibold text-ink-900 tnum">{formatCurrency(t.pendente)}</p></div>
          <div className="border-l border-ink-100 pl-3"><p className="text-xs text-ink-500">Atrasado</p><p className={`text-sm md:text-base font-semibold tnum ${t.atrasado > 0 ? 'text-red-600' : 'text-ink-400'}`}>{formatCurrency(t.atrasado)}</p></div>
        </div>
      </div>

      {/* Quem ainda não foi lançado não aparece nos dias — avisar para não achar que está tudo aqui */}
      {aLancar > 0 && (
        <button onClick={irParaFolha} className="w-full card p-3 flex items-center gap-3 text-left border-amber-200 bg-amber-50 hover:bg-amber-100/60">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span className="text-sm text-amber-900 flex-1">
            <strong>{aLancar} vínculo{aLancar > 1 ? 's' : ''}</strong> da folha de {nomeMes} ainda sem lançamento — só entram nos dias depois de lançados.
          </span>
          <span className="text-xs font-medium text-amber-800 shrink-0">Ver na folha →</span>
        </button>
      )}

      {grupos.map(g => {
        const aberto = abertos[g.chave] ?? g.qtdPendentes > 0
        const dataDoDia = g.chave === 'avulso' ? null : `${mes}-${g.chave.slice(1).padStart(2, '0')}`
        return (
          <div key={g.chave} className="card overflow-hidden">
            <button type="button" onClick={() => setAbertos(a => ({ ...a, [g.chave]: !aberto }))}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/60">
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-ink-900">
                  {g.titulo}
                  {dataDoDia && <span className="text-xs font-normal text-ink-400"> · {formatDate(dataDoDia)}</span>}
                  {g.chave === 'avulso' && <span className="text-xs font-normal text-ink-400"> · outros dias</span>}
                </p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {g.itens.length === 0 ? 'Nada com vencimento neste dia'
                    : <>{g.itens.length} lançamento{g.itens.length !== 1 ? 's' : ''}
                      {g.pago > 0 && <> · <span className="text-green-700">pago {formatCurrency(g.pago)}</span></>}
                      {g.pendente > 0 && <> · falta {formatCurrency(g.pendente)}</>}
                      {g.atrasado > 0 && <> · <span className="text-red-600 font-medium">atrasado {formatCurrency(g.atrasado)}</span></>}</>}
                </p>
              </div>
              <p className="text-lg font-semibold text-ink-900 tnum shrink-0">{formatCurrency(g.total)}</p>
              {g.itens.length > 0 && (aberto ? <ChevronUp size={16} className="text-ink-400 shrink-0" /> : <ChevronDown size={16} className="text-ink-400 shrink-0" />)}
            </button>
            {aberto && g.itens.length > 0 && (
              <div className="divide-y divide-ink-100 border-t border-ink-100">
                {g.itens.map(p => {
                  const atrasado = p.status !== 'Pago' && p.due_date < hoje
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-900 truncate">
                          {pessoa(p) || <span className="text-ink-500">{p.description}</span>}
                          {cliente(p) && <span className="text-ink-500"> · {cliente(p)}</span>}
                        </p>
                        <p className="text-[11px] text-ink-500 truncate">
                          {g.chave === 'avulso' && <span className="tnum">{formatDate(p.due_date)} · </span>}
                          {pessoa(p) ? p.description : p.category}
                          {p.reference_month && p.reference_month !== mes && <> · trabalho de {mesCurto(p.reference_month)}</>}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold tnum shrink-0 ${p.status === 'Pago' ? 'text-green-700' : atrasado ? 'text-red-600' : 'text-ink-900'}`}>
                        {formatCurrency(Number(p.amount) || 0)}
                      </p>
                      {p.status === 'Pago'
                        ? <span className="text-[11px] text-green-700 w-16 text-right shrink-0 flex items-center justify-end gap-1"><Check size={12} />pago</span>
                        : <button className="btn-secondary text-xs py-1.5 w-16 justify-center shrink-0" disabled={pagando} onClick={() => pagar(p)}>Pagar</button>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <p className="text-[11px] text-ink-400 px-1">
        Pelo vencimento: a 2ª quinzena da consultoria vence no dia 8 do mês seguinte ao trabalhado e aparece aqui com "trabalho de" o mês dela. Cancelados não entram.
      </p>
    </div>
  )
}
