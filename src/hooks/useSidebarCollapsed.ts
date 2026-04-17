import { useState, useCallback } from 'react'

const STORAGE_KEY = 'sidebar-collapsed'

export function useSidebarCollapsed(defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) return stored === 'true'
    return defaultCollapsed
  })

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

  return { collapsed, toggle, collapse }
}
