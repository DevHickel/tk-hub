import { supabase } from '../../lib/supabase.js'
import type { WeekMetrics } from './hours.calculator.js'

export async function collectWeekMetrics(weekStart: Date, weekEnd: Date): Promise<WeekMetrics> {
  const start = weekStart.toISOString()
  const end   = weekEnd.toISOString()
  const today = new Date().toISOString().split('T')[0]
  const in30  = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]

  // Todas as queries em paralelo (reports/SKILL.md)
  const [
    ragQueriesRes,
    docsProcessedRes,
    docsExpiringRes,
    docsExpiredRes,
    emailsRes,
    cacheRes,
    modelRes,
  ] = await Promise.all([
    supabase
      .from('chat_history')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('documents')
      .select('colaborador, data_vencimento')
      .eq('status', 'active')
      .not('data_vencimento', 'is', null)
      .gte('data_vencimento', today)
      .lte('data_vencimento', in30),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .lt('data_vencimento', today)
      .eq('status', 'active'),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'email')
      .gte('created_at', start)
      .lte('created_at', end),

    supabase
      .from('embedding_cache')
      .select('hit_count')
      .gte('created_at', start),

    supabase
      .from('chat_history')
      .select('model_used, tokens_used')
      .gte('created_at', start)
      .lte('created_at', end),
  ])

  const cacheHits = (cacheRes.data ?? []).reduce(
    (s: number, r: { hit_count: number }) => s + (r.hit_count > 1 ? r.hit_count - 1 : 0),
    0
  )

  return {
    rag_queries:      ragQueriesRes.count ?? 0,
    docs_processed:   docsProcessedRes.count ?? 0,
    alerts_sent:      0, // contado via weekly_report_log futuramente
    emails_processed: emailsRes.count ?? 0,
    model_usage:      (modelRes.data ?? []) as WeekMetrics['model_usage'],
    cache_hits:       cacheHits,
    docs_expiring: (docsExpiringRes.data ?? []).map((d) => ({
      colaborador:      d.colaborador as string | null,
      data_vencimento:  d.data_vencimento as string | null,
    })),
    docs_expired:     docsExpiredRes.count ?? 0,
  }
}
