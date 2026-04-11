import nodemailer from 'nodemailer'
import { safeLog } from '../lib/logger.js'

// Transporter com OAuth2 (backend/SKILL.md)
function createTransporter() {
  return nodemailer.createTransport({
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

export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transporter = createTransporter()

  await transporter.sendMail({
    from: `"TK Solution" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  })

  safeLog('info', 'Email enviado', { to, subject })
}

// Buscar email completo via Gmail API (para o webhook DMS)
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
