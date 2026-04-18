import type { WeekMetrics, ReportConfig, ExpiringCert } from '../hours.calculator.js'
import { getFooterExplanations } from './footer.template.js'
import { format } from 'date-fns'
import { ptBR, enUS } from 'date-fns/locale'

export function buildHREmail(metrics: WeekMetrics, config: ReportConfig, weekStart: Date, weekEnd: Date): string {
  const lang = (config.language ?? 'pt') as 'pt' | 'en'
  const locale = lang === 'en' ? enUS : ptBR
  const footer = getFooterExplanations(config, lang, 'hr')
  const period = `${format(weekStart, 'dd/MM', { locale })} a ${format(weekEnd, 'dd/MM/yyyy', { locale })}`

  const tiers = metrics.certs_expiring_tiers
  const totalUrgent = tiers.expired.length + tiers.day1.length + tiers.day3.length + tiers.day7.length
  const totalWarning = tiers.day15.length + tiers.day30.length
  const heroColor = tiers.expired.length > 0 ? '#EF4444' : totalUrgent > 0 ? '#F59E0B' : '#22C55E'
  const heroNumber = tiers.expired.length + totalUrgent

  // Top 5 tipos de certificados
  const topTypes = metrics.certs_by_type.slice(0, 5)

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
  th{background:#f8fafc;padding:8px;font-size:12px;color:#64748B;text-align:left;border-bottom:2px solid #e5e7eb}
  td{padding:8px;font-size:13px;border-bottom:1px solid #f1f5f9}
  tr:nth-child(even) td{background:#f8fafc}
  .stats{display:flex;gap:0}
  .stat{flex:1;text-align:center;padding:16px 8px;border-right:1px solid #e5e7eb}
  .stat:last-child{border-right:none}
  .stat .val{font-size:24px;font-weight:700;color:#1E293B}
  .stat .lbl{font-size:11px;color:#64748B;margin-top:4px}
  .alert{padding:12px;border-radius:4px;margin-bottom:12px;font-size:13px}
  .alert-red{background:#FEF2F2;border-left:4px solid #EF4444}
  .alert-yellow{background:#FFFBEB;border-left:4px solid #F59E0B}
  .alert-green{background:#F0FDF4;border-left:4px solid #22C55E}
  .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}
  .ft{background:#F8FAFC;padding:16px 32px}
</style></head>
<body><div class="w">
  <div class="hd">
    <h1>TK Solution — Relatório de RH</h1>
    <p>Semana de ${period}</p>
  </div>

  <!-- Hero: certificados que precisam de atenção -->
  <div class="hero">
    <div class="num" style="color:${heroColor}">${heroNumber}</div>
    <div class="label">Certificados que precisam de atenção imediata</div>
  </div>

  <!-- Resumo em números -->
  <div style="border-bottom:1px solid #e5e7eb">
    <table style="border:none"><tr>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:#1E293B">${metrics.total_certs.toLocaleString('pt-BR')}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Total de certificados</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:#1E293B">${metrics.certs_processed_week.toLocaleString('pt-BR')}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Novos na semana</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;border-right:1px solid #e5e7eb;width:25%">
        <div style="font-size:24px;font-weight:700;color:${totalWarning > 0 ? '#F59E0B' : '#22C55E'}">${totalWarning}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Perto do vencimento</div>
      </td>
      <td style="text-align:center;padding:16px;border-bottom:none;width:25%">
        <div style="font-size:24px;font-weight:700;color:${tiers.expired.length > 0 ? '#EF4444' : '#22C55E'}">${tiers.expired.length}</div>
        <div style="font-size:11px;color:#64748B;margin-top:4px">Vencidos</div>
      </td>
    </tr></table>
  </div>

  <div class="body">
    <!-- Alertas de certificados vencidos -->
    ${tiers.expired.length > 0 ? `
    <div class="alert alert-red">
      <strong>🔴 ${tiers.expired.length} certificado${tiers.expired.length > 1 ? 's' : ''} vencido${tiers.expired.length > 1 ? 's' : ''}</strong> — ação necessária imediatamente.
    </div>
    ${buildCertTable(tiers.expired, '#EF4444', true)}` : ''}

    <!-- Vencendo em 1 dia -->
    ${tiers.day1.length > 0 ? `
    <div class="alert alert-red">
      <strong>🔴 ${tiers.day1.length} certificado${tiers.day1.length > 1 ? 's' : ''} vence${tiers.day1.length > 1 ? 'm' : ''} amanhã</strong>
    </div>
    ${buildCertTable(tiers.day1, '#EF4444')}` : ''}

    <!-- Vencendo em 3 dias -->
    ${tiers.day3.length > 0 ? `
    <h3>🟠 Vencendo em 2–3 dias</h3>
    ${buildCertTable(tiers.day3, '#EA580C')}` : ''}

    <!-- Vencendo em 7 dias -->
    ${tiers.day7.length > 0 ? `
    <h3>🟡 Vencendo em 4–7 dias</h3>
    ${buildCertTable(tiers.day7, '#F59E0B')}` : ''}

    <!-- Vencendo em 15 dias -->
    ${tiers.day15.length > 0 ? `
    <h3>🟡 Vencendo em 8–15 dias</h3>
    ${buildCertTable(tiers.day15, '#F59E0B')}` : ''}

    <!-- Vencendo em 30 dias -->
    ${tiers.day30.length > 0 ? `
    <h3>🔵 Vencendo em 16–30 dias</h3>
    ${buildCertTable(tiers.day30, '#3B82F6')}` : ''}

    ${heroNumber === 0 && totalWarning === 0 ? `
    <div class="alert alert-green">
      <strong>✅ Todos os certificados estão em dia.</strong> Nenhum vencimento nos próximos 30 dias.
    </div>` : ''}

    <!-- Colaboradores com certificados vencidos -->
    ${metrics.collaborators_with_expired.length > 0 ? `
    <h3>👤 Colaboradores com pendências</h3>
    <table>
      <thead><tr><th>Colaborador</th><th style="text-align:right">Certificados vencidos</th></tr></thead>
      <tbody>
        ${metrics.collaborators_with_expired.slice(0, 10).map((c) => `
        <tr>
          <td>${c.colaborador}</td>
          <td style="text-align:right;font-weight:600;color:#EF4444">${c.count}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}

    <!-- Distribuição por tipo -->
    ${topTypes.length > 0 ? `
    <h3>📋 Certificados por tipo</h3>
    <table>
      <thead><tr><th>Tipo</th><th style="text-align:right">Quantidade</th></tr></thead>
      <tbody>
        ${topTypes.map((t) => `
        <tr>
          <td>${t.tipo}</td>
          <td style="text-align:right;font-weight:600">${t.count}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}

    <!-- Resumo da semana -->
    <h3>📊 Atividade da semana</h3>
    <table>
      <tr>
        <td>Certificados processados</td>
        <td style="text-align:right;font-weight:600">${metrics.certs_processed_week.toLocaleString('pt-BR')}</td>
      </tr>
      <tr>
        <td>Certificados recebidos por e-mail</td>
        <td style="text-align:right;font-weight:600">${metrics.emails_processed.toLocaleString('pt-BR')}</td>
      </tr>
      <tr>
        <td>Alertas de vencimento configurados</td>
        <td style="text-align:right;font-weight:600">30, 15, 7, 3 e 1 dia antes</td>
      </tr>
    </table>
  </div>
  <div class="ft">${footer}</div>
</div></body></html>`
}

function buildCertTable(certs: ExpiringCert[], color: string, expired = false): string {
  return `<table>
    <thead><tr>
      <th>Colaborador</th>
      <th>Tipo</th>
      <th>Vencimento</th>
      <th style="text-align:right">${expired ? 'Dias vencido' : 'Prazo'}</th>
    </tr></thead>
    <tbody>
      ${certs.map((c) => {
        const days = Math.ceil((new Date(c.data_vencimento!).getTime() - Date.now()) / 86400000)
        const displayDays = expired ? Math.abs(days) : days
        return `<tr>
          <td>${c.colaborador ?? '—'}</td>
          <td><span class="badge" style="background:#f1f5f9;color:#334155">${c.tipo ?? '—'}</span></td>
          <td>${format(new Date(c.data_vencimento!), 'dd/MM/yyyy')}</td>
          <td style="text-align:right;font-weight:600;color:${color}">${expired ? `-${displayDays}d` : `${displayDays}d`}</td>
        </tr>`
      }).join('')}
    </tbody>
  </table>`
}
