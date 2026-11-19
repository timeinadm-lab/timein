import { Component, ReactNode } from 'react'
import { ehArquivoAntigo, recarregarParaVersaoNova, registrarErroDeTela } from '../lib/versaoNova'

/**
 * Erro numa tela não derruba o sistema inteiro (18/11/2026, pedido do Gabriel:
 * "tem hora que parece que ele cai, tem que atualizar a página"). O menu e a
 * busca continuam; só a área da tela mostra o aviso, com "Tentar de novo".
 * Trocar de tela limpa o erro sozinho (a chave muda com o endereço).
 *
 * 20/11/2026: quando o erro é "versão nova publicada com a aba aberta", a página
 * recarrega sozinha em vez de mostrar o aviso. Os outros erros ficam gravados
 * (migração 113) para serem consertados.
 */
export class TelaComErro extends Component<{ chave: string; children: ReactNode }, { error: Error | null; recarregando: boolean }> {
  state = { error: null as Error | null, recarregando: false }

  static getDerivedStateFromError(error: Error) { return { error, recarregando: false } }

  componentDidCatch(error: Error) {
    console.error('Erro na tela:', error)
    if (ehArquivoAntigo(error)) {
      if (recarregarParaVersaoNova()) this.setState({ recarregando: true })
      return
    }
    registrarErroDeTela(error, 'tela')
  }

  componentDidUpdate(antes: { chave: string }) {
    if (antes.chave !== this.props.chave && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.state.recarregando) return <p className="text-sm text-ink-500 text-center mt-16">Atualizando para a versão nova…</p>
    const antigo = ehArquivoAntigo(this.state.error)
    return (
      <div className="card p-6 max-w-md mx-auto mt-10 text-center space-y-3">
        <p className="font-semibold text-ink-900">{antigo ? 'O sistema foi atualizado' : 'Esta tela não abriu direito'}</p>
        <p className="text-sm text-ink-500">
          {antigo ? 'Recarregue a página para usar a versão nova.' : 'O resto do sistema continua funcionando. Recarregue a página; se repetir, avise o Gabriel dizendo em qual tela foi.'}
        </p>
        <div className="flex gap-2 justify-center">
          <button className="btn-primary text-sm" onClick={() => window.location.reload()}>Recarregar a página</button>
          {!antigo && <button className="btn-secondary text-sm" onClick={() => this.setState({ error: null })}>Tentar de novo</button>}
        </div>
        {!antigo && <p className="text-[11px] text-ink-400 break-words">{this.state.error.message}</p>}
      </div>
    )
  }
}
