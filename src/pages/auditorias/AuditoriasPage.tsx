import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, ListChecks, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, hojeISO } from '../../lib/utils'
import { corDaFaixa, classificar } from '../../lib/auditoria'
import type { Faixa } from '../../lib/auditoria'

/**
 * Auditorias por checklist (migração 079). Pedido de 04/10/2026: o cliente
 * MELI quer, num relatório só, a nota com peso, as barras de não
 * conformidade por grupo e todas as perguntas com peso, observação e fotos.
 * A auditoria é preenchida aqui (celular ou computador) e o PDF sai pronto.
 */

export type Modelo = { id: string; nome: string; descricao?: string | null; faixas: Faixa[]; ativo: boolean }
type AuditoriaLinha = {
  id: string; titulo: string; data: string; status: 'rascunho' | 'finalizada'; nota: number | null; faixas: Faixa[]
  unidade?: string | null; concessionaria?: string | null; auditor_nome?: string | null; client?: { name?: string } | null
}
const erroTabela = (m: string) => /auditoria/.test(m) && /does not exist|schema cache|relation/i.test(m)

export default function AuditoriasPage() {
  const navigate = useNavigate()
  const [nova, setNova] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['auditorias'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auditorias').select('id, titulo, data, status, nota, faixas, unidade, concessionaria, auditor_nome, client:clients(name)').order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(300)
      if (error) throw new Error(error.message)
      return (data || []) as unknown as AuditoriaLinha[]
    },
  })
  const semMigracao = error && erroTabela((error as Error).message)

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="eyebrow mb-1">Operação</p>
          <h1 className="page-title">Auditorias</h1>
          <p className="text-sm text-ink-500 mt-1">Checklist com peso, fotos e relatório pronto para o cliente.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary text-sm" onClick={() => navigate('/auditorias/checklists')}><ListChecks size={15} />Checklists</button>
          <button className="btn-primary text-sm" disabled={!!semMigracao} onClick={() => setNova(true)}><Plus size={15} />Nova auditoria</button>
        </div>
      </div>

      {semMigracao ? (
        <div className="card p-4 border-amber-200 bg-amber-50 text-sm text-amber-800">Para usar as auditorias, rode a migração 079 no Supabase.</div>
      ) : error ? (
        <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
      ) : isLoading ? <p className="text-sm text-ink-500">Carregando…</p> : !data?.length ? (
        <div className="card p-8 text-center text-sm text-ink-500">Nenhuma auditoria ainda. Toque em <b>Nova auditoria</b>.</div>
      ) : (
        <div className="card divide-y divide-ink-100 overflow-hidden">
          {data.map(a => {
            const c = classificar(a.nota, a.faixas)
            const cor = corDaFaixa(c?.rotulo, a.faixas)
            return (
              <button key={a.id} onClick={() => navigate(`/auditorias/${a.id}`)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-ink-50/70">
                <div className="w-14 shrink-0 text-center">
                  {a.nota != null
                    ? <p className="text-lg font-semibold tnum" style={{ color: `rgb(${cor.join(',')})` }}>{Math.round(a.nota)}%</p>
                    : <p className="text-lg font-semibold text-ink-300">–</p>}
                  <p className="text-[10px] text-ink-400">{c?.rotulo || 'sem nota'}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{[a.client?.name, a.unidade].filter(Boolean).join(' · ') || a.titulo}</p>
                  <p className="text-xs text-ink-500 truncate">{[a.titulo, a.concessionaria, a.auditor_nome].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-700">{formatDate(a.data)}</p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${a.status === 'finalizada' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{a.status === 'finalizada' ? 'Finalizada' : 'Em andamento'}</span>
                </div>
                <ChevronRight size={16} className="text-ink-300 shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {nova && <NovaAuditoria fechar={() => setNova(false)} />}
    </div>
  )
}

function NovaAuditoria({ fechar }: { fechar: () => void }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: modelos = [] } = useQuery({
    queryKey: ['auditoria-modelos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('auditoria_modelos').select('*').eq('ativo', true).order('nome')
      if (error) throw error
      return (data || []) as Modelo[]
    },
  })
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-lista-simples'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name')
      if (error) throw error
      return (data || []) as { id: string; name: string }[]
    },
    staleTime: 5 * 60_000,
  })
  const [modelo, setModelo] = useState('')
  const [cliente, setCliente] = useState('')
  const [unidade, setUnidade] = useState('')
  const [concessionaria, setConcessionaria] = useState('')
  const [data, setData] = useState(hojeISO())
  const [auditor, setAuditor] = useState(profile?.full_name || '')
  const modeloEscolhido = modelo || modelos[0]?.id || ''

  const criar = useMutation({
    mutationFn: async () => {
      const m = modelos.find(x => x.id === modeloEscolhido)
      if (!m) throw new Error('Escolha o checklist')
      const { data: perguntas, error: ep } = await supabase.from('auditoria_perguntas').select('id, grupo, secao, texto, peso, ordem').eq('modelo_id', m.id).eq('ativo', true).order('ordem')
      if (ep) throw ep
      if (!perguntas?.length) throw new Error('Esse checklist não tem perguntas.')
      const agora = new Date()
      const { data: aud, error } = await supabase.from('auditorias').insert({
        modelo_id: m.id, titulo: m.nome, faixas: m.faixas, client_id: cliente || null,
        unidade: unidade.trim() || null, concessionaria: concessionaria.trim() || null,
        auditor_id: profile?.id || null, auditor_nome: auditor.trim() || null, data,
        inicio: data === hojeISO() ? `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}` : null,
      }).select('id').single()
      if (error) throw error
      // Cópia das perguntas: editar o checklist depois não muda esta auditoria
      const { error: er } = await supabase.from('auditoria_respostas').insert(perguntas.map(p => ({
        auditoria_id: aud.id, pergunta_id: p.id, grupo: p.grupo, secao: p.secao, texto: p.texto, peso: p.peso, ordem: p.ordem,
      })))
      if (er) { await supabase.from('auditorias').delete().eq('id', aud.id); throw er }
      return aud.id as string
    },
    onSuccess: id => navigate(`/auditorias/${id}`),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="modal-overlay" onClick={fechar}>
      <div className="modal-box max-w-md space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-ink-900">Nova auditoria</h3>
        <div>
          <label className="label">Checklist *</label>
          <select className="input" value={modeloEscolhido} onChange={e => setModelo(e.target.value)}>
            {modelos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Cliente</label>
          <select className="input" value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">— escolha —</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Unidade / CD</label><input className="input" value={unidade} onChange={e => setUnidade(e.target.value)} placeholder="Ex.: MG01" /></div>
          <div><label className="label">Concessionária</label><input className="input" value={concessionaria} onChange={e => setConcessionaria(e.target.value)} placeholder="Ex.: Sodexo" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data *</label><input className="input" type="date" value={data} onChange={e => setData(e.target.value)} /></div>
          <div><label className="label">Auditor(a)</label><input className="input" value={auditor} onChange={e => setAuditor(e.target.value)} /></div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2">
          <button className="btn-secondary flex-1" onClick={fechar}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={criar.isPending || !modeloEscolhido} onClick={() => criar.mutate()}>{criar.isPending ? 'Criando…' : 'Começar'}</button>
        </div>
      </div>
    </div>
  )
}
