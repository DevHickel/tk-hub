import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const OPENAI_API_URL = 'https://api.openai.com/v1'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { message, conversation_id } = await req.json()

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const trimmedMessage = message.trim().slice(0, 2000)

    // 1. Gerar embedding da pergunta com text-embedding-3-small
    const embeddingRes = await fetch(`${OPENAI_API_URL}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: trimmedMessage,
      }),
    })

    if (!embeddingRes.ok) {
      const err = await embeddingRes.json()
      console.error('Embedding error:', err)
      throw new Error('Failed to generate embedding')
    }

    const embeddingData = await embeddingRes.json()
    const queryEmbedding = embeddingData.data[0].embedding

    // 2. Busca híbrida no banco usando função existente
    const { data: chunks, error: searchError } = await supabase.rpc('hybrid_search', {
      query_text: trimmedMessage,
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: 5,
    })

    if (searchError) {
      console.error('Hybrid search error:', searchError)
    }

    // 3. Montar contexto sanitizado
    const context = (chunks ?? [])
      .map((chunk: { content: string }) => sanitizeForPrompt(chunk.content))
      .join('\n\n---\n\n')
      .slice(0, 8000)

    // 4. Chamar gpt-4o-mini com contexto RAG
    const systemPrompt = context
      ? `Você é um assistente interno da TK Solution.
Responda APENAS com base nos documentos fornecidos no contexto abaixo.
Se a informação não estiver no contexto, diga exatamente: "Não encontrei essa informação nos documentos disponíveis."
Seja direto e objetivo. Use o idioma da pergunta do usuário.

Contexto dos documentos:
${context}`
      : `Você é um assistente interno da TK Solution.
Responda de forma útil e objetiva. Use o idioma da pergunta do usuário.
Informe quando não tiver certeza sobre uma informação.`

    let aiResponse = await callLLM('gpt-4o-mini', trimmedMessage, systemPrompt, openaiKey)

    // 5. Fallback para gpt-4o se resposta vaga
    const isVague =
      aiResponse.includes('Não encontrei') ||
      aiResponse.includes('não encontrei') ||
      aiResponse.length < 50

    if (isVague && context) {
      const betterResponse = await callLLM('gpt-4o', trimmedMessage, systemPrompt, openaiKey)
      if (betterResponse.length > aiResponse.length) {
        aiResponse = betterResponse
      }
    }

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('chat-rag error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

async function callLLM(
  model: string,
  userMessage: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  const res = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 1000,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    console.error(`LLM error (${model}):`, err)
    throw new Error(`LLM call failed: ${model}`)
  }

  const data = await res.json()
  return data.choices[0]?.message?.content ?? 'Não consegui gerar uma resposta.'
}

function sanitizeForPrompt(text: string): string {
  return text
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, '[REMOVIDO]')
    .replace(/você (agora |deve |é )?(ser|agir como|fingir)/gi, '[REMOVIDO]')
    .replace(/system\s*:/gi, '[REMOVIDO]')
    .replace(/\[INST\]|\[\/INST\]/g, '[REMOVIDO]')
    .slice(0, 4000)
}
