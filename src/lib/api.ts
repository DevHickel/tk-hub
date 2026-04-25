// Cliente de API tipado — chama o backend Hono (frontend/SKILL.md)
// Nunca fetch puro em componentes — sempre via hooks TanStack Query

import { supabase } from '@/integrations/supabase/client'

const BASE_URL = import.meta.env.VITE_API_URL as string

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken()

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `API error ${res.status}`)
  }

  return res.json() as Promise<T>
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ChatResponse {
  response: string
}

export interface UploadResponse {
  success: boolean
  documentId: string
  jobId: string
  message: string
}

export interface JobStatus {
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  progress: number
  documentId: string
}

export interface Document {
  id: string | number
  file_name: string | null
  file_path: string | null
  file_hash: string | null
  content: string | null
  tipo: string | null
  colaborador: string | null
  data_emissao: string | null
  data_vencimento: string | null
  emissor: string | null
  status: string | null
  source: string | null
  uploaded_by: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ReportConfig {
  id?: string
  language?: 'pt' | 'en'
  hour_cost_brl?: number
  benchmark_search_min?: number
  benchmark_doc_process_min?: number
  benchmark_alert_min?: number
  benchmark_email_triage_min?: number
  send_day?: number   // 0=domingo ... 6=sábado
  send_hour?: number  // 0-23 (BRT)
  monthly_fixed_cost_brl?: number  // custo fixo mensal de infra
  updated_at?: string
}

export interface ReportRecipient {
  id: string
  email: string
  name: string
  report_type: 'management' | 'hr' | 'it' | 'all'
  active: boolean
  created_at: string
}

export interface EmailConfig {
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_pass: string  // mascarado no GET
  from_name: string
  from_email: string
}

export interface CertificateInbox {
  id: string
  label: string
  imap_host: string
  imap_port: number
  imap_user: string
  imap_pass: string  // mascarado no GET
  use_tls: boolean
  active: boolean
  last_uid: number
  uid_validity: number
  last_checked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface DocumentsResponse {
  data: Document[]
  total: number
  page: number
  pageSize: number
}

// ── API client ────────────────────────────────────────────────────────────────

export const api = {
  // Chat RAG
  chat: (message: string, conversation_id?: string) =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message, conversation_id }),
    }),

  // Upload de PDF
  uploadDocument: async (file: File): Promise<UploadResponse> => {
    const token = await getToken()
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { error?: string }).error ?? `Upload error ${res.status}`)
    }

    return res.json()
  },

  // Status de job (polling)
  getJobStatus: (jobId: string) =>
    request<JobStatus>(`/api/jobs/${jobId}/status`),

  // Documentos DMS
  listDocuments: (params: {
    status?: string
    tipo?: string
    search?: string
    expiring?: number
    page?: number
    pageSize?: number
  } = {}) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v))
    })
    return request<DocumentsResponse>(`/api/documents?${qs}`)
  },

  getDocument: (id: string) => request<Document>(`/api/documents/${id}`),

  updateDocument: (id: string, data: Partial<Document>) =>
    request<{ success: boolean }>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  archiveDocument: (id: string) =>
    request<{ success: boolean }>(`/api/documents/${id}`, { method: 'DELETE' }),

  // ── Relatórios ──────────────────────────────────────────────────────────────
  getReportConfig: () => request<ReportConfig>('/api/reports/config'),

  updateReportConfig: (data: Partial<ReportConfig>) =>
    request<{ success: boolean }>('/api/reports/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listRecipients: () => request<ReportRecipient[]>('/api/reports/recipients'),

  addRecipient: (data: Omit<ReportRecipient, 'id' | 'active' | 'created_at'>) =>
    request<ReportRecipient>('/api/reports/recipients', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRecipient: (id: string, data: Partial<Omit<ReportRecipient, 'id' | 'active' | 'created_at'>>) =>
    request<{ success: boolean }>(`/api/reports/recipients/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteRecipient: (id: string) =>
    request<{ success: boolean }>(`/api/reports/recipients/${id}`, { method: 'DELETE' }),

  sendTestReport: () =>
    request<{ success: boolean; message: string }>('/api/reports/send-test', { method: 'POST' }),

  // ── E-mail config (SMTP) ────────────────────────────────────────────────────
  getEmailConfig: () => request<EmailConfig>('/api/email-config'),

  updateEmailConfig: (data: Partial<EmailConfig>) =>
    request<{ success: boolean }>('/api/email-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  testEmailConfig: () =>
    request<{ success: boolean; message: string }>('/api/email-config/test', { method: 'POST' }),

  // ── Certificate Email Inboxes (IMAP) ─────────────────────────────────────────
  listCertificateInboxes: () =>
    request<CertificateInbox[]>('/api/certificate-inboxes'),

  createCertificateInbox: (data: Omit<CertificateInbox, 'id' | 'last_uid' | 'uid_validity' | 'last_checked_at' | 'last_error' | 'created_at' | 'updated_at'>) =>
    request<CertificateInbox>('/api/certificate-inboxes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateCertificateInbox: (id: string, data: Partial<CertificateInbox>) =>
    request<{ success: boolean }>(`/api/certificate-inboxes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteCertificateInbox: (id: string) =>
    request<{ success: boolean }>(`/api/certificate-inboxes/${id}`, { method: 'DELETE' }),

  testCertificateInbox: (config: { imap_host: string; imap_port: number; imap_user: string; imap_pass: string; use_tls: boolean }) =>
    request<{ success: boolean; message?: string; error?: string }>('/api/certificate-inboxes/test', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // ── Convites ────────────────────────────────────────────────────────────────
  createInvite: (email: string) =>
    request<{ id: string; email: string; token: string; expires_at: string }>('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
}
