import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface ListParams {
  status?: string
  tipo?: string
  search?: string
  expiring?: number
  page?: number
  pageSize?: number
}

export function useDocuments(params: ListParams = {}) {
  return useQuery({
    queryKey: ['documents', params],
    queryFn: () => api.listDocuments(params),
    staleTime: 1000 * 30, // 30 segundos
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: ['documents', id],
    queryFn: () => api.getDocument(id),
    enabled: !!id,
  })
}

export function useArchiveDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.archiveDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Documento arquivado')
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateDocument>[1] }) =>
      api.updateDocument(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Documento atualizado')
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
