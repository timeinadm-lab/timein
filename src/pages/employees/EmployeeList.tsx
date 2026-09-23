import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Download, AlertCircle, ChevronRight, Star, X, MessageCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate, getInitials, hojeISO, semAcento, formatWhatsApp } from '../../lib/utils'
import { SignedImage } from '../../components/ui/SignedFile'
import { exportToCSV } from '../../lib/exportUtils'
import Pagination from '../../components/ui/Pagination'
import { SkeletonRows, EmptyState } from '../../components/ui/Skeleton'

const FAVORITES_KEY = '__favorites__'
const ACTING_KEY = '__acting__'

// UF pela faixa de CEP (padrão dos Correios) — permite filtrar por estado
// mesmo quando só o CEP foi cadastrado
const CEP_UF: [number, number, string][] = [
  [1000, 19999, 'SP'], [20000, 28999, 'RJ'], [29000, 29999, 'ES'], [30000, 39999, 'MG'],
  [40000, 48999, 'BA'], [49000, 49999, 'SE'], [50000, 56999, 'PE'], [57000, 57999, 'AL'],
  [58000, 58999, 'PB'], [59000, 59999, 'RN'], [60000, 63999, 'CE'], [64000, 64999, 'PI'],
  [65000, 65999, 'MA'], [66000, 68899, 'PA'], [68900, 68999, 'AP'], [69000, 69299, 'AM'],
  [69300, 69399, 'RR'], [69400, 69899, 'AM'], [69900, 69999, 'AC'], [70000, 72799, 'DF'],
  [72800, 72999, 'GO'], [73000, 73699, 'DF'], [73700, 76799, 'GO'], [76800, 76999, 'RO'],
  [77000, 77999, 'TO'], [78000, 78899, 'MT'], [78900, 78999, 'RO'], [79000, 79999, 'MS'],
  [80000, 87999, 'PR'], [88000, 89999, 'SC'], [90000, 99999, 'RS'],
]
function cepToUF(zip?: string | null): string | null {
  const digits = (zip || '').replace(/\D/g, '')
  if (digits.length < 5) return null
  const n = Number(digits.slice(0, 5))
  return CEP_UF.find(([a, b]) => n >= a && n <= b)?.[2] ?? null
}

export default function EmployeeList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('Ativo')
  const [cityFilter, setCityFilter] = useState('')
  const [ufFilter, setUfFilter] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  // A busca é feita aqui, não no banco: o banco só achava pelo nome exato e
  // com acento ("debora" não achava "Débora"). Agora acha sem acento e também
  // por CPF, telefone, e-mail, cidade e pelo cliente onde a pessoa trabalha.
  const { data: employees, isLoading } = useQuery({
    queryKey: ['employees', status],
    queryFn: async () => {
      let q = supabase.from('employees').select('id,full_name,role,status,admission_date,photo_url,email,whatsapp,phone,cpf,is_favorite,address_city,address_zip')
      if (status === FAVORITES_KEY) {
        q = q.eq('is_favorite', true)
      } else if (status && status !== ACTING_KEY) {
        q = q.eq('status', status)
      }
      q = q.order('is_favorite', { ascending: false }).order('full_name')
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  // Vínculos ativos por colaborador — pro filtro "Atuando", a contagem na linha
  // e para mostrar (e buscar) em qual cliente a pessoa está
  const { data: vinculosAtivos } = useQuery({
    queryKey: ['employee-active-link-counts'],
    queryFn: async () => {
      const today = hojeISO()
      const { data, error } = await supabase.from('employee_client_links').select('employee_id, contract_end_date, client:clients(name)')
      if (error) throw error
      const map = new Map<string, string[]>()
      for (const l of (data || []) as { employee_id: string; contract_end_date?: string | null; client?: { name?: string } | { name?: string }[] }[]) {
        if (l.contract_end_date && l.contract_end_date < today) continue
        const c = Array.isArray(l.client) ? l.client[0] : l.client
        map.set(l.employee_id, [...(map.get(l.employee_id) || []), c?.name || 'Cliente'])
      }
      return map
    },
  })
  const linkCounts = { get: (id: string) => vinculosAtivos?.get(id)?.length }

  const termo = semAcento(search.trim())
  const digitos = search.replace(/\D/g, '')

  // Filtros locais: busca, atuando, cidade e UF (derivada do CEP)
  const filtered = (employees ?? []).filter(e => {
    if (termo) {
      const campos = [e.full_name, e.role, e.email, e.address_city, ...(vinculosAtivos?.get(e.id) || [])]
        .filter(Boolean).map(v => semAcento(String(v)))
      const porTexto = campos.some(c => c.includes(termo))
      const porNumero = digitos.length >= 3 && [e.cpf, e.whatsapp, e.phone].some(v => String(v || '').replace(/\D/g, '').includes(digitos))
      if (!porTexto && !porNumero) return false
    }
    if (status === ACTING_KEY && !linkCounts.get(e.id)) return false
    if (cityFilter && (e.address_city || '').trim().toLowerCase() !== cityFilter.toLowerCase()) return false
    if (ufFilter && cepToUF(e.address_zip) !== ufFilter) return false
    return true
  })

  const cityOptions = [...new Set((employees ?? []).map(e => (e.address_city || '').trim()).filter(Boolean))].sort()
  const ufOptions = [...new Set((employees ?? []).map(e => cepToUF(e.address_zip)).filter(Boolean) as string[])].sort()

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

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleExport = () => {
    if (!filtered.length) return
    exportToCSV(filtered.map(e => ({
      Nome: e.full_name,
      Cargo: e.role || '',
      Status: e.status,
      'Vínculos ativos': linkCounts.get(e.id) || 0,
      Clientes: (vinculosAtivos?.get(e.id) || []).join(', '),
      Cidade: e.address_city || '',
      UF: cepToUF(e.address_zip) || '',
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
    { label: '⚡ Atuando', value: ACTING_KEY },
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
            {employees && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{filtered.length}</span>}
          </h1>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary text-sm" title="Baixar CSV"><Download size={16} /><span className="hidden sm:inline">CSV</span></button>
          <button onClick={() => navigate('/colaboradores/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
        </div>
      </div>

      {/* No celular a busca gruda no topo ao rolar: dá para procurar outra
          pessoa sem voltar lá em cima */}
      <div className="card p-3 flex gap-2.5 flex-wrap items-center sticky top-[62px] md:static z-10">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="input pl-9 pr-9" placeholder="Nome, CPF, telefone ou cliente…" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }} enterKeyHint="search" />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap w-full sm:w-auto">
          {filterTabs.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setStatus(opt.value); setPage(1) }}
              className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${status === opt.value ? 'bg-primary-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {(ufOptions.length > 0 || cityOptions.length > 0) && (
          <div className="flex gap-2 flex-wrap w-full sm:w-auto">
            {ufOptions.length > 0 && (
              <select className="input text-xs py-1.5 w-auto" value={ufFilter} onChange={e => { setUfFilter(e.target.value); setPage(1) }}>
                <option value="">Estado (todos)</option>
                {ufOptions.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            )}
            {cityOptions.length > 0 && (
              <select className="input text-xs py-1.5 w-auto" value={cityFilter} onChange={e => { setCityFilter(e.target.value); setPage(1) }}>
                <option value="">Cidade (todas)</option>
                {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <SkeletonRows count={8} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={status === FAVORITES_KEY ? Star : Search}
          title={status === FAVORITES_KEY ? 'Nenhum favorito ainda' : status === ACTING_KEY ? 'Ninguém atuando com esses filtros' : 'Nenhum colaborador encontrado'}
          hint={status === FAVORITES_KEY ? 'Clique na ⭐ de um colaborador para favoritá-lo.' : 'Ajuste os filtros ou cadastre um novo.'}
        />
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
                      <span className="md:hidden block text-xs text-ink-400 truncate">
                        {e.role || 'Sem cargo'}
                        {(vinculosAtivos?.get(e.id)?.length ?? 0) > 0 && <> · <span className="text-ink-600">{vinculosAtivos!.get(e.id)!.join(', ')}</span></>}
                      </span>
                    </div>
                  </div>

                  {/* Cargo + onde atua — desktop */}
                  <div className="hidden md:block md:col-span-3 min-w-0">
                    <p className="text-sm text-ink-600 truncate">{e.role || '-'}</p>
                    {(vinculosAtivos?.get(e.id)?.length ?? 0) > 0 && (
                      <p className="text-xs text-ink-400 truncate" title={vinculosAtivos!.get(e.id)!.join(', ')}>{vinculosAtivos!.get(e.id)!.join(', ')}</p>
                    )}
                  </div>

                  {/* Status + vínculos ativos */}
                  <div className="md:col-span-2 row-start-1 md:row-auto col-start-3 md:col-auto justify-self-end md:justify-self-start flex items-center gap-1.5 flex-wrap">
                    <span className={`badge ${statusBadge(e.status)}`}>{e.status}</span>
                    {(linkCounts?.get(e.id) ?? 0) > 0 && (
                      <span className="badge bg-blue-50 text-blue-600 text-[10px]" title="Vínculos ativos">
                        {linkCounts!.get(e.id)} vínculo{linkCounts!.get(e.id)! > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>

                  {/* Admissão + estrela + chevron */}
                  <div className="md:col-span-2 flex items-center justify-between md:justify-start gap-2 col-span-3 md:col-auto text-sm text-ink-400">
                    <span>{formatDate(e.admission_date)}</span>
                    <div className="flex items-center gap-1 ml-auto">
                      {/* WhatsApp direto do cartão — no celular é o que mais se faz depois de achar a pessoa */}
                      {e.whatsapp && (
                        <a href={formatWhatsApp(e.whatsapp)}
                          target="_blank" rel="noopener noreferrer" onClick={ev => ev.stopPropagation()}
                          className="md:hidden p-1.5 rounded-lg text-green-600 bg-green-50 active:scale-95" title="Abrir WhatsApp" aria-label="WhatsApp">
                          <MessageCircle size={15} />
                        </a>
                      )}
                      <button
                        onClick={ev => { ev.stopPropagation(); toggleFavorite.mutate({ id: e.id, val: !isFav }) }}
                        className={`p-1.5 rounded-full transition-colors ${isFav ? 'text-amber-400 hover:text-amber-500' : 'text-gray-300 hover:text-amber-400'}`}
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

          <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  )
}
