import { Component, ReactNode } from 'react'

// Rede de segurança: se algo quebrar em runtime, mostra uma tela com botão de
// recarregar em vez de deixar a tela branca (que não diz nada ao usuário).
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Erro na aplicação:', error)
  }

  hardReload = () => {
    // Limpa caches e recarrega buscando a versão nova (evita HTML/JS velho no Safari)
    try {
      if ('caches' in window) caches.keys().then(ks => ks.forEach(k => caches.delete(k)))
    } catch { /* ignora */ }
    window.location.replace(window.location.pathname + '?v=' + Date.now())
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif', background: '#f6f7f6' }}>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1a1916', margin: '0 0 8px' }}>Algo deu errado ao abrir a tela</h1>
          <p style={{ fontSize: 14, color: '#78776f', margin: '0 0 20px', lineHeight: 1.5 }}>
            Toque no botão abaixo para recarregar. Se continuar, feche e abra o app de novo.
          </p>
          <button onClick={this.hardReload}
            style={{ background: '#1b8552', color: '#fff', border: 0, borderRadius: 12, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            Recarregar
          </button>
          <p style={{ fontSize: 11, color: '#a8a7a0', marginTop: 18, wordBreak: 'break-word' }}>{this.state.error.message}</p>
        </div>
      </div>
    )
  }
}
