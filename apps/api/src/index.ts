// Sentry PRIMEIRO — antes de qualquer import (backend/SKILL.md)
import * as Sentry from '@sentry/node'
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate: 0.2,
})

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { rateLimiter } from 'hono-rate-limiter'
import { createClient } from '@supabase/supabase-js'
import { ragRoutes } from './routes/rag.routes.js'
import { dmsRoutes } from './routes/dms.routes.js'
import { reportsRoutes } from './routes/reports.routes.js'
import { certificatesRoutes } from './routes/certificates.routes.js'
import { invitesRoutes } from './routes/invites.routes.js'
import { registerRoutes } from './routes/register.routes.js'
import { setupWorkers } from './workers/index.js'
import { setupCron } from './services/cron.service.js'
import { setupReportCron } from './services/reports/report.cron.js'
import type { AppVariables } from './lib/context.js'

// Validar variáveis de ambiente obrigatórias na inicialização
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_ANON_KEY',
  'OPENAI_API_KEY',
  'REDIS_URL',
]

REQUIRED_ENV.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Variável de ambiente ausente: ${key}`)
  }
})

const app = new Hono<{ Variables: AppVariables }>()

// Clients Supabase de nível de módulo (criados 1x, não por request)
const supabaseAdmin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const supabaseAuth  = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!)

// ── Headers de segurança (security/SKILL.md §6) ──────────────────────────────
app.use('*', secureHeaders())

// ── CORS — aceita qualquer origem (proxy nginx garante segurança de rede) ─────
app.use(
  '*',
  cors({
    origin: (origin) => origin ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  })
)

// ── Rate limit geral — proteção DDoS (200 req/min por IP) ────────────────────
app.use(
  '*',
  rateLimiter({
    windowMs: 60 * 1000,
    limit: 200,
    keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
    message: { error: 'Too many requests.' },
  })
)

// ── Middleware de autenticação (backend/SKILL.md) ─────────────────────────────
// Rotas que não passam pelo middleware de auth JWT
const PUBLIC_PATHS = ['/health', '/api/webhook/gmail', '/api/register']

app.use('*', async (c, next) => {
  if (PUBLIC_PATHS.includes(c.req.path)) return next()

  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  // Verificar token via Supabase Auth (anon key para não bypassar validação)
  const { data: { user }, error } = await supabaseAuth.auth.getUser(token)
  if (error || !user) return c.json({ error: 'Invalid token' }, 401)

  // Buscar role da tabela user_roles (source of truth) — nunca confiar em user_metadata
  // security/SKILL.md §1: autorização sempre vem de fonte confiável no banco
  const { data: roleRow } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  // Dados do usuário verificados — disponíveis nas rotas via c.get()
  c.set('userId', user.id)
  c.set('userEmail', user.email ?? '')
  c.set('userRole', ((roleRow?.role as string) ?? 'user').toLowerCase())

  await next()
})

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.route('/api', ragRoutes)
app.route('/api', dmsRoutes)
app.route('/api', reportsRoutes)
app.route('/api', certificatesRoutes)
app.route('/api', invitesRoutes)
app.route('/api', registerRoutes)

// ── Catch-all para debug do mistério do 405 ──────────────────────────────────
app.notFound((c) => {
  console.log(`[404] ${c.req.method} ${c.req.path} — rota não encontrada no Hono`)
  return c.json({ error: 'Not Found', method: c.req.method, path: c.req.path }, 404)
})

// ── Iniciar workers BullMQ + Crons ────────────────────────────────────────────
setupWorkers()
setupCron()
setupReportCron()

// ── Servidor ──────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT ?? 3000)

serve({ fetch: app.fetch, port }, () => {
  console.log(`[server] rodando na porta ${port}`)
})

export default app
