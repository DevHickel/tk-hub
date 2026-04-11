// Extração de campos — código primeiro, IA depois (dms/SKILL.md)
// Regex tenta primeiro; gpt-4o-mini só para campos que regex não pegou

import { openai } from '../lib/openai.js'
import { safeLog } from '../lib/logger.js'

export interface DocumentFields {
  tipo: string | null
  numero: string | null
  colaborador: string | null
  data_emissao: string | null       // YYYY-MM-DD
  data_vencimento: string | null    // YYYY-MM-DD
  emissor: string | null
}

// Padrões de regex obrigatórios (dms/SKILL.md)
const PATTERNS = {
  dates: [
    /v[aá]lido\s+at[eé][:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /validade[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
    /expira[çc][aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/gi,
  ],
  docTypes: {
    'ASO':    /\bASO\b|atestado\s+de\s+sa[uú]de\s+ocupacional/i,
    'NR-35':  /\bNR.?35\b|trabalho\s+em\s+altura/i,
    'NR-10':  /\bNR.?10\b|seguran[çc]a\s+em\s+eletricidade/i,
    'NR-33':  /\bNR.?33\b|espa[çc]o\s+confinado/i,
    'NR-12':  /\bNR.?12\b/i,
    'PPRA':   /\bPPRA\b|programa\s+de\s+preven[çc][aã]o\s+de\s+riscos/i,
    'PCMSO':  /\bPCMSO\b/i,
    'CNH':    /\bCNH\b|carteira\s+nacional\s+de\s+habilita[çc][aã]o/i,
    'CREA':   /\bCREA\b/i,
    'CAT':    /\bCAT\b|comunica[çc][aã]o\s+de\s+acidente/i,
  } as Record<string, RegExp>,
}

function parseDate(str: string): string | null {
  const [d, m, y] = str.split('/')
  if (!d || !m || !y) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function extractWithRegex(text: string): DocumentFields {
  // Tipo do documento
  let tipo: string | null = null
  for (const [name, pattern] of Object.entries(PATTERNS.docTypes)) {
    if (pattern.test(text)) { tipo = name; break }
  }

  // Data de vencimento — pega a última data encontrada como vencimento
  let data_vencimento: string | null = null
  for (const pattern of PATTERNS.dates) {
    const match = [...text.matchAll(pattern)].pop()
    if (match?.[1]) { data_vencimento = parseDate(match[1]); break }
  }

  // Data de emissão — procura padrões como "emitido em", "data:"
  let data_emissao: string | null = null
  const emissaoMatch = text.match(/(?:emitido\s+em|data\s+de\s+emiss[aã]o)[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (emissaoMatch?.[1]) data_emissao = parseDate(emissaoMatch[1])

  // Colaborador — procura padrões como "nome:", "colaborador:", "funcionário:"
  let colaborador: string | null = null
  const colaboradorMatch = text.match(
    /(?:nome|colaborador|funcion[aá]rio|empregado|trabalhador)[:\s]+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){1,4})/i
  )
  if (colaboradorMatch?.[1]) colaborador = colaboradorMatch[1].trim()

  return { tipo, numero: null, colaborador, data_emissao, data_vencimento, emissor: null }
}

async function extractMissingWithAI(
  text: string,
  missingFields: string[]
): Promise<Partial<DocumentFields>> {
  const prompt = `Analise o texto de um documento de segurança do trabalho e extraia APENAS os seguintes campos:
${missingFields.map((f) => `- ${f}`).join('\n')}

Responda em JSON com exatamente essas chaves. Use null para campos não encontrados.
Datas devem estar no formato YYYY-MM-DD.

Texto do documento:
${text.slice(0, 3000)}

JSON:`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_tokens: 200,
    temperature: 0,
  })

  try {
    return JSON.parse(response.choices[0]?.message?.content ?? '{}')
  } catch {
    return {}
  }
}

export async function extractFields(text: string): Promise<DocumentFields> {
  // 1. Regex primeiro — zero custo
  const fromRegex = extractWithRegex(text)

  // 2. Só chama IA para campos que regex não pegou
  const missingFields = Object.entries(fromRegex)
    .filter(([, v]) => v === null)
    .map(([k]) => k)

  if (missingFields.length === 0) {
    safeLog('info', 'Extração 100% via regex — zero IA', { fields: Object.keys(fromRegex) })
    return fromRegex
  }

  safeLog('info', 'Campos faltantes — chamando gpt-4o-mini', { missing: missingFields })
  const fromAI = await extractMissingWithAI(text, missingFields)

  return { ...fromRegex, ...fromAI }
}
