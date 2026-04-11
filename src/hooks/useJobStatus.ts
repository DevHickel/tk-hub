import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { useEffect, useRef } from 'react'

// Polling automático do status de job — para quando completa ou falha (frontend/SKILL.md)
export function useJobStatus(jobId: string | null) {
  const queryClient = useQueryClient()
  const notifiedRef = useRef(false)

  const query = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      if (state === 'completed' || state === 'failed') return false
      return 2000 // polling a cada 2 segundos
    },
  })

  useEffect(() => {
    if (!query.data || notifiedRef.current) return

    if (query.data.state === 'completed') {
      notifiedRef.current = true
      toast.success('Documento processado e disponível para consulta!')
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    }

    if (query.data.state === 'failed') {
      notifiedRef.current = true
      toast.error('Falha ao processar documento. Verifique o painel admin.')
    }
  }, [query.data?.state])

  return query
}
