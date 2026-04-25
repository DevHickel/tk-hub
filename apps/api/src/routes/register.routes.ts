import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import type { AppVariables } from '../lib/context.js'
import { supabase } from '../lib/supabase.js'
import { safeLog } from '../lib/logger.js'

export const registerRoutes = new Hono<{ Variables: AppVariables }>()

const registerRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
  message: { error: 'Muitas tentativas. Tente em 1 hora.' },
})

const registerSchema = z.object({
  token: z.string().uuid(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(120),
  phone: z.string().max(32).optional(),
})

registerRoutes.post('/register', registerRateLimiter, zValidator('json', registerSchema), async (c) => {
  const { token, password, full_name, phone } = c.req.valid('json')

  try {
    const { data: validateRows, error: validateError } = await supabase
      .rpc('validate_invite_token', { p_token: token })
    if (validateError) throw validateError
    const result = validateRows?.[0]
    if (!result?.is_valid) {
      return c.json({ error: 'Convite inválido, expirado ou já utilizado.' }, 400)
    }
    const email = result.email as string

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, phone },
    })
    if (createError) {
      const msg = createError.message ?? ''
      const isDuplicate = /already (been )?registered/i.test(msg) || (createError as { status?: number }).status === 422
      if (isDuplicate) {
        await supabase.from('invites').update({ status: 'accepted' }).eq('token', token)
        return c.json({ error: 'Esta conta já existe. Faça login.' }, 409)
      }
      throw createError
    }
    const userId = created.user!.id

    await supabase.from('profiles').update({ full_name, phone }).eq('id', userId)
    await supabase.from('invites').update({ status: 'accepted' }).eq('token', token)

    safeLog('info', 'Cadastro concluído', { userId, email })
    return c.json({ success: true }, 201)
  } catch (error) {
    Sentry.captureException(error)
    const msg = error instanceof Error ? error.message : 'Erro desconhecido'
    return c.json({ error: `Falha no cadastro: ${msg}` }, 500)
  }
})
