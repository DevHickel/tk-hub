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

// Chunking por palavras — mantido para compatibilidade
export function chunkText(text: string, size = 500, overlap = 50): string[] {
  const words = text.split(' ')
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '))
    if (i + size >= words.length) break
  }
  return chunks
}

// Splitter recursivo markdown-aware — replica LangChain RecursiveCharacterTextSplitter
// com splitCode='markdown', igual ao workflow n8n original.
// Separadores tentados em ordem: cabeçalhos → parágrafos → linhas → espaços → char.
const MARKDOWN_SEPARATORS = ['\n## ', '\n### ', '\n#### ', '\n\n', '\n', ' ', '']

export function chunkMarkdown(text: string, size = 5000, overlap = 500): string[] {
  if (!text.trim()) return []
  if (text.length <= size) return [text]

  const split = (input: string, sepIdx: number): string[] => {
    if (input.length <= size) return [input]
    const sep = MARKDOWN_SEPARATORS[sepIdx]
    if (sep === '') {
      const out: string[] = []
      for (let i = 0; i < input.length; i += size - overlap) {
        out.push(input.slice(i, i + size))
      }
      return out
    }
    const parts = input.split(sep)
    const out: string[] = []
    let buf = ''
    for (const part of parts) {
      const piece = buf ? buf + sep + part : part
      if (piece.length <= size) {
        buf = piece
      } else {
        if (buf) out.push(buf)
        if (part.length > size) {
          out.push(...split(part, sepIdx + 1))
          buf = ''
        } else {
          buf = part
        }
      }
    }
    if (buf) out.push(buf)
    return out
  }

  const raw = split(text, 0)
  if (overlap <= 0 || raw.length <= 1) return raw.map(c => c.trim()).filter(Boolean)

  const withOverlap: string[] = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1]
    const tail = prev.slice(Math.max(0, prev.length - overlap))
    withOverlap.push((tail + raw[i]).slice(0, size))
  }
  return withOverlap.map(c => c.trim()).filter(Boolean)
}

// Chunking por caracteres — legado (só parágrafos). Mantido para compatibilidade.
export function chunkTextByChars(text: string, size = 5000, overlap = 500): string[] {
  if (text.length <= size) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + size
    // Try to break at a paragraph boundary within the last 20% of the chunk
    if (end < text.length) {
      const breakSearch = text.lastIndexOf('\n\n', end)
      if (breakSearch > start + size * 0.8) end = breakSearch
    }
    chunks.push(text.slice(start, end).trim())
    start = end - overlap
    if (start >= text.length) break
  }
  return chunks.filter(c => c.length > 0)
}
