import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { QUEUES } from './index.js'

export interface PdfJobData {
  documentId: string
  filePath: string
  fileName: string
}

export const pdfQueue = new Queue<PdfJobData>(QUEUES.PDF_PROCESSING, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3, // tenta 3x antes de falhar (queue/SKILL.md)
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 }, // mantém últimos 100 jobs
    removeOnFail: { count: 50 },
  },
})
