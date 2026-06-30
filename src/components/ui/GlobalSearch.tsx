import { useEffect, useState, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Result {
  id: string
  label: string
  sub?: string
  type: string
  path: string
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function GlobalSearch({ open, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setTimeout(() => inputRef.current?.focus(), 100) }
  }, [open])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const q = `%${query}%`
        const [emp, can, cli, vac] = await Promise.all([
          supabase.from('employees').select('id,full_name,role').ilike('full_name', q).limit(5),
          supabase.from('candidates').select('id,full_name,city').ilike('full_name', q).limit(5),
          supabase.from('clients').select('id,name,contact_email').ilike('name', q).limit(5),
          supabase.from('vacancies').select('id,title,city').ilike('title', q).limit(5),
        ])
        const res: Result[] = [
          ...(emp.data || []).map(e => ({ id: e.id, label: e.full_name, sub: e.role || '', type: 'Colaborador', path: `/colaboradores/${e.id}` })),
          ...(can.data || []).map(c => ({ id: c.id, label: c.full_name, sub: c.city || '', type: 'Candidato', path: `/candidatos/${c.id}` })),
          ...(cli.data || []).map(c => ({ id: c.id, label: c.name, sub: c.contact_email || '', type: 'Cliente', path: `/clientes/${c.id}` })),
          ...(vac.data || []).map(v => ({ id: v.id, label: v.title, sub: v.city || '', type: 'Vaga', path: `/vagas/${v.id}` })),
        ]
        setResults(res)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  if (!open) return null

  const TYPE_COLORS: Record<string, string> = {
    Colaborador: 'bg-blue-100 text-blue-700',
    Candidato: 'bg-purple-100 text-purple-700',
    Cliente: 'bg-green-100 text-green-700',
    Vaga: 'bg-orange-100 text-orange-700',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <Search size={18} className="text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar colaboradores, candidatos, clientes, vagas..."
            className="flex-1 outline-none text-sm"
          />
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && <div className="p-4 text-center text-sm text-gray-500">Buscando...</div>}
          {!loading && query && results.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">Nenhum resultado</div>
          )}
          {results.map(r => (
            <button
              key={`${r.type}-${r.id}`}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left"
              onClick={() => { navigate(r.path); onClose() }}
            >
              <span className={`badge ${TYPE_COLORS[r.type]}`}>{r.type}</span>
              <div>
                <p className="text-sm font-medium">{r.label}</p>
                {r.sub && <p className="text-xs text-gray-500">{r.sub}</p>}
              </div>
            </button>
          ))}
        </div>
        {!query && (
          <div className="p-4 text-center text-xs text-gray-400">Digite para buscar no sistema</div>
        )}
      </div>
    </div>
  )
}
