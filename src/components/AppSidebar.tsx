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
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AppSidebarProps {
  collapsed?: boolean
  onToggle?: () => void
  onCollapse?: () => void
}

export function AppSidebar({ collapsed = false, onToggle, onCollapse }: AppSidebarProps) {
  const { profile, signOut, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const navItem = (to: string, icon: React.ReactNode, label: string) => {
    const active = location.pathname === to
    const link = (
      <Link
        to={to}
        onClick={to === '/chat' && onCollapse ? onCollapse : undefined}
        className={cn(
          'flex items-center gap-3 rounded-lg text-sm transition-colors',
          collapsed ? 'justify-center px-2 py-2' : 'px-3 py-2',
          active
            ? 'bg-[#004C97]/10 text-[#004C97] dark:text-blue-400 font-semibold'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        )}
      >
        {icon}
        {!collapsed && label}
      </Link>
    )

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
        </Tooltip>
      )
    }

    return link
  }

  return (
    <TooltipProvider delayDuration={200}>
      <aside className={cn(
        'border-r bg-card flex flex-col shrink-0 transition-all duration-200',
        collapsed ? 'w-14' : 'w-64'
      )}>
        {/* Logo + toggle */}
        <div className={cn('border-b flex items-center', collapsed ? 'justify-center p-2' : 'justify-between p-4')}>
          {!collapsed && <Logo className="h-8 w-auto" />}
          {onToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggle}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? 'Expandir menu' : 'Recolher menu'}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Nav principal */}
        <nav className={cn('flex-1 space-y-1', collapsed ? 'p-1.5' : 'p-3')}>
          {isAdmin && navItem('/dashboard', <TrendingUp className="h-4 w-4" />, 'Dashboard')}
          {navItem('/chat', <MessageSquare className="h-4 w-4" />, 'Assistente IA')}
          {isAdmin && navItem('/documents', <FileText className="h-4 w-4" />, 'Documentos')}
          {isAdmin && navItem('/admin', <Shield className="h-4 w-4" />, 'Admin')}
          {isAdmin && navItem('/report-settings', <BarChart3 className="h-4 w-4" />, 'Relatórios')}
          {navItem('/bug-report', <Bug className="h-4 w-4" />, 'Reportar Bug')}
        </nav>

        {/* Rodapé */}
        <div className={cn('border-t space-y-1', collapsed ? 'p-1.5' : 'p-3')}>
          {!collapsed && (
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                {profile?.full_name ?? profile?.email ?? ''}
              </span>
              <ThemeToggle />
            </div>
          )}
          {collapsed && (
            <div className="flex justify-center py-1">
              <ThemeToggle />
            </div>
          )}
          {navItem('/settings', <Settings className="h-4 w-4" />, 'Configurações')}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSignOut}
                  className="w-full flex justify-center py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sair</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
