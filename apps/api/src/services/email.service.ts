import nodemailer from 'nodemailer'
import { supabase } from '../lib/supabase.js'
import { safeLog } from '../lib/logger.js'

// ── Tipos ────────────────────────────────────────────────────────────────────
interface SmtpConfig {
  smtp_host: string
  smtp_port: number
  smtp_user: string
  smtp_pass: string
  from_name: string
  from_email: string
}

// ── Cache em memória (TTL 5 min) ─────────────────────────────────────────────
let cachedConfig: SmtpConfig | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const now = Date.now()
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) return cachedConfig

  const { data } = await supabase.from('email_config').select('*').single()

  if (data?.smtp_host && data?.smtp_user && data?.smtp_pass) {
    cachedConfig = {
      smtp_host: data.smtp_host,
      smtp_port: data.smtp_port ?? 587,
      smtp_user: data.smtp_user,
      smtp_pass: data.smtp_pass,
      from_name: data.from_name ?? 'TK Solution',
      from_email: data.from_email || data.smtp_user,
    }
    cacheTimestamp = now
    return cachedConfig
  }

  // Fallback para env vars Gmail OAuth2 (retrocompatível)
  if (process.env.GMAIL_USER) {
    cachedConfig = {
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_user: process.env.GMAIL_USER,
      smtp_pass: '',  // OAuth2 não usa smtp_pass
      from_name: 'TK Solution',
      from_email: process.env.GMAIL_USER,
    }
    cacheTimestamp = now
    return cachedConfig
  }

  return null
}

/** Invalida o cache (chamado ao salvar config) */
export function invalidateEmailConfigCache() {
  cachedConfig = null
  cacheTimestamp = 0
}

// ── sendEmail ────────────────────────────────────────────────────────────────
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const config = await getSmtpConfig()

  if (!config) {
    safeLog('warn', 'Email não configurado — nenhum SMTP ou env var GMAIL_* definido')
    return
  }

  let transporter: nodemailer.Transporter

  // Se veio do DB (smtp_pass preenchido), usa SMTP genérico
  if (config.smtp_pass) {
    transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
    })
  } else {
    // Fallback: OAuth2 via env vars (comportamento original)
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.GMAIL_USER!,
        clientId: process.env.GMAIL_CLIENT_ID!,
        clientSecret: process.env.GMAIL_CLIENT_SECRET!,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
      },
    })
  }

  await transporter.sendMail({
    from: `"${config.from_name}" <${config.from_email}>`,
    to,
    subject,
    html,
  })

  safeLog('info', 'Email enviado', { to, subject })
}

// ── getEmailWithAttachments (inalterado — continua usando Google API) ─────────
export async function getEmailWithAttachments(messageId: string): Promise<{
  from: string
  subject: string
  attachments: Array<{ filename: string; buffer: Buffer; mimeType: string }>
}> {
  const { google } = await import('googleapis')

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  )
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN })

  const gmail = google.gmail({ version: 'v1', auth })

  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  })

  const headers = msg.data.payload?.headers ?? []
  const from = headers.find((h) => h.name === 'From')?.value ?? ''
  const subject = headers.find((h) => h.name === 'Subject')?.value ?? ''

  const attachments: Array<{ filename: string; buffer: Buffer; mimeType: string }> = []
  const parts = msg.data.payload?.parts ?? []

  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      const attachment = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: part.body.attachmentId,
      })
      const data = attachment.data.data ?? ''
      const buffer = Buffer.from(data, 'base64')
      attachments.push({
        filename: part.filename,
        buffer,
        mimeType: part.mimeType ?? 'application/octet-stream',
      })
    }
  }

  return { from, subject, attachments }
}
