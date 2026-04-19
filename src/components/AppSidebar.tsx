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
  const { profile, signOut, isManager } = useAuth()
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
          'flex items-center rounded-lg text-sm transition-all duration-300 overflow-hidden whitespace-nowrap',
          collapsed ? 'justify-center px-2 py-2 gap-0' : 'px-3 py-2 gap-3',
          active
            ? 'bg-[#004C97]/10 text-[#004C97] dark:text-blue-400 font-semibold'
            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className={cn(
          'transition-all duration-300 overflow-hidden',
          collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
        )}>
          {label}
        </span>
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
        'border-r bg-card flex flex-col shrink-0 overflow-hidden transition-all duration-300',
        collapsed ? 'w-14' : 'w-64'
      )}>
        {/* Logo + toggle */}
        <div className={cn(
          'border-b flex items-center transition-all duration-300',
          collapsed ? 'justify-center p-2' : 'justify-between p-4'
        )}>
          <div className={cn(
            'transition-all duration-300 overflow-hidden',
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
          )}>
            <Logo className="h-8 w-auto" />
          </div>
          {onToggle && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggle}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{collapsed ? 'Expandir menu' : 'Recolher menu'}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Nav principal */}
        <nav className={cn('flex-1 space-y-1 transition-all duration-300', collapsed ? 'p-1.5' : 'p-3')}>
          {isManager && navItem('/dashboard', <TrendingUp className="h-4 w-4" />, 'Dashboard')}
          {navItem('/chat', <MessageSquare className="h-4 w-4" />, 'Assistente IA')}
          {isManager && navItem('/documents', <FileText className="h-4 w-4" />, 'Documentos')}
          {isManager && navItem('/admin', <Shield className="h-4 w-4" />, 'Admin')}
          {isManager && navItem('/report-settings', <BarChart3 className="h-4 w-4" />, 'Relatórios')}
          {navItem('/bug-report', <Bug className="h-4 w-4" />, 'Reportar Bug')}
        </nav>

        {/* Rodapé */}
        <div className={cn('border-t space-y-1 transition-all duration-300', collapsed ? 'p-1.5' : 'p-3')}>
          <div className={cn(
            'flex items-center transition-all duration-300 overflow-hidden',
            collapsed ? 'justify-center py-1' : 'justify-between px-3 py-1'
          )}>
            <span className={cn(
              'text-xs text-muted-foreground truncate transition-all duration-300',
              collapsed ? 'w-0 opacity-0' : 'max-w-[140px] opacity-100'
            )}>
              {profile?.full_name ?? profile?.email ?? ''}
            </span>
            <ThemeToggle />
          </div>
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
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-sm transition-colors overflow-hidden whitespace-nowrap"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className={cn(
                'transition-all duration-300',
                collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
              )}>
                Sair
              </span>
            </button>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
