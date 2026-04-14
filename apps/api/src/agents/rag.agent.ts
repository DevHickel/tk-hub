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
  chatHistoryId?: string
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

    // 2. match_documents_with_feedback — retrieval com boost duplo
    // (global no chunk + contextual por embedding da pergunta)
    const { data: chunks, error: searchError } = await supabase.rpc(
      'match_documents_with_feedback' as never,
      {
        query_embedding: JSON.stringify(questionEmbedding),
        match_count: 10,
      } as never
    )

    if (searchError) {
      safeLog('warn', 'match_documents_with_feedback error', { error: searchError.message })
    }

    // 3. Filtrar por similarity efetiva mínima + já vem ordenado da RPC
    const MIN_SIMILARITY = 0.4
    const ranked = ((chunks as Array<{
      id: number
      content: string
      metadata?: Record<string, unknown>
      similarity?: number
      base_similarity?: number
      global_boost?: number
      contextual_boost?: number
      feedback_score?: number
    }>) ?? []).filter((c) => (c.similarity ?? 0) >= MIN_SIMILARITY)

    safeLog('info', 'chunks retrieved', {
      total: chunks?.length ?? 0,
      afterFilter: ranked.length,
      topSim: ranked[0]?.similarity,
      topBase: ranked[0]?.base_similarity,
      topGlobalBoost: ranked[0]?.global_boost,
      topContextBoost: ranked[0]?.contextual_boost,
    })

    const context = ranked
      .map((chunk, i) => {
        const source = (chunk.metadata?.source as string) ?? 'desconhecido'
        const page = (chunk.metadata?.page_number ?? chunk.metadata?.page ?? '') as string | number
        const section = chunk.metadata?.section as string | undefined
        const sim = (chunk.similarity ?? 0).toFixed(2)
        const header = `[Chunk #${i + 1} | relevância ${sim} | Fonte: ${source}${page ? ` | Pág. ${page}` : ''}${section ? ` | Seção: ${section}` : ''}]`
        return `${header}\n${sanitizeForPrompt(chunk.content)}`
      })
      .join('\n\n---\n\n')
      .slice(0, 10000)

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
2. **SUBTÍTULOS DENTRO DA MESMA CÉLULA (CRÍTICO):**
   * Uma única célula de tabela pode conter **múltiplos subtítulos** com fórmulas próprias. Ex: a célula do Esquadro contém "Esquadro Combinado", "Esquadro 90° — Para Esquadros de Precisão" e "Para Esquadro Simples" — cada um com dados próprios que **NÃO** se aplicam aos outros.
   * **Regra absoluta:** as fórmulas, notas e valores que aparecem sob um subtítulo são **exclusivos daquele subtítulo**. NUNCA copie a fórmula do "Esquadro 90° Precisão" como se fosse a do "Esquadro Combinado" (ou vice-versa).
   * **Como identificar subtítulo:** palavras em negrito, linhas isoladas que nomeiam um sub-equipamento ou sub-categoria dentro da célula. Tudo que aparece entre esse subtítulo e o próximo pertence ao primeiro.
3. **QUANDO A PERGUNTA É ESPECÍFICA (nome do sub-equipamento):**
   * Ex: "tolerância do Esquadro Combinado" → use **APENAS** os dados sob o subtítulo "Esquadro Combinado". Se esse subtítulo não existir no contexto, diga que não encontrou.
4. **QUANDO A PERGUNTA É GENÉRICA (só o equipamento):**
   * Ex: "tolerância do esquadro" → **LISTE TODOS os subtítulos** encontrados, cada um com seus próprios dados. Não escolha um só. Formato: seção dedicada por subtítulo, com fórmulas/valores/notas daquele subtítulo apenas.
5. **NOTAS E REFERÊNCIAS CRUZADAS (NÃO OMITIR):**
   * Se a célula contém notas auxiliares (ex: "Aferição na obra ver procedimento PR-TKS-QUA-003", "Calibração externa", "Ver tabela 07", validade "1 ano") — **inclua essas notas** na resposta. Elas são parte do critério.
6. **TRATAMENTO DE FÓRMULAS (CLEAN CODE):**
   * PROIBIDO usar sintaxe LaTeX crua (\\frac, \\varepsilon, \\mu).
   * Use "/" para divisões, "ε" para Epsilon, "µm" para Micrômetros.
   * Converta: \\varepsilon = 10 + \\frac{L}{60} → **ε = 10 + L/60 (µm)**
7. **SEPARAÇÃO DE TÓPICOS:**
   * Se houver subtítulos misturados (ex: "Esquadro Combinado" e "Esquadro 90º"), separe em parágrafos distintos com cabeçalhos claros ("### Esquadro Combinado", "### Esquadro 90° (Precisão)", etc.). Não misture regras de equipamentos diferentes.

# 6. REGRAS DE RESPOSTA E FORMATAÇÃO
1. **FONTE ÚNICA:** Responda APENAS com base no contexto. Se não achar, diga: *"Desculpe, analisei os documentos técnicos disponíveis e não encontrei essa especificação específica."*
2. **LINGUAGEM NATURAL (OBRIGATÓRIO):** Sempre comece com 1–2 frases explicando o conceito em linguagem natural, contextualizando o que o usuário pediu. Depois apresente os dados técnicos. NUNCA responda apenas com bullets ou tabela seca — o usuário precisa entender o *porquê*, não só o *quê*.
3. **ESTILO:**
   * **Para Procedimentos:** Breve introdução + lista numerada (passo a passo) + frase de fechamento explicando o objetivo do procedimento.
   * **Para Critérios/Tabelas:** Breve introdução + bullets ou tabela Markdown limpa + frase explicando como aplicar o critério na prática.

# 7. PROTOCOLO DE CITAÇÃO (OBRIGATÓRIO)
Todo chunk no CONTEXTO começa com um cabeçalho no formato exato:
\`[Chunk #N | relevância 0.XX | Fonte: NOME_DO_ARQUIVO | Pág. P | Seção: NOME_SEÇÃO]\`
(o campo \`Seção\` pode não aparecer em documentos antigos).

Os chunks vêm **ordenados do mais relevante (#1) para o menos relevante**. O **Chunk #1** é quase sempre o que tem a resposta.

**REGRA CRÍTICA DA SEÇÃO:** Se o cabeçalho trouxer \`Seção: X\`, trate aquele chunk como contendo **APENAS** dados da seção X. NUNCA importe fórmulas, valores ou regras de chunks com outra \`Seção:\` para responder sobre a seção X (e vice-versa). Se a pergunta é sobre "Esquadro Combinado" e existe um chunk com \`Seção: Esquadro Combinado\`, use SOMENTE aquele — ignore chunks com \`Seção: Esquadro 90°...\` ou qualquer outra.

Ao final de toda resposta técnica, adicione:
---
📍 **Fonte:** Documento *NOME_DO_ARQUIVO* | Pág. *P*

REGRAS CRÍTICAS DA CITAÇÃO:
1. **Identifique o chunk que de fato respondeu** à pergunta (normalmente #1). Cite a Pág. **DESSE chunk** — não a página de qualquer chunk do contexto.
2. Copie **literalmente** o NOME_DO_ARQUIVO e o número após "Pág." do cabeçalho do chunk escolhido. NUNCA invente.
3. NUNCA use o código do documento (ex: "003", "001") como número de página. O número de página é **apenas** o valor após "Pág." no cabeçalho.
4. Se a resposta usou dois chunks do mesmo arquivo em páginas distintas (ex: #1 Pág. 5 e #2 Pág. 6), liste ambas: *Pág. 5, 6*.
5. Se usou chunks de arquivos diferentes, liste cada fonte numa linha separada após o 📍.`

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

    // 8. Salvar no chat_history — só IDs dos chunks que realmente passaram do filtro
    // (não os 10 brutos). Isso mantém o loop de feedback preciso.
    const usedChunkIds = ranked.map((c) => c.id).filter((id): id is number => typeof id === 'number')

    const { data: histRow, error: histError } = await supabase
      .from('chat_history')
      .insert({
        user_id: userId,
        question: trimmed,
        answer: result.answer,
        chunks_used: usedChunkIds,
        model_used: modelUsed,
        tokens_used: result.tokensUsed,
      })
      .select('id')
      .single()

    if (histError) {
      safeLog('warn', 'chat_history insert error', { error: histError.message })
    }

    return {
      answer: result.answer,
      model: modelUsed,
      tokensUsed: result.tokensUsed,
      chatHistoryId: histRow?.id as string | undefined,
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { agent: 'rag', userId } })
    throw error
  }
}
