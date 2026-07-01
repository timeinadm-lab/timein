import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Download, AlertCircle, ChevronRight, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, getInitials } from '../../lib/utils'
import { SignedImage } from '../../components/ui/SignedFile'
import { exportToCSV } from '../../lib/exportUtils'
import Pagination from '../../components/ui/Pagination'

const FAVORITES_KEY = '__favorites__'

export default function EmployeeList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Ativo')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', search, status],
    queryFn: async () => {
      let q = supabase.from('employees').select('id,full_name,role,status,admission_date,photo_url,email,whatsapp,is_favorite')
      if (status === FAVORITES_KEY) {
        q = q.eq('is_favorite', true)
      } else {
        if (status) q = q.eq('status', status)
      }
      if (search) q = q.ilike('full_name', `%${search}%`)
      q = q.order('is_favorite', { ascending: false }).order('full_name')
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const { data: pendingDocs } = useQuery({
    queryKey: ['employees-pending-docs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_documents').select('employee_id').eq('status', 'Pendente')
      if (error) throw error
      return new Set(data?.map(d => d.employee_id) ?? [])
    },
  })

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from('employees').update({ is_favorite: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const paginated = employees?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []

  const handleExport = () => {
    if (!employees) return
    exportToCSV(employees.map(e => ({
      Nome: e.full_name,
      Cargo: e.role || '',
      Status: e.status,
      Admissão: formatDate(e.admission_date),
      Email: e.email || '',
      WhatsApp: e.whatsapp || '',
    })), 'colaboradores.csv')
  }

  const statusBadge = (s: string) =>
    s === 'Ativo' ? 'bg-primary-100 text-primary-700' : s === 'Ocioso' ? 'bg-amber-100 text-amber-700' : 'bg-ink-100 text-ink-600'

  const filterTabs = [
    { label: '⭐ Favoritos', value: FAVORITES_KEY },
    { label: 'Ativos', value: 'Ativo' },
    { label: 'Inativos', value: 'Inativo' },
    { label: 'Ociosos', value: 'Ocioso' },
    { label: 'Todos', value: '' },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Equipe</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">
            Colaboradores
            {employees && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{employees.length}</span>}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary text-sm"><Download size={16} />CSV</button>
          <button onClick={() => navigate('/colaboradores/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
        </div>
      </div>

      <div className="card p-3 flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9" placeholder="Buscar nome..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="flex gap-1 flex-wrap">
          {filterTabs.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setStatus(opt.value); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${status === opt.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
      ) : employees?.length === 0 ? (
        <div className="card p-12 text-center text-ink-400">
          <p className="font-medium">{status === FAVORITES_KEY ? 'Nenhum favorito ainda' : 'Nenhum colaborador encontrado'}</p>
          <p className="text-sm mt-1">{status === FAVORITES_KEY ? 'Clique na ⭐ de um colaborador para favoritá-lo.' : 'Ajuste os filtros ou cadastre um novo.'}</p>
        </div>
      ) : (
        <>
          <div className="hidden md:grid grid-cols-12 gap-3 px-4 pb-1 text-xs font-semibold text-ink-400 uppercase tracking-wide">
            <div className="col-span-5">Colaborador</div>
            <div className="col-span-3">Cargo</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Admissão</div>
          </div>

          <div className="space-y-2">
            {paginated.map(e => {
              const isFav = !!(e as { is_favorite?: boolean }).is_favorite
              return (
                <div
                  key={e.id}
                  onClick={() => navigate(`/colaboradores/${e.id}`)}
                  className="card card-interactive p-3 md:px-4 md:py-3 grid grid-cols-[auto_1fr_auto] md:grid-cols-12 md:items-center gap-x-3 gap-y-2"
                >
                  {/* Avatar */}
                  <div className="md:col-span-5 flex items-center gap-3 min-w-0 row-start-1">
                    {e.photo_url ? (
                      <SignedImage value={e.photo_url} bucket="fotos de funcionários" alt={e.full_name} className="w-10 h-10 rounded-full object-cover flex-shrink-0 ring-2 ring-white shadow-soft"
                        fallback={<div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-bold flex-shrink-0">{getInitials(e.full_name)}</div>} />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-bold flex-shrink-0">
                        {getInitials(e.full_name)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink-900 truncate">{e.full_name}</span>
                        {pendingDocs?.has(e.id) && <AlertCircle size={14} className="text-red-500 shrink-0" />}
                      </div>
                      <span className="md:hidden text-xs text-ink-400">{e.role || 'Sem cargo'}</span>
                    </div>
                  </div>

                  {/* Cargo — desktop */}
                  <div className="hidden md:block md:col-span-3 text-sm text-ink-600 truncate">{e.role || '-'}</div>

                  {/* Status */}
                  <div className="md:col-span-2 row-start-1 md:row-auto col-start-3 md:col-auto justify-self-end md:justify-self-start">
                    <span className={`badge ${statusBadge(e.status)}`}>{e.status}</span>
                  </div>

                  {/* Admissão + estrela + chevron */}
                  <div className="md:col-span-2 flex items-center justify-between md:justify-start gap-2 col-span-3 md:col-auto text-sm text-ink-400">
                    <span>{formatDate(e.admission_date)}</span>
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        onClick={ev => { ev.stopPropagation(); toggleFavorite.mutate({ id: e.id, val: !isFav }) }}
                        className={`p-1 rounded-full transition-colors ${isFav ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
                        title={isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                      >
                        <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
                      </button>
                      <ChevronRight size={16} className="text-ink-300" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <Pagination page={page} total={employees?.length ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  )
}
