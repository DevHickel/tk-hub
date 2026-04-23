import type { WeekMetrics, HoursSaved, ReportConfig, AICost } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'

export function buildManagementEmail(
  metrics: WeekMetrics,
  config: ReportConfig,
  hoursSaved: HoursSaved,
  aiCost: AICost,
  weekStart: Date,
  weekEnd: Date
): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const locale = lang === 'en' ? enUS : ptBR
  const period = `${format(weekStart, 'dd/MM', { locale })} a ${format(weekEnd, 'dd/MM/yyyy', { locale })}`
  const footer = getFooterExplanations(config, lang, 'management')

  const weeklyFixedCost = (config.monthly_fixed_cost_brl ?? 0) / 4.33
  const totalWeeklyCost = aiCost.totalBRL + weeklyFixedCost

  const roi = totalWeeklyCost > 0
    ? Math.round((hoursSaved.valueBRL / totalWeeklyCost) * 100) / 100
    : 0
  const roiColor = roi >= 5 ? '#22C55E' : roi >= 2 ? '#F59E0B' : '#EF4444'

  const tiers = metrics.certs_expiring_tiers
  const certsUrgent = tiers.expired.length + tiers.day1.length + tiers.day3.length + tiers.day7.length

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><style>
  body{font-family:Arial,sans-serif;color:#1a1a1a;margin:0;padding:0;background:#f5f5f5}
  .w{max-width:640px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .hd{background:#1E293B;padding:24px 32px;color:#fff}
  .hd h1{margin:0;font-size:18px;font-weight:600}
  .hd p{margin:4px 0 0;font-size:13px;opacity:.7}
  .hero{padding:32px;text-align:center;border-bottom:1px solid #e5e7eb}
  .hero .num{font-size:56px;font-weight:700;color:#1E293B;line-height:1}
  .hero .label{font-size:14px;color:#64748B;margin-top:8px}
  .hero .sub{font-size:18px;color:#22C55E;font-weight:600;margin-top:4px}
  .body{padding:24px 32px}
  h3{color:#1E293B;margin-top:24px;margin-bottom:8px;font-size:15px}
  table{width:100%;border-collapse:collapse}
  td{padding:10px 8px;font-size:14px;border-bottom:1px solid #f1f5f9}
  tr:nth-child(even) td{background:#f8fafc}
  td:last-child{text-align:right;font-weight:600}
  .alert{padding:12px;border-radius:4px;margin-bottom:12px;font-size:13px}
  .alert-red{background:#FEF2F2;border-left:4px solid #EF4444}
  .alert-yellow{background:#FFFBEB;border-left:4px solid #F59E0B}
  .alert-green{background:#F0FDF4;border-left:4px solid #22C55E}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de Gestão</h1>
    <p>Semana de ${period}</p>
  </div>

  <!-- Hero: economia -->
  <div class="hero">
    <div class="num">${formatHoursMinutes(hoursSaved.minutesSaved)}</div>
    <div class="label">Tempo que a IA economizou para a equipe nesta semana</div>
    <div class="sub">Valor equivalente: R$ ${formatBRL(hoursSaved.valueBRL)}</div>
  </div>

  <!-- 4 KPIs -->
  <div style="border-bottom:1px solid #e5e7eb">
    <table style="border:none"><tr>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:${roiColor}">${roi > 0 ? roi.toFixed(1) + 'x' : '—'}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Retorno sobre o gasto</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:#1E293B">${metrics.active_users}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Pessoas que usaram</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:#1E293B">${metrics.total_certs}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Certificados no sistema</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;width:25%">
        <div style="font-size:24px;font-weight:700;color:${certsUrgent > 0 ? '#EF4444' : '#22C55E'}">${certsUrgent}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Precisam de atenção</div>
      </td>
    </tr></table>
  </div>

  <div class="body">
    <!-- Alerta único sobre certificados -->
    ${tiers.expired.length > 0 ? `<div class="alert alert-red">🔴 <strong>${tiers.expired.length} certificado${tiers.expired.length > 1 ? 's' : ''} vencido${tiers.expired.length > 1 ? 's' : ''}</strong> — o RH precisa tomar providências.</div>` : ''}
    ${certsUrgent > 0 && tiers.expired.length === 0 ? `<div class="alert alert-yellow">⚠️ <strong>${certsUrgent} certificado${certsUrgent > 1 ? 's' : ''}</strong> vencendo nos próximos 7 dias.</div>` : ''}
    ${certsUrgent === 0 && tiers.expired.length === 0 ? `<div class="alert alert-green">✅ <strong>Todos os certificados estão em dia.</strong></div>` : ''}

    <!-- Como a IA ajudou -->
    <h3>🤖 Como a IA ajudou esta semana</h3>
    <table>
      <tr><td>Perguntas respondidas pelo assistente</td><td>${metrics.rag_queries}</td></tr>
      <tr><td>Certificados cadastrados automaticamente</td><td>${metrics.certs_processed_week}</td></tr>
      <tr><td>Documentos adicionados à base de conhecimento</td><td>${metrics.rag_docs_total}</td></tr>
    </table>

    <!-- Quanto custou e quanto retornou -->
    <h3>💰 Quanto custou e quanto retornou</h3>
    <table>
      <tr><td>Custo da IA na semana</td><td>R$ ${formatBRL(aiCost.totalBRL)}</td></tr>
      ${weeklyFixedCost > 0 ? `<tr><td>Custo fixo semanal (infraestrutura)</td><td>R$ ${formatBRL(weeklyFixedCost)}</td></tr>` : ''}
      <tr><td><strong>Custo total da semana</strong></td><td><strong>R$ ${formatBRL(totalWeeklyCost)}</strong></td></tr>
      <tr><td>Retorno sobre o gasto</td><td style="color:${roiColor}">${roi > 0 ? `${roi.toFixed(1)}x — cada R$ 1 gasto rendeu R$ ${roi.toFixed(2)} em tempo economizado` : '—'}</td></tr>
    </table>

    <!-- Top tipos de certificado -->
    ${metrics.certs_by_type.length > 0 ? `
    <h3>📑 Tipos de certificado mais comuns</h3>
    <table>
      ${metrics.certs_by_type.slice(0, 5).map((t) => `
      <tr><td>${t.tipo}</td><td>${t.count}</td></tr>`).join('')}
    </table>` : ''}

    <!-- Usuários mais ativos -->
    ${metrics.top_users.length > 0 ? `
    <h3>👥 Pessoas que mais usaram a IA</h3>
    <table>
      ${metrics.top_users.map((u) => `
      <tr><td>${u.name}</td><td>${u.queries} perguntas</td></tr>`).join('')}
    </table>` : ''}

    <!-- Colaboradores com pendências (se houver) -->
    ${metrics.collaborators_with_expired.length > 0 ? `
    <h3>⚠️ Colaboradores com certificados vencidos</h3>
    <table>
      ${metrics.collaborators_with_expired.slice(0, 5).map((c) => `
      <tr><td>${c.colaborador}</td><td style="color:#EF4444">${c.count} vencido${c.count > 1 ? 's' : ''}</td></tr>`).join('')}
    </table>` : ''}
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  return `${h} horas e ${m} minutos`
}
