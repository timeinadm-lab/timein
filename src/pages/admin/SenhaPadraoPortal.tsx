import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { confirmar } from '../../components/ui/ConfirmDialog'

/**
 * Senha padrão do portal da nutricionista (migração 054). Quem não tem senha
 * própria entra com ela. Guardada só como hash no banco — por isso a tela não
 * consegue mostrar a senha atual, só se ela está definida.
 */
export default function SenhaPadraoPortal() {
  const qc = useQueryClient()
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [ver, setVer] = useState(false)
  const [aplicarATodos, setAplicarATodos] = useState(false) // desmarcado: as nutris trocam a própria senha (069)

  const { data: status, error: erroStatus } = useQuery({
    queryKey: ['senha-padrao-portal'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('rh_senha_padrao_status')
      if (error) throw error
      return data as { definida: boolean; atualizada_em: string | null; com_senha_propria: number } | null
    },
    retry: false,
  })

  const salvar = useMutation({
    mutationFn: async () => {
      const s = senha.trim()
      if (s.length < 6) throw new Error('A senha precisa de pelo menos 6 caracteres')
      if (s !== confirma.trim()) throw new Error('As duas senhas não são iguais')
      const ok = await confirmar({
        titulo: status?.definida ? 'Trocar a senha padrão do portal?' : 'Definir a senha padrão do portal?',
        texto: aplicarATodos
          ? `Todas as nutricionistas vão entrar com a senha nova.${(status?.com_senha_propria ?? 0) > 0 ? ` As ${status!.com_senha_propria} senhas próprias existentes deixam de valer.` : ''} Quem estiver com o portal aberto vai precisar entrar de novo.`
          : 'Vale para quem não tem senha própria. Quem tem senha própria continua com ela.',
        confirmar: 'Salvar senha',
      })
      if (!ok) return false
      const { data, error } = await supabase.rpc('rh_definir_senha_padrao', { p_pin: s, p_aplicar_a_todos: aplicarATodos })
      if (error) throw error
      return data
    },
    onSuccess: (res) => {
      if (res === false) return
      toast.success('Senha padrão do portal salva')
      setSenha(''); setConfirma('')
      qc.invalidateQueries({ queryKey: ['senha-padrao-portal'] })
      qc.invalidateQueries({ queryKey: ['portal-tem-senha'] })
      qc.invalidateQueries({ queryKey: ['portal-tipo-senha'] })
    },
    onError: (e: Error) => toast.error(/rh_definir_senha_padrao|function/i.test(e.message)
      ? 'Falta rodar a migração 054 no Supabase.'
      : e.message),
  })

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-ink-100 flex items-center justify-center shrink-0">
          <KeyRound size={18} className="text-ink-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="section-title">Senha padrão do portal</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            A senha que as nutricionistas usam para entrar no portal (CPF + senha).
            Para dar uma senha diferente a uma pessoa, use a ficha dela, aba Portal.
          </p>
        </div>
        {status?.definida && <span className="badge bg-green-50 text-green-700">Definida</span>}
      </div>

      {erroStatus ? (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Falta rodar a migração 054 no Supabase para usar a senha padrão.</p>
      ) : status && (
        <p className="text-xs text-ink-500">
          {status.definida
            ? <>Última troca em {status.atualizada_em ? formatDate(status.atualizada_em.slice(0, 10)) : '—'}. </>
            : <>Ainda não há senha padrão. </>}
          {status.com_senha_propria > 0
            ? `${status.com_senha_propria} pessoa${status.com_senha_propria > 1 ? 's têm' : ' tem'} senha própria.`
            : 'Ninguém tem senha própria: todas usam a padrão.'}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">{status?.definida ? 'Nova senha padrão' : 'Senha padrão'}</label>
          <div className="relative">
            <input type={ver ? 'text' : 'password'} className="input pr-10" autoComplete="new-password"
              value={senha} onChange={e => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
            <button type="button" onClick={() => setVer(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-400 hover:text-ink-700"
              aria-label={ver ? 'Esconder senha' : 'Mostrar senha'} tabIndex={-1}>
              {ver ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <label className="label">Repita a senha</label>
          <input type={ver ? 'text' : 'password'} className="input" autoComplete="new-password"
            value={confirma} onChange={e => setConfirma(e.target.value)} />
        </div>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer select-none">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300 text-primary-700 focus:ring-primary-600"
          checked={aplicarATodos} onChange={e => setAplicarATodos(e.target.checked)} />
        <span>
          Aplicar a todas
          <span className="block text-xs text-ink-400">Quem tinha senha própria passa a usar a padrão.</span>
        </span>
      </label>

      <button className="btn-primary text-sm" disabled={salvar.isPending || !senha || !confirma} onClick={() => salvar.mutate()}>
        {salvar.isPending ? 'Salvando…' : status?.definida ? 'Trocar senha padrão' : 'Definir senha padrão'}
      </button>
    </div>
  )
}
