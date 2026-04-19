// Rodapé explicativo por tipo de relatório
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
      <p><strong>How we calculate hours saved:</strong></p>
      <p>
        • <strong>Document search:</strong> each assistant query equals ${b.search} minutes of manual searching.<br>
        • <strong>Document processing:</strong> each automatically catalogued document equals ${b.doc} minutes of manual work.<br>
        • <strong>Email triage:</strong> each email with attachment processed automatically equals ${b.email} minutes of manual triage.
      </p>
      <p>
        • <strong>Estimated value:</strong> hours saved × R$${b.cost}/hour (average cost configured).<br>
        • <strong>ROI:</strong> estimated value ÷ total weekly cost (AI tokens + fixed infrastructure cost ÷ 4.33).<br>
        • These benchmarks can be adjusted at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Como calculamos as horas economizadas:</strong></p>
      <p>
        • <strong>Busca em documento:</strong> cada consulta ao assistente equivale a ${b.search} minutos que seriam gastos buscando manualmente.<br>
        • <strong>Processamento de documento:</strong> cada documento catalogado automaticamente equivale a ${b.doc} minutos de trabalho manual.<br>
        • <strong>Triagem de email:</strong> cada email com anexo processado automaticamente equivale a ${b.email} minutos de triagem manual.
      </p>
      <p>
        • <strong>Valor estimado:</strong> horas economizadas × R$${b.cost}/hora (custo médio configurado).<br>
        • <strong>ROI:</strong> valor economizado ÷ custo total semanal (tokens IA + custo fixo de infraestrutura ÷ 4,33).<br>
        • Esses benchmarks podem ser ajustados em ${settingsLink}.
      </p>
    </div>`
}

function getHRFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>About this report:</strong></p>
      <p>
        • <strong>🔴 Expired / 1 day:</strong> certificates already expired or expiring tomorrow — immediate action required.<br>
        • <strong>🟠 2–3 days:</strong> certificates expiring very soon — prioritize renewal.<br>
        • <strong>🟡 4–15 days:</strong> certificates requiring attention — schedule renewal.<br>
        • <strong>🔵 16–30 days:</strong> certificates approaching expiry — plan ahead.
      </p>
      <p>
        • Automatic alerts are sent 30, 15, 7, 3 and 1 day before expiry and on the expiry day.<br>
        • Recipients and schedule can be configured at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Sobre este relatório:</strong></p>
      <p>
        • <strong>🔴 Vencido / 1 dia:</strong> certificados já vencidos ou que vencem amanhã — ação imediata necessária.<br>
        • <strong>🟠 2–3 dias:</strong> certificados vencendo muito em breve — priorize a renovação.<br>
        • <strong>🟡 4–15 dias:</strong> certificados que precisam de atenção — agende a renovação.<br>
        • <strong>🔵 16–30 dias:</strong> certificados se aproximando do vencimento — planeje com antecedência.
      </p>
      <p>
        • Alertas automáticos são enviados 30, 15, 7, 3 e 1 dia antes do vencimento e no dia do vencimento.<br>
        • Destinatários e agendamento podem ser configurados em ${settingsLink}.
      </p>
    </div>`
}

function getITFooter(lang: 'pt' | 'en', settingsLink: string): string {
  if (lang === 'en') return `
    <div style="${FOOTER_STYLE}">
      <p><strong>About this report:</strong></p>
      <p>
        • <strong>AI cost:</strong> estimated based on token consumption per model. Prices are averages (input+output) and may vary.<br>
        • <strong>Cache hit rate:</strong> percentage of queries answered from cached embeddings instead of OpenAI API calls. Target: ≥ 60%.<br>
        • <strong>Success rate:</strong> processed documents vs. errors — values below 95% indicate pipeline issues.<br>
        • <strong>Satisfaction:</strong> ratio of positive (👍) to negative (👎) feedback on AI responses.<br>
        • <strong>Stuck documents:</strong> documents with status "processing" for too long may indicate queue issues.
      </p>
      <p>
        • Settings and recipients can be configured at ${settingsLink}.
      </p>
    </div>`

  return `
    <div style="${FOOTER_STYLE}">
      <p><strong>Sobre este relatório:</strong></p>
      <p>
        • <strong>Custo de IA:</strong> estimativa baseada no consumo de tokens por modelo. Preços são médias (input+output) e podem variar.<br>
        • <strong>Taxa de cache:</strong> percentual de consultas respondidas usando embeddings em cache em vez de chamar a API da OpenAI. Meta: ≥ 60%.<br>
        • <strong>Taxa de sucesso:</strong> documentos processados vs. erros — valores abaixo de 95% indicam problemas no pipeline.<br>
        • <strong>Satisfação:</strong> proporção de feedbacks positivos (👍) vs. negativos (👎) nas respostas da IA.<br>
        • <strong>Documentos travados:</strong> documentos com status "processando" por muito tempo podem indicar problemas na fila.
      </p>
      <p>
        • Configurações e destinatários podem ser ajustados em ${settingsLink}.
      </p>
    </div>`
}
