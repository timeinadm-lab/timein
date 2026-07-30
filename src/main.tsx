import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'

// Se um arquivo do app falhar ao carregar (HTML velho em cache pedindo um JS que
// já não existe — clássico no Safari), recarrega uma vez buscando a versão nova.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('reloaded-once')) {
    sessionStorage.setItem('reloaded-once', '1')
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
