import { useState, useEffect, useRef, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

export default function PaymentForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id

  const [form, setForm] = useState({
    description: '', amount: '', due_date: '', status: 'Pendente',
    recurrence: 'Único', category: 'Outro',
  })
  const [dataLoaded, setDataLoaded] = useState(!isEdit)

  // Preencher dentro do queryFn não funciona no cache-hit: com staleTime de
  // 30s, sair do formulário e voltar em seguida não roda o queryFn de novo, e
  // a tela abre em branco — salvar então grava vazio por cima do lançamento.
  const { data: paymentData } = useQuery({
    queryKey: ['payment', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
    enabled: isEdit,
  })

  const populated = useRef(false)
  useEffect(() => {
    if (!paymentData || populated.current) return
    populated.current = true
    const data = paymentData
    setForm({ description: data.description, amount: String(data.amount), due_date: data.due_date, status: data.status, recurrence: data.recurrence, category: data.category })
    setDataLoaded(true)
  }, [paymentData])

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (isEdit) {
        const { error } = await supabase.from('payments').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('payments').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Pagamento atualizado!' : 'Pagamento criado!')
      qc.invalidateQueries({ queryKey: ['payments'] })
      navigate('/pagamentos')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (isEdit && !dataLoaded) {
      toast.error('Os dados ainda não carregaram. Recarregue a página antes de salvar.')
      return
    }
    mutation.mutate({
      description: form.description, amount: Number(form.amount),
      due_date: form.due_date, status: form.status,
      recurrence: form.recurrence, category: form.category,
    })
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Pagamento' : 'Novo Pagamento'}</h1>
      </div>
      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div><label className="label">Descrição *</label><input className="input" required value={form.description} onChange={e => set('description', e.target.value)} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="label">Valor *</label><input className="input" type="number" step="0.01" required value={form.amount} onChange={e => set('amount', e.target.value)} /></div>
          <div><label className="label">Vencimento *</label><input className="input" type="date" required value={form.due_date} onChange={e => set('due_date', e.target.value)} /></div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
              <option>Pendente</option><option>Pago</option><option>Cancelado</option>
            </select>
          </div>
          <div>
            <label className="label">Recorrência</label>
            <select className="input" value={form.recurrence} onChange={e => set('recurrence', e.target.value)}>
              <option>Único</option><option>Mensal</option>
            </select>
          </div>
          <div className="col-span-full">
            <label className="label">Categoria</label>
            <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
              <option>Salário</option><option>Fornecedor</option><option>Imposto</option><option>Outro</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
