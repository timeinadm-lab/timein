import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { recarregarParaVersaoNova, ehArquivoAntigo, registrarErroDeTela } from './lib/versaoNova'

// Se um arquivo do app falhar ao carregar (aba aberta antes de uma versão nova
// pedindo um JS que já não existe — ex. "Failed to fetch dynamically imported
// module" ao gerar PDF), recarrega buscando a versão nova. A trava é por tempo,
// não "uma vez por sessão": antes, depois do 1º recarregamento do dia, as
// versões seguintes davam erro (22/10/2026). Se falhar de novo em 30 s, não
// insiste (evita ficar recarregando sem parar) e o erro aparece normalmente.
window.addEventListener('vite:preloadError', (e) => {
  if (recarregarParaVersaoNova()) e.preventDefault()
})

// Erro que não é de tela (uma gravação que falhou, um botão que quebrou): fica registrado também
window.addEventListener('error', (e) => { if (e.error && !ehArquivoAntigo(e.error)) registrarErroDeTela(e.error, 'solto') })
window.addEventListener('unhandledrejection', (e) => {
  if (ehArquivoAntigo(e.reason)) { recarregarParaVersaoNova(); return }
  const m = String((e.reason as { message?: string })?.message || e.reason || '')
  if (m && !/abort|cancel/i.test(m)) registrarErroDeTela(e.reason, 'solto')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
