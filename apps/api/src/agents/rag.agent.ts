// Portado da Edge Function supabase/functions/chat-rag/index.ts
// Mantém toda a lógica de negócio — adiciona cache de embeddings e chat_history

import * as Sentry from '@sentry/node'
import { supabase } from '../lib/supabase.js'
import { openai } from '../lib/openai.js'
import { getOrCreateEmbedding } from '../services/embedding.service.js'
import { safeLog } from '../lib/logger.js'

export interface RagSource {
  file_name: string
  page: number
  image_url: string
  label?: string // e.g., "Tabela 14 — Multímetro Digital"; absent means full-page source
}

interface RagResult {
  answer: string
  model: string
  tokensUsed: number
  chatHistoryId?: string
  sources: RagSource[]
}

// Filtro de prompt injection (security/SKILL.md §4) — sem truncar o conteúdo.
// Truncagem estava cortando 1000 chars de cada chunk (chunks têm até 5000).
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi, '[REMOVIDO]')
    .replace(/você (agora |deve |é )?(ser|agir como|fingir)/gi, '[REMOVIDO]')
    .replace(/system\s*:/gi, '[REMOVIDO]')
    .replace(/\[INST\]|\[\/INST\]/g, '[REMOVIDO]')
}

type HistoryMessage = { role: 'user' | 'assistant'; content: string }

// Extrai a linha `TABLES_USED: <label1>;;<label2>` (ou `TABLES_USED: NONE`) do final
// da resposta do LLM e a remove do texto exibido. Retorna:
//   - `labels: null`  → LLM esqueceu o marcador → fallback ao comportamento antigo
//   - `labels: []`    → LLM declarou NONE → sem tabelas específicas
//   - `labels: [...]` → lista a filtrar em `sources[]`
const TABLES_USED_RE = /^[ \t]*TABLES_USED:[ \t]*(.*?)[ \t]*$/m
function extractUsedTableLabels(answer: string): { answer: string; labels: string[] | null } {
  const m = answer.match(TABLES_USED_RE)
  if (!m) return { answer, labels: null }
  const cleaned = answer.replace(TABLES_USED_RE, '').replace(/\n{3,}$/g, '\n\n').trimEnd()
  const raw = m[1].trim()
  if (raw.length === 0 || raw.toUpperCase() === 'NONE') {
    return { answer: cleaned, labels: [] }
  }
  const labels = raw
    .split(';;')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return { answer: cleaned, labels }
}

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
    max_tokens: 2000,
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
        match_count: 15,
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

    // Log diagnóstico: o que o LLM vai realmente ver.
    for (let i = 0; i < Math.min(ranked.length, 10); i++) {
      const c = ranked[i]
      safeLog('info', `chunk[${i + 1}]`, {
        source: c.metadata?.source,
        page: c.metadata?.page_number ?? c.metadata?.page,
        sim: c.similarity,
        len: c.content.length,
        preview: c.content.slice(0, 300),
      })
    }

    // Contexto sem truncagem per-chunk. Limite total 60k chars — gpt-4.1-mini
    // tem 128k tokens de janela, sobra espaço. O n8n envia os 10 chunks inteiros.
    const context = ranked
      .map((chunk, i) => {
        const source = (chunk.metadata?.source as string) ?? 'desconhecido'
        const page = (chunk.metadata?.page_number ?? chunk.metadata?.page ?? '') as string | number
        const sim = (chunk.similarity ?? 0).toFixed(2)
        const tables = (chunk.metadata?.page_tables as Array<{ label?: string }> | undefined) ?? []
        const tableLabels = tables
          .map((t) => (typeof t?.label === 'string' ? t.label.trim() : ''))
          .filter((l) => l.length > 0)
        const tablesLine = tableLabels.length > 0
          ? `\nTabelas disponíveis nesta página: ${tableLabels.join('; ')}`
          : ''
        const header = `[Chunk #${i + 1} | relevância ${sim} | Fonte: ${source}${page ? ` | Pág. ${page}` : ''}]${tablesLine}`
        return `${header}\n${sanitizeForPrompt(chunk.content)}`
      })
      .join('\n\n---\n\n')
      .slice(0, 60000)

    // 4. System prompt do agente TKzinho (lógica n8n + few-shot)
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
Ao analisar o \`CONTEXTO\`, você deve decidir qual arquivo priorizar baseando-se no nome do arquivo (\`metadata.source\`).
1. **SE A PERGUNTA FOR SOBRE CRITÉRIO/TOLERÂNCIA:**
   * (Ex: "Qual o erro permitido?", "Fórmula de aceitação", "Tolerância do esquadro")
   * **PRIORIDADE ABSOLUTA:** Use apenas informações de arquivos contendo **"CRITER. ACEITAÇÃO"** ou **"001"**.
   * **IGNORAR:** Descarte informações de arquivos "PROCEDIMENTO" ou "003" se houver conflito. Procedimentos descrevem *como medir*, Critérios descrevem *quanto pode errar*.
2. **SE A PERGUNTA FOR SOBRE PROCEDIMENTO:**
   * (Ex: "Como medir?", "Passo a passo", "Forma de calibração")
   * **PRIORIDADE:** Use arquivos contendo **"PROCEDIMENTO"**, **"INSTRUÇÃO"** ou **"003"**.

# 5. REGRAS DE EXTRAÇÃO E LEITURA (RAG STRICT MODE)
Uma vez selecionado o documento correto, siga estas regras de leitura:

0. **LEIA TODOS OS CHUNKS (REGRA ZERO — MAIS IMPORTANTE):**
   * Antes de responder, leia **TODOS** os chunks do CONTEXTO, não apenas o Chunk #1.
   * O chunk com a resposta pode estar em qualquer posição (#1, #5, #10...). Chunks de páginas vizinhas frequentemente contêm informações complementares essenciais.
   * Se o usuário pergunta sobre "modo de calibração do Multímetro Digital" e o Chunk #1 tem especificações técnicas mas o Chunk #8 tem o modo de calibração — use o Chunk #8.
   * **NUNCA diga "não encontrei" ou "não está detalhado" sem ter verificado TODOS os chunks.** Se a informação está em qualquer chunk do contexto, você DEVE usá-la.

1. **RASTREAMENTO VISUAL (TABELAS MARKDOWN):**
   * O texto está estruturado em tabelas. Se o usuário pede sobre um equipamento (ex: "Esquadro"), foque **exclusivamente na LINHA** que começa com esse nome.
   * **Algoritmo:** Procure a linha \`| [Número] | Esquadro | ... |\`.
   * **Anti-Alucinação:** Se encontrar a palavra "tolerância", verifique se o título imediatamente acima ou na esquerda é realmente do equipamento pedido. Se estiver abaixo de "Régua" ou "Glicosímetro", **DESCARTE**.

2. **TRATAMENTO DE FÓRMULAS (CLEAN CODE):**
   * Você está **PROIBIDO** de usar sintaxe LaTeX crua na resposta (como \`\\frac\`, \`\\varepsilon\`, \`\\mu\`).
   * **Converta para Texto:**
     * Use \`/\` para divisões.
     * Use \`ε\` para Epsilon.
     * Use \`µm\` para Micrômetros.
   * *Exemplo:* Converta \`\\varepsilon = 10 + \\frac{L}{60}\` para **\`ε = 10 + L/60 (µm)\`**.

3. **SEPARAÇÃO DE TÓPICOS (HIERARQUIA):**
   * Se dentro de um mesmo bloco de texto houver subtítulos misturados (ex: "Esquadro Combinado" seguido de "Esquadro 90º" seguido de "Esquadro Simples"), você deve separá-los visualmente em parágrafos ou bullet points distintos. Não misture regras de equipamentos diferentes na mesma frase.
   * As fórmulas, notas e valores que aparecem sob um subtítulo são **exclusivos daquele subtítulo**. NUNCA copie a fórmula do "Esquadro 90° Precisão" como se fosse a do "Esquadro Combinado" (ou vice-versa).

4. **COMPLETUDE OBRIGATÓRIA (REGRA CRÍTICA):**
   * Ao listar tipos, subtipos ou variantes de um equipamento, você **DEVE** listar **TODOS** os que aparecem no contexto, sem exceção. Se o contexto tem 3 subtipos (ex: Esquadro Combinado, Esquadro 90°, Esquadro Simples), os 3 devem estar na resposta.
   * **NUNCA** pare após listar apenas os primeiros 2 subtipos. Sempre verifique se há mais variantes no texto.
   * Se o usuário perguntar genericamente (ex: "me fale sobre esquadros"), a resposta deve cobrir **todos** os subtipos encontrados.

# 6. REGRAS DE RESPOSTA E FORMATAÇÃO
1. **FONTE ÚNICA:** Responda APENAS com base no contexto. Se não achar, diga: *"Desculpe, analisei os documentos técnicos disponíveis e não encontrei essa especificação específica."*
2. **ESTILO:**
   * **Para Procedimentos:** Use lista numerada (Passo a passo).
   * **Para Critérios/dados pontuais (fórmula, tolerância, valor único):** Use bullet points curtos com o valor em negrito.
   * **Para Tabelas grandes (multi-coluna, muitas linhas, especificações técnicas):** **NUNCA** reconstrua a tabela em markdown — a formatação quebra no chat. Em vez disso:
     1. Abra com um parágrafo explicando o que a tabela representa (ex: "A Tabela 14 traz a precisão e resolução do Multímetro Digital nos modelos 175, 177 e 179").
     2. Destaque em bullets **apenas** os 3-5 pontos mais relevantes pra pergunta do usuário, em linguagem natural (ex: "Em Volts CC na faixa de 6V, a precisão é de 0,15% + 2 contagens no modelo 175").
     3. Feche com uma frase convidando à imagem: *"A tabela completa com todas as faixas e funções está na imagem da fonte abaixo."*
   * O usuário **sempre** recebe junto da resposta uma miniatura da página original do PDF — use isso como muleta. Dado tabular denso não precisa virar texto, basta ser referenciado.

# 7. PROTOCOLO DE CITAÇÃO (OBRIGATÓRIO)
Todo chunk no CONTEXTO começa com um cabeçalho no formato exato:
\`[Chunk #N | relevância 0.XX | Fonte: NOME_DO_ARQUIVO | Pág. P]\`

Os chunks vêm **ordenados do mais relevante (#1) para o menos relevante**. O **Chunk #1** é quase sempre o que tem a resposta.

Ao final de toda resposta técnica, adicione:
---
📍 **Fonte:** Documento *NOME_DO_ARQUIVO* | Pág. *P*

REGRAS CRÍTICAS DA CITAÇÃO:
1. **Identifique o chunk que de fato respondeu** à pergunta (normalmente #1). Cite a Pág. **DESSE chunk** — não a página de qualquer chunk do contexto.
2. Copie **literalmente** o NOME_DO_ARQUIVO e o número após "Pág." do cabeçalho do chunk escolhido. NUNCA invente.
3. NUNCA use o código do documento (ex: "003", "001") como número de página. O número de página é **apenas** o valor após "Pág." no cabeçalho.
4. Se a resposta usou dois chunks do mesmo arquivo em páginas distintas (ex: #1 Pág. 5 e #2 Pág. 6), liste ambas: *Pág. 5, 6*.
5. Se usou chunks de arquivos diferentes, liste cada fonte numa linha separada após o 📍.

# 8. TAG DE TABELAS USADAS (OBRIGATÓRIO NO FINAL)
Depois da citação 📍 Fonte, numa NOVA linha, escreva EXATAMENTE:

\`TABLES_USED: <label1>;;<label2>\`

Onde cada \`<labelN>\` é copiado **LITERALMENTE** do campo "Tabelas disponíveis nesta página" de algum chunk do CONTEXTO, correspondendo às tabelas cujo conteúdo você de fato usou para responder.

- Se usou dados da **Tabela 14 — Multímetro Digital** e da **Tabela 13 — Multímetro Digital**, escreva: \`TABLES_USED: Tabela 13 — Multímetro Digital;;Tabela 14 — Multímetro Digital\`.
- Se a resposta foi texto corrido (fórmulas, parágrafos, procedimento) sem puxar especificações tabulares, escreva: \`TABLES_USED: NONE\`.
- **NUNCA** invente labels que não estão em nenhum cabeçalho "Tabelas disponíveis". Se não tem certeza se usou uma tabela específica, prefira \`NONE\`.
- Essa linha é um **marcador interno** para o sistema — não explique, não formate, não comente sobre ela.

# EXEMPLO DE SAÍDA ESPERADA (Few-Shot)
*Usuário:* "Critério do esquadro"
*Contexto (Tabela):* \`| 16 | Esquadro | ... Esquadro Combinado ... Esquadro 90° ... Para Esquadro Simples ... |\`
*Resposta:*
"Para o Esquadro, os critérios de aceitação são:

**Esquadro Combinado:**
* O erro máximo permitido para paralelismo e retilinidade é dado pela fórmula: **ε = 10 + L/60 (µm)**, onde L = comprimento da régua em mm.
* Para deslocamento angular do goniômetro: **0° 30'**.

**Esquadro 90°:**
* Para Esquadros de Precisão, a ortogonalidade máxima permitida é: **t = 20 + Li/10 (µm)**.
* Planicidade ou Retilinidade: **r = 4 + Li/50 (µm)**, onde Li = Comprimento em mm.

**Esquadro Simples:**
* Não se mede a Planicidade ou Retilinidade e a tolerância da Ortogonalidade é de **15' (quinze minutos)**.

---
📍 **Fonte:** Documento *FD-TKS-QUA-001_R.0.pdf* | Pág. *5*
TABLES_USED: NONE"`

    const systemPrompt = context
      ? `${basePrompt}

# CONTEXTO DOS DOCUMENTOS
${context}`
      : `${basePrompt}

*Nenhum documento relevante foi encontrado para esta pergunta. Responda com base no seu conhecimento geral sobre engenharia industrial, mas deixe claro que não há documentação interna disponível para embasar a resposta.*`

    // 5. Memória desativada: o n8n não injeta histórico no AI Agent (Memory input vazio).
    // Injetar chat_history polui o contexto — respostas erradas anteriores reforçam o erro
    // nas tentativas seguintes porque o LLM imita o turno mais recente como "verdade".
    const historyMessages: HistoryMessage[] = []

    // 6. gpt-4.1-mini primeiro (modelo usado pelo n8n que já validou precisão)
    let result = await callLLM('gpt-4.1-mini', trimmed, systemPrompt, historyMessages)
    let modelUsed = 'gpt-4.1-mini'

    // 7. Fallback para gpt-4.1 se resposta vaga
    const isVague =
      result.answer.includes('Não encontrei') ||
      result.answer.includes('não encontrei') ||
      result.answer.length < 50

    if (isVague && context) {
      safeLog('info', 'Fallback para gpt-4.1', { userId })
      const fallback = await callLLM('gpt-4.1', trimmed, systemPrompt, historyMessages)
      if (fallback.answer.length > result.answer.length) {
        result = fallback
        modelUsed = 'gpt-4.1'
      }
    }

    // 8. Extrair marcador `TABLES_USED:` do final da resposta. Isso permite o LLM
    // declarar quais tabelas ele de fato consultou — evita mostrar crops irrelevantes
    // que só ranquearam por conterem o nome do equipamento como coluna.
    // Log da resposta bruta para diagnóstico da linha TABLES_USED
    const lastLines = result.answer.split('\n').slice(-5).join('\n')
    safeLog('info', 'answer tail (pre-strip)', { lastLines })

    const extracted = extractUsedTableLabels(result.answer)
    result.answer = extracted.answer
    const usedLabels = new Set((extracted.labels ?? []).map((l) => l.toLowerCase()))
    safeLog('info', 'TABLES_USED parsed', {
      declared: extracted.labels,
      count: extracted.labels?.length ?? null,
      fallbackMode: extracted.labels === null ? 'LLM_OMITTED' : extracted.labels.length === 0 ? 'NONE' : 'GUIDED',
    })

    // 9. Montar `sources[]`. Modo guiado: se o LLM citou labels, só devolve esses crops.
    // Fallback: se não citou nada (labels null) ou citou labels que não batem com nenhum
    // chunk, cai pra lógica antiga — crops da página top + página inteira como last resort.
    const sources: RagSource[] = []
    const seenSources = new Set<string>()
    const pushSource = (file_name: string, page: number, image_path: string, label?: string) => {
      const key = `${file_name}::${page}::${label ?? 'page'}`
      if (seenSources.has(key)) return
      seenSources.add(key)
      const { data: pub } = supabase.storage.from('document-pages').getPublicUrl(image_path)
      sources.push({ file_name, page, image_url: pub.publicUrl, label })
    }

    if (usedLabels.size > 0) {
      // Modo guiado pelo LLM: varre todos os chunks (não só top-3) procurando crops
      // cujo label foi citado. Isso permite pegar Tabela 13 mesmo se o chunk dela não
      // for top-1 em similaridade — basta estar em algum chunk do match_count=15.
      for (const chunk of ranked) {
        const fileName = (chunk.metadata?.source as string | undefined) ?? null
        const pageRaw = chunk.metadata?.page_number ?? chunk.metadata?.page
        const page = typeof pageRaw === 'number' ? pageRaw : Number(pageRaw)
        if (!fileName || !Number.isFinite(page)) continue
        const tables = (chunk.metadata?.page_tables as Array<{ label: string; image_path: string }> | undefined) ?? []
        for (const t of tables) {
          if (!t?.label || !t?.image_path) continue
          if (!usedLabels.has(t.label.toLowerCase())) continue
          pushSource(fileName, page, t.image_path, t.label)
          if (sources.length >= 5) break
        }
        if (sources.length >= 5) break
      }
    }

    // Fallback: LLM não declarou TABLES_USED ou nenhum crop bateu.
    // Só mostra página inteira do top chunk — NUNCA crops aleatórios, pois podem ser
    // de tabelas irrelevantes que só ranquearam por conter o nome do equipamento.
    if (sources.length === 0) {
      for (const chunk of ranked) {
        if (sources.length >= 2) break
        const fileName = (chunk.metadata?.source as string | undefined) ?? null
        const pageRaw = chunk.metadata?.page_number ?? chunk.metadata?.page
        const page = typeof pageRaw === 'number' ? pageRaw : Number(pageRaw)
        if (!fileName || !Number.isFinite(page)) continue

        const imagePath = chunk.metadata?.page_image_path as string | undefined
        if (imagePath) pushSource(fileName, page, imagePath)
      }
    }

    // 9. Salvar no chat_history — só IDs dos chunks que realmente passaram do filtro
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
      sources,
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { agent: 'rag', userId } })
    throw error
  }
}
