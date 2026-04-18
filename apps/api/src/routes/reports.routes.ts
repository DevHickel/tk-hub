import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import type { AppVariables } from '../lib/context.js'
import { supabase } from '../lib/supabase.js'
import { generateAndSendReports, getReportConfig } from '../services/reports/report.service.js'
import { sendEmail, invalidateEmailConfigCache } from '../services/email.service.js'
import { safeLog } from '../lib/logger.js'

export const reportsRoutes = new Hono<{ Variables: AppVariables }>()

// Rate limit conservador para envio de relatórios — evita drenar créditos de email
const sendTestRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // janela de 1 hora
  limit: 3,                  // máx 3 envios de teste por hora por usuário
  keyGenerator: (c) => (c.get('userId' as never) as string | undefined) ?? 'unknown',
  message: { error: 'Limite de envio de relatórios atingido. Tente novamente em 1 hora.' },
})

// ── GET /api/reports/config ─────────────────────────────────────────────────
reportsRoutes.get('/reports/config', async (c) => {
  try {
    const config = await getReportConfig()
    return c.json(config)
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── PUT /api/reports/config ─────────────────────────────────────────────────
const configSchema = z.object({
  language:                 z.enum(['pt', 'en']).optional(),
  hour_cost_brl:            z.number().min(1).max(1000).optional(),
  benchmark_search_min:     z.number().int().min(1).max(120).optional(),
  benchmark_doc_process_min:z.number().int().min(1).max(120).optional(),
  benchmark_alert_min:      z.number().int().min(1).max(60).optional(),
  benchmark_email_triage_min:z.number().int().min(1).max(60).optional(),
  send_day:                 z.number().int().min(0).max(6).optional(),
  send_hour:                z.number().int().min(0).max(23).optional(),
})

reportsRoutes.put('/reports/config', zValidator('json', configSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = c.req.valid('json')
  try {
    // Update a única linha (singleton via unique index)
    const { error } = await supabase
      .from('report_config')
      .update({ ...body, updated_at: new Date().toISOString() })
      .not('id', 'is', null)
    if (error) throw error
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── GET /api/reports/recipients ─────────────────────────────────────────────
reportsRoutes.get('/reports/recipients', async (c) => {
  const { data } = await supabase
    .from('report_recipients')
    .select('*')
    .order('created_at')
  return c.json(data ?? [])
})

// ── POST /api/reports/recipients ────────────────────────────────────────────
const recipientSchema = z.object({
  email:       z.string().email(),
  name:        z.string().min(2).max(200),
  report_type: z.enum(['management', 'hr', 'it', 'all']),
})

reportsRoutes.post('/reports/recipients', zValidator('json', recipientSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = c.req.valid('json')
  try {
    const { data, error } = await supabase
      .from('report_recipients')
      .insert(body)
      .select()
      .single()
    if (error) throw error
    return c.json(data, 201)
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── DELETE /api/reports/recipients/:id ──────────────────────────────────────
reportsRoutes.delete('/reports/recipients/:id', async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    await supabase.from('report_recipients').delete().eq('id', c.req.param('id'))
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── POST /api/reports/send-test ─────────────────────────────────────────────
reportsRoutes.post('/reports/send-test', sendTestRateLimiter, async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'manager', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const weekEnd   = new Date()
    const weekStart = new Date(weekEnd)
    weekStart.setDate(weekStart.getDate() - 7)

    // Fire-and-forget para não travar o request
    generateAndSendReports(weekStart, weekEnd).catch((err) => {
      Sentry.captureException(err, { tags: { route: '/api/reports/send-test' } })
    })

    safeLog('info', 'Relatório de teste disparado', { userId: c.get('userId') })
    return c.json({ success: true, message: 'Relatório de teste enviado para os destinatários configurados.' })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// E-mail config (SMTP plug-and-play)
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/email-config ──────────────────────────────────────────────────
reportsRoutes.get('/email-config', async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    const { data, error } = await supabase.from('email_config').select('*').single()
    if (error) throw error

    // Mascarar senha
    return c.json({
      smtp_host: data.smtp_host ?? '',
      smtp_port: data.smtp_port ?? 587,
      smtp_user: data.smtp_user ?? '',
      smtp_pass: data.smtp_pass ? '••••••••' : '',
      from_name: data.from_name ?? 'TK Solution',
      from_email: data.from_email ?? '',
    })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── PUT /api/email-config ──────────────────────────────────────────────────
const emailConfigSchema = z.object({
  smtp_host: z.string().min(1).optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_user: z.string().email().optional(),
  smtp_pass: z.string().optional(),
  from_name: z.string().min(1).optional(),
  from_email: z.string().email().optional(),
})

reportsRoutes.put('/email-config', zValidator('json', emailConfigSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = c.req.valid('json')

  // Se a senha veio mascarada, não sobrescrever
  if (body.smtp_pass === '••••••••') delete body.smtp_pass

  try {
    const { error } = await supabase
      .from('email_config')
      .update({ ...body, updated_at: new Date().toISOString() })
      .not('id', 'is', null)
    if (error) throw error

    invalidateEmailConfigCache()
    return c.json({ success: true })
  } catch (error) {
    Sentry.captureException(error)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// ── POST /api/email-config/test ────────────────────────────────────────────
reportsRoutes.post('/email-config/test', async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'tk_master'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  try {
    // Pegar o email configurado para enviar o teste
    const { data } = await supabase.from('email_config').select('smtp_user').single()
    const testTo = data?.smtp_user
    if (!testTo) {
      return c.json({ error: 'Configure o SMTP antes de enviar um teste.' }, 400)
    }

    await sendEmail(
      testTo,
      'TK Solution — Teste de configuração de e-mail',
      `<div style="font-family:sans-serif;padding:20px">
        <h2>Configuração de e-mail funcionando!</h2>
        <p>Este é um e-mail de teste enviado pelo TK Solution para verificar que a configuração SMTP está correta.</p>
        <p style="color:#888;font-size:12px">Enviado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
      </div>`
    )

    return c.json({ success: true, message: `E-mail de teste enviado para ${testTo}` })
  } catch (error) {
    Sentry.captureException(error)
    const msg = error instanceof Error ? error.message : 'Erro desconhecido'
    return c.json({ error: `Falha ao enviar: ${msg}` }, 500)
  }
})
