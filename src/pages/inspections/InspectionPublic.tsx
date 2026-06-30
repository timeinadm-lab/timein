import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDate, formatCurrency } from '../../lib/utils'
import toast from 'react-hot-toast'

interface InspectionData {
  link_id: string
  employee: { id: string; full_name: string; cpf?: string }
  client: { id: string; name: string }
  locations: { id: string; name: string; hourly_rate?: number }[]
}

export default function InspectionPublic() {
  const { token } = useParams<{ token: string }>()
  const [password, setPassword] = useState('')
  const [data, setData] = useState<InspectionData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ location_id: '', check_in: '', check_out: '', notes: '' })
  const [result, setResult] = useState<{ hours_worked: number; amount: number } | null>(null)
  const [history, setHistory] = useState<Record<string, unknown>[]>([])

  const authenticate = async () => {
    setLoading(true)
    setError('')
    try {
      const { data: res, error: err } = await supabase.rpc('get_inspection_data', {
        p_token: token,
        p_password: password,
      })
      if (err) throw err
      if (!res) { setError('Token ou senha inválidos'); return }
      setData(res as InspectionData)
      // Load history
      const { data: hist } = await supabase.rpc('get_my_inspections', { p_token: token, p_password: password })
      if (hist) setHistory(hist as Record<string, unknown>[])
    } catch {
      setError('Token ou senha inválidos. Verifique suas credenciais.')
    } finally {
      setLoading(false)
    }
  }

  const submit = async () => {
    if (!form.location_id || !form.check_in || !form.check_out) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }
    setLoading(true)
    try {
      const { data: res, error: err } = await supabase.rpc('submit_inspection', {
        p_token: token,
        p_password: password,
        p_location_id: form.location_id,
        p_check_in: form.check_in,
        p_check_out: form.check_out,
        p_notes: form.notes || null,
      })
      if (err) throw err
      setResult(res as { hours_worked: number; amount: number })
      setForm({ location_id: '', check_in: '', check_out: '', notes: '' })
      // Reload history
      const { data: hist } = await supabase.rpc('get_my_inspections', { p_token: token, p_password: password })
      if (hist) setHistory(hist as Record<string, unknown>[])
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">TI</div>
            <h1 className="text-2xl font-bold">Time IN — Vistoria</h1>
            <p className="text-gray-500 mt-1">Informe sua senha para continuar</p>
          </div>
          <div className="card p-6 space-y-4">
            <div>
              <label className="label">Senha</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && authenticate()}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full" onClick={authenticate} disabled={loading || !password}>
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-lg mx-auto mb-3">TI</div>
          <h1 className="text-xl font-bold">{data.employee.full_name}</h1>
          <p className="text-gray-500 text-sm">{data.client.name}</p>
        </div>

        {result && (
          <div className="card p-5 bg-green-50 border-green-200 text-center">
            <p className="text-green-700 font-semibold text-lg">Vistoria registrada!</p>
            <p className="text-green-600">Horas trabalhadas: <strong>{result.hours_worked}h</strong></p>
            {result.amount > 0 && <p className="text-green-600">Valor: <strong>{formatCurrency(result.amount)}</strong></p>}
          </div>
        )}

        <div className="card p-5 space-y-4">
          <h2 className="font-semibold">Registrar Vistoria</h2>
          <div>
            <label className="label">Local *</label>
            <select className="input" value={form.location_id} onChange={e => setForm(p => ({ ...p, location_id: e.target.value }))}>
              <option value="">Selecionar local...</option>
              {data.locations.map(l => (
                <option key={l.id} value={l.id}>{l.name}{l.hourly_rate ? ` — ${formatCurrency(l.hourly_rate)}/h` : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Check-in *</label><input className="input" type="datetime-local" value={form.check_in} onChange={e => setForm(p => ({ ...p, check_in: e.target.value }))} /></div>
            <div><label className="label">Check-out *</label><input className="input" type="datetime-local" value={form.check_out} onChange={e => setForm(p => ({ ...p, check_out: e.target.value }))} /></div>
          </div>
          <div><label className="label">Observações</label><textarea className="input" rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
          <button className="btn-primary w-full" onClick={submit} disabled={loading}>{loading ? 'Registrando...' : 'Registrar Vistoria'}</button>
        </div>

        {history.length > 0 && (
          <div className="card p-5">
            <h2 className="font-semibold mb-3">Últimas Vistorias</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-500 border-b"><th className="text-left py-1">Local</th><th>Entrada</th><th>Saída</th><th>Horas</th><th>Valor</th></tr></thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5">{String(h.location_name || '-')}</td>
                      <td className="text-center">{formatDate(h.check_in as string, 'dd/MM HH:mm')}</td>
                      <td className="text-center">{formatDate(h.check_out as string, 'HH:mm')}</td>
                      <td className="text-center">{String(h.hours_worked || 0)}h</td>
                      <td className="text-center">{formatCurrency(h.amount as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
