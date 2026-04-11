import { supabase } from '../../lib/supabase.js'
import { collectWeekMetrics } from './metrics.collector.js'
import { calcHoursSaved, calcAICost, DEFAULT_BENCHMARKS, type ReportConfig } from './hours.calculator.js'
import { buildManagementEmail } from './templates/management.template.js'
import { buildHREmail } from './templates/hr.template.js'
import { buildITEmail } from './templates/it.template.js'
import { sendEmail } from '../gmail.service.js'
import { safeLog } from '../../lib/logger.js'
import * as Sentry from '@sentry/node'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export async function getReportConfig(): Promise<ReportConfig> {
  const { data } = await supabase.from('report_config').select('*').maybeSingle()
  return (data as ReportConfig) ?? DEFAULT_BENCHMARKS
}

export async function getActiveRecipients(reportType: string) {
  const { data } = await supabase
    .from('report_recipients')
    .select('email, name')
    .eq('active', true)
    .in('report_type', [reportType, 'all'])
  return data ?? []
}

export function getReportSubject(
  type: 'management' | 'hr' | 'it',
  weekStart: Date,
  lang: string = 'pt'
): string {
  const period = format(weekStart, 'dd/MM/yyyy', { locale: ptBR })
  const labels = {
    management: lang === 'en' ? 'Management Report' : 'Relatório de Gestão',
    hr:         lang === 'en' ? 'HR Report' : 'Relatório de RH',
    it:         lang === 'en' ? 'IT Report' : 'Relatório de TI',
  }
  return `TK Solution — ${labels[type]} — semana ${period}`
}

export async function generateAndSendReports(weekStart: Date, weekEnd: Date) {
  const [metrics, config] = await Promise.all([
    collectWeekMetrics(weekStart, weekEnd),
    getReportConfig(),
  ])

  const hoursSaved = calcHoursSaved(metrics, config)
  const aiCost = calcAICost(metrics.model_usage)
  const lang = (config.language ?? 'pt') as 'pt' | 'en'

  const reportTypes = ['management', 'hr', 'it'] as const

  for (const type of reportTypes) {
    try {
      const recipients = await getActiveRecipients(type)
      if (recipients.length === 0) {
        safeLog('info', `Nenhum destinatário para ${type}`)
        continue
      }

      let html: string
      const subject = getReportSubject(type, weekStart, lang)

      if (type === 'management') {
        html = buildManagementEmail(metrics, config, hoursSaved, weekStart, weekEnd)
      } else if (type === 'hr') {
        html = buildHREmail(metrics, config, weekStart, weekEnd)
      } else {
        html = buildITEmail(metrics, config, aiCost, weekStart, weekEnd)
      }

      await Promise.all(recipients.map((r) => sendEmail(r.email, subject, html)))

      await supabase.from('weekly_report_log').insert({
        report_type: type,
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        recipients_count: recipients.length,
        metrics_snapshot: metrics as unknown as Record<string, unknown>,
        status: 'sent',
      })

      safeLog('info', `Relatório ${type} enviado`, { recipients: recipients.length })
    } catch (err) {
      Sentry.captureException(err, { tags: { job: 'weekly-report', type } })
      safeLog('error', `Falha ao enviar relatório ${type}`, { error: (err as Error).message })
      // Não interrompe os outros tipos de relatório
    }
  }
}
