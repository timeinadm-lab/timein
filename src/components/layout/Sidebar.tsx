import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, FileText, ShieldCheck, UserCheck,
  CreditCard, Calendar, MessageSquare, Settings, LogOut,
  ChevronLeft, ChevronRight, Briefcase, UserPlus, X, ClipboardList, UserCog, ListChecks
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { getInitials } from '../../lib/utils'

const CHEFE_MENU = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Users, label: 'Clientes', path: '/clientes' },
  { icon: ShieldCheck, label: 'Supervisão', path: '/supervisao' },
  { icon: ClipboardList, label: 'Visitas', path: '/visitas' },
  { icon: UserCheck, label: 'Colaboradores', path: '/colaboradores' },
  { icon: Briefcase, label: 'Vagas', path: '/vagas' },
  { icon: UserPlus, label: 'Candidatos', path: '/candidatos' },
  { icon: CreditCard, label: 'Pagamentos', path: '/pagamentos' },
  { icon: Calendar, label: 'Agenda', path: '/agenda' },
  { icon: ListChecks, label: 'Atividades', path: '/atividades' },
  { icon: MessageSquare, label: 'Chat', path: '/chat' },
  { icon: Settings, label: 'Usuários', path: '/usuarios' },
]

const RECRUTADOR_MENU = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: Users, label: 'Clientes', path: '/clientes' },
  { icon: ShieldCheck, label: 'Supervisão', path: '/supervisao' },
  { icon: UserCheck, label: 'Colaboradores', path: '/colaboradores' },
  { icon: Briefcase, label: 'Vagas', path: '/vagas' },
  { icon: UserPlus, label: 'Candidatos', path: '/candidatos' },
  { icon: ClipboardList, label: 'Visitas', path: '/visitas' },
  { icon: FileText, label: 'Templates', path: '/templates' },
  { icon: Calendar, label: 'Agenda', path: '/agenda' },
  { icon: ListChecks, label: 'Atividades', path: '/atividades' },
  { icon: MessageSquare, label: 'Chat', path: '/chat' },
]

interface Props {
  collapsed: boolean
  onCollapse: (v: boolean) => void
  mobileOpen: boolean
  onMobileClose: () => void
}

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }: Props) {
  const { profile, role, signOut } = useAuth()
  const navigate = useNavigate()
  const menu = role === 'chefe' ? CHEFE_MENU : RECRUTADOR_MENU

  const handleSignOut = () => { signOut() }

  const inner = (
    <div className={`flex flex-col h-full bg-white border-r border-ink-100 transition-all duration-300 ${collapsed ? 'w-16' : 'w-64'}`}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5">
        <img src="/logo.svg" alt="TIN" className="w-9 h-9 rounded-xl flex-shrink-0 shadow-glow" />
        {!collapsed && (
          <div className="leading-none">
            <span className="font-display font-extrabold text-ink-900 text-lg tracking-tight block">TIN</span>
            <span className="text-[10px] font-semibold text-primary-600 uppercase tracking-wider">Time IN</span>
          </div>
        )}
      </div>

      {/* User */}
      {!collapsed && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-2xl bg-ink-50/80 border border-ink-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-sm flex-shrink-0">
              {getInitials(profile?.full_name || 'U')}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-semibold text-ink-900 truncate leading-tight">{profile?.full_name}</p>
              <span className={`badge text-[10px] mt-0.5 ${role === 'chefe' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                {role === 'chefe' ? 'Chefe' : 'Recrutador'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-2 space-y-1">
        {menu.map(item => (
          <NavLink
            key={item.path + item.label}
            to={item.path}
            end={item.path === '/'}
            onClick={onMobileClose}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
              } ${collapsed ? 'justify-center' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary-600" />}
                <item.icon size={18} className="flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2.5 py-3 border-t border-ink-100 space-y-1">
        <NavLink
          to="/perfil"
          onClick={onMobileClose}
          title={collapsed ? 'Meu Perfil' : undefined}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              isActive ? 'bg-primary-50 text-primary-700' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
            } ${collapsed ? 'justify-center' : ''}`
          }
        >
          <UserCog size={18} className="flex-shrink-0" />
          {!collapsed && <span>Meu Perfil</span>}
        </NavLink>
        <button
          onClick={() => onCollapse(!collapsed)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-ink-400 hover:bg-ink-50 hover:text-ink-700 transition-all ${collapsed ? 'justify-center' : ''}`}
        >
          {collapsed ? <ChevronRight size={18} /> : <><ChevronLeft size={18} /><span>Recolher</span></>}
        </button>
        <button
          onClick={handleSignOut}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-500 hover:bg-red-50 transition-all ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={18} className="flex-shrink-0" />
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
          <div className="absolute inset-0 bg-black/40" onClick={onMobileClose} />
          <div className="relative h-full w-64 flex-shrink-0">
            <div className="absolute top-4 right-4 z-50">
              <button onClick={onMobileClose} className="p-1 rounded-full bg-white shadow">
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
