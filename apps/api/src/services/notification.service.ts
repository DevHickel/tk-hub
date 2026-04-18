// Serviço central de notificações — decide o canal por tipo (PROMPT 6)
// Todos os textos são strings fixas — zero IA aqui

import { sendEmail } from './email.service.js'
import { sendWhatsApp } from './whatsapp.service.js'
import { getExpiryTemplate, getProcessingCompleteTemplate } from './templates.service.js'
import { safeLog } from '../lib/logger.js'

export type NotificationType =
  | 'expiry_alert'
  | 'document_processed'
  | 'document_error'
  | 'invite'

interface ExpiryAlertData {
  docName: string
  dias: number
  colaborador: string
  recipientEmail: string
}

interface DocumentProcessedData {
  fileName: string
  recipientEmail: string
}

interface DocumentErrorData {
  fileName: string
  documentId: string
}

interface InviteData {
  recipientEmail: string
  inviterName: string
  token: string
}

export async function notify(
  type: NotificationType,
  data: ExpiryAlertData | DocumentProcessedData | DocumentErrorData | InviteData
): Promise<void> {
  try {
    switch (type) {
      case 'expiry_alert': {
        const d = data as ExpiryAlertData
        const html = getExpiryTemplate(d.docName, d.dias, d.colaborador)
        const plural = d.dias > 1 ? 's' : ''
        await sendEmail(
          d.recipientEmail,
          `⚠️ Documento vence em ${d.dias} dia${plural}: ${d.docName}`,
          html
        )
        break
      }

      case 'document_processed': {
        const d = data as DocumentProcessedData
        const html = getProcessingCompleteTemplate(d.fileName)
        await sendEmail(
          d.recipientEmail,
          `✅ Documento processado: ${d.fileName}`,
          html
        )
        break
      }

      case 'document_error': {
        const d = data as DocumentErrorData
        // Erro vai para WhatsApp do time de TI (resposta mais rápida)
        const number = process.env.ERROR_WHATSAPP_NUMBER
        if (number) {
          await sendWhatsApp(
            number,
            `❌ *TK Solution — Erro no Documento*\n\nArquivo: *${d.fileName}*\nID: ${d.documentId}\nVerifique o painel admin para detalhes.`
          )
        }
        break
      }

      case 'invite': {
        const d = data as InviteData
        const inviteUrl = `${process.env.FRONTEND_URL}/register?token=${d.token}`
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:32px">
            <h2 style="color:#1E293B">Você foi convidado para o TK Solution</h2>
            <p>${d.inviterName} convidou você para acessar o sistema interno da TK Solution.</p>
            <a href="${inviteUrl}"
               style="display:inline-block;background:#1E293B;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">
              Aceitar convite
            </a>
            <p style="color:#94A3B8;font-size:12px;margin-top:24px">
              O link expira em 7 dias. Se você não esperava esse convite, ignore este email.
            </p>
          </div>`
        await sendEmail(
          d.recipientEmail,
          'Convite — TK Solution',
          html
        )
        break
      }
    }

    safeLog('info', 'Notificação enviada', { type })
  } catch (error) {
    safeLog('error', 'Falha ao enviar notificação', { type, error: (error as Error).message })
  }
}
