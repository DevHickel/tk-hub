import { Redis } from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // obrigatório para BullMQ
  retryStrategy: (times) => Math.min(times * 50, 2000),
})

redis.on('error', (err) => {
  // não logar o erro completo — pode conter dados sensíveis
  console.error('[redis] connection error:', err.message)
})
