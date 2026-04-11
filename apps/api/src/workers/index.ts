import { setupPdfWorker } from './pdf.worker.js'
import { setupEmailWorker } from './email.worker.js'
import { safeLog } from '../lib/logger.js'

export function setupWorkers() {
  safeLog('info', 'Iniciando workers BullMQ...')
  setupPdfWorker()
  setupEmailWorker()
  safeLog('info', 'Workers iniciados: pdf-processing, email-processing')
}
