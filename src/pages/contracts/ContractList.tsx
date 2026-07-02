import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, daysUntil } from '../../lib/utils'
import Pagination from '../../components/ui/Pagination'

export default function ContractList() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterSigned, setFilterSigned] = useState('')
  const PAGE_SIZE = 20

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts', search, filterSigned],
    queryFn: async () => {
      let q = supabase.from('contracts').select('*,supervisor:user_profiles(full_name)').order('created_at', { ascending: false })
      if (search) q = q.ilike('client_name', `%${search}%`)
      if (filterSigned === 'sim') q = q.eq('signed', true)
      if (filterSigned === 'nao') q = q.eq('signed', false)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const paginated = contracts?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Contratos</h1>
        <button onClick={() => navigate('/contratos/novo')} className="btn-primary flex items-center gap-2"><Plus size={16} />Novo Contrato</button>
      </div>

      <div className="card p-4 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Buscar cliente..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input w-40" value={filterSigned} onChange={e => setFilterSigned(e.target.value)}>
          <option value="">Assinatura: Todos</option>
          <option value="sim">Assinado</option>
          <option value="nao">Não assinado</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
      ) : (
        <>
        {/* Mobile: cards empilhados */}
        <div className="md:hidden space-y-3">
          {paginated.map(c => {
            const days = daysUntil(c.end_date)
            return (
              <div key={c.id} className="card card-interactive p-4" onClick={() => navigate(`/contratos/${c.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink-900 flex-1 min-w-0 truncate">{c.client_name || '-'}</p>
                  <span className={`badge flex-shrink-0 ${c.signed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {c.signed ? 'Assinado' : 'Pendente'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-ink-500">
                  <span className="badge bg-gray-100 text-gray-700">{c.type}</span>
                  <span>{formatDate(c.start_date)} → {formatDate(c.end_date)}</span>
                  {days !== null && (
                    <span className={`badge ${days < 0 ? 'bg-red-100 text-red-700' : days <= 15 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {days < 0 ? 'Vencido' : `${days}d`}
                    </span>
                  )}
                </div>
                {(c as { supervisor?: { full_name: string } }).supervisor?.full_name && (
                  <p className="text-xs text-ink-400 mt-1">Supervisor: {(c as { supervisor?: { full_name: string } }).supervisor!.full_name}</p>
                )}
              </div>
            )
          })}
          {contracts?.length === 0 && <div className="card text-center py-8 text-gray-400">Nenhum contrato encontrado</div>}
          {(contracts?.length ?? 0) > PAGE_SIZE && (
            <div className="card"><Pagination page={page} total={contracts?.length ?? 0} pageSize={PAGE_SIZE} onChange={setPage} /></div>
          )}
        </div>

        {/* Desktop: tabela */}
        <div className="hidden md:block card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">CLIENTE</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">TIPO</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">INÍCIO</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">FIM</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">ASSINATURA</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">SUPERVISOR</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.map(c => {
                const days = daysUntil(c.end_date)
                return (
                  <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/contratos/${c.id}`)}>
                    <td className="px-4 py-3 font-medium">{c.client_name || '-'}</td>
                    <td className="px-4 py-3"><span className="badge bg-gray-100 text-gray-700">{c.type}</span></td>
                    <td className="px-4 py-3">{formatDate(c.start_date)}</td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1">
                        {formatDate(c.end_date)}
                        {days !== null && (
                          <span className={`badge ml-1 ${days < 0 ? 'bg-red-100 text-red-700' : days <= 15 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                            {days < 0 ? 'Vencido' : `${days}d`}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${c.signed ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.signed ? 'Assinado' : 'Pendente'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{(c as { supervisor?: { full_name: string } }).supervisor?.full_name || '-'}</td>
                    <td className="px-4 py-3">
                      <button className="btn-ghost text-xs" onClick={e => { e.stopPropagation(); navigate(`/contratos/${c.id}/editar`) }}>Editar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination page={page} total={contracts?.length ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
          {contracts?.length === 0 && <div className="text-center py-8 text-gray-400">Nenhum contrato encontrado</div>}
        </div>
        </>
      )}
    </div>
  )
}
