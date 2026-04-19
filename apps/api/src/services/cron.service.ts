import cron from 'node-cron'
import * as Sentry from '@sentry/node'
import { supabase } from '../lib/supabase.js'
import { sendEmail } from './email.service.js'
import { getExpiryTemplate } from './templates.service.js'
import { checkAllInboxes } from './inbox-monitor.service.js'
import { safeLog } from '../lib/logger.js'

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function differenceInDays(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24))
}

// Cron de vencimentos — todo dia às 08:00 horário de Brasília (dms/SKILL.md)
async function checkExpiringDocuments() {
  safeLog('info', 'Cron: verificando documentos vencendo...')

  const hoje = new Date()
  const em30 = addDays(hoje, 30)

  const { data: docs, error } = await supabase
    .from('processed_certificates')
    .select('id, file_name, employee_name, expiry_date')
    .eq('status', 'approved')
    .not('expiry_date', 'is', null)
    .gte('expiry_date', hoje.toISOString().split('T')[0])
    .lte('expiry_date', em30.toISOString().split('T')[0])

  if (error) {
    Sentry.captureException(error, { tags: { job: 'cron-expiry' } })
    return
  }

  for (const doc of docs ?? []) {
    const dias = differenceInDays(new Date(doc.expiry_date), hoje)

    // Notifica em [30, 15, 7, 3, 1] dias + dia do vencimento
    if (![30, 15, 7, 3, 1, 0].includes(dias)) continue

    const adminEmails = await getAdminEmails()
    const html = getExpiryTemplate(
      doc.file_name ?? 'Certificado',
      dias,
      doc.employee_name ?? 'Colaborador'
    )

    for (const email of adminEmails) {
      try {
        await sendEmail(
          email,
          dias === 0
            ? `🔴 Certificado vence HOJE: ${doc.file_name}`
            : `⚠️ Certificado vence em ${dias} dia${dias > 1 ? 's' : ''}: ${doc.file_name}`,
          html
        )
      } catch (err) {
        Sentry.captureException(err, { tags: { job: 'cron-expiry', docId: doc.id } })
      }
    }

    safeLog('info', 'Alerta de vencimento enviado', { docId: doc.id, dias })
  }
}

async function getAdminEmails(): Promise<string[]> {
  const { data } = await supabase
    .from('user_roles')
    .select('profiles(email)')
    .in('role', ['admin', 'manager'])

  return (data ?? [])
    .map((r: { profiles: { email: string | null } | { email: string | null }[] | null }) => {
      const p = r.profiles
      if (!p) return undefined
      if (Array.isArray(p)) return p[0]?.email ?? undefined
      return p.email ?? undefined
    })
    .filter((e): e is string => Boolean(e))
}

export function setupCron() {
  // Todo dia às 08:00 horário de Brasília
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        await checkExpiringDocuments()
      } catch (err) {
        Sentry.captureException(err, { tags: { job: 'cron-expiry' } })
      }
    },
    { timezone: 'America/Sao_Paulo' }
  )

  // A cada 10 minutos: verificar caixas de email para certificados
  cron.schedule(
    '*/10 * * * *',
    async () => {
      try {
        await checkAllInboxes()
      } catch (err) {
        Sentry.captureException(err, { tags: { job: 'cron-inbox-monitor' } })
      }
    },
    { timezone: 'America/Sao_Paulo' }
  )

  safeLog('info', 'Cron configurado: vencimentos às 08:00 BRT + inbox monitor a cada 10 min')
}
