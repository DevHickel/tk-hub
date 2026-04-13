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

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

// Portado idêntico da Edge Function — lógica mini → 4o preservada
async function callLLM(
  model: string,
  userMessage: string,
  systemPrompt: string,
  history: HistoryMessage[] = []
): Promise<{ answer: string; tokensUsed: number }> {
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history,
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
  userId: string,
  _conversationId?: string
): Promise<RagResult> {
  const trimmed = question.trim().slice(0, 2000) // limite de entrada

  try {
    // 1. Embedding da pergunta — com cache (rag-pipeline/SKILL.md)
    const questionEmbedding = await getOrCreateEmbedding(trimmed)

    // 2. match_documents — igual ao workflow n8n (Vector Store tool limit=10)
    const { data: chunks, error: searchError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(questionEmbedding),
      match_count: 10,
    })

    if (searchError) {
      safeLog('warn', 'match_documents error', { error: searchError.message })
    }

    // 3. Montar contexto sanitizado com metadata para citação (security/SKILL.md §4)
    const context = ((chunks as Array<{ content: string; metadata?: Record<string, unknown> }>) ?? [])
      .map((chunk) => {
        const source = (chunk.metadata?.source as string) ?? 'desconhecido'
        const page = (chunk.metadata?.page_number ?? chunk.metadata?.page ?? '') as string | number
        const header = `[Fonte: ${source}${page ? ` | Pág. ${page}` : ''}]`
        return `${header}\n${sanitizeForPrompt(chunk.content)}`
      })
      .join('\n\n---\n\n')
      .slice(0, 10000) // limite total do contexto

    // 4. System prompt do agente TKzinho
    const basePrompt = `# 1. IDENTIDADE E PERSONA
Você é o **TKzinho**, o Consultor Técnico Sênior e Tutor Inteligente da TK Solution.
Sua função é democratizar o acesso à informação técnica, interpretando documentos complexos de engenharia e transformando-os em respostas precisas, seguras e acionáveis para engenheiros e técnicos em campo.

# 2. CONTEXTO DA EMPRESA
A TK Solution é referência em soluções industriais (mineração, siderurgia, energia). Seus colaboradores buscam respostas rápidas sobre procedimentos (PR), instruções de trabalho (IT) e especificações técnicas.

# 3. ANÁLISE DE INTENÇÃO E SINÔNIMOS
Antes de buscar, normalize os termos do usuário usando este mapa semântico:
* **Estrutura/Local:** "Obra" ↔ "Empreendimento" ↔ "Site" ↔ "Frente de Serviço" ↔ "Projeto".
* **Parâmetros:** "Critério" ↔ "Tolerância" ↔ "Aceitação" ↔ "Desvio Máximo" ↔ "Erro Admissível".
* **Ação:** "Verificar" ↔ "Inspecionar" ↔ "Aferir" ↔ "Checar".
* *Contexto:* Se o usuário perguntar "Qual o erro da obra?", entenda como "Qual a tolerância/critério de aceitação do projeto?".

# 4. HIERARQUIA DE DOCUMENTOS (FILTRO CRÍTICO)
Ao analisar o CONTEXTO, decida qual arquivo priorizar com base no nome do arquivo (metadata.source).
1. **SE A PERGUNTA FOR SOBRE CRITÉRIO/TOLERÂNCIA:**
   * (Ex: "Qual o erro permitido?", "Fórmula de aceitação", "Tolerância do esquadro")
   * **PRIORIDADE ABSOLUTA:** Use apenas arquivos contendo "CRITER. ACEITAÇÃO" ou "001".
   * **IGNORAR:** Descarte arquivos "PROCEDIMENTO" ou "003" se houver conflito. Procedimentos descrevem *como medir*, Critérios descrevem *quanto pode errar*.
2. **SE A PERGUNTA FOR SOBRE PROCEDIMENTO:**
   * (Ex: "Como medir?", "Passo a passo", "Forma de calibração")
   * **PRIORIDADE:** Use arquivos contendo "PROCEDIMENTO", "INSTRUÇÃO" ou "003".

# 5. REGRAS DE EXTRAÇÃO E LEITURA (RAG STRICT MODE)
1. **RASTREAMENTO VISUAL (TABELAS MARKDOWN):**
   * Se o usuário pede sobre um equipamento (ex: "Esquadro"), foque exclusivamente na LINHA que começa com esse nome.
   * **Anti-Alucinação:** Se a palavra "tolerância" estiver abaixo de outro equipamento, DESCARTE.
2. **TRATAMENTO DE FÓRMULAS (CLEAN CODE):**
   * PROIBIDO usar sintaxe LaTeX crua (\\frac, \\varepsilon, \\mu).
   * Use "/" para divisões, "ε" para Epsilon, "µm" para Micrômetros.
   * Converta: \\varepsilon = 10 + \\frac{L}{60} → **ε = 10 + L/60 (µm)**
3. **SEPARAÇÃO DE TÓPICOS:**
   * Se houver subtítulos misturados (ex: "Esquadro Combinado" e "Esquadro 90º"), separe em parágrafos distintos. Não misture regras de equipamentos diferentes.

# 6. REGRAS DE RESPOSTA E FORMATAÇÃO
1. **FONTE ÚNICA:** Responda APENAS com base no contexto. Se não achar, diga: *"Desculpe, analisei os documentos técnicos disponíveis e não encontrei essa especificação específica."*
2. **ESTILO:**
   * **Para Procedimentos:** Use lista numerada (passo a passo).
   * **Para Critérios/Tabelas:** Use bullet points ou recrie a tabela Markdown limpa. NÃO invente um passo a passo para dados estáticos.

# 7. PROTOCOLO DE CITAÇÃO (OBRIGATÓRIO)
Ao final de toda resposta técnica, identifique de qual chunk veio a informação e adicione:
---
📍 **Fonte:** Documento *[metadata.source]* | Pág. *[metadata.page_number]*`

    const systemPrompt = context
      ? `${basePrompt}

# CONTEXTO DOS DOCUMENTOS
${context}`
      : `${basePrompt}

*Nenhum documento relevante foi encontrado para esta pergunta. Responda com base no seu conhecimento geral sobre engenharia industrial, mas deixe claro que não há documentação interna disponível para embasar a resposta.*`

    // 5. Memória curta — últimos 4 turnos deste usuário (replica o nó Memory do n8n)
    const { data: historyRows } = await supabase
      .from('chat_history')
      .select('question, answer')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(4)

    const historyMessages: HistoryMessage[] = (historyRows ?? [])
      .reverse()
      .flatMap((h) => [
        { role: 'user' as const, content: h.question },
        { role: 'assistant' as const, content: h.answer },
      ])

    // 6. gpt-4o-mini primeiro (filosofia de custo — context.md)
    let result = await callLLM('gpt-4o-mini', trimmed, systemPrompt, historyMessages)
    let modelUsed = 'gpt-4o-mini'

    // 7. Fallback para gpt-4o se resposta vaga (portado da Edge Function)
    const isVague =
      result.answer.includes('Não encontrei') ||
      result.answer.includes('não encontrei') ||
      result.answer.length < 50

    if (isVague && context) {
      safeLog('info', 'Fallback para gpt-4o', { userId })
      const fallback = await callLLM('gpt-4o', trimmed, systemPrompt, historyMessages)
      if (fallback.answer.length > result.answer.length) {
        result = fallback
        modelUsed = 'gpt-4o'
      }
    }

    // 8. Salvar no chat_history para analytics (adicionado vs Edge Function)
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
