import { useState, useCallback, useEffect, useRef } from 'react'

const STORAGE_KEY = 'sidebar-collapsed'
const PENDING_KEY = 'sidebar-collapse-pending'

export function useSidebarCollapsed(animateOnMount = false) {
  const [collapsed, setCollapsed] = useState(() => {
    // Se há um colapso pendente (veio de clicar em "Assistente IA"),
    // inicia expandido para animar a transição.
    if (animateOnMount && localStorage.getItem(PENDING_KEY) === 'true') {
      return false
    }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === 'true'
    return false
  })

  const didMount = useRef(false)

  useEffect(() => {
    if (!didMount.current && animateOnMount && localStorage.getItem(PENDING_KEY) === 'true') {
      didMount.current = true
      localStorage.removeItem(PENDING_KEY)
      // Esperar o primeiro frame renderizar expandido, depois colapsar com animação
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setCollapsed(true)
          localStorage.setItem(STORAGE_KEY, 'true')
        })
      })
    }
  }, [animateOnMount])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const collapse = useCallback(() => {
    setCollapsed(true)
    localStorage.setItem(STORAGE_KEY, 'true')
  }, [])

  // Marca colapso pendente — a animação roda na página de destino
  const schedulePendingCollapse = useCallback(() => {
    localStorage.setItem(PENDING_KEY, 'true')
    localStorage.setItem(STORAGE_KEY, 'true')
  }, [])

  return { collapsed, toggle, collapse, schedulePendingCollapse }
}
