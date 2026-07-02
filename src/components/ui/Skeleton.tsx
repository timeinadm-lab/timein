import { LucideIcon } from 'lucide-react'

// Bloco cinza pulsante — base de todos os skeletons
export function Bone({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-ink-100 rounded-lg ${className}`} />
}

// Lista em grade (ClientList, EmployeeList, VacancyList...) — cards fantasma
export function SkeletonCards({ count = 6, cols = 3 }: { count?: number; cols?: 1 | 2 | 3 }) {
  const grid = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
  return (
    <div className={`grid ${grid} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-5">
          <div className="flex items-start gap-3">
            <Bone className="w-11 h-11 rounded-2xl flex-shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Bone className="h-4 w-3/4" />
              <Bone className="h-3 w-1/2" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-ink-50 flex items-center justify-between">
            <Bone className="h-3 w-24" />
            <Bone className="h-5 w-12 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Linhas de lista/tabela fantasma (PaymentList, listas verticais)
export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="card divide-y divide-ink-50 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Bone className="w-9 h-9 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-3.5 w-2/5" />
            <Bone className="h-3 w-1/4" />
          </div>
          <Bone className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// Página de detalhe fantasma (hero + abas + conteúdo)
export function SkeletonDetail() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Bone className="h-8 w-24" />
      <div className="card p-5 flex items-center gap-4">
        <Bone className="w-14 h-14 rounded-2xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Bone className="h-6 w-1/2" />
          <Bone className="h-3.5 w-1/3" />
        </div>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Bone key={i} className="h-9 w-24 rounded-xl" />)}
      </div>
      <div className="card p-5 space-y-3">
        <Bone className="h-4 w-1/3" />
        <Bone className="h-3.5 w-full" />
        <Bone className="h-3.5 w-5/6" />
        <Bone className="h-3.5 w-2/3" />
      </div>
    </div>
  )
}

// Estado vazio amigável — ícone, título, dica e ação opcional
export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction }: {
  icon: LucideIcon
  title: string
  hint?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="card p-10 md:p-14 text-center">
      <div className="w-16 h-16 rounded-3xl bg-primary-50 flex items-center justify-center mx-auto mb-4">
        <Icon size={28} className="text-primary-400" />
      </div>
      <p className="font-display font-bold text-ink-900">{title}</p>
      {hint && <p className="text-sm text-ink-400 mt-1 max-w-sm mx-auto">{hint}</p>}
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn-primary text-sm mt-5">{actionLabel}</button>
      )}
    </div>
  )
}
