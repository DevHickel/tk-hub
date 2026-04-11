// Portado da Edge Function supabase/functions/chat-rag/index.ts
// Mantém toda a lógica de negócio — adiciona cache de embeddings e chat_history

import * as Sentry from '@sentry/node'
import { supabase } from '../lib/supabase.js'
import { openai } from '../lib/openai.js'
import { getOrCreateEmbedding } from '../services/embedding.service.js'
import { safeLog } from '../lib/logger.js'

interface RagResult {
  answer: string
  model: string
  tokensUsed: number
}

// Portado idêntico da Edge Function (security/SKILL.md §4)
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, '[REMOVIDO]')
    .replace(/você (agora |deve |é )?(ser|agir como|fingir)/gi, '[REMOVIDO]')
    .replace(/system\s*:/gi, '[REMOVIDO]')
    .replace(/\[INST\]|\[\/INST\]/g, '[REMOVIDO]')
    .slice(0, 4000) // limite por chunk
}

// Portado idêntico da Edge Function — lógica mini → 4o preservada
async function callLLM(
  model: string,
  userMessage: string,
  systemPrompt: string
): Promise<{ answer: string; tokensUsed: number }> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 1000,
    temperature: 0.2,
  })

  return {
    answer: response.choices[0]?.message?.content ?? 'Não consegui gerar uma resposta.',
    tokensUsed: response.usage?.total_tokens ?? 0,
  }
}

export async function answerQuestion(
  question: string,
  userId: string
): Promise<RagResult> {
  const trimmed = question.trim().slice(0, 2000) // limite de entrada

  try {
    // 1. Embedding da pergunta — com cache (rag-pipeline/SKILL.md)
    const questionEmbedding = await getOrCreateEmbedding(trimmed)

    // 2. Busca híbrida — usa função existente no banco
    const { data: chunks, error: searchError } = await supabase.rpc('hybrid_search', {
      query_text: trimmed,
      query_embedding: JSON.stringify(questionEmbedding),
      match_count: 5,
    })

    if (searchError) {
      safeLog('warn', 'hybrid_search error', { error: searchError.message })
    }

    // 3. Montar contexto sanitizado (security/SKILL.md §4)
    const context = ((chunks as Array<{ content: string }>) ?? [])
      .map((chunk) => sanitizeForPrompt(chunk.content))
      .join('\n\n---\n\n')
      .slice(0, 8000) // limite total do contexto

    // 4. System prompt do agente (rag-pipeline/SKILL.md)
    const systemPrompt = context
      ? `Você é um assistente interno da TK Solution.
Responda APENAS com base nos documentos fornecidos no contexto.
Se a informação não estiver no contexto, diga exatamente:
"Não encontrei essa informação nos documentos disponíveis."
Seja direto e objetivo. Use o idioma da pergunta do usuário.

Contexto dos documentos:
${context}`
      : `Você é um assistente interno da TK Solution.
Responda de forma útil e objetiva. Use o idioma da pergunta do usuário.
Informe quando não tiver certeza sobre uma informação.`

    // 5. gpt-4o-mini primeiro (filosofia de custo — context.md)
    let result = await callLLM('gpt-4o-mini', trimmed, systemPrompt)
    let modelUsed = 'gpt-4o-mini'

    // 6. Fallback para gpt-4o se resposta vaga (portado da Edge Function)
    const isVague =
      result.answer.includes('Não encontrei') ||
      result.answer.includes('não encontrei') ||
      result.answer.length < 50

    if (isVague && context) {
      safeLog('info', 'Fallback para gpt-4o', { userId })
      const fallback = await callLLM('gpt-4o', trimmed, systemPrompt)
      if (fallback.answer.length > result.answer.length) {
        result = fallback
        modelUsed = 'gpt-4o'
      }
    }

    // 7. Salvar no chat_history para analytics (adicionado vs Edge Function)
    await supabase.from('chat_history').insert({
      user_id: userId,
      question: trimmed,
      answer: result.answer,
      chunks_used: chunks ? JSON.stringify((chunks as Array<{ id: unknown }>).map((c) => c.id)) : null,
      model_used: modelUsed,
      tokens_used: result.tokensUsed,
    })

    return { answer: result.answer, model: modelUsed, tokensUsed: result.tokensUsed }
  } catch (error) {
    Sentry.captureException(error, { tags: { agent: 'rag', userId } })
    throw error
  }
}
