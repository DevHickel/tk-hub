---
name: reports
description: Regras para o sistema de relatórios semanais automáticos da TK Solution — 3 relatórios por público, email toda segunda-feira, benchmarks configuráveis pela gestão
---

# Relatórios Semanais — Sistema Completo

## Visão geral

Três relatórios distintos enviados toda segunda-feira às 07h (Brasília):
- **management** → gestão/diretoria: ROI, horas economizadas, conformidade
- **hr** → RH/administrativo: documentos, vencimentos, colaboradores
- **it** → TI/operacional: saúde do sistema, custo de IA, cache

Configuração única para toda a TK Solution (não por empresa — produto interno).
A gestão configura destinatários e benchmarks via dashboard.
Idioma padrão: português. Opção de inglês.

## Benchmarks — base de cálculo de horas economizadas

Os benchmarks ficam na tabela `report_config` e são editáveis.
Valores padrão (usados quando não configurado):

```typescript
export const DEFAULT_BENCHMARKS = {
  search_min: 8,        // minutos para buscar info em doc manualmente
  doc_process_min: 25,  // minutos para catalogar um documento manualmente
  alert_min: 5,         // minutos para enviar alerta de vencimento manualmente
  email_triage_min: 10, // minutos para triar email com anexo manualmente
  hour_cost_brl: 35,    // custo médio hora colaborador em R$
}
```

## Cálculo de horas economizadas

```typescript
export function calcHoursSaved(metrics: WeekMetrics, config: ReportConfig): HoursSaved {
  const b = {
    search:      config.benchmark_search_min      ?? DEFAULT_BENCHMARKS.search_min,
    doc_process: config.benchmark_doc_process_min ?? DEFAULT_BENCHMARKS.doc_process_min,
    alert:       config.benchmark_alert_min       ?? DEFAULT_BENCHMARKS.alert_min,
    email:       config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
  }

  const minutesSaved =
    (metrics.rag_queries       * b.search)      +
    (metrics.docs_processed    * b.doc_process)  +
    (metrics.alerts_sent       * b.alert)        +
    (metrics.emails_processed  * b.email)

  const hoursSaved   = minutesSaved / 60
  const valueBRL     = hoursSaved * (config.hour_cost_brl ?? DEFAULT_BENCHMARKS.hour_cost_brl)

  return { minutesSaved, hoursSaved, valueBRL }
}
```

## Coleta de métricas — queries SQL por relatório

```typescript
async function collectWeekMetrics(weekStart: Date, weekEnd: Date) {
  const [ragQueries, docsProcessed, docsExpiring, docsExpired,
         alertsSent, emailsProcessed, cacheStats, modelUsage] =
    await Promise.all([
      supabase.from('chat_history').select('id', { count: 'exact' })
        .gte('created_at', weekStart).lte('created_at', weekEnd),

      supabase.from('documents').select('id', { count: 'exact' })
        .eq('status', 'active')
        .gte('created_at', weekStart).lte('created_at', weekEnd),

      supabase.from('documents').select('*, colaborador')
        .eq('status', 'active')
        .gte('data_vencimento', new Date())
        .lte('data_vencimento', addDays(new Date(), 30)),

      supabase.from('documents').select('*, colaborador')
        .gte('data_vencimento', weekStart).lte('data_vencimento', weekEnd),

      supabase.from('weekly_report_log').select('id', { count: 'exact' })
        .eq('report_type', 'expiry_alert')
        .gte('sent_at', weekStart).lte('sent_at', weekEnd),

      supabase.from('documents').select('id', { count: 'exact' })
        .eq('source', 'email')
        .gte('created_at', weekStart).lte('created_at', weekEnd),

      supabase.from('embedding_cache').select('hit_count')
        .gte('created_at', weekStart),

      supabase.from('chat_history')
        .select('model_used, tokens_used')
        .gte('created_at', weekStart).lte('created_at', weekEnd),
    ])

  return { ragQueries, docsProcessed, docsExpiring, docsExpired,
           alertsSent, emailsProcessed, cacheStats, modelUsage }
}
```

## Templates de email — estrutura obrigatória

Todo email de relatório tem 4 seções fixas:

```
1. CABEÇALHO    — logo TK Solution + "Relatório Semanal — [tipo] — semana de DD/MM a DD/MM"
2. DESTAQUE     — 1 número grande, o mais impactante do relatório (ex: horas economizadas)
3. MÉTRICAS     — tabela ou cards com todos os indicadores da semana
4. RODAPÉ       — explicação de cada benchmark usado no cálculo (ver abaixo)
```

## Rodapé explicativo — obrigatório em todo relatório

O rodapé aparece em todos os emails, explica cada métrica calculada e como
o número foi obtido. Isso gera confiança — o destinatário entende de onde vem cada número.

```typescript
function getFooterExplanations(config: ReportConfig, lang: 'pt' | 'en'): string {
  const b = {
    search:  config.benchmark_search_min      ?? DEFAULT_BENCHMARKS.search_min,
    doc:     config.benchmark_doc_process_min ?? DEFAULT_BENCHMARKS.doc_process_min,
    alert:   config.benchmark_alert_min       ?? DEFAULT_BENCHMARKS.alert_min,
    email:   config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
    cost:    config.hour_cost_brl             ?? DEFAULT_BENCHMARKS.hour_cost_brl,
  }

  if (lang === 'pt') return `
    <div style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;
                color:#6b7280;font-size:12px;line-height:1.8">
      <p><strong>Como calculamos as horas economizadas:</strong></p>
      <p>
        • <strong>Busca em documento:</strong> cada consulta ao assistente equivale a
          ${b.search} minutos que seriam gastos buscando manualmente.<br>
        • <strong>Processamento de documento:</strong> cada documento catalogado
          automaticamente equivale a ${b.doc} minutos de trabalho manual.<br>
        • <strong>Alerta de vencimento:</strong> cada alerta enviado automaticamente
          equivale a ${b.alert} minutos que alguém gastaria verificando e notificando.<br>
        • <strong>Triagem de email:</strong> cada email com anexo processado
          automaticamente equivale a ${b.email} minutos de triagem manual.
      </p>
      <p>
        • <strong>Valor estimado:</strong> horas economizadas × R$${b.cost}/hora
          (custo médio configurado para sua empresa).<br>
        • Esses benchmarks podem ser ajustados em
          Configurações → Relatórios.
      </p>
    </div>
  `

  return `
    <div style="border-top:1px solid #e5e7eb;margin-top:32px;padding-top:24px;
                color:#6b7280;font-size:12px;line-height:1.8">
      <p><strong>How we calculate hours saved:</strong></p>
      <p>
        • <strong>Document search:</strong> each assistant query equals
          ${b.search} minutes of manual searching.<br>
        • <strong>Document processing:</strong> each automatically catalogued document
          equals ${b.doc} minutes of manual work.<br>
        • <strong>Expiry alert:</strong> each automatically sent alert equals
          ${b.alert} minutes someone would spend checking and notifying.<br>
        • <strong>Email triage:</strong> each email with attachment processed
          automatically equals ${b.email} minutes of manual triage.
      </p>
      <p>
        • <strong>Estimated value:</strong> hours saved × R$${b.cost}/hour
          (average cost configured for your company).
      </p>
    </div>
  `
}
```

## Cron de envio — todo domingo à meia-noite

```typescript
// todo domingo às 00:00 — coleta dados da semana que passou
cron.schedule('0 0 * * 0', async () => {
  const weekEnd   = startOfDay(new Date())
  const weekStart = subDays(weekEnd, 7)

  try {
    await generateAndSendReports(weekStart, weekEnd)
  } catch (error) {
    Sentry.captureException(error, { tags: { job: 'weekly-report' } })
  }
}, { timezone: 'America/Sao_Paulo' })

async function generateAndSendReports(weekStart: Date, weekEnd: Date) {
  const [metrics, config, recipients] = await Promise.all([
    collectWeekMetrics(weekStart, weekEnd),
    getReportConfig(),
    getActiveRecipients(),
  ])

  const reportTypes = ['management', 'hr', 'it'] as const

  for (const type of reportTypes) {
    const typeRecipients = recipients.filter(
      r => r.report_type === type || r.report_type === 'all'
    )
    if (typeRecipients.length === 0) continue

    const html = buildReportEmail(type, metrics, config)

    await Promise.all(typeRecipients.map(r =>
      sendEmail(r.email, getReportSubject(type, weekStart, config.language), html)
    ))

    await supabase.from('weekly_report_log').insert({
      report_type: type,
      week_start: weekStart,
      week_end: weekEnd,
      recipients_count: typeRecipients.length,
      metrics_snapshot: metrics,
    })
  }
}
```

## Services e arquivos a criar

```
apps/api/src/services/reports/
├── report.service.ts       ← orquestrador principal
├── metrics.collector.ts    ← todas as queries SQL de coleta
├── hours.calculator.ts     ← calcHoursSaved() e lógica de benchmarks
├── templates/
│   ├── management.template.ts  ← HTML do relatório de gestão
│   ├── hr.template.ts          ← HTML do relatório de RH
│   ├── it.template.ts          ← HTML do relatório de TI
│   └── footer.template.ts      ← rodapé explicativo (pt + en)
└── report.cron.ts          ← cron de domingo + função generateAndSendReports()
```

## Regras de template HTML

- Email com largura máxima de 600px (padrão de email)
- Fundo branco, texto escuro — emails não têm dark mode confiável
- Logo TK Solution no topo (URL da imagem no Supabase Storage)
- Um número grande em destaque no topo de cada relatório
- Tabela de métricas com linhas alternadas (zebra) para legibilidade
- Rodapé explicativo sempre presente — nunca omitir
- Link "Ajustar configurações" no rodapé apontando para /settings/reports
- Zero chamadas de IA para gerar o texto — tudo template string TypeScript
