import type { WeekMetrics, ReportConfig } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function buildHREmail(metrics: WeekMetrics, config: ReportConfig, weekStart: Date, weekEnd: Date): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const footer = getFooterExplanations(config, lang)
  const period = `${format(weekStart, 'dd/MM', { locale: ptBR })} a ${format(weekEnd, 'dd/MM/yyyy', { locale: ptBR })}`

  // Agrupar por prazo
  const urgent = metrics.docs_expiring.filter((d) => {
    const days = Math.ceil((new Date(d.data_vencimento!).getTime() - Date.now()) / 86400000)
    return days <= 7
  })
  const soon = metrics.docs_expiring.filter((d) => {
    const days = Math.ceil((new Date(d.data_vencimento!).getTime() - Date.now()) / 86400000)
    return days > 7 && days <= 30
  })

  const expiryRows = (items: WeekMetrics['docs_expiring'], color: string) =>
    items.map((d) => {
      const days = Math.ceil((new Date(d.data_vencimento!).getTime() - Date.now()) / 86400000)
      return `<tr>
        <td style="padding:8px;font-size:13px">${d.colaborador ?? '—'}</td>
        <td style="padding:8px;font-size:13px">${format(new Date(d.data_vencimento!), 'dd/MM/yyyy')}</td>
        <td style="padding:8px;font-size:13px;color:${color};font-weight:600">${days}d</td>
      </tr>`
    }).join('')

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
  table{width:100%;border-collapse:collapse}
  th{background:#f8fafc;padding:8px;font-size:12px;color:#64748B;text-align:left;border-bottom:2px solid #e5e7eb}
  .alert-red{background:#FEF2F2;border-left:4px solid #EF4444;padding:12px;border-radius:4px;margin-bottom:16px}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de RH</h1>
    <p>Semana de ${period}</p>
  </div>
  <div class="hero">
    <div class="num" style="color:${urgent.length > 0 ? '#EF4444' : '#F59E0B'}">${urgent.length}</div>
    <div class="label">${lang === 'en' ? 'Documents expiring in 7 days (urgent)' : 'Documentos vencendo em 7 dias (urgente)'}</div>
  </div>
  <div class="body">
    ${metrics.docs_expired > 0 ? `<div class="alert-red">⚠️ <strong>${metrics.docs_expired} documento${metrics.docs_expired > 1 ? 's' : ''} já vencido${metrics.docs_expired > 1 ? 's' : ''}</strong>. Ação necessária.</div>` : ''}
    ${urgent.length > 0 ? `
    <h3>🔴 Vencendo em até 7 dias</h3>
    <table><thead><tr><th>Colaborador</th><th>Vencimento</th><th>Prazo</th></tr></thead>
    <tbody>${expiryRows(urgent, '#EF4444')}</tbody></table>` : ''}
    ${soon.length > 0 ? `
    <h3>🟡 Vencendo em 8–30 dias</h3>
    <table><thead><tr><th>Colaborador</th><th>Vencimento</th><th>Prazo</th></tr></thead>
    <tbody>${expiryRows(soon, '#F59E0B')}</tbody></table>` : ''}
    ${urgent.length === 0 && soon.length === 0 ? '<p style="color:#22C55E;font-weight:600">✅ Nenhum documento crítico nos próximos 30 dias.</p>' : ''}
    <h3>Resumo da semana</h3>
    <table>
      <tr><td style="padding:8px;font-size:14px">Documentos processados</td><td style="padding:8px;font-size:14px;text-align:right;font-weight:600">${metrics.docs_processed}</td></tr>
      <tr><td style="padding:8px;font-size:14px;background:#f8fafc">Emails com anexo processados</td><td style="padding:8px;font-size:14px;text-align:right;font-weight:600;background:#f8fafc">${metrics.emails_processed}</td></tr>
    </table>
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}
