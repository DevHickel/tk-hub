import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'
import { openai } from '../lib/openai.js'
import { safeLog } from '../lib/logger.js'

// Cache de embeddings — obrigatório (rag-pipeline/SKILL.md)
// Evita recalcular embeddings idênticos → zero custo de API
export async function getOrCreateEmbedding(text: string): Promise<number[]> {
  const hash = crypto.createHash('sha256').update(text).digest('hex')

  // 1. checar cache — zero custo
  const { data: cached } = await supabase
    .from('embedding_cache')
    .select('embedding')
    .eq('hash', hash)
    .single()

  if (cached) {
    // incrementar hit_count para analytics (fire-and-forget)
    supabase
      .from('embedding_cache')
      .update({ hit_count: supabase.rpc('increment' as never, { x: 1 }) })
      .eq('hash', hash)
      .then(() => {})

    return cached.embedding as number[]
  }

  // 2. gerar novo embedding — custa dinheiro
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small', // NUNCA large (rag-pipeline/SKILL.md)
    input: text,
  })
  const embedding = response.data[0].embedding

  // 3. salvar no cache
  await supabase.from('embedding_cache').insert({
    hash,
    embedding: JSON.stringify(embedding),
    text_preview: text.slice(0, 100),
  })

  safeLog('info', 'Novo embedding gerado e cacheado', { hash: hash.slice(0, 8) })
  return embedding
}

// Chunking — (rag-pipeline/SKILL.md)
export function chunkText(text: string, size = 500, overlap = 50): string[] {
  const words = text.split(' ')
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '))
    if (i + size >= words.length) break
  }
  return chunks
}
