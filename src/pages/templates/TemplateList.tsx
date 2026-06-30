import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Copy, Trash2, Edit } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'

export default function TemplateList() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: templates, isLoading } = useQuery({
    queryKey: ['contract-templates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('contract_templates').select('*').order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const t = templates?.find(t => t.id === id)
      if (!t) return
      const { error } = await supabase.from('contract_templates').insert({ name: t.name + ' (cópia)', content: t.content })
      if (error) throw error
    },
    onSuccess: () => { toast.success('Template duplicado!'); qc.invalidateQueries({ queryKey: ['contract-templates'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contract_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Template excluído!'); qc.invalidateQueries({ queryKey: ['contract-templates'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Documentos</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">Templates de Contrato</h1>
        </div>
        <button onClick={() => navigate('/templates/novo')} className="btn-primary text-sm"><Plus size={16} />Novo Template</button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {templates?.map(t => (
            <div key={t.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-gray-400">Atualizado em {formatDate(t.updated_at)}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => navigate(`/templates/${t.id}/editar`)} className="btn-ghost p-2"><Edit size={16} /></button>
                <button onClick={() => duplicate.mutate(t.id)} className="btn-ghost p-2"><Copy size={16} /></button>
                <button onClick={() => { if (confirm('Excluir template?')) deleteTemplate.mutate(t.id) }} className="btn-ghost p-2 text-red-400"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
          {templates?.length === 0 && <div className="px-5 py-8 text-center text-gray-400">Nenhum template cadastrado</div>}
        </div>
      )}
    </div>
  )
}
