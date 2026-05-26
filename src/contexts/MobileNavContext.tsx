import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface MobileNavCtx {
  open: boolean
  setOpen: (b: boolean) => void
  toggle: () => void
}

const MobileNavContext = createContext<MobileNavCtx | null>(null)

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <MobileNavContext.Provider value={{ open, setOpen, toggle: () => setOpen((v) => !v) }}>
      {children}
    </MobileNavContext.Provider>
  )
}

export function useMobileNav(): MobileNavCtx {
  const ctx = useContext(MobileNavContext)
  if (!ctx) {
    return { open: false, setOpen: () => {}, toggle: () => {} }
  }
  return ctx
}
