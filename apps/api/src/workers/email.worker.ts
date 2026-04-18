// Worker de email — processa emails com anexo PDF do Gmail (dms/SKILL.md)
// Webhook recebe → enfileira → worker baixa o PDF → enfileira no pdfQueue

import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import { EmailJobData } from '../queues/email.queue.js'
import { pdfQueue } from '../queues/pdf.queue.js'
import { supabase } from '../lib/supabase.js'
import { getEmailWithAttachments } from '../services/email.service.js'
import { checkDuplicateHash } from '../services/document.service.js'
import { safeLog } from '../lib/logger.js'
import crypto from 'crypto'
import path from 'path'
import { randomUUID } from 'crypto'

export function setupEmailWorker() {
  const worker = new Worker<EmailJobData>(
    QUEUES.EMAIL_PROCESSING,
    async (job) => {
      const { messageId, from } = job.data

      try {
        // 1. Buscar email completo com anexos
        const { subject, attachments } = await getEmailWithAttachments(messageId)
        safeLog('info', 'Email recebido', { from, attachments: attachments.length })

        for (const attachment of attachments) {
          // Só processar PDFs
          if (!attachment.mimeType.includes('pdf')) continue

          // Verificar magic bytes
          const header = attachment.buffer.slice(0, 4).toString()
          if (!header.startsWith('%PDF')) {
            safeLog('warn', 'Anexo não é PDF válido', { filename: attachment.filename })
            continue
          }

          // Hash para evitar duplicatas
          const fileHash = crypto
            .createHash('sha256')
            .update(attachment.buffer)
            .digest('hex')

          const isDuplicate = await checkDuplicateHash(fileHash)
          if (isDuplicate) {
            safeLog('info', 'Anexo duplicado ignorado', { filename: attachment.filename })
            continue
          }

          // Salvar no Storage com nome seguro
          const ext = path.extname(attachment.filename).toLowerCase() || '.pdf'
          const safeName = `${randomUUID()}${ext}`
          const storagePath = `documents/email/${safeName}`

          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(storagePath, attachment.buffer, { contentType: 'application/pdf' })

          if (uploadError) throw uploadError

          // Criar registro no banco
          const { data: doc, error: dbError } = await supabase
            .from('documents')
            .insert({
              file_name: attachment.filename,
              file_path: storagePath,
              file_hash: fileHash,
              source: 'email',
              status: 'queued',
            })
            .select()
            .single()

          if (dbError) throw dbError

          // Enfileirar no pdfQueue para processamento completo
          await pdfQueue.add('process', {
            documentId: String(doc.id),
            filePath: storagePath,
            fileName: attachment.filename,
          })

          safeLog('info', 'Anexo enfileirado', { docId: doc.id, filename: attachment.filename })
        }
      } catch (error) {
        Sentry.captureException(error, {
          tags: { job: 'email-processing', messageId },
        })
        throw error
      }
    },
    { connection: redis, concurrency: 3 }
  )

  worker.on('failed', (job, error) => {
    safeLog('error', `Email job ${job?.id} falhou`, { error: (error as Error).message })
  })

  return worker
}
