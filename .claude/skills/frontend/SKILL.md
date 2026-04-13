---
name: frontend
description: Regras para o frontend React da TK Solution
---

# Frontend — Padrões e Regras

## TanStack Query — obrigatório para toda requisição

Nunca usar fetch direto em componentes. Sempre TanStack Query.

```typescript
// hooks/useDocuments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useDocuments() {
  return useQuery({
    queryKey: ['documents'],
    queryFn: () => api.listDocuments(),
    staleTime: 1000 * 60,  // 1 minuto de cache
  })
}

export function useUploadDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.uploadDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })
}
```

## Polling do status de job (BullMQ)

```typescript
export function useJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.getJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (data) => {
      // para de fazer polling quando job completar ou falhar
      if (data?.state === 'completed' || data?.state === 'failed') return false
      return 2000  // polling a cada 2 segundos
    },
  })
}
```

## API client tipado

```typescript
// lib/api.ts
const BASE_URL = import.meta.env.VITE_API_URL

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = supabase.auth.getSession()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${(await token).data.session?.access_token}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
}

export const api = {
  listDocuments: () => request<Document[]>('/api/documents'),
  uploadDocument: (form: FormData) => request<{ jobId: string }>('/api/upload', {
    method: 'POST', body: form
  }),
  getJobStatus: (jobId: string) => request<JobStatus>(`/api/jobs/${jobId}/status`),
  chat: (question: string) => request<ChatResponse>('/api/chat', {
    method: 'POST', body: JSON.stringify({ question })
  }),
}
```

## Sentry no frontend

```typescript
// main.tsx — inicializar antes de tudo
import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
})
```

## Dark/Light mode

Usar CSS variables com classe no `<html>`:
- `class="dark"` → dark mode
- sem classe → light mode

Todas as cores via variáveis CSS. Nunca hardcoded.
Toggle salva preferência no localStorage.

## Variáveis de ambiente do frontend

```
VITE_API_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SENTRY_DSN=
```
