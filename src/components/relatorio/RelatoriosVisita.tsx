import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Camera, ChevronLeft, ChevronRight, Download, FileText, MoreVertical, Pencil, Plus, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, hojeISO } from '../../lib/utils'
import { confirmar } from '../ui/ConfirmDialog'
import { comprimirImagem, extensaoDoArquivo, comNovaTentativa, miniaturaJpeg } from '../../lib/imagem'
import { ehTituloPadrao, faltaParaFinalizar, horarioTexto, inserirNoSetor, itensComConteudo, itensParaPdf, relatorioNovo, tituloPadrao } from '../../lib/relatorioVisita'
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
  /** Visita do ponto da mesma pessoa, no mesmo cliente e dia (null = não tem) */
  visitaDoDia(r: RelatorioVisita): Promise<{ id: string; temRelatorio: boolean } | null>
  /** Coloca o PDF do relatório no campo "relatório" dessa visita */
  anexarNaVisita(visitaId: string, r: RelatorioVisita): Promise<void>
}
type Cliente = { id: string; name: string }

const urlPublica = (caminho: string) => supabase.storage.from('arquivos').getPublicUrl(caminho).data.publicUrl
/** Nome do arquivo baixado: "Ata de visita 26-11-2026 - Cliente.pdf" */
export const nomeDoPdf = (r: Pick<RelatorioVisita, 'data'>, cliente: string) =>
  `Ata de visita ${formatDate(r.data).replace(/\//g, '-')}${cliente ? ' - ' + cliente.replace(/[\/:*?"<>|]/g, '') : ''}.pdf`
/** Link que BAIXA o PDF (em vez de só abrir) */
const urlParaBaixar = (caminho: string, nome: string) => supabase.storage.from('arquivos').getPublicUrl(caminho, { download: nome }).data.publicUrl
const baixarArquivo = (blob: Blob, nome: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = nome
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
// Nome, e-mail e assinatura de quem faz ficam guardados no aparelho para a próxima visita
const guardado = (k: string) => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const guardar = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* sem armazenamento */ } }

export default function RelatoriosVisita({ api, clientes, chave, aoAbrir }: { api: ApiRelatorios; clientes: Cliente[]; chave: string; aoAbrir?: (aberta: boolean) => void }) {
  const qc = useQueryClient()
  const [aberto, setAberto] = useState<{ r: RelatorioVisita; novo: boolean } | null>(null)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({ queryKey: ['relatorios-visita', chave], queryFn: () => api.carregar(), retry: false })
  useEffect(() => { window.scrollTo({ top: 0 }) }, [aberto?.r.id])
  useEffect(() => { aoAbrir?.(!!aberto) }, [!!aberto]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => aoAbrir?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps

  const semMigracao = error && /relatorios_visita|portal_relatorio|function|schema cache/i.test((error as Error).message)
  if (semMigracao) return <div className="card p-4 text-sm text-amber-800 bg-amber-50 border-amber-200">Os relatórios de visita ainda não foram liberados (falta rodar a migração 114).</div>
  if (error) return <div className="card p-4 text-sm text-red-700 bg-red-50 border-red-200">Não carregou: {(error as Error).message}</div>

  if (aberto && data) {
    return <Ata inicial={aberto.r} novo={aberto.novo} api={api} clientes={clientes} autor={data.autor} logos={data.logos} chave={chave} telaCheia={chave === 'portal'}
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
              <a href={urlParaBaixar(r.pdf_url, nomeDoPdf(r, r.cliente || ''))} className="btn-secondary text-xs py-2 px-3 shrink-0" title="Baixar o PDF">
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

function Ata({ inicial, novo, api, clientes, autor, logos, chave, voltar, telaCheia }: {
  inicial: RelatorioVisita; novo: boolean; api: ApiRelatorios; clientes: Cliente[]; autor: AutorRelatorio; logos: Record<string, string>; chave: string; voltar: () => void; telaCheia?: boolean
}) {
  const qc = useQueryClient()
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
  // "+" abre a escolha Anotação/Setor; o "+" do título cinza anota naquele setor
  const [escolhendo, setEscolhendo] = useState(false)
  const [noSetor, setNoSetor] = useState<string | null>(null)
  const previas = useRef(new Map<string, string>()).current
  const nomeCliente = clientes.find(c => c.id === r.client_id)?.name || ''
  const meioRef = useRef<HTMLDivElement>(null)
  useEffect(() => { window.scrollTo({ top: 0 }); meioRef.current?.scrollTo({ top: 0 }) }, [passo])
  // Tela cheia: a página de trás não rola junto (no iPhone ela "escorregava")
  useEffect(() => {
    if (!telaCheia) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = antes }
  }, [telaCheia])

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
    if (await gravar({ ...r, titulo: r.titulo.trim() }, 'Salvo. Agora use + Adicionar para as anotações')) setPasso('ata')
  }

  // 2 ─ Anotações
  const salvarItem = async (it: ItemRelatorio) => {
    const existe = r.itens.some(x => x.id === it.id)
    const itens = existe ? r.itens.map(x => (x.id === it.id ? it : x)) : inserirNoSetor(r.itens, noSetor, it)
    const aviso = it.tipo === 'titulo' ? (existe ? 'Setor salvo' : 'Setor adicionado') : (existe ? 'Anotação salva' : 'Anotação adicionada')
    if (await gravar({ ...r, itens }, aviso)) { setItemAberto(null); setNoSetor(null) }
  }
  const tirarItem = async (id: string) => {
    const ehSetor = r.itens.find(x => x.id === id)?.tipo === 'titulo'
    if (!(await confirmar({ titulo: ehSetor ? 'Tirar este setor?' : 'Tirar esta anotação?', texto: ehSetor ? 'Só o título sai; as anotações dele continuam.' : undefined, confirmar: 'Tirar', perigo: true }))) return
    if (await gravar({ ...r, itens: r.itens.filter(x => x.id !== id) }, ehSetor ? 'Setor tirado' : 'Anotação tirada')) setItemAberto(null)
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
      qc.invalidateQueries({ queryKey: ['portal-relatorios-ponto'] })
      // 27/11/2026: o PDF é BAIXADO; e só pergunta "enviar para a visita do dia"
      // se existir visita do ponto naquele cliente e naquele dia (antes colava
      // sozinho e avisava "já está na visita" mesmo sem visita nenhuma).
      baixarArquivo(blob, nomeDoPdf(pronto, nomeCliente))
      setGerando(null)
      let visita: { id: string; temRelatorio: boolean } | null = null
      try { visita = await api.visitaDoDia(pronto) } catch { visita = null }
      if (!visita) { toast.success('PDF pronto e baixado.'); return }
      const enviar = await confirmar({
        titulo: `Enviar para a visita do dia ${formatDate(pronto.data)}?`,
        texto: `${nomeCliente}. O PDF fica como o relatório dessa visita no ponto.${visita.temRelatorio ? ' Essa visita já tem um relatório anexado: ele será trocado por este.' : ''}`,
        confirmar: 'Enviar', cancelar: 'Agora não',
      })
      if (!enviar) { toast.success('PDF pronto e baixado. Não foi para a visita.'); return }
      await api.anexarNaVisita(visita.id, pronto)
      toast.success('PDF baixado e enviado para a visita do dia.')
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
  const nomeConsultor = r.autor_nome || autor.nome
  const itensDoMenu: [string, () => void][] = passo === 'dados'
    ? (jaSalvo ? [['Excluir esta ata', excluir]] : [['Cancelar', voltar]])
    : passo === 'ata'
      ? [['Editar os dados da visita', () => setPasso('dados')], ['Excluir esta ata', excluir]]
      : [[fechada ? 'Corrigir esta ata' : 'Voltar para as anotações', () => { if (fechada) void gravar({ ...r, status: 'rascunho' }, 'Aberta para corrigir').then(ok => ok && setPasso('ata')); else setPasso('ata') }],
         ['Refazer minha assinatura', () => setAssinando('consultor')], ['Excluir esta ata', excluir]]
  const novaAnotacao = (tituloId: string | null) => { setEscolhendo(false); setNoSetor(tituloId); setItemAberto({ id: novoId(), tipo: 'nota', texto: '', fotos: [] }) }
  const novoSetor = () => { setEscolhendo(false); setNoSetor(null); setItemAberto({ id: novoId(), tipo: 'titulo', texto: '', fotos: [] }) }
  const paraVer = itensParaPdf(r.itens)

  // Os 3 passos, sempre visíveis: a pessoa sabe onde está e pula entre eles
  const PASSOS: [Passo, string][] = [['dados', 'Dados'], ['ata', 'Anotações'], ['visualizar', 'Assinar e PDF']]
  const irPara = (p: Passo) => { if (!jaSalvo && p !== 'dados') { toast.error('Salve os dados da visita primeiro.'); return } setPasso(p) }

  const Resumo = (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink-900 leading-snug">{r.titulo}</p>
          <p className="text-sm text-ink-500 mt-0.5">{formatDate(r.data)}{horarioTexto(r.entrada, r.saida) ? ` · ${horarioTexto(r.entrada, r.saida)}` : ''}{r.nota.trim() ? ` · Nota ${r.nota}` : ''}</p>
        </div>
        {passo === 'ata' && <button onClick={() => setPasso('dados')} className="text-sm font-medium text-primary-700 shrink-0 py-0.5">Editar</button>}
      </div>
      {r.objetivo.trim() && <p className="text-sm text-ink-700 mt-2 whitespace-pre-wrap break-words"><span className="font-medium">Observações gerais: </span>{r.objetivo}</p>}
    </div>
  )

  const fotosDe = (fotos: string[], grande?: boolean) => fotos.length > 0 && (
    <span className="flex gap-1.5 flex-wrap mt-2">
      {fotos.map(f => <img key={f} src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className={`${grande ? 'h-28' : 'w-14 h-14'} rounded-lg object-cover bg-ink-100`} loading="lazy" />)}
    </span>
  )

  // Página "travada" (27/11/2026): no portal a ata ocupa a tela inteira, com o
  // topo e o rodapé parados e só o meio rolando — nada flutuando.
  const raiz = telaCheia ? 'fixed inset-0 z-40 bg-ink-50 flex flex-col' : 'max-w-2xl -mx-4 sm:mx-0'
  const meio = telaCheia ? 'flex-1 min-h-0 overflow-y-auto overscroll-contain' : ''

  return (
    <div className={raiz}>
      {/* Topo: voltar, cliente, menu e os passos */}
      <div className={`${telaCheia ? 'shrink-0' : 'sticky top-0 z-20'} bg-white border-b border-ink-200`} style={telaCheia ? { paddingTop: 'env(safe-area-inset-top)' } : undefined}>
        <div className="max-w-2xl mx-auto px-2 sm:px-3 py-1.5 flex items-center gap-1">
          <button onClick={voltar} className="h-10 pl-1 pr-2 rounded-lg inline-flex items-center gap-0.5 text-sm font-medium text-ink-700 active:bg-ink-100 shrink-0"><ChevronLeft size={20} />Atas</button>
          <p className="flex-1 min-w-0 text-center text-sm font-semibold text-ink-900 truncate">{nomeCliente || 'Nova ata de visita'}</p>
          <div className="relative shrink-0">
            <button onClick={() => setMenu(v => !v)} aria-label="Mais opções" aria-expanded={menu}
              className="w-10 h-10 rounded-lg inline-flex items-center justify-center text-ink-600 active:bg-ink-100"><MoreVertical size={20} /></button>
            {menu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-white rounded-xl shadow-lift border border-ink-200 py-1">
                  {itensDoMenu.map(([rot, f]) => (
                    <button key={rot} className={`w-full text-left px-3.5 py-2.5 text-sm hover:bg-ink-50 ${rot.startsWith('Excluir') ? 'text-red-600' : 'text-ink-800'}`}
                      onClick={() => { setMenu(false); f() }}>{rot}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="max-w-2xl mx-auto grid grid-cols-3 gap-1.5 px-3 pb-2">
          {PASSOS.map(([p, rot], i) => {
            const atual = passo === p
            const feito = PASSOS.findIndex(x => x[0] === passo) > i
            return (
              <button key={p} onClick={() => irPara(p)} className="text-left">
                <span className={`block h-1 rounded-full ${atual ? 'bg-primary-600' : feito ? 'bg-primary-300' : 'bg-ink-200'}`} />
                <span className={`block text-[11px] mt-1 ${atual ? 'text-ink-900 font-semibold' : 'text-ink-500'}`}>{i + 1}. {rot}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className={meio} ref={meioRef}>
        <div className={`max-w-2xl mx-auto px-3 pt-3 space-y-3 ${telaCheia ? 'pb-6' : 'pb-20 md:pb-4'}`}>
          {/* 1 ─ Dados da visita */}
          {passo === 'dados' && (
            <div className="card p-4 space-y-4">
              {!jaSalvo && (
                <div>
                  <label className="rv-rotulo">Cliente <span className="text-red-600">*</span></label>
                  <select className="rv-campo" value={r.client_id} onChange={e => setR(p => ({ ...p, client_id: e.target.value }))}>
                    <option value="">Escolha o cliente</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2">
                <div className="min-w-0">
                  <label className="rv-rotulo">Data <span className="text-red-600">*</span></label>
                  <input type="date" className="rv-campo px-2" value={r.data}
                    onChange={e => setR(p => ({ ...p, data: e.target.value, ...(ehTituloPadrao(p.titulo) && e.target.value ? { titulo: tituloPadrao(e.target.value) } : {}) }))} />
                </div>
                <div className="min-w-0">
                  <label className="rv-rotulo">Entrada</label>
                  <input type="time" className="rv-campo px-2" value={r.entrada} onChange={e => setR(p => ({ ...p, entrada: e.target.value }))} />
                </div>
                <div className="min-w-0">
                  <label className="rv-rotulo">Saída</label>
                  <input type="time" className="rv-campo px-2" value={r.saida} onChange={e => setR(p => ({ ...p, saida: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <div className="min-w-0">
                  <label className="rv-rotulo">Título <span className="text-red-600">*</span></label>
                  <input className="rv-campo" value={r.titulo} onChange={e => setR(p => ({ ...p, titulo: e.target.value }))} />
                </div>
                <div>
                  <label className="rv-rotulo">Nota</label>
                  <input className="rv-campo" inputMode="decimal" value={r.nota} onChange={e => setR(p => ({ ...p, nota: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="rv-rotulo">Observações gerais / objetivo</label>
                <textarea className="rv-campo" rows={3} placeholder="Ex.: acompanhamento mensal de boas práticas" value={r.objetivo} onChange={e => setR(p => ({ ...p, objetivo: e.target.value }))} />
              </div>
              {/* Quem fez: já vem do cadastro e fica salvo para a próxima visita */}
              <div className="grid sm:grid-cols-2 gap-2 pt-3 border-t border-ink-100">
                <div>
                  <label className="rv-rotulo">Consultor(a)</label>
                  <input className="rv-campo" value={r.autor_nome || ''} onChange={e => setR(p => ({ ...p, autor_nome: e.target.value }))} placeholder="Seu nome completo" />
                </div>
                <div>
                  <label className="rv-rotulo">E-mail</label>
                  <input type="email" className="rv-campo" value={r.autor_email || ''} onChange={e => setR(p => ({ ...p, autor_email: e.target.value }))} placeholder="seu@email.com" />
                </div>
              </div>
            </div>
          )}

          {/* 2 ─ Anotações, na ordem; setor = título cinza (27/11/2026) */}
          {passo === 'ata' && (
            <>
              {Resumo}
              {r.itens.length === 0 && (
                <div className="rounded-xl border border-dashed border-ink-300 p-6 text-center">
                  <p className="text-sm font-medium text-ink-800">Nenhuma anotação ainda</p>
                  <p className="text-sm text-ink-500 mt-1">Toque em <b>+ Adicionar</b> e escolha "Anotação" ou "Setor" (o setor vira um título, como "Cozinha").</p>
                </div>
              )}
              {r.itens.length > 0 && (
                <div className="bg-white rounded-xl border border-ink-200 overflow-hidden divide-y divide-ink-100">
                  {r.itens.map(it => it.tipo === 'titulo' ? (
                    <div key={it.id} className="flex items-center bg-ink-100">
                      <button className="flex-1 min-w-0 text-left px-3 py-2" onClick={() => { setNoSetor(null); setItemAberto(it) }}>
                        <span className="block text-sm font-semibold text-ink-700 truncate">{it.texto || 'Setor'}</span>
                      </button>
                      <button onClick={() => novaAnotacao(it.id)} aria-label={`Nova anotação em ${it.texto}`} className="w-11 h-10 inline-flex items-center justify-center text-ink-600 active:bg-ink-200"><Plus size={18} /></button>
                    </div>
                  ) : (
                    <button key={it.id} className="w-full text-left px-3 py-3 active:bg-ink-50 flex gap-2" onClick={() => { setNoSetor(null); setItemAberto(it) }}>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] text-ink-900 whitespace-pre-wrap break-words line-clamp-4">{it.texto || <span className="text-ink-400">Só foto</span>}</span>
                        {fotosDe(it.fotos)}
                      </span>
                      <Pencil size={14} className="text-ink-300 shrink-0 mt-1" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* 3 ─ Assinar e PDF: o relatório como vai sair */}
          {passo === 'visualizar' && (
            <>
              {fechada && (
                <div className="rounded-xl bg-primary-50 border border-primary-200 px-3.5 py-2.5 text-sm text-primary-800">
                  Ata finalizada. Para mudar algo, use "Corrigir esta ata" no menu.
                </div>
              )}
              {Resumo}
              {paraVer.length > 0 && (
                <div className="card overflow-hidden">
                  {paraVer.map(it => it.tipo === 'titulo'
                    ? <p key={it.id} className="px-4 py-1.5 bg-ink-100 text-sm font-semibold text-ink-700">{it.texto}</p>
                    : (
                      <div key={it.id} className="px-4 py-3">
                        {it.texto && <p className="text-[15px] text-ink-900 whitespace-pre-wrap break-words">{it.texto}</p>}
                        {fotosDe(it.fotos, true)}
                      </div>
                    ))}
                </div>
              )}
              <div className="card p-4">
                <p className="text-xs font-medium text-ink-500 mb-3">Assinaturas</p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={minhaAssinatura} disabled={salvando} className="text-left min-w-0">
                    <span className={`h-20 rounded-lg border flex items-center justify-center overflow-hidden ${r.assinaturas.consultor ? 'border-ink-200 bg-white' : 'border-dashed border-ink-300 bg-ink-50 text-ink-500'}`}>
                      {r.assinaturas.consultor ? <img src={r.assinaturas.consultor} alt="Sua assinatura" className="max-h-20 w-full object-contain" /> : <span className="text-xs inline-flex items-center gap-1"><Pencil size={13} />Minha assinatura</span>}
                    </span>
                    <span className="block text-sm text-ink-800 mt-1.5 truncate">{nomeConsultor}</span>
                    <span className="block text-xs text-ink-500 truncate">{r.autor_cargo || autor.cargo || 'Nutricionista'}</span>
                  </button>
                  <button onClick={() => setAssinando('cliente')} disabled={salvando} className="text-left min-w-0">
                    <span className={`h-20 rounded-lg border flex items-center justify-center overflow-hidden ${r.assinaturas.cliente ? 'border-ink-200 bg-white' : 'border-dashed border-ink-300 bg-ink-50 text-ink-500'}`}>
                      {r.assinaturas.cliente ? <img src={r.assinaturas.cliente} alt="Assinatura do cliente" className="max-h-20 w-full object-contain" /> : <span className="text-xs inline-flex items-center gap-1"><Pencil size={13} />Assinatura do cliente</span>}
                    </span>
                    <span className="block text-sm text-ink-800 mt-1.5 truncate">{r.assinaturas.cliente_nome?.trim() || nomeCliente}</span>
                    <span className="block text-xs text-ink-500 truncate">{r.assinaturas.cliente_doc ? `CPF ${r.assinaturas.cliente_doc}` : 'Responsável no cliente'}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rodapé parado (não flutua): a ação de cada passo */}
      <div className={`${telaCheia ? 'shrink-0' : 'sticky z-10 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-0'} bg-white border-t border-ink-200`}
        style={telaCheia ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}>
        <div className="max-w-2xl mx-auto px-3 py-2.5 flex gap-2 relative">
          {passo === 'dados' && (
            <button className="btn-primary flex-1 h-12 text-base" disabled={salvando} onClick={salvarDados}>
              {salvando ? 'Salvando…' : jaSalvo ? 'Salvar e voltar às anotações' : 'Salvar e começar as anotações'}
            </button>
          )}
          {passo === 'ata' && (
            <>
              {/* "+": escolhe entre anotação e setor (pedido de 27/11/2026) */}
              {escolhendo && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setEscolhendo(false)} />
                  <div className="absolute left-3 right-3 bottom-full mb-2 z-20 bg-white rounded-2xl border border-ink-200 shadow-lift overflow-hidden divide-y divide-ink-100">
                    <button className="w-full text-left px-4 py-3.5 active:bg-ink-50" onClick={() => novaAnotacao(null)}>
                      <span className="block text-[15px] font-medium text-ink-900">Anotação</span>
                      <span className="block text-xs text-ink-500">Texto e fotos do que você viu ou orientou</span>
                    </button>
                    <button className="w-full text-left px-4 py-3.5 active:bg-ink-50" onClick={novoSetor}>
                      <span className="block text-[15px] font-medium text-ink-900">Setor</span>
                      <span className="block text-xs text-ink-500">Um título cinza, como "Cozinha" ou "Estoque"</span>
                    </button>
                  </div>
                </>
              )}
              <button className="btn-primary flex-1 h-12 text-base" onClick={() => setEscolhendo(v => !v)} aria-expanded={escolhendo}><Plus size={18} />Adicionar</button>
              <button className="btn-secondary h-12 px-4" onClick={() => setPasso('visualizar')} title="Revisar, assinar e gerar o PDF">Revisar<ChevronRight size={16} /></button>
            </>
          )}
          {passo === 'visualizar' && (
            <>
              <button className="btn-primary flex-1 h-12 text-base" disabled={!!gerando} onClick={gerarPdf}>
                <FileText size={18} />{gerando || (fechada ? 'Gerar o PDF de novo' : 'Finalizar e baixar o PDF')}
              </button>
              {r.pdf_url && fechada && !gerando && (
                <a className="btn-secondary h-12 px-4" href={urlParaBaixar(r.pdf_url, nomeDoPdf(r, nomeCliente))} title="Baixar o PDF já gerado"><Download size={16} />Baixar</a>
              )}
            </>
          )}
        </div>
      </div>

      {itemAberto && <JanelaAnotacao item={itemAberto} relId={r.id} previas={previas} salvando={salvando} novo={!r.itens.some(x => x.id === itemAberto.id)}
        salvar={it => void salvarItem(it)} tirar={() => tirarItem(itemAberto.id)} fechar={() => setItemAberto(null)} />}
      {assinando && <JanelaAssinatura valor={assinando === 'consultor' ? r.assinaturas.consultor || null : r.assinaturas.cliente || null} salvando={salvando}
        cliente={assinando === 'cliente' ? { nome: r.assinaturas.cliente_nome || '', doc: r.assinaturas.cliente_doc || '' } : null}
        salvar={async (img, quem) => {
          if (assinando === 'cliente' && quem) { const novo = { ...r, assinaturas: { ...r.assinaturas, cliente: img, cliente_nome: quem.nome, cliente_doc: quem.doc } }; if (await gravar(novo, 'Assinatura salva')) setAssinando(null) }
          else await salvarAssinatura(assinando, img)
        }} fechar={() => setAssinando(null)} />}
    </div>
  )
}

// ── Janela da anotação ou do setor: simples, como antes (27/11/2026) ─────────
function JanelaAnotacao({ item, relId, previas, salvando, novo, salvar, tirar, fechar }: {
  item: ItemRelatorio; relId: string; previas: Map<string, string>; salvando: boolean; novo: boolean
  salvar: (it: ItemRelatorio) => void; tirar: () => void; fechar: () => void
}) {
  const [it, setIt] = useState(item)
  const [enviando, setEnviando] = useState(false)
  const arquivoRef = useRef<HTMLInputElement>(null)
  const ehSetor = it.tipo === 'titulo'

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
    if (ehSetor && !it.texto.trim()) { toast.error('Escreva o nome do setor.'); return }
    if (!ehSetor && !it.texto.trim() && !it.fotos.length) { toast.error('Escreva a anotação ou coloque uma foto.'); return }
    salvar({ ...it, texto: it.texto.trim() })
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/40 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full max-w-lg rounded-t-2xl sm:rounded-2xl shadow-lift max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 border-b border-ink-100">
          <p className="text-base font-semibold text-ink-900">{ehSetor ? (novo ? 'Novo setor' : 'Setor') : (novo ? 'Nova anotação' : 'Anotação')}</p>
          <button onClick={fechar} aria-label="Fechar" className="w-10 h-10 -mr-2 rounded-lg inline-flex items-center justify-center text-ink-600 active:bg-ink-100"><X size={22} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {ehSetor
            ? <input className="rv-campo font-semibold" placeholder="Ex.: Cozinha" value={it.texto} onChange={e => setIt(p => ({ ...p, texto: e.target.value }))} autoFocus />
            : <textarea className="rv-campo" rows={5} placeholder="O que você viu ou orientou" value={it.texto} onChange={e => setIt(p => ({ ...p, texto: e.target.value }))} autoFocus={novo} />}
          {!ehSetor && (
            <>
              {it.fotos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {it.fotos.map(f => (
                    <div key={f} className="relative aspect-square rounded-lg overflow-hidden bg-ink-100">
                      <img src={previas.get(f) || urlPublica(f)} alt="Foto da anotação" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setIt(p => ({ ...p, fotos: p.fotos.filter(x => x !== f) }))} aria-label="Tirar a foto"
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={arquivoRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFotos(e.target.files)} />
              <button type="button" className="h-10 px-3 rounded-lg border border-ink-300 text-ink-700 inline-flex items-center gap-2 active:bg-ink-50 disabled:opacity-60" disabled={enviando} onClick={() => arquivoRef.current?.click()}>
                <Camera size={17} />{enviando ? 'Enviando…' : it.fotos.length ? 'Mais fotos' : 'Fotos'}
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 pt-3 border-t border-ink-100" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          {!novo && <button className="h-12 px-4 rounded-xl border border-red-300 text-red-600 active:bg-red-50" onClick={tirar}>Excluir</button>}
          <button className="btn-primary flex-1 h-12 text-base" disabled={salvando || enviando} onClick={confirmar_}>{salvando ? 'Salvando…' : 'Salvar'}</button>
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
