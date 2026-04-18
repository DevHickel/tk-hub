// Rodapé explicativo — obrigatório em todo relatório (reports/SKILL.md)
import type { ReportConfig } from '../hours.calculator.js'
import { DEFAULT_BENCHMARKS } from '../hours.calculator.js'

export function getFooterExplanations(config: ReportConfig, lang: 'pt' | 'en' = 'pt'): string {
  const b = {
    search:  config.benchmark_search_min      ?? DEFAULT_BENCHMARKS.search_min,
    doc:     config.benchmark_doc_process_min ?? DEFAULT_BENCHMARKS.doc_process_min,
    alert:   config.benchmark_alert_min       ?? DEFAULT_BENCHMARKS.alert_min,
    email:   config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
    cost:    config.hour_cost_brl             ?? DEFAULT_BENCHMARKS.hour_cost_brl,
  }
  const frontendUrl = process.env.FRONTEND_URL!

  if (lang === 'en') return `
    <div style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;color:#6b7280;font-size:12px;line-height:1.8">
      <p><strong>How we calculate hours saved:</strong></p>
      <p>
        • <strong>Document search:</strong> each assistant query equals ${b.search} minutes of manual searching.<br>
        • <strong>Document processing:</strong> each automatically catalogued document equals ${b.doc} minutes of manual work.<br>
        • <strong>Expiry alert:</strong> each automatically sent alert equals ${b.alert} minutes of manual work.<br>
        • <strong>Email triage:</strong> each email with attachment processed automatically equals ${b.email} minutes of manual triage.
      </p>
      <p>
        • <strong>Estimated value:</strong> hours saved × R$${b.cost}/hour (average cost configured).<br>
        • These benchmarks can be adjusted at <a href="${frontendUrl}/report-settings">Settings → Reports</a>.
      </p>
    </div>`

  return `
    <div style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;color:#6b7280;font-size:12px;line-height:1.8">
      <p><strong>Como calculamos as horas economizadas:</strong></p>
      <p>
        • <strong>Busca em documento:</strong> cada consulta ao assistente equivale a ${b.search} minutos que seriam gastos buscando manualmente.<br>
        • <strong>Processamento de documento:</strong> cada documento catalogado automaticamente equivale a ${b.doc} minutos de trabalho manual.<br>
        • <strong>Alerta de vencimento:</strong> cada alerta enviado automaticamente equivale a ${b.alert} minutos de trabalho manual.<br>
        • <strong>Triagem de email:</strong> cada email com anexo processado automaticamente equivale a ${b.email} minutos de triagem manual.
      </p>
      <p>
        • <strong>Valor estimado:</strong> horas economizadas × R$${b.cost}/hora (custo médio configurado).<br>
        • Esses benchmarks podem ser ajustados em <a href="${frontendUrl}/report-settings">Configurações → Relatórios</a>.
      </p>
    </div>`
}
