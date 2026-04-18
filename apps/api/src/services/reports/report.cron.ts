// Cron de relatórios — verifica a cada hora se é hora de enviar,
// com base em send_day e send_hour configurados no report_config.
import cron from 'node-cron'
import * as Sentry from '@sentry/node'
import { generateAndSendReports, getReportConfig } from './report.service.js'
import { supabase } from '../../lib/supabase.js'
import { safeLog } from '../../lib/logger.js'

async function alreadySentThisWeek(weekStart: Date): Promise<boolean> {
  const { count } = await supabase
    .from('weekly_report_log')
    .select('id', { count: 'exact', head: true })
    .eq('week_start', weekStart.toISOString().split('T')[0])
  return (count ?? 0) > 0
}

export function setupReportCron() {
  // Verifica a cada hora se é o momento configurado para enviar
  cron.schedule(
    '0 * * * *', // a cada hora cheia
    async () => {
      try {
        const config = await getReportConfig()
        const sendDay = config.send_day ?? 0   // default domingo
        const sendHour = config.send_hour ?? 0  // default meia-noite

        // Hora atual em BRT (UTC-3)
        const now = new Date()
        const brt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
        const currentDay = brt.getDay()   // 0=domingo
        const currentHour = brt.getHours()

        if (currentDay !== sendDay || currentHour !== sendHour) return

        // É o dia e hora certos — verificar se já enviou nesta semana
        const weekEnd = new Date()
        const weekStart = new Date(weekEnd)
        weekStart.setDate(weekStart.getDate() - 7)

        if (await alreadySentThisWeek(weekStart)) {
          safeLog('info', 'Relatórios já enviados nesta semana — ignorando')
          return
        }

        safeLog('info', 'Cron: gerando relatórios semanais...', {
          weekStart: weekStart.toISOString().split('T')[0],
          weekEnd: weekEnd.toISOString().split('T')[0],
          sendDay,
          sendHour,
        })

        await generateAndSendReports(weekStart, weekEnd)
        safeLog('info', 'Relatórios semanais enviados com sucesso')
      } catch (err) {
        Sentry.captureException(err, { tags: { job: 'weekly-report-cron' } })
        safeLog('error', 'Falha no cron de relatórios', { error: (err as Error).message })
      }
    },
    { timezone: 'America/Sao_Paulo' }
  )

  safeLog('info', 'Cron configurado: verificação horária para envio de relatórios (dia/hora configuráveis)')
}
