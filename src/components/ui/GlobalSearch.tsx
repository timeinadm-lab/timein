import { useEffect, useMemo, useState, useRef } from 'react'
import { Search, X, UserCheck, UserPlus, Building2, Briefcase, CreditCard, ClipboardList, Clock, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { hojeISO, semAcento } from '../../lib/utils'

interface Result {
  id: string
  label: string
  sub?: string
  type: 'Colaborador' | 'Candidato' | 'Cliente' | 'Vaga'
  path: string
}

interface Props {
  open: boolean
  onClose: () => void
}

const soDigitos = (s: string) => s.replace(/\D/g, '')

const RECENTES_KEY = 'tin_busca_recentes'
const lerRecentes = (): Result[] => {
  try { return JSON.parse(localStorage.getItem(RECENTES_KEY) || '[]') } catch { return [] }
}
const guardarRecente = (r: Result) => {
  try {
    const lista = [r, ...lerRecentes().filter(x => !(x.type === r.type && x.id === r.id))].slice(0, 6)
    localStorage.setItem(RECENTES_KEY, JSON.stringify(lista))
  } catch { /* navegador sem armazenamento: só não lembra */ }
}

const ICONES = { Colaborador: UserCheck, Candidato: UserPlus, Cliente: Building2, Vaga: Briefcase }
const CORES: Record<Result['type'], string> = {
  Colaborador: 'bg-primary-50 text-primary-700',
  Candidato: 'bg-purple-50 text-purple-700',
  Cliente: 'bg-blue-50 text-blue-700',
  Vaga: 'bg-amber-50 text-amber-700',
}

const ATALHOS = [
  { label: 'Colaboradores', path: '/colaboradores', icon: UserCheck },
  { label: 'Pagamentos', path: '/pagamentos', icon: CreditCard },
  { label: 'Visitas', path: '/visitas', icon: ClipboardList },
  { label: 'Clientes', path: '/clientes', icon: Building2 },
  { label: 'Candidatos', path: '/candidatos', icon: UserPlus },
  { label: 'Vagas', path: '/vagas', icon: Briefcase },
]

export default function GlobalSearch({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [remotos, setRemotos] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [recentes, setRecentes] = useState<Result[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Colaboradores e clientes são poucos: vêm todos e a busca é feita aqui,
  // sem acento e por nome, CPF, telefone, e-mail ou cliente onde trabalha.
  // (A busca antiga era só pelo nome exato, com acento.)
  const { data: equipe } = useQuery({
    queryKey: ['busca-equipe'],
    enabled: open,
    staleTime: 60_000,
    queryFn: async () => {
      const hoje = hojeISO()
      const [emp, links, cli] = await Promise.all([
        supabase.from('employees').select('id,full_name,role,status,cpf,whatsapp,phone,email'),
        supabase.from('employee_client_links').select('employee_id,contract_end_date,client:clients(name)'),
        supabase.from('clients').select('id,name,contact_email'),
      ])
      const clientesDe = new Map<string, string[]>()
      for (const l of (links.data || []) as { employee_id: string; contract_end_date?: string | null; client?: { name?: string } | { name?: string }[] }[]) {
        if (l.contract_end_date && l.contract_end_date < hoje) continue
        const c = Array.isArray(l.client) ? l.client[0] : l.client
        if (!c?.name) continue
        clientesDe.set(l.employee_id, [...(clientesDe.get(l.employee_id) || []), c.name])
      }
      return {
        pessoas: (emp.data || []).map(e => ({ ...e, clientes: clientesDe.get(e.id) || [] })),
        clientes: cli.data || [],
      }
    },
  })

  useEffect(() => {
    if (open) {
      setQuery(''); setRemotos([]); setAtivo(0); setRecentes(lerRecentes())
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  const locais = useMemo<Result[]>(() => {
    const q = semAcento(query.trim())
    if (!q || !equipe) return []
    const dig = soDigitos(query)
    const pessoas = equipe.pessoas
      .filter(e => {
        const campos = [e.full_name, e.role, e.email, ...e.clientes].filter(Boolean).map(v => semAcento(String(v)))
        if (campos.some(c => c.includes(q))) return true
        return dig.length >= 3 && [e.cpf, e.whatsapp, e.phone].some(v => soDigitos(String(v || '')).includes(dig))
      })
      // Ativos primeiro, depois quem o nome COMEÇA com o que foi digitado
      .sort((a, b) =>
        Number(b.status === 'Ativo') - Number(a.status === 'Ativo')
        || Number(semAcento(b.full_name).startsWith(q)) - Number(semAcento(a.full_name).startsWith(q))
        || a.full_name.localeCompare(b.full_name))
      .slice(0, 8)
      .map(e => ({
        id: e.id,
        label: e.full_name,
        sub: [e.status !== 'Ativo' ? e.status : null, e.role, e.clientes.join(', ')].filter(Boolean).join(' · '),
        type: 'Colaborador' as const,
        path: `/colaboradores/${e.id}`,
      }))
    const clientes = equipe.clientes
      .filter(c => semAcento(c.name || '').includes(q))
      .slice(0, 5)
      .map(c => ({ id: c.id, label: c.name, sub: c.contact_email || '', type: 'Cliente' as const, path: `/clientes/${c.id}` }))
    return [...pessoas, ...clientes]
  }, [query, equipe])

  // Candidatos e vagas são muitos: continuam buscando no servidor
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) { setRemotos([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const q = `%${query.trim()}%`
        const [can, vac] = await Promise.all([
          supabase.from('candidates').select('id,full_name,city').ilike('full_name', q).limit(5),
          supabase.from('vacancies').select('id,title,city').ilike('title', q).limit(5),
        ])
        setRemotos([
          ...(can.data || []).map(c => ({ id: c.id, label: c.full_name, sub: c.city || '', type: 'Candidato' as const, path: `/candidatos/${c.id}` })),
          ...(vac.data || []).map(v => ({ id: v.id, label: v.title, sub: v.city || '', type: 'Vaga' as const, path: `/vagas/${v.id}` })),
        ])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const results = [...locais, ...remotos]
  useEffect(() => { setAtivo(0) }, [query])

  if (!open) return null

  const abrir = (r: Result) => {
    guardarRecente(r)
    navigate(r.path)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo(a => Math.min(a + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)) }
    if (e.key === 'Enter' && results[ativo]) abrir(results[ativo])
  }

  const Linha = ({ r, i }: { r: Result; i: number }) => {
    const Icone = ICONES[r.type]
    return (
      <button
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${i === ativo ? 'bg-ink-50' : 'hover:bg-ink-50'} active:bg-ink-100`}
        onMouseEnter={() => setAtivo(i)}
        onClick={() => abrir(r)}
      >
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${CORES[r.type]}`}>
          <Icone size={17} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-ink-900 truncate">{r.label}</span>
          <span className="block text-xs text-ink-400 truncate">{r.type}{r.sub ? ` · ${r.sub}` : ''}</span>
        </span>
        <ChevronRight size={16} className="text-ink-300 shrink-0" />
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-start justify-center sm:pt-20 bg-ink-900/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-xl sm:mx-4 sm:rounded-2xl shadow-lift flex flex-col max-h-full sm:max-h-[75vh]" onClick={e => e.stopPropagation()}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
          <Search size={20} className="text-primary-600 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Nome, CPF, telefone ou cliente…"
            className="flex-1 min-w-0 outline-none text-base py-1.5 bg-transparent placeholder:text-ink-400"
            autoComplete="off"
            enterKeyHint="search"
          />
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }} className="p-1.5 rounded-lg text-ink-400 hover:bg-ink-100" aria-label="Limpar">
              <X size={16} />
            </button>
          )}
          <button onClick={onClose} className="sm:hidden text-sm font-semibold text-primary-700 px-1">Fechar</button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {!query.trim() ? (
            <div className="p-4 space-y-5">
              {recentes.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5 flex items-center gap-1.5"><Clock size={12} />Abertos recentemente</p>
                  <div className="-mx-4">
                    {recentes.map((r, i) => <Linha key={`${r.type}-${r.id}`} r={r} i={i} />)}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-2">Ir para</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ATALHOS.map(a => (
                    <button key={a.path} onClick={() => { navigate(a.path); onClose() }}
                      className="flex items-center gap-2 px-3 py-3 rounded-xl border border-ink-100 bg-ink-50/50 text-sm font-semibold text-ink-700 hover:bg-ink-100 active:scale-[0.98] transition-all">
                      <a.icon size={16} className="text-primary-600" />{a.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hidden sm:block text-xs text-ink-400 text-center">Dica: <kbd className="px-1 rounded bg-ink-100 border border-ink-200">Ctrl K</kbd> abre esta busca de qualquer tela</p>
            </div>
          ) : (
            <>
              {results.map((r, i) => <Linha key={`${r.type}-${r.id}`} r={r} i={i} />)}
              {loading && <div className="px-4 py-3 text-sm text-ink-400">Buscando candidatos e vagas…</div>}
              {!loading && results.length === 0 && (
                <div className="p-8 text-center">
                  <p className="text-sm font-semibold text-ink-700">Nada encontrado</p>
                  <p className="text-xs text-ink-400 mt-1">Tente parte do nome, o CPF ou o nome do cliente.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
