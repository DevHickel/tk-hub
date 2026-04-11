import { Worker } from 'bullmq'
import * as Sentry from '@sentry/node'
import { redis } from '../lib/redis.js'
import { QUEUES } from '../queues/index.js'
import type { CertificateJobData } from '../queues/certificate.queue.js'
import { supabase } from '../lib/supabase.js'
import { openai } from '../lib/openai.js'
import { parseWithLlamaParse } from '../services/llamaparse.service.js'
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

async function extractFromImage(fileUrl: string): Promise<ExtractedCertData> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0, // deterministic — same image must always return same result
    messages: [
      {
        role: 'system',
        content: EXTRACTION_PROMPT,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extraia os dados deste certificado:' },
          { type: 'image_url', image_url: { url: fileUrl, detail: 'high' } },
        ],
      },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  return parseExtractedJson(raw)
}

async function extractFromPdf(fileBuffer: Buffer, fileName: string): Promise<ExtractedCertData> {
  // LlamaParse now returns LlamaPage[] — join all pages into full text
  const pages = await parseWithLlamaParse(fileBuffer, fileName)
  const fullText = pages.map(p => p.text).join('\n\n').slice(0, 8000)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `Extraia os dados deste certificado:\n\n${fullText}` },
    ],
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  return parseExtractedJson(raw)
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
  } catch {
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

        await job.updateProgress(20)

        const isPdf = fileName.toLowerCase().endsWith('.pdf')
        let extracted: ExtractedCertData

        if (isPdf) {
          // Download file buffer for LlamaParse
          const res = await fetch(fileUrl)
          if (!res.ok) throw new Error(`Failed to download certificate: ${res.status}`)
          const buffer = Buffer.from(await res.arrayBuffer())
          extracted = await extractFromPdf(buffer, fileName)
        } else {
          // Images: GPT-4o Vision with public URL
          extracted = await extractFromImage(fileUrl)
        }

        await job.updateProgress(80)

        safeLog('info', 'Certificate data extracted', { certificateId, extracted })

        // Update record with extracted data
        await supabase
          .from('processed_certificates')
          .update({
            employee_name: extracted.employee_name,
            course_name: extracted.course_name,
            completion_date: extracted.completion_date,
            expiry_date: extracted.expiry_date,
            hours: extracted.hours,
            status: 'pending', // back to pending for admin review
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
