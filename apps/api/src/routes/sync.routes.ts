import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import crypto from 'node:crypto'
import type { AppVariables } from '../lib/context.js'
import { supabase } from '../lib/supabase.js'
import { tkProcedureSyncQueue } from '../queues/tk-procedure-sync.queue.js'
import { safeLog } from '../lib/logger.js'

export const syncRoutes = new Hono<{ Variables: AppVariables }>()

// ────────────────────────────────────────────────────────────────────────────
// Webhook receiver — público (auth pelo header X-TK-Webhook-Secret)
// ────────────────────────────────────────────────────────────────────────────

const webhookRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 100, // generoso, mas previne flood se a TK ficar maluca
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? 'webhook',
  message: { error: 'Too many requests.' },
})

const procedurePayloadSchema = z.object({
  event: z.enum(['procedure.created', 'procedure.updated', 'procedure.deleted']),
  procedure: z.object({
    external_id: z.string().min(1),
    title: z.string().min(1),
    file_url: z.string().url().optional(),
    file_base64: z.string().optional(),
    updated_at: z.string(),
    metadata: z.record(z.unknown()).optional(),
  }),
})

syncRoutes.post(
  '/sync/tk/procedures',
  webhookRateLimiter,
  zValidator('json', procedurePayloadSchema),
  async (c) => {
    const secret = c.req.header('x-tk-webhook-secret')
    if (!secret) {
      return c.json({ error: 'Missing webhook secret' }, 401)
    }

    // 1. Buscar config e validar secret
    const { data: cfg, error: cfgErr } = await supabase
      .from('external_sync_config')
      .select('webhook_secret_hash, active')
      .eq('provider', 'tk')
      .maybeSingle()
    if (cfgErr || !cfg) {
      return c.json({ error: 'Integration not configured' }, 401)
    }
    if (!cfg.active) {
      return c.json({ error: 'Integration inactive' }, 401)
    }

    const incomingHash = crypto.createHash('sha256').update(secret).digest('hex')
    if (!cfg.webhook_secret_hash || incomingHash !== cfg.webhook_secret_hash) {
      safeLog('warn', 'TK webhook rejected — invalid secret', {})
      return c.json({ error: 'Invalid webhook secret' }, 401)
    }

    const body = c.req.valid('json')

    // 2. Persistir evento (auditoria + base pro update final do worker)
    const { data: evt, error: insertErr } = await supabase
      .from('external_sync_events')
      .insert({
        provider: 'tk',
        event_type: body.event,
        external_id: body.procedure.external_id,
        status: 'received',
        payload: body as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()
    if (insertErr || !evt) {
      Sentry.captureException(insertErr)
      return c.json({ error: 'Failed to persist event' }, 500)
    }

    // 3. Atualizar contadores na config
    await supabase
      .from('external_sync_config')
      .update({ last_event_at: new Date().toISOString(), events_count: 0 })
      .eq('provider', 'tk')
    // eventos_count incrementa via RPC seria mais robusto; simplificado aqui

    // 4. Enqueue
    await tkProcedureSyncQueue.add('sync', {
      eventId: evt.id,
      externalId: body.procedure.external_id,
      eventType: body.event,
      title: body.procedure.title,
      fileUrl: body.procedure.file_url,
      fileBase64: body.procedure.file_base64,
      updatedAt: body.procedure.updated_at,
      metadata: body.procedure.metadata,
    })

    safeLog('info', 'TK webhook accepted', { event: body.event, externalId: body.procedure.external_id })

    return c.json({ accepted: true, eventId: evt.id }, 202)
  },
)

// ────────────────────────────────────────────────────────────────────────────
// Config endpoints (admin)
// ────────────────────────────────────────────────────────────────────────────

function maskToken(token: string | null | undefined): string {
  if (!token) return ''
  if (token.length <= 8) return '••••'
  return token.slice(0, 4) + '••••' + token.slice(-4)
}

syncRoutes.get('/sync/tk/config', async (c) => {
  if (c.get('userRole') !== 'admin') {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const { data } = await supabase
    .from('external_sync_config')
    .select('*')
    .eq('provider', 'tk')
    .maybeSingle()

  if (!data) {
    return c.json({
      provider: 'tk',
      active: false,
      base_url: null,
      api_token_masked: '',
      has_secret: false,
      last_event_at: null,
      last_error: null,
      events_count: 0,
    })
  }

  return c.json({
    provider: 'tk',
    active: data.active,
    base_url: data.base_url,
    api_token_masked: maskToken(data.api_token),
    has_secret: !!data.webhook_secret_hash,
    last_event_at: data.last_event_at,
    last_error: data.last_error,
    events_count: data.events_count,
  })
})

const updateConfigSchema = z.object({
  active: z.boolean().optional(),
  base_url: z.string().url().nullable().optional(),
  api_token: z.string().nullable().optional(), // null/undefined = mantém, '' = limpa
})

syncRoutes.put(
  '/sync/tk/config',
  zValidator('json', updateConfigSchema),
  async (c) => {
    if (c.get('userRole') !== 'admin') {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
    const body = c.req.valid('json')

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.active !== undefined) updates.active = body.active
    if (body.base_url !== undefined) updates.base_url = body.base_url
    if (body.api_token !== undefined) updates.api_token = body.api_token || null

    // upsert por provider
    const { error } = await supabase
      .from('external_sync_config')
      .upsert({ provider: 'tk', ...updates }, { onConflict: 'provider' })

    if (error) {
      Sentry.captureException(error)
      return c.json({ error: 'Failed to save config' }, 500)
    }
    return c.json({ success: true })
  },
)

// Gera novo secret, retorna em texto puro 1x, salva sha256.
syncRoutes.post('/sync/tk/secret', async (c) => {
  if (c.get('userRole') !== 'admin') {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const secret = crypto.randomBytes(36).toString('base64url') // 48 chars
  const hash = crypto.createHash('sha256').update(secret).digest('hex')

  const { error } = await supabase
    .from('external_sync_config')
    .upsert(
      { provider: 'tk', webhook_secret_hash: hash, updated_at: new Date().toISOString() },
      { onConflict: 'provider' },
    )

  if (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Failed to save secret' }, 500)
  }

  return c.json({ secret, hash_preview: hash.slice(0, 12) + '...' })
})

syncRoutes.get('/sync/tk/events', async (c) => {
  if (!['admin', 'manager'].includes(c.get('userRole'))) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const { data, error } = await supabase
    .from('external_sync_events')
    .select('id, event_type, external_id, status, error_message, created_at')
    .eq('provider', 'tk')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return c.json({ error: 'Failed to load events' }, 500)
  }
  return c.json(data ?? [])
})
