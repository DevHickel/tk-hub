// Monitoramento de caixas de email via IMAP para extração automática de certificados
// Fluxo: IMAP → download anexo → upload Storage → insert processed_certificates → enqueue certificateQueue

import { ImapFlow } from 'imapflow'
import { supabase } from '../lib/supabase.js'
import { certificateQueue } from '../queues/certificate.queue.js'
import { safeLog } from '../lib/logger.js'
import * as Sentry from '@sentry/node'
import { randomUUID } from 'crypto'
import path from 'path'

interface CertEmailAccount {
  id: string
  label: string
  imap_host: string
  imap_port: number
  imap_user: string
  imap_pass: string
  use_tls: boolean
  last_uid: number
  uid_validity: number
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_MESSAGES_PER_RUN = 50

let isPolling = false

export async function checkAllInboxes(): Promise<void> {
  if (isPolling) {
    safeLog('info', 'Inbox polling already in progress, skipping')
    return
  }

  isPolling = true
  try {
    const { data: accounts } = await supabase
      .from('certificate_email_accounts')
      .select('id, label, imap_host, imap_port, imap_user, imap_pass, use_tls, last_uid, uid_validity')
      .eq('active', true)

    if (!accounts || accounts.length === 0) return

    for (const account of accounts as CertEmailAccount[]) {
      try {
        await pollInbox(account)
      } catch (err) {
        const msg = (err as Error).message
        Sentry.captureException(err, { tags: { job: 'inbox-monitor', account: account.imap_user } })
        safeLog('error', `Erro ao verificar inbox ${account.label}`, { error: msg })

        await supabase
          .from('certificate_email_accounts')
          .update({ last_error: msg, updated_at: new Date().toISOString() })
          .eq('id', account.id)
      }
    }
  } finally {
    isPolling = false
  }
}

async function pollInbox(account: CertEmailAccount): Promise<void> {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.use_tls,
    auth: {
      user: account.imap_user,
      pass: account.imap_pass,
    },
    logger: false,
    emitLogs: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      // Check UID validity — if changed, reset last_uid
      const mb = client.mailbox
      const mailboxUidValidity = (mb && mb.uidValidity) ? mb.uidValidity : 0
      let lastUid = account.last_uid

      if (mailboxUidValidity !== account.uid_validity && account.uid_validity > 0) {
        safeLog('info', `UID validity changed for ${account.label}, resetting last_uid`, {
          old: account.uid_validity,
          new: mailboxUidValidity,
        })
        lastUid = 0
      }

      // Search for new messages
      const searchCriteria = lastUid > 0
        ? { uid: `${lastUid + 1}:*` }
        : { seen: false } // First run: only unseen messages

      let uids: number[]
      try {
        const searchResult = await client.search(searchCriteria)
        uids = (Array.isArray(searchResult) ? searchResult : [])
          .filter((uid: number) => uid > lastUid)
          .slice(0, MAX_MESSAGES_PER_RUN)
      } catch {
        uids = []
      }

      if (uids.length === 0) {
        safeLog('info', `Nenhuma mensagem nova em ${account.label}`)
      } else {
        safeLog('info', `${uids.length} mensagens novas em ${account.label}`)
      }

      let processedCount = 0

      for (const uid of uids) {
        try {
          const message = await client.fetchOne(String(uid), {
            bodyStructure: true,
            envelope: true,
          })

          if (!message || !('bodyStructure' in message) || !message.bodyStructure) continue

          const attachmentParts = findAttachmentParts(message.bodyStructure)

          for (const part of attachmentParts) {
            const mimeType = `${part.type}/${part.subtype}`.toLowerCase()
            if (!ALLOWED_MIME_TYPES.includes(mimeType)) continue

            // Download attachment
            const { content } = await client.download(String(uid), part.part)
            const chunks: Buffer[] = []
            for await (const chunk of content) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
            }
            const buffer = Buffer.concat(chunks)

            // Skip oversized files
            if (buffer.length > MAX_ATTACHMENT_SIZE) {
              safeLog('warn', `Anexo muito grande (${(buffer.length / 1024 / 1024).toFixed(1)}MB), ignorando`, {
                account: account.label,
                filename: part.dispositionParameters?.filename ?? 'unknown',
              })
              continue
            }

            const filename = part.dispositionParameters?.filename
              ?? part.parameters?.name
              ?? `certificate_${randomUUID().slice(0, 8)}.${getExtension(mimeType)}`

            // Upload to Supabase Storage
            const ext = path.extname(filename).toLowerCase() || `.${getExtension(mimeType)}`
            const storagePath = `inbox/${randomUUID()}${ext}`

            const { error: uploadError } = await supabase.storage
              .from('certificates')
              .upload(storagePath, buffer, { contentType: mimeType })

            if (uploadError) {
              safeLog('error', 'Falha ao fazer upload do anexo', { error: uploadError.message })
              continue
            }

            // Get public URL
            const { data: urlData } = supabase.storage
              .from('certificates')
              .getPublicUrl(storagePath)

            const fileUrl = urlData.publicUrl

            // Insert into processed_certificates
            const { data: cert, error: dbError } = await supabase
              .from('processed_certificates')
              .insert({
                file_name: filename,
                file_url: fileUrl,
                status: 'queued',
                source: 'email',
                source_email: account.imap_user,
              })
              .select('id')
              .single()

            if (dbError) {
              safeLog('error', 'Falha ao inserir certificado', { error: dbError.message })
              continue
            }

            // Enqueue for extraction (reuses existing pipeline)
            await certificateQueue.add('extract', {
              certificateId: cert.id,
              fileUrl,
              fileName: filename,
            })

            processedCount++
            safeLog('info', 'Certificado de email enfileirado', {
              account: account.label,
              filename,
              certId: cert.id,
            })
          }

          // Update last_uid after each message
          if (uid > lastUid) lastUid = uid
        } catch (err) {
          safeLog('warn', `Erro ao processar mensagem UID ${uid}`, {
            account: account.label,
            error: (err as Error).message,
          })
        }
      }

      // Update account state
      await supabase
        .from('certificate_email_accounts')
        .update({
          last_uid: lastUid,
          uid_validity: mailboxUidValidity,
          last_checked_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id)

      if (processedCount > 0) {
        safeLog('info', `${processedCount} certificados extraídos de ${account.label}`)
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
}

export async function testImapConnection(config: {
  imap_host: string
  imap_port: number
  imap_user: string
  imap_pass: string
  use_tls: boolean
}): Promise<{ success: boolean; error?: string; messageCount?: number }> {
  const client = new ImapFlow({
    host: config.imap_host,
    port: config.imap_port,
    secure: config.use_tls,
    auth: {
      user: config.imap_user,
      pass: config.imap_pass,
    },
    logger: false,
    emitLogs: false,
  })

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    const mb = client.mailbox
    const messageCount = (mb && 'exists' in mb) ? mb.exists ?? 0 : 0
    lock.release()
    await client.logout()
    return { success: true, messageCount }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// Recursively find attachment parts in MIME structure
function findAttachmentParts(structure: any): any[] {
  const parts: any[] = []

  if (structure.childNodes) {
    for (const child of structure.childNodes) {
      parts.push(...findAttachmentParts(child))
    }
  } else if (structure.disposition === 'attachment' || structure.disposition === 'inline') {
    if (structure.type && structure.subtype) {
      parts.push(structure)
    }
  } else if (structure.type && structure.subtype) {
    const mime = `${structure.type}/${structure.subtype}`.toLowerCase()
    if (ALLOWED_MIME_TYPES.includes(mime) && structure.size > 0) {
      parts.push(structure)
    }
  }

  return parts
}

function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  return map[mimeType] ?? 'bin'
}
