---
name: backend
description: Regras para o backend Node.js/TypeScript/Hono da TK Solution
---

# Backend — Padrões e Regras

## Framework e validação

Use Hono como framework HTTP.
Use Zod para validar TODA entrada de dados — sem exceção.

```typescript
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const uploadSchema = z.object({
  client_id: z.string().uuid(),
  document_type: z.string().min(1),
})

app.post('/upload',
  zValidator('form', uploadSchema),  // valida antes de processar
  async (c) => {
    const { client_id, document_type } = c.req.valid('form')
    // lógica aqui — dados já validados e tipados
    return c.json({ success: true, jobId: '...' })
  }
)
```

## Rate limiting — obrigatório em rotas de IA

```typescript
import { rateLimiter } from 'hono-rate-limiter'

// aplicar em toda rota que chama OpenAI ou LlamaParse
const aiRateLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minuto
  limit: 60,              // 60 req/min por client
  keyGenerator: (c) => c.get('clientId'),
  message: { error: 'Too many requests. Try again in a minute.' },
})

app.post('/api/chat', aiRateLimiter, async (c) => { ... })
app.post('/api/upload', aiRateLimiter, async (c) => { ... })
```

## Autenticação — restrita ao domínio da TK Solution

Apenas emails do domínio autorizado conseguem se autenticar.
Configurar no Supabase Auth → Email → Allowed domains.

```typescript
app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next()

  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return c.json({ error: 'Invalid token' }, 401)

  // verificar domínio de email autorizado
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN! // ex: tksolution.com.br
  if (!user.email?.endsWith(`@${allowedDomain}`)) {
    return c.json({ error: 'Unauthorized domain' }, 403)
  }

  c.set('userId', user.id)
  c.set('userEmail', user.email)
  c.set('userRole', user.user_metadata.role ?? 'user') // user | admin | manager
  await next()
})
```

## Tratamento de erros com Sentry

```typescript
import * as Sentry from '@sentry/node'

// em todo catch de rota ou service
try {
  // operação
} catch (error) {
  Sentry.captureException(error, {
    tags: { route: 'nome-da-rota', clientId: c.get('clientId') }
  })
  await notifyError(error, 'nome-da-rota')
  return c.json({ error: 'Internal server error' }, 500)
}
```

## Inicialização do servidor (ordem obrigatória)

```typescript
// index.ts — ordem importa
import * as Sentry from '@sentry/node'
Sentry.init({ dsn: process.env.SENTRY_DSN })  // PRIMEIRO

import { Hono } from 'hono'
import { setupWorkers } from './workers'
import { setupCron } from './services/cron.service'

const app = new Hono()

// middlewares
// rotas
// workers e cron ao iniciar
setupWorkers()
setupCron()

export default app
```

## Packages obrigatórios

```json
{
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/zod-validator": "^0.2.0",
    "zod": "^3.22.0",
    "@supabase/supabase-js": "^2.0.0",
    "openai": "^4.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.0.0",
    "nodemailer": "^6.0.0",
    "node-cron": "^3.0.0",
    "@sentry/node": "^8.0.0",
    "hono-rate-limiter": "^0.4.0"
  }
}
```

## Variáveis de ambiente obrigatórias

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
OPENAI_API_KEY=
LLAMAPARSE_API_KEY=
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_WEBHOOK_TOKEN=
REDIS_URL=redis://localhost:6379
SENTRY_DSN=
ALLOWED_EMAIL_DOMAIN=tksolution.com.br
FRONTEND_URL=https://sistema.tksolution.com.br
ERROR_WHATSAPP_NUMBER=
PORT=3000
```
