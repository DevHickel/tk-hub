import { setupPdfWorker } from './pdf.worker.js'
import { setupEmailWorker } from './email.worker.js'
import { setupCertificateWorker } from './certificate.worker.js'
import { setupTKProcedureSyncWorker } from './tk-procedure-sync.worker.js'
import { safeLog } from '../lib/logger.js'

export function setupWorkers() {
  safeLog('info', 'Iniciando workers BullMQ...')
  setupPdfWorker()
  setupEmailWorker()
  setupCertificateWorker()
  setupTKProcedureSyncWorker()
  safeLog('info', 'Workers iniciados: pdf-processing, email-processing, certificate-extraction, tk-procedure-sync')
}
