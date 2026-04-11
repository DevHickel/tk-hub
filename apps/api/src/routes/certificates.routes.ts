import { Hono } from 'hono'
import * as Sentry from '@sentry/node'
import { certificateQueue } from '../queues/certificate.queue.js'
import type { AppVariables } from '../lib/context.js'
import { safeLog } from '../lib/logger.js'

export const certificatesRoutes = new Hono<{ Variables: AppVariables }>()

// POST /api/certificates/:id/extract
// Enqueues background extraction job for a previously uploaded certificate.
// Called by the frontend right after inserting the processed_certificates record.
certificatesRoutes.post('/certificates/:id/extract', async (c) => {
  const userId = c.get('userId')
  const certificateId = c.req.param('id')

  const body = await c.req.json().catch(() => null)
  const fileUrl: string | undefined = body?.file_url
  const fileName: string | undefined = body?.file_name

  if (!fileUrl || !fileName) {
    return c.json({ error: 'file_url and file_name are required' }, 400)
  }

  try {
    await certificateQueue.add('extract', { certificateId, fileUrl, fileName })
    safeLog('info', 'Certificate extraction enqueued', { certificateId, userId })
    return c.json({ queued: true })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'POST /api/certificates/:id/extract' } })
    return c.json({ error: 'Failed to enqueue extraction' }, 500)
  }
})
