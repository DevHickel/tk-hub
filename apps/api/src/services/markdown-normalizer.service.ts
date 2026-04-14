// Normaliza o markdown emitido pelo LlamaParse para garantir que cada
// subtítulo/sub-equipamento dentro de uma célula de tabela vire um heading
// markdown (###) com bullets abaixo. Isso é crítico porque o LlamaParse
// frequentemente achata células com múltiplos subtítulos em uma única linha
// de tabela, e o chunker recursivo (chunkMarkdown) não consegue quebrar
// dentro de uma linha de tabela — então os três subtítulos do Esquadro
// (Combinado, 90° Precisão, Simples) caem no mesmo chunk e o TKzinho mistura.
//
// Rodamos gpt-4o-mini (barato) uma vez por página durante a ingestão.

import { openai } from '../lib/openai.js'
import { safeLog } from '../lib/logger.js'

const SYSTEM_PROMPT = `Você é um normalizador de markdown técnico. Recebe o markdown bruto de UMA página de um documento de engenharia e retorna a MESMA página reestruturada para ser consumida por um sistema RAG.

REGRAS ABSOLUTAS:
1. Preserve TODO o conteúdo do original. Não resuma, não reescreva, não remova informações. Apenas reestruture.
2. Se uma célula de tabela contiver múltiplos subtítulos (ex: "Esquadro Combinado", "Esquadro 90° Para Esquadros de Precisão", "Para Esquadro Simples"), EXTRAIA cada subtítulo da tabela e emita como heading markdown "### NOME DO SUBTÍTULO" FORA da tabela, seguido das fórmulas/valores daquele subtítulo em bullets ou parágrafo.
3. A linha-mãe da tabela (ex: "Esquadro", "Paquímetro") vira heading "## NOME". Cada sub-equipamento vira "### NOME".
4. Tabelas simples (uma única linha de dados por equipamento, sem subtítulos internos) devem ser convertidas em blocos: "## Equipamento" + bullets.
5. Se um subtítulo tiver notas/referências cruzadas (ex: "Aferição na obra ver PR-TKS-QUA-003", "Calibração externa", "Ver tabela 07", "Validade: 1 ano"), inclua essas notas como bullets do subtítulo — NUNCA omita.
6. Fórmulas: mantenha como estão no original. Não converta nem simplifique.
7. Cabeçalhos de documento (Título, Código, Revisão, etc.) ficam como parágrafo simples no topo.
8. NUNCA invente conteúdo. Se o original não tem algo, não coloque.
9. Se a página não tem nenhum subtítulo dentro de célula (só texto corrido, lista ou tabela simples), retorne o markdown basicamente igual ao original, apenas garantindo quebras de parágrafo adequadas.

Responda APENAS com o markdown normalizado. Sem explicações, sem comentários, sem blocos de código envolvendo o output.`

export async function normalizeMarkdown(rawMarkdown: string, pageNumber: number): Promise<string> {
  const trimmed = rawMarkdown.trim()
  if (trimmed.length < 80) return trimmed

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Página ${pageNumber}. Markdown bruto:\n\n${trimmed}` },
      ],
      temperature: 0,
      max_tokens: 4000,
    })

    const normalized = response.choices[0]?.message?.content?.trim() ?? ''

    // Safety net: se o LLM devolveu algo suspeitosamente pequeno (perdeu conteúdo),
    // volta para o original.
    if (normalized.length < trimmed.length * 0.5) {
      safeLog('warn', 'normalizeMarkdown output muito curto — usando original', {
        page: pageNumber,
        origLen: trimmed.length,
        newLen: normalized.length,
      })
      return trimmed
    }

    safeLog('info', 'markdown normalizado', {
      page: pageNumber,
      origLen: trimmed.length,
      newLen: normalized.length,
      tokens: response.usage?.total_tokens,
    })
    return normalized
  } catch (error) {
    safeLog('warn', 'normalizeMarkdown falhou — usando original', {
      page: pageNumber,
      error: (error as Error).message,
    })
    return trimmed
  }
}
