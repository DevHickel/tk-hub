import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import { certificateQueue } from '../queues/certificate.queue.js'
import { supabase } from '../lib/supabase.js'
import { testImapConnection } from '../services/inbox-monitor.service.js'
import type { AppVariables } from '../lib/context.js'
import { safeLog } from '../lib/logger.js'

export const certificatesRoutes = new Hono<{ Variables: AppVariables }>()

// POST /api/certificates/:id/extract
// Enqueues background extraction job for a previously uploaded certificate.
// Called by the frontend right after inserting the processed_certificates record.
//
// Defesa:
// - Só manager/admin podem disparar (certs são da empresa, não de um usuário).
// - file_url e file_name vêm do banco (fonte confiável), body é ignorado — evita SSRF.
// - file_url precisa apontar pra storage do próprio Supabase.
certificatesRoutes.post('/certificates/:id/extract', async (c) => {
  const userId = c.get('userId')
  const userRole = c.get('userRole')
  const certificateId = c.req.param('id')

  if (!['admin', 'manager'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const { data: cert, error: lookupErr } = await supabase
      .from('processed_certificates')
      .select('id, file_url, file_name')
      .eq('id', certificateId)
      .maybeSingle()

    if (lookupErr || !cert) {
      return c.json({ error: 'Not found' }, 404)
    }

    const fileUrl = cert.file_url
    const fileName = cert.file_name
    if (!fileUrl || !fileName) {
      return c.json({ error: 'Certificate has no file attached' }, 400)
    }

    const allowedPrefix = `${process.env.SUPABASE_URL}/storage/v1/object/`
    if (!fileUrl.startsWith(allowedPrefix)) {
      safeLog('warn', 'Certificate extract rejected — file_url outside Supabase storage', {
        certificateId, userId,
      })
      return c.json({ error: 'Invalid file URL' }, 400)
    }

    await certificateQueue.add('extract', { certificateId, fileUrl, fileName })
    safeLog('info', 'Certificate extraction enqueued', { certificateId, userId })
    return c.json({ queued: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'POST /api/certificates/:id/extract' } })
    return c.json({ error: 'Failed to enqueue extraction' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// Certificate Email Inboxes (IMAP monitoring)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/certificate-inboxes
certificatesRoutes.get('/certificate-inboxes', async (c) => {
  const userRole = c.get('userRole')
  if (!['admin'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const { data, error } = await supabase
      .from('certificate_email_accounts')
      .select('*')
      .order('created_at')

    if (error) throw error

    // Mask passwords
    const masked = (data ?? []).map((a) => ({
      ...a,
      imap_pass: a.imap_pass ? '••••••••' : '',
    }))

    return c.json(masked)
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// POST /api/certificate-inboxes
const inboxSchema = z.object({
  label: z.string().min(1).max(200),
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535),
  imap_user: z.string().min(1),
  imap_pass: z.string().min(1),
  use_tls: z.boolean().optional().default(true),
})

certificatesRoutes.post('/certificate-inboxes', zValidator('json', inboxSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = c.req.valid('json')
  try {
    const { data, error } = await supabase
      .from('certificate_email_accounts')
      .insert(body)
      .select()
      .single()

    if (error) throw error

    safeLog('info', 'Inbox de certificados criado', { label: body.label, user: body.imap_user })
    return c.json({ ...data, imap_pass: '••••••••' }, 201)
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// PUT /api/certificate-inboxes/:id
const inboxUpdateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  imap_host: z.string().min(1).optional(),
  imap_port: z.number().int().min(1).max(65535).optional(),
  imap_user: z.string().min(1).optional(),
  imap_pass: z.string().optional(),
  use_tls: z.boolean().optional(),
  active: z.boolean().optional(),
})

certificatesRoutes.put('/certificate-inboxes/:id', zValidator('json', inboxUpdateSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const id = c.req.param('id')
  const body = c.req.valid('json')

  // Don't overwrite password if masked
  if (body.imap_pass === '••••••••') delete body.imap_pass

  try {
    const { error } = await supabase
      .from('certificate_email_accounts')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) throw error
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// DELETE /api/certificate-inboxes/:id
certificatesRoutes.delete('/certificate-inboxes/:id', async (c) => {
  const userRole = c.get('userRole')
  if (!['admin'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const { error } = await supabase
      .from('certificate_email_accounts')
      .delete()
      .eq('id', c.req.param('id'))

    if (error) throw error
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// POST /api/certificate-inboxes/test
const testImapSchema = z.object({
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535),
  imap_user: z.string().min(1),
  imap_pass: z.string().min(1),
  use_tls: z.boolean().optional().default(true),
})

certificatesRoutes.post('/certificate-inboxes/test', zValidator('json', testImapSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const config = c.req.valid('json')
  try {
    const result = await testImapConnection(config)
    if (result.success) {
      return c.json({ success: true, message: `Conexão IMAP OK. ${result.messageCount} mensagens na caixa.` })
    }
    return c.json({ success: false, error: result.error }, 400)
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
