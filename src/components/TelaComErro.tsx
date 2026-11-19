import { Component, ReactNode } from 'react'

/**
 * Erro numa tela não derruba o sistema inteiro (18/11/2026, pedido do Gabriel:
 * "tem hora que parece que ele cai, tem que atualizar a página"). O menu e a
 * busca continuam; só a área da tela mostra o aviso, com "Tentar de novo".
 * Trocar de tela limpa o erro sozinho (a chave muda com o endereço).
 */
export class TelaComErro extends Component<{ chave: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error) { console.error('Erro na tela:', error) }

  componentDidUpdate(antes: { chave: string }) {
    if (antes.chave !== this.props.chave && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card p-6 max-w-md mx-auto mt-10 text-center space-y-3">
        <p className="font-semibold text-ink-900">Esta tela não abriu direito</p>
        <p className="text-sm text-ink-500">O resto do sistema continua funcionando. Tente de novo; se repetir, recarregue a página.</p>
        <div className="flex gap-2 justify-center">
          <button className="btn-primary text-sm" onClick={() => this.setState({ error: null })}>Tentar de novo</button>
          <button className="btn-secondary text-sm" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
        <p className="text-[11px] text-ink-400 break-words">{this.state.error.message}</p>
      </div>
    )
  }
}
