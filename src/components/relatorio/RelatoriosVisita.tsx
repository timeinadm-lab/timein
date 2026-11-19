import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Building2, Calendar, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Download, FileText, Pencil, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { confirmar } from '../ui/ConfirmDialog'
import { comprimirImagem, extensaoDoArquivo, comNovaTentativa, miniaturaJpeg } from '../../lib/imagem'
import { ehTituloPadrao, faltaParaFinalizar, horarioTexto, itensComConteudo, relatorioNovo, tituloPadrao } from '../../lib/relatorioVisita'
import type { ItemRelatorio, LinhaRelatorio, RelatorioVisita } from '../../lib/relatorioVisita'
import type { ImagemPdf } from '../../lib/relatorioVisitaPdf'

/**
 * Relatório de visita ("Ata de Visita") feito no sistema — migrações 114 e 115.
 * 20/11/2026, pedido do Gabriel: a tela tem que ser igual à que a equipe já usa
 * (ele mandou os prints). Por isso o fluxo é em três telas, com os mesmos nomes:
 *   1. Ata de Visita (parte inicial): Data, Hora Inicial, Hora Final, Título,
 *      Nota e Observações Gerais / Objetivo → Salvar.
 *   2. A ata: o resumo no topo e o botão verde "+" para ir colocando as
 *      anotações com fotos.
 *   3. Visualizar Ata de Visita: botão do PDF, "Minha Assinatura" e "Alterar"
 *      (assinatura de quem recebeu no cliente).
 * A mesma tela serve o portal e o escritório: só muda o `api`.
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
// O botão ao lado do campo de data/hora abre o seletor do aparelho
const abrirSeletor = (e: React.MouseEvent<HTMLButtonElement>) => {
  const campo = e.currentTarget.previousElementSibling as (HTMLInputElement & { showPicker?: () => void }) | null
  try { campo?.showPicker ? campo.showPicker() : campo?.focus() } catch { campo?.focus() }
}
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
// Nome, e-mail e assinatura de quem faz ficam guardados no aparelho para a próxima visita
const guardado = (k: string) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const guardar = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* sem armazenamento */ } }

export default function RelatoriosVisita({ api, clientes, chave }: { api: ApiRelatorios; clientes: Cliente[]; chave: string }) {
  const qc = useQueryClient()
  const [aberto, setAberto] = useState<{ r: RelatorioVisita; novo: boolean } | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['relatorios-visita', chave], queryFn: () => api.carregar(), retry: false })
  useEffect(() => { window.scrollTo({ top: 0 }) }, [aberto?.r.id])

  const semMigracao = error && /relatorios_visita|portal_relatorio|function|schema cache/i.test((error as Error).message)
  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Os relatórios de visita ainda não foram liberados (falta rodar a migração 114).</div>
  if (error) return <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Não carregou: {(error as Error).message}</div>

  if (aberto && data) {
    return <Ata inicial={aberto.r} novo={aberto.novo} api={api} clientes={clientes} autor={data.autor} logos={data.logos} chave={chave}
      voltar={() => { setAberto(null); qc.invalidateQueries({ queryKey: ['relatorios-visita', chave] }) }} />
  }

  const abrir = async (id: string) => {
    setAbrindo(id)
    try { setAberto({ r: await api.abrir(id), novo: false }) } catch (e) { toast.error((e as Error).message) }
    setAbrindo(null)
  }
  const rascunhos = data?.relatorios.filter(r => r.status === 'rascunho') || []
  const prontos = data?.relatorios.filter(r => r.status === 'finalizado') || []

  return (
    <div className="space-y-4">
      <button className="btn-primary w-full sm:w-auto h-12 sm:h-auto text-base sm:text-sm" disabled={isLoading || !clientes.length}
        onClick={() => setAberto({ r: relatorioNovo(novoId(), hojeISO(), clientes.length === 1 ? clientes[0].id : undefined), novo: true })}>
        <Plus size={18} />Nova ata de visita
      </button>
      {!clientes.length && !isLoading && <p className="text-sm text-ink-500">Você ainda não tem cliente vinculado. Fale com o escritório.</p>}

      {isLoading ? <p className="text-sm text-ink-500 py-4">Carregando…</p> : (
        <>
          {rascunhos.length > 0 && <Lista titulo="Em andamento" linhas={rascunhos} abrir={abrir} abrindo={abrindo} />}
          {prontos.length > 0 && <Lista titulo="Finalizadas" linhas={prontos} abrir={abrir} abrindo={abrindo} />}
          {!data?.relatorios.length && (
            <div className="card p-6 text-center">
              <p className="text-sm font-medium text-ink-900">Nenhuma ata de visita ainda</p>
              <p className="text-sm text-ink-500 mt-1">Toque em "Nova ata de visita" para fazer a primeira. O PDF sai pronto, com as fotos.</p>
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
              <p className="text-sm font-medium text-ink-900 truncate">{r.titulo || `Visita do dia ${formatDate(r.data)}`}</p>
              <p className="text-xs text-ink-500 truncate">{r.cliente || 'Cliente removido'}{r.autor ? `, por ${r.autor}` : ''}</p>
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

// ── A ata, nas três telas dos prints ─────────────────────────────────────────
type Passo = 'dados' | 'ata' | 'visualizar'

function Ata({ inicial, novo, api, clientes, autor, logos, chave, voltar }: {
  inicial: RelatorioVisita; novo: boolean; api: ApiRelatorios; clientes: Cliente[]; autor: AutorRelatorio; logos: Record<string, string>; chave: string; voltar: () => void
}) {
  const kNome = `relatorio-nome-${chave}`, kEmail = `relatorio-email-${chave}`, kAss = `relatorio-assinatura-${chave}`
  const [r, setR] = useState<RelatorioVisita>(() => ({
    ...inicial,
    // nome completo e e-mail: o que já está no relatório; senão o que a pessoa deixou salvo; senão o do cadastro
    autor_nome: inicial.autor_nome || guardado(kNome) || autor.nome || '',
    autor_email: inicial.autor_email || guardado(kEmail) || autor.email || '',
  }))
  const [passo, setPasso] = useState<Passo>(novo ? 'dados' : inicial.status === 'finalizado' ? 'visualizar' : 'ata')
  const [salvando, setSalvando] = useState(false)
  const [gerando, setGerando] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [itemAberto, setItemAberto] = useState<ItemRelatorio | null>(null)
  const [assinando, setAssinando] = useState<'consultor' | 'cliente' | null>(null)
  const [jaSalvo, setJaSalvo] = useState(!novo)
  const previas = useRef(new Map<string, string>()).current
  const nomeCliente = clientes.find(c => c.id === r.client_id)?.name || ''
  useEffect(() => { window.scrollTo({ top: 0 }) }, [passo])

  const gravar = async (dados: RelatorioVisita, aviso = 'Salvo') => {
    setSalvando(true)
    try { await api.salvar(dados); setR(dados); setJaSalvo(true); if (aviso) toast.success(aviso); return true }
    catch (e) { toast.error('Não salvou: ' + (e as Error).message); return false }
    finally { setSalvando(false) }
  }

  // 1 ─ Parte inicial
  const salvarDados = async () => {
    if (!r.client_id) { toast.error('Escolha o cliente.'); return }
    if (!r.data) { toast.error('Informe a data.'); return }
    if (!r.titulo.trim()) { toast.error('Informe o título.'); return }
    guardar(kNome, (r.autor_nome || '').trim()); guardar(kEmail, (r.autor_email || '').trim())
    if (await gravar({ ...r, titulo: r.titulo.trim() }, 'Salvo. Agora adicione as anotações no botão +')) setPasso('ata')
  }

  // 2 ─ Anotações
  const salvarItem = async (it: ItemRelatorio) => {
    const existe = r.itens.some(x => x.id === it.id)
    const itens = existe ? r.itens.map(x => (x.id === it.id ? it : x)) : [...r.itens, it]
    if (await gravar({ ...r, itens }, existe ? 'Anotação salva' : 'Anotação adicionada')) setItemAberto(null)
  }
  const tirarItem = async (id: string) => {
    if (!(await confirmar({ titulo: 'Tirar esta anotação?', confirmar: 'Tirar', perigo: true }))) return
    if (await gravar({ ...r, itens: r.itens.filter(x => x.id !== id) }, 'Anotação tirada')) setItemAberto(null)
  }
  const mover = (idx: number, d: -1 | 1) => {
    const itens = [...r.itens]; const j = idx + d
    if (j < 0 || j >= itens.length) return
    ;[itens[idx], itens[j]] = [itens[j], itens[idx]]
    void gravar({ ...r, itens }, '')
  }

  // 3 ─ PDF e assinaturas
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
      consultor: { nome: dados.autor_nome || autor.nome, email: dados.autor_email || autor.email, cargo: dados.autor_cargo ?? autor.cargo, cpf: dados.autor_cpf ?? autor.cpf },
      logoConsultoria, logoCliente, fotos,
    })
  }
  const gerarPdf = async () => {
    const falta = faltaParaFinalizar(r)
    if (falta.length) { toast.error('Falta ' + falta.join(', ') + '.'); return }
    try {
      const blob = await montarPdf(r)
      setGerando('Enviando o PDF…')
      const caminho = `relatorios/visita/${r.id}/relatorio_${Date.now()}.pdf`
      const { error } = await comNovaTentativa(() => supabase.storage.from('arquivos').upload(caminho, blob, { upsert: false, contentType: 'application/pdf' }))
      if (error) throw error
      const pronto: RelatorioVisita = { ...r, itens: itensComConteudo(r.itens), status: 'finalizado', pdf_url: caminho }
      await api.salvar(pronto); setR(pronto)
      toast.success('PDF pronto. Ele já está na visita deste dia.')
      window.open(URL.createObjectURL(blob), '_blank')
    } catch (e) { toast.error('Não consegui gerar o PDF: ' + (e as Error).message) }
    setGerando(null)
  }
  const salvarAssinatura = async (quem: 'consultor' | 'cliente', img: string | null) => {
    if (quem === 'consultor') guardar(kAss, img || '')
    if (await gravar({ ...r, assinaturas: { ...r.assinaturas, [quem]: img } }, 'Assinatura salva')) setAssinando(null)
  }
  const minhaAssinatura = () => {
    const salva = guardado(kAss)
    // Já assinou em outra visita neste aparelho: usa a mesma, sem assinar de novo
    if (salva && !r.assinaturas.consultor) { void gravar({ ...r, assinaturas: { ...r.assinaturas, consultor: salva } }, 'Sua assinatura foi colocada'); return }
    setAssinando('consultor')
  }
  const excluir = async () => {
    setMenu(false)
    if (!jaSalvo) { voltar(); return }
    if (!(await confirmar({ titulo: 'Excluir esta ata de visita?', texto: 'As anotações e fotos dela deixam de aparecer.', confirmar: 'Excluir', perigo: true }))) return
    try { await api.apagar(r.id); toast.success('Ata excluída'); voltar() } catch (e) { toast.error((e as Error).message) }
  }

  const fechada = r.status === 'finalizado'
  const itensDoMenu: [string, () => void][] = passo === 'dados'
    ? (jaSalvo ? [['Voltar para a ata', () => setPasso('ata')], ['Excluir', excluir]] : [['Cancelar', voltar]])
    : passo === 'ata'
      ? [['Visualizar', () => setPasso('visualizar')], ['Editar os dados da visita', () => setPasso('dados')], ['Adicionar título de seção', () => setItemAberto({ id: novoId(), tipo: 'titulo', texto: '', fotos: [] })], ['Excluir', excluir]]
      : [['Voltar para editar', () => { if (fechada) void gravar({ ...r, status: 'rascunho' }, 'Aberta para corrigir').then(ok => ok && setPasso('ata')); else setPasso('ata') }],
         ['Refazer minha assinatura', () => setAssinando('consultor')], ['Excluir', excluir]]

  const Resumo = (
    <div className="px-3 py-3 bg-white">
      <p className="font-bold text-ink-900">{r.titulo}</p>
      <div className="grid grid-cols-2 gap-x-3 text-[15px] text-ink-900">
        <p><span className="font-bold">Data:</span> {formatDate(r.data)}</p>
        <p><span className="font-bold">Hora:</span> {horarioTexto(r.entrada, r.saida).replace(/h$/, '') || '—'}</p>
      </div>
      {r.nota.trim() && <p className="text-[15px] text-ink-900"><span className="font-bold">Nota:</span> {r.nota}</p>}
      <p className="text-[15px] text-ink-900"><span className="font-bold">Observações Gerais / Objetivo:</span> {r.objetivo || '—'}</p>
    </div>
  )

  return (
    <div className="max-w-2xl -mx-4 sm:mx-0">
      <button onClick={voltar} className="btn-ghost px-3 sm:px-2 text-sm"><ChevronLeft size={16} />Atas de visita</button>

      {/* Faixa do cliente */}
      <div className="flex items-center gap-2 px-3 py-3 bg-white border-y border-ink-200">
        <Building2 size={20} className="text-ink-700 shrink-0" />
        {passo === 'dados' && !jaSalvo
          ? <select className="input flex-1" value={r.client_id} onChange={e => setR(p => ({ ...p, client_id: e.target.value }))} aria-label="Cliente">
              <option value="">Escolha o cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          : <p className="text-lg text-ink-800 truncate">{nomeCliente || 'Cliente'}</p>}
      </div>

      {/* Faixa do título da tela + botões */}
      <div className="relative flex items-center gap-2 px-3 py-2.5 bg-ink-50 border-b border-ink-200 mt-2">
        <FileText size={18} className="text-ink-700 shrink-0" />
        <p className="flex-1 text-ink-900">{passo === 'visualizar' ? 'Visualizar Ata de Visita' : 'Ata de Visita.'}</p>
        {passo === 'visualizar' && (
          <button onClick={gerarPdf} disabled={!!gerando} title="Gerar o PDF" aria-label="Gerar o PDF"
            className="h-10 px-2.5 rounded border border-primary-600 bg-primary-50 text-red-600 inline-flex items-center gap-1.5 text-sm disabled:opacity-60">
            <FileText size={18} />{gerando ? <span className="text-ink-700 text-xs">{gerando}</span> : <span className="text-[11px] font-bold">PDF</span>}
          </button>
        )}
        <button onClick={() => setMenu(v => !v)} aria-label="Mais opções" aria-expanded={menu}
          className="w-10 h-10 rounded bg-cyan-500 text-white inline-flex items-center justify-center hover:bg-cyan-600"><ChevronDown size={18} /></button>
        {menu && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
            <div className="absolute right-3 top-full mt-1 z-30 w-60 bg-white rounded-lg shadow-lift border border-ink-200 py-1">
              {itensDoMenu.map(([rot, f]) => (
                <button key={rot} className={`w-full text-left px-3 py-2.5 text-sm hover:bg-ink-50 ${rot === 'Excluir' ? 'text-red-600' : 'text-ink-800'}`}
                  onClick={() => { setMenu(false); f() }}>{rot}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 1 ─ Parte inicial */}
      {passo === 'dados' && (
        <div className="px-3 py-4 bg-white space-y-4">
          <div className="max-w-[15rem]">
            <label className="rv-rotulo">Data:<span className="text-red-600">*</span></label>
            <div className="flex">
              <input type="date" className="rv-campo rounded-r-none" value={r.data}
                onChange={e => setR(p => ({ ...p, data: e.target.value, ...(ehTituloPadrao(p.titulo) && e.target.value ? { titulo: tituloPadrao(e.target.value) } : {}) }))} />
              <button type="button" className="rv-icone" aria-label="Abrir o calendário" onClick={abrirSeletor}><Calendar size={17} /></button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div>
              <label className="rv-rotulo">Hora Inicial:</label>
              <div className="flex"><input type="time" className="rv-campo rounded-r-none" value={r.entrada} onChange={e => setR(p => ({ ...p, entrada: e.target.value }))} /><button type="button" className="rv-icone" aria-label="Escolher a hora" onClick={abrirSeletor}><Clock size={17} /></button></div>
            </div>
            <div>
              <label className="rv-rotulo">Hora Final:</label>
              <div className="flex"><input type="time" className="rv-campo rounded-r-none" value={r.saida} onChange={e => setR(p => ({ ...p, saida: e.target.value }))} /><button type="button" className="rv-icone" aria-label="Escolher a hora" onClick={abrirSeletor}><Clock size={17} /></button></div>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_6.5rem] gap-3">
            <div>
              <label className="rv-rotulo">Título:<span className="text-red-600">*</span></label>
              <input className="rv-campo" value={r.titulo} onChange={e => setR(p => ({ ...p, titulo: e.target.value }))} />
            </div>
            <div>
              <label className="rv-rotulo">Nota:</label>
              <input className="rv-campo" inputMode="decimal" value={r.nota} onChange={e => setR(p => ({ ...p, nota: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="rv-rotulo">Observações Gerais / Objetivo:</label>
            <textarea className="rv-campo" rows={3} value={r.objetivo} onChange={e => setR(p => ({ ...p, objetivo: e.target.value }))} />
          </div>
          {/* Quem fez: já vem do cadastro e fica salvo para a próxima visita */}
          <div className="grid sm:grid-cols-2 gap-3 pt-1 border-t border-ink-100">
            <div>
              <label className="rv-rotulo">Consultor(a):</label>
              <input className="rv-campo" value={r.autor_nome || ''} onChange={e => setR(p => ({ ...p, autor_nome: e.target.value }))} placeholder="Seu nome completo" />
            </div>
            <div>
              <label className="rv-rotulo">E-mail:</label>
              <input type="email" className="rv-campo" value={r.autor_email || ''} onChange={e => setR(p => ({ ...p, autor_email: e.target.value }))} placeholder="seu@email.com" />
            </div>
          </div>
          <div className="flex justify-end">
            <button className="h-11 px-5 rounded bg-primary-600 text-white text-base inline-flex items-center gap-1 hover:bg-primary-700 disabled:opacity-60" disabled={salvando} onClick={salvarDados}>
              {salvando ? 'Salvando…' : 'Salvar'}<Check size={18} strokeWidth={3} />
            </button>
          </div>
        </div>
      )}

      {/* 2 ─ A ata: resumo + anotações + botão "+" */}
      {passo === 'ata' && (
        <>
          {Resumo}
          <div className="bg-ink-200/60 min-h-[18rem] px-3 py-3 space-y-2 pb-24">
            {r.itens.length === 0 && <p className="text-sm text-ink-500 text-center pt-10">Toque no <b>+</b> para colocar a primeira anotação com foto.</p>}
            {r.itens.map((it, idx) => (
              <div key={it.id} className="bg-white rounded border border-ink-200 flex">
                <button className="flex-1 min-w-0 text-left p-3" onClick={() => setItemAberto(it)}>
                  {it.tipo === 'titulo'
                    ? <p className="font-bold text-ink-900">{it.texto || 'Título de seção'}</p>
                    : <p className="text-[15px] text-ink-900 flex gap-2"><Check size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={3} /><span className="whitespace-pre-wrap break-words min-w-0">{it.texto || <span className="text-ink-400">Sem texto</span>}</span></p>}
                  {it.fotos.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mt-2 pl-6">
                      {it.fotos.map(f => <img key={f} src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className="w-16 h-16 rounded object-cover bg-ink-100" loading="lazy" />)}
                    </div>
                  )}
                </button>
                <div className="flex flex-col justify-center pr-1 text-ink-400">
                  {idx > 0 && <button className="p-1.5 hover:text-ink-800" onClick={() => mover(idx, -1)} aria-label="Subir">▲</button>}
                  {idx < r.itens.length - 1 && <button className="p-1.5 hover:text-ink-800" onClick={() => mover(idx, 1)} aria-label="Descer">▼</button>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setItemAberto({ id: novoId(), tipo: 'nota', texto: '', fotos: [] })} aria-label="Adicionar anotação" title="Adicionar anotação"
            className="fixed right-4 bottom-24 md:bottom-8 md:right-8 z-20 w-14 h-14 rounded bg-primary-600 text-white shadow-lift inline-flex items-center justify-center hover:bg-primary-700 active:scale-95">
            <Plus size={34} strokeWidth={4} />
          </button>
        </>
      )}

      {/* 3 ─ Visualizar: resumo, anotações, assinaturas */}
      {passo === 'visualizar' && (
        <div className="bg-white pb-6">
          {Resumo}
          <div className="px-3 space-y-3">
            {itensComConteudo(r.itens).map(it => it.tipo === 'titulo'
              ? <p key={it.id} className="font-bold text-ink-900 pt-1">{it.texto}</p>
              : (
                <div key={it.id}>
                  <p className="text-[15px] text-ink-900 flex gap-2"><Check size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={3} /><span className="whitespace-pre-wrap break-words min-w-0">{it.texto}</span></p>
                  {it.fotos.length > 0 && <div className="flex gap-1.5 flex-wrap mt-2 pl-6">{it.fotos.map(f => <img key={f} src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className="h-28 rounded object-cover bg-ink-100" loading="lazy" />)}</div>}
                </div>
              ))}
          </div>
          <div className="mx-3 mt-6 pt-4 border-t border-ink-300 grid grid-cols-2 gap-4">
            <div>
              <div className="h-24 border-b border-ink-300 flex items-end">{r.assinaturas.consultor && <img src={r.assinaturas.consultor} alt="Sua assinatura" className="max-h-24 w-full object-contain object-bottom" />}</div>
              <p className="text-ink-800 mt-1 truncate">{r.autor_nome || autor.nome}</p>
              <p className="text-sm text-ink-600">{r.autor_cargo || autor.cargo || 'Nutricionista'}</p>
            </div>
            <div>
              <div className="h-24 border-b border-ink-300 flex items-end">{r.assinaturas.cliente && <img src={r.assinaturas.cliente} alt="Assinatura do cliente" className="max-h-24 w-full object-contain object-bottom" />}</div>
              <p className="text-ink-800 mt-1 truncate">{r.assinaturas.cliente_nome?.trim() || nomeCliente}</p>
              <p className="text-sm text-ink-600">CPF {r.assinaturas.cliente_doc || ''}</p>
            </div>
          </div>
          <div className="mx-3 mt-6 grid grid-cols-[1fr_1fr] gap-4 items-center">
            <div><button onClick={minhaAssinatura} disabled={salvando} className="h-10 px-2.5 rounded bg-cyan-500 text-white text-sm whitespace-nowrap inline-flex items-center gap-1.5 hover:bg-cyan-600 disabled:opacity-60"><Pencil size={14} />Minha Assinatura</button></div>
            <div><button onClick={() => setAssinando('cliente')} className="h-9 px-3 rounded border border-ink-500 text-ink-600 inline-flex items-center gap-1.5 hover:bg-ink-50"><Pencil size={15} />Alterar</button></div>
          </div>
        </div>
      )}

      {itemAberto && <JanelaAnotacao item={itemAberto} relId={r.id} previas={previas} salvando={salvando} novo={!r.itens.some(x => x.id === itemAberto.id)}
        salvar={salvarItem} tirar={() => tirarItem(itemAberto.id)} fechar={() => setItemAberto(null)} />}
      {assinando && <JanelaAssinatura valor={assinando === 'consultor' ? r.assinaturas.consultor || null : r.assinaturas.cliente || null} salvando={salvando}
        cliente={assinando === 'cliente' ? { nome: r.assinaturas.cliente_nome || '', doc: r.assinaturas.cliente_doc || '' } : null}
        salvar={async (img, quem) => {
          if (assinando === 'cliente' && quem) { const novo = { ...r, assinaturas: { ...r.assinaturas, cliente: img, cliente_nome: quem.nome, cliente_doc: quem.doc } }; if (await gravar(novo, 'Assinatura salva')) setAssinando(null) }
          else await salvarAssinatura(assinando, img)
        }} fechar={() => setAssinando(null)} />}
    </div>
  )
}

// ── Janela da anotação (abre no "+") ────────────────────────────────────────
function JanelaAnotacao({ item, relId, previas, salvando, novo, salvar, tirar, fechar }: {
  item: ItemRelatorio; relId: string; previas: Map<string, string>; salvando: boolean; novo: boolean
  salvar: (it: ItemRelatorio) => void; tirar: () => void; fechar: () => void
}) {
  const [it, setIt] = useState(item)
  const [enviando, setEnviando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const ehTitulo = it.tipo === 'titulo'

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
        setIt(p => ({ ...p, fotos: [...p.fotos, caminho] }))
      } catch (e) { toast.error('Uma foto não subiu: ' + (e as Error).message + '. Tente de novo.') }
    }
    setEnviando(false)
    if (arquivoRef.current) arquivoRef.current.value = ''
  }
  const confirmar_ = () => {
    if (!it.texto.trim() && !it.fotos.length) { toast.error(ehTitulo ? 'Escreva o título.' : 'Escreva a anotação ou coloque uma foto.'); return }
    salvar({ ...it, texto: it.texto.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 flex items-start justify-center p-2 pt-16 sm:pt-24 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded shadow-lift">
        <div className="flex items-center justify-between px-4 py-4 bg-cyan-500 text-white rounded-t">
          <p className="text-xl">{ehTitulo ? 'Título de seção' : 'Anotação'}</p>
          <button onClick={fechar} aria-label="Fechar" className="p-1"><X size={22} strokeWidth={3} /></button>
        </div>
        <div className="p-4 space-y-3">
          {ehTitulo
            ? <input className="rv-campo font-semibold" placeholder="Ex.: Câmara fria" value={it.texto} onChange={e => setIt(p => ({ ...p, texto: e.target.value }))} autoFocus />
            : <textarea className="rv-campo" rows={5} placeholder="O que você viu ou orientou" value={it.texto} onChange={e => setIt(p => ({ ...p, texto: e.target.value }))} autoFocus />}
          {!ehTitulo && (
            <>
              {it.fotos.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {it.fotos.map(f => (
                    <div key={f} className="relative w-20 h-20 rounded overflow-hidden bg-ink-100">
                      <img src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setIt(p => ({ ...p, fotos: p.fotos.filter(x => x !== f) }))} aria-label="Tirar a foto"
                        className="absolute top-0.5 right-0.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={arquivoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFotos(e.target.files)} />
              <button type="button" className="h-10 px-3 rounded border border-ink-400 text-ink-700 inline-flex items-center gap-2 hover:bg-ink-50 disabled:opacity-60" disabled={enviando} onClick={() => arquivoRef.current?.click()}>
                <Camera size={17} />{enviando ? 'Enviando…' : it.fotos.length ? 'Mais fotos' : 'Fotos'}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-3 bg-ink-50 border-t border-ink-200 rounded-b">
          {!novo && <button className="h-9 px-3 rounded border border-red-400 text-red-600 hover:bg-red-50" onClick={tirar}>Excluir</button>}
          <button className="h-11 px-5 rounded bg-primary-600 text-white text-base mx-auto hover:bg-primary-700 disabled:opacity-60" disabled={salvando || enviando} onClick={confirmar_}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Janela "Assinatura", como no print: Limpar à esquerda, Salvar no meio ────
function JanelaAssinatura({ valor, cliente, salvando, salvar, fechar }: {
  valor: string | null; cliente: { nome: string; doc: string } | null; salvando: boolean
  salvar: (img: string | null, quem?: { nome: string; doc: string }) => void; fechar: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const desenhando = useRef(false)
  const [mexeu, setMexeu] = useState(false)
  const [vazio, setVazio] = useState(!valor)
  const [quem, setQuem] = useState(cliente || { nome: '', doc: '' })
  useEffect(() => {
    const c = ref.current; if (!c || !valor) return
    const img = new Image(); img.onload = () => c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); img.src = valor
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!, b = c.getBoundingClientRect()
    return { x: (e.clientX - b.left) * (c.width / b.width), y: (e.clientY - b.top) * (c.height / b.height) }
  }
  const comecar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId); desenhando.current = true
    const ctx = ref.current!.getContext('2d')!; const p = ponto(e)
    ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  const riscar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return
    const ctx = ref.current!.getContext('2d')!; const p = ponto(e); ctx.lineTo(p.x, p.y); ctx.stroke()
    setMexeu(true); setVazio(false)
  }
  const limpar = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setMexeu(true); setVazio(true) }
  const confirmar_ = () => salvar(vazio ? null : mexeu ? ref.current!.toDataURL('image/png') : valor, cliente ? quem : undefined)

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/50 flex items-start justify-center p-2 pt-16 sm:pt-24 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded shadow-lift">
        <div className="flex items-center justify-between px-4 py-5 bg-cyan-500 text-white rounded-t">
          <p className="text-2xl">Assinatura</p>
          <button onClick={fechar} aria-label="Fechar" className="p-1"><X size={22} strokeWidth={3} /></button>
        </div>
        <div className="px-4 pt-5 pb-4">
          <p className="text-center text-ink-900 mb-3">Assinatura:</p>
          <canvas ref={ref} width={640} height={340} onPointerDown={comecar} onPointerMove={riscar} onPointerUp={() => { desenhando.current = false }} onPointerLeave={() => { desenhando.current = false }}
            className="block w-full max-w-sm mx-auto aspect-[32/17] rounded border border-ink-300 bg-ink-100 touch-none" />
          {cliente && (
            <div className="grid grid-cols-2 gap-2 mt-3 max-w-sm mx-auto">
              <input className="rv-campo" placeholder="Nome de quem assinou" value={quem.nome} onChange={e => setQuem(p => ({ ...p, nome: e.target.value }))} />
              <input className="rv-campo" placeholder="CPF" inputMode="numeric" value={quem.doc} onChange={e => setQuem(p => ({ ...p, doc: e.target.value }))} />
            </div>
          )}
        </div>
        <div className="relative flex items-center px-4 py-4 bg-ink-50 border-t border-ink-200 rounded-b">
          <button className="h-8 px-2.5 rounded border border-ink-500 text-ink-600 hover:bg-white" onClick={limpar}>Limpar</button>
          <button className="absolute left-1/2 -translate-x-1/2 h-11 px-5 rounded bg-primary-600 text-white text-lg hover:bg-primary-700 disabled:opacity-60" disabled={salvando} onClick={confirmar_}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}
