// Observações do colaborador (migração 094, pedido de 15/10/2026).
// Ficam salvas até o RH apagar. As de destaque aparecem numa faixa no topo do
// perfil, em qualquer aba — "isso tem que ter destaque na hora que eu acesso".
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { StickyNote, Trash2, Pin, PinOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { confirmar } from '../../components/ui/ConfirmDialog'

export type Observacao = { id: string; employee_id: string; texto: string; destaque: boolean; criado_por: string | null; criado_em: string }

const quando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const faltaMigracao = (e: unknown) => /employee_observacoes/.test((e as Error)?.message || '')

export function useObservacoes(employeeId: string) {
  return useQuery({
    queryKey: ['observacoes', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_observacoes').select('*')
        .eq('employee_id', employeeId).order('criado_em', { ascending: false })
      if (error) throw error
      return (data || []) as Observacao[]
    },
    retry: false,
  })
}

/** Faixa no topo do colaborador com as observações em destaque */
export function FaixaObservacoes({ employeeId, abrir }: { employeeId: string; abrir: () => void }) {
  const { data } = useObservacoes(employeeId)
  const destaques = (data || []).filter(o => o.destaque)
  if (!destaques.length) return null
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-900"><StickyNote size={15} /> Atenção</p>
        <button onClick={abrir} className="text-xs font-medium text-amber-800 underline underline-offset-2">Ver observações</button>
      </div>
      <ul className="space-y-1">
        {destaques.map(o => (
          <li key={o.id} className="text-sm text-amber-900 leading-snug whitespace-pre-line">• {o.texto}</li>
        ))}
      </ul>
    </div>
  )
}

/** Aba Observações: escrever, destacar e apagar */
export function AbaObservacoes({ employeeId }: { employeeId: string }) {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const { data, isLoading, error } = useObservacoes(employeeId)
  const [texto, setTexto] = useState('')
  const [destaque, setDestaque] = useState(true)
  const atualizar = () => qc.invalidateQueries({ queryKey: ['observacoes', employeeId] })

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('employee_observacoes')
        .insert({ employee_id: employeeId, texto: texto.trim(), destaque, criado_por: profile?.full_name || null })
      if (error) throw error
    },
    onSuccess: () => { setTexto(''); setDestaque(true); atualizar(); toast.success('Observação salva') },
    onError: e => toast.error(faltaMigracao(e) ? 'Falta rodar a migração 094 no Supabase.' : 'Não salvou: ' + (e as Error).message),
  })
  const alternar = useMutation({
    mutationFn: async (o: Observacao) => {
      const { error } = await supabase.from('employee_observacoes').update({ destaque: !o.destaque }).eq('id', o.id)
      if (error) throw error
    },
    onSuccess: atualizar,
    onError: e => toast.error('Não mudou: ' + (e as Error).message),
  })
  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employee_observacoes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { atualizar(); toast.success('Observação apagada') },
    onError: e => toast.error('Não apagou: ' + (e as Error).message),
  })

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <textarea className="input resize-none" rows={3} value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Ex.: atualizar o valor no contrato dela · metade o cliente paga, metade a gente paga" />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
            <input type="checkbox" className="rounded" checked={destaque} onChange={e => setDestaque(e.target.checked)} />
            Destacar no topo do colaborador
          </label>
          <button className="btn-primary text-sm" disabled={!texto.trim() || salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? 'Salvando…' : 'Salvar observação'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">
          {faltaMigracao(error) ? 'Falta rodar a migração 094 (observações) no Supabase.' : 'Não carregou: ' + (error as Error).message}
        </div>
      ) : isLoading ? <p className="text-sm text-ink-500">Carregando…</p>
      : !data?.length ? <div className="card p-6 text-center text-sm text-ink-500">Nenhuma observação ainda.</div>
      : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.map(o => (
            <div key={o.id} className={`flex items-start gap-3 px-4 py-3 ${o.destaque ? 'bg-amber-50/60' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-900 whitespace-pre-line">{o.texto}</p>
                <p className="text-xs text-ink-400 mt-1">{quando(o.criado_em)}{o.criado_por ? ` · ${o.criado_por}` : ''}{o.destaque ? ' · em destaque' : ''}</p>
              </div>
              <button title={o.destaque ? 'Tirar do destaque' : 'Destacar no topo'} onClick={() => alternar.mutate(o)}
                className={`p-2 rounded-lg hover:bg-ink-100 ${o.destaque ? 'text-amber-600' : 'text-ink-400'}`}>
                {o.destaque ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
              <button title="Apagar" className="p-2 rounded-lg text-red-500 hover:bg-red-50"
                onClick={async () => {
                  if (await confirmar({ titulo: 'Apagar observação?', texto: o.texto, confirmar: 'Apagar', cancelar: 'Cancelar' })) apagar.mutate(o.id)
                }}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
