import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Cake, ChevronRight, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { hojeISO, getInitials, corDoAvatar } from '../../lib/utils'
import { aniversariantesDoMes, proximoAniversario } from '../../lib/aniversario'

/**
 * Controle de aniversariantes (pedido de 16/10/2026): quem faz aniversário
 * hoje e nos próximos dias, o ano inteiro mês a mês e quem está sem data de
 * nascimento no cadastro. Só colaboradores ativos. No Calendário os
 * aniversários aparecem em rosa.
 */
type Pessoa = { id: string; full_name: string; birth_date: string | null; role?: string | null }
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export default function AniversariantesPage() {
  const navigate = useNavigate()
  const hoje = hojeISO()
  const [ano, setAno] = useState(+hoje.slice(0, 4))
  const [verSemData, setVerSemData] = useState(false)

  const { data: pessoas = [], isLoading, error } = useQuery({
    queryKey: ['aniversariantes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id, full_name, birth_date, role').neq('status', 'Inativo').order('full_name')
      if (error) throw new Error(error.message)
      return (data || []) as Pessoa[]
    },
  })
  const comData = pessoas.filter(p => p.birth_date)
  const semData = pessoas.filter(p => !p.birth_date)

  // Hoje e próximos 30 dias
  const proximos = useMemo(() => comData
    .map(p => ({ ...p, prox: proximoAniversario(p.birth_date, hoje)! }))
    .filter(p => p.prox && p.prox.dias <= 30)
    .sort((a, b) => a.prox.dias - b.prox.dias || a.full_name.localeCompare(b.full_name)), [comData, hoje])

  const mesAtual = +hoje.slice(5, 7)

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Agenda</p>
          <h1 className="page-title flex items-center gap-2"><Cake size={26} className="text-pink-600" />Aniversariantes</h1>
          <p className="text-sm text-ink-500 mt-1">Colaboradores ativos. No Calendário os aniversários aparecem em rosa.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setAno(a => a - 1)}>‹</button>
          <span className="font-semibold text-ink-900 w-14 text-center tnum">{ano}</span>
          <button className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setAno(a => a + 1)}>›</button>
        </div>
      </div>

      {isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : (
        <>
          {/* Próximos 30 dias */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">Próximos 30 dias</h2>
              <span className="text-xs text-ink-500">{proximos.length} {proximos.length === 1 ? 'pessoa' : 'pessoas'}</span>
            </div>
            {proximos.length === 0 ? <p className="px-4 py-5 text-sm text-ink-500 text-center">Ninguém faz aniversário nos próximos 30 dias.</p> : (
              <div className="divide-y divide-ink-100">
                {proximos.map(p => (
                  <button key={p.id} onClick={() => navigate(`/colaboradores/${p.id}`)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50/70 ${p.prox.dias === 0 ? 'bg-pink-50' : ''}`}>
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${corDoAvatar(p.full_name)}`}>{getInitials(p.full_name)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink-900 truncate">{p.full_name}</span>
                      <span className="block text-xs text-ink-500">{dm(p.prox.data)}{p.prox.idade ? ` · faz ${p.prox.idade} anos` : ''}{p.role ? ` · ${p.role}` : ''}</span>
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${p.prox.dias === 0 ? 'bg-pink-600 text-white' : p.prox.dias <= 7 ? 'bg-pink-100 text-pink-800' : 'bg-ink-100 text-ink-600'}`}>
                      {p.prox.dias === 0 ? 'Hoje' : p.prox.dias === 1 ? 'Amanhã' : `em ${p.prox.dias} dias`}
                    </span>
                    <ChevronRight size={15} className="text-ink-300 shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sem data de nascimento */}
          {semData.length > 0 && (
            <div className="card p-4 border-amber-200 bg-amber-50/50">
              <button className="w-full flex items-center gap-2 text-left" onClick={() => setVerSemData(v => !v)}>
                <AlertCircle size={16} className="text-amber-600 shrink-0" />
                <span className="flex-1 text-sm text-amber-900"><b>{semData.length}</b> {semData.length === 1 ? 'colaborador ativo está' : 'colaboradores ativos estão'} sem data de nascimento no cadastro</span>
                <span className="text-xs font-medium text-amber-800">{verSemData ? 'Fechar' : 'Ver quem'}</span>
              </button>
              {verSemData && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {semData.map(p => (
                    <button key={p.id} onClick={() => navigate(`/colaboradores/${p.id}/editar`)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-ink-800 hover:border-amber-400">{p.full_name}</button>
                  ))}
                  <p className="w-full text-[11px] text-amber-800 mt-1">Toque no nome para abrir o cadastro e preencher a data.</p>
                </div>
              )}
            </div>
          )}

          {/* O ano mês a mês */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MESES.map((nome, i) => {
              const mes = `${ano}-${String(i + 1).padStart(2, '0')}`
              const lista = aniversariantesDoMes(comData, mes)
              const atual = ano === +hoje.slice(0, 4) && i + 1 === mesAtual
              return (
                <div key={mes} className={`card overflow-hidden ${atual ? 'border-pink-300 ring-1 ring-pink-200' : ''}`}>
                  <div className={`px-4 py-2.5 flex items-center justify-between ${atual ? 'bg-pink-50' : 'bg-ink-50/60'}`}>
                    <h3 className={`text-sm font-semibold ${atual ? 'text-pink-800' : 'text-ink-800'}`}>{nome}</h3>
                    <span className="text-xs text-ink-500">{lista.length || '–'}</span>
                  </div>
                  {lista.length === 0 ? <p className="px-4 py-3 text-xs text-ink-400">Nenhum aniversariante.</p> : (
                    <div className="divide-y divide-ink-100">
                      {lista.map(p => (
                        <button key={p.id} onClick={() => navigate(`/colaboradores/${p.id}`)}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-ink-50/70 ${p.data === hoje ? 'bg-pink-50' : ''}`}>
                          <span className={`w-9 text-center text-sm font-semibold tnum shrink-0 ${p.data === hoje ? 'text-pink-700' : 'text-ink-700'}`}>{p.data.slice(8, 10)}</span>
                          <span className="flex-1 min-w-0 text-sm text-ink-900 truncate">{p.full_name}</span>
                          {p.idade != null && <span className="text-xs text-ink-500 shrink-0">{p.idade} anos</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
