import OpenAI from 'openai'

// timeout: 60s cobre LLM chamadas longas; maxRetries: 5 aguenta quedas
// transitórias de TCP. fetch: globalThis.fetch força usar o undici nativo
// do Node 20+ em vez do node-fetch v2 que o SDK carrega como shim e que
// quebra na descompressão gzip com ERR_STREAM_PREMATURE_CLOSE em redes
// instáveis (visto em produção do Easypanel: stack vinha de
// /app/node_modules/node-fetch/lib/index.js:400 Gunzip.<anonymous>).
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  timeout: 60_000,
  maxRetries: 5,
  fetch: globalThis.fetch as unknown as typeof globalThis.fetch,
})
