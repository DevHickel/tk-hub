import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import crypto from 'node:crypto'
import path from 'node:path'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import type { TKProcedureSyncJobData } from '../queues/tk-procedure-sync.queue.js'
import { supabase } from '../lib/supabase.js'
import { pdfQueue } from '../queues/pdf.queue.js'
import { safeLog } from '../lib/logger.js'
import { TKApiClient } from '../services/tk-api.client.js'

/**
 * Worker que processa um evento de sync de procedimento da TK.
 *
 * Fluxo:
 *   1. Resolve o conteúdo do arquivo (file_url > file_base64 > download via TKApiClient).
 *   2. Calcula sha256 → checa duplicata em documents.file_hash. Se já existe e o
 *      external_id bate, sai idempotente.
 *   3. Faz upload pro Supabase Storage, insere row em documents marcando
 *      external_id/external_provider/source='tk-sync', e enfileira no pdf.queue
 *      pra rodar o pipeline RAG (extração, chunking, embedding).
 *   4. Marca external_sync_events.status = 'processed' ou 'error'.
 */
export function setupTKProcedureSyncWorker() {
  const worker = new Worker<TKProcedureSyncJobData>(
    QUEUES.TK_PROCEDURE_SYNC,
    async (job) => {
      const { eventId, externalId, eventType, title, fileUrl, fileBase64, metadata } = job.data

      try {
        // Evento 'deleted': arquiva docs ligados ao external_id (não deleta — preserva auditoria)
        if (eventType === 'procedure.deleted') {
          const { error: archiveErr } = await supabase
            .from('documents')
            .update({ status: 'archived' })
            .eq('external_provider', 'tk')
            .eq('external_id', externalId)
          if (archiveErr) throw archiveErr
          await markEvent(eventId, 'processed', null)
          safeLog('info', 'TK procedure archived', { externalId })
          return
        }

        // 1. Resolver o buffer do arquivo
        let buffer: Buffer
        let fileName: string

        if (fileBase64) {
          buffer = Buffer.from(fileBase64, 'base64')
          fileName = sanitizeFileName(title || `${externalId}.pdf`)
        } else if (fileUrl) {
          const res = await fetch(fileUrl)
          if (!res.ok) throw new Error(`Failed to download from file_url: ${res.status}`)
          buffer = Buffer.from(await res.arrayBuffer())
          fileName = sanitizeFileName(title || extractFileNameFromUrl(fileUrl) || `${externalId}.pdf`)
        } else {
          // Sem URL nem base64 → tenta puxar via TK API client
          const cfg = await getTKConfig()
          if (!cfg.base_url || !cfg.api_token) {
            throw new Error('TK base_url/api_token não configurados — não há como baixar o arquivo')
          }
          const client = new TKApiClient(cfg.base_url, cfg.api_token)
          const downloaded = await client.downloadProcedureFile(externalId)
          buffer = downloaded.buffer
          fileName = sanitizeFileName(downloaded.fileName || title || `${externalId}.pdf`)
        }

        // Validação magic bytes (mesma do /api/upload — security/SKILL.md §3)
        const header = buffer.slice(0, 4).toString()
        if (!header.startsWith('%PDF')) {
          throw new Error('Arquivo recebido não é um PDF válido (magic bytes)')
        }

        // 2. Dedup por hash
        const fileHash = crypto.createHash('sha256').update(buffer).digest('hex')
        const { data: existing } = await supabase
          .from('documents')
          .select('id, external_id, external_provider')
          .eq('file_hash', fileHash)
          .maybeSingle()

        if (existing) {
          // Mesmo hash já indexado — se for o mesmo external_id, idempotente.
          // Se for de outra fonte, vincula esse doc ao external_id pra próximos events.
          await supabase
            .from('documents')
            .update({ external_id: externalId, external_provider: 'tk' })
            .eq('id', existing.id)
          await markEvent(eventId, 'skipped', 'Documento já existe (hash idêntico)')
          safeLog('info', 'TK procedure dedup hit', { externalId, documentId: existing.id })
          return
        }

        // 3. Upload pro Storage + criar row em documents
        const ext = path.extname(fileName).toLowerCase() || '.pdf'
        const safeName = `${crypto.randomUUID()}${ext}`
        const storagePath = `documents/${safeName}`

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, buffer, { contentType: 'application/pdf' })
        if (uploadError) throw uploadError

        const { data: doc, error: dbError } = await supabase
          .from('documents')
          .insert({
            file_name: fileName,
            file_path: storagePath,
            file_hash: fileHash,
            source: 'tk-sync',
            status: 'queued',
            external_id: externalId,
            external_provider: 'tk',
            metadata: metadata ?? null,
          })
          .select('id')
          .single()
        if (dbError) throw dbError

        await pdfQueue.add('process', {
          documentId: String(doc.id),
          filePath: storagePath,
          fileName,
        })

        await markEvent(eventId, 'processed', null)
        safeLog('info', 'TK procedure synced', { externalId, documentId: doc.id, fileName })
      } catch (error) {
        Sentry.captureException(error, { tags: { worker: 'tk-procedure-sync' } })
        const msg = (error as Error).message
        await markEvent(eventId, 'error', msg)
        safeLog('error', 'TK procedure sync failed', { externalId, error: msg })
        throw error
      }
    },
    { connection: redis, concurrency: 2 },
  )

  worker.on('failed', (job, err) => {
    safeLog('error', `TK procedure sync job ${job?.id} falhou`, { error: err.message })
  })

  return worker
}

async function getTKConfig() {
  const { data } = await supabase
    .from('external_sync_config')
    .select('base_url, api_token')
    .eq('provider', 'tk')
    .maybeSingle()
  return data ?? { base_url: null, api_token: null }
}

async function markEvent(eventId: string, status: string, errorMessage: string | null) {
  await supabase
    .from('external_sync_events')
    .update({ status, error_message: errorMessage })
    .eq('id', eventId)
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\-.\s]/g, '_').slice(0, 200)
}

function extractFileNameFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ?? null
  } catch {
    return null
  }
}
