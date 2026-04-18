import type { WeekMetrics, ReportConfig, AICost } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'

export function buildITEmail(
  metrics: WeekMetrics,
  config: ReportConfig,
  aiCost: AICost,
  weekStart: Date,
  weekEnd: Date
): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const locale = lang === 'en' ? enUS : ptBR
  const footer = getFooterExplanations(config, lang, 'it')
  const period = `${format(weekStart, 'dd/MM', { locale })} a ${format(weekEnd, 'dd/MM/yyyy', { locale })}`

  const totalTokens = metrics.total_tokens_week
  const miniTokens = metrics.model_usage
    .filter((r) => r.model_used === 'gpt-4o-mini')
    .reduce((s, r) => s + (r.tokens_used ?? 0), 0)
  const miniPct = totalTokens > 0 ? Math.round((miniTokens / totalTokens) * 100) : 0

  // Cache hit rate
  const totalCalls = metrics.rag_queries
  const cacheRate = totalCalls > 0 ? Math.round((metrics.cache_hits / totalCalls) * 100) : 0
  const cacheColor = cacheRate >= 60 ? '#22C55E' : cacheRate >= 40 ? '#F59E0B' : '#EF4444'

  // Feedback satisfaction
  const totalFeedback = metrics.feedback_positive + metrics.feedback_negative
  const satisfactionPct = totalFeedback > 0 ? Math.round((metrics.feedback_positive / totalFeedback) * 100) : 0
  const satisfactionColor = satisfactionPct >= 80 ? '#22C55E' : satisfactionPct >= 60 ? '#F59E0B' : '#EF4444'

  // Processing health
  const docsTotal = metrics.docs_processed + metrics.docs_error_week
  const successRate = docsTotal > 0 ? Math.round((metrics.docs_processed / docsTotal) * 100) : 100
  const successColor = successRate >= 95 ? '#22C55E' : successRate >= 80 ? '#F59E0B' : '#EF4444'

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:0;background:#f5f5f5}
  .w{max-width:640px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hd{background:#1E293B;padding:24px 32px;color:#fff}
  .hd h1{margin:0;font-size:18px;font-weight:600}
  .hd p{margin:4px 0 0;font-size:13px;opacity:.7}
  .hero{padding:32px;text-align:center;border-bottom:1px solid #e5e7eb}
  .hero .num{font-size:56px;font-weight:700;line-height:1}
  .hero .label{font-size:14px;color:#64748B;margin-top:8px}
  .body{padding:24px 32px}
  h3{color:#1E293B;margin-top:24px;margin-bottom:8px;font-size:15px}
  table{width:100%;border-collapse:collapse}
  td{padding:10px 8px;font-size:14px;border-bottom:1px solid #f1f5f9}
  tr:nth-child(even) td{background:#f8fafc}
  td:last-child{text-align:right;font-weight:600}
  .bar-bg{background:#e5e7eb;border-radius:4px;height:12px;overflow:hidden;margin-top:4px}
  .bar-fill{height:100%;border-radius:4px}
  .alert{padding:12px;border-radius:4px;margin-bottom:12px;font-size:13px}
  .alert-red{background:#FEF2F2;border-left:4px solid #EF4444}
  .alert-yellow{background:#FFFBEB;border-left:4px solid #F59E0B}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de TI</h1>
    <p>Semana de ${period}</p>
  </div>

  <!-- Hero: custo total de IA -->
  <div class="hero">
    <div class="num" style="color:#1E293B">R$ ${aiCost.totalBRL.toFixed(2)}</div>
    <div class="label">Custo total de IA na semana</div>
  </div>

  <!-- 4 KPIs -->
  <div style="border-bottom:1px solid #e5e7eb">
    <table style="border:none"><tr>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:${cacheColor}">${cacheRate}%</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Cache hit rate</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:${successColor}">${successRate}%</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Taxa de sucesso</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:#1E293B">${metrics.active_users}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Usuários ativos</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;width:25%">
        <div style="font-size:24px;font-weight:700;color:${satisfactionColor}">${totalFeedback > 0 ? satisfactionPct + '%' : '—'}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Satisfação IA</div>
      </td>
    </tr></table>
  </div>

  <div class="body">
    <!-- Alertas -->
    ${metrics.docs_processing > 0 ? `<div class="alert alert-yellow">⚠️ <strong>${metrics.docs_processing} documento${metrics.docs_processing > 1 ? 's' : ''} travado${metrics.docs_processing > 1 ? 's' : ''} em processamento</strong> — verificar fila.</div>` : ''}
    ${metrics.docs_error_week > 0 ? `<div class="alert alert-red">🔴 <strong>${metrics.docs_error_week} erro${metrics.docs_error_week > 1 ? 's' : ''} de processamento</strong> na semana.</div>` : ''}

    <!-- Custo por modelo -->
    <h3>💰 Custo de IA por modelo</h3>
    <table>
      <tr><td>Total estimado</td><td>R$ ${aiCost.totalBRL.toFixed(2)}</td></tr>
      ${Object.entries(aiCost.byModel).map(([m, v]) =>
        `<tr><td>${m}</td><td>${formatTokens(v.tokens)} tokens / R$ ${v.brl.toFixed(2)}</td></tr>`
      ).join('')}
    </table>

    <!-- Distribuição de modelos -->
    <h3>🤖 Distribuição de modelos</h3>
    <p style="font-size:13px;color:#64748B;margin-bottom:4px">gpt-4o-mini: ${miniPct}% | gpt-4o: ${100 - miniPct}%</p>
    <div class="bar-bg">
      <div class="bar-fill" style="width:${miniPct}%;background:#22C55E"></div>
    </div>
    <p style="font-size:11px;color:#64748B;margin-top:4px">Verde = gpt-4o-mini (mais econômico). Meta: ≥ 80%.</p>

    <!-- Uso do assistente -->
    <h3>🧠 Assistente IA</h3>
    <table>
      <tr><td>Consultas na semana</td><td>${metrics.rag_queries}</td></tr>
      <tr><td>Tokens consumidos</td><td>${formatTokens(totalTokens)}</td></tr>
      <tr><td>Média por consulta</td><td>${formatTokens(metrics.avg_tokens_per_query)} tokens</td></tr>
      <tr><td>Consultas atendidas pelo cache</td><td>${metrics.cache_hits}</td></tr>
      ${totalFeedback > 0 ? `<tr><td>Feedback dos usuários</td><td>👍 ${metrics.feedback_positive} / 👎 ${metrics.feedback_negative}</td></tr>` : ''}
    </table>

    <!-- Processamento de documentos -->
    <h3>📄 Processamento de documentos</h3>
    <table>
      <tr><td>Documentos processados</td><td>${metrics.docs_processed}</td></tr>
      <tr><td>Certificados recebidos por e-mail</td><td>${metrics.emails_processed}</td></tr>
      <tr><td>Erros de processamento</td><td style="color:${metrics.docs_error_week > 0 ? '#EF4444' : 'inherit'}">${metrics.docs_error_week}</td></tr>
      <tr><td>Em processamento agora</td><td style="color:${metrics.docs_processing > 0 ? '#F59E0B' : 'inherit'}">${metrics.docs_processing}</td></tr>
    </table>

    <!-- Infraestrutura RAG -->
    <h3>🗄️ Base de conhecimento</h3>
    <table>
      <tr><td>Total de documentos ativos</td><td>${metrics.total_certs}</td></tr>
      <tr><td>Chunks no índice vetorial</td><td>${formatNumber(metrics.total_chunks)}</td></tr>
      <tr><td>Embeddings em cache</td><td>${formatNumber(metrics.total_cache_entries)}</td></tr>
      <tr><td>Cache hit rate</td><td style="color:${cacheColor}">${cacheRate}% ${cacheRate >= 60 ? '✅' : '⚠️'}</td></tr>
    </table>
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR')
}
