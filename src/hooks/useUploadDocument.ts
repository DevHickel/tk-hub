import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function useUploadDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (file: File) => api.uploadDocument(file),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success(`Documento enviado. Processando em background... (Job: ${data.jobId})`)
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
