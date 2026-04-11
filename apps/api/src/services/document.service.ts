// CRUD de documentos — sem client_id (produto interno, database/SKILL.md)

import { supabase } from '../lib/supabase.js'
import { safeLog } from '../lib/logger.js'
import type { DocumentFields } from './extraction.service.js'

export async function checkDuplicateHash(hash: string): Promise<boolean> {
  const { data } = await supabase
    .from('documents')
    .select('id')
    .eq('file_hash', hash)
    .maybeSingle()
  return !!data
}

export async function createDocument(params: {
  uploadedBy: string
  fileName: string
  filePath: string
  fileHash: string
  source?: string
}) {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      uploaded_by: params.uploadedBy,
      file_name: params.fileName,
      file_path: params.filePath,
      file_hash: params.fileHash,
      source: params.source ?? 'upload',
      status: 'queued',
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateDocument(
  documentId: string,
  fields: Partial<DocumentFields> & { status?: string; content?: string }
) {
  const { error } = await supabase
    .from('documents')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', documentId)

  if (error) {
    safeLog('error', 'Erro ao atualizar documento', { documentId, error: error.message })
    throw error
  }
}

export async function updateDocumentStatus(documentId: string, status: string) {
  return updateDocument(documentId, { status })
}

export async function listDocuments(filters: {
  status?: string
  tipo?: string
  search?: string
  expiringDays?: number
  page?: number
  pageSize?: number
} = {}) {
  const { status, tipo, search, expiringDays, page = 0, pageSize = 20 } = filters

  let query = supabase
    .from('documents')
    .select('*', { count: 'exact' })
    .not('file_name', 'is', null) // só docs DMS (com file_name)
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status) query = query.eq('status', status)
  if (tipo) query = query.eq('tipo', tipo)
  if (search) {
    query = query.or(
      `file_name.ilike.%${search}%,colaborador.ilike.%${search}%,tipo.ilike.%${search}%`
    )
  }
  if (expiringDays) {
    const now = new Date().toISOString().split('T')[0]
    const future = new Date(Date.now() + expiringDays * 86400000).toISOString().split('T')[0]
    query = query.gte('data_vencimento', now).lte('data_vencimento', future)
  }

  return query
}

export async function getDocumentById(id: string) {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function archiveDocument(id: string) {
  return updateDocument(id, { status: 'archived' })
}
