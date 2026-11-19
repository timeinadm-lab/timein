import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MessageCircle, Trash2, LayoutGrid, Download, Upload, X, Check, SlidersHorizontal, Pencil } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatWhatsApp, PIPELINE_COLORS, PIPELINE_STAGES, BRAZIL_STATES, AREA_INTEREST_OPTIONS, TOOLS_OPTIONS, EXPERIENCE_TIME_OPTIONS } from '../../lib/utils'
import { format } from 'date-fns'
import { lerCarimbo, ultimaRespostaDeCada, lerVolumeRefeicoes } from '../../lib/candidatosImport'
import type { Chaves } from '../../lib/candidatosImport'
import { camposParaAtualizar } from '../../lib/candidatosImport'
import { exportToCSV } from '../../lib/exportUtils'
import { parseCSV, parseXLSX } from '../../lib/xlsxImport'
import Pagination from '../../components/ui/Pagination'
import { SkeletonCards, EmptyState } from '../../components/ui/Skeleton'
import toast from 'react-hot-toast'
import { confirmar } from '../../components/ui/ConfirmDialog'

// Maps "Mais de X anos" vacancy requirement to matching candidate experience_time values
const EXPERIENCE_FILTER_MAP: Record<string, string[]> = {
  'Mais de 1 ano': ['1 a 3 anos', '3 a 5 anos', 'Mais de 5 anos'],
  'Mais de 3 anos': ['3 a 5 anos', 'Mais de 5 anos'],
  'Mais de 5 anos': ['Mais de 5 anos'],
}

// Filtros da lista (19/11/2026, pedido do Gabriel: "a filtragem a gente vai ter que
// arrumar"). Os textos são os que o Forms grava — o filtro de ferramenta procurava
// "Checklists Digitais (Foodchecker…" e o banco tem "(Exemplo: Foodchecker…": achava 1 de 863.
const QUALQUER_ESCALA = 'Disponibilidade para qualquer escala'
const QUALQUER_VINCULO = 'Atuação por qualquer tipo de vínculo'
const FERRAMENTAS: [string, string][] = [
  ['Excel', 'Excel'], ['TecFood', 'TecFood'], ['Genial', 'Genial'], ['Tasy', 'Tasy'],
  ['Checklists Digitais (Exemplo: Foodchecker / Checklist Fácil)', 'Checklist digital (Foodchecker, Checklist Fácil)'],
  ['Elaboração de Relatórios Técnicos', 'Relatórios técnicos'], ['Apresentações (PowerPoint / Canva)', 'Apresentações (PowerPoint, Canva)'],
]
const SEGMENTOS = ['Cozinhas industriais', 'Restaurantes comerciais', 'Hospitais', 'Escolas/Universidades', 'Eventos', 'Indústria de alimentos', 'Lactário']
const AREAS_UAN = ['Controle de Qualidade', 'Produção', 'Auditoria / Fiscalização', 'Planejamento']
const VOLUMES: [string, string][] = [['100', '100 ou mais'], ['200', '200 ou mais'], ['500', '500 ou mais'], ['1000', '1.000 ou mais'], ['5000', 'Acima de 5.000']]
const FILTROS_VAZIOS = { formacao: '', idade: '', inicio: '', turno: '', escala: '', vinculo: '', volume: '', segmento: '', uan: '', veiculo: false, fds: false }

// Mapeamento de colunas do CSV para campos do banco
const FIELD_OPTIONS = [
  { value: '', label: '-- Ignorar --' },
  { value: 'full_name', label: 'Nome *' },
  { value: 'respondido_em', label: 'Data da resposta (carimbo)' },
  { value: 'idade', label: 'Idade (faixa)' },
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
  { value: 'sobre', label: 'Sobre você e sua experiência (texto)' },
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
  const [fx, setFx] = useState(FILTROS_VAZIOS)
  const mudarFx = (campo: keyof typeof FILTROS_VAZIOS, valor: string | boolean) => { setFx(p => ({ ...p, [campo]: valor })); setPage(1) }
  const [showFilters, setShowFilters] = useState(false)
  const [showHired, setShowHired] = useState(false)
  const [page, setPage] = useState(1)
  // Ordem (07/10/2026): "mais recentes" = os últimos que chegaram (respondeu o
  // formulário, foi importado ou cadastrado) primeiro. Guarda a escolha no aparelho.
  const [ordem, setOrdem] = useState<'nome' | 'recentes' | 'antigos'>(() => {
    try { const o = localStorage.getItem('candidatos-ordem'); return o === 'nome' || o === 'antigos' ? o : 'recentes' } catch { return 'recentes' }
  })
  const mudarOrdem = (o: 'nome' | 'recentes' | 'antigos') => { setOrdem(o); setPage(1); try { localStorage.setItem('candidatos-ordem', o) } catch { /* sem armazenamento */ } }
  const PAGE_SIZE = 24
  const [totalCount, setTotalCount] = useState(0)

  // Cada filtro ligado vira uma etiqueta que dá para tirar com um clique
  const etiquetas: { texto: string; tirar: () => void }[] = [
    filterExperience && { texto: `Experiência: ${filterExperience.toLowerCase()}`, tirar: () => setFilterExperience('') },
    filterArea && { texto: `Área: ${filterArea}`, tirar: () => setFilterArea('') },
    filterTool && { texto: FERRAMENTAS.find(t => t[0] === filterTool)?.[1] || filterTool, tirar: () => setFilterTool('') },
    fx.formacao && { texto: fx.formacao, tirar: () => mudarFx('formacao', '') },
    fx.idade && { texto: fx.idade, tirar: () => mudarFx('idade', '') },
    fx.inicio && { texto: `Começa: ${fx.inicio.toLowerCase()}`, tirar: () => mudarFx('inicio', '') },
    fx.turno && { texto: `Turno ${fx.turno.toLowerCase()}`, tirar: () => mudarFx('turno', '') },
    fx.escala && { texto: `Escala ${fx.escala}`, tirar: () => mudarFx('escala', '') },
    fx.vinculo && { texto: `Aceita ${fx.vinculo}`, tirar: () => mudarFx('vinculo', '') },
    fx.volume && { texto: `${VOLUMES.find(v => v[0] === fx.volume)?.[1]} refeições`, tirar: () => mudarFx('volume', '') },
    fx.segmento && { texto: fx.segmento, tirar: () => mudarFx('segmento', '') },
    fx.uan && { texto: fx.uan, tirar: () => mudarFx('uan', '') },
    fx.veiculo && { texto: 'Tem veículo', tirar: () => mudarFx('veiculo', false) },
    fx.fds && { texto: 'Fim de semana', tirar: () => mudarFx('fds', false) },
    filterTravel && { texto: 'Aceita viajar', tirar: () => setFilterTravel(false) },
    filterRelocation && { texto: 'Aceita mudar de cidade', tirar: () => setFilterRelocation(false) },
  ].filter(Boolean) as { texto: string; tirar: () => void }[]
  const hasActiveFilters = etiquetas.length > 0
  const limparFiltros = () => { setFilterExperience(''); setFilterArea(''); setFilterTool(''); setFilterTravel(false); setFilterRelocation(false); setFx(FILTROS_VAZIOS); setPage(1) }

  // Import state
  const [importModal, setImportModal] = useState(false)
  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [importRows, setImportRows] = useState<string[][]>([])
  const [colMap, setColMap] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: candidates, isLoading } = useQuery({
    queryKey: ['candidates', search, filterStage, filterState, filterExperience, filterArea, filterTool, filterTravel, filterRelocation, page, showHired, ordem, fx],
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      // Ordem de chegada = data da resposta do formulário (migração 086); quem não
      // tem data (antes da próxima importação) vem depois, pela entrada no sistema
      const montar = (porData: boolean) => {
        let q = supabase.from('candidates').select('*, notas:candidate_contacts(observations, created_at)', { count: 'exact' })
        if (ordem === 'nome') q = q.order('full_name')
        else {
          if (porData) q = q.order('respondido_em', { ascending: ordem === 'antigos', nullsFirst: false })
          q = q.order('created_at', { ascending: ordem === 'antigos' }).order('full_name')
        }
        q = q.order('created_at', { referencedTable: 'candidate_contacts', ascending: false }).range(from, to)
        if (search) q = q.or(`full_name.ilike.%${search}%,city.ilike.%${search}%,email.ilike.%${search}%,whatsapp.ilike.%${search}%`)
        if (filterStage) q = q.eq('pipeline_stage', filterStage)
        else if (!showHired) q = q.not('pipeline_stage', 'in', '("Contratado","Inativo")')
        if (filterState) q = q.eq('state', filterState)
        if (filterExperience) {
          const expValues = EXPERIENCE_FILTER_MAP[filterExperience]
          if (expValues) q = q.in('experience_time', expValues)
        }
        if (filterArea) q = q.eq('experience_area', filterArea)
        if (filterTool) q = q.contains('tools', [filterTool])
        if (filterTravel) q = q.eq('requires_travel', true)
        if (filterRelocation) q = q.eq('requires_relocation', true)
        // Quem marcou "Ambos" / "qualquer escala" / "qualquer vínculo" serve para qualquer pedido
        if (fx.formacao) q = q.in('formation', [fx.formacao, 'Ambos'])
        if (fx.idade) q = q.eq('idade', fx.idade)
        if (fx.inicio) q = q.eq('available_start', fx.inicio)
        if (fx.turno) q = q.in('work_shift', [fx.turno, 'Ambos'])
        if (fx.escala) q = q.in('work_hours', [fx.escala, QUALQUER_ESCALA])
        if (fx.vinculo) q = q.overlaps('contract_types', [fx.vinculo, QUALQUER_VINCULO])
        if (fx.volume) q = q.gte('max_meals_volume', Number(fx.volume))
        if (fx.segmento) q = q.contains('segments', [fx.segmento])
        if (fx.uan) q = q.contains('uan_areas', [fx.uan])
        if (fx.veiculo) q = q.eq('has_vehicle', true)
        if (fx.fds) q = q.eq('available_weekends', true)
        return q
      }
      let r = await montar(true)
      if (r.error && /respondido_em/.test(r.error.message)) r = await montar(false)   // sem a migração 086
      if (r.error) throw r.error
      setTotalCount(r.count ?? 0)
      return r.data || []
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
        'carimbo de data/hora': 'respondido_em',
        'nome completo': 'full_name',
        'idade': 'idade',
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
        // Pergunta aberta nova do formulário (18/11/2026): texto livre, pode ser longo
        'conte um pouco sobre você': 'sobre',
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
    const normEmail = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase()
    const normWa = (s: string) => {
      const d = String(s || '').replace(/\D/g, '')
      return d.startsWith('55') && d.length > 11 ? d.slice(2) : d
    }

    // 1) Quem já existe: chave (WhatsApp, e-mail, nome + cidade) → id e data da resposta
    type Existe = { id: string; resp: string | null; semSobre?: boolean }
    const porWa = new Map<string, Existe>(), porEmail = new Map<string, Existe>(), porNomeCidade = new Map<string, Existe>()
    let temData = true   // sem a migração 086 não há coluna respondido_em
    // Sem a migração 107 não há a coluna "sobre": importa o resto e avisa no fim
    const temSobre = !(await supabase.from('candidates').select('sobre').limit(1)).error
    // Idade e faixa do volume de refeições: colunas da migração 109
    const tem109 = !(await supabase.from('candidates').select('idade,volume_refeicoes').limit(1)).error
    {
      let from = 0
      const pageSize = 1000
      while (true) {
        const buscar = (cols: string) => supabase.from('candidates').select(cols).order('id').range(from, from + pageSize - 1)
        let r = await buscar('id,full_name,city,email,whatsapp' + (temSobre ? ',sobre' : '') + (temData ? ',respondido_em' : ''))
        if (r.error && temData && /respondido_em/.test(r.error.message)) { temData = false; r = await buscar('id,full_name,city,email,whatsapp' + (temSobre ? ',sobre' : '')) }
        if (r.error) { toast.error('Erro ao ler base: ' + r.error.message); setImporting(false); return }
        const data = (r.data || []) as unknown as { id: string; full_name?: string; city?: string; email?: string; whatsapp?: string; sobre?: string | null; respondido_em?: string | null }[]
        if (!data.length) break
        for (const c of data) {
          const ex: Existe = { id: c.id, resp: c.respondido_em || null, semSobre: !c.sobre }
          const wa = normWa(c.whatsapp || ''); if (wa.length >= 10) porWa.set(wa, ex)
          const em = normEmail(c.email || ''); if (em) porEmail.set(em, ex)
          const nm = normText(c.full_name || ''); const ct = normText(c.city || '')
          if (nm && ct) porNomeCidade.set(`${nm}|${ct}`, ex)
        }
        if (data.length < pageSize) break
        from += pageSize
      }
    }

    // 2) Monta o registro de cada linha
    const splitField = (v: string) => v ? v.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean) : []
    const toBool = (v: string) => v?.toLowerCase().startsWith('sim')
    const safeInt = (v: string) => { const n = parseInt(v); return isNaN(n) ? null : n }
    const linhas: { rec: Record<string, unknown>; ch: Chaves; quando: string | null }[] = []

    for (const row of importRows) {
      const obj: Record<string, string> = {}
      importHeaders.forEach((h, i) => { if (colMap[h]) obj[colMap[h]] = row[i] || '' })
      if (!obj.full_name?.trim()) continue

      const wa = normWa(obj.whatsapp || '')
      const em = normEmail(obj.email || '')
      const nm = normText(obj.full_name)
      const ct = normText(obj.city || '')

      const rawState = obj.state || ''
      const stateMatch = rawState.match(/\(([A-Z]{2})\)$/)
      const stateCode = stateMatch ? stateMatch[1] : (rawState.length === 2 ? rawState.toUpperCase() : null)

      linhas.push({
        ch: { wa: wa.length >= 10 ? wa : '', email: em, nomeCidade: nm && ct ? `${nm}|${ct}` : '' },
        quando: lerCarimbo(obj.respondido_em),
        rec: {
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
          max_meals_volume: lerVolumeRefeicoes(obj.max_meals_volume).minimo,
          ...(tem109 ? { volume_refeicoes: lerVolumeRefeicoes(obj.max_meals_volume).faixa, idade: obj.idade?.trim() || null } : {}),
          // Antes a coluna era lida mas não era gravada (18/11/2026)
          available_start: obj.available_start?.trim() || null,
          available_weekends: obj.available_weekends ? toBool(obj.available_weekends) : false,
          work_shift: obj.work_shift || null,
          work_hours: obj.work_hours || null,
          contract_types: splitField(obj.contract_types),
          tools: splitField(obj.tools),
          ...(temSobre ? { sobre: obj.sobre?.trim() || null } : {}),
          pipeline_stage: obj.pipeline_stage || 'Banco',
        },
      })
    }

    // 3) A mesma pessoa várias vezes na planilha: fica só a resposta mais nova
    //    (pedido de 07/10/2026: "colocou quatro vezes… aparece só o último")
    const finais = ultimaRespostaDeCada(linhas, l => l.ch, l => l.quando)
    const repetidas = linhas.length - finais.length

    // 4) Grava. Já existe no banco → atualiza com a resposta nova (sobe para os
    //    recentes); estágio e notas não mudam. Resposta mais velha que a do banco: deixa.
    let atualizados = 0, completados = 0
    for (const l of finais) {
      const ex = (l.ch.wa && porWa.get(l.ch.wa)) || (l.ch.email && porEmail.get(l.ch.email)) || (l.ch.nomeCidade && porNomeCidade.get(l.ch.nomeCidade)) || null
      if (ex) {
        if (!temData || !l.quando || (ex.resp && l.quando <= ex.resp)) {
          // Já estava em dia, mas ainda sem o texto novo: completa só ele (não
          // mexe em mais nada) — é o que traz a resposta de quem já estava no banco
          if (temSobre && ex.semSobre && l.rec.sobre && !(ex.resp && l.quando && l.quando < ex.resp)) {
            const { error: sErr } = await supabase.from('candidates').update({ sobre: l.rec.sobre }).eq('id', ex.id)
            if (sErr) err++; else { completados++; ex.semSobre = false }
            continue
          }
          dup++; continue
        }
        const { error: upErr } = await supabase.from('candidates').update({ ...camposParaAtualizar(l.rec), respondido_em: l.quando }).eq('id', ex.id)
        if (upErr) { console.error('Update fail:', l.rec.full_name, upErr.message); err++ }
        else { atualizados++; ex.resp = l.quando }
        continue
      }
      // Novo — um por um: se um falhar, só ele é perdido
      const { error: insErr } = await supabase.from('candidates').insert(temData && l.quando ? { ...l.rec, respondido_em: l.quando } : l.rec)
      if (insErr) { console.error('Insert fail:', l.rec.full_name, insErr.message); err++ }
      else ok++
    }

    setImporting(false)
    setImportModal(false)
    if (ok > 0 || atualizados > 0) mudarOrdem('recentes')   // quem acabou de entrar aparece primeiro
    qc.invalidateQueries({ queryKey: ['candidates'] })
    qc.invalidateQueries({ queryKey: ['candidate'] })
    const parts = [`${ok} novo(s)`]
    if (atualizados) parts.push(`${atualizados} atualizado(s) (refizeram o formulário)`)
    if (completados) parts.push(`${completados} com o texto "sobre você" preenchido`)
    if (dup) parts.push(`${dup} já estavam em dia`)
    if (repetidas) parts.push(`${repetidas} resposta(s) repetida(s) na planilha — ficou a mais nova`)
    if (err) parts.push(`${err} erro(s)`)
    toast.success(parts.join(' · '), { duration: 6000 })
    if (!tem109 && Object.values(colMap).includes('idade')) toast.error('A idade e a faixa de refeições não foram salvas: rode a migração 109 no Supabase e importe de novo.', { duration: 9000 })
    if (!temSobre && Object.values(colMap).includes('sobre')) toast.error('O texto "Conte um pouco sobre você" não foi salvo: rode a migração 107 no Supabase e importe de novo.', { duration: 9000 })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="eyebrow mb-1">Banco de talentos</p>
          <h1 className="page-title">
            Candidatos
            {totalCount > 0 && <span className="ml-2 text-base font-semibold text-ink-400 align-middle">{totalCount}</span>}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => navigate('/candidatos/kanban')} className="btn-secondary text-sm"><LayoutGrid size={16} />Kanban</button>
          <button onClick={handleExport} className="btn-secondary text-sm"><Download size={16} />Exportar</button>
          <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm"><Upload size={16} />Importar planilha</button>
          <button onClick={() => navigate('/candidatos/novo')} className="btn-primary text-sm"><Plus size={16} />Novo</button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[14rem]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Procurar por nome, cidade, e-mail ou telefone" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <select className="input w-auto" value={filterStage} onChange={e => { setFilterStage(e.target.value); setPage(1) }} aria-label="Estágio">
            <option value="">Todos os estágios</option>
            {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input w-auto" value={filterState} onChange={e => { setFilterState(e.target.value); setPage(1) }} aria-label="Estado">
            <option value="">Todo o Brasil</option>
            {BRAZIL_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={`btn-secondary text-sm ${showFilters ? 'bg-ink-100 border-ink-300' : ''}`} onClick={() => setShowFilters(p => !p)} aria-expanded={showFilters}>
            <SlidersHorizontal size={14} />
            Mais filtros{etiquetas.length > 0 ? ` (${etiquetas.length})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="card p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="label">Experiência em UAN</label>
                <select className="input" value={filterExperience} onChange={e => { setFilterExperience(e.target.value); setPage(1) }}>
                  <option value="">Tanto faz</option>
                  <option>Mais de 1 ano</option>
                  <option>Mais de 3 anos</option>
                  <option>Mais de 5 anos</option>
                </select>
              </div>
              <div>
                <label className="label">Já trabalhou em</label>
                <select className="input w-full" value={fx.segmento} onChange={e => mudarFx('segmento', e.target.value)}>
                  <option value="">Tanto faz</option>
                  {SEGMENTOS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Área dentro da UAN</label>
                <select className="input w-full" value={fx.uan} onChange={e => mudarFx('uan', e.target.value)}>
                  <option value="">Tanto faz</option>
                  {AREAS_UAN.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Maior volume de refeições</label>
                <select className="input w-full" value={fx.volume} onChange={e => mudarFx('volume', e.target.value)}>
                  <option value="">Tanto faz</option>
                  {VOLUMES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Formação</label>
                <select className="input w-full" value={fx.formacao} onChange={e => mudarFx('formacao', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>Nutricionista</option><option>Técnico em Nutrição</option>
                </select>
              </div>
              <div>
                <label className="label">Área em que mais atuou</label>
                <select className="input" value={filterArea} onChange={e => { setFilterArea(e.target.value); setPage(1) }}>
                  <option value="">Tanto faz</option>
                  {AREA_INTEREST_OPTIONS.map(a => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Sabe usar</label>
                <select className="input" value={filterTool} onChange={e => { setFilterTool(e.target.value); setPage(1) }}>
                  <option value="">Tanto faz</option>
                  {FERRAMENTAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Idade</label>
                <select className="input w-full" value={fx.idade} onChange={e => mudarFx('idade', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>20 a 30 anos</option><option>30 a 40 anos</option><option>40 a 50 anos</option><option>Mais de 50 anos</option>
                </select>
              </div>
              <div>
                <label className="label">Pode começar</label>
                <select className="input w-full" value={fx.inicio} onChange={e => mudarFx('inicio', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>Imediato</option><option>Até 15 dias</option><option>30 dias ou mais</option>
                </select>
              </div>
              <div>
                <label className="label">Turno</label>
                <select className="input w-full" value={fx.turno} onChange={e => mudarFx('turno', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>Diurno</option><option>Noturno</option>
                </select>
              </div>
              <div>
                <label className="label">Escala</label>
                <select className="input w-full" value={fx.escala} onChange={e => mudarFx('escala', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>5x2</option><option>6x1</option><option>12x36</option>
                </select>
              </div>
              <div>
                <label className="label">Tipo de vínculo</label>
                <select className="input w-full" value={fx.vinculo} onChange={e => mudarFx('vinculo', e.target.value)}>
                  <option value="">Tanto faz</option>
                  <option>CLT</option><option>PJ</option><option>Freelancer</option>
                </select>
              </div>
            </div>
            <div className="flex gap-x-5 gap-y-2 flex-wrap text-sm text-ink-700">
              <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={fx.veiculo} onChange={e => mudarFx('veiculo', e.target.checked)} />Tem veículo próprio</label>
              <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={fx.fds} onChange={e => mudarFx('fds', e.target.checked)} />Trabalha no fim de semana</label>
              <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterTravel} onChange={e => { setFilterTravel(e.target.checked); setPage(1) }} />Aceita viajar</label>
              <label className="inline-flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={filterRelocation} onChange={e => { setFilterRelocation(e.target.checked); setPage(1) }} />Aceita mudar de cidade</label>
            </div>
          </div>
        )}

        {etiquetas.length > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            {etiquetas.map(et => (
              <button key={et.texto} onClick={() => { et.tirar(); setPage(1) }} title="Tirar este filtro"
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 text-primary-800 border border-primary-200 pl-3 pr-2 py-1 text-xs hover:bg-primary-100">
                {et.texto}<X size={12} />
              </button>
            ))}
            <button className="text-xs text-ink-500 underline ml-1" onClick={limparFiltros}>Limpar tudo</button>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap text-sm text-ink-500">
          <span className="tnum">{isLoading ? 'Procurando…' : `${totalCount.toLocaleString('pt-BR')} ${totalCount === 1 ? 'pessoa' : 'pessoas'}`}</span>
          <label className="inline-flex items-center gap-2 cursor-pointer text-ink-700">
            <input type="checkbox" checked={showHired} onChange={e => { setShowHired(e.target.checked); setPage(1) }} />
            Mostrar contratados e inativos
          </label>
          <select className="input w-auto py-1.5 text-sm ml-auto" value={ordem} onChange={e => mudarOrdem(e.target.value as 'nome' | 'recentes' | 'antigos')} aria-label="Ordem">
            <option value="recentes">Responderam por último primeiro</option>
            <option value="antigos">Mais antigos primeiro</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <SkeletonCards count={6} cols={1} />
      ) : (
        <>
          {candidates?.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Ninguém com esses filtros"
              hint={hasActiveFilters ? 'Tire um dos filtros acima para ver mais gente.' : 'Importe a planilha do formulário ou cadastre um candidato.'}
            />
          ) : (
          // Uma lista, não um cartão por pessoa: dá para comparar 20 candidatos de uma vez.
          // Clicar na linha abre a ficha (antes: botões "Ver" e "Editar" em cada cartão).
          <div className="card overflow-hidden divide-y divide-ink-100">
            <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_7.5rem_5.5rem] gap-4 px-4 py-2.5 text-xs font-medium text-ink-500 bg-ink-50/70">
              <span>Nome</span><span>Onde mora</span><span>Experiência</span><span>Disponibilidade</span><span>Estágio</span><span />
            </div>
            {paginated.map(c => {
              const x = c as typeof c & { respondido_em?: string | null; idade?: string | null; available_start?: string | null; volume_refeicoes?: string | null; work_hours?: string | null; notas?: { observations: string | null }[] }
              const quando = x.respondido_em || c.created_at
              const novo = !!quando && Date.now() - new Date(quando).getTime() < 3 * 86400000
              const nota = (x.notas || [])[0]?.observations
              const semExp = /nenhuma/i.test(c.experience_time || '')
              return (
                <div key={c.id} role="link" tabIndex={0}
                  onClick={() => navigate(`/candidatos/${c.id}`)} onKeyDown={e => { if (e.key === 'Enter') navigate(`/candidatos/${c.id}`) }}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_7.5rem_5.5rem] gap-x-4 gap-y-1 px-4 py-3 items-center cursor-pointer hover:bg-ink-50/70 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900 truncate">
                      {c.full_name}
                      {novo && <span className="ml-2 badge bg-primary-50 text-primary-700 align-middle">Novo</span>}
                    </p>
                    <p className="text-xs text-ink-500 truncate">
                      {c.formation === 'Ambos' ? 'Nutricionista e técnico' : c.formation || 'Formação não informada'}{x.idade ? `, ${x.idade}` : ''}
                    </p>
                    {nota && <p className="text-xs text-ink-700 mt-1 line-clamp-1" title={nota}><span className="text-ink-400">Última nota:</span> {nota}</p>}
                  </div>
                  <span className={`badge justify-self-end lg:hidden ${PIPELINE_COLORS[c.pipeline_stage] || 'bg-ink-100 text-ink-600'}`}>{c.pipeline_stage}</span>
                  <p className="col-span-2 lg:col-span-1 text-sm text-ink-700 truncate">{[c.city, c.state].filter(Boolean).join(', ') || '—'}</p>
                  <div className="col-span-2 lg:col-span-1 min-w-0">
                    <p className={`text-sm truncate ${semExp ? 'text-ink-400' : 'text-ink-700'}`}>{semExp ? 'Primeira oportunidade' : c.experience_time || '—'}{!semExp && c.experience_area ? ` em ${c.experience_area}` : ''}</p>
                    {x.volume_refeicoes && !/não poss/i.test(x.volume_refeicoes) && <p className="text-xs text-ink-500 truncate">{x.volume_refeicoes} refeições</p>}
                  </div>
                  <div className="col-span-2 lg:col-span-1 min-w-0 hidden lg:block">
                    <p className="text-sm text-ink-700 truncate">{x.available_start || '—'}</p>
                    {x.work_hours && <p className="text-xs text-ink-500 truncate">{x.work_hours === QUALQUER_ESCALA ? 'Qualquer escala' : x.work_hours}</p>}
                  </div>
                  <span className={`badge justify-self-start hidden lg:inline-flex ${PIPELINE_COLORS[c.pipeline_stage] || 'bg-ink-100 text-ink-600'}`}>{c.pipeline_stage}</span>
                  <div className="col-span-2 lg:col-span-1 flex items-center justify-end gap-0.5 -my-1" onClick={e => e.stopPropagation()}>
                    {c.whatsapp && (
                      <a href={formatWhatsApp(c.whatsapp)} target="_blank" rel="noreferrer" className="btn-ghost p-2 !min-h-0" title="Chamar no WhatsApp" aria-label="Chamar no WhatsApp">
                        <MessageCircle size={16} className="text-green-700" />
                      </a>
                    )}
                    <button onClick={() => navigate(`/candidatos/${c.id}/editar`)} className="btn-ghost p-2 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100" title="Editar" aria-label="Editar"><Pencil size={15} /></button>
                    <button onClick={async () => { if (await confirmar({ titulo: `Excluir ${c.full_name || 'candidato'}?`, perigo: true })) deleteCandidate.mutate(c.id) }}
                      className="btn-ghost p-2 text-ink-400 hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100" title="Excluir" aria-label="Excluir"><Trash2 size={15} /></button>
                  </div>
                </div>
              )
            })}
          </div>
          )}
          {(candidates?.length ?? 0) > 0 && <div className="card"><Pagination page={page} total={totalCount} pageSize={PAGE_SIZE} onChange={p => { setPage(p) }} /></div>}
        </>
      )}

      {/* Modal de importação */}
      {importModal && (
        <div className="modal-overlay">
          <div className="bg-white rounded-2xl shadow-lift w-full max-w-3xl max-h-[92vh] flex flex-col">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
