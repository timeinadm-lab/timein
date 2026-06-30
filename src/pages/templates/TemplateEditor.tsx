import { useState, FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

const VARIABLES = [
  '{{NOME_COLABORADOR}}', '{{CPF}}', '{{CLIENTE}}',
  '{{DATA_INICIO}}', '{{DATA_FIM}}', '{{VALOR_MENSAL}}', '{{CARGO}}',
]

export default function TemplateEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!id
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  useQuery({
    queryKey: ['template', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('contract_templates').select('*').eq('id', id).single()
      if (error) throw error
      setName(data.name)
      setContent(data.content)
      return data
    },
    enabled: isEdit,
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit) {
        const { error } = await supabase.from('contract_templates').update({ name, content }).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('contract_templates').insert({ name, content })
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast.success('Template salvo!')
      qc.invalidateQueries({ queryKey: ['contract-templates'] })
      navigate('/templates')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const copyVariable = (v: string) => {
    navigator.clipboard.writeText(v)
    toast.success('Variável copiada!')
  }

  const handleSubmit = (e: FormEvent) => { e.preventDefault(); mutation.mutate() }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost p-2"><ArrowLeft size={18} /></button>
        <h1 className="text-xl font-bold">{isEdit ? 'Editar Template' : 'Novo Template'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-4">
        <div className="flex-1 space-y-4">
          <div className="card p-5">
            <label className="label">Nome do Template *</label>
            <input className="input" required value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="card p-5">
            <label className="label">Conteúdo</label>
            <textarea
              className="input font-mono text-xs"
              rows={20}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Digite o conteúdo do contrato aqui..."
            />
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar'}</button>
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancelar</button>
          </div>
        </div>

        {/* Variables panel */}
        <div className="w-48 flex-shrink-0">
          <div className="card p-4 sticky top-4">
            <h3 className="text-sm font-medium mb-3">Variáveis</h3>
            <p className="text-xs text-gray-400 mb-3">Clique para copiar:</p>
            <div className="space-y-1">
              {VARIABLES.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => copyVariable(v)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-primary-50 hover:text-primary-700 font-mono flex items-center gap-1"
                >
                  <Copy size={10} />
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
