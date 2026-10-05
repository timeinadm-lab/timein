import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ChevronLeft, FileDown, Camera, X, CheckCircle2, MessageSquare, Trash2, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { getSignedUrl } from '../../lib/storage'
import { confirmar } from '../../components/ui/ConfirmDialog'
import { comprimirImagem, miniaturaJpeg, extensaoDoArquivo } from '../../lib/imagem'
import { resumoAuditoria, corDaFaixa } from '../../lib/auditoria'
import type { Faixa, Resposta } from '../../lib/auditoria'

type Auditoria = {
  id: string; titulo: string; faixas: Faixa[]; client_id: string | null; unidade: string | null; concessionaria: string | null
  auditor_nome: string | null; auditor_email?: string | null; data: string; inicio: string | null; fim: string | null; observacoes: string | null
  status: 'rascunho' | 'finalizada'; nota: number | null; client?: { name?: string } | null
  origem?: string | null
}
type Item = {
  id: string; grupo: string; secao: string | null; texto: string; peso: number; ordem: number
  resposta: Resposta | null; observacao: string | null; fotos: string[]
  foto_obrigatoria?: boolean   // migração 081
}
// Respondeu C ou NC numa pergunta que exige foto e ainda não pôs nenhuma
const faltaFoto = (i: Item) => !!i.foto_obrigatoria && (i.resposta === 'C' || i.resposta === 'NC') && i.fotos.length === 0
type Filtro = 'todas' | 'pendentes' | 'nc'

export default function AuditoriaDetalhe() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['auditoria', id],
    queryFn: async () => {
      const [a, r] = await Promise.all([
        supabase.from('auditorias').select('*, client:clients(name)').eq('id', id).single(),
        supabase.from('auditoria_respostas').select('*').eq('auditoria_id', id).order('ordem'),
      ])
      if (a.error) throw new Error(a.error.message)
      if (r.error) throw new Error(r.error.message)
      return { aud: a.data as Auditoria, itens: (r.data || []).map(x => ({ ...x, peso: Number(x.peso), fotos: x.fotos || [] })) as Item[] }
    },
  })
  // Estado local: a tela responde na hora e grava em seguida
  const [aud, setAud] = useState<Auditoria | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  useEffect(() => { if (data) { setAud(data.aud); setItens(data.itens) } }, [data])
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [gerando, setGerando] = useState(false)

  const resumo = useMemo(() => resumoAuditoria(itens, aud?.faixas), [itens, aud?.faixas])
  const finalizada = aud?.status === 'finalizada'
  const semFoto = itens.filter(faltaFoto).length

  const salvarItem = async (itemId: string, mudar: Partial<Item>) => {
    setItens(lista => lista.map(i => i.id === itemId ? { ...i, ...mudar } : i))
    const { error } = await supabase.from('auditoria_respostas').update({ ...mudar, atualizado_em: new Date().toISOString() }).eq('id', itemId)
    if (error) toast.error('Não salvou: ' + error.message, { id: 'erro-aud' })
  }
  const salvarAud = async (mudar: Partial<Auditoria>, avisar = true) => {
    setAud(a => a ? { ...a, ...mudar } : a)
    // client (nome) é só para a tela; no banco vai client_id
    const { client: _c, ...banco } = mudar
    const { error } = await supabase.from('auditorias').update(banco).eq('id', id)
    if (error) toast.error('Não salvou: ' + error.message, { id: 'erro-aud' })
    else if (avisar) toast.success('Salvo', { id: 'salvo-aud', duration: 1200 })
  }
  // Clientes para trocar o cliente da auditoria
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-lista-simples'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name').order('name')
      if (error) throw error
      return (data || []) as { id: string; name: string }[]
    },
    staleTime: 5 * 60_000,
  })

  const finalizar = async () => {
    if (resumo.pendentes > 0) { toast.error(`Faltam ${resumo.pendentes} pergunta(s) sem resposta.`); setFiltro('pendentes'); return }
    if (semFoto > 0) { toast.error(`Falta foto em ${semFoto} pergunta(s) com foto obrigatória.`); setFiltro('pendentes'); return }
    if (!(await confirmar({ titulo: 'Finalizar a auditoria?', texto: `Nota ${resumo.nota}% · ${resumo.classificacao?.rotulo}. Dá para reabrir depois, se precisar corrigir.`, confirmar: 'Finalizar' }))) return
    const agora = new Date()
    await salvarAud({
      status: 'finalizada', nota: resumo.notaExata == null ? null : Math.round(resumo.notaExata * 10) / 10,
      fim: aud?.fim || `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`,
      ...({ finalizada_em: agora.toISOString() } as object),
    }, false)
    qc.invalidateQueries({ queryKey: ['auditorias'] })
    toast.success('Auditoria finalizada')
  }
  const reabrir = async () => {
    if (!(await confirmar({ titulo: 'Reabrir a auditoria?', texto: 'Ela volta para "em andamento" e dá para mudar as respostas.', confirmar: 'Reabrir' }))) return
    await salvarAud({ status: 'rascunho' }, false); qc.invalidateQueries({ queryKey: ['auditorias'] })
  }
  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir esta auditoria?', texto: 'Apaga as respostas e as fotos dela. Não tem como desfazer.', confirmar: 'Excluir', perigo: true }))) return
    const caminhos = itens.flatMap(i => i.fotos)
    if (caminhos.length) await supabase.storage.from('arquivos').remove(caminhos)
    const { error } = await supabase.from('auditorias').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    qc.invalidateQueries({ queryKey: ['auditorias'] }); navigate('/auditorias')
  }

  const baixarPdf = async () => {
    if (!aud) return
    setGerando(true)
    try {
      const { gerarPdfAuditoria } = await import('../../lib/auditoriaPdf')
      const logo = await (async () => {
        try {
          const resp = await fetch('/logo-fernanda-stinchi.png'); const b = await resp.blob()
          const dataUrl: string = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(b) })
          const bmp = await createImageBitmap(b)
          return { dataUrl, w: bmp.width, h: bmp.height }
        } catch { return null }
      })()
      const comFotos = []
      for (const it of itens) {
        const fotos = []
        for (const f of it.fotos) {
          const url = await getSignedUrl(f, 'arquivos')
          const img = url ? await miniaturaJpeg(url, 1000, 0.75) : null
          if (img) fotos.push(img)
        }
        comFotos.push({ ...it, fotos })
      }
      const blob = await gerarPdfAuditoria({
        titulo: aud.titulo, faixas: aud.faixas, cliente: aud.client?.name, unidade: aud.unidade, concessionaria: aud.concessionaria,
        auditor: aud.auditor_nome, email: aud.auditor_email, data: aud.data, inicio: aud.inicio, fim: aud.fim, observacoes: aud.observacoes,
        rascunho: !finalizada, logo, itens: comFotos,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      // Nome do arquivo = título do relatório + unidade + data (o título é editável na tela)
      const limpaNome = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')
      a.download = `${[aud.titulo, aud.unidade].filter(Boolean).map(t => limpaNome(t!)).join('_')}_${aud.data.split('-').reverse().join('-')}.pdf`
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      toast.error('Não consegui gerar o PDF: ' + (e as Error).message)
    } finally { setGerando(false) }
  }

  if (error) return <div className="card p-4 border-red-200 bg-red-50 text-sm text-red-700">Não carregou: {(error as Error).message}</div>
  if (isLoading || !aud) return <p className="text-sm text-ink-500">Carregando…</p>

  const visiveis = itens.filter(i => filtro === 'todas' || (filtro === 'pendentes' ? !i.resposta || faltaFoto(i) : i.resposta === 'NC'))
  const cor = corDaFaixa(resumo.classificacao?.rotulo, aud.faixas)
  const respondidas = resumo.total - resumo.pendentes

  return (
    <div className="space-y-4 pb-24">
      {/* Cabeçalho */}
      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-2">
          <button onClick={() => navigate('/auditorias')} className="btn-ghost p-2 -ml-2" aria-label="Voltar"><ChevronLeft size={18} /></button>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-semibold text-ink-900 leading-tight">{[aud.client?.name, aud.unidade].filter(Boolean).join(' · ') || aud.titulo}</p>
            <p className="text-xs text-ink-500">{[aud.titulo, aud.concessionaria, aud.auditor_nome, formatDate(aud.data)].filter(Boolean).join(' · ')}</p>
            {aud.origem === 'portal' && <p className="text-[11px] text-primary-800 mt-0.5">Feita pelo portal da nutricionista</p>}
          </div>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${finalizada ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{finalizada ? 'Finalizada' : 'Em andamento'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-ink-100 px-3 py-2 col-span-2 sm:col-span-1">
            <p className="text-[11px] text-ink-500">Nota (com peso)</p>
            <p className="text-2xl font-semibold tnum" style={{ color: resumo.nota == null ? undefined : `rgb(${cor.join(',')})` }}>{resumo.nota == null ? '–' : `${resumo.nota}%`}</p>
            <p className="text-[11px] text-ink-500">{resumo.classificacao?.rotulo || 'responda as perguntas'}</p>
          </div>
          {resumo.grupos.map(g => (
            <div key={g.grupo} className="rounded-xl border border-ink-100 px-3 py-2">
              <p className="text-[11px] text-ink-500 truncate">{g.grupo}{g.peso != null ? ` · peso ${String(g.peso).replace('.', ',')}` : ''}</p>
              <p className="text-2xl font-semibold tnum text-red-600">{g.ncPct == null ? '–' : `${Math.round(g.ncPct)}%`}</p>
              <p className="text-[11px] text-ink-500">não conforme · {g.naoConformes} de {g.conformes + g.naoConformes}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-ink-500 mb-1"><span>{respondidas} de {resumo.total} respondidas</span><span>{resumo.conformes} C · {resumo.naoConformes} NC · {resumo.na} N/A</span></div>
          <div className="h-2 bg-ink-100 rounded-full overflow-hidden"><div className="h-2 bg-primary-600 rounded-full" style={{ width: `${resumo.total ? (100 * respondidas) / resumo.total : 0}%` }} /></div>
        </div>
        {/* Tudo do cabeçalho do relatório é editável (pedido de 05/10/2026). Salva ao sair do campo. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="col-span-2 sm:col-span-4"><label className="label text-xs">Título do relatório <span className="text-ink-400 font-normal">— também é o nome do PDF</span></label>
            <input className="input text-sm font-medium" disabled={finalizada} defaultValue={aud.titulo}
              onBlur={e => e.target.value.trim() && e.target.value.trim() !== aud.titulo && salvarAud({ titulo: e.target.value.trim() })} /></div>
          <div className="col-span-2"><label className="label text-xs">Cliente</label>
            <select className="input text-sm" disabled={finalizada} value={aud.client_id || ''}
              onChange={e => salvarAud({ client_id: e.target.value || null, client: { name: clientes.find(c => c.id === e.target.value)?.name } })}>
              <option value="">— sem cliente —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="label text-xs">Unidade / CD</label>
            <input className="input text-sm" disabled={finalizada} defaultValue={aud.unidade || ''}
              onBlur={e => e.target.value.trim() !== (aud.unidade || '') && salvarAud({ unidade: e.target.value.trim() || null })} /></div>
          <div><label className="label text-xs">Data</label>
            <input className="input text-sm" type="date" disabled={finalizada} value={aud.data} onChange={e => e.target.value && salvarAud({ data: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div><label className="label text-xs">Início</label><input className="input text-sm" type="time" disabled={finalizada} value={(aud.inicio || '').slice(0, 5)} onChange={e => salvarAud({ inicio: e.target.value || null })} /></div>
          <div><label className="label text-xs">Fim</label><input className="input text-sm" type="time" disabled={finalizada} value={(aud.fim || '').slice(0, 5)} onChange={e => salvarAud({ fim: e.target.value || null })} /></div>
          <div className="col-span-2"><label className="label text-xs">Consultor(a)</label><input className="input text-sm" disabled={finalizada} defaultValue={aud.auditor_nome || ''} onBlur={e => e.target.value.trim() !== (aud.auditor_nome || '') && salvarAud({ auditor_nome: e.target.value.trim() || null })} /></div>
          <div className="col-span-2"><label className="label text-xs">E-mail</label><input className="input text-sm" type="email" autoCapitalize="none" disabled={finalizada} defaultValue={aud.auditor_email || ''} onBlur={e => e.target.value.trim().toLowerCase() !== (aud.auditor_email || '') && salvarAud({ auditor_email: e.target.value.trim().toLowerCase() || null })} /></div>
          <div className="col-span-2"><label className="label text-xs">Concessionária</label><input className="input text-sm" disabled={finalizada} defaultValue={aud.concessionaria || ''} onBlur={e => e.target.value !== (aud.concessionaria || '') && salvarAud({ concessionaria: e.target.value.trim() || null })} /></div>
        </div>
        <div>
          <label className="label text-xs">Observações gerais <span className="text-ink-400 font-normal">— saem no relatório</span></label>
          <textarea className="input text-sm" rows={2} disabled={finalizada} defaultValue={aud.observacoes || ''} onBlur={e => e.target.value !== (aud.observacoes || '') && salvarAud({ observacoes: e.target.value.trim() || null })} />
        </div>
      </div>

      {/* Filtro */}
      <div className="flex gap-1 p-1 rounded-xl bg-ink-100/70 w-fit">
        {([['todas', `Todas (${resumo.total})`], ['pendentes', `Pendentes (${resumo.pendentes + semFoto})`], ['nc', `Não conformes (${resumo.naoConformes})`]] as const).map(([k, t]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`px-3 h-9 rounded-lg text-xs sm:text-sm font-medium ${filtro === k ? 'bg-white shadow-sm text-ink-900' : 'text-ink-500'}`}>{t}</button>
        ))}
      </div>

      {/* Perguntas na ordem do checklist, por seção */}
      {visiveis.length === 0 ? <div className="card p-6 text-center text-sm text-ink-500">Nada aqui.</div> : (
        <div className="space-y-3">
          {porSecao(visiveis).map(({ secao, lista }, k) => (
            <div key={secao + k} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-primary-900 text-white text-sm font-semibold">{secao}</div>
              <div className="divide-y divide-ink-100">
                {lista.map(it => <Pergunta key={it.id} it={it} audId={id} bloqueada={finalizada} salvar={m => salvarItem(it.id, m)} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ações fixas no rodapé */}
      <div className="fixed bottom-0 inset-x-0 lg:left-auto lg:right-0 lg:w-[calc(100%-16rem)] bg-white/95 backdrop-blur border-t border-ink-200 px-4 py-3 flex gap-2 justify-end z-30" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {!finalizada && <button className="btn-ghost text-sm text-red-600 mr-auto" onClick={excluir}><Trash2 size={15} />Excluir</button>}
        {finalizada && <button className="btn-secondary text-sm mr-auto" onClick={reabrir}><RotateCcw size={15} />Reabrir</button>}
        <button className="btn-secondary text-sm" disabled={gerando} onClick={baixarPdf}><FileDown size={15} />{gerando ? 'Gerando…' : finalizada ? 'Relatório PDF' : <><span className="sm:hidden">Prévia</span><span className="hidden sm:inline">Prévia do PDF</span></>}</button>
        {!finalizada && <button className="btn-primary text-sm" onClick={finalizar}><CheckCircle2 size={15} />Finalizar</button>}
      </div>
    </div>
  )
}

// Blocos de seção na ordem das perguntas (seção sem nome: o grupo)
function porSecao(lista: Item[]) {
  const blocos: { secao: string; lista: Item[] }[] = []
  for (const it of lista) {
    const nome = it.secao || it.grupo || 'Itens gerais'
    if (blocos.at(-1)?.secao !== nome) blocos.push({ secao: nome, lista: [] })
    blocos.at(-1)!.lista.push(it)
  }
  return blocos
}

// ── Uma pergunta: C / NC / N/A, observação e fotos ────────────────────────
function Pergunta({ it, audId, bloqueada, salvar }: { it: Item; audId: string; bloqueada: boolean; salvar: (m: Partial<Item>) => Promise<void> }) {
  const [obsAberta, setObsAberta] = useState(!!it.observacao)
  const [enviando, setEnviando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const nc = it.resposta === 'NC'

  const addFotos = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return
    setEnviando(true)
    const novos: string[] = []
    for (const original of Array.from(arquivos)) {
      try {
        const f = await comprimirImagem(original)
        const caminho = `auditorias/${audId}/${it.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${extensaoDoArquivo(f)}`
        const { error } = await supabase.storage.from('arquivos').upload(caminho, f, { upsert: false, contentType: f.type || undefined })
        if (error) throw error
        novos.push(caminho)
      } catch (e) { toast.error('Uma foto não subiu: ' + (e as Error).message) }
    }
    if (novos.length) await salvar({ fotos: [...it.fotos, ...novos] })
    setEnviando(false)
    if (arquivoRef.current) arquivoRef.current.value = ''
  }
  const tirarFoto = async (caminho: string) => {
    if (!(await confirmar({ titulo: 'Tirar esta foto?', confirmar: 'Tirar' }))) return
    await salvar({ fotos: it.fotos.filter(f => f !== caminho) })
    supabase.storage.from('arquivos').remove([caminho])
  }

  return (
    <div className={`px-4 py-3 space-y-2 ${nc ? 'bg-red-50/50' : ''}`}>
      <p className="text-sm text-ink-900 leading-snug">{it.texto} <span className="text-[11px] font-medium text-ink-400 whitespace-nowrap">(peso {String(it.peso).replace('.', ',')})</span></p>
      {it.foto_obrigatoria && (
        <p className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${faltaFoto(it) ? 'bg-red-100 text-red-700' : it.fotos.length ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
          <Camera size={12} />{it.fotos.length ? 'Foto obrigatória · ok' : faltaFoto(it) ? 'Foto obrigatória: anexe a foto' : 'Foto obrigatória'}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {(['C', 'NC', 'NA'] as const).map(r => {
          const ativo = it.resposta === r
          const cores = r === 'C' ? 'border-green-600 bg-green-600' : r === 'NC' ? 'border-red-600 bg-red-600' : 'border-ink-500 bg-ink-500'
          return (
            <button key={r} type="button" disabled={bloqueada}
              onClick={() => { salvar({ resposta: ativo ? null : r }); if (r === 'NC' && !ativo) setObsAberta(true) }}
              className={`h-10 min-w-[3.25rem] px-3 rounded-lg border-2 text-sm font-semibold transition-colors disabled:opacity-60 ${ativo ? `${cores} text-white` : 'border-ink-200 bg-white text-ink-600'}`}>
              {r === 'NA' ? 'N/A' : r === 'NC' ? 'NC' : 'C'}
            </button>
          )
        })}
        {!bloqueada && (
          <>
            <button type="button" className={`h-10 px-3 rounded-lg border text-xs inline-flex items-center gap-1 ${obsAberta ? 'border-primary-300 text-primary-800' : 'border-ink-200 text-ink-500'}`} onClick={() => setObsAberta(v => !v)}>
              <MessageSquare size={15} /><span className="hidden sm:inline">Obs.</span>
            </button>
            <button type="button" disabled={enviando} className={`h-10 px-3 rounded-lg border text-xs inline-flex items-center gap-1 ${faltaFoto(it) ? 'border-red-400 text-red-700 bg-red-50' : 'border-ink-200 text-ink-500'}`} onClick={() => arquivoRef.current?.click()}>
              <Camera size={15} />{enviando ? 'Enviando…' : it.fotos.length ? <span className="font-semibold">{it.fotos.length}</span> : <span className="hidden sm:inline">Foto</span>}
            </button>
            <input ref={arquivoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFotos(e.target.files)} />
          </>
        )}
      </div>
      {(obsAberta || it.observacao) && (
        <textarea className="input text-sm" rows={2} disabled={bloqueada} placeholder="Observação do auditor (sai no relatório)" defaultValue={it.observacao || ''}
          onBlur={e => e.target.value.trim() !== (it.observacao || '') && salvar({ observacao: e.target.value.trim() || null })} />
      )}
      {it.fotos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {it.fotos.map(f => <Miniatura key={f} caminho={f} onTirar={bloqueada ? undefined : () => tirarFoto(f)} />)}
        </div>
      )}
    </div>
  )
}

function Miniatura({ caminho, onTirar }: { caminho: string; onTirar?: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { let vivo = true; getSignedUrl(caminho, 'arquivos').then(u => { if (vivo) setUrl(u) }); return () => { vivo = false } }, [caminho])
  return (
    <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-ink-100 border border-ink-200">
      {url && <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="w-full h-full object-cover" /></a>}
      {onTirar && (
        <button type="button" onClick={onTirar} className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Tirar foto"><X size={13} /></button>
      )}
    </div>
  )
}
