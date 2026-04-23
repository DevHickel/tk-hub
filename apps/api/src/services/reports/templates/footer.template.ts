import type { ReportConfig } from '../hours.calculator.js'
import { DEFAULT_BENCHMARKS } from '../hours.calculator.js'

type ReportType = 'management' | 'hr' | 'it'

const FOOTER_STYLE = 'border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;color:#6b7280;font-size:12px;line-height:1.8'

export function getFooterExplanations(config: ReportConfig, lang: 'pt' | 'en' = 'pt', type: ReportType = 'management'): string {
  const frontendUrl = process.env.FRONTEND_URL ?? 'https://tkhub.vetorix.com.br'
  const settingsLink = lang === 'en'
    ? `<a href="${frontendUrl}/report-settings">Settings → Reports</a>`
    : `<a href="${frontendUrl}/report-settings">Configurações → Relatórios</a>`

  if (type === 'management') return getManagementFooter(config, lang, settingsLink)
  if (type === 'hr') return getHRFooter(lang, settingsLink)
  return getITFooter(lang, settingsLink)
}

function getManagementFooter(config: ReportConfig, lang: 'pt' | 'en', settingsLink: string): string {
  const b = {
    search: config.benchmark_search_min ?? DEFAULT_BENCHMARKS.search_min,
    doc: config.benchmark_doc_process_min ?? DEFAULT_BENCHMARKS.doc_process_min,
    email: config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
    cost: config.hour_cost_brl ?? DEFAULT_BENCHMARKS.hour_cost_brl,
  }

  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>How the numbers are calculated:</strong></p>
      <p>
        Each assistant query saves ~${b.search} min, each auto-processed document saves ~${b.doc} min, each email triage saves ~${b.email} min.
        The total is multiplied by R$${b.cost}/hour to estimate the value. Adjust these values at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Como os números são calculados:</strong></p>
      <p>
        Cada pergunta ao assistente economiza cerca de ${b.search} min; cada documento processado automaticamente economiza ${b.doc} min; cada e-mail triado economiza ${b.email} min.
        O total é multiplicado por R$ ${b.cost}/hora para estimar o valor. Os valores podem ser ajustados em ${settingsLink}.
      </p>
    </div>`
}

function getHRFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p>Automatic alerts are sent 30, 15, 7, 3 and 1 day before expiry and on the expiry day. Recipients can be configured at ${settingsLink}.</p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p>Os alertas são enviados automaticamente 30, 15, 7, 3 e 1 dia antes do vencimento e no próprio dia. Destinatários podem ser configurados em ${settingsLink}.</p>
    </div>`
}

function getITFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p>
        <strong>Cache responses:</strong> when a similar question was already asked, the system reuses the answer without charging OpenAI again (target ≥ 60%).
        <strong>Success rate:</strong> documents indexed correctly vs. errors (target ≥ 95%).
        Recipients and settings at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p>
        <strong>Respostas pelo cache:</strong> quando uma pergunta parecida já foi feita antes, o sistema reaproveita a resposta sem custo adicional (meta: 60% ou mais).
        <strong>Documentos processados com sucesso:</strong> arquivos indexados corretamente comparado aos que deram erro (meta: 95% ou mais).
        Destinatários e configurações em ${settingsLink}.
      </p>
    </div>`
}
