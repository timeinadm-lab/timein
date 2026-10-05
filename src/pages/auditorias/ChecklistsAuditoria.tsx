import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, Plus, Trash2, Copy, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { confirmar } from '../../components/ui/ConfirmDialog'
import type { Modelo } from './AuditoriasPage'

/**
 * Checklists das auditorias: perguntas com grupo, seção e peso.
 * Mudar aqui só vale para auditorias novas — as já feitas guardam a cópia do dia.
 */
type Pergunta = { id: string; grupo: string; secao: string | null; texto: string; peso: number; ordem: number; ativo: boolean; foto_obrigatoria?: boolean }

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
  // Blocos de seção na ordem das perguntas
  const secoes: { secao: string; lista: Pergunta[] }[] = []
  for (const p of perguntas) {
    const nome = p.secao || p.grupo
    if (secoes.at(-1)?.secao !== nome) secoes.push({ secao: nome, lista: [] })
    secoes.at(-1)!.lista.push(p)
  }
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
  const nova = async (base: Pergunta) => {
    const depois = perguntas.filter(p => p.ordem > base.ordem)
    // abre espaço logo abaixo da última pergunta da seção
    for (const p of [...depois].sort((a, b) => b.ordem - a.ordem)) {
      const { error } = await supabase.from('auditoria_perguntas').update({ ordem: p.ordem + 1 }).eq('id', p.id)
      if (error) { toast.error(error.message); return }
    }
    const { data, error } = await supabase.from('auditoria_perguntas').insert({
      modelo_id: atual!.id, grupo: base.grupo, secao: base.secao, texto: 'Nova pergunta?', peso: base.peso, ordem: base.ordem + 1,
    }).select('*').single()
    if (error) { toast.error(error.message); return }
    setPerguntas(l => [...l.map(p => p.ordem > base.ordem ? { ...p, ordem: p.ordem + 1 } : p), { ...data, peso: Number(data.peso) } as Pergunta].sort((a, b) => a.ordem - b.ordem))
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
    const { error: e2 } = await supabase.from('auditoria_perguntas').insert(perguntas.map(p => ({ modelo_id: m.id, grupo: p.grupo, secao: p.secao, texto: p.texto, peso: p.peso, ordem: p.ordem, ...(p.foto_obrigatoria !== undefined ? { foto_obrigatoria: !!p.foto_obrigatoria } : {}) })))
    if (e2) { toast.error(e2.message); return }
    qc.invalidateQueries({ queryKey: ['auditoria-modelos-todos'] }); qc.invalidateQueries({ queryKey: ['auditoria-modelos'] })
    setModeloId(m.id); toast.success('Checklist copiado')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <button onClick={() => navigate('/auditorias')} className="btn-ghost p-2 -ml-2" aria-label="Voltar"><ChevronLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <h1 className="page-title">Checklists</h1>
            <p className="text-sm text-ink-500">Mudanças valem para as próximas auditorias. As já feitas não mudam.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <select className="input flex-1 sm:w-auto" value={atual?.id || ''} onChange={e => setModeloId(e.target.value)}>
            {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <button className="btn-secondary text-sm shrink-0" onClick={duplicar} disabled={!atual}><Copy size={15} />Duplicar</button>
        </div>
      </div>

      {/* Peso de cada grupo (vale para todas as perguntas do grupo) */}
      {grupos.length > 0 && (
        <div className="card p-4 flex flex-wrap gap-x-6 gap-y-3 items-center">
          <p className="text-sm font-semibold text-ink-900 w-full sm:w-auto">Peso por grupo</p>
          {grupos.map(g => {
            const lista = perguntas.filter(p => p.grupo === g)
            const pesos = [...new Set(lista.map(p => p.peso))]
            return (
              <label key={g} className="text-sm text-ink-700 flex items-center gap-2">{g} <span className="text-ink-400 text-xs">({lista.length})</span>
                <input className="input w-16 !py-1.5 text-center" type="number" step="0.5" min="0.5" defaultValue={pesos.length === 1 ? pesos[0] : ''}
                  placeholder={pesos.length > 1 ? 'vários' : ''} onBlur={e => e.target.value && Number(e.target.value) !== pesos[0] && pesoDoGrupo(g, Number(e.target.value))} />
              </label>
            )
          })}
        </div>
      )}

      {/* Perguntas na ordem do checklist, por seção */}
      {secoes.map(({ secao, lista }, k) => (
        <div key={secao + k} className="card overflow-hidden">
          <div className="px-4 py-2.5 bg-primary-900 text-white text-sm font-semibold">{secao} <span className="font-normal text-white/70">· {lista.length}</span></div>
          <div className="divide-y divide-ink-100">
            {lista.map(p => (
              <div key={p.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-xs text-ink-400 tnum pt-2 w-6 shrink-0">{perguntas.indexOf(p) + 1}</span>
                  <textarea className="input text-sm !py-1.5 resize-y flex-1" rows={3} defaultValue={p.texto} onBlur={e => e.target.value.trim() && e.target.value.trim() !== p.texto && salvar(p.id, { texto: e.target.value.trim() })} />
                  <button className="p-2 text-ink-400 hover:text-red-600 shrink-0" onClick={() => tirar(p)} aria-label="Tirar pergunta"><Trash2 size={15} /></button>
                </div>
                <div className="flex items-center gap-2 flex-wrap pl-8">
                  <select className="input w-auto !py-1.5 text-xs" value={p.grupo} onChange={e => salvar(p.id, { grupo: e.target.value })}>
                    {grupos.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <label className="text-xs text-ink-500 flex items-center gap-1">Peso
                    <input className="input w-14 !py-1.5 !px-2 text-center text-sm" type="number" step="0.5" min="0.5" defaultValue={p.peso} key={p.peso}
                      onBlur={e => Number(e.target.value) > 0 && Number(e.target.value) !== p.peso && salvar(p.id, { peso: Number(e.target.value) })} />
                  </label>
                  <label className="text-xs text-ink-700 flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-primary-700" checked={!!p.foto_obrigatoria} onChange={e => salvar(p.id, { foto_obrigatoria: e.target.checked })} />
                    <Camera size={13} />Foto obrigatória
                  </label>
                  <input className="input text-xs !py-1.5 flex-1 min-w-[10rem] text-ink-500" placeholder="Seção" defaultValue={p.secao || ''} onBlur={e => (e.target.value.trim() || null) !== p.secao && salvar(p.id, { secao: e.target.value.trim() || null })} />
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-ink-100">
            <button className="btn-ghost text-sm" onClick={() => nova(lista[lista.length - 1])}><Plus size={14} />Pergunta em {secao}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
