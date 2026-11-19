// Versão nova publicada com a aba aberta (20/11/2026, Gabriel: "ainda apresenta
// muito bug, tipo 'tenta de novo', 'recarregar página'").
// Cada publicação troca o nome dos arquivos do sistema. A aba que já estava
// aberta pede o arquivo antigo, que não existe mais, e a tela caía no aviso de
// erro. Agora, quando o arquivo de uma tela não carrega, a página recarrega
// sozinha uma vez e a pessoa segue na tela que pediu, já na versão nova.
import { supabase } from './supabase'

const CHAVE = 'recarregou-em'

/** O erro é de arquivo do sistema que não carregou (versão antiga na aba)? */
export function ehArquivoAntigo(e: unknown): boolean {
  const m = String((e as { message?: string })?.message || e || '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch dynamically|ChunkLoadError|Unable to preload|expected a JavaScript.*module script|is not a valid JavaScript MIME type/i.test(m)
}

/** Recarrega buscando a versão nova. Devolve false se já recarregou há menos de 30 s (não insiste). */
export function recarregarParaVersaoNova(): boolean {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem(CHAVE)) || 0 } catch { /* sem armazenamento */ }
  if (Date.now() - ultima < 30_000) return false
  try { sessionStorage.setItem(CHAVE, String(Date.now())) } catch { /* sem armazenamento */ }
  window.location.reload()
  return true
}

/** Para usar no lazy(): tela que não carregou por ser de versão antiga recarrega a página. */
export function carregarTela<T>(importar: () => Promise<T>): Promise<T> {
  return importar().catch(async e => {
    // Uma segunda tentativa resolve oscilação de internet sem recarregar nada
    await new Promise(r => setTimeout(r, 600))
    try { return await importar() } catch { /* segue para recarregar */ }
    if (recarregarParaVersaoNova()) return new Promise<T>(() => { /* a página vai recarregar */ })
    throw e
  })
}

/**
 * Guarda o erro que apareceu na tela (migração 113) para dar para consertar sem
 * depender de print. Nunca atrapalha: se não conseguir gravar, fica por isso.
 */
export function registrarErroDeTela(e: unknown, onde: string) {
  try {
    const err = e as { message?: string; stack?: string }
    const chave = `erro:${onde}:${String(err?.message || e).slice(0, 80)}`
    if (sessionStorage.getItem(chave)) return          // o mesmo erro, uma vez por sessão
    sessionStorage.setItem(chave, '1')
    void supabase.from('erros_de_tela').insert({
      mensagem: String(err?.message || e).slice(0, 500),
      pilha: String(err?.stack || '').slice(0, 3000),
      rota: window.location.pathname,
      onde,
      navegador: navigator.userAgent.slice(0, 200),
      largura: window.innerWidth,
    }).then(() => { /* tanto faz */ }, () => { /* tanto faz */ })
  } catch { /* nunca atrapalha */ }
}
