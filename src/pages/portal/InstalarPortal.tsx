import { useState } from 'react'
import { Smartphone, X, Share, PlusSquare, MoreVertical } from 'lucide-react'

type Convite = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

// Já está aberto como app (atalho na tela de início)?
export const abertoComoApp = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/**
 * "Instalar no celular": coloca o portal na tela de início como um app.
 * Android (Chrome) instala direto pelo convite do navegador; no iPhone não
 * existe esse convite, então mostra o passo a passo do Safari.
 */
export default function InstalarPortal({ variante = 'link' }: { variante?: 'link' | 'cartao' }) {
  const [ajuda, setAjuda] = useState(false)
  if (abertoComoApp()) return null
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent)

  const instalar = async () => {
    const convite = (window as { __convitePortal?: Convite }).__convitePortal
    if (convite) {
      await convite.prompt()
      await convite.userChoice.catch(() => null)
      ;(window as { __convitePortal?: Convite }).__convitePortal = undefined
      return
    }
    setAjuda(true)
  }

  return (
    <>
      {variante === 'cartao' ? (
        <button type="button" onClick={instalar}
          className="card w-full p-4 flex items-center gap-3 text-left active:bg-ink-50">
          <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center shrink-0"><Smartphone size={18} /></span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink-900">Instalar no celular</span>
            <span className="block text-xs text-ink-500">Deixe o portal na tela de início, como um app.</span>
          </span>
        </button>
      ) : (
        <button type="button" onClick={instalar}
          className="w-full flex items-center justify-center gap-2 text-sm font-medium text-white/90 py-2.5 active:opacity-70">
          <Smartphone size={16} /> Instalar no celular
        </button>
      )}

      {ajuda && (
        <div className="modal-overlay" onClick={() => setAjuda(false)}>
          <div className="modal-box max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-lg text-ink-900">Instalar no celular</h3>
              <button type="button" onClick={() => setAjuda(false)} aria-label="Fechar" className="p-2 -mr-2 -mt-1 rounded-full text-ink-400 active:bg-ink-100"><X size={20} /></button>
            </div>
            {iphone ? (
              <ol className="space-y-3 text-sm text-ink-700">
                <li className="flex gap-3"><span className="font-semibold text-ink-900">1.</span><span>Abra o portal no <strong>Safari</strong>.</span></li>
                <li className="flex gap-3"><span className="font-semibold text-ink-900">2.</span><span className="flex items-center gap-1 flex-wrap">Toque em <Share size={16} className="text-primary-700" /> <strong>Compartilhar</strong> (na barra de baixo).</span></li>
                <li className="flex gap-3"><span className="font-semibold text-ink-900">3.</span><span className="flex items-center gap-1 flex-wrap">Escolha <PlusSquare size={16} className="text-primary-700" /> <strong>Adicionar à Tela de Início</strong> e toque em <strong>Adicionar</strong>.</span></li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm text-ink-700">
                <li className="flex gap-3"><span className="font-semibold text-ink-900">1.</span><span>Abra o portal no <strong>Chrome</strong>.</span></li>
                <li className="flex gap-3"><span className="font-semibold text-ink-900">2.</span><span className="flex items-center gap-1 flex-wrap">Toque em <MoreVertical size={16} className="text-primary-700" /> (canto de cima).</span></li>
                <li className="flex gap-3"><span className="font-semibold text-ink-900">3.</span><span>Escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</span></li>
              </ol>
            )}
            <p className="text-xs text-ink-500">Pronto: o ícone <strong>Portal TIN</strong> fica na tela de início e abre direto no portal.</p>
            <button type="button" className="btn-primary w-full py-3" onClick={() => setAjuda(false)}>Entendi</button>
          </div>
        </div>
      )}
    </>
  )
}
