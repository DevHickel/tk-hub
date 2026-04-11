import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import { emailQueue } from '../queues/email.queue.js'
import type { AppVariables } from '../lib/context.js'
import {
  listDocuments,
  getDocumentById,
  updateDocumentStatus,
  archiveDocument,
} from '../services/document.service.js'
import { safeLog } from '../lib/logger.js'

export const dmsRoutes = new Hono<{ Variables: AppVariables }>()

// Rate limit específico para o webhook do Gmail — fora do middleware de auth (security/SKILL.md §8)
const webhookRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30, // 30 notificações/min é mais do que suficiente para Pub/Sub
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
  message: { error: 'Too many webhook requests.' },
})

// ── POST /api/webhook/gmail ─────────────────────────────────────────────────
// Webhook do Gmail — retorna 200 IMEDIATAMENTE, enfileira para processamento
// Verificar token de autenticidade (security/SKILL.md §10)
dmsRoutes.post('/webhook/gmail', webhookRateLimiter, async (c) => {
  // Verificar token — a rota de webhook não tem auth middleware (é chamada pelo Google)
  const token = c.req.query('token')
  if (token !== process.env.GMAIL_WEBHOOK_TOKEN) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Verificar Content-Type
  const contentType = c.req.header('content-type')
  if (!contentType?.includes('application/json')) {
    return c.json({ error: 'Invalid content type' }, 400)
  }

  try {
    const body = await c.req.json()
    const messageData = body?.message?.data

    if (messageData) {
      // Decodificar mensagem Pub/Sub do Google
      const decoded = Buffer.from(messageData, 'base64').toString('utf-8')
      const parsed = JSON.parse(decoded)
      const messageId: string = parsed.emailAddress || parsed.messageId || ''

      if (messageId) {
        await emailQueue.add('process', {
          messageId,
          from: parsed.emailAddress ?? '',
        })
        safeLog('info', 'Email enfileirado via webhook', { messageId })
      }
    }

    // Gmail exige resposta rápida — sempre 200
    return c.json({ received: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: '/api/webhook/gmail' } })
    // Ainda retorna 200 para evitar retry do Google
    return c.json({ received: true })
  }
})

// ── GET /api/documents ──────────────────────────────────────────────────────
const listSchema = z.object({
  status: z.string().optional(),
  tipo: z.string().optional(),
  search: z.string().max(200).optional(),
  expiring: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

dmsRoutes.get('/documents', zValidator('query', listSchema), async (c) => {
  const { status, tipo, search, expiring, page, pageSize } = c.req.valid('query')

  try {
    const result = await listDocuments({
      status,
      tipo,
      search,
      expiringDays: expiring,
      page,
      pageSize,
    })

    return c.json({
      data: result.data ?? [],
      total: result.count ?? 0,
      page,
      pageSize,
    })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'GET /api/documents' } })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── GET /api/documents/:id ──────────────────────────────────────────────────
dmsRoutes.get('/documents/:id', async (c) => {
  try {
    const doc = await getDocumentById(c.req.param('id'))
    return c.json(doc)
  } catch {
    return c.json({ error: 'Not found' }, 404)
  }
})

// ── PATCH /api/documents/:id ────────────────────────────────────────────────
const patchSchema = z.object({
  status: z.enum(['queued', 'processing', 'active', 'expired', 'error', 'archived']).optional(),
  colaborador: z.string().min(2).max(200).optional(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tipo: z.string().max(50).optional(),
})

dmsRoutes.patch('/documents/:id', zValidator('json', patchSchema), async (c) => {
  const userId = c.get('userId')
  const userRole = c.get('userRole')

  // Só admin/manager pode alterar status para archived (security/SKILL.md §1)
  const body = c.req.valid('json')
  if (body.status === 'archived' && !['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const id = c.req.param('id')
    if (body.status) await updateDocumentStatus(id, body.status)
    safeLog('info', 'Documento atualizado', { id, userId, changes: Object.keys(body) })
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'PATCH /api/documents' } })
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── DELETE /api/documents/:id (archive) ────────────────────────────────────
dmsRoutes.delete('/documents/:id', async (c) => {
  const userRole = c.get('userRole')

  // Somente admin/manager/tk_master (security/SKILL.md §1)
  if (!['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    await archiveDocument(c.req.param('id'))
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'DELETE /api/documents' } })
    return c.json({ error: 'Internal server error' }, 500)
  }
})
