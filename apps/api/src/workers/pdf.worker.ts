import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import { PdfJobData } from '../queues/pdf.queue.js'
import { supabase } from '../lib/supabase.js'
import { parseWithLlamaParse } from '../services/llamaparse.service.js'
import { normalizeMarkdown } from '../services/markdown-normalizer.service.js'
import { getOrCreateEmbedding, chunkMarkdown } from '../services/embedding.service.js'
import { safeLog } from '../lib/logger.js'

// Parsing instruction para o LlamaParse — documentos RAG precisam preservar
// estrutura markdown (tabelas, cabeçalhos) para o chunker recursivo funcionar.
const LLAMAPARSE_INSTRUCTION = `Este documento será usado como base de conhecimento para IA técnica.
Extraia TODO o texto visível preservando a estrutura original.

REGRA CRÍTICA — TABELAS COM SUBTÍTULOS:
Quando uma célula de tabela contiver múltiplos subtítulos (ex: "Esquadro Combinado",
"Esquadro 90° Para Esquadros de Precisão", "Para Esquadro Simples"), NÃO coloque tudo
numa única célula. EMITA cada subtítulo como heading markdown ### FORA da tabela, com
as fórmulas/valores daquele subtítulo em bullets ou parágrafo abaixo. A linha-mãe da
tabela (ex: "Esquadro") vira ## e cada sub-equipamento um ### abaixo dela.

Exemplo:
## Esquadro

### Esquadro Combinado
- Ortogonalidade: ε = 10 + L/60 (µm), onde L = comprimento da régua em mm
- Deslocamento angular do goniômetro: 0° 30'

### Esquadro 90° Para Esquadros de Precisão
- Ortogonalidade/Retilineidade: t = 20 + Li/10 (µm)
- Planicidade ou Retilineidade: r = 4 + Li/50 (µm), onde Li = comprimento em mm

### Para Esquadro Simples
- Não se mede Planicidade ou Retilineidade
- Tolerância da Ortogonalidade: 15' (quinze minutos)

Use cabeçalhos markdown (##, ###) para seções e sub-equipamentos.
Converta tabelas simples (sem subtítulos) em formato Markdown (| coluna | coluna |).
Nunca achate tabelas em texto corrido. Preserve listas, parágrafos e rodapés.
Não invente informações.`

// Extrai a última seção markdown do chunk (heading mais próximo do fim,
// que rege o conteúdo subsequente). Usado pelo RAG para isolar fórmulas por
// sub-equipamento e evitar que o LLM misture subtítulos.
function extractSection(chunk: string): string | null {
  const lines = chunk.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^#{1,6}\s+(.+?)\s*$/)
    if (m) return m[1].trim()
  }
  const m = chunk.match(/^#{1,6}\s+(.+?)\s*$/m)
  return m?.[1]?.trim() ?? null
}

async function setDocumentStatus(documentId: string, status: string) {
  await supabase
    .from('documents')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', documentId)
}

export function setupPdfWorker() {
  const worker = new Worker<PdfJobData>(
    QUEUES.PDF_PROCESSING,
    async (job) => {
      const { documentId, filePath, fileName } = job.data

      try {
        // 1. Status → processing
        await setDocumentStatus(documentId, 'processing')
        await job.updateProgress(10)

        // 2. Baixar arquivo do Storage
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(filePath)

        if (downloadError) throw downloadError

        const buffer = Buffer.from(await fileData.arrayBuffer())
        await job.updateProgress(20)

        // 3. Extrair texto com LlamaParse (premium + instruction — igual ao workflow n8n)
        const pages = await parseWithLlamaParse(buffer, fileName, {
          premiumMode: true,
          parsingInstruction: LLAMAPARSE_INSTRUCTION,
        })
        await job.updateProgress(40)

        safeLog('info', 'LlamaParse retornou páginas', { documentId, pages: pages.length })

        if (pages.length === 0) {
          throw new Error('LlamaParse não retornou nenhuma página com conteúdo')
        }

        // 4. Para cada página: chunk → embedding → insert em documents
        // O registro principal (documentId) já existe com status=processing
        // O primeiro chunk atualiza o registro principal; os demais criam linhas novas
        let isFirstChunk = true
        let totalChunks = 0

        for (let pi = 0; pi < pages.length; pi++) {
          const pageData = pages[pi]
          // Normalização LLM: reestrutura células de tabela com múltiplos
          // subtítulos em headings markdown, para o chunker conseguir isolá-los.
          const normalizedText = await normalizeMarkdown(pageData.text, pageData.page)
          const chunks = chunkMarkdown(normalizedText, 5000, 500)

          for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci]
            if (!chunk.trim()) continue

            const embedding = await getOrCreateEmbedding(chunk)
            const metadata = {
              source: fileName,
              page_number: pageData.page,
              total_pages: pageData.total,
              chunk_index: ci,
              section: extractSection(chunk),
            }

            if (isFirstChunk) {
              // Atualiza o registro principal com conteúdo + embedding + metadata
              await supabase
                .from('documents')
                .update({
                  content: chunk,
                  embedding: JSON.stringify(embedding),
                  metadata,
                  status: 'active',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', documentId)
              isFirstChunk = false
            } else {
              // Insere novos chunks como linhas independentes na tabela documents
              // com o mesmo file_name para list_rag_documents() agrupá-los corretamente
              await supabase.from('documents').insert({
                content: chunk,
                embedding: JSON.stringify(embedding),
                metadata,
                file_name: fileName,
                file_path: filePath,
                source: 'upload',
                status: 'active',
              })
            }

            totalChunks++
          }

          // Progresso de 40% a 90% proporcionalmente às páginas
          await job.updateProgress(40 + Math.floor(((pi + 1) / pages.length) * 50))
        }

        await job.updateProgress(100)
        safeLog('info', 'Documento processado com sucesso', { documentId, totalChunks })
      } catch (error) {
        Sentry.captureException(error, {
          tags: { job: 'pdf-processing', documentId },
        })
        await setDocumentStatus(documentId, 'error')
        throw error // BullMQ faz retry automático (3 tentativas)
      }
    },
    {
      connection: redis,
      concurrency: 3, // reduzido para não sobrecarregar LlamaParse
    }
  )

  worker.on('failed', (job, error) => {
    safeLog('error', `Job ${job?.id} falhou após todas as tentativas`, {
      error: (error as Error).message,
      documentId: job?.data.documentId,
    })
  })

  worker.on('completed', (job) => {
    safeLog('info', `Job ${job.id} concluído`, { documentId: job.data.documentId })
  })

  return worker
}
