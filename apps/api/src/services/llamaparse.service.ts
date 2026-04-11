// LlamaParse — único parser de PDF do sistema (rag-pipeline/SKILL.md)
// Garante precisão máxima em formulários, tabelas, colunas múltiplas e scans OCR
// Não usar pdf-parse ou qualquer alternativa

import { safeLog } from '../lib/logger.js'

const LLAMAPARSE_API = 'https://api.cloud.llamaindex.ai/api/parsing'

export async function parseWithLlamaParse(fileBuffer: Buffer, fileName: string): Promise<string> {
  const apiKey = process.env.LLAMAPARSE_API_KEY!

  // 1. Upload do arquivo
  const formData = new FormData()
  // Buffer.from() garante ArrayBuffer sem SharedArrayBuffer (compat. com Blob)
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

  // 2. Polling até completar (a cada 2 segundos)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))

    const statusRes = await fetch(`${LLAMAPARSE_API}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!statusRes.ok) continue

    const status = await statusRes.json() as { status: string }

    if (status.status === 'SUCCESS') {
      // 3. Buscar resultado em markdown
      const resultRes = await fetch(`${LLAMAPARSE_API}/job/${jobId}/result/markdown`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })

      if (!resultRes.ok) throw new Error('LlamaParse: falha ao buscar resultado')

      const result = await resultRes.json() as { markdown: string }
      safeLog('info', 'LlamaParse parsing completo', { jobId, chars: result.markdown.length })
      return result.markdown
    }

    if (status.status === 'ERROR') {
      throw new Error(`LlamaParse job ${jobId} falhou`)
    }
  }

  throw new Error(`LlamaParse timeout para job ${jobId}`)
}
