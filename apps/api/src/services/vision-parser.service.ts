// Pipeline próprio de extração: renderiza cada página do PDF em PNG via mupdf
// (WASM puro, sem native build) e transcreve com gpt-4.1-mini visão.
// Substitui o LlamaParse — mais barato, mais preciso em tabelas com subtítulos,
// e usa apenas a chave OpenAI já configurada.
//
// Uma segunda chamada visão detecta bounding boxes de tabelas, que são recortadas
// via sharp e subidas no Storage para exibição como "fonte visual" no chat.

import * as mupdf from 'mupdf'
import sharp from 'sharp'
import { openai } from '../lib/openai.js'
import { supabase } from '../lib/supabase.js'
import { safeLog } from '../lib/logger.js'

export interface VisionTable {
  label: string
  image_path: string
}

export interface VisionPage {
  text: string
  page: number
  total: number
  image_path?: string // full page PNG in `document-pages` bucket
  tables?: VisionTable[] // cropped table PNGs in `document-pages` bucket (if any detected)
}

export interface ParseWithVisionOptions {
  // When provided, each rendered page is uploaded to `document-pages/{documentId}/page-{N}.png`
  // and any detected tables are cropped and uploaded as well. The frontend uses these
  // crops as "visual sources" next to RAG answers.
  documentId?: string
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

const TRANSCRIBE_PROMPT = `Você é um extrator de documentos técnicos. Vou te mostrar UMA página de um PDF em imagem. Transcreva TODO o conteúdo visível em markdown, preservando fielmente a estrutura.

REGRAS:
1. Tabelas: use sintaxe \`| col | col |\` com linha separadora. Preserve a estrutura visual.
2. Se uma célula de tabela contém MÚLTIPLOS subtítulos (ex: uma célula do Esquadro contendo "Esquadro Combinado", "Esquadro 90° Para Esquadros de Precisão", "Para Esquadro Simples") — EMITA cada subtítulo como heading \`### NOME DO SUBTÍTULO\` FORA da tabela, com as fórmulas/valores/notas daquele subtítulo em bullets abaixo. A linha-mãe vira \`## NOME\`. NUNCA misture dados de subtítulos diferentes.
3. Fórmulas: preserve literalmente como aparecem (ε = 10 + L/60, 0° 30', não use LaTeX cru).
4. Cabeçalhos de seção do documento: use \`#\` ou \`##\` conforme hierarquia visual.
5. Listas, notas de rodapé, referências cruzadas (ex: "ver PR-TKS-QUA-003", "Validade: 1 ano"): preserve sempre.
6. Não invente, não resuma, não adicione comentários ou explicações.
7. Se a página estiver em branco ou conter apenas rodapé/cabeçalho genérico, retorne apenas esse conteúdo.

Responda APENAS com o markdown transcrito. Sem preâmbulo, sem \`\`\`markdown, sem fechamento.`

const TABLE_DETECTOR_PROMPT = `Você é um detector de tabelas em páginas de PDF. Vou te mostrar uma página em imagem. Sua tarefa é localizar CADA tabela visível e retornar um JSON com suas coordenadas normalizadas (0 a 1) e o título/legenda.

REGRAS:
1. Considere "tabela" qualquer bloco com colunas e linhas separadas por bordas ou alinhamento consistente — incluindo tabelas com legendas tipo "Tabela 14 — Multímetro Digital". Também considere blocos de texto estruturado com título "Tabela N" mesmo sem bordas visíveis (ex: listas de fatores, modos de calibração).
2. Para cada tabela, extraia:
   - **label**: o título da tabela EXATAMENTE como aparece no documento (ex: "Tabela 14 — Multímetro Digital"). Se não houver título, invente um curto e descritivo (ex: "Especificações do Torquímetro").
   - **bbox**: [x, y, w, h] em coordenadas normalizadas (0-1) onde (0,0) é o canto superior-esquerdo da página.
     **CRÍTICO**: O bbox DEVE começar no TÍTULO da tabela (ex: "Tabela 13 — Multímetro Digital"), NÃO no corpo. O topo do bbox (y) é a borda superior do texto do título. O fundo do bbox (y+h) é a última linha de conteúdo da tabela ou nota de rodapé vinculada. Deixe margem de ~5% acima do título e abaixo da última linha.
3. NÃO inclua parágrafos de texto corrido, cabeçalhos de seção, diagramas, figuras ou assinaturas.
4. Se a página não tiver nenhuma tabela, retorne \`{"tables": []}\`.
5. Se houver tabelas sobrepostas ou a mesma tabela quebrada em duas partes visíveis, trate cada bloco visual como uma tabela separada.

Responda APENAS com JSON válido no formato exato:
\`{"tables": [{"label": "string", "bbox": [x, y, w, h]}]}\``

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
      { role: 'system', content: TRANSCRIBE_PROMPT },
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

interface DetectedTable {
  label: string
  bbox: [number, number, number, number] // normalized [x, y, w, h]
}

async function detectTables(
  imageBytes: Uint8Array,
  pageNumber: number
): Promise<DetectedTable[]> {
  const base64 = Buffer.from(imageBytes).toString('base64')
  const dataUrl = `data:image/png;base64,${base64}`

  const response = await openai.chat.completions.create({
    model: VISION_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: TABLE_DETECTOR_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `Página ${pageNumber}. Localize as tabelas e retorne o JSON.` },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 800,
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  try {
    const parsed = JSON.parse(raw) as { tables?: unknown }
    if (!Array.isArray(parsed.tables)) return []
    const tables: DetectedTable[] = []
    for (const t of parsed.tables) {
      if (!t || typeof t !== 'object') continue
      const tt = t as { label?: unknown; bbox?: unknown }
      const label = typeof tt.label === 'string' && tt.label.trim().length > 0 ? tt.label.trim() : 'Tabela'
      if (!Array.isArray(tt.bbox) || tt.bbox.length !== 4) continue
      const bbox = tt.bbox.map((n) => Number(n))
      if (bbox.some((n) => !Number.isFinite(n))) continue
      if (bbox[2] <= 0 || bbox[3] <= 0) continue
      tables.push({ label, bbox: bbox as [number, number, number, number] })
    }
    safeLog('info', 'table detector OK', { page: pageNumber, tables: tables.length })
    return tables
  } catch (err) {
    safeLog('warn', 'table detector JSON parse failed', {
      page: pageNumber,
      raw: raw.slice(0, 200),
      error: (err as Error).message,
    })
    return []
  }
}

async function uploadPageImage(documentId: string, pageNumber: number, png: Uint8Array): Promise<string | undefined> {
  const path = `${documentId}/page-${pageNumber}.png`
  const { error } = await supabase.storage
    .from('document-pages')
    .upload(path, Buffer.from(png), { contentType: 'image/png', upsert: true })
  if (error) {
    safeLog('warn', 'page image upload failed', { documentId, pageNumber, error: error.message })
    return undefined
  }
  return path
}

async function cropAndUploadTables(
  documentId: string,
  pageNumber: number,
  png: Uint8Array,
  tables: DetectedTable[]
): Promise<VisionTable[]> {
  if (tables.length === 0) return []
  const image = sharp(Buffer.from(png))
  const meta = await image.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (width === 0 || height === 0) return []

  const results: VisionTable[] = []
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i]
    const [nx, ny, nw, nh] = t.bbox
    // Extra top padding (8%) because LLM bboxes often miss the title line.
    const PAD_X = 0.04
    const PAD_TOP = 0.08
    const PAD_BOTTOM = 0.05
    const x = Math.max(0, nx - PAD_X)
    const y = Math.max(0, ny - PAD_TOP)
    const w = Math.min(1 - x, nw + PAD_X * 2)
    const h = Math.min(1 - y, nh + PAD_TOP + PAD_BOTTOM)
    if (w < 0.05 || h < 0.02) continue

    const left = Math.round(x * width)
    const top = Math.round(y * height)
    const cropW = Math.max(1, Math.round(w * width))
    const cropH = Math.max(1, Math.round(h * height))

    try {
      // Fresh pipeline per crop — sharp instances are single-use after extract.
      const cropped = await sharp(Buffer.from(png))
        .extract({ left, top, width: cropW, height: cropH })
        .png()
        .toBuffer()

      const path = `${documentId}/page-${pageNumber}-table-${i + 1}.png`
      const { error } = await supabase.storage
        .from('document-pages')
        .upload(path, cropped, { contentType: 'image/png', upsert: true })

      if (error) {
        safeLog('warn', 'table crop upload failed', { documentId, pageNumber, index: i, error: error.message })
        continue
      }
      results.push({ label: t.label, image_path: path })
    } catch (err) {
      safeLog('warn', 'table crop failed', { documentId, pageNumber, index: i, error: (err as Error).message })
    }
  }
  return results
}

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

export async function parseWithVision(
  fileBuffer: Buffer,
  fileName: string,
  options: ParseWithVisionOptions = {}
): Promise<VisionPage[]> {
  const startedAt = Date.now()
  const { documentId } = options

  // Certificados escaneados como PNG/JPG — pula mupdf e detecção de tabelas.
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

  for (let i = 0; i < total; i += PAGE_CONCURRENCY) {
    const batch = pngs.slice(i, i + PAGE_CONCURRENCY)
    const transcriptions = await Promise.all(
      batch.map(async (png, j) => {
        const pageNum = i + j + 1
        // Transcrição, upload da página e detecção de tabelas rodam em paralelo.
        const [textResult, imagePath, detected] = await Promise.all([
          transcribePage(png, pageNum).catch((error: Error) => {
            safeLog('warn', 'vision parse falhou — página ignorada', {
              page: pageNum,
              error: error.message,
            })
            return ''
          }),
          documentId ? uploadPageImage(documentId, pageNum, png) : Promise.resolve(undefined),
          documentId
            ? detectTables(png, pageNum).catch((error: Error) => {
                safeLog('warn', 'table detector falhou', { page: pageNum, error: error.message })
                return [] as DetectedTable[]
              })
            : Promise.resolve([] as DetectedTable[]),
        ])

        // Crop + upload das tabelas depende de ter o PNG e a detecção prontas.
        const tables = documentId && detected.length > 0
          ? await cropAndUploadTables(documentId, pageNum, png, detected)
          : []

        return { text: textResult, page: pageNum, total, image_path: imagePath, tables }
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
