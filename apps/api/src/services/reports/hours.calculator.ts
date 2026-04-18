// Cálculo de horas economizadas (reports/SKILL.md)

export const DEFAULT_BENCHMARKS = {
  search_min: 8,         // minutos para buscar info manualmente
  doc_process_min: 25,   // minutos para catalogar um documento manualmente
  alert_min: 5,          // minutos para enviar alerta manualmente
  email_triage_min: 10,  // minutos para triar email com anexo manualmente
  hour_cost_brl: 35,     // custo médio hora colaborador em R$
}

export interface ReportConfig {
  language?: string
  hour_cost_brl?: number
  benchmark_search_min?: number
  benchmark_doc_process_min?: number
  benchmark_alert_min?: number
  benchmark_email_triage_min?: number
  send_day?: number   // 0=domingo ... 6=sábado
  send_hour?: number  // 0-23 (BRT)
  monthly_fixed_cost_brl?: number  // custo fixo mensal de infra (VPS, domínio, etc)
}

export interface ExpiringCert {
  employee_name: string | null
  expiry_date: string | null
  course_name: string | null
  file_name: string | null
}

export interface WeekMetrics {
  rag_queries: number
  rag_docs_total: number         // documentos RAG indexados (distintos)
  rag_docs_week: number          // documentos RAG adicionados na semana
  alerts_sent: number
  emails_processed: number
  model_usage: Array<{ model_used: string; tokens_used: number | null }>
  cache_hits: number
  // Certificados (tabela processed_certificates)
  total_certs: number
  certs_processed_week: number
  certs_by_type: Array<{ tipo: string; count: number }>
  certs_expiring_tiers: {
    expired: ExpiringCert[]
    day1: ExpiringCert[]
    day3: ExpiringCert[]
    day7: ExpiringCert[]
    day15: ExpiringCert[]
    day30: ExpiringCert[]
  }
  certs_expiring_count: number   // total vencendo em 30 dias
  certs_expired_count: number    // total vencidos
  collaborators_with_expired: Array<{ colaborador: string; count: number }>
  // IT-specific (tabela documents = RAG chunks)
  total_chunks: number
  total_cache_entries: number
  docs_error_week: number
  docs_processing: number
  active_users: number
  top_users: Array<{ user_id: string; name: string; queries: number }>
  feedback_positive: number
  feedback_negative: number
  avg_tokens_per_query: number
  total_tokens_week: number
}

export interface HoursSaved {
  minutesSaved: number
  hoursSaved: number
  valueBRL: number
}

export function calcHoursSaved(metrics: WeekMetrics, config: ReportConfig): HoursSaved {
  const b = {
    search:      config.benchmark_search_min      ?? DEFAULT_BENCHMARKS.search_min,
    doc_process: config.benchmark_doc_process_min ?? DEFAULT_BENCHMARKS.doc_process_min,
    email:       config.benchmark_email_triage_min ?? DEFAULT_BENCHMARKS.email_triage_min,
  }

  const minutesSaved =
    metrics.rag_queries      * b.search +
    metrics.certs_processed_week * b.doc_process +
    metrics.emails_processed * b.email

  const hoursSaved = minutesSaved / 60
  const valueBRL   = hoursSaved * (config.hour_cost_brl ?? DEFAULT_BENCHMARKS.hour_cost_brl)

  return { minutesSaved, hoursSaved, valueBRL }
}

export interface AICost {
  totalBRL: number
  byModel: Record<string, { tokens: number; usd: number; brl: number }>
}

// Preços OpenAI por 1M tokens (input+output médio)
const MODEL_PRICES_USD_PER_M: Record<string, number> = {
  'gpt-4o-mini': 0.375,  // média input $0.15 + output $0.60 / 2
  'gpt-4o':      6.25,   // média input $2.50 + output $10.00 / 2
}
const USD_TO_BRL = 5.0

export function calcAICost(modelUsage: WeekMetrics['model_usage']): AICost {
  const byModel: AICost['byModel'] = {}

  for (const row of modelUsage) {
    const model = row.model_used ?? 'unknown'
    const tokens = row.tokens_used ?? 0
    const pricePerM = MODEL_PRICES_USD_PER_M[model] ?? 1.0
    const usd = (tokens / 1_000_000) * pricePerM
    const brl = usd * USD_TO_BRL

    if (!byModel[model]) byModel[model] = { tokens: 0, usd: 0, brl: 0 }
    byModel[model].tokens += tokens
    byModel[model].usd    += usd
    byModel[model].brl    += brl
  }

  const totalBRL = Object.values(byModel).reduce((s, m) => s + m.brl, 0)
  return { totalBRL, byModel }
}
