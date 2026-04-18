import type { WeekMetrics, ReportConfig, AICost } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function buildITEmail(
  metrics: WeekMetrics,
  config: ReportConfig,
  aiCost: AICost,
  weekStart: Date,
  weekEnd: Date
): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const footer = getFooterExplanations(config, lang)
  const period = `${format(weekStart, 'dd/MM', { locale: ptBR })} a ${format(weekEnd, 'dd/MM/yyyy', { locale: ptBR })}`

  const totalTokens = metrics.model_usage.reduce((s, r) => s + (r.tokens_used ?? 0), 0)
  const miniTokens = metrics.model_usage
    .filter((r) => r.model_used === 'gpt-4o-mini')
    .reduce((s, r) => s + (r.tokens_used ?? 0), 0)
  const miniPct = totalTokens > 0 ? Math.round((miniTokens / totalTokens) * 100) : 0

  // Cache hit rate
  const totalCalls = metrics.rag_queries
  const cacheHits = metrics.cache_hits
  const cacheRate = totalCalls > 0 ? Math.round((cacheHits / totalCalls) * 100) : 0
  const cacheColor = cacheRate >= 60 ? '#22C55E' : cacheRate >= 40 ? '#F59E0B' : '#EF4444'

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:0;background:#f5f5f5}
  .w{max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hd{background:#1E293B;padding:24px 32px;color:#fff}
  .hd h1{margin:0;font-size:18px}
  .hd p{margin:4px 0 0;font-size:13px;opacity:.7}
  .hero{padding:32px;text-align:center;border-bottom:1px solid #e5e7eb}
  .hero .num{font-size:56px;font-weight:700;line-height:1}
  .hero .label{font-size:14px;color:#64748B;margin-top:8px}
  .body{padding:24px 32px}
  h3{color:#1E293B;margin-top:24px;margin-bottom:8px}
  .bar-bg{background:#e5e7eb;border-radius:4px;height:12px;overflow:hidden}
  .bar-fill{background:#1E293B;height:100%;border-radius:4px}
  table{width:100%;border-collapse:collapse}
  td{padding:10px 8px;font-size:14px;border-bottom:1px solid #f1f5f9}
  tr:nth-child(even) td{background:#f8fafc}
  td:last-child{text-align:right;font-weight:600}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de TI</h1>
    <p>Semana de ${period}</p>
  </div>
  <div class="hero">
    <div class="num" style="color:${cacheColor}">${cacheRate}%</div>
    <div class="label">Cache hit rate de embeddings (meta: ≥ 60%)</div>
  </div>
  <div class="body">
    <h3>Custo de IA na semana</h3>
    <table>
      <tr><td>Total estimado</td><td>R$ ${aiCost.totalBRL.toFixed(2)}</td></tr>
      ${Object.entries(aiCost.byModel).map(([m, v]) =>
        `<tr><td>${m}</td><td>${(v.tokens / 1000).toFixed(1)}k tokens / R$ ${v.brl.toFixed(2)}</td></tr>`
      ).join('')}
    </table>

    <h3>Distribuição de modelos</h3>
    <p style="font-size:13px;color:#64748B;margin-bottom:4px">gpt-4o-mini: ${miniPct}% | gpt-4o: ${100 - miniPct}%</p>
    <div class="bar-bg"><div class="bar-fill" style="width:${miniPct}%"></div></div>

    <h3>Uso do sistema</h3>
    <table>
      <tr><td>Consultas ao assistente</td><td>${metrics.rag_queries}</td></tr>
      <tr><td>Documentos processados</td><td>${metrics.docs_processed}</td></tr>
      <tr><td>Certificados recebidos por e-mail</td><td>${metrics.emails_processed}</td></tr>
      <tr><td>Consultas atendidas pelo cache</td><td>${cacheHits}</td></tr>
    </table>
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}
