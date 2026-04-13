---
name: rag-pipeline
description: Regras para o pipeline de RAG — embedding, busca e resposta com IA
---

# RAG Pipeline

## Extração de texto — somente LlamaParse

LlamaParse é o único parser utilizado. Garante precisão máxima em formulários,
tabelas, colunas múltiplas e PDFs escaneados com OCR — exatamente os tipos de
documentos do DMS (ASO, NR, certificados, PPRA, PCMSO).

Não usar pdf-parse ou qualquer alternativa. Dado extraído incorretamente
contamina o banco silenciosamente e invalida alertas de vencimento.

## Cache de embeddings — obrigatório

```typescript
// services/embedding.service.ts
import crypto from 'crypto'

export async function getOrCreateEmbedding(
  text: string,
  clientId: string
): Promise<number[]> {
  const hash = crypto.createHash('sha256').update(text).digest('hex')

  // 1. checar cache — zero custo
  const { data: cached } = await supabase
    .from('embedding_cache')
    .select('embedding')
    .eq('hash', hash)
    .single()

  if (cached) {
    // incrementar hit_count para analytics
    await supabase.from('embedding_cache')
      .update({ hit_count: supabase.rpc('increment', { x: 1 }) })
      .eq('hash', hash)
    return cached.embedding
  }

  // 2. gerar novo — custa dinheiro
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',  // NUNCA large
    input: text,
  })
  const embedding = response.data[0].embedding

  // 3. salvar no cache
  await supabase.from('embedding_cache').insert({
    hash, embedding, client_id: clientId,
    text_preview: text.slice(0, 100)
  })

  return embedding
}
```

## Chunking

```typescript
export function chunkText(text: string, size = 500, overlap = 50): string[] {
  const words = text.split(' ')
  const chunks: string[] = []
  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '))
    if (i + size >= words.length) break
  }
  return chunks
}
```

## Busca híbrida — SQL exato

```sql
-- busca vetorial (top 5)
SELECT content, metadata, 1 - (embedding <=> $1::vector) as similarity
FROM document_chunks
WHERE client_id = $2
ORDER BY embedding <=> $1::vector
LIMIT 5;

-- busca full-text em paralelo (top 3)
SELECT content, metadata, ts_rank(to_tsvector('portuguese', content), query) as rank
FROM document_chunks, plainto_tsquery('portuguese', $3) query
WHERE client_id = $2
  AND to_tsvector('portuguese', content) @@ query
ORDER BY rank DESC
LIMIT 3;
```

## Agente RAG

```typescript
// agents/rag.agent.ts
export async function answerQuestion(
  question: string,
  clientId: string
): Promise<{ answer: string; model: string; tokensUsed: number }> {

  // 1. embedding da pergunta (com cache)
  const questionEmbedding = await getOrCreateEmbedding(question, clientId)

  // 2. busca híbrida
  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(questionEmbedding, clientId),
    fullTextSearch(question, clientId),
  ])

  // 3. deduplicar e montar contexto
  const context = deduplicateAndRank([...vectorResults, ...ftsResults])
    .slice(0, 5)
    .map(r => r.content)
    .join('\n\n---\n\n')

  // 4. gpt-4o-mini primeiro
  let answer = await callLLM('gpt-4o-mini', question, context)

  // 5. fallback para gpt-4o se resposta vaga
  const isVague = answer.includes('não encontrei') || answer.length < 50
  if (isVague) {
    answer = await callLLM('gpt-4o', question, context)
  }

  return { answer, model: isVague ? 'gpt-4o' : 'gpt-4o-mini', tokensUsed: 0 }
}
```

## System prompt do agente

```
Você é um assistente interno da TK Solution.
Responda APENAS com base nos documentos fornecidos no contexto.
Se a informação não estiver no contexto, diga exatamente:
"Não encontrei essa informação nos documentos disponíveis."
Seja direto e objetivo. Use o idioma da pergunta do usuário.

Contexto dos documentos:
{context}
```
