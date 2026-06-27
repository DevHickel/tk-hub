import { Queue } from 'bullmq'
import { redis } from '../lib/redis.js'
import { QUEUES } from './index.js'

export interface TKProcedureSyncJobData {
  eventId: string                              // FK em external_sync_events
  externalId: string                            // ID na TK
  eventType: 'procedure.created' | 'procedure.updated' | 'procedure.deleted'
  title: string
  fileUrl?: string
  fileBase64?: string
  updatedAt: string
  metadata?: Record<string, unknown>
}

export const tkProcedureSyncQueue = new Queue<TKProcedureSyncJobData>(
  QUEUES.TK_PROCEDURE_SYNC,
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  },
)
