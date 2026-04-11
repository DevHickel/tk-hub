import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import { PdfJobData } from '../queues/pdf.queue.js'
import { supabase } from '../lib/supabase.js'
import { parseWithLlamaParse } from '../services/llamaparse.service.js'
import { getOrCreateEmbedding, chunkText } from '../services/embedding.service.js'
import { safeLog } from '../lib/logger.js'

async function updateDocumentStatus(documentId: string, status: string) {
  await supabase
    .from('documents')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', documentId)
}

export function setupPdfWorker() {
  const worker = new Worker<PdfJobData>(
    QUEUES.PDF_PROCESSING,
    async (job) => {
      const { documentId, filePath, fileName } = job.data

      try {
        // 1. Status → processing
        await updateDocumentStatus(documentId, 'processing')
        await job.updateProgress(10)

        // 2. Baixar arquivo do Storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(filePath)

        if (downloadError) throw downloadError

        const buffer = Buffer.from(await fileData.arrayBuffer())
        await job.updateProgress(20)

        // 3. Extrair texto com LlamaParse (único parser — rag-pipeline/SKILL.md)
        const text = await parseWithLlamaParse(buffer, fileName)
        await job.updateProgress(40)

        // 4. Salvar conteúdo no documento
        await supabase
          .from('documents')
          .update({ content: text.slice(0, 50000) }) // limite razoável
          .eq('id', documentId)

        // 5. Chunkar e gerar embeddings com cache (rag-pipeline/SKILL.md)
        const chunks = chunkText(text)
        safeLog('info', 'Iniciando embeddings', { documentId, chunks: chunks.length })

        for (let i = 0; i < chunks.length; i++) {
          const embedding = await getOrCreateEmbedding(chunks[i])

          await supabase.from('document_chunks').insert({
            document_id: documentId,
            content: chunks[i],
            chunk_index: i,
            embedding: JSON.stringify(embedding),
          })

          // Progresso de 40% a 90%
          await job.updateProgress(40 + Math.floor((i / chunks.length) * 50))
        }

        // 6. Marcar como ativo
        await updateDocumentStatus(documentId, 'active')
        await job.updateProgress(100)

        safeLog('info', 'Documento processado com sucesso', { documentId, chunks: chunks.length })
      } catch (error) {
        Sentry.captureException(error, {
          tags: { job: 'pdf-processing', documentId },
        })
        await updateDocumentStatus(documentId, 'error')
        throw error // BullMQ faz retry automático (3 tentativas — queue/SKILL.md)
      }
    },
    {
      connection: redis,
      concurrency: 5, // processa até 5 PDFs ao mesmo tempo (queue/SKILL.md)
    }
  )

  worker.on('failed', (job, error) => {
    // Não logar dados sensíveis — só mensagem de erro
    safeLog('error', `Job ${job?.id} falhou após todas as tentativas`, {
      error: (error as Error).message,
      documentId: job?.data.documentId,
    })
  })

  worker.on('completed', (job) => {
    safeLog('info', `Job ${job.id} concluído`, { documentId: job.data.documentId })
  })

  return worker
}
