---
name: queue
description: Regras para filas de processamento assíncrono com BullMQ e Redis
---

# Fila BullMQ — Processamento Assíncrono

## Por que fila existe aqui

Processar PDF leva 5–30 segundos. Se feito dentro do request HTTP:
- usuário fica esperando (péssima UX)
- timeout do servidor com múltiplos uploads simultâneos
- falha na rede = perde o processamento inteiro

Com BullMQ: request retorna imediatamente com jobId, worker processa em background,
frontend faz polling ou recebe notificação quando pronto.

## Filas do sistema

```typescript
// queues/index.ts — nomes das filas (usar exatamente esses nomes)
export const QUEUES = {
  PDF_PROCESSING: 'pdf-processing',
  EMAIL_PROCESSING: 'email-processing',
  EMBEDDING_GENERATION: 'embedding-generation',
} as const
```

## Configuração do Redis

```typescript
// lib/redis.ts
import { Redis } from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,  // obrigatório para BullMQ
  retryStrategy: (times) => Math.min(times * 50, 2000),
})
```

## Definição das filas

```typescript
// queues/pdf.queue.ts
import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface PdfJobData {
  documentId: string
  clientId: string
  filePath: string
  fileName: string
}

export const pdfQueue = new Queue<PdfJobData>(QUEUES.PDF_PROCESSING, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,                    // tenta 3x antes de falhar
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 }, // mantém últimos 100 jobs
    removeOnFail: { count: 50 },
  },
})
```

## Worker de PDF — fluxo completo

```typescript
// workers/pdf.worker.ts
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import * as Sentry from '@sentry/node'

export function setupPdfWorker() {
  const worker = new Worker<PdfJobData>(
    QUEUES.PDF_PROCESSING,
    async (job) => {
      const { documentId, clientId, filePath, fileName } = job.data

      try {
        // 1. atualizar status para 'processing'
        await updateDocumentStatus(documentId, 'processing')
        await job.updateProgress(10)

        // 2. extrair texto com LlamaParse (máxima precisão)
        const text = await llamaParseService.parse(filePath)
        await job.updateProgress(30)
        await job.updateProgress(50)

        // 4. chunkar e gerar embeddings (com cache)
        const chunks = chunkText(text)
        for (let i = 0; i < chunks.length; i++) {
          await embeddingService.getOrCreate(chunks[i], clientId, documentId)
          await job.updateProgress(50 + Math.floor((i / chunks.length) * 40))
        }

        // 5. extrair campos (regex primeiro, mini como fallback)
        const fields = await extractionService.extract(text)
        await job.updateProgress(95)

        // 6. salvar e notificar
        await updateDocument(documentId, { ...fields, status: 'active' })
        await notifyProcessingComplete(clientId, documentId, fileName)
        await job.updateProgress(100)

      } catch (error) {
        Sentry.captureException(error, { tags: { job: 'pdf-processing', documentId } })
        await updateDocumentStatus(documentId, 'error')
        throw error  // BullMQ faz retry automático
      }
    },
    {
      connection: redis,
      concurrency: 5,  // processa até 5 PDFs ao mesmo tempo
    }
  )

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id} falhou após todas as tentativas:`, error)
    notifyError(error, 'pdf-worker')
  })

  return worker
}
```

## Como enfileirar um PDF (na rota de upload)

```typescript
// routes/rag.routes.ts
app.post('/api/upload', aiRateLimiter, async (c) => {
  const file = await c.req.formData()
  const clientId = c.get('clientId')

  // 1. salvar arquivo no Storage ANTES de enfileirar
  const filePath = await storageService.upload(file, clientId)

  // 2. criar registro no banco com status 'queued'
  const document = await documentService.create({
    clientId, filePath, status: 'queued', fileName: file.get('name')
  })

  // 3. enfileirar — retorna IMEDIATAMENTE
  const job = await pdfQueue.add('process', {
    documentId: document.id,
    clientId,
    filePath,
    fileName: document.file_name,
  })

  // 4. retornar jobId para o frontend fazer polling
  return c.json({
    success: true,
    documentId: document.id,
    jobId: job.id,
    message: 'Documento recebido. Processando em background.'
  })
})
```

## Rota de status do job (para polling do frontend)

```typescript
app.get('/api/jobs/:jobId/status', async (c) => {
  const job = await pdfQueue.getJob(c.req.param('jobId'))
  if (!job) return c.json({ error: 'Job not found' }, 404)

  const state = await job.getState()  // waiting, active, completed, failed
  const progress = job.progress

  return c.json({ state, progress, documentId: job.data.documentId })
})
```

## Regra importante

Nunca processar PDF dentro do request HTTP.
Upload → Storage → criar registro → enfileirar → retornar jobId.
O worker faz todo o resto.
