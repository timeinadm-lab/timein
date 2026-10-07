import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { StickyNote, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'

/**
 * Notas do candidato (pedido de 07/10/2026: "mandando mensagem pra muita gente…
 * deixar uma nota ali"). Usa a tabela candidate_contacts (o antigo Histórico de
 * Contatos): data de hoje + quem escreveu, automáticos. Aparece na ficha do
 * candidato e, compacta, em cada interessado da vaga.
 */

const RAPIDAS = ['Mandei mensagem', 'Não respondeu', 'Sem interesse', 'Interessada', 'Chamar depois']

type Nota = { id: string; contact_date: string | null; responsible: string | null; observations: string | null; created_at: string }

export default function NotasCandidato({ candidateId, compacta = false }: { candidateId: string; compacta?: boolean }) {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [aberta, setAberta] = useState(!compacta)
  const [texto, setTexto] = useState('')
  const { data: notas = [] } = useQuery({
    queryKey: ['candidate-contacts', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase.from('candidate_contacts').select('id, contact_date, responsible, observations, created_at')
        .eq('candidate_id', candidateId).order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as Nota[]
    },
  })
  const salvar = useMutation({
    mutationFn: async (obs: string) => {
      const { error } = await supabase.from('candidate_contacts').insert({
        candidate_id: candidateId, contact_date: hojeISO(), responsible: profile?.full_name || null, observations: obs,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setTexto('')
      if (compacta) setAberta(false)
      toast.success('Nota salva')
      qc.invalidateQueries({ queryKey: ['candidate-contacts', candidateId] })
      qc.invalidateQueries({ queryKey: ['candidates'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const apagar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('candidate_contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['candidate-contacts', candidateId] }),
    onError: (e: Error) => toast.error(e.message),
  })
  const enviar = () => { const t = texto.trim(); if (t) salvar.mutate(t) }
  const ultima = notas[0]
  const quando = (n: Nota) => formatDate(n.contact_date || n.created_at.slice(0, 10)).slice(0, 5)

  const formulario = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {RAPIDAS.map(r => (
          <button key={r} type="button" onClick={() => setTexto(t => t ? `${t} · ${r}` : r)}
            className="text-[11px] px-2 py-1 rounded-lg border border-ink-200 text-ink-600 hover:border-primary-400 hover:text-primary-800">{r}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea className="input text-sm min-h-[2.5rem]" rows={2} value={texto} onChange={e => setTexto(e.target.value)}
          placeholder="Ex.: mandei a vaga no WhatsApp, vai responder amanhã" autoFocus={compacta}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar() }} />
        <button className="btn-primary text-sm self-end" disabled={!texto.trim() || salvar.isPending} onClick={enviar}>Salvar</button>
      </div>
    </div>
  )

  if (compacta) {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-start gap-2 text-xs">
          <StickyNote size={13} className="text-ink-400 mt-0.5 shrink-0" />
          {ultima
            ? <p className="text-ink-600 flex-1 min-w-0"><span className="text-ink-400">{quando(ultima)}</span> {ultima.observations}{notas.length > 1 && <span className="text-ink-400"> · +{notas.length - 1}</span>}</p>
            : <p className="text-ink-400 flex-1">Sem nota</p>}
          {!aberta && <button className="text-primary-700 font-medium shrink-0 hover:underline" onClick={() => setAberta(true)}>+ nota</button>}
        </div>
        {aberta && formulario}
      </div>
    )
  }

  return (
    <div className="card p-4 md:p-5 space-y-3">
      <h3 className="font-medium flex items-center gap-2"><StickyNote size={16} className="text-ink-400" />Notas</h3>
      {formulario}
      <div className="divide-y divide-ink-100">
        {notas.map(n => (
          <div key={n.id} className="py-2.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-800 whitespace-pre-wrap">{n.observations}</p>
              <p className="text-[11px] text-ink-400 mt-0.5">{formatDate(n.contact_date || n.created_at.slice(0, 10))}{n.responsible ? ` · ${n.responsible}` : ''}</p>
            </div>
            <button className="p-1.5 text-ink-300 hover:text-red-600" title="Apagar nota" onClick={() => apagar.mutate(n.id)}><Trash2 size={14} /></button>
          </div>
        ))}
        {!notas.length && <p className="text-sm text-ink-400 py-2">Nenhuma nota ainda.</p>}
      </div>
    </div>
  )
}
