import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function useChat() {
  return useMutation({
    mutationFn: ({ message, conversationId }: { message: string; conversationId?: string }) =>
      api.chat(message, conversationId),
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })
}
