import { useEffect, useState } from 'react'
import { AlertTriangle, HelpCircle } from 'lucide-react'

/**
 * Janela de confirmação do próprio sistema. Substitui o window.confirm do
 * navegador — no celular aquela caixinha cinza parecia erro ou golpe, e não
 * dava para dizer o que cada botão fazia.
 *
 *   if (await confirmar({ titulo: 'Excluir registro?', perigo: true })) ...
 */
type Opcoes = {
  titulo: string
  texto?: string
  confirmar?: string
  cancelar?: string
  perigo?: boolean
}

type Pedido = Opcoes & { responder: (ok: boolean) => void }

let abrir: ((p: Pedido) => void) | null = null

export function confirmar(opcoes: Opcoes | string): Promise<boolean> {
  const o = typeof opcoes === 'string' ? { titulo: opcoes } : opcoes
  // Se a janela ainda não estiver montada, não trava a ação: cai no do navegador
  if (!abrir) return Promise.resolve(window.confirm([o.titulo, o.texto].filter(Boolean).join('\n\n')))
  return new Promise(resolve => abrir!({ ...o, responder: resolve }))
}

export function ConfirmHost() {
  const [pedido, setPedido] = useState<Pedido | null>(null)

  useEffect(() => {
    abrir = setPedido
    return () => { abrir = null }
  }, [])

  useEffect(() => {
    if (!pedido) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar(false)
      if (e.key === 'Enter') fechar(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!pedido) return null

  function fechar(ok: boolean) {
    pedido?.responder(ok)
    setPedido(null)
  }

  const Icone = pedido.perigo ? AlertTriangle : HelpCircle
  return (
    <div className="modal-overlay z-[70]" onClick={() => fechar(false)}>
      <div className="modal-box max-w-sm space-y-4" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${pedido.perigo ? 'bg-red-100' : 'bg-primary-50'}`}>
            <Icone size={22} className={pedido.perigo ? 'text-red-600' : 'text-primary-700'} />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="font-display font-bold text-lg text-ink-900 leading-snug">{pedido.titulo}</h3>
            {pedido.texto && <p className="text-sm text-ink-500 mt-1 whitespace-pre-line">{pedido.texto}</p>}
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
          <button className="btn-secondary flex-1" onClick={() => fechar(false)}>{pedido.cancelar || 'Cancelar'}</button>
          <button
            autoFocus
            className={`btn-primary flex-1 ${pedido.perigo ? 'bg-red-600 hover:bg-red-700 hover:shadow-none' : ''}`}
            onClick={() => fechar(true)}
          >
            {pedido.confirmar || (pedido.perigo ? 'Excluir' : 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  )
}
