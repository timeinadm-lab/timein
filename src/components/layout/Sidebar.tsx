import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Building2, FileText, ShieldCheck, UserCheck,
  Wallet, Calendar, MessageSquare, Settings, LogOut,
  ChevronLeft, ChevronRight, Briefcase, UserPlus, X, ClipboardCheck, ListChecks, CalendarDays, Landmark,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getInitials, corDoAvatar } from '../../lib/utils'
import { SignedImage } from '../ui/SignedFile'

type Item = { icon: LucideIcon; label: string; path: string; so?: 'chefe' | 'contabilidade' }
type Grupo = { titulo?: string; itens: Item[] }

// Menu em blocos. Antes eram 14 itens soltos, na ordem em que foram criados.
const MENU: Grupo[] = [
  { itens: [{ icon: LayoutDashboard, label: 'Início', path: '/' }] },
  {
    titulo: 'Operação',
    itens: [
      { icon: UserCheck, label: 'Colaboradores', path: '/colaboradores' },
      { icon: Building2, label: 'Clientes', path: '/clientes' },
      { icon: ClipboardCheck, label: 'Visitas', path: '/visitas' },
      { icon: ShieldCheck, label: 'Supervisão', path: '/supervisao' },
    ],
  },
  {
    titulo: 'Recrutamento',
    itens: [
      { icon: Briefcase, label: 'Vagas', path: '/vagas' },
      { icon: UserPlus, label: 'Candidatos', path: '/candidatos' },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { icon: Wallet, label: 'Pagamentos', path: '/pagamentos', so: 'chefe' },
      { icon: Landmark, label: 'Financeiro', path: '/financeiro', so: 'contabilidade' },
    ],
  },
  {
    titulo: 'Agenda',
    itens: [
      { icon: CalendarDays, label: 'Calendário', path: '/calendario' },
      { icon: Calendar, label: 'Reuniões', path: '/agenda' },
      { icon: ListChecks, label: 'Atividades', path: '/atividades' },
      { icon: MessageSquare, label: 'Chat', path: '/chat' },
    ],
  },
  {
    titulo: 'Configurações',
    itens: [
      { icon: FileText, label: 'Templates', path: '/templates' },
      { icon: Settings, label: 'Usuários', path: '/usuarios', so: 'chefe' },
    ],
  },
]

interface Props {
  collapsed: boolean
  onCollapse: (v: boolean) => void
  mobileOpen: boolean
  onMobileClose: () => void
}

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }: Props) {
  const { profile, role, isContabilidade, signOut } = useAuth()
  const navigate = useNavigate()

  const podeVer = (i: Item) =>
    !i.so || (i.so === 'chefe' ? role === 'chefe' : isContabilidade)
  const grupos = MENU
    .map(g => ({ ...g, itens: g.itens.filter(podeVer) }))
    .filter(g => g.itens.length > 0)

  const inner = (
    // Verde-escuro da marca: dá identidade a todas as telas sem colorir o conteúdo
    <div className={`flex flex-col h-full bg-primary-900 text-primary-100 transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className={`flex items-center gap-2.5 px-4 pt-5 pb-4 ${collapsed ? 'justify-center px-0' : ''}`}>
        <img src="/logo.svg" alt="TIN" className="w-8 h-8 rounded-lg flex-shrink-0" />
        {!collapsed && (
          <div className="leading-none">
            <span className="font-serif text-2xl text-white block leading-none">TIN</span>
            <span className="text-[10px] text-primary-300">Time IN</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 pb-3 scrollbar-none">
        {grupos.map((g, gi) => (
          <div key={g.titulo || gi} className={gi > 0 ? 'mt-4' : ''}>
            {g.titulo && !collapsed && (
              <p className="px-3 mb-1 text-[11px] font-medium text-primary-400">{g.titulo}</p>
            )}
            {g.titulo && collapsed && <div className="mx-3 mb-2 border-t border-white/10" />}
            <div className="space-y-0.5">
              {g.itens.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onMobileClose}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-white/[0.12] text-white font-medium'
                        : 'text-primary-100/75 hover:bg-white/[0.06] hover:text-white'
                    } ${collapsed ? 'justify-center' : ''}`
                  }
                >
                  <item.icon size={17} className="flex-shrink-0" strokeWidth={1.75} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Rodapé: quem está logado (abre Meu Perfil), recolher e sair */}
      <div className="px-2.5 py-3 border-t border-white/10 space-y-0.5">
        <button
          type="button"
          onClick={() => { navigate('/perfil'); onMobileClose?.() }}
          title="Meu perfil"
          className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-white/[0.06] transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          <div className={`w-8 h-8 rounded-full overflow-hidden flex items-center justify-center font-semibold text-xs flex-shrink-0 ${corDoAvatar(profile?.full_name)}`}>
            {profile?.photo_url
              ? <SignedImage value={profile.photo_url} bucket="fotos de funcionários" alt={profile.full_name || 'foto'} className="w-full h-full object-cover" />
              : getInitials(profile?.full_name || 'U')}
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-white truncate leading-tight">{profile?.full_name}</p>
              <p className="text-[11px] text-primary-300">
                {isContabilidade ? 'Contabilidade' : role === 'chefe' ? 'Chefe' : 'Recrutador'}
              </p>
            </div>
          )}
        </button>
        <button
          onClick={() => onCollapse(!collapsed)}
          className={`hidden md:flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-primary-300 hover:bg-white/[0.06] hover:text-white transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} /><span>Recolher</span></>}
        </button>
        <button
          onClick={() => signOut()}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-primary-300 hover:bg-white/[0.06] hover:text-white transition-colors ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={17} className="flex-shrink-0" strokeWidth={1.75} />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex h-screen sticky top-0 flex-shrink-0">
        {inner}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink-900/50 animate-fade-in" onClick={onMobileClose} />
          <div className="relative h-full w-64 max-w-[85vw] flex-shrink-0 shadow-lift">
            <div className="absolute top-4 right-3 z-50">
              <button onClick={onMobileClose} className="p-2 rounded-lg bg-white/10 text-white active:scale-95" aria-label="Fechar menu">
                <X size={18} />
              </button>
            </div>
            <div className="h-full">
              {inner}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
