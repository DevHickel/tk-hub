import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { QUEUES } from './index.js'

export interface EmailJobData {
  messageId: string   // Gmail message ID
  from: string        // remetente
}

export const emailQueue = new Queue<EmailJobData>(QUEUES.EMAIL_PROCESSING, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
})
