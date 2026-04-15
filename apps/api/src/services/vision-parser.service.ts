// Pipeline próprio de extração: renderiza cada página do PDF em PNG via mupdf
// (WASM puro, sem native build) e transcreve com gpt-4.1-mini visão.
// Substitui o LlamaParse — mais barato, mais preciso em tabelas com subtítulos,
// e usa apenas a chave OpenAI já configurada.

import * as mupdf from 'mupdf'
import { openai } from '../lib/openai.js'
import { safeLog } from '../lib/logger.js'

export interface VisionPage {
  text: string
  page: number
  total: number
}

const RENDER_SCALE = 2 // ~144 DPI, suficiente para OCR visual de tabelas
const PAGE_CONCURRENCY = 3
const VISION_MODEL = 'gpt-4.1-mini'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

function mimeFromFileName(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'pdf': return 'application/pdf'
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'application/octet-stream'
  }
}

function isImageFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return IMAGE_EXTS.has(ext)
}

const SYSTEM_PROMPT = `Você é um extrator de documentos técnicos. Vou te mostrar UMA página de um PDF em imagem. Transcreva TODO o conteúdo visível em markdown, preservando fielmente a estrutura.

REGRAS:
1. Tabelas: use sintaxe \`| col | col |\` com linha separadora. Preserve a estrutura visual.
2. Se uma célula de tabela contém MÚLTIPLOS subtítulos (ex: uma célula do Esquadro contendo "Esquadro Combinado", "Esquadro 90° Para Esquadros de Precisão", "Para Esquadro Simples") — EMITA cada subtítulo como heading \`### NOME DO SUBTÍTULO\` FORA da tabela, com as fórmulas/valores/notas daquele subtítulo em bullets abaixo. A linha-mãe vira \`## NOME\`. NUNCA misture dados de subtítulos diferentes.
3. Fórmulas: preserve literalmente como aparecem (ε = 10 + L/60, 0° 30', não use LaTeX cru).
4. Cabeçalhos de seção do documento: use \`#\` ou \`##\` conforme hierarquia visual.
5. Listas, notas de rodapé, referências cruzadas (ex: "ver PR-TKS-QUA-003", "Validade: 1 ano"): preserve sempre.
6. Não invente, não resuma, não adicione comentários ou explicações.
7. Se a página estiver em branco ou conter apenas rodapé/cabeçalho genérico, retorne apenas esse conteúdo.

Responda APENAS com o markdown transcrito. Sem preâmbulo, sem \`\`\`markdown, sem fechamento.`

function renderPagesToPng(fileBuffer: Buffer): Uint8Array[] {
  const doc = mupdf.Document.openDocument(fileBuffer, 'application/pdf')
  const total = doc.countPages()
  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE)
  const pngs: Uint8Array[] = []
  for (let i = 0; i < total; i++) {
    const page = doc.loadPage(i)
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false)
    pngs.push(pixmap.asPNG())
    pixmap.destroy()
    page.destroy()
  }
  doc.destroy()
  return pngs
}

async function transcribePage(
  imageBytes: Uint8Array,
  pageNumber: number,
  mimeType: string = 'image/png'
): Promise<string> {
  const base64 = Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`

  const response = await openai.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Página ${pageNumber}. Transcreva em markdown.` },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 4000,
  })

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  safeLog('info', 'vision parse OK', {
    page: pageNumber,
    chars: text.length,
    tokens: response.usage?.total_tokens,
  })
  return text
}

export async function parseWithVision(fileBuffer: Buffer, fileName: string): Promise<VisionPage[]> {
  const startedAt = Date.now()

  // Se for imagem direta (certificado escaneado como PNG/JPG), pula mupdf.
  if (isImageFile(fileName)) {
    const mime = mimeFromFileName(fileName)
    try {
      const text = await transcribePage(new Uint8Array(fileBuffer), 1, mime)
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
      safeLog('info', 'vision parse completo (imagem)', { fileName, elapsedSec: elapsed })
      return text.length > 0 ? [{ text, page: 1, total: 1 }] : []
    } catch (error) {
      safeLog('warn', 'vision parse falhou em imagem', {
        fileName,
        error: (error as Error).message,
      })
      return []
    }
  }

  const pngs = renderPagesToPng(fileBuffer)
  const total = pngs.length

  safeLog('info', 'PDF renderizado', { fileName, pages: total })

  const results: VisionPage[] = new Array(total)

  // Processa em lotes paralelos de PAGE_CONCURRENCY
  for (let i = 0; i < total; i += PAGE_CONCURRENCY) {
    const batch = pngs.slice(i, i + PAGE_CONCURRENCY)
    const transcriptions = await Promise.all(
      batch.map(async (png, j) => {
        const pageNum = i + j + 1
        try {
          const text = await transcribePage(png, pageNum)
          return { text, page: pageNum, total }
        } catch (error) {
          safeLog('warn', 'vision parse falhou — página ignorada', {
            page: pageNum,
            error: (error as Error).message,
          })
          return { text: '', page: pageNum, total }
        }
      })
    )
    for (let j = 0; j < transcriptions.length; j++) {
      results[i + j] = transcriptions[j]
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  safeLog('info', 'vision parse completo', { fileName, pages: total, elapsedSec: elapsed })

  return results.filter((p) => p.text.length > 0)
}
