import { Menu } from 'lucide-react'
import { useMobileNav } from '@/contexts/MobileNavContext'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
}

export function MobileNavTrigger({ className }: Props) {
  const { toggle } = useMobileNav()
  return (
    <button
      onClick={toggle}
      aria-label="Abrir menu"
      className={cn(
        'md:hidden p-2 -ml-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors',
        className
      )}
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}
