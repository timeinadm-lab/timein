import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, Plus, Trash2, Copy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { confirmar } from '../../components/ui/ConfirmDialog'
import type { Modelo } from './AuditoriasPage'

/**
 * Checklists das auditorias: perguntas com grupo, seção e peso.
 * Mudar aqui só vale para auditorias novas — as já feitas guardam a cópia do dia.
 */
type Pergunta = { id: string; grupo: string; secao: string | null; texto: string; peso: number; ordem: number; ativo: boolean }

export default function ChecklistsAuditoria() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: modelos = [] } = useQuery({
    queryKey: ['auditoria-modelos-todos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auditoria_modelos').select('*').order('nome')
      if (error) throw error
      return (data || []) as Modelo[]
    },
  })
  const [modeloId, setModeloId] = useState('')
  const atual = modelos.find(m => m.id === (modeloId || modelos[0]?.id))
  const { data: perguntasDb } = useQuery({
    queryKey: ['auditoria-perguntas', atual?.id],
    enabled: !!atual,
    queryFn: async () => {
      const { data, error } = await supabase.from('auditoria_perguntas').select('*').eq('modelo_id', atual!.id).eq('ativo', true).order('ordem')
      if (error) throw error
      return (data || []).map(p => ({ ...p, peso: Number(p.peso) })) as Pergunta[]
    },
  })
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  useEffect(() => { setPerguntas(perguntasDb || []) }, [perguntasDb])

  const grupos = [...new Set(perguntas.map(p => p.grupo))]
  const salvar = async (id: string, mudar: Partial<Pergunta>) => {
    setPerguntas(l => l.map(p => p.id === id ? { ...p, ...mudar } : p))
    const { error } = await supabase.from('auditoria_perguntas').update(mudar).eq('id', id)
    if (error) toast.error(error.message)
  }
  // Peso de um grupo inteiro de uma vez (ex.: Boas Práticas = 2)
  const pesoDoGrupo = async (grupo: string, peso: number) => {
    if (!(peso > 0)) return
    setPerguntas(l => l.map(p => p.grupo === grupo ? { ...p, peso } : p))
    const { error } = await supabase.from('auditoria_perguntas').update({ peso }).eq('modelo_id', atual!.id).eq('grupo', grupo)
    if (error) toast.error(error.message); else toast.success(`${grupo}: peso ${peso} em todas`)
  }
  const nova = async (grupo: string, secao: string | null) => {
    const ultima = Math.max(0, ...perguntas.map(p => p.ordem))
    const doGrupo = perguntas.filter(p => p.grupo === grupo)
    const { data, error } = await supabase.from('auditoria_perguntas').insert({
      modelo_id: atual!.id, grupo, secao, texto: 'Nova pergunta?', peso: doGrupo[0]?.peso || 1, ordem: ultima + 1,
    }).select('*').single()
    if (error) { toast.error(error.message); return }
    setPerguntas(l => [...l, { ...data, peso: Number(data.peso) } as Pergunta])
  }
  const tirar = async (p: Pergunta) => {
    if (!(await confirmar({ titulo: 'Tirar esta pergunta do checklist?', texto: 'As auditorias já feitas continuam com ela.', confirmar: 'Tirar' }))) return
    setPerguntas(l => l.filter(x => x.id !== p.id))
    const { error } = await supabase.from('auditoria_perguntas').update({ ativo: false }).eq('id', p.id)
    if (error) toast.error(error.message)
  }
  const duplicar = async () => {
    if (!atual) return
    const nome = prompt('Nome do novo checklist (cópia deste):', `${atual.nome} (cópia)`)
    if (!nome?.trim()) return
    const { data: m, error } = await supabase.from('auditoria_modelos').insert({ nome: nome.trim(), descricao: atual.descricao, faixas: atual.faixas }).select('id').single()
    if (error) { toast.error(error.message); return }
    const { error: e2 } = await supabase.from('auditoria_perguntas').insert(perguntas.map(p => ({ modelo_id: m.id, grupo: p.grupo, secao: p.secao, texto: p.texto, peso: p.peso, ordem: p.ordem })))
    if (e2) { toast.error(e2.message); return }
    qc.invalidateQueries({ queryKey: ['auditoria-modelos-todos'] }); qc.invalidateQueries({ queryKey: ['auditoria-modelos'] })
    setModeloId(m.id); toast.success('Checklist copiado')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => navigate('/auditorias')} className="btn-ghost p-2 -ml-2" aria-label="Voltar"><ChevronLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title">Checklists</h1>
          <p className="text-sm text-ink-500">Mudanças valem para as próximas auditorias. As já feitas não mudam.</p>
        </div>
        <select className="input w-auto" value={atual?.id || ''} onChange={e => setModeloId(e.target.value)}>
          {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
        <button className="btn-secondary text-sm" onClick={duplicar} disabled={!atual}><Copy size={15} />Duplicar</button>
      </div>

      {grupos.map(g => {
        const lista = perguntas.filter(p => p.grupo === g)
        const pesos = [...new Set(lista.map(p => p.peso))]
        return (
          <div key={g} className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-primary-900 text-white flex items-center gap-3 flex-wrap">
              <p className="text-sm font-semibold flex-1">{g} <span className="font-normal text-white/70">· {lista.length} perguntas</span></p>
              <label className="text-xs text-white/80 flex items-center gap-1.5">Peso do grupo
                <input className="w-14 rounded-md px-2 py-1 text-ink-900 text-sm" type="number" step="0.5" min="0.5" defaultValue={pesos.length === 1 ? pesos[0] : ''}
                  placeholder={pesos.length > 1 ? 'vários' : ''} onBlur={e => e.target.value && Number(e.target.value) !== pesos[0] && pesoDoGrupo(g, Number(e.target.value))} />
              </label>
            </div>
            <div className="divide-y divide-ink-100">
              {lista.map(p => (
                <div key={p.id} className="px-4 py-2 flex items-start gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <textarea className="input text-sm !py-1.5" rows={1} defaultValue={p.texto} onBlur={e => e.target.value.trim() && e.target.value.trim() !== p.texto && salvar(p.id, { texto: e.target.value.trim() })} />
                    <input className="input text-xs !py-1 text-ink-500" placeholder="Seção (ex.: Recebimento e Armazenamento)" defaultValue={p.secao || ''} onBlur={e => (e.target.value.trim() || null) !== p.secao && salvar(p.id, { secao: e.target.value.trim() || null })} />
                  </div>
                  <input className="input w-16 text-sm !py-1.5" type="number" step="0.5" min="0.5" title="Peso" defaultValue={p.peso} onBlur={e => Number(e.target.value) > 0 && Number(e.target.value) !== p.peso && salvar(p.id, { peso: Number(e.target.value) })} />
                  <button className="p-2 text-ink-400 hover:text-red-600" onClick={() => tirar(p)} aria-label="Tirar pergunta"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-ink-100">
              <button className="btn-ghost text-sm" onClick={() => nova(g, lista.at(-1)?.secao ?? null)}><Plus size={14} />Pergunta em {g}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
