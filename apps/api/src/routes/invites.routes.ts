import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { rateLimiter } from 'hono-rate-limiter'
import { z } from 'zod'
import * as Sentry from '@sentry/node'
import { randomUUID } from 'node:crypto'
import type { AppVariables } from '../lib/context.js'
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../services/email.service.js'
import { buildInviteEmail } from '../services/reports/templates/invite.template.js'
import { safeLog } from '../lib/logger.js'

export const invitesRoutes = new Hono<{ Variables: AppVariables }>()

// Limite por usuário: 20 convites por hora — generoso, mas evita abuso
const inviteRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (c) => (c.get('userId' as never) as string | undefined) ?? 'unknown',
  message: { error: 'Limite de convites atingido. Tente novamente em 1 hora.' },
})

const createInviteSchema = z.object({
  email: z.string().email(),
})

invitesRoutes.post('/invites', inviteRateLimiter, zValidator('json', createInviteSchema), async (c) => {
  const userRole = c.get('userRole')
  if (!['admin', 'manager'].includes(userRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const userId = c.get('userId')
  const userEmail = c.get('userEmail')
  const { email } = c.req.valid('json')

  try {
    // Evitar convite duplicado pendente não-expirado
    const { data: existing } = await supabase
      .from('invites')
      .select('id, expires_at, status')
      .eq('email', email)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      return c.json({ error: 'Já existe um convite pendente para este e-mail.' }, 409)
    }

    // Verificar se já existe usuário com esse e-mail
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (existingUser) {
      return c.json({ error: 'Já existe um usuário cadastrado com este e-mail.' }, 409)
    }

    const token = randomUUID()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    const { data: invite, error: insertError } = await supabase
      .from('invites')
      .insert({
        email,
        token,
        invited_by: userId,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      })
      .select('id, email, token, expires_at')
      .single()

    if (insertError) throw insertError

    // Buscar nome do convidante para personalizar o e-mail
    const { data: inviterProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle()

    const inviterName = inviterProfile?.full_name || userEmail || 'um administrador'
    const frontendUrl = process.env.FRONTEND_URL ?? 'https://tkhub.vetorix.com.br'
    const link = `${frontendUrl}/register?token=${token}&email=${encodeURIComponent(email)}`

    await sendEmail(email, 'TK Solution — Você foi convidado', buildInviteEmail(link, inviterName))

    safeLog('info', 'Convite enviado', { email, invitedBy: userId })

    return c.json(invite, 201)
  } catch (error) {
    Sentry.captureException(error)
    const msg = error instanceof Error ? error.message : 'Erro desconhecido'
    return c.json({ error: `Falha ao enviar convite: ${msg}` }, 500)
  }
})
