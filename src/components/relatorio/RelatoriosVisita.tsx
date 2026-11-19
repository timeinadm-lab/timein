import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, Camera, ChevronLeft, ChevronRight, Download, FileText, Heading, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { confirmar } from '../ui/ConfirmDialog'
import { comprimirImagem, extensaoDoArquivo, comNovaTentativa, miniaturaJpeg } from '../../lib/imagem'
import { ehTituloPadrao, faltaParaFinalizar, itensComConteudo, relatorioNovo, tituloPadrao } from '../../lib/relatorioVisita'
import type { ItemRelatorio, LinhaRelatorio, RelatorioVisita } from '../../lib/relatorioVisita'
import type { ImagemPdf } from '../../lib/relatorioVisitaPdf'

/**
 * Relatório de visita feito no sistema (migração 114, pedido do Gabriel em
 * 20/11/2026). A mesma tela serve o portal (aba Qualidade) e o escritório: só
 * muda de onde vêm e para onde vão os dados (`api`).
 * Fluxo: escolhe o cliente, a data e os horários, escreve o objetivo, põe as
 * anotações com fotos (não obrigatórias) e toca em "Finalizar e gerar PDF".
 * O PDF é montado no próprio aparelho, sobe para o sistema e fica ligado à
 * visita daquele dia.
 */
export type AutorRelatorio = { nome: string; email?: string | null; cargo?: string | null; cpf?: string | null }
export type ApiRelatorios = {
  carregar(): Promise<{ relatorios: LinhaRelatorio[]; autor: AutorRelatorio; logos: Record<string, string> }>
  abrir(id: string): Promise<RelatorioVisita>
  salvar(r: RelatorioVisita): Promise<void>
  apagar(id: string): Promise<void>
}
type Cliente = { id: string; name: string }

const urlPublica = (caminho: string) => supabase.storage.from('arquivos').getPublicUrl(caminho).data.publicUrl
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export default function RelatoriosVisita({ api, clientes, chave }: { api: ApiRelatorios; clientes: Cliente[]; chave: string }) {
  const qc = useQueryClient()
  const [aberto, setAberto] = useState<RelatorioVisita | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['relatorios-visita', chave], queryFn: () => api.carregar(), retry: false })
  useEffect(() => { window.scrollTo({ top: 0 }) }, [aberto?.id])

  const semMigracao = error && /relatorios_visita|portal_relatorio|function|schema cache/i.test((error as Error).message)
  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Os relatórios de visita ainda não foram liberados (falta rodar a migração 114).</div>
  if (error) return <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Não carregou: {(error as Error).message}</div>

  if (aberto && data) {
    return <Editor inicial={aberto} api={api} clientes={clientes} autor={data.autor} logos={data.logos}
      voltar={() => { setAberto(null); qc.invalidateQueries({ queryKey: ['relatorios-visita', chave] }) }} />
  }

  const abrir = async (id: string) => {
    setAbrindo(id)
    try { setAberto(await api.abrir(id)) } catch (e) { toast.error((e as Error).message) }
    setAbrindo(null)
  }
  const rascunhos = data?.relatorios.filter(r => r.status === 'rascunho') || []
  const prontos = data?.relatorios.filter(r => r.status === 'finalizado') || []

  return (
    <div className="space-y-4">
      <button className="btn-primary w-full sm:w-auto h-12 sm:h-auto text-base sm:text-sm" disabled={isLoading || !clientes.length}
        onClick={() => setAberto(relatorioNovo(novoId(), hojeISO(), clientes.length === 1 ? clientes[0].id : undefined))}>
        <Plus size={18} />Novo relatório de visita
      </button>
      {!clientes.length && !isLoading && <p className="text-sm text-ink-500">Você ainda não tem cliente vinculado. Fale com o escritório.</p>}

      {isLoading ? <p className="text-sm text-ink-500 py-4">Carregando…</p> : (
        <>
          {rascunhos.length > 0 && <Lista titulo="Em andamento" linhas={rascunhos} abrir={abrir} abrindo={abrindo} />}
          {prontos.length > 0 && <Lista titulo="Finalizados" linhas={prontos} abrir={abrir} abrindo={abrindo} />}
          {!data?.relatorios.length && (
            <div className="card p-6 text-center">
              <p className="text-sm font-medium text-ink-900">Nenhum relatório ainda</p>
              <p className="text-sm text-ink-500 mt-1">Toque em "Novo relatório de visita" para fazer o primeiro. O PDF sai pronto, com as fotos.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Lista({ titulo, linhas, abrir, abrindo }: { titulo: string; linhas: LinhaRelatorio[]; abrir: (id: string) => void; abrindo: string | null }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink-500">{titulo}</p>
      <div className="card divide-y divide-ink-100 overflow-hidden">
        {linhas.map(r => (
          <div key={r.id} className="flex items-center gap-2 pr-2">
            <button className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-ink-50/70" onClick={() => abrir(r.id)} disabled={abrindo === r.id}>
              <p className="text-sm font-medium text-ink-900 truncate">{r.cliente || 'Cliente removido'}</p>
              <p className="text-xs text-ink-500 truncate">
                {formatDate(r.data)}{r.autor ? `, por ${r.autor}` : ''} · {r.anotacoes === 1 ? '1 anotação' : `${r.anotacoes} anotações`}
              </p>
            </button>
            {r.pdf_url && r.status === 'finalizado' && (
              <a href={urlPublica(r.pdf_url)} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-2 px-3 shrink-0" title="Abrir o PDF">
                <Download size={14} />PDF
              </a>
            )}
            <ChevronRight size={16} className="text-ink-300 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Formulário ────────────────────────────────────────────────────────────
function Editor({ inicial, api, clientes, autor, logos, voltar }: {
  inicial: RelatorioVisita; api: ApiRelatorios; clientes: Cliente[]; autor: AutorRelatorio; logos: Record<string, string>; voltar: () => void
}) {
  const [r, setR] = useState<RelatorioVisita>(inicial)
  const [estado, setEstado] = useState<'salvo' | 'pendente' | 'salvando' | 'erro'>('salvo')
  const [gerando, setGerando] = useState<string | null>(null)
  const [assinar, setAssinar] = useState(!!(inicial.assinaturas.consultor || inicial.assinaturas.cliente))
  const fechado = r.status === 'finalizado'
  const ultimo = useRef(r); ultimo.current = r
  // Prévia das fotos tiradas agora (aparecem na hora, antes de o envio terminar de propagar)
  const previas = useRef(new Map<string, string>()).current

  const mudar = (m: Partial<RelatorioVisita>) => { setR(p => ({ ...p, ...m })); setEstado('pendente') }
  const mudarItem = (id: string, m: Partial<ItemRelatorio>) => mudar({ itens: ultimo.current.itens.map(i => i.id === id ? { ...i, ...m } : i) })

  // Salva sozinho um instante depois de parar de mexer (precisa do cliente escolhido)
  const salvarAgora = async (dados: RelatorioVisita) => {
    if (!dados.client_id) return false
    setEstado('salvando')
    try { await api.salvar(dados); setEstado(s => (s === 'salvando' ? 'salvo' : s)); return true }
    catch (e) { setEstado('erro'); toast.error('Não salvou: ' + (e as Error).message); return false }
  }
  useEffect(() => {
    if (estado !== 'pendente' || fechado || !r.client_id) return
    const t = setTimeout(() => { void salvarAgora(ultimo.current) }, 1500)
    return () => clearTimeout(t)
  }, [r, estado]) // eslint-disable-line react-hooks/exhaustive-deps

  const sair = async () => {
    if (estado === 'pendente' && r.client_id && !fechado) await salvarAgora(ultimo.current)
    voltar()
  }

  const mover = (idx: number, d: -1 | 1) => {
    const itens = [...r.itens]; const j = idx + d
    if (j < 0 || j >= itens.length) return
    ;[itens[idx], itens[j]] = [itens[j], itens[idx]]
    mudar({ itens })
  }
  const adicionar = (tipo: ItemRelatorio['tipo']) => mudar({ itens: [...r.itens, { id: novoId(), tipo, texto: '', fotos: [] }] })

  const excluir = async () => {
    if (!(await confirmar({ titulo: 'Excluir este relatório?', texto: 'As anotações e fotos dele deixam de aparecer.', confirmar: 'Excluir', perigo: true }))) return
    try { await api.apagar(r.id); toast.success('Relatório excluído'); voltar() } catch (e) { toast.error((e as Error).message) }
  }

  const nomeCliente = clientes.find(c => c.id === r.client_id)?.name || ''
  const montarPdf = async (dados: RelatorioVisita) => {
    const { gerarPdfRelatorioVisita } = await import('../../lib/relatorioVisitaPdf')
    const itens = itensComConteudo(dados.itens)
    const fotos = new Map<string, ImagemPdf>()
    const caminhos = itens.flatMap(i => i.fotos)
    let n = 0
    for (const c of caminhos) {
      setGerando(`Preparando as fotos (${++n} de ${caminhos.length})…`)
      const img = await miniaturaJpeg(previas.get(c) || urlPublica(c), 1100, 0.76)
      if (img) fotos.set(c, img)
    }
    setGerando('Montando o PDF…')
    const logoCaminho = logos[dados.client_id]
    const [logoConsultoria, logoCliente] = await Promise.all([
      miniaturaJpeg('/logo-relatorio.jpg', 600, 0.9),
      logoCaminho ? miniaturaJpeg(urlPublica(logoCaminho), 600, 0.9) : Promise.resolve(null),
    ])
    const semFoto = caminhos.length - fotos.size
    if (semFoto > 0) toast(`${semFoto} foto(s) não carregaram e ficaram fora do PDF. Confira a internet e gere de novo.`, { duration: 7000 })
    return gerarPdfRelatorioVisita({
      relatorio: { ...dados, itens }, cliente: nomeCliente,
      consultor: { nome: dados.autor_nome || autor.nome, email: dados.autor_email ?? autor.email, cargo: dados.autor_cargo ?? autor.cargo, cpf: dados.autor_cpf ?? autor.cpf },
      logoConsultoria, logoCliente, fotos,
    })
  }

  const finalizar = async () => {
    const falta = faltaParaFinalizar(r)
    if (falta.length) { toast.error('Falta ' + falta.join(', ') + '.'); return }
    try {
      const blob = await montarPdf(r)
      setGerando('Enviando o PDF…')
      const caminho = `relatorios/visita/${r.id}/relatorio_${Date.now()}.pdf`
      const { error } = await comNovaTentativa(() => supabase.storage.from('arquivos').upload(caminho, blob, { upsert: false, contentType: 'application/pdf' }))
      if (error) throw error
      const pronto: RelatorioVisita = { ...r, itens: itensComConteudo(r.itens), status: 'finalizado', pdf_url: caminho }
      await api.salvar(pronto)
      setR(pronto); setEstado('salvo')
      toast.success('Relatório finalizado. O PDF já está na visita deste dia.')
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (e) { toast.error('Não consegui finalizar: ' + (e as Error).message) }
    setGerando(null)
  }
  const verPdf = async () => {
    try { const blob = await montarPdf(r); window.open(URL.createObjectURL(blob), '_blank') } catch (e) { toast.error('Não gerou o PDF: ' + (e as Error).message) }
    setGerando(null)
  }
  const reabrir = async () => {
    const aberto: RelatorioVisita = { ...r, status: 'rascunho' }
    if (await salvarAgora(aberto)) setR(aberto)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-2">
        <button onClick={sair} className="btn-ghost px-2 -ml-2 text-sm"><ChevronLeft size={16} />Relatórios</button>
        <span className={`text-xs ${estado === 'erro' ? 'text-red-600' : 'text-ink-400'}`}>
          {fechado ? 'Finalizado' : !r.client_id ? 'Escolha o cliente para começar a salvar' : estado === 'salvo' ? 'Salvo' : estado === 'erro' ? 'Não salvou' : 'Salvando…'}
        </span>
      </div>

      <fieldset disabled={fechado} className="space-y-4 disabled:opacity-100">
        <div className="card p-4 space-y-3">
          <div>
            <label className="label">Cliente *</label>
            <select className="input" value={r.client_id} onChange={e => mudar({ client_id: e.target.value })}>
              <option value="">Escolha o cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">Data da visita *</label>
              <input type="date" className="input" value={r.data}
                onChange={e => mudar({ data: e.target.value, ...(ehTituloPadrao(r.titulo) && e.target.value ? { titulo: tituloPadrao(e.target.value) } : {}) })} />
            </div>
            <div>
              <label className="label">Entrou às *</label>
              <input type="time" className="input" value={r.entrada} onChange={e => mudar({ entrada: e.target.value })} />
            </div>
            <div>
              <label className="label">Saiu às *</label>
              <input type="time" className="input" value={r.saida} onChange={e => mudar({ saida: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">Título</label>
            <input className="input" value={r.titulo} onChange={e => mudar({ titulo: e.target.value })} placeholder={tituloPadrao(r.data || hojeISO())} />
            <p className="text-[11px] text-ink-400 mt-1">Já vem com a data da visita. Só mude se quiser outro título no PDF.</p>
          </div>
          <div>
            <label className="label">Observações gerais / objetivo</label>
            <textarea className="input" rows={2} value={r.objetivo} onChange={e => mudar({ objetivo: e.target.value })} placeholder="Ex.: Visita técnica de rotina" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-900">Anotações</h3>
            <span className="text-xs text-ink-400">Não são obrigatórias. Cada uma sai com um visto no PDF.</span>
          </div>
          {r.itens.map((it, idx) => (
            <ItemEditor key={it.id} it={it} relId={r.id} previas={previas} bloqueado={fechado}
              mudar={m => mudarItem(it.id, m)} tirar={() => mudar({ itens: r.itens.filter(x => x.id !== it.id) })}
              subir={idx > 0 ? () => mover(idx, -1) : undefined} descer={idx < r.itens.length - 1 ? () => mover(idx, 1) : undefined} />
          ))}
          {!fechado && (
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-secondary text-sm flex-1 sm:flex-none" onClick={() => adicionar('nota')}><Plus size={15} />Anotação</button>
              <button type="button" className="btn-ghost text-sm" onClick={() => adicionar('titulo')} title="Um título para separar as anotações (ex.: o nome de um setor)"><Heading size={15} />Título de seção</button>
            </div>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink-800 cursor-pointer">
            <input type="checkbox" checked={assinar} onChange={e => setAssinar(e.target.checked)} />
            Colher as assinaturas na tela (opcional)
          </label>
          {assinar && (
            <div className="grid sm:grid-cols-2 gap-4">
              <Assinatura rotulo={`Sua assinatura (${(r.autor_nome || autor.nome).split(' ')[0]})`} valor={r.assinaturas.consultor || null} bloqueado={fechado}
                mudar={v => mudar({ assinaturas: { ...r.assinaturas, consultor: v } })} />
              <div className="space-y-2">
                <Assinatura rotulo="Assinatura de quem recebeu no cliente" valor={r.assinaturas.cliente || null} bloqueado={fechado}
                  mudar={v => mudar({ assinaturas: { ...r.assinaturas, cliente: v } })} />
                <input className="input text-sm" placeholder="Nome de quem assinou" value={r.assinaturas.cliente_nome || ''} onChange={e => mudar({ assinaturas: { ...r.assinaturas, cliente_nome: e.target.value } })} />
                <input className="input text-sm" placeholder="CPF (opcional)" inputMode="numeric" value={r.assinaturas.cliente_doc || ''} onChange={e => mudar({ assinaturas: { ...r.assinaturas, cliente_doc: e.target.value } })} />
              </div>
            </div>
          )}
        </div>
      </fieldset>

      <div className="space-y-2 pb-4">
        {fechado ? (
          <>
            {r.pdf_url && <a className="btn-primary w-full h-12 text-base" href={urlPublica(r.pdf_url)} target="_blank" rel="noreferrer"><FileText size={18} />Abrir o PDF</a>}
            <button className="btn-secondary w-full" onClick={reabrir}>Corrigir este relatório</button>
          </>
        ) : (
          <>
            <button className="btn-primary w-full h-12 text-base" disabled={!!gerando} onClick={finalizar}><FileText size={18} />{gerando || 'Finalizar e gerar o PDF'}</button>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" disabled={!!gerando || !r.client_id} onClick={verPdf}>Ver como vai ficar</button>
              <button className="btn-ghost text-red-600" disabled={!!gerando} onClick={excluir}><Trash2 size={15} />Excluir</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ItemEditor({ it, relId, previas, bloqueado, mudar, tirar, subir, descer }: {
  it: ItemRelatorio; relId: string; previas: Map<string, string>; bloqueado: boolean
  mudar: (m: Partial<ItemRelatorio>) => void; tirar: () => void; subir?: () => void; descer?: () => void
}) {
  const [enviando, setEnviando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const fotosRef = useRef(it.fotos); fotosRef.current = it.fotos

  const addFotos = async (arquivos: FileList | null) => {
    if (!arquivos?.length) return
    setEnviando(true)
    for (const original of Array.from(arquivos)) {
      try {
        const f = await comprimirImagem(original, 1600, 0.8)
        const caminho = `relatorios/visita/${relId}/${it.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${extensaoDoArquivo(f)}`
        const { error } = await comNovaTentativa(() => supabase.storage.from('arquivos').upload(caminho, f, { upsert: false, contentType: f.type || undefined }))
        if (error) throw error
        previas.set(caminho, URL.createObjectURL(f))
        mudar({ fotos: [...fotosRef.current, caminho] })
        fotosRef.current = [...fotosRef.current, caminho]
      } catch (e) { toast.error('Uma foto não subiu: ' + (e as Error).message + '. Tente de novo.') }
    }
    setEnviando(false)
    if (arquivoRef.current) arquivoRef.current.value = ''
  }

  const acoes = !bloqueado && (
    <div className="flex items-center gap-0.5 shrink-0">
      {subir && <button type="button" className="p-2 text-ink-400 hover:text-ink-800" onClick={subir} aria-label="Subir"><ArrowUp size={15} /></button>}
      {descer && <button type="button" className="p-2 text-ink-400 hover:text-ink-800" onClick={descer} aria-label="Descer"><ArrowDown size={15} /></button>}
      <button type="button" className="p-2 text-ink-400 hover:text-red-600" onClick={tirar} aria-label="Tirar"><X size={16} /></button>
    </div>
  )

  if (it.tipo === 'titulo') return (
    <div className="flex items-center gap-2">
      <input className="input font-semibold" placeholder="Título da seção (ex.: Câmara fria)" value={it.texto} onChange={e => mudar({ texto: e.target.value })} />
      {acoes}
    </div>
  )

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-start gap-2">
        <textarea className="input" rows={3} placeholder="O que você viu ou orientou" value={it.texto} onChange={e => mudar({ texto: e.target.value })} />
        {acoes}
      </div>
      {it.fotos.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {it.fotos.map(f => (
            <div key={f} className="relative w-20 h-20 rounded-lg overflow-hidden bg-ink-100">
              <img src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className="w-full h-full object-cover" loading="lazy" />
              {!bloqueado && <button type="button" onClick={() => mudar({ fotos: it.fotos.filter(x => x !== f) })} aria-label="Tirar a foto"
                className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={13} /></button>}
            </div>
          ))}
        </div>
      )}
      {!bloqueado && (
        <>
          <input ref={arquivoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFotos(e.target.files)} />
          <button type="button" className="btn-ghost text-sm px-2" disabled={enviando} onClick={() => arquivoRef.current?.click()}>
            <Camera size={16} />{enviando ? 'Enviando…' : it.fotos.length ? 'Mais fotos' : 'Adicionar fotos'}
          </button>
        </>
      )}
    </div>
  )
}

/** Assinatura com o dedo ou o mouse; guarda como imagem pequena */
function Assinatura({ rotulo, valor, mudar, bloqueado }: { rotulo: string; valor: string | null; mudar: (v: string | null) => void; bloqueado: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const desenhando = useRef(false)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d')!; ctx.clearRect(0, 0, c.width, c.height)
    if (valor) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = valor }
  }, [valor])
  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!, b = c.getBoundingClientRect()
    return { x: (e.clientX - b.left) * (c.width / b.width), y: (e.clientY - b.top) * (c.height / b.height) }
  }
  const comecar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (bloqueado) return
    e.currentTarget.setPointerCapture(e.pointerId); desenhando.current = true
    const ctx = ref.current!.getContext('2d')!; const p = ponto(e)
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const riscar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return
    const ctx = ref.current!.getContext('2d')!; const p = ponto(e); ctx.lineTo(p.x, p.y); ctx.stroke()
  }
  const terminar = () => { if (!desenhando.current) return; desenhando.current = false; mudar(ref.current!.toDataURL('image/png')) }
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label !mb-1">{rotulo}</label>
        {valor && !bloqueado && <button type="button" className="text-xs text-ink-500 underline" onClick={() => mudar(null)}>Limpar</button>}
      </div>
      <canvas ref={ref} width={620} height={200} onPointerDown={comecar} onPointerMove={riscar} onPointerUp={terminar} onPointerLeave={terminar}
        className="w-full h-28 rounded-lg border border-dashed border-ink-300 bg-white touch-none" />
    </div>
  )
}
