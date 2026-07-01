import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MessageCircle, Trash2, LayoutGrid, Download, Upload, X, Check, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatWhatsApp, PIPELINE_COLORS, PIPELINE_STAGES, BRAZIL_STATES, AREA_INTEREST_OPTIONS, TOOLS_OPTIONS, EXPERIENCE_TIME_OPTIONS } from '../../lib/utils'
import { exportToCSV } from '../../lib/exportUtils'
import { parseCSV, parseXLSX } from '../../lib/xlsxImport'
import Pagination from '../../components/ui/Pagination'
import toast from 'react-hot-toast'

// Maps "Mais de X anos" vacancy requirement to matching candidate experience_time values
const EXPERIENCE_FILTER_MAP: Record<string, string[]> = {
  'Mais de 1 ano': ['1 a 3 anos', '3 a 5 anos', 'Mais de 5 anos'],
  'Mais de 3 anos': ['3 a 5 anos', 'Mais de 5 anos'],
  'Mais de 5 anos': ['Mais de 5 anos'],
}

// Mapeamento de colunas do CSV para campos do banco
const FIELD_OPTIONS = [
  { value: '', label: '-- Ignorar --' },
  { value: 'full_name', label: 'Nome *' },
  { value: 'state', label: 'Estado' },
  { value: 'city', label: 'Cidade' },
  { value: 'sp_region', label: 'Região SP' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'E-mail' },
  { value: 'crn_number', label: 'CRN' },
  { value: 'requires_travel', label: 'Disponibilidade viagens (Sim/Não)' },
  { value: 'requires_relocation', label: 'Disponibilidade mudança (Sim/Não)' },
  { value: 'has_vehicle', label: 'Possui veículo (Sim/Não)' },
  { value: 'formation', label: 'Formação' },
  { value: 'graduation_year', label: 'Ano de Formação' },
  { value: 'institution', label: 'Instituição' },
  { value: 'postgrad_options', label: 'Pós-graduação' },
  { value: 'experience_area', label: 'Área de Experiência' },
  { value: 'experience_time', label: 'Tempo de Experiência' },
  { value: 'segments', label: 'Segmentos' },
  { value: 'uan_areas', label: 'Áreas UAN' },
  { value: 'max_meals_volume', label: 'Volume de Refeições' },
  { value: 'available_start', label: 'Disponibilidade de Início' },
  { value: 'available_weekends', label: 'Disponibilidade fins de semana (Sim/Não)' },
  { value: 'work_shift', label: 'Turno' },
  { value: 'work_hours', label: 'Escala de Trabalho' },
  { value: 'contract_types', label: 'Tipo de Vínculo' },
  { value: 'tools', label: 'Ferramentas' },
  { value: 'pipeline_stage', label: 'Estágio Pipeline' },
]

export default function CandidateList() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterState, setFilterState] = useState('')
  const [filterExperience, setFilterExperience] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [filterTool, setFilterTool] = useState('')
  const [filterTravel, setFilterTravel] = useState(false)
  const [filterRelocation, setFilterRelocation] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showHired, setShowHired] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 24
  const [totalCount, setTotalCount] = useState(0)

  const hasActiveFilters = !!(filterExperience || filterArea || filterTool || filterTravel || filterRelocation)

  // Import state
  const [importModal, setImportModal] = useState(false)
  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [importRows, setImportRows] = useState<string[][]>([])
  const [colMap, setColMap] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates', search, filterStage, filterState, filterExperience, filterArea, filterTool, filterTravel, filterRelocation, page, showHired],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      let q = supabase.from('candidates').select('*', { count: 'exact' }).order('full_name').range(from, to)
      if (search) q = q.or(`full_name.ilike.%${search}%,city.ilike.%${search}%,email.ilike.%${search}%,whatsapp.ilike.%${search}%`)
      if (filterStage) q = q.eq('pipeline_stage', filterStage)
      else if (!showHired) q = q.not('pipeline_stage', 'in', '("Contratado","Inativo")')
      if (filterState) q = q.eq('state', filterState)
      if (filterExperience) {
        const expValues = EXPERIENCE_FILTER_MAP[filterExperience]
        if (expValues) q = q.in('experience_time', expValues)
      }
      if (filterArea) q = q.eq('experience_area', filterArea)
      if (filterTool) q = q.cs('tools', [filterTool])
      if (filterTravel) q = q.eq('requires_travel', true)
      if (filterRelocation) q = q.eq('requires_relocation', true)
      const { data, error, count } = await q
      if (error) throw error
      setTotalCount(count ?? 0)
      return data || []
    },
  })

  const deleteCandidate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('candidates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { toast.success('Candidato excluído!'); qc.invalidateQueries({ queryKey: ['candidates'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const paginated = candidates ?? []

  const handleExport = () => {
    if (!candidates) return
    exportToCSV(candidates.map(c => ({
      Nome: c.full_name, Estado: c.state || '', Cidade: c.city || '',
      WhatsApp: c.whatsapp || '', Email: c.email || '',
      Estágio: c.pipeline_stage, Formação: c.formation || '',
    })), 'candidatos.csv')
  }

  const handleFileSelect = async (file: File) => {
    try {
      let result: { headers: string[]; rows: string[][] }
      if (file.name.endsWith('.csv')) {
        const text = await file.text()
        result = parseCSV(text)
      } else {
        result = await parseXLSX(file)
      }
      setImportHeaders(result.headers)
      setImportRows(result.rows)
      // Mapeamento explícito para colunas do Google Forms
      const FORMS_MAP: Record<string, string> = {
        'nome completo': 'full_name',
        'estado que reside': 'state',
        'cidade que reside': 'city',
        'caso resida na cidade de são paulo': 'sp_region',
        'número de telefone com whatsapp': 'whatsapp',
        'endereço de e-mail': 'email',
        'crn (número e região)': 'crn_number',
        'possui disponibilidade para viagens': 'requires_travel',
        'possui disponibilidade para mudança': 'requires_relocation',
        'possui veículo próprio': 'has_vehicle',
        'formação': 'formation',
        'ano de formação': 'graduation_year',
        'instituição de formação': 'institution',
        'possui pós-graduação': 'postgrad_options',
        'qual área possui maior tempo de experiência': 'experience_area',
        'tempo de experiência na área de alimentação coletiva': 'experience_time',
        'em quais segmentos já atuou': 'segments',
        'dentro da atuação de uan': 'uan_areas',
        'qual foi o maior volume de refeições': 'max_meals_volume',
        'disponibilidade para início': 'available_start',
        'disponibilidade para atuar em finais de semana': 'available_weekends',
        'disponibilidade para turnos': 'work_shift',
        'disponibilidade para escala de trabalho': 'work_hours',
        'tipo de vínculo desejado': 'contract_types',
        'possui experiência com quais ferramentas': 'tools',
      }
      const autoMap: Record<string, string> = {}
      result.headers.forEach(h => {
        const lower = h.toLowerCase().trim()
        // Sort by key length descending so more specific keys match first
        const sortedKeys = Object.keys(FORMS_MAP).sort((a, b) => b.length - a.length)
        const formsKey = sortedKeys.find(k => lower.startsWith(k) || lower.includes(k))
        if (formsKey) { autoMap[h] = FORMS_MAP[formsKey]; return }
        const norm = lower.replace(/[\s_\-*]/g, '')
        let found = FIELD_OPTIONS.find(f => f.value && f.value.replace(/_/g, '') === norm)
        if (!found) found = FIELD_OPTIONS.find(f => f.value && f.label.toLowerCase().replace(/[\s*]/g, '') === norm)
        autoMap[h] = found?.value || ''
      })
      setColMap(autoMap)
      setImportModal(true)
    } catch (err) {
      console.error('Erro ao ler arquivo:', err)
      toast.error('Erro ao ler o arquivo: ' + String(err))
    }
  }

  const handleImport = async () => {
    setImporting(true)
    let ok = 0, err = 0, dup = 0

    const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    const normText = (s: string) => stripAccents(String(s || '')).trim().toLowerCase().replace(/\s+/g, ' ')
    const normEmail = (s: string) => String(s || '').trim().toLowerCase()
    const normWa = (s: string) => {
      const d = String(s || '').replace(/\D/g, '')
      return d.startsWith('55') && d.length > 11 ? d.slice(2) : d
    }

    // 1) Carrega candidatos existentes pra comparar
    const existingWa = new Set<string>()
    const existingEmail = new Set<string>()
    const existingNameCity = new Set<string>()
    {
      let from = 0
      const pageSize = 1000
      while (true) {
        const { data, error: fetchErr } = await supabase
          .from('candidates')
          .select('full_name,city,email,whatsapp')
          .range(from, from + pageSize - 1)
        if (fetchErr) { toast.error('Erro ao ler base: ' + fetchErr.message); setImporting(false); return }
        if (!data?.length) break
        for (const c of data) {
          const wa = normWa(c.whatsapp || ''); if (wa.length >= 10) existingWa.add(wa)
          const em = normEmail(c.email || ''); if (em) existingEmail.add(em)
          const nm = normText(c.full_name || ''); const ct = normText((c as { city?: string }).city || '')
          if (nm && ct) existingNameCity.add(`${nm}|${ct}`)
        }
        if (data.length < pageSize) break
        from += pageSize
      }
    }

    // 2) Percorre linhas, deduplica por: WhatsApp > e-mail > nome+cidade
    const seenWa = new Set<string>()
    const seenEmail = new Set<string>()
    const seenNameCity = new Set<string>()
    const splitField = (v: string) => v ? v.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean) : []
    const toBool = (v: string) => v?.toLowerCase().startsWith('sim')
    const safeInt = (v: string) => { const n = parseInt(v); return isNaN(n) ? null : n }

    for (const row of importRows) {
      const obj: Record<string, string> = {}
      importHeaders.forEach((h, i) => { if (colMap[h]) obj[colMap[h]] = row[i] || '' })
      if (!obj.full_name?.trim()) continue

      const wa = normWa(obj.whatsapp || '')
      const em = normEmail(obj.email || '')
      const nm = normText(obj.full_name)
      const ct = normText(obj.city || '')

      const isDup =
        (wa.length >= 10 && (existingWa.has(wa) || seenWa.has(wa))) ||
        (em && (existingEmail.has(em) || seenEmail.has(em))) ||
        (!wa && !em && nm && ct && (existingNameCity.has(`${nm}|${ct}`) || seenNameCity.has(`${nm}|${ct}`)))
      if (isDup) { dup++; continue }

      if (wa.length >= 10) seenWa.add(wa)
      if (em) seenEmail.add(em)
      if (nm && ct) seenNameCity.add(`${nm}|${ct}`)

      const rawState = obj.state || ''
      const stateMatch = rawState.match(/\(([A-Z]{2})\)$/)
      const stateCode = stateMatch ? stateMatch[1] : (rawState.length === 2 ? rawState.toUpperCase() : null)

      const record = {
        full_name: obj.full_name.trim(),
        state: stateCode || null,
        city: obj.city?.trim() || null,
        sp_region: obj.sp_region || null,
        whatsapp: wa.length >= 10 ? wa : null,
        email: obj.email?.trim() || null,
        crn_number: obj.crn_number || null,
        requires_travel: obj.requires_travel ? toBool(obj.requires_travel) : false,
        requires_relocation: obj.requires_relocation ? toBool(obj.requires_relocation) : false,
        has_vehicle: obj.has_vehicle ? toBool(obj.has_vehicle) : false,
        formation: obj.formation || null,
        graduation_year: safeInt(obj.graduation_year || ''),
        institution: obj.institution?.trim() || null,
        postgrad_options: obj.postgrad_options ? splitField(obj.postgrad_options) : [],
        experience_area: obj.experience_area || null,
        experience_time: obj.experience_time || null,
        segments: splitField(obj.segments),
        uan_areas: splitField(obj.uan_areas),
        max_meals_volume: safeInt(obj.max_meals_volume || ''),
        available_weekends: obj.available_weekends ? toBool(obj.available_weekends) : false,
        work_shift: obj.work_shift || null,
        work_hours: obj.work_hours || null,
        contract_types: splitField(obj.contract_types),
        tools: splitField(obj.tools),
        pipeline_stage: obj.pipeline_stage || 'Banco',
      }

      // 3) Insere um por um — se um falhar, só ele é perdido
      const { error: insErr } = await supabase.from('candidates').insert(record)
      if (insErr) { console.error('Insert fail:', obj.full_name, insErr.message); err++ }
      else ok++
    }

    setImporting(false)
    setImportModal(false)
    qc.invalidateQueries({ queryKey: ['candidates'] })
    const parts = [`${ok} importado(s)`]
    if (dup) parts.push(`${dup} já existiam`)
    if (err) parts.push(`${err} erro(s)`)
    toast.success(parts.join(' · '), { duration: 6000 })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Banco de talentos</p>
          <h1 className="text-2xl md:text-3xl font-display font-extrabold text-ink-900">
            Candidatos
            {totalCount > 0 && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{totalCount}</span>}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate('/candidatos/kanban')} className="btn-secondary text-sm"><LayoutGrid size={16} />Kanban</button>
          <button onClick={handleExport} className="btn-secondary text-sm"><Download size={16} />Exportar</button>
          <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload size={16} />Importar CSV</button>
          <button onClick={() => navigate('/candidatos/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
        </div>
      </div>

      <div className="card p-4 space-y-3">
        {/* Row 1: search + basic filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Nome, e-mail, cidade, telefone..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <select className="input w-44" value={filterStage} onChange={e => { setFilterStage(e.target.value); setPage(1) }}>
            <option value="">Todos os estágios</option>
            {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-28" value={filterState} onChange={e => { setFilterState(e.target.value); setPage(1) }}>
            <option value="">Todo Brasil</option>
            {BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button
            className={`btn-secondary flex items-center gap-1.5 text-sm relative ${hasActiveFilters ? 'ring-2 ring-primary-400' : ''}`}
            onClick={() => setShowFilters(p => !p)}
          >
            <SlidersHorizontal size={14} />
            Filtros de perfil
            {hasActiveFilters && <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary-600 rounded-full text-[10px] text-white flex items-center justify-center">●</span>}
          </button>
          <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap ml-auto">
            <input type="checkbox" checked={showHired} onChange={e => { setShowHired(e.target.checked); setPage(1) }} className="rounded" />
            Contratados
          </label>
        </div>

        {/* Row 2: profile filters (expandable) */}
        {showFilters && (
          <div className="border-t pt-3 space-y-3">
            <div className="flex gap-3 flex-wrap items-end">
              <div>
                <label className="label">Experiência mínima</label>
                <select className="input w-44" value={filterExperience} onChange={e => { setFilterExperience(e.target.value); setPage(1) }}>
                  <option value="">Qualquer</option>
                  <option>Mais de 1 ano</option>
                  <option>Mais de 3 anos</option>
                  <option>Mais de 5 anos</option>
                </select>
              </div>
              <div>
                <label className="label">Área principal</label>
                <select className="input w-44" value={filterArea} onChange={e => { setFilterArea(e.target.value); setPage(1) }}>
                  <option value="">Qualquer</option>
                  {AREA_INTEREST_OPTIONS.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Domina ferramenta</label>
                <select className="input w-56" value={filterTool} onChange={e => { setFilterTool(e.target.value); setPage(1) }}>
                  <option value="">Qualquer</option>
                  {TOOLS_OPTIONS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={filterTravel} onChange={e => { setFilterTravel(e.target.checked); setPage(1) }} className="rounded" />
                Disponível p/ viagens
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={filterRelocation} onChange={e => { setFilterRelocation(e.target.checked); setPage(1) }} className="rounded" />
                Disponível p/ mudança
              </label>
              {hasActiveFilters && (
                <button
                  className="btn-ghost text-xs text-red-500"
                  onClick={() => { setFilterExperience(''); setFilterArea(''); setFilterTool(''); setFilterTravel(false); setFilterRelocation(false); setPage(1) }}
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-4 border-primary-600 border-t-transparent" /></div>
      ) : (
        <>
          {candidates?.length === 0 ? (
            <div className="card p-12 text-center text-ink-400">
              <Search size={32} className="mx-auto mb-3 text-ink-200" />
              <p className="font-medium">Nenhum candidato encontrado</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginated.map(c => (
              <div key={c.id} className="card p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/candidatos/${c.id}`)}>
                    <h3 className="font-display font-bold text-ink-900 truncate">{c.full_name}</h3>
                    <p className="text-xs text-ink-500">{c.city}{c.city && c.state ? ', ' : ''}{c.state}</p>
                    <p className="text-xs text-ink-400 mt-0.5 truncate">{c.formation || '-'}</p>
                  </div>
                  <span className={`badge flex-shrink-0 ${PIPELINE_COLORS[c.pipeline_stage] || 'bg-ink-100 text-ink-600'}`}>
                    {c.pipeline_stage}
                  </span>
                </div>
                <div className="flex gap-1.5 mt-4 pt-3 border-t border-ink-100">
                  <button onClick={() => navigate(`/candidatos/${c.id}`)} className="btn-secondary text-xs flex-1 py-2">Ver</button>
                  <button onClick={() => navigate(`/candidatos/${c.id}/editar`)} className="btn-secondary text-xs flex-1 py-2">Editar</button>
                  {c.whatsapp && (
                    <a href={formatWhatsApp(c.whatsapp)} target="_blank" rel="noreferrer" className="btn-ghost p-2" title="WhatsApp">
                      <MessageCircle size={16} className="text-green-600" />
                    </a>
                  )}
                  <button onClick={() => { if (confirm('Excluir candidato?')) deleteCandidate.mutate(c.id) }} className="btn-ghost p-2 text-red-400" title="Excluir">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          )}
          {(candidates?.length ?? 0) > 0 && <div className="card"><Pagination page={page} total={totalCount} pageSize={PAGE_SIZE} onChange={p => { setPage(p) }} /></div>}
        </>
      )}

      {/* Modal de importação */}
      {importModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-semibold text-lg">Importar Candidatos</h2>
              <button onClick={() => setImportModal(false)} className="btn-ghost p-1"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              {/* Preview */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Preview — primeiras 5 linhas ({importRows.length} total):</p>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="text-xs w-full">
                    <thead className="bg-gray-50">
                      <tr>{importHeaders.map(h => <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {importRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-t">
                          {row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-gray-700">{cell || '-'}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mapeamento de colunas */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Mapeamento de colunas:</p>
                <div className="grid grid-cols-2 gap-2">
                  {importHeaders.map(h => (
                    <div key={h} className="flex items-center gap-2">
                      <span className="text-sm text-gray-600 w-32 truncate flex-shrink-0">{h}</span>
                      <span className="text-gray-400">→</span>
                      <select
                        className="input flex-1 text-sm"
                        value={colMap[h] || ''}
                        onChange={e => setColMap(prev => ({ ...prev, [h]: e.target.value }))}
                      >
                        {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex items-center justify-between">
              <p className="text-sm text-gray-500">{importRows.length} registros para importar</p>
              <div className="flex gap-3">
                <button className="btn-secondary" onClick={() => setImportModal(false)}>Cancelar</button>
                <button
                  className="btn-primary flex items-center gap-2"
                  onClick={handleImport}
                  disabled={importing}
                >
                  {importing ? 'Importando...' : <><Check size={14} />Importar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
