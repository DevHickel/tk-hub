import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import { answerQuestion } from '../agents/rag.agent.js'
import { getOrCreateEmbedding } from '../services/embedding.service.js'
import { pdfQueue } from '../queues/pdf.queue.js'
import { supabase } from '../lib/supabase.js'
import { safeLog } from '../lib/logger.js'
import crypto from 'crypto'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AppVariables } from '../lib/context.js'

export const ragRoutes = new Hono<{ Variables: AppVariables }>()

// Rate limit de IA — 60 req/min por usuário (backend/SKILL.md + security/SKILL.md §8)
const aiRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (c) => (c.get('userId' as never) as string | undefined) ?? 'unknown',
  message: { error: 'Limite de requisições atingido. Tente novamente em 1 minuto.' },
})

// ── POST /api/chat ─────────────────────────────────────────────────────────────
// Mesma interface da Edge Function — não quebra o contrato com o frontend
// body: { message: string, conversation_id?: string }
// response: { response: string }
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  conversation_id: z.string().uuid().optional(),
})

ragRoutes.post(
  '/chat',
  aiRateLimiter,
  zValidator('json', chatSchema),
  async (c) => {
    const { message, conversation_id } = c.req.valid('json')
    const userId = c.get('userId')

    try {
      const { answer, chatHistoryId, sources } = await answerQuestion(message, userId, conversation_id)
      return c.json({ response: answer, chat_history_id: chatHistoryId, sources })
    } catch (error) {
      Sentry.captureException(error, { tags: { route: '/api/chat', userId } })
      safeLog('error', 'Erro no /api/chat', { error: (error as Error).message })
      return c.json({ error: 'Internal server error' }, 500)
    }
  }
)

// ── POST /api/chat/feedback ────────────────────────────────────────────────
// Aplica feedback 👍/👎 numa resposta do TKzinho. Treina o ranking retroativamente.
const feedbackSchema = z.object({
  chat_history_id: z.string().uuid(),
  feedback: z.enum(['like', 'dislike']),
})

ragRoutes.post(
  '/chat/feedback',
  aiRateLimiter,
  zValidator('json', feedbackSchema),
  async (c) => {
    const { chat_history_id, feedback } = c.req.valid('json')
    const userId = c.get('userId')
    const score: 1 | -1 = feedback === 'like' ? 1 : -1

    try {
      // 1. Carrega a row e valida ownership
      const { data: hist, error: histError } = await supabase
        .from('chat_history')
        .select('question, chunks_used, user_id')
        .eq('id', chat_history_id)
        .single()

      if (histError || !hist) return c.json({ error: 'not found' }, 404)
      if (hist.user_id !== userId) return c.json({ error: 'forbidden' }, 403)

      const chunkIds = (hist.chunks_used as number[] | null) ?? []
      if (chunkIds.length === 0) {
        return c.json({ error: 'Esta resposta não pode ser avaliada (sem chunks)' }, 400)
      }

      // 2. Reusa embedding cacheado da pergunta — zero custo se cache hit
      const questionEmbedding = await getOrCreateEmbedding(hist.question)
      const questionHash = crypto.createHash('sha256').update(hist.question).digest('hex')

      // 3. Aplica via RPC atômica
      const { error: rpcError } = await supabase.rpc('apply_chunk_feedback' as never, {
        p_chunk_ids: chunkIds,
        p_user_id: userId,
        p_question: hist.question,
        p_question_hash: questionHash,
        p_question_embedding: JSON.stringify(questionEmbedding),
        p_score: score,
      } as never)

      if (rpcError) throw rpcError

      safeLog('info', 'feedback aplicado', { userId, chat_history_id, feedback, chunks: chunkIds.length })
      return c.json({ success: true })
    } catch (error) {
      Sentry.captureException(error, { tags: { route: '/api/chat/feedback', userId } })
      safeLog('error', 'Erro no /api/chat/feedback', { error: (error as Error).message })
      return c.json({ error: 'Internal server error' }, 500)
    }
  }
)

// ── POST /api/upload ──────────────────────────────────────────────────────────
// Recebe PDF → valida magic bytes → salva no Storage → cria registro → enfileira
// Retorna imediatamente com jobId (queue/SKILL.md)
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

ragRoutes.post('/upload', aiRateLimiter, async (c) => {
  const userId = c.get('userId')

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null

    if (!file) return c.json({ error: 'Nenhum arquivo enviado' }, 400)

    // Validar tamanho (security/SKILL.md §3)
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: 'Arquivo muito grande. Máximo 20MB.' }, 400)
    }

    // Validar tipo real pelo magic bytes — não confiar só na extensão
    const buffer = await file.arrayBuffer()
    const header = Buffer.from(buffer).slice(0, 4).toString()
    if (!header.startsWith('%PDF')) {
      return c.json({ error: 'Tipo de arquivo inválido. Apenas PDF é aceito.' }, 400)
    }

    // Hash do arquivo para detectar duplicatas
    const fileHash = crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex')

    // Verificar duplicata
    const { data: existing } = await supabase
      .from('documents')
      .select('id')
      .eq('file_hash', fileHash)
      .maybeSingle()

    if (existing) {
      return c.json({ error: 'Este documento já foi enviado anteriormente.' }, 409)
    }

    // Nome seguro — nunca usar o nome original do usuário direto (security/SKILL.md §3)
    const ext = path.extname(file.name).toLowerCase() || '.pdf'
    const safeName = `${randomUUID()}${ext}`
    const storagePath = `documents/${safeName}`

    // Upload para Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, Buffer.from(buffer), { contentType: 'application/pdf' })

    if (uploadError) throw uploadError

    // Criar registro no banco com status 'queued'
    const { data: doc, error: dbError } = await supabase
      .from('documents')
      .insert({
        uploaded_by: userId,
        file_name: file.name,
        file_path: storagePath,
        file_hash: fileHash,
        source: 'upload',
        status: 'queued',
      })
      .select()
      .single()

    if (dbError) throw dbError

    // Enfileirar processamento — retorna imediatamente (queue/SKILL.md)
    const job = await pdfQueue.add('process', {
      documentId: String(doc.id),
      filePath: storagePath,
      fileName: file.name,
    })

    safeLog('info', 'Documento enfileirado', { documentId: doc.id, jobId: job.id })

    return c.json({
      success: true,
      documentId: doc.id,
      jobId: job.id,
      message: 'Documento recebido. Processando em background.',
    })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: '/api/upload', userId } })
    safeLog('error', 'Erro no /api/upload', { error: (error as Error).message })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── GET /api/jobs/:jobId/status ────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

ragRoutes.get('/jobs/:jobId/status', async (c) => {
  const jobId = c.req.param('jobId')
  // BullMQ jobIds são numéricos ou uuid — rejeitar qualquer outra coisa (security/SKILL.md §2)
  if (!UUID_RE.test(jobId) && !/^\d+$/.test(jobId)) {
    return c.json({ error: 'Invalid job ID' }, 400)
  }

  try {
    const job = await pdfQueue.getJob(jobId)
    if (!job) return c.json({ error: 'Job not found' }, 404)

    const state = await job.getState()
    const progress = job.progress

    return c.json({ state, progress, documentId: job.data.documentId })

  } catch (error) {
    Sentry.captureException(error, { tags: { route: '/api/jobs/status' } })
    return c.json({ error: 'Internal server error' }, 500)
  }
})
