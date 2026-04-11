import type { WeekMetrics, HoursSaved, ReportConfig } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'

export function buildManagementEmail(
  metrics: WeekMetrics,
  config: ReportConfig,
  hoursSaved: HoursSaved,
  weekStart: Date,
  weekEnd: Date
): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const locale = lang === 'en' ? enUS : ptBR
  const period = `${format(weekStart, 'dd/MM', { locale })} a ${format(weekEnd, 'dd/MM/yyyy', { locale })}`
  const footer = getFooterExplanations(config, lang)

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:0;background:#f5f5f5}
  .w{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hd{background:#1E293B;padding:24px 32px;color:#fff}
  .hd h1{margin:0;font-size:18px;font-weight:600}
  .hd p{margin:4px 0 0;font-size:13px;opacity:.7}
  .hero{padding:32px;text-align:center;border-bottom:1px solid #e5e7eb}
  .hero .num{font-size:56px;font-weight:700;color:#1E293B;line-height:1}
  .hero .label{font-size:14px;color:#64748B;margin-top:8px}
  .hero .sub{font-size:18px;color:#22C55E;font-weight:600;margin-top:4px}
  .body{padding:24px 32px}
  table.metrics{width:100%;border-collapse:collapse;margin-top:8px}
  table.metrics td{padding:10px 8px;font-size:14px;border-bottom:1px solid #f1f5f9}
  table.metrics tr:nth-child(even) td{background:#f8fafc}
  table.metrics td:last-child{text-align:right;font-weight:600}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de Gestão</h1>
    <p>Semana de ${period}</p>
  </div>
  <div class="hero">
    <div class="num">${hoursSaved.hoursSaved.toFixed(1)}h</div>
    <div class="label">${lang === 'en' ? 'Hours saved this week' : 'Horas economizadas na semana'}</div>
    <div class="sub">≈ R$ ${hoursSaved.valueBRL.toFixed(2)}</div>
  </div>
  <div class="body">
    <h3 style="margin-top:0;color:#1E293B">${lang === 'en' ? 'Key Indicators' : 'Indicadores da Semana'}</h3>
    <table class="metrics">
      <tr><td>${lang === 'en' ? 'AI queries' : 'Consultas ao assistente IA'}</td><td>${metrics.rag_queries}</td></tr>
      <tr><td>${lang === 'en' ? 'Documents processed' : 'Documentos processados'}</td><td>${metrics.docs_processed}</td></tr>
      <tr><td>${lang === 'en' ? 'Emails processed (DMS)' : 'Emails processados (DMS)'}</td><td>${metrics.emails_processed}</td></tr>
      <tr><td>${lang === 'en' ? 'Documents expiring in 30 days' : 'Documentos vencendo em 30 dias'}</td><td style="color:${metrics.docs_expiring.length > 0 ? '#F59E0B' : 'inherit'}">${metrics.docs_expiring.length}</td></tr>
      <tr><td>${lang === 'en' ? 'Overdue documents' : 'Documentos vencidos'}</td><td style="color:${metrics.docs_expired > 0 ? '#EF4444' : 'inherit'}">${metrics.docs_expired}</td></tr>
    </table>
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}
