import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { QUEUES } from './index.js'

export interface CertificateJobData {
  certificateId: string
  fileUrl: string
  fileName: string
}

export const certificateQueue = new Queue<CertificateJobData>(QUEUES.CERTIFICATE_EXTRACTION, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
})
