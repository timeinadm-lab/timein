import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Building2, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { formatDate, daysUntil } from '../../lib/utils'
import Pagination from '../../components/ui/Pagination'
import DeletePinModal from '../../components/ui/DeletePinModal'
import { SkeletonCards, EmptyState } from '../../components/ui/Skeleton'
import toast from 'react-hot-toast'

export default function ClientList() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const PAGE_SIZE = 12

  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients', search],
    queryFn: async () => {
      let q = supabase.from('clients').select('*,supervisor:user_profiles(full_name)').order('name')
      if (search) q = q.ilike('name', `%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const deleteClient = useMutation({
    mutationFn: async (clientId: string) => {
      // Trava: não apaga cliente com vínculo ou vaga
      const { data: linksData } = await supabase.from('employee_client_links').select('id').eq('client_id', clientId).limit(1)
      if (linksData?.length) throw new Error('Este cliente tem colaboradores vinculados. Desligue-os antes de excluir.')
      const { data: vagasData } = await supabase.from('vacancies').select('id').eq('client_id', clientId).limit(1)
      if (vagasData?.length) throw new Error('Este cliente tem vagas. Apague as vagas antes de excluir o cliente.')
      await supabase.from('client_units').delete().eq('client_id', clientId)
      await supabase.from('client_locations').delete().eq('client_id', clientId)
      await supabase.from('client_contracts').delete().eq('client_id', clientId)
      await supabase.from('shared_documents').delete().eq('client_id', clientId)
      const { error } = await supabase.from('clients').delete().eq('id', clientId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Cliente excluído.')
      qc.invalidateQueries({ queryKey: ['clients'] })
      setConfirmDelete(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const paginated = clients?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Carteira</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">
            Clientes
            {clients && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{clients.length}</span>}
          </h1>
        </div>
        {role === 'chefe' && (
          <button onClick={() => navigate('/clientes/novo')} className="btn-primary text-sm">
            <Plus size={16} /> Novo Cliente
          </button>
        )}
      </div>

      <div className="card p-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por nome..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
      </div>

      {isLoading ? (
        <SkeletonCards count={6} cols={3} />
      ) : clients?.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum cliente encontrado"
          hint={search ? 'Tente buscar por outro nome.' : 'Cadastre seu primeiro cliente para começar a abrir vagas.'}
          actionLabel={role === 'chefe' && !search ? '+ Novo Cliente' : undefined}
          onAction={role === 'chefe' && !search ? () => navigate('/clientes/novo') : undefined}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map(c => {
              const days = daysUntil(c.contract_end)
              return (
                <div
                  key={c.id}
                  className="card card-interactive p-5 relative"
                  onClick={() => navigate(`/clientes/${c.id}`)}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: c.id, name: c.name }) }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg text-ink-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Excluir cliente"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <Building2 size={20} className="text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0 pr-6">
                      <h3 className="font-display font-bold text-ink-900 truncate">{c.name}</h3>
                      {c.contact_name && <p className="text-sm text-ink-500 truncate">{c.contact_name}</p>}
                      {c.contact_phone && <p className="text-sm text-ink-400">{c.contact_phone}</p>}
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-ink-100 flex items-center justify-between text-xs text-ink-500">
                    <span>{c.contract_end ? `Vigência até ${formatDate(c.contract_end)}` : 'Contrato indeterminado'}</span>
                    {c.contract_end && days !== null && (
                      <span className={`badge ${days < 0 ? 'bg-red-100 text-red-700' : days <= 15 ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>
                        {days < 0 ? 'Vencido' : days === 0 ? 'Vence hoje' : `${days}d`}
                      </span>
                    )}
                    {!c.contract_end && <span className="badge bg-gray-100 text-gray-500">Indeterminado</span>}
                  </div>
                  {c.positions_count && (
                    <p className="text-xs text-ink-400 mt-1.5">{c.positions_count} posições</p>
                  )}
                </div>
              )
            })}
          </div>
          {(clients?.length ?? 0) > PAGE_SIZE && (
            <div className="card">
              <Pagination page={page} total={clients?.length ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
            </div>
          )}
        </>
      )}

      <DeletePinModal
        open={!!confirmDelete}
        title="Excluir cliente?"
        description={confirmDelete ? `Remove ${confirmDelete.name} e seus dados (unidades, contratos, documentos). Só é possível se não houver colaboradores nem vagas vinculados.` : ''}
        confirmLabel="Excluir cliente"
        onConfirmed={async () => { if (confirmDelete) await deleteClient.mutateAsync(confirmDelete.id) }}
        onClose={() => setConfirmDelete(null)}
      />
    </div>
  )
}
