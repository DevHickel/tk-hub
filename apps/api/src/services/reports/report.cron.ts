// Cron de relatórios — todo domingo às 00:00 BRT (reports/SKILL.md)
import cron from 'node-cron'
import * as Sentry from '@sentry/node'
import { generateAndSendReports } from './report.service.js'
import { safeLog } from '../../lib/logger.js'

export function setupReportCron() {
  cron.schedule(
    '0 0 * * 0', // todo domingo à meia-noite
    async () => {
      const weekEnd   = new Date()
      const weekStart = new Date(weekEnd)
      weekStart.setDate(weekStart.getDate() - 7)

      safeLog('info', 'Cron: gerando relatórios semanais...', {
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: weekEnd.toISOString().split('T')[0],
      })

      try {
        await generateAndSendReports(weekStart, weekEnd)
        safeLog('info', 'Relatórios semanais enviados com sucesso')
      } catch (err) {
        Sentry.captureException(err, { tags: { job: 'weekly-report-cron' } })
        safeLog('error', 'Falha no cron de relatórios', { error: (err as Error).message })
      }
    },
    { timezone: 'America/Sao_Paulo' }
  )

  safeLog('info', 'Cron configurado: relatórios semanais aos domingos 00:00 BRT')
}
