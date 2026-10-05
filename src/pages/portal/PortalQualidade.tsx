import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, ClipboardCheck, Camera, MessageSquare, X, Plus, CheckCircle2, Trash2, FileText, Tag, BookOpen } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { comprimirImagem, extensaoDoArquivo, comNovaTentativa } from '../../lib/imagem'
import { resumoAuditoria, corDaFaixa, classificar } from '../../lib/auditoria'
import type { Faixa, Resposta } from '../../lib/auditoria'
import { CampoHora, horaAgora } from './CampoHora'

/**
 * Aba "Qualidade" do portal (migração 082). Por enquanto: checklists
 * (auditorias). Depois entram relatórios, rotulagem e ficha técnica.
 * Tudo passa pelas funções portal_auditoria_* (conferem o token e o vínculo);
 * a nota final é calculada no banco. O PDF é gerado pelo escritório, na aba
 * Auditorias do sistema (o portal só envia foto, não lê).
 */

type Rpc = <T>(fn: string, args: Record<string, unknown>) => Promise<T>
type Cliente = { id: string; name: string }
type Modelo = { id: string; nome: string; perguntas: number }
type Linha = {
  id: string; titulo: string; data: string; status: 'rascunho' | 'finalizada'; nota: number | null; faixas: Faixa[]
  unidade: string | null; cliente: string | null; total: number; respondidas: number
}
type Aud = {
  id: string; titulo: string; data: string; status: 'rascunho' | 'finalizada'; nota: number | null; faixas: Faixa[]
  cliente: string | null; unidade: string | null; concessionaria: string | null; auditor_nome: string | null
  inicio: string | null; fim: string | null; observacoes: string | null
}
type Item = {
  id: string; grupo: string; secao: string | null; texto: string; peso: number; ordem: number
  resposta: Resposta | null; observacao: string | null; fotos: string[]; foto_obrigatoria: boolean
}
const faltaFoto = (i: Item) => i.foto_obrigatoria && (i.resposta === 'C' || i.resposta === 'NC') && i.fotos.length === 0
const corCss = (c: [number, number, number]) => `rgb(${c.join(',')})`

export default function PortalQualidade({ token, rpc, clientes }: { token: string; rpc: Rpc; clientes: Cliente[] }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal-qualidade'],
    queryFn: () => rpc<{ modelos: Modelo[]; auditorias: Linha[] }>('portal_qualidade', { p_token: token }),
    retry: false,
  })
  useEffect(() => { window.scrollTo({ top: 0 }) }, [aberto])

  if (aberto) return <Preencher id={aberto} token={token} rpc={rpc} voltar={() => setAberto(null)} />

  const semMigracao = error && /portal_qualidade|function|schema cache/i.test((error as Error).message)
  const emAndamento = data?.auditorias.filter(a => a.status === 'rascunho') || []
  const feitas = data?.auditorias.filter(a => a.status === 'finalizada') || []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-2xl text-ink-900">Qualidade</h2>
        <p className="text-sm text-ink-500">Checklists com fotos, direto do celular.</p>
      </div>

      {/* O que tem nesta aba (o resto entra depois) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="card p-3 border-primary-200 bg-primary-50/40">
          <ClipboardCheck size={20} className="text-primary-700" />
          <p className="text-sm font-semibold text-ink-900 mt-1.5">Checklists</p>
          <p className="text-[11px] text-ink-500">Auditorias com nota</p>
        </div>
        {[[FileText, 'Relatórios'], [Tag, 'Rotulagem'], [BookOpen, 'Ficha técnica']].map(([Icone, nome]) => {
          const I = Icone as typeof FileText
          return (
            <div key={nome as string} className="card p-3 opacity-60">
              <I size={20} className="text-ink-400" />
              <p className="text-sm font-semibold text-ink-700 mt-1.5">{nome as string}</p>
              <p className="text-[11px] text-ink-400">Em breve</p>
            </div>
          )
        })}
      </div>

      {semMigracao ? (
        <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Os checklists ainda não foram liberados. Fale com o escritório.</div>
      ) : (
        <>
          <button className="btn-primary w-full h-12 text-base" disabled={isLoading || !data} onClick={() => setNovo(true)}><Plus size={18} />Novo checklist</button>

          {isLoading ? <p className="text-sm text-ink-500 text-center py-4">Carregando…</p> : (
            <>
              {emAndamento.length > 0 && <Lista titulo="Em andamento" linhas={emAndamento} abrir={setAberto} />}
              {feitas.length > 0 && <Lista titulo="Finalizados" linhas={feitas} abrir={setAberto} />}
              {!data?.auditorias.length && <div className="card p-6 text-center text-sm text-ink-500">Você ainda não fez nenhum checklist.</div>}
            </>
          )}
        </>
      )}

      {novo && data && <NovoChecklist token={token} rpc={rpc} modelos={data.modelos} clientes={clientes}
        fechar={() => setNovo(false)} criado={id => { setNovo(false); setAberto(id) }} />}
    </div>
  )
}

function Lista({ titulo, linhas, abrir }: { titulo: string; linhas: Linha[]; abrir: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide">{titulo}</p>
      <div className="card divide-y divide-ink-100 overflow-hidden">
        {linhas.map(a => {
          const c = classificar(a.nota, a.faixas)
          return (
            <button key={a.id} onClick={() => abrir(a.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-ink-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-900 line-clamp-2">{[a.cliente, a.unidade].filter(Boolean).join(' · ')}</p>
                <p className="text-xs text-ink-500">{a.titulo} · {formatDate(a.data)}</p>
                {a.status === 'rascunho' && (
                  <div className="mt-1.5 h-1.5 bg-ink-100 rounded-full overflow-hidden"><div className="h-full bg-primary-600 rounded-full" style={{ width: `${a.total ? (100 * a.respondidas) / a.total : 0}%` }} /></div>
                )}
              </div>
              {a.status === 'finalizada'
                ? <div className="text-right shrink-0"><p className="text-lg font-semibold tnum" style={{ color: corCss(corDaFaixa(c?.rotulo, a.faixas)) }}>{a.nota != null ? `${Math.round(a.nota)}%` : '–'}</p><p className="text-[10px] text-ink-500">{c?.rotulo}</p></div>
                : <span className="text-xs text-ink-500 tnum shrink-0">{a.respondidas}/{a.total}</span>}
              <ChevronRight size={16} className="text-ink-300 shrink-0" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Começar um checklist ────────────────────────────────────────────────────
function NovoChecklist({ token, rpc, modelos, clientes, fechar, criado }: {
  token: string; rpc: Rpc; modelos: Modelo[]; clientes: Cliente[]; fechar: () => void; criado: (id: string) => void
}) {
  const [modelo, setModelo] = useState(modelos[0]?.id || '')
  const [cliente, setCliente] = useState(clientes.length === 1 ? clientes[0].id : '')
  const [unidade, setUnidade] = useState('')
  const [concessionaria, setConcessionaria] = useState('')
  const [data, setData] = useState(hojeISO())
  const [inicio, setInicio] = useState(horaAgora())
  const [fim, setFim] = useState('')
  const [salvando, setSalvando] = useState(false)
  const falta = !modelo ? 'Escolha o checklist.' : !cliente ? 'Escolha o cliente.' : !data ? 'Informe a data.' : !inicio ? 'Informe o horário de início.' : fim && fim <= inicio ? 'O horário final tem que ser depois do início.' : ''
  const criar = async () => {
    if (falta) { toast.error(falta); return }
    setSalvando(true)
    try {
      const id = await rpc<string>('portal_auditoria_criar', { p_token: token, p_payload: { modelo_id: modelo, client_id: cliente, unidade, concessionaria, data, inicio, fim } })
      criado(id)
    } catch { /* o rpc já avisou */ } finally { setSalvando(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-end justify-center" onClick={fechar}>
      <div className="bg-white w-full max-w-lg rounded-t-2xl p-5 space-y-3 max-h-[92vh] overflow-y-auto" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink-900">Novo checklist</h3>
          <button onClick={fechar} className="p-2 -mr-2 text-ink-400" aria-label="Fechar"><X size={20} /></button>
        </div>
        <div><label className="label">Checklist</label>
          <select className="input" value={modelo} onChange={e => setModelo(e.target.value)}>
            {modelos.map(m => <option key={m.id} value={m.id}>{m.nome} ({m.perguntas} perguntas)</option>)}
          </select></div>
        <div><label className="label">Cliente</label>
          <select className="input" value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">Escolha…</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {!clientes.length && <p className="text-xs text-amber-700 mt-1">Você não tem cliente vinculado. Fale com o escritório.</p>}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Unidade / CD</label><input className="input" value={unidade} onChange={e => setUnidade(e.target.value)} placeholder="Ex.: MG01" /></div>
          <div><label className="label">Concessionária</label><input className="input" value={concessionaria} onChange={e => setConcessionaria(e.target.value)} placeholder="Ex.: Sodexo" /></div>
        </div>
        <div><label className="label">Data</label><input className="input" type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)} /></div>
        <div className="flex gap-3">
          <CampoHora rotulo="Das" valor={inicio} onChange={setInicio} />
          <CampoHora rotulo="Às (opcional)" valor={fim} onChange={setFim} />
        </div>
        <p className="text-xs text-ink-500">Seu nome e e-mail entram sozinhos no relatório. Se deixar "Às" em branco, entra a hora em que você finalizar.</p>
        <button className="btn-primary w-full h-12 text-base" disabled={salvando || !!falta} onClick={criar}>{salvando ? 'Criando…' : 'Começar'}</button>
        {falta && <p className="text-xs text-amber-700 text-center">{falta}</p>}
      </div>
    </div>
  )
}

// ── Responder o checklist ───────────────────────────────────────────────────
function Preencher({ id, token, rpc, voltar }: { id: string; token: string; rpc: Rpc; voltar: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['portal-auditoria', id],
    queryFn: () => rpc<{ auditoria: Aud; itens: Item[] }>('portal_auditoria_abrir', { p_token: token, p_id: id }),
  })
  const [aud, setAud] = useState<Aud | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  useEffect(() => {
    if (data) { setAud(data.auditoria); setItens(data.itens.map(i => ({ ...i, peso: Number(i.peso), fotos: i.fotos || [] }))) }
  }, [data])
  const [filtro, setFiltro] = useState<'todas' | 'pendentes' | 'nc'>('todas')
  const [finalizando, setFinalizando] = useState(false)
  // Prévia das fotos tiradas agora (o portal envia, mas não consegue ler depois)
  const previas = useRef(new Map<string, string>())

  const resumo = useMemo(() => resumoAuditoria(itens, aud?.faixas), [itens, aud?.faixas])
  const semFoto = itens.filter(faltaFoto).length
  const fechada = aud?.status === 'finalizada'

  const salvarItem = async (itemId: string, mudar: Partial<Item>) => {
    setItens(l => l.map(i => i.id === itemId ? { ...i, ...mudar } : i))
    try { await rpc('portal_auditoria_responder', { p_token: token, p_item: itemId, p_payload: mudar }) } catch { qc.invalidateQueries({ queryKey: ['portal-auditoria', id] }) }
  }
  const salvarAud = async (mudar: Partial<Aud>) => {
    setAud(a => a ? { ...a, ...mudar } : a)
    try { await rpc('portal_auditoria_salvar', { p_token: token, p_id: id, p_payload: mudar }) } catch { /* rpc avisou */ }
  }
  const sair = () => { qc.invalidateQueries({ queryKey: ['portal-qualidade'] }); voltar() }

  const finalizar = async () => {
    if (resumo.pendentes > 0) { toast.error(`Faltam ${resumo.pendentes} pergunta(s) sem resposta.`); setFiltro('pendentes'); window.scrollTo({ top: 0 }); return }
    if (semFoto > 0) { toast.error(`Falta foto em ${semFoto} pergunta(s).`); setFiltro('pendentes'); window.scrollTo({ top: 0 }); return }
    if (!(await confirmar({ titulo: 'Finalizar o checklist?', texto: `Nota ${resumo.nota}% · ${resumo.classificacao?.rotulo}. Depois de finalizar não dá para mudar.`, confirmar: 'Finalizar' }))) return
    setFinalizando(true)
    try {
      const nota = await rpc<number | null>('portal_auditoria_finalizar', { p_token: token, p_id: id })
      toast.success('Checklist finalizado!')
      setAud(a => a ? { ...a, status: 'finalizada', nota } : a)
      qc.invalidateQueries({ queryKey: ['portal-qualidade'] }); qc.invalidateQueries({ queryKey: ['portal-auditoria', id] })
      window.scrollTo({ top: 0 })
    } catch { /* rpc avisou */ } finally { setFinalizando(false) }
  }
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este checklist?', texto: 'Apaga as respostas. Não tem como desfazer.', confirmar: 'Excluir', perigo: true }))) return
    try { await rpc('portal_auditoria_excluir', { p_token: token, p_id: id }); toast.success('Checklist excluído'); sair() } catch { /* rpc avisou */ }
  }

  if (isLoading || !aud) return <p className="text-sm text-ink-500 text-center py-8">Carregando…</p>

  const visiveis = itens.filter(i => filtro === 'todas' || (filtro === 'pendentes' ? !i.resposta || faltaFoto(i) : i.resposta === 'NC'))
  const blocos: { secao: string; lista: Item[] }[] = []
  for (const it of visiveis) {
    const nome = it.secao || it.grupo
    if (blocos.at(-1)?.secao !== nome) blocos.push({ secao: nome, lista: [] })
    blocos.at(-1)!.lista.push(it)
  }
  const respondidas = resumo.total - resumo.pendentes
  const notaFinal = fechada ? (aud.nota != null ? Math.round(aud.nota) : null) : resumo.nota
  const classe = classificar(notaFinal, aud.faixas)
  const cor = corCss(corDaFaixa(classe?.rotulo, aud.faixas))

  return (
    <div className="space-y-4">
      <button onClick={sair} className="flex items-center gap-1 text-sm text-ink-600 -ml-1"><ChevronLeft size={18} />Checklists</button>

      <div className="card p-4 space-y-3">
        <div>
          <p className="text-lg font-semibold text-ink-900 leading-tight">{[aud.cliente, aud.unidade].filter(Boolean).join(' · ')}</p>
          <p className="text-xs text-ink-500">{aud.titulo} · {formatDate(aud.data)}{aud.concessionaria ? ` · ${aud.concessionaria}` : ''}</p>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[11px] text-ink-500">{fechada ? 'Nota final' : 'Nota até agora'}</p>
            <p className="text-3xl font-semibold tnum" style={{ color: notaFinal == null ? undefined : cor }}>{notaFinal == null ? '–' : `${notaFinal}%`}</p>
          </div>
          <p className="text-sm font-semibold" style={{ color: cor }}>{classe?.rotulo || ''}</p>
        </div>
        {!fechada && (
          <div>
            <div className="flex justify-between text-[11px] text-ink-500 mb-1"><span>{respondidas} de {resumo.total} respondidas</span><span>{resumo.conformes} C · {resumo.naoConformes} NC · {resumo.na} N/A</span></div>
            <div className="h-2 bg-ink-100 rounded-full overflow-hidden"><div className="h-2 bg-primary-600 rounded-full" style={{ width: `${resumo.total ? (100 * respondidas) / resumo.total : 0}%` }} /></div>
          </div>
        )}
        {fechada ? (
          <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">Finalizado. O escritório confere e gera o relatório em PDF para o cliente.</p>
        ) : (
          <>
            <div className="flex gap-3">
              <CampoHora rotulo="Das" valor={(aud.inicio || '').slice(0, 5)} onChange={v => salvarAud({ inicio: v || null })} />
              <CampoHora rotulo="Às" valor={(aud.fim || '').slice(0, 5)} onChange={v => salvarAud({ fim: v || null })} />
            </div>
            <textarea className="input text-sm" rows={2} placeholder="Observações gerais (saem no relatório)" defaultValue={aud.observacoes || ''}
              onBlur={e => e.target.value.trim() !== (aud.observacoes || '') && salvarAud({ observacoes: e.target.value.trim() || null })} />
          </>
        )}
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70">
        {([['todas', `Todas (${resumo.total})`], ['pendentes', `Pendentes (${resumo.pendentes + semFoto})`], ['nc', `NC (${resumo.naoConformes})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`flex-1 h-9 rounded-lg text-xs font-medium ${filtro === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
        ))}
      </div>

      {blocos.length === 0 ? <div className="card p-6 text-center text-sm text-ink-500">{filtro === 'pendentes' ? 'Nada pendente.' : 'Nada aqui.'}</div> : blocos.map(({ secao, lista }, k) => (
        <div key={secao + k} className="card overflow-hidden">
          <div className="px-4 py-2.5 bg-primary-900 text-white text-sm font-semibold">{secao}</div>
          <div className="divide-y divide-ink-100">
            {lista.map(it => <PerguntaPortal key={it.id} it={it} audId={id} bloqueada={fechada} previas={previas.current} salvar={m => salvarItem(it.id, m)} />)}
          </div>
        </div>
      ))}

      {!fechada && (
        <div className="space-y-2 pt-2">
          <button className="btn-primary w-full h-12 text-base" disabled={finalizando} onClick={finalizar}><CheckCircle2 size={18} />{finalizando ? 'Finalizando…' : 'Finalizar checklist'}</button>
          <button className="w-full h-11 text-sm text-red-600 flex items-center justify-center gap-1.5" onClick={excluir}><Trash2 size={15} />Excluir checklist</button>
        </div>
      )}
    </div>
  )
}

function PerguntaPortal({ it, audId, bloqueada, previas, salvar }: {
  it: Item; audId: string; bloqueada: boolean; previas: Map<string, string>; salvar: (m: Partial<Item>) => Promise<void>
}) {
  const [obsAberta, setObsAberta] = useState(!!it.observacao)
  const [enviando, setEnviando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const nc = it.resposta === 'NC'
  const falta = faltaFoto(it)

  const addFotos = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return
    setEnviando(true)
    const novas: string[] = []
    for (const original of Array.from(arquivos)) {
      try {
        const f = await comprimirImagem(original)
        const caminho = `auditorias/${audId}/${it.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${extensaoDoArquivo(f)}`
        const { error } = await comNovaTentativa(() => supabase.storage.from('arquivos').upload(caminho, f, { upsert: false, contentType: f.type || undefined }))
        if (error) throw error
        previas.set(caminho, URL.createObjectURL(f))
        novas.push(caminho)
      } catch (e) { toast.error('Uma foto não subiu: ' + (e as Error).message + '. Tente de novo.') }
    }
    if (novas.length) { await salvar({ fotos: [...it.fotos, ...novas] }); toast.success(novas.length === 1 ? 'Foto enviada' : `${novas.length} fotos enviadas`) }
    setEnviando(false)
    if (arquivoRef.current) arquivoRef.current.value = ''
  }
  const tirarFoto = async (caminho: string) => {
    if (!(await confirmar({ titulo: 'Tirar esta foto?', confirmar: 'Tirar' }))) return
    await salvar({ fotos: it.fotos.filter(f => f !== caminho) })
  }

  return (
    <div className={`px-4 py-3 space-y-2.5 ${nc ? 'bg-red-50/60' : ''}`}>
      <p className="text-[15px] text-ink-900 leading-snug">{it.texto} <span className="text-[11px] font-medium text-ink-400 whitespace-nowrap">(peso {String(it.peso).replace('.', ',')})</span></p>
      {it.foto_obrigatoria && (
        <p className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${falta ? 'bg-red-100 text-red-700' : it.fotos.length ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
          <Camera size={12} />{it.fotos.length ? 'Foto obrigatória · ok' : falta ? 'Foto obrigatória: anexe a foto' : 'Foto obrigatória'}
        </p>
      )}
      <div className="flex items-center gap-2">
        {(['C', 'NC', 'NA'] as const).map(r => {
          const ativo = it.resposta === r
          const cores = r === 'C' ? 'border-green-600 bg-green-600' : r === 'NC' ? 'border-red-600 bg-red-600' : 'border-ink-500 bg-ink-500'
          return (
            <button key={r} type="button" disabled={bloqueada}
              onClick={() => { salvar({ resposta: ativo ? null : r }); if (r === 'NC' && !ativo) setObsAberta(true) }}
              className={`h-11 flex-1 rounded-xl border-2 text-sm font-semibold disabled:opacity-70 ${ativo ? `${cores} text-white` : 'border-ink-200 bg-white text-ink-600'}`}>
              {r === 'NA' ? 'N/A' : r}
            </button>
          )
        })}
        {!bloqueada && (
          <>
            <button type="button" aria-label="Observação" className={`h-11 w-11 shrink-0 rounded-xl border flex items-center justify-center ${obsAberta ? 'border-primary-300 text-primary-800 bg-primary-50' : 'border-ink-200 text-ink-500'}`} onClick={() => setObsAberta(v => !v)}>
              <MessageSquare size={17} />
            </button>
            <button type="button" aria-label="Foto" disabled={enviando} className={`h-11 min-w-[2.75rem] px-2 shrink-0 rounded-xl border flex items-center justify-center gap-1 text-sm font-semibold ${falta ? 'border-red-400 text-red-700 bg-red-50' : 'border-ink-200 text-ink-500'}`} onClick={() => arquivoRef.current?.click()}>
              {enviando ? <span className="w-4 h-4 border-2 border-ink-300 border-t-ink-600 rounded-full animate-spin" /> : <><Camera size={17} />{it.fotos.length > 0 && it.fotos.length}</>}
            </button>
            <input ref={arquivoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFotos(e.target.files)} />
          </>
        )}
      </div>
      {(obsAberta || it.observacao) && (
        <textarea className="input text-sm" rows={2} disabled={bloqueada} placeholder="Observação (sai no relatório)" defaultValue={it.observacao || ''}
          onBlur={e => e.target.value.trim() !== (it.observacao || '') && salvar({ observacao: e.target.value.trim() || null })} />
      )}
      {it.fotos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {it.fotos.map((f, k) => (
            <div key={f} className="relative w-16 h-16 rounded-lg overflow-hidden bg-ink-100 border border-ink-200 flex items-center justify-center">
              {previas.get(f) ? <img src={previas.get(f)} alt="" className="w-full h-full object-cover" /> : <span className="flex flex-col items-center text-[10px] text-ink-500"><Camera size={16} />Foto {k + 1}</span>}
              {!bloqueada && <button type="button" onClick={() => tirarFoto(f)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Tirar foto"><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
