import { Link, useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  TrendingUp,
  MessageSquare,
  FileText,
  Shield,
  Bug,
  BarChart3,
  Settings,
  LogOut,
} from 'lucide-react'

export function AppSidebar() {
  const { profile, signOut, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const navItem = (to: string, icon: React.ReactNode, label: string) => {
    const active = location.pathname === to
    return (
      <Link
        to={to}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? 'bg-[#004C97]/10 text-[#004C97] dark:text-blue-400 font-semibold'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        }`}
      >
        {icon}
        {label}
      </Link>
    )
  }

  return (
    <aside className="w-64 border-r bg-card flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-4 border-b">
        <Logo className="h-8 w-auto" />
      </div>

      {/* Nav principal */}
      <nav className="flex-1 p-3 space-y-1">
        {navItem('/dashboard', <TrendingUp className="h-4 w-4" />, 'Dashboard')}
        {navItem('/chat', <MessageSquare className="h-4 w-4" />, 'Assistente IA')}
        {navItem('/documents', <FileText className="h-4 w-4" />, 'Documentos')}
        {isAdmin && navItem('/admin', <Shield className="h-4 w-4" />, 'Admin')}
        {navItem('/report-settings', <BarChart3 className="h-4 w-4" />, 'Relatórios')}
        {navItem('/bug-report', <Bug className="h-4 w-4" />, 'Reportar Bug')}
      </nav>

      {/* Rodapé */}
      <div className="p-3 border-t space-y-1">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
            {profile?.full_name ?? profile?.email ?? ''}
          </span>
          <ThemeToggle />
        </div>
        {navItem('/settings', <Settings className="h-4 w-4" />, 'Configurações')}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  )
}
