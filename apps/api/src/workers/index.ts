import { setupPdfWorker } from './pdf.worker.js'
import { setupEmailWorker } from './email.worker.js'
import { setupCertificateWorker } from './certificate.worker.js'
import { safeLog } from '../lib/logger.js'

export function setupWorkers() {
  safeLog('info', 'Iniciando workers BullMQ...')
  setupPdfWorker()
  setupEmailWorker()
  setupCertificateWorker()
  safeLog('info', 'Workers iniciados: pdf-processing, email-processing, certificate-extraction')
}
