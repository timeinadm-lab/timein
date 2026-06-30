import { useState } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

/**
 * Modal de confirmação por PIN para ações destrutivas (apagar vaga/colaborador/cliente).
 * O PIN é definido pelo chefe em Usuários e validado no servidor (verify_delete_pin).
 * Só chama onConfirmed() quando o PIN está correto.
 */
export default function DeletePinModal({
  open,
  title,
  description,
  confirmLabel = 'Excluir',
  onConfirmed,
  onClose,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  onConfirmed: () => void | Promise<void>
  onClose: () => void
}) {
  const [pin, setPin] = useState('')
  const [checking, setChecking] = useState(false)
  if (!open) return null

  const submit = async () => {
    if (!pin.trim() || checking) return
    setChecking(true)
    try {
      const { data, error } = await supabase.rpc('verify_delete_pin', { p_pin: pin })
      if (error) { toast.error(error.message); return }
      if (!data) { toast.error('PIN incorreto. Solicite o PIN ao chefe.'); return }
      setPin('')
      await onConfirmed()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-lift p-6 max-w-sm w-full space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
            <ShieldAlert size={22} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-bold text-lg text-ink-900">{title}</h3>
            {description && <p className="text-sm text-ink-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="text-ink-300 hover:text-ink-600 shrink-0"><X size={18} /></button>
        </div>
        <div>
          <label className="label">PIN de exclusão</label>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            className="input text-center tracking-[0.4em] text-lg"
            placeholder="••••"
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
          />
          <p className="text-xs text-ink-400 mt-1.5">Esta ação não pode ser desfeita. O PIN é definido pelo chefe em Usuários.</p>
        </div>
        <div className="flex gap-3">
          <button className="btn-primary flex-1 bg-red-600 hover:bg-red-700" disabled={!pin.trim() || checking} onClick={submit}>
            {checking ? 'Verificando…' : confirmLabel}
          </button>
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
