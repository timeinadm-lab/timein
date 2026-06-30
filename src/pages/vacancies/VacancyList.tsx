import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MapPin, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, BRAZIL_STATES } from '../../lib/utils'
import Pagination from '../../components/ui/Pagination'
import DeletePinModal from '../../components/ui/DeletePinModal'
import toast from 'react-hot-toast'

export default function VacancyList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterState, setFilterState] = useState('')
  const [page, setPage] = useState(1)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)
  const [confirmDeleteText, setConfirmDeleteText] = useState('')
  const PAGE_SIZE = 12

  const { data: vacancies, isLoading } = useQuery({
    queryKey: ['vacancies', search, filterStatus, filterState],
    queryFn: async () => {
      let q = supabase.from('vacancies').select('*,client:clients(name)').order('created_at', { ascending: false })
      if (filterStatus) q = q.eq('status', filterStatus)
      if (filterState) q = q.eq('state', filterState)
      if (search) q = q.ilike('title', `%${search}%`)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const deleteVacancy = useMutation({
    mutationFn: async (id: string) => {
      // Busca o client_id da vaga antes de excluir
      const { data: vacancy } = await supabase.from('vacancies').select('client_id').eq('id', id).single()

      if (vacancy?.client_id) {
        // Encontra os colaboradores contratados por esta vaga (vacancy_interests.employee_id é preenchido na contratação)
        const { data: hired } = await supabase
          .from('vacancy_interests')
          .select('employee_id')
          .eq('vacancy_id', id)
          .eq('status', 'Contratado')
          .not('employee_id', 'is', null)

        for (const row of hired || []) {
          const empId = (row as { employee_id?: string }).employee_id
          if (!empId) continue

          // Remove o vínculo deste colaborador com o cliente desta vaga
          await supabase.from('employee_client_links').delete()
            .eq('employee_id', empId)
            .eq('client_id', vacancy.client_id)

          // Se não restar nenhum outro vínculo, torna o colaborador Inativo
          const { data: remaining } = await supabase
            .from('employee_client_links').select('id').eq('employee_id', empId).limit(1)
          if (!remaining?.length) {
            // Tenta 'Inativo' (requer migration_011); se constraint rejeitar, usa 'Desligado'
            const { error: stErr } = await supabase.from('employees').update({ status: 'Inativo' }).eq('id', empId)
            if (stErr) await supabase.from('employees').update({ status: 'Desligado' }).eq('id', empId)
          }
        }
      }

      const { error } = await supabase.from('vacancies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Vaga excluída!'); qc.invalidateQueries({ queryKey: ['vacancies'] }); qc.invalidateQueries({ queryKey: ['employees'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const paginated = vacancies?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []

  return (
    <div className="space-y-4">
      {/* Modal: Excluir vaga — exige PIN */}
      <DeletePinModal
        open={!!confirmDelete}
        title="Excluir vaga?"
        description={confirmDelete ? `"${confirmDelete.title}" e todo o histórico de candidatos e contratações serão apagados.` : undefined}
        confirmLabel="Excluir vaga"
        onConfirmed={async () => { if (confirmDelete) await deleteVacancy.mutateAsync(confirmDelete.id) }}
        onClose={() => setConfirmDelete(null)}
      />
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Recrutamento</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">
            Vagas
            {vacancies && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{vacancies.length}</span>}
          </h1>
        </div>
        <button onClick={() => navigate('/vagas/nova')} className="btn-primary text-sm"><Plus size={16} />Nova Vaga</button>
      </div>

      <div className="card p-3 flex gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input w-36 shrink-0" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
          <option value="">Todos status</option>
          <option>Aberta</option><option>Atuando</option><option>Preenchida</option><option>Fechada</option><option>Pausada</option>
        </select>
        <select className="input w-32 shrink-0" value={filterState} onChange={e => { setFilterState(e.target.value); setPage(1) }}>
          <option value="">Todos estados</option>
          {BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
      ) : vacancies?.length === 0 ? (
        <div className="card p-12 text-center text-ink-400">
          <Search size={32} className="mx-auto mb-3 text-ink-200" />
          <p className="font-medium">Nenhuma vaga encontrada</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map(v => (
              <div key={v.id} className="card card-interactive p-5 flex flex-col">
                <div className="flex items-start justify-between cursor-pointer" onClick={() => navigate(`/vagas/${v.id}`)}>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-ink-900 truncate">{v.title}</h3>
                    {(v as { client?: { name: string } }).client?.name && <p className="text-xs text-ink-500 mt-0.5">{(v as { client?: { name: string } }).client?.name}</p>}
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <span className={`badge ${v.status === 'Aberta' ? 'bg-primary-100 text-primary-700' : v.status === 'Atuando' ? 'bg-blue-100 text-blue-700' : v.status === 'Preenchida' ? 'bg-purple-100 text-purple-700' : v.status === 'Pausada' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-600'}`}>
                      {v.status === 'Atuando' ? '● Atuando' : v.status}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteText(''); setConfirmDelete({ id: v.id, title: v.title }) }}
                      className="p-1 text-ink-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-2 text-xs text-ink-500">
                  <MapPin size={12} />
                  <span>{v.city}, {v.state}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {v.requires_crn && <span className="badge bg-blue-50 text-blue-600">CRN</span>}
                  {v.requires_vehicle && <span className="badge bg-purple-50 text-purple-600">Veículo</span>}
                  {v.requires_travel && <span className="badge bg-amber-50 text-amber-600">Viagens</span>}
                  {v.requires_relocation && <span className="badge bg-red-50 text-red-600">Mudança</span>}
                </div>
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-ink-100 text-xs text-ink-400">
                  <span>{v.positions_count || 1} posição(ões)</span>
                  {v.deadline && <span>Prazo {formatDate(v.deadline)}</span>}
                </div>
              </div>
            ))}
          </div>
          {(vacancies?.length ?? 0) > PAGE_SIZE && (
            <div className="card"><Pagination page={page} total={vacancies?.length ?? 0} pageSize={PAGE_SIZE} onChange={setPage} /></div>
          )}
        </>
      )}
    </div>
  )
}
