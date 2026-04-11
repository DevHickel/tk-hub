// LlamaParse — único parser de PDF do sistema (rag-pipeline/SKILL.md)
// Garante precisão máxima em formulários, tabelas, colunas múltiplas e scans OCR
// Não usar pdf-parse ou qualquer alternativa

import { safeLog } from '../lib/logger.js'

const LLAMAPARSE_API = 'https://api.cloud.llamaindex.ai/api/parsing'

export interface LlamaPage {
  text: string      // markdown || plain text of the page
  page: number      // 1-based page number
  total: number     // total pages in document
}

export async function parseWithLlamaParse(fileBuffer: Buffer, fileName: string): Promise<LlamaPage[]> {
  const apiKey = process.env.LLAMAPARSE_API_KEY!

  // 1. Upload do arquivo
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/pdf' })
  formData.append('file', blob, fileName)

  const uploadRes = await fetch(`${LLAMAPARSE_API}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`LlamaParse upload failed: ${err}`)
  }

  const { id: jobId } = await uploadRes.json() as { id: string }
  safeLog('info', 'LlamaParse upload OK', { jobId })

  // 2. Polling até completar (a cada 2 segundos, máximo 120s)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))

    const statusRes = await fetch(`${LLAMAPARSE_API}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!statusRes.ok) continue

    const status = await statusRes.json() as { status: string }

    if (status.status === 'SUCCESS') {
      // 3. Buscar resultado JSON — retorna pages com page_number e markdown por página
      const resultRes = await fetch(`${LLAMAPARSE_API}/job/${jobId}/result/json`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!resultRes.ok) throw new Error('LlamaParse: falha ao buscar resultado JSON')

      const result = await resultRes.json() as { pages: Array<{ page: number; text?: string; markdown?: string }> }
      const pages = result.pages ?? []
      const total = pages.length

      safeLog('info', 'LlamaParse parsing completo', { jobId, pages: total })

      return pages.map((p) => ({
        text: (p.markdown ?? p.text ?? '').trim(),
        page: p.page,
        total,
      })).filter(p => p.text.length > 0)
    }

    if (status.status === 'ERROR') {
      throw new Error(`LlamaParse job ${jobId} falhou`)
    }
  }

  throw new Error(`LlamaParse timeout para job ${jobId}`)
}
