import { useState, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, Search } from 'lucide-react'
import Sidebar from './Sidebar'
import GlobalSearch from '../ui/GlobalSearch'

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onCollapse={setCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <div className="flex md:hidden items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur border-b border-ink-100 flex-shrink-0 sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 -ml-1.5 rounded-lg hover:bg-ink-100 active:scale-95 transition-all">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="TIN" className="w-7 h-7 rounded-lg shadow-glow" />
            <span className="font-display font-extrabold text-ink-900">TIN</span>
          </div>
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto p-2 rounded-xl hover:bg-ink-100 active:scale-95 transition-all"
          >
            <Search size={18} />
          </button>
        </div>

        {/* Desktop search bar hint */}
        <div className="hidden md:flex items-center px-6 py-3 bg-white/70 backdrop-blur border-b border-ink-100 flex-shrink-0 sticky top-0 z-20">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-ink-200 text-sm text-ink-400 hover:border-ink-300 hover:bg-ink-50 transition-all shadow-soft"
          >
            <Search size={14} />
            <span>Busca global</span>
            <kbd className="ml-6 text-xs bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded-md border border-ink-200 font-sans">Ctrl K</kbd>
          </button>
        </div>

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          <div className="min-w-0 w-full max-w-7xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
