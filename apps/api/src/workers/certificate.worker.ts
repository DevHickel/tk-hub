import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import type { CertificateJobData } from '../queues/certificate.queue.js'
import { supabase } from '../lib/supabase.js'
import { openai } from '../lib/openai.js'
import { parseWithVision } from '../services/vision-parser.service.js'
import { safeLog } from '../lib/logger.js'

interface ExtractedCertData {
  employee_name: string | null
  course_name: string | null
  completion_date: string | null // ISO date YYYY-MM-DD
  expiry_date: string | null     // ISO date YYYY-MM-DD
  hours: number | null
}

const EXTRACTION_PROMPT = `Você é um extrator de dados de certificados de treinamento. Sua tarefa é ler o certificado e retornar um JSON estruturado com as informações encontradas.

Retorne APENAS este JSON (sem texto, sem markdown, sem explicações):
{
  "employee_name": "Nome completo do participante/colaborador que recebeu o certificado",
  "course_name": "Nome exato do curso, treinamento ou habilitação",
  "completion_date": "YYYY-MM-DD",
  "expiry_date": "YYYY-MM-DD ou null",
  "hours": 40
}

Instruções obrigatórias:
- employee_name: nome do PARTICIPANTE, não da instituição emissora
- course_name: nome do curso como está escrito, sem abreviações inventadas
- completion_date: data de CONCLUSÃO ou EMISSÃO do certificado (use a data principal do documento)
- expiry_date: data de VENCIMENTO/VALIDADE — se o certificado tiver "válido por N anos", some N anos à completion_date. Se não houver vencimento, use null
- hours: carga horária como número inteiro. Se não houver, use null
- Datas SEMPRE em formato YYYY-MM-DD
- Se um campo não existir no certificado, use null
- Retorne SOMENTE o JSON, sem qualquer outro texto`

// Extrai dados do markdown transcrito pelo vision-parser usando GPT-4o text-only.
// Pipeline: vision-parser (mupdf+gpt-4.1-mini vision) → markdown → GPT-4o extrai JSON.
async function extractFromParsedText(fullText: string): Promise<ExtractedCertData> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Extraia os dados deste certificado a partir do texto abaixo (já extraído via OCR):\n\n${fullText}` },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  return parseExtractedJson(raw)
}

// Returns true when the extraction yielded no usable data at all.
// We treat this as a failure so the frontend can surface it as an error
// instead of leaving the certificate stuck in 'pending' with empty fields.
function isExtractionEmpty(data: ExtractedCertData): boolean {
  return (
    data.employee_name === null &&
    data.course_name === null &&
    data.completion_date === null &&
    data.expiry_date === null &&
    data.hours === null
  )
}

function parseExtractedJson(raw: string): ExtractedCertData {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    return {
      employee_name: parsed.employee_name ?? null,
      course_name: parsed.course_name ?? null,
      completion_date: isValidDate(parsed.completion_date) ? parsed.completion_date : null,
      expiry_date: isValidDate(parsed.expiry_date) ? parsed.expiry_date : null,
      hours: typeof parsed.hours === 'number' ? Math.round(parsed.hours) : null,
    }
  } catch (err) {
    safeLog('warn', 'Failed to parse extraction JSON — returning empty', {
      error: (err as Error).message,
      raw: raw.slice(0, 500),
    })
    return { employee_name: null, course_name: null, completion_date: null, expiry_date: null, hours: null }
  }
}

function isValidDate(val: unknown): val is string {
  return typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)
}

export function setupCertificateWorker() {
  const worker = new Worker<CertificateJobData>(
    QUEUES.CERTIFICATE_EXTRACTION,
    async (job) => {
      const { certificateId, fileUrl, fileName } = job.data

      try {
        // Mark as processing
        await supabase
          .from('processed_certificates')
          .update({ status: 'processing' })
          .eq('id', certificateId)

        await job.updateProgress(10)

        // 1. Download the file (works for both PDFs and images)
        const fileRes = await fetch(fileUrl)
        if (!fileRes.ok) throw new Error(`Failed to download certificate: ${fileRes.status}`)
        const buffer = Buffer.from(await fileRes.arrayBuffer())
        await job.updateProgress(20)

        // 2. Parse via vision pipeline (mupdf → gpt-4.1-mini vision).
        //    Handles both PDFs and image files (PNG/JPG/WEBP/GIF).
        const pages = await parseWithVision(buffer, fileName)

        if (pages.length === 0) {
          throw new Error('Vision parser não retornou nenhuma página com conteúdo')
        }

        const fullText = pages.map(p => p.text).join('\n\n').slice(0, 8000)
        safeLog('info', 'vision parser texto extraído', { certificateId, pages: pages.length, length: fullText.length })
        await job.updateProgress(60)

        // 3. Feed the parsed text to GPT-4o (text-only) to get structured JSON
        const extracted = await extractFromParsedText(fullText)

        await job.updateProgress(80)

        safeLog('info', 'Certificate data extracted', { certificateId, extracted })

        // If the model returned an empty object, mark the cert as error so the
        // frontend can surface it instead of keeping the user waiting forever.
        if (isExtractionEmpty(extracted)) {
          safeLog('warn', 'Extraction returned empty data — marking as error', { certificateId })
          await supabase
            .from('processed_certificates')
            .update({
              status: 'error',
              rejection_reason: 'Não foi possível extrair dados do certificado automaticamente. Tente novamente ou verifique o arquivo.',
            })
            .eq('id', certificateId)
          await job.updateProgress(100)
          return
        }

        // --- DEDUPLICATION / RENEWAL LOGIC ---
        // If both key fields were extracted, check for existing cert with same employee+course.
        // If found, update the existing record and delete the temporary one.
        if (extracted.employee_name && extracted.course_name) {
          const { data: existingCerts } = await supabase
            .from('processed_certificates')
            .select('id, file_url')
            .neq('id', certificateId)
            .ilike('employee_name', extracted.employee_name.trim())
            .ilike('course_name', extracted.course_name.trim())
            .order('created_at', { ascending: false })
            .limit(1)

          if (existingCerts && existingCerts.length > 0) {
            const existingId = existingCerts[0].id
            const oldFileUrl = existingCerts[0].file_url

            // Update the EXISTING record with new data
            await supabase
              .from('processed_certificates')
              .update({
                employee_name: extracted.employee_name,
                course_name: extracted.course_name,
                completion_date: extracted.completion_date,
                expiry_date: extracted.expiry_date,
                hours: extracted.hours,
                file_name: fileName,
                file_url: fileUrl,
                status: 'pending',
                renewed_from: certificateId,
                renewed_at: new Date().toISOString(),
              })
              .eq('id', existingId)

            // Delete the temporary row created during upload
            await supabase
              .from('processed_certificates')
              .delete()
              .eq('id', certificateId)

            // Clean up old file from storage
            if (oldFileUrl) {
              try {
                const match = oldFileUrl.match(/\/certificates\/(.+)$/)
                if (match) {
                  await supabase.storage.from('certificates').remove([match[1]])
                }
              } catch (err) {
                safeLog('warn', 'Failed to delete old certificate file', { oldFileUrl, error: (err as Error).message })
              }
            }

            safeLog('info', 'Certificate renewed (merged into existing)', { certificateId, existingId })
            await job.updateProgress(100)
            return
          }
        }

        // --- NORMAL PATH (no match found) ---
        await supabase
          .from('processed_certificates')
          .update({
            employee_name: extracted.employee_name,
            course_name: extracted.course_name,
            completion_date: extracted.completion_date,
            expiry_date: extracted.expiry_date,
            hours: extracted.hours,
            status: 'pending', // back to pending for admin review (trigger will convert to 'expired' if expiry_date < today)
          })
          .eq('id', certificateId)

        await job.updateProgress(100)
        safeLog('info', 'Certificate extracted successfully', { certificateId })
      } catch (error) {
        Sentry.captureException(error, { tags: { job: 'certificate-extraction', certificateId } })
        await supabase
          .from('processed_certificates')
          .update({ status: 'error' })
          .eq('id', certificateId)
        throw error
      }
    },
    {
      connection: redis,
      concurrency: 3,
    }
  )

  worker.on('failed', (job, error) => {
    safeLog('error', `Certificate job ${job?.id} falhou`, {
      error: (error as Error).message,
      certificateId: job?.data.certificateId,
    })
  })

  worker.on('completed', (job) => {
    safeLog('info', `Certificate job ${job.id} concluído`, { certificateId: job.data.certificateId })
  })

  return worker
}
