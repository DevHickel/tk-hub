// Rodapé explicativo por tipo de relatório
import type { ReportConfig } from '../hours.calculator.js'
import { DEFAULT_BENCHMARKS } from '../hours.calculator.js'

type ReportType = 'management' | 'hr' | 'it'

const FOOTER_STYLE = 'border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;color:#6b7280;font-size:12px;line-height:1.8'

export function getFooterExplanations(config: ReportConfig, lang: 'pt' | 'en' = 'pt', type: ReportType = 'management'): string {
  const frontendUrl = process.env.FRONTEND_URL!
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
    alert: config.benchmark_alert_min ?? DEFAULT_BENCHMARKS.alert_min,
    email: config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
    cost: config.hour_cost_brl ?? DEFAULT_BENCHMARKS.hour_cost_brl,
  }

  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>How we calculate hours saved:</strong></p>
      <p>
        • <strong>Document search:</strong> each assistant query equals ${b.search} minutes of manual searching.<br>
        • <strong>Document processing:</strong> each automatically catalogued document equals ${b.doc} minutes of manual work.<br>
        • <strong>Expiry alert:</strong> each automatically sent alert equals ${b.alert} minutes of manual work.<br>
        • <strong>Email triage:</strong> each email with attachment processed automatically equals ${b.email} minutes of manual triage.
      </p>
      <p>
        • <strong>Estimated value:</strong> hours saved × R$${b.cost}/hour (average cost configured).<br>
        • These benchmarks can be adjusted at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Como calculamos as horas economizadas:</strong></p>
      <p>
        • <strong>Busca em documento:</strong> cada consulta ao assistente equivale a ${b.search} minutos que seriam gastos buscando manualmente.<br>
        • <strong>Processamento de documento:</strong> cada documento catalogado automaticamente equivale a ${b.doc} minutos de trabalho manual.<br>
        • <strong>Alerta de vencimento:</strong> cada alerta enviado automaticamente equivale a ${b.alert} minutos de trabalho manual.<br>
        • <strong>Triagem de email:</strong> cada email com anexo processado automaticamente equivale a ${b.email} minutos de triagem manual.
      </p>
      <p>
        • <strong>Valor estimado:</strong> horas economizadas × R$${b.cost}/hora (custo médio configurado).<br>
        • Esses benchmarks podem ser ajustados em ${settingsLink}.
      </p>
    </div>`
}

function getHRFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>About this report:</strong></p>
      <p>
        • <strong>Urgent (7 days):</strong> documents expiring within the next 7 days — requires immediate action.<br>
        • <strong>Upcoming (8–30 days):</strong> documents expiring in 8 to 30 days — plan renewal in advance.<br>
        • <strong>Overdue:</strong> documents past their expiry date — contact the responsible person.
      </p>
      <p>
        • Alerts are sent automatically when a document approaches its expiry date.<br>
        • Recipients and schedule can be configured at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Sobre este relatório:</strong></p>
      <p>
        • <strong>Urgente (7 dias):</strong> documentos vencendo nos próximos 7 dias — requer ação imediata.<br>
        • <strong>Próximos (8–30 dias):</strong> documentos vencendo em 8 a 30 dias — planeje a renovação com antecedência.<br>
        • <strong>Vencidos:</strong> documentos com validade expirada — entre em contato com o responsável.
      </p>
      <p>
        • Alertas são enviados automaticamente quando um documento se aproxima do vencimento.<br>
        • Destinatários e agendamento podem ser configurados em ${settingsLink}.
      </p>
    </div>`
}

function getITFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>About this report:</strong></p>
      <p>
        • <strong>Cache hit rate:</strong> percentage of queries answered using cached embeddings instead of calling the OpenAI API. Target: ≥ 60%.<br>
        • <strong>AI cost:</strong> estimated cost based on token usage per model (prices may vary).<br>
        • <strong>Model distribution:</strong> proportion of queries handled by each model (gpt-4o-mini is cheaper).
      </p>
      <p>
        • Settings and recipients can be configured at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Sobre este relatório:</strong></p>
      <p>
        • <strong>Taxa de cache:</strong> percentual de consultas respondidas usando embeddings em cache em vez de chamar a API da OpenAI. Meta: ≥ 60%.<br>
        • <strong>Custo de IA:</strong> estimativa baseada no consumo de tokens por modelo (preços podem variar).<br>
        • <strong>Distribuição de modelos:</strong> proporção de consultas atendidas por cada modelo (gpt-4o-mini é mais econômico).
      </p>
      <p>
        • Configurações e destinatários podem ser ajustados em ${settingsLink}.
      </p>
    </div>`
}
