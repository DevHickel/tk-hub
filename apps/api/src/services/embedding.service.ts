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
// Separadores na mesma ordem do LangChain (markdown), usando regex para cobrir
// cabeçalhos de todos os níveis (h1–h6), code fences e horizontal rules.
const MARKDOWN_SEPARATORS: RegExp[] = [
  /\n#{1,6} /,      // headings h1 a h6
  /```\n/,          // code fence close
  /\n\*\*\*+\n/,    // *** horizontal rule
  /\n---+\n/,       // --- horizontal rule
  /\n___+\n/,       // ___ horizontal rule
  /\n\n/,           // parágrafo
  /\n/,             // linha
  / /,              // espaço
]

function mergeSplits(splits: string[], separator: string, size: number, overlap: number): string[] {
  const out: string[] = []
  let current: string[] = []
  let currentLen = 0
  const sepLen = separator.length

  for (const s of splits) {
    const sLen = s.length
    // Se adicionar esta parte estoura o size, fecha o chunk atual
    if (currentLen + (current.length > 0 ? sepLen : 0) + sLen > size && current.length > 0) {
      out.push(current.join(separator))
      // Aplica overlap: mantém as últimas partes até somar ~overlap chars
      while (currentLen > overlap && current.length > 0) {
        currentLen -= current[0].length + (current.length > 1 ? sepLen : 0)
        current.shift()
      }
    }
    current.push(s)
    currentLen += sLen + (current.length > 1 ? sepLen : 0)
  }
  if (current.length > 0) out.push(current.join(separator))
  return out.map(c => c.trim()).filter(Boolean)
}

export function chunkMarkdown(text: string, size = 5000, overlap = 500): string[] {
  if (!text.trim()) return []

  const splitRecursive = (input: string, sepIdx: number): string[] => {
    if (sepIdx >= MARKDOWN_SEPARATORS.length) {
      // fallback char-level
      const out: string[] = []
      for (let i = 0; i < input.length; i += size - overlap) {
        out.push(input.slice(i, i + size))
      }
      return out
    }

    const sepRe = MARKDOWN_SEPARATORS[sepIdx]
    // Se o separador não está presente, desce para o próximo
    if (!sepRe.test(input)) return splitRecursive(input, sepIdx + 1)

    // Usa um split que mantém o separador conceitualmente (usamos o match como
    // delimitador e perdemos o literal, como faz a versão original do LangChain.js)
    const parts = input.split(new RegExp(sepRe.source, 'g'))
    const goodSplits: string[] = []
    const finalChunks: string[] = []

    for (const part of parts) {
      if (part.length < size) {
        goodSplits.push(part)
      } else {
        if (goodSplits.length > 0) {
          finalChunks.push(...mergeSplits(goodSplits, '\n', size, overlap))
          goodSplits.length = 0
        }
        // Recurse com próximo separador
        finalChunks.push(...splitRecursive(part, sepIdx + 1))
      }
    }
    if (goodSplits.length > 0) {
      finalChunks.push(...mergeSplits(goodSplits, '\n', size, overlap))
    }
    return finalChunks
  }

  return splitRecursive(text, 0).map(c => c.trim()).filter(Boolean)
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
