import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// Se um arquivo do app falhar ao carregar (aba aberta antes de uma versão nova
// pedindo um JS que já não existe — ex. "Failed to fetch dynamically imported
// module" ao gerar PDF), recarrega buscando a versão nova. A trava é por tempo,
// não "uma vez por sessão": antes, depois do 1º recarregamento do dia, as
// versões seguintes davam erro (22/10/2026). Se falhar de novo em 30 s, não
// insiste (evita ficar recarregando sem parar) e o erro aparece normalmente.
window.addEventListener('vite:preloadError', (e) => {
  let ultima = 0
  try { ultima = Number(sessionStorage.getItem('recarregou-em')) || 0 } catch { /* sem storage */ }
  if (Date.now() - ultima < 30_000) return
  try { sessionStorage.setItem('recarregou-em', String(Date.now())) } catch { /* sem storage */ }
  e.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
